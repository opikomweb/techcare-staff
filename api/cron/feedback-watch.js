// GET/POST /api/cron/feedback-watch — ported from the n8n "Feedback
// Keyword Watch" workflow (n8n retirement, tranche 4). Every minute it
// scans only the newly appended Contractor_Feedback text (the
// Feedback_Scan_Length character watermark, advanced ALWAYS, match or
// not, and only after the match steps so a failure leaves the text
// eligible for rescan). Keyword lists, the High/Normal split,
// substring matching on the lowercased suffix, the one-task-per-scan
// shape and the Wilton email are the original's, verbatim.
// Same auth policy as the other cron endpoints.
const { requireCoreStaff } = require("../admin/_requireCoreStaff");
const { scanFeedback } = require("../_feedback");

const BASE_ID = "appBiAKY6ivoImcaQ";
const JOBS_TABLE = "tblpsypl4j8CChNq1";
const TASKS_TABLE = "tblfxDBlBIcnWIT8E";
const WILTON = "wilton@wilglobo.com";

function emailHtml(p) {
  const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return (p.priority === "High" ? '<div style="background:#fdecea;border-left:4px solid #c62828;padding:12px;margin:0 0 14px"><b>Flagged high priority</b> - worth a look soon, not necessarily urgent.</div>' : "")
    + '<table style="font-family:Arial,sans-serif;font-size:15px"><tr><td style="color:#555;padding:4px 14px 4px 0">Job</td><td><b>' + esc(p.jobCode) + "</b> " + esc(p.jobName) + '</td></tr><tr><td style="color:#555;padding:4px 14px 4px 0">Keywords</td><td><b>' + esc(p.matchedKeywords) + "</b></td></tr></table>"
    + '<p style="font-family:Arial,sans-serif;font-size:15px;white-space:pre-wrap;background:#f6f6f6;padding:12px">' + esc(p.newText) + "</p>"
    + "<p>A draft task was created in Follow_Up_Tasks - review and close it out when handled.</p>"
    + '<p><a href="https://airtable.com/appBiAKY6ivoImcaQ/tblfxDBlBIcnWIT8E">Open Follow-Up Tasks in Airtable</a></p>';
}

async function runFeedbackWatch() {
  const readKey = process.env.AIRTABLE_API_KEY;
  const writeKey = process.env.AIRTABLE_WRITE_KEY || readKey;
  if (!readKey) throw new Error("AIRTABLE_API_KEY is not set.");
  const params = new URLSearchParams();
  params.set("pageSize", "100");
  params.set("filterByFormula", "AND({Contractor_Feedback}!='', LEN({Contractor_Feedback}) > IF({Feedback_Scan_Length}, {Feedback_Scan_Length}, 0))");
  for (const f of ["Job_Code", "Job_Name", "Contractor_Feedback", "Feedback_Scan_Length"]) params.append("fields[]", f);
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${JOBS_TABLE}?${params}`, {
    headers: { Authorization: `Bearer ${readKey}` },
  });
  if (!res.ok) throw new Error(`Airtable feedback scan ${res.status}`);
  const data = await res.json();
  const jobs = data.records || [];

  const results = [];
  for (const job of jobs) {
    const p = scanFeedback(job);
    if (p.hasMatch) {
      const create = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TASKS_TABLE}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${writeKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          records: [{
            fields: {
              Task_Title: `Follow-up: ${p.jobCode} - ${p.matchedKeywords}`,
              Related_Job: [p.jobId],
              Matched_Keywords: p.matchedKeywords,
              Source_Note: p.newText,
              Priority: p.priority,
              Status: "Open",
              Created_At: new Date().toISOString(),
            },
          }],
          typecast: true,
        }),
      });
      if (!create.ok) throw new Error(`Follow-up task create ${create.status}`);
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "TechCare by WilGlobo Dispatch <tech@wilglobo.com>",
          to: [WILTON],
          subject: `${p.priority === "High" ? "URGENT - " : ""}Follow-up task: ${p.jobCode} - ${p.matchedKeywords}`,
          html: emailHtml(p),
        }),
      });
    }
    const stamp = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${JOBS_TABLE}/${p.jobId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${writeKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { Feedback_Scan_Length: p.fullLength }, typecast: true }),
    });
    results.push({ job: p.jobCode, matched: p.hasMatch ? p.matchedKeywords : null, priority: p.hasMatch ? p.priority : null, watermarkAdvanced: stamp.ok });
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
    if (!authorized && !secret) console.warn("feedback-watch: CRON_SECRET not set — running unauthenticated (watermark guards rescans).");
    const summary = await runFeedbackWatch();
    return res.status(200).json({ ok: true, ...summary });
  } catch (e) {
    console.error("feedback-watch failed:", e);
    return res.status(500).json({ error: "Feedback watch failed." });
  }
};

