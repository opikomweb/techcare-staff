// GET/POST /api/cron/handover — the watcher half of the ported n8n
// "Handover Confirm" workflow. Every minute (Vercel Cron) it finds
// jobs that are Completed with no Handover_Sent_At, emails the client
// their completion summary with the confirm link (or emails Wilton
// when the client has no email on file), and stamps Handover_Sent_At
// either way so nothing is ever sent twice.
//
// One deliberate difference from the n8n watcher: its Airtable trigger
// only fired when a record changed, so old completions sat unsent
// forever (WGB-4 has been Completed and unsent since Oct 11). This
// scan is formula-based, so it is windowed to jobs whose End_Time is
// within the last 7 days — new completions are caught within a minute,
// and pre-rebuild history is not emailed retroactively.
// Same auth policy as the other cron endpoints.
const { extractSummary, WATCH_FALLBACK } = require("../_handover");
const { requireCoreStaff } = require("../admin/_requireCoreStaff");

const BASE_ID = "appBiAKY6ivoImcaQ";
const JOBS_TABLE = "tblpsypl4j8CChNq1";
const WILTON = "wilton@wilglobo.com";
const FROM = "TechCare by WilGlobo <tech@wilglobo.com>";
const PORTAL = "https://staff.wilglobo.com";

const first = (v) => (Array.isArray(v) ? v[0] || "" : v || "");

async function sendEmail({ to, subject, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false, reason: "email_not_configured" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [to], subject, text }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { sent: false, reason: "email_send_failed", error: data.message || res.status };
    return { sent: true, id: data.id };
  } catch (e) {
    return { sent: false, reason: "email_send_failed", error: String(e) };
  }
}

async function runHandoverSweep() {
  const readKey = process.env.AIRTABLE_API_KEY;
  const writeKey = process.env.AIRTABLE_WRITE_KEY || process.env.AIRTABLE_API_KEY;
  if (!readKey) throw new Error("AIRTABLE_API_KEY is not set.");
  const formula = "AND({Status}='Completed',{Handover_Sent_At}='',IS_AFTER({End_Time},DATEADD(NOW(),-7,'days')))";
  const params = new URLSearchParams();
  params.set("pageSize", "100");
  params.set("filterByFormula", formula);
  for (const f of ["Job_Name", "Job_Code", "Contractor_Feedback", "Client_Email", "Client_Name", "Assigned_Name", "Job_Key"]) params.append("fields[]", f);
  const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${JOBS_TABLE}`);
  url.search = params.toString();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${readKey}` } });
  if (!res.ok) throw new Error(`Airtable handover scan ${res.status}`);
  const data = await res.json();
  const jobs = data.records || [];

  const results = [];
  for (const job of jobs) {
    const f = job.fields || {};
    const jobName = f.Job_Name || "Your TechCare visit";
    const workerName = first(f.Assigned_Name) || "your technician";
    const clientName = first(f.Client_Name);
    const clientEmail = first(f.Client_Email);
    const summary = extractSummary(f.Contractor_Feedback, WATCH_FALLBACK);
    let channel;
    if (clientEmail) {
      const link = `${PORTAL}/handover?job=${job.id}&c=${encodeURIComponent(f.Job_Key || "")}`;
      await sendEmail({
        to: clientEmail,
        subject: `Your TechCare visit is complete - ${jobName}`,
        text: `Hi ${clientName || "there"},\n\n${workerName} has finished up. Here is a summary of what was done:\n\n${summary}\n\nPlease confirm this looks right:\n${link}\n\nThanks for choosing TechCare by WilGlobo.`,
      });
      channel = "client";
    } else {
      await sendEmail({
        to: WILTON,
        subject: `Handover summary ready but no client email - ${jobName}`,
        text: `${jobName} is marked completed but the client has no email on file, so the handover summary could not be sent automatically.\n\nSummary:\n${summary}\n\nYou may want to text or call the client, or add their email to Airtable and clear Handover_Sent_At on the job to re-run this.`,
      });
      channel = "wilton";
    }
    const stamp = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${JOBS_TABLE}/${job.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${writeKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { Handover_Sent_At: new Date().toISOString() }, typecast: true }),
    });
    results.push({ job: f.Job_Code || job.id, channel, stamped: stamp.ok });
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
    if (!authorized && !secret) console.warn("handover: CRON_SECRET not set — running unauthenticated (work is stamp-guarded).");
    const summary = await runHandoverSweep();
    return res.status(200).json({ ok: true, ...summary });
  } catch (e) {
    console.error("handover sweep failed:", e);
    return res.status(500).json({ error: "Handover sweep failed." });
  }
};

module.exports._test = { extractSummary };
