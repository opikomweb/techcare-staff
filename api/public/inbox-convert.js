// GET /api/public/inbox-convert?id=rec…&k=<key> — the one-click
// "Create client and Draft job" action from the Inbox email button,
// ported from the n8n "Inbox To Client And Job" webhook (n8n
// retirement). Contract preserved: GET with side effects, gated on
// the Inbox record id format, idempotent (an already-converted
// request just shows "Already done"). Auth: the original used HTTP
// Basic Auth; the portal has no Basic-Auth surface, so the button
// link carries the shared key in `k`, checked against the
// TECHCARE_SMS_KEY secret already held in the portal's environment
// (server-side comparison only — the value is never rendered except
// into Wilton's own notification email, the same exposure the
// original's email button had). Page body is the original's Build
// Page, restyled to the portal shell; the signing-pack button points
// at the portal's /pack page.
const { pageShell, sendHtml, esc } = require("./_pageShell");
const { runConvert } = require("../_inboxConvert");

const AIRTABLE = "https://airtable.com/appBiAKY6ivoImcaQ/";

function resultPage(r) {
  const btn = (u, t, alt) => `<p><a href="${u}" style="display:block;text-align:center;background:${alt ? "#fff;color:#0a56b0;border:2px solid #0b6fd6" : "#0b6fd6;color:#fff"};text-decoration:none;padding:14px;border-radius:8px;font-weight:700;font-size:17px">${t}</a></p>`;
  let body;
  if (r.action === "error") {
    body = `<h1>Not found</h1><div class="card"><p class="meta">${esc(r.message)}</p></div>`;
  } else {
    const title = r.action === "convert" ? "Draft job created" : "Already done";
    const lead = r.action === "convert"
      ? (r.isNewClient ? "New client added" : "Matched to an existing client") + ". The job is in Draft. Add the worker, time and address, then set it to Dispatched."
      : "This request already has a job.";
    body = `<h1>${title}</h1><div class="card"><p class="meta">${esc(lead)}</p>`
      + (r.jobId ? btn(AIRTABLE + "tblpsypl4j8CChNq1/" + r.jobId, "Open the job") : "")
      + (r.clientId ? btn(AIRTABLE + "tblY473voC9AylgFF/" + r.clientId, "Open the client", true) : "")
      + (r.clientId ? btn("https://staff.wilglobo.com/pack?kind=client&id=" + r.clientId, "Email the client their forms to sign", true) : "")
      + `<p class="meta" style="color:#66717d;font-size:14px">The signing email only goes out if the client has an email address on file.</p></div>`;
  }
  return pageShell({ title: "TechCare Inbox", body });
}

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });
  const id = (req.query && req.query.id) || "";
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) {
    return sendHtml(res, pageShell({ title: "TechCare Inbox", body: `<h1>Not found</h1><div class="card"><p class="meta">That request was not found. It may have been deleted.</p></div>` }));
  }
  const expected = process.env.TECHCARE_SMS_KEY;
  if (expected && (req.query.k || "") !== expected) {
    return res.status(401).json({ error: "Unauthorized." });
  }
  try {
    const r = await runConvert(id);
    return sendHtml(res, resultPage(r));
  } catch (e) {
    console.error("inbox-convert failed:", e);
    return sendHtml(res, pageShell({ title: "TechCare Inbox", body: `<h1>Something went wrong</h1><div class="card"><p class="meta">The conversion did not finish. Please open the request in the Inbox and try again, or convert it by hand in Airtable.</p></div>` }));
  }
};
