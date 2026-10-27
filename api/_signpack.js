// Signing packs — a port of the retired n8n "Send Signing Pack"
// workflow (n8n retirement, tranche 3). Builds the personalised pack of
// documents a client or worker still has to sign and sends it: email
// from tech@wilglobo.com when there's a usable email and something
// required, otherwise an SMS (via the portal's SMS channel) when
// there's a phone, otherwise an email to Wilton explaining nothing was
// sent. Email and SMS are alternatives, never both — as in the
// original.
//
// The record is always unticked afterwards (Send_Sign_Pack=false), the
// Sign_Code in use is persisted (generated on first use), and
// Sign_Pack_Sent_At is stamped only on the email path — the original's
// exact semantics. Triggered by a one-minute cron sweep over ticked
// records, and on demand from /pack by core staff.
const crypto = require("crypto");

const BASE_ID = "appBiAKY6ivoImcaQ";
const CLIENTS_TABLE = "tblY473voC9AylgFF";
const DIRECTORY_TABLE = "tbllgRxtl2LbCMg2O";
const POLICIES_TABLE = "tblUgRM9XLfyGplVR";
const WILTON = "wilton@wilglobo.com";
const FROM = "TechCare by WilGlobo <tech@wilglobo.com>";
const LOGO_URL = "https://staff.wilglobo.com/assets/techcare-logo.png";
const PORTAL = "https://staff.wilglobo.com";
const SMS_WEBHOOK_DEFAULT = "https://staff.wilglobo.com/api/public/send-sms";
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const CODE_RE = /^[a-f0-9]{32}$/;

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function e164(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (s.startsWith("+")) return "+" + s.slice(1).replace(/\D/g, "");
  const d = s.replace(/\D/g, "");
  if (d.length === 10) return "+1" + d;
  if (d.length === 11 && d.startsWith("1")) return "+" + d;
  return d ? "+" + d : "";
}

async function airtable(method, path, key, body) {
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data && data.error && data.error.message) || `Airtable ${path} ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function listAll(tableId, fields, formula, key) {
  const params = new URLSearchParams();
  params.set("pageSize", "100");
  if (formula) params.set("filterByFormula", formula);
  for (const f of fields) params.append("fields[]", f);
  let records = [];
  let offset;
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${tableId}`);
    url.search = params.toString();
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) throw new Error(`Airtable list ${tableId} ${res.status}`);
    const data = await res.json();
    records = records.concat(data.records || []);
    offset = data.offset;
  } while (offset);
  return records;
}

async function sendEmail({ to, subject, html, from }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false, reason: "email_not_configured" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: from || FROM, to: [to], reply_to: "tech@wilglobo.com", subject, html }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { sent: false, reason: "email_send_failed", error: data.message || res.status };
    return { sent: true, id: data.id };
  } catch (e) {
    return { sent: false, reason: "email_send_failed", error: String(e) };
  }
}

