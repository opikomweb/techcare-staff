// GET/POST /api/cron/dispatch-sms — ported from the n8n "Dispatch SMS
// Confirm" workflow (n8n retirement, tranche 4). Every minute it finds
// jobs that are Dispatched with Dispatch_SMS_Sent unset and texts the
// assigned worker the "new job" message with the job's Status_Form_URL
// (the tap-to-accept link), stamping the flag only after a successful
// send so no worker is texted twice. A worker with no usable phone is
// skipped WITHOUT stamping (retried while the job stays Dispatched),
// exactly as the original behaved. Sends go through api/_sms.js (the
// guarded Twilio path) — note the original sent via Twilio directly,
// bypassing the gateway's STOP/320 checks; its template already
// satisfies them (it carries the STOP line and is well under 320).
// Same auth policy as the other cron endpoints.
const { validateSms, sendSms, workerPhoneE164, startTimeLocal } = require("../_sms");
const { requireCoreStaff } = require("../admin/_requireCoreStaff");

const BASE_ID = "appBiAKY6ivoImcaQ";
const JOBS_TABLE = "tblpsypl4j8CChNq1";

const first = (v) => (Array.isArray(v) ? v[0] || "" : v || "");

async function runDispatchSms() {
  const readKey = process.env.AIRTABLE_API_KEY;
  const writeKey = process.env.AIRTABLE_WRITE_KEY || readKey;
  if (!readKey) throw new Error("AIRTABLE_API_KEY is not set.");
  const params = new URLSearchParams();
  params.set("pageSize", "100");
  params.set("filterByFormula", "AND({Status}='Dispatched',NOT({Dispatch_SMS_Sent}))");
  for (const f of ["Job_Name", "Job_Code", "Assigned_Phone", "Status_Form_URL", "Location", "Start_Time"]) params.append("fields[]", f);
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${JOBS_TABLE}?${params}`, {
    headers: { Authorization: `Bearer ${readKey}` },
  });
  if (!res.ok) throw new Error(`Airtable dispatch-sms scan ${res.status}`);
  const data = await res.json();
  const jobs = data.records || [];

  const results = [];
  for (const job of jobs) {
    const f = job.fields || {};
    const phone = workerPhoneE164(first(f.Assigned_Phone));
    if (!phone) {
      results.push({ job: f.Job_Code || job.id, skipped: "no_worker_phone" });
      continue;
    }
    const body = `WilGlobo TechCare: new job dispatched - ${f.Job_Name || ""} (${f.Job_Code || ""}) at ${f.Location || ""}, ${startTimeLocal(f.Start_Time)}. Tap to accept: ${f.Status_Form_URL || ""} Reply STOP to opt out.`;
    const v = validateSms(phone, body);
    if (!v.valid) {
      results.push({ job: f.Job_Code || job.id, skipped: "invalid", error: v.error });
      continue;
    }
    const { sid } = await sendSms(v.to, v.body);
    const stamp = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${JOBS_TABLE}/${job.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${writeKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { Dispatch_SMS_Sent: true }, typecast: true }),
    });
    results.push({ job: f.Job_Code || job.id, texted: phone, sid, stamped: stamp.ok });
  }
  return { processed: jobs.length, results };
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
    if (!authorized && !secret) console.warn("dispatch-sms: CRON_SECRET not set — running unauthenticated (once-only stamp guards sends).");
    const summary = await runDispatchSms();
    return res.status(200).json({ ok: true, ...summary });
  } catch (e) {
    console.error("dispatch-sms failed:", e);
    return res.status(500).json({ error: "Dispatch SMS sweep failed." });
  }
};

