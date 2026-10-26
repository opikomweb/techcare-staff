// Make Signed Copy — a port of the retired n8n sub-workflow of the same
// name. Fills a document template (api/public/_templates.json, migrated
// from the n8n Data Table) with the signer's details, emails the signer
// a signed copy from tech@wilglobo.com with a printable HTML attachment,
// and writes the proof note (file name + SHA-256 of the attachment) onto
// the Acknowledgement record.
//
// Preserved semantics from the original:
//   - placeholder set: %%LABEL%% %%PREPARED_FOR%% %%SIGNED_BY%%
//     %%DATE_SIGNED%% %%ON_BEHALF%% %%METHOD%% %%RECORD_REF%%
//     %%ACCEPTED%% %%LOGO%%
//   - the emailed body uses the hosted logo; the attachment embeds the
//     logo as base64 — and the SHA-256 covers the ATTACHMENT bytes.
//   - recipient juggling: wilglobo.int@gmail.com becomes
//     wilton@wilglobo.com; the signer gets To, Wilton gets Bcc (dropped
//     when it would equal To); no signer email → copy goes to Wilton.
//   - file name: <code>-v<version>-signed-<YYYY-MM-DD>.html
//   - reference: ACK-<ackId> / <code> v<version>
const crypto = require("crypto");
const templates = require("./_templates.json");

const BASE_ID = "appBiAKY6ivoImcaQ";
const ACK_TABLE = "tbl8a0ZsHRAWsObCi";
const FROM = "TechCare by WilGlobo <tech@wilglobo.com>";
const HOSTED_LOGO = '<img src="https://staff.wilglobo.com/assets/techcare-logo.png" alt="TechCare by WilGlobo" style="height:44px;display:block;border:0">';

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function whenString(iso) {
  const d = iso ? new Date(iso) : new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Edmonton", weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).formatToParts(d);
  const get = (t) => (parts.find((p) => p.type === t) || {}).value || "";
  return `${get("weekday")}, ${get("month")} ${get("day")}, ${get("year")} at ${get("hour")}:${get("minute")} ${get("dayPeriod")} (Mountain Time)`;
}

function fill(templateHtml, { preparedFor, signerName, when, onBehalf, method, ref, logoMarkup }) {
  let html = String(templateHtml || "");
  html = html.split("%%LABEL%%").join(" &middot; SIGNED COPY");
  html = html.split("%%PREPARED_FOR%%").join(esc(preparedFor || signerName || ""));
  html = html.split("%%SIGNED_BY%%").join(esc(signerName || ""));
  html = html.split("%%DATE_SIGNED%%").join(esc(when));
  html = html.split("%%ON_BEHALF%%").join(esc(onBehalf || "Not applicable"));
  html = html.split("%%METHOD%%").join(esc(method || "Typed name on the TechCare secure web form"));
  html = html.split("%%RECORD_REF%%").join(esc(ref));
  html = html.split("%%ACCEPTED%%").join(esc(`WilGlobo Inc., accepted electronically on ${when}`));
  html = html.split("%%LOGO%%").join(logoMarkup);
  return html;
}

async function sendWithAttachment({ to, bcc, subject, html, fileName, fileContent }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false, reason: "email_not_configured" };
  const payload = {
    from: FROM,
    to: [to],
    reply_to: "tech@wilglobo.com",
    subject,
    html,
    attachments: [{
      filename: fileName,
      content: Buffer.from(fileContent, "utf8").toString("base64"),
      content_type: "text/html; charset=UTF-8",
    }],
  };
  if (bcc && bcc !== to) payload.bcc = [bcc];
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { sent: false, reason: "email_send_failed", error: data.message || res.status };
    return { sent: true, id: data.id };
  } catch (e) {
    return { sent: false, reason: "email_send_failed", error: String(e) };
  }
}

async function makeSignedCopy({ code, signerName, preparedFor, email, signedAt, onBehalf, method, ackId }) {
  const t = templates[code];
  if (!t) return { ok: false, error: "No template for " + code };

  const when = whenString(signedAt);
  const ref = `ACK-${ackId || "pending"} / ${code} v${t.version}`;
  const logoRow = templates["LOGO"];
  const embeddedLogo = logoRow && logoRow.html
    ? `<img src="data:image/png;base64,${logoRow.html}" alt="TechCare by WilGlobo" style="height:48px">`
    : HOSTED_LOGO;

  const base = { preparedFor, signerName, when, onBehalf, method, ref };
  const emailDoc = fill(t.html, { ...base, logoMarkup: HOSTED_LOGO });
  const fileDoc = fill(t.html, { ...base, logoMarkup: embeddedLogo });
  const fileHtml = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(t.title)} - signed copy</title><link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700&family=Source+Sans+3:wght@400;600;700&display=swap" rel="stylesheet"><style>@media print { .noprint { display:none; } }</style></head><body>${fileDoc}</body></html>`;
  let sha = "unavailable";
  try { sha = crypto.createHash("sha256").update(fileHtml, "utf8").digest("hex"); } catch (e) { /* keep 'unavailable' */ }

  const datePart = (signedAt ? new Date(signedAt) : new Date()).toISOString().slice(0, 10);
  const fileName = `${code}-v${t.version}-signed-${datePart}.html`;

  const firstName = String(preparedFor || signerName || "").trim().split(/\s+/)[0] || "there";
  const intro = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#1b2533;max-width:620px;margin:0 auto"><p>Hello ${esc(firstName)},</p><p>Thank you. Here is your signed copy of <b>${esc(t.title)}</b>. Please keep it for your records.</p><p>A printable copy is attached. To save it as a PDF, open the attachment and choose Print, then Save as PDF.</p><p>Questions? Call 403-679-3039 or reply to this email.</p><p>TechCare by WilGlobo</p><hr style="border:0;border-top:1px solid #d5dde8;margin:18px 0"></div>`;
  const emailHtml = intro + emailDoc;

  // Recipient juggling, ported: wilglobo.int -> wilton; signer To,
  // internal Bcc; Wilton outright when no signer email.
  const swap = (addr) => (addr || "").split("wilglobo.int@gmail.com").join("wilton@wilglobo.com");
  let to = swap(email || "wilglobo.int@gmail.com");
  let bcc = email ? swap("wilglobo.int@gmail.com") : "";
  if (bcc === to) bcc = "";

  const subject = `Your signed copy: ${t.title} (${code} v${t.version})`;
  const sent = await sendWithAttachment({ to, bcc, subject, html: emailHtml, fileName, fileContent: fileHtml });

  const note = `Signed copy emailed to ${email ? to : "WilGlobo only (no signer email on file)"} on ${when}. File ${fileName}. SHA-256 ${sha}. Ref ${ref}.`;
  if (ackId && process.env.AIRTABLE_WRITE_KEY) {
    try {
      await fetch(`https://api.airtable.com/v0/${BASE_ID}/${ACK_TABLE}/${ackId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${process.env.AIRTABLE_WRITE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ fields: { Signed_Copy: note }, typecast: true }),
      });
    } catch (e) {
      console.error("signedCopy: ack update failed:", e);
    }
  }
  return { ok: true, sent, note, fileName, sha };
}

module.exports = { makeSignedCopy, _test: { fill, whenString } };