async function sendSms(to, body) {
  const key = process.env.TECHCARE_SMS_KEY;
  if (!key) return { sent: false, reason: "sms_not_configured" };
  const url = process.env.TECHCARE_SMS_WEBHOOK_URL || SMS_WEBHOOK_DEFAULT;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-techcare-key": key, "User-Agent": BROWSER_UA },
      body: JSON.stringify({ to, body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return { sent: false, reason: "sms_send_failed", error: data.error || res.status };
    return { sent: true, sid: data.sid };
  } catch (e) {
    return { sent: false, reason: "sms_send_failed", error: String(e) };
  }
}

// Build the pack for one person. Pure apart from nothing — returns
// everything the sender branches need.
function buildPack(personFields, kind, policies, recordId) {
  const f = personFields || {};
  const aud = kind === "worker" ? "Worker" : "Client";
  const firstGate = kind === "worker" ? "First dispatch (worker)" : "First job (client)";
  const signed = String(f.Signed_Codes || "").split(",").map((s) => s.trim()).filter(Boolean);
  const track = String(f.Engagement_Track || "");
  const mine = policies.filter((p) => {
    const pf = p.fields || {};
    const audiences = Array.isArray(pf.Audience) ? pf.Audience : [pf.Audience];
    if (!audiences.includes(aud)) return false;
    if (kind === "worker") {
      if (track.startsWith("Casual") && pf.Policy_Code === "WK-AGREEMENT") return false;
      if (!track.startsWith("Casual") && pf.Policy_Code === "WK-CASUAL") return false;
    }
    return true;
  });
  const required = mine.filter((p) => (p.fields || {}).Required_Before === firstGate && !signed.includes((p.fields || {}).Policy_Code));
  const optional = mine.filter((p) => (p.fields || {}).Required_Before === "Specific services only" && !signed.includes((p.fields || {}).Policy_Code));

  let signCode = String(f.Sign_Code || "").trim().toLowerCase();
  if (!CODE_RE.test(signCode)) signCode = crypto.randomBytes(16).toString("hex");

  const name = kind === "worker" ? f.Full_Name || "" : f.Client_Name || "";
  const first = name.trim().split(/\s+/)[0] || "there";
  const email = String(f.Email || "").trim();
  const phone = e164(kind === "worker" ? f.Phone_E164 || f.Phone : f.Phone);

  const links = (p) => {
    const code = (p.fields || {}).Policy_Code;
    return {
      code,
      sign: `${PORTAL}/sign?doc=${encodeURIComponent(code)}&who=${recordId}&kind=${kind}&c=${signCode}`,
      read: `${PORTAL}/doc?code=${encodeURIComponent(code)}&who=${recordId}&kind=${kind}&c=${signCode}`,
    };
  };

  const card = (p) => {
    const pf = p.fields || {};
    const l = links(p);
    return `<div style="border:1px solid #d5dde8;border-radius:10px;padding:14px;margin:0 0 12px"><div style="font-weight:bold">${esc(pf.Policy_Name || l.code)}</div><div style="color:#66717d;font-size:13px">${esc(l.code)} · version ${esc(pf.Version || "")}</div><p style="margin:10px 0 0"><a href="${esc(l.read)}" style="display:inline-block;padding:10px 18px;border:1px solid #0b6fd6;border-radius:6px;color:#0b6fd6;text-decoration:none;font-weight:bold">Read it</a> <a href="${esc(l.sign)}" style="display:inline-block;padding:10px 18px;border-radius:6px;color:#fff;background:#0071e3;text-decoration:none;font-weight:bold">Sign it</a></p></div>`;
  };

  const heading = kind === "worker" ? "Please sign before your first job" : "Please sign before your visit";
  const subject = kind === "worker" ? "Your WilGlobo documents to sign before your first job" : "Your TechCare forms to sign before your visit";
  let html = `<div style="max-width:620px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#1b2533">` +
    `<img src="${LOGO_URL}" alt="TechCare by WilGlobo" height="44" style="height:44px;display:block;border:0;margin-bottom:14px">` +
    `<h1 style="font-size:22px;color:#0b1e33">${esc(heading)}</h1>` +
    `<p>Hi ${esc(first)},</p>` +
    (kind === "worker"
      ? `<p>Before your first job, please read and sign the documents below. Each one takes a couple of minutes. Typing your name on the form is your signature.</p>`
      : `<p>Before your visit, please read and sign the forms below. Each one takes a couple of minutes. Typing your name on the form is your signature.</p>`);
  if (!required.length) {
    html += `<p>Everything required is already signed. Thank you.</p>`;
  } else {
    html += `<h2 style="font-size:17px">To sign</h2>` + required.map(card).join("");
  }
  if (optional.length) {
    html += `<h2 style="font-size:17px">Only if it applies to you</h2>` + optional.map(card).join("");
  }
  html += `<p style="color:#66717d;font-size:13px;border-top:1px solid #d5dde8;padding-top:10px;margin-top:18px">WilGlobo Inc., operating as TechCare by WilGlobo · 105 26 Ave SW, Calgary, AB · tech@wilglobo.com · 403-679-3039</p></div>`;

  let smsBody = "";
  if (required.length) {
    const lines = required.slice(0, 3).map((p) => `${(p.fields || {}).Policy_Name || (p.fields || {}).Policy_Code}: ${links(p).read}`);
    smsBody = `Hi ${first}, TechCare by WilGlobo has ${required.length} form(s) to sign before your ${kind === "worker" ? "first job" : "visit"}:\n` + lines.join("\n");
    if (required.length > 3) smsBody += `\n+${required.length - 3} more — check your email or call 403-679-3039.`;
    smsBody += `\nQuestions? Call 403-679-3039`;
  }

  return { kind, recordId, name, email, phone, html, smsBody, signCode, requiredCount: required.length, subject };
}

async function fetchPolicies(key) {
  return listAll(POLICIES_TABLE, ["Policy_Code", "Policy_Name", "Version", "Audience", "Required_Before"], "AND({Requires_Signature},{Status}!='Retired')", key);
}

// Sends one person's pack and unticks their record. Returns a summary.
async function sendPackFor(record, kind, policies, keys) {
  const { readKey, writeKey } = keys;
  const pack = buildPack(record.fields, kind, policies, record.id);
  const tableId = kind === "worker" ? DIRECTORY_TABLE : CLIENTS_TABLE;
  let channel = "none";
  let sentOk = false;

  if (pack.email.includes("@") && pack.requiredCount > 0) {
    const r = await sendEmail({ to: pack.email, subject: pack.subject, html: pack.html });
    channel = "email";
    sentOk = r.sent;
    if (!r.sent) console.error("signpack email failed:", r);
  } else if (pack.phone && pack.requiredCount > 0) {
    const r = await sendSms(pack.phone, pack.smsBody);
    channel = "sms";
    sentOk = r.sent;
    if (!r.sent) console.error("signpack sms failed:", r);
  } else {
    const why = pack.requiredCount === 0
      ? "Everything required is already signed, so no email or text went out."
      : "There is no email address or phone number on the record. Add one, then tick Send_Sign_Pack again.";
    await sendEmail({
      to: WILTON,
      subject: `Sign pack not sent to ${pack.name || pack.recordId}`,
      html: `<div style="font-family:Arial,sans-serif;font-size:15px"><p>${esc(why)}</p><p>Record: ${esc(pack.name || "")} (${esc(pack.recordId)}, ${esc(kind)})</p></div>`,
      from: "TechCare by WilGlobo Records <tech@wilglobo.com>",
    }).catch(() => {});
  }

  const untick = {
    Send_Sign_Pack: false,
    Sign_Code: pack.signCode,
    Sign_Pack_Sent_At: channel === "email" && sentOk ? new Date().toISOString() : "",
  };
  await airtable("PATCH", `/${tableId}/${record.id}`, writeKey, { fields: untick, typecast: true });
  return { recordId: record.id, kind, channel, sentOk, requiredCount: pack.requiredCount };
}

async function runSignPackSweep() {
  const readKey = process.env.AIRTABLE_API_KEY;
  const writeKey = process.env.AIRTABLE_WRITE_KEY || process.env.AIRTABLE_API_KEY;
  if (!readKey) throw new Error("AIRTABLE_API_KEY is not set.");
  const policies = await fetchPolicies(readKey);
  const [clients, workers] = await Promise.all([
    listAll(CLIENTS_TABLE, ["Client_Name", "Email", "Phone", "Signed_Codes", "Sign_Code"], "{Send_Sign_Pack}=TRUE()", readKey),
    listAll(DIRECTORY_TABLE, ["Full_Name", "Email", "Phone_E164", "Signed_Codes", "Sign_Code", "Engagement_Track"], "{Send_Sign_Pack}=TRUE()", readKey),
  ]);
  const results = [];
  for (const rec of clients) results.push(await sendPackFor(rec, "client", policies, { readKey, writeKey }));
  for (const rec of workers) results.push(await sendPackFor(rec, "worker", policies, { readKey, writeKey }));
  return { processed: results.length, results };
}

module.exports = { runSignPackSweep, sendPackFor, fetchPolicies, buildPack, _test: { e164 } };
