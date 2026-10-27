// GET/POST /api/cron/invoice-approval — when a job is Completed, text
// the owner the total with a one-tap approve link (added Oct 27,
// 2026 at Opik's direction). Minutely sweep; once-only per job via
// the "Invoice Approval Text" Job_Updates marker (see
// api/_invoiceApproval.js). Only jobs whose worker checked out
// within the last 72 hours are picked up, so older completed jobs
// are never blasted. The approve link carries the shared key from
// the portal's environment — the same pattern as the inbox-convert
// button — and is minted server-side; it never passes through chat.
// Same auth policy as the other cron endpoints.
const { validateSms, sendSms } = require("../_sms");
const { approvalText, markerExists, addMarker, OWNER_PHONE } = require("../_invoiceApproval");
const { requireCoreStaff } = require("../admin/_requireCoreStaff");

const BASE_ID = "appBiAKY6ivoImcaQ";
const JOBS_TABLE = "tblpsypl4j8CChNq1";

async function runInvoiceApprovalSweep() {
  const readKey = process.env.AIRTABLE_API_KEY;
  if (!readKey) throw new Error("AIRTABLE_API_KEY is not set.");
  const sharedKey = process.env.TECHCARE_SMS_KEY;
  if (!sharedKey) return { skipped: "no_shared_key_configured", texted: [] };

  const params = new URLSearchParams();
  params.set("pageSize", "100");
  params.set("filterByFormula", "AND({Status}='Completed',{Departed_At}!='',IS_AFTER({Departed_At},DATEADD(NOW(),-72,'hours')),{Job_Total}>0)");
  for (const f of ["Job_Name", "Job_Code", "Client_Name", "Job_Total", "Worker_Pay_Total"]) params.append("fields[]", f);
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${JOBS_TABLE}?${params}`, {
    headers: { Authorization: `Bearer ${readKey}` },
  });
  if (!res.ok) throw new Error(`Airtable invoice-approval scan ${res.status}`);
  const data = await res.json();
  const jobs = data.records || [];

  const texted = [];
  for (const job of jobs) {
    const f = job.fields || {};
    if (await markerExists(job.id, "Invoice Approval Text")) continue;
    if (await markerExists(job.id, "Invoice Sent")) continue;
    const url = `https://staff.wilglobo.com/api/public/invoice-approve?job=${job.id}&k=${encodeURIComponent(sharedKey)}`;
    const body = approvalText(f, url);
    const v = validateSms(OWNER_PHONE, body);
    if (!v.valid) {
      texted.push({ job: f.Job_Code || job.id, skipped: "invalid", error: v.error });
      continue;
    }
    const { sid } = await sendSms(v.to, v.body);
    await addMarker(job.id, "Invoice Approval Text", f.Job_Code,
      `Approval text sent to Wilton: total ${f.Job_Total} for ${f.Job_Code || job.id}. SMS ${sid}.`);
    texted.push({ job: f.Job_Code || job.id, sid });
  }
  return { texted };
}

module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }
  try {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.authorization || "";
    let authorized = false;
    if (secret && auth === `Bearer ${secret}`) authorized = true;
    if (!authorized) {
      const gate = await requireCoreStaff(req).catch(() => ({ error: "no session" }));
      if (!gate.error) authorized = true;
    }
    if (!authorized && secret) return res.status(401).json({ error: "Unauthorized." });
    if (!authorized && !secret) console.warn("invoice-approval: CRON_SECRET not set — running unauthenticated (once-only markers guard sends).");
    const summary = await runInvoiceApprovalSweep();
    return res.status(200).json({ ok: true, ...summary });
  } catch (e) {
    console.error("invoice-approval failed:", e);
    return res.status(500).json({ error: "Invoice approval sweep failed." });
  }
};
