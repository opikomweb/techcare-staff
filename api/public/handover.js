// GET  /handover?job=<Jobs record id>&c=<Job_Key>  — the confirm page
// POST /api/public/handover                        — the confirm submit
//
// Client handover confirmation — the page half of the ported n8n
// "Handover Confirm" workflow (the watcher half is api/cron/handover.js).
// Shows the worker's completion summary (extracted from
// Contractor_Feedback with the same last "- Job completed" line rule)
// with one Confirm button; submitting stamps Handover_Confirmed_At and
// emails Wilton. Strict Job_Key equality; 403 on mismatch.
const { pageShell, sendHtml, esc } = require("./_pageShell");
const { extractSummary, PAGE_FALLBACK } = require("../_handover");

const BASE_ID = "appBiAKY6ivoImcaQ";
const JOBS_TABLE = "tblpsypl4j8CChNq1";
const WILTON = "wilton@wilglobo.com";
const FROM = "TechCare by WilGlobo <tech@wilglobo.com>";

async function sendEmail({ to, subject, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [to], subject, text }),
    });
    const data = await res.json().catch(() => ({}));
    return res.ok ? { sent: true } : { sent: false, error: data.message || res.status };
  } catch (e) {
    return { sent: false, error: String(e) };
  }
}

async function getJob(jobId, key) {
  if (!jobId || !jobId.startsWith("rec")) return null;
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${JOBS_TABLE}/${jobId}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) return null;
  return res.json();
}

function forbidden(res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(403).send(pageShell({
    title: "Link not valid | TechCare by WilGlobo",
    body: `<h1>Sorry</h1><div class="empty">This link is not valid. Call 403-679-3039.</div>`,
  }));
}

function first(v) {
  return Array.isArray(v) ? v[0] || "" : v || "";
}

function confirmPage(job, f, c) {
  const jobName = f.Job_Name || "Your TechCare visit";
  const worker = first(f.Assigned_Name) || "your technician";
  const summary = extractSummary(f.Contractor_Feedback, PAGE_FALLBACK);
  const body = `
<h1>${esc(jobName)}</h1>
<p class="sub">${esc(worker)} has finished up. Here is a summary of what was done.</p>
<div class="card"><div style="white-space:pre-wrap;font-size:15px;line-height:1.55">${esc(summary)}</div></div>
<form id="f" method="post">
  <button class="submit" type="submit">Looks good, confirm</button>
  <p id="msg" style="margin-top:10px"></p>
</form>
<script>
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('msg');
  msg.textContent = 'Recording…';
  try {
    const res = await fetch('/api/public/handover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job: ${JSON.stringify(job.id)}, c: ${JSON.stringify(c)} }) });
    const html = await res.text();
    document.open(); document.write(html); document.close();
  } catch (err) {
    msg.textContent = 'Could not record. Check your connection and try again, or call 403-679-3039.';
  }
});
</script>`;
  return pageShell({ title: "Visit summary | TechCare by WilGlobo", body });
}

module.exports = async (req, res) => {
  try {
    const readKey = process.env.AIRTABLE_API_KEY;
    if (!readKey) return forbidden(res);
    if (req.method === "GET") {
      const job = await getJob(String(req.query?.job || ""), readKey);
      const c = String(req.query?.c || "");
      if (!job || c !== String((job.fields || {}).Job_Key || "")) return forbidden(res);
      return sendHtml(res, confirmPage(job, job.fields || {}, c));
    }
    if (req.method === "POST") {
      const b = req.body || {};
      const job = await getJob(String(b.job || ""), readKey);
      const c = String(b.c || "");
      if (!job || c !== String((job.fields || {}).Job_Key || "")) return forbidden(res);
      const confirmedAt = new Date().toISOString();
      const writeKey = process.env.AIRTABLE_WRITE_KEY || readKey;
      const res2 = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${JOBS_TABLE}/${job.id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${writeKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ fields: { Handover_Confirmed_At: confirmedAt }, typecast: true }),
      });
      if (!res2.ok) throw new Error(`Airtable confirm update ${res2.status}`);
      const jobName = (job.fields || {}).Job_Name || "Your TechCare visit";
      await sendEmail({
        to: WILTON,
        subject: `Client confirmed handover - ${jobName}`,
        text: `${jobName} - the client confirmed the completion summary at ${confirmedAt}`,
      }).catch(() => {});
      return sendHtml(res, pageShell({
        title: "Confirmed | TechCare by WilGlobo",
        body: `<h1>Thank you</h1><div class="empty">Thanks for confirming. Reach out any time if something needs following up: 403-679-3039.</div>`,
      }));
    }
    return res.status(405).json({ error: "Method not allowed." });
  } catch (e) {
    console.error("handover failed:", e);
    return forbidden(res);
  }
};
