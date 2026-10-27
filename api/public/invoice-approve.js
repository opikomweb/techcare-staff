// GET /api/public/invoice-approve?job=<Jobs record id>&k=<key> —
// the owner's one-tap approval from the completion text: sends the
// client their invoice (Square card link + e-transfer instructions)
// by text and email. Key-gated like the inbox-convert button
// (shared key checked server-side against the portal environment).
// Idempotent: a second tap shows "already sent". Logic in
// api/_invoiceApproval.js.
const { pageShell, sendHtml, esc } = require("./_pageShell");
const { runInvoiceApproval } = require("../_invoiceApproval");

function page(title, inner) {
  return pageShell({ title: "TechCare Invoice", body: `<h1>${esc(title)}</h1><div class="card">${inner}</div>` });
}

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });
  const jobId = (req.query && req.query.job) || "";
  if (!/^rec[A-Za-z0-9]{14}$/.test(jobId)) {
    return sendHtml(res, page("Not found", `<p class="meta">That job link is not valid.</p>`));
  }
  const expected = process.env.TECHCARE_SMS_KEY;
  if (expected && (req.query.k || "") !== expected) {
    return res.status(401).json({ error: "Unauthorized." });
  }
  try {
    const r = await runInvoiceApproval(jobId);
    if (r.action === "sent") {
      const lines = [
        `<p class="meta" style="font-size:16px">Invoice <b>${esc(r.invoiceNo)}</b> for <b>$${Number(r.total || 0).toFixed(2)}</b> sent to ${esc(r.client || "the client")}.</p>`,
        r.sms ? `<p class="meta">Text: ${r.sms.error ? "failed (" + esc(r.sms.error) + ")" : "sent to " + esc(r.sms.to)}</p>` : "",
        r.email ? `<p class="meta">Email: ${r.email.sent ? "sent to " + esc(r.email.to) : "failed"}</p>` : "",
        r.squareUrl ? `<p class="meta">Card payment (Square): <a href="${esc(r.squareUrl)}">${esc(r.squareUrl)}</a></p>` : `<p class="meta">No Square card link was created — the invoice asks for e-transfer to sales@wilglobo.com only.</p>`,
      ].join("");
      return sendHtml(res, page("Invoice sent", lines));
    }
    if (r.action === "already") {
      return sendHtml(res, page("Already sent", `<p class="meta">The invoice for ${esc(r.code || "this job")} ($${Number(r.total || 0).toFixed(2)}) was already sent. Tapping again does not send it twice.</p>`));
    }
    if (r.action === "not_completed") {
      return sendHtml(res, page("Not yet", `<p class="meta">${esc(r.message)}</p>`));
    }
    return sendHtml(res, page("Not found", `<p class="meta">${esc(r.message || "That job was not found.")}</p>`));
  } catch (e) {
    console.error("invoice-approve failed:", e);
    return sendHtml(res, page("Something went wrong", `<p class="meta">The invoice did not send. Please send it from the portal instead, or try the link again.</p>`));
  }
};
