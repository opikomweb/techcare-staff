// GET/POST /api/cron/review-request — ported from the n8n "Review
// Request" workflow (n8n retirement, tranche 4). About a day after a
// job is completed (worker checked out at least 20 hours ago), the
// client is emailed a thank-you with the Google review link and the
// job is marked Sent with a timestamp; a job that cannot be emailed
// (no client email) is marked Queued — never silently dropped.
//
// The n8n version never sent a single email: its GOOGLE_REVIEW_LINK
// constant was blank, so everything queued. Opik supplied the real
// link on Oct 26, 2026 (below; GOOGLE_REVIEW_LINK env var overrides
// it). Deliberate release decision, per the spec's open question:
// now that the link exists, jobs already sitting at "Queued" are
// processed too — that is how the backlog clears without manual
// Airtable edits.
// Same auth policy as the other cron endpoints.
const { requireCoreStaff } = require("../admin/_requireCoreStaff");

const BASE_ID = "appBiAKY6ivoImcaQ";
const JOBS_TABLE = "tblpsypl4j8CChNq1";
const REVIEW_LINK = process.env.GOOGLE_REVIEW_LINK || "https://g.page/r/CZ8G2uJ0q4R6EBM/review";

const first = (v) => (Array.isArray(v) ? v[0] || "" : v || "");
const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;");

function reviewEmailHtml(clientName, jobCode, reviewLink) {
  return '<div style="font-family:Arial,sans-serif;max-width:480px"><h2 style="color:#0b1e33;margin:0 0 4px">TechCare by WilGlobo</h2><p style="color:#66717d;margin:0 0 20px">Hi ' + esc(clientName) + ", thanks for choosing us for " + esc(jobCode) + '.</p><p style="font-size:16px;margin:0 0 20px">If we did a good job, a quick review helps other people in Calgary find us. It only takes a minute.</p><p><a href="' + esc(reviewLink) + '" style="background:#0b6fd6;color:#ffffff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">Leave us a review</a></p><p style="color:#888;font-size:12px;margin-top:28px">WilGlobo TechCare - tech@wilglobo.com - (403) 679-3039</p></div>';
}

async function runReviewRequests() {
  const readKey = process.env.AIRTABLE_API_KEY;
  const writeKey = process.env.AIRTABLE_WRITE_KEY || readKey;
  if (!readKey) throw new Error("AIRTABLE_API_KEY is not set.");
  const params = new URLSearchParams();
  params.set("pageSize", "100");
  params.set("filterByFormula", "AND({Status}='Completed', OR({Review_Request_Status}='', {Review_Request_Status}='Not Yet', {Review_Request_Status}='Queued'), {Departed_At}!='', IS_BEFORE({Departed_At}, DATEADD(NOW(), -20, 'hours')))");
  for (const f of ["Job_Code", "Client_Name", "Client_Email", "Review_Request_Status"]) params.append("fields[]", f);
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${JOBS_TABLE}?${params}`, {
    headers: { Authorization: `Bearer ${readKey}` },
  });
  if (!res.ok) throw new Error(`Airtable review scan ${res.status}`);
  const data = await res.json();
  const jobs = data.records || [];

  const results = [];
  for (const job of jobs) {
    const f = job.fields || {};
    const jobCode = f.Job_Code || "record " + job.id;
    const clientName = first(f.Client_Name) || "there";
    const clientEmail = first(f.Client_Email);
    let outcome;
    if (clientEmail && REVIEW_LINK) {
      const send = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "TechCare by WilGlobo <tech@wilglobo.com>",
          to: [clientEmail],
          subject: `How did we do, ${clientName}?`,
          html: reviewEmailHtml(clientName, jobCode, REVIEW_LINK),
        }),
      });
      if (!send.ok) throw new Error(`Resend ${send.status}`);
      const stamp = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${JOBS_TABLE}/${job.id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${writeKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ fields: { Review_Request_Status: "Sent", Review_Request_Sent_At: new Date().toISOString() }, typecast: true }),
      });
      outcome = { job: jobCode, action: "sent", to: clientEmail, stamped: stamp.ok };
    } else {
      const stamp = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${JOBS_TABLE}/${job.id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${writeKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ fields: { Review_Request_Status: "Queued" }, typecast: true }),
      });
      outcome = { job: jobCode, action: "queued", reason: clientEmail ? "no_review_link" : "no_client_email", stamped: stamp.ok };
    }
    results.push(outcome);
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
    if (!authorized && !secret) console.warn("review-request: CRON_SECRET not set — running unauthenticated (status stamps guard repeats).");
    const summary = await runReviewRequests();
    return res.status(200).json({ ok: true, ...summary });
  } catch (e) {
    console.error("review-request failed:", e);
    return res.status(500).json({ error: "Review request sweep failed." });
  }
};
