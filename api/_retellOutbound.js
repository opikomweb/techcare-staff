// Retell outbound-call pipeline — post-call analysis handling for the
// "WilGlobo Outbound — Ops Handled" agent (agent_8c43677b40315e9065008f6337).
// Spec: goals/ops-handled-launch/files/outbound-calling/interest-alerts.md
//
// One entry point, handleAnalyzedCall(payload, opts), used by:
//   - api/retell-outbound.js        (the live call_analyzed webhook)
//   - api/cron/oneshot-retell-selftest.js (one-off end-to-end proof)
//
// Routing (per spec):
//   do_not_call outcome OR do_not_call_flag → suppression write FIRST;
//     no alert, no prospect text, ever.
//   booked_link / booked_callback / hot_price_question /
//   callback_requested / info_requested → owner SMS + owner email.
//   booked_link / booked_callback (+ a captured mobile) → prospect
//     follow-up text through the guarded path in api/_sms.js.
//   EVERY analyzed call → a log row.
//
// Stores (two layers, first success wins per write; both are attempted
// for the log so nothing depends on one system):
//   1. Airtable base appBiAKY6ivoImcaQ, tables "Outbound_Calls" and
//      "Do_Not_Call" — the intended system of record. The tables do not
//      exist yet (the Muse connector token has no schema scope, so
//      they are a go-live checkbox for the owner: exact field list in
//      the outbound-calling README). Until they exist, Airtable writes
//      fail soft and layer 2 carries the record.
//   2. Portal-side fallback: staff.audit_log in the staff Supabase DB
//      (action "retell.call_analyzed" / "retell.do_not_call",
//      entity_id = call_id / phone). This is also the idempotency and
//      already-ran marker store, and the DNC read source until the
//      Airtable table exists.
//
// Secrets come only from env: RETELL_WEBHOOK_API_KEY (Retell's
// webhook-designated API key — signs webhooks), TWILIO_* via _sms.js,
// RESEND_API_KEY, AIRTABLE_* — same names the portal already uses.
const crypto = require("crypto");
const { validateSms, sendSms, workerPhoneE164 } = require("./_sms");

const BASE_ID = "appBiAKY6ivoImcaQ";
const CALLS_TABLE = "Outbound_Calls";
const DNC_TABLE = "Do_Not_Call";
const OWNER_MOBILE = "+18259626061";
const OWNER_EMAIL = "wilton@wilglobo.com";
const BOOKING_LINK =
  "https://calendar.google.com/calendar/u/0/appointments/schedules/AcZssZ0T0pEaBkmhSA8V2SoQxDkoD5UZuZRWhsxSukGDOEaV4jpQ5ptplsBheejNfEix6SfpMV1cUZOI";

const ALERT_OUTCOMES = new Set([
  "booked_link",
  "booked_callback",
  "hot_price_question",
  "callback_requested",
  "info_requested",
]);
const PROSPECT_TEXT_OUTCOMES = new Set(["booked_link", "booked_callback"]);

// ---------- Retell webhook signature (docs.retellai.com/features/secure-webhook)
// Header: X-Retell-Signature: v=<unix ms>,d=<hex hmac-sha256>
// digest = HMAC_SHA256(key = webhook API key, message = rawBody + timestamp)
// Timestamp must be within 5 minutes. Compare in constant time.
function verifyRetellSignature(rawBody, header, apiKey) {
  if (!apiKey || !header) return false;
  const m = /^v=(\d+),d=([0-9a-fA-F]+)$/.exec(String(header).trim());
  if (!m) return false;
  const ts = Number(m[1]);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 5 * 60 * 1000) return false;
  const expected = crypto
    .createHmac("sha256", apiKey)
    .update(String(rawBody) + m[1])
    .digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(m[2].toLowerCase(), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- payload shaping ----------
// Normalises a call_analyzed webhook payload (or the self-test's fake
// one — same shape) into the flat record every consumer below uses.
function parseAnalyzedCall(payload) {
  const call = (payload && payload.call) || {};
  const analysis = call.call_analysis || {};
  const custom = analysis.custom_analysis_data || {};
  const vars = call.retell_llm_dynamic_variables || call.metadata || {};
  const str = (v) => (v === undefined || v === null ? "" : String(v).trim());
  return {
    event: str(payload && payload.event) || "call_analyzed",
    callId: str(call.call_id),
    agentId: str(call.agent_id),
    toNumber: workerPhoneE164(call.to_number) || str(call.to_number),
    fromNumber: str(call.from_number),
    durationMs: Number(call.duration_ms) || 0,
    recordingUrl: str(call.recording_url),
    transcript: str(call.transcript),
    outcome: str(custom.call_outcome),
    prospectName: str(custom.prospect_name),
    callbackMobile: workerPhoneE164(custom.callback_mobile),
    preferredWindow: str(custom.preferred_window),
    interestSummary: str(custom.interest_summary),
    doNotCall: custom.do_not_call_flag === true || str(custom.call_outcome) === "do_not_call",
    businessName: str(vars.business_name),
    trade: str(vars.trade),
    city: str(vars.city),
    sheetRef: str(vars.sheet_ref),
  };
}

// ---------- Airtable (portal keys; fails soft by design) ----------
function airtableKeys() {
  return {
    readKey: process.env.AIRTABLE_API_KEY,
    writeKey: process.env.AIRTABLE_WRITE_KEY || process.env.AIRTABLE_API_KEY,
  };
}

async function airtableCreate(table, fields) {
  const { writeKey } = airtableKeys();
  if (!writeKey) return { ok: false, reason: "airtable_not_configured" };
  try {
    const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${writeKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ records: [{ fields }], typecast: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, reason: "airtable_write_failed", status: res.status, error: (data.error && data.error.type) || "" };
    }
    return { ok: true, id: data.records && data.records[0] && data.records[0].id };
  } catch (e) {
    return { ok: false, reason: "airtable_write_failed", error: String(e) };
  }
}

async function airtableFind(table, formula) {
  const { readKey } = airtableKeys();
  if (!readKey) return { ok: false, reason: "airtable_not_configured" };
  try {
    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}?maxRecords=1&filterByFormula=${encodeURIComponent(formula)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${readKey}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, reason: "airtable_read_failed", status: res.status };
    return { ok: true, found: (data.records || []).length > 0, record: (data.records || [])[0] || null };
  } catch (e) {
    return { ok: false, reason: "airtable_read_failed", error: String(e) };
  }
}

// ---------- staff DB fallback store (staff.audit_log) ----------
async function auditInsert({ action, entityId, detail }) {
  try {
    const { getStaffPool } = require("./_staffAuth");
    const db = getStaffPool();
    await db.query(
      `insert into staff.audit_log (actor_person_id, actor_email, action, entity_type, entity_id, detail)
       values (NULL, $1, $2, 'retell_outbound_call', $3, $4)`,
      ["retell-webhook@wilglobo.com", action, entityId != null ? String(entityId) : null, JSON.stringify(detail || {})]
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "audit_insert_failed", error: String(e && e.message ? e.message : e) };
  }
}

async function auditFind(action, entityId) {
  try {
    const { getStaffPool } = require("./_staffAuth");
    const db = getStaffPool();
    const { rows } = await db.query(
      `select id, detail from staff.audit_log where action = $1 and entity_id = $2 order by id desc limit 1`,
      [action, String(entityId)]
    );
    return { ok: true, found: rows.length > 0, detail: rows.length ? rows[0].detail : null };
  } catch (e) {
    return { ok: false, reason: "audit_read_failed", error: String(e && e.message ? e.message : e) };
  }
}

// ---------- call log ----------
async function logCall(rec, extras) {
  const fields = {
    Call_ID: rec.callId,
    Outcome: rec.outcome,
    Business_Name: rec.businessName,
    Trade: rec.trade,
    City: rec.city,
    Sheet_Ref: rec.sheetRef,
    To_Number: rec.toNumber,
    From_Number: rec.fromNumber,
    Prospect_Name: rec.prospectName,
    Callback_Mobile: rec.callbackMobile,
    Preferred_Window: rec.preferredWindow,
    Interest_Summary: rec.interestSummary,
    Duration_MS: rec.durationMs,
    Recording_URL: rec.recordingUrl,
    Transcript: rec.transcript.slice(0, 50000),
    Do_Not_Call: rec.doNotCall,
    Self_Test: !!rec.selfTest,
    Alert_SMS_SID: extras.alertSmsSid || "",
    Prospect_SMS_SID: extras.prospectSmsSid || "",
    Email_ID: extras.emailId || "",
  };
  const at = await airtableCreate(CALLS_TABLE, fields);
  const audit = await auditInsert({
    action: "retell.call_analyzed",
    entityId: rec.callId,
    detail: { ...fields, airtable: at.ok ? at.id : at.reason },
  });
  return { airtable: at, audit };
}

async function callAlreadyLogged(callId) {
  if (!callId) return false;
  const at = await airtableFind(CALLS_TABLE, `{Call_ID}='${callId.replace(/'/g, "")}'`);
  if (at.ok && at.found) return true;
  const au = await auditFind("retell.call_analyzed", callId);
  return !!(au.ok && au.found);
}

// Self-test guard (used by the one-off cron): "found" / "absent" /
// "unknown" against the audit store ONLY, so the caller can fail
// closed on "unknown" instead of treating a dead store as "absent".
async function selfTestGuard(callId) {
  const au = await auditFind("retell.call_analyzed", callId);
  if (!au.ok) return "unknown";
  return au.found ? "found" : "absent";
}

// Durable started-marker for the self-test: written BEFORE anything
// is sent, so a crashed or repeated run can never send twice.
async function markSelfTestStarted(callId) {
  return auditInsert({
    action: "retell.call_analyzed",
    entityId: callId,
    detail: { selftest_started: true },
  });
}

// ---------- do-not-call store ----------
// Write order matters: this runs BEFORE any alert or follow-up when a
// call flags do-not-call (spec).
async function suppressNumber(rec, reason) {
  const phone = rec.toNumber || rec.callbackMobile;
  if (!phone) return { ok: false, reason: "no_number" };
  const at = await airtableCreate(DNC_TABLE, {
    Phone: phone,
    Business_Name: rec.businessName,
    Source_Call_ID: rec.callId,
    Reason: reason || rec.outcome || "do_not_call",
  });
  const audit = await auditInsert({
    action: "retell.do_not_call",
    entityId: phone,
    detail: { business: rec.businessName, call_id: rec.callId, reason: reason || rec.outcome, airtable: at.ok ? at.id : at.reason },
  });
  return { ok: at.ok || audit.ok, airtable: at, audit };
}

// The documented read the dial flow consults before every batch:
//   GET /api/retell-outbound?dnc_check=+1785...  (x-techcare-key header)
// plus this helper for any server-side caller.
async function isSuppressed(phoneRaw) {
  const phone = workerPhoneE164(phoneRaw);
  if (!phone) return { suppressed: false, reason: "unusable_number" };
  const at = await airtableFind(DNC_TABLE, `{Phone}='${phone}'`);
  if (at.ok && at.found) return { suppressed: true, source: "airtable" };
  const au = await auditFind("retell.do_not_call", phone);
  if (au.ok && au.found) return { suppressed: true, source: "audit_log" };
  return { suppressed: false };
}

// ---------- message composition (spec templates) ----------
function ownerSmsBody(rec, selfTest) {
  const head = `WilGlobo outbound: ${rec.outcome} — ${rec.businessName || "Unknown business"} (${rec.trade || "trade"}, ${rec.city || "city"}).`;
  const who = `${rec.prospectName || "—"} · ${rec.callbackMobile || "no mobile"} · ${rec.preferredWindow || "no window"}`;
  let summary = rec.interestSummary || "";
  let body = `${head}\n${who}\n${summary}\nRecording: ${rec.recordingUrl || "n/a"}`;
  // Keep the alert tight (spec: ≤2 segments target). Summary is the
  // only elastic field — trim it first, then drop the recording line.
  while (body.length > 300 && summary.length > 0) {
    summary = summary.slice(0, Math.max(0, summary.length - 20));
    body = `${head}\n${who}\n${summary}\nRecording: ${rec.recordingUrl || "n/a"}`;
  }
  if (body.length > 300) body = `${head}\n${who}\n${summary}`.slice(0, 300);
  return selfTest ? `[SELF-TEST] ${body}` : body;
}

// The guarded path caps bodies at 320 chars (api/_sms.js) and the
// booking URL alone is 141 of them, so each template is a ladder of
// progressively shorter variants of the spec copy — first that fits
// wins, and the STOP line is never the thing trimmed.
function prospectSmsBody(rec) {
  const stop = " Reply STOP to opt out.";
  const name = rec.prospectName || "there";
  const variants =
    rec.outcome === "booked_callback"
      ? [
          `Hi ${name}, WilGlobo here — confirming Wilton will call you back ${rec.preferredWindow || "at the time you picked"} at this number. If you'd rather grab a slot yourself: ${BOOKING_LINK}`,
          `Hi ${name}, WilGlobo here — confirming Wilton will call you back at the agreed time. If you'd rather grab a slot yourself: ${BOOKING_LINK}`,
          `Hi ${name}, WilGlobo here — Wilton will call you back at the agreed time. Or book a slot: ${BOOKING_LINK}`,
        ]
      : [
          `Hi ${name}, WilGlobo here — thanks for the chat. Here's the booking link for the free 20-min call with Wilton: ${BOOKING_LINK} — pick any time that suits.`,
          `Hi ${name}, WilGlobo here — thanks for the chat. Here's the booking link for the free 20-min call with Wilton: ${BOOKING_LINK}`,
          `Hi ${name}, WilGlobo here — your booking link for the free 20-min call with Wilton: ${BOOKING_LINK}`,
        ];
  for (const core of variants) {
    if ((core + stop).length <= 320) return core + stop;
  }
  const last = variants[variants.length - 1];
  return last.slice(0, 320 - stop.length) + stop;
}

function esc(s) {
  return String(s === undefined || s === null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ownerEmail(rec, selfTest, proof) {
  const subject = `${selfTest ? "[SELF-TEST] " : ""}[Outbound] ${rec.outcome} — ${rec.businessName || "Unknown business"} (${rec.city || ""})`;
  const next =
    rec.outcome === "booked_callback"
      ? `Call them at ${rec.preferredWindow || "the agreed window"}.`
      : rec.outcome === "booked_link"
        ? "Booking link texted to the prospect — watch for their slot pick."
        : rec.outcome === "callback_requested"
          ? `Call them back${rec.preferredWindow ? ` — they suggested: ${rec.preferredWindow}` : ""}.`
          : "Review and decide the follow-up.";
  const rows = [
    ["Outcome", rec.outcome],
    ["Business", `${rec.businessName} (${rec.trade}, ${rec.city})`],
    ["Number dialed", rec.toNumber],
    ["Reached", rec.prospectName || "—"],
    ["Mobile captured", rec.callbackMobile || "—"],
    ["Window agreed", rec.preferredWindow || "—"],
    ["Interest summary", rec.interestSummary || "—"],
    ["Duration", rec.durationMs ? `${Math.round(rec.durationMs / 1000)}s` : "—"],
    ["Recording", rec.recordingUrl || "—"],
    ["Next action", next],
  ];
  let html = '<div style="font-family:Arial,sans-serif;font-size:15px">';
  html += `<p><b>${esc(rec.outcome)}</b> — outbound call result</p><ul>`;
  for (const [k, v] of rows) html += `<li><b>${esc(k)}:</b> ${esc(v)}</li>`;
  html += "</ul>";
  if (proof) {
    html += `<p><b>Self-test delivery proof:</b><br>Owner SMS SID: ${esc(proof.alertSmsSid || "—")}<br>Prospect SMS SID: ${esc(proof.prospectSmsSid || "—")}<br>Call log store: ${esc(proof.logStore || "—")}</p>`;
  }
  html += `<p><b>Transcript:</b><br>${esc(rec.transcript || "—").replace(/\n/g, "<br>")}</p>`;
  html += "</div>";
  return { subject, html };
}

// Resend — the portal's existing email transport (api/_dispatch.js
// pattern). From defaults to the portal's proven sender.
async function sendAlertEmail({ subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false, reason: "email_not_configured" };
  const from = process.env.RESEND_FROM || "WilGlobo Outbound <tech@wilglobo.com>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [OWNER_EMAIL], subject, html }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { sent: false, reason: "email_send_failed", error: data.message || res.status };
    return { sent: true, id: data.id };
  } catch (e) {
    return { sent: false, reason: "email_send_failed", error: String(e) };
  }
}

// ---------- the pipeline ----------
// opts: { selfTest: bool } — self-test runs the identical chain with a
// fake payload; every send still goes only where the payload points
// (the owner's own cell in both roles, per the test protocol).
async function handleAnalyzedCall(payload, opts = {}) {
  const rec = parseAnalyzedCall(payload);
  rec.selfTest = !!opts.selfTest;
  const result = { call_id: rec.callId, outcome: rec.outcome, steps: {} };

  // Suppression first — before anything else (spec).
  if (rec.doNotCall) {
    result.steps.suppression = await suppressNumber(rec);
  }

  // Idempotency: Retell retries webhooks up to 3 times.
  if (!opts.selfTest && rec.callId && (await callAlreadyLogged(rec.callId))) {
    result.duplicate = true;
    return result;
  }

  // Owner alert + prospect text run first so their SIDs land in the log.
  const extras = {};
  if (!rec.doNotCall && ALERT_OUTCOMES.has(rec.outcome)) {
    // Owner SMS: internal notification to the owner himself — sent via
    // the raw sender in _sms.js (same Twilio creds/number). The guarded
    // validateSms path is for prospect/client texts; the prospect text
    // below goes through it in full.
    try {
      const { sid } = await sendSms(OWNER_MOBILE, ownerSmsBody(rec, rec.selfTest));
      extras.alertSmsSid = sid;
      result.steps.owner_sms = { ok: true, sid };
    } catch (e) {
      result.steps.owner_sms = { ok: false, error: e.code || String(e) };
    }
    // Normal mode: email now. Self-test mode: the email goes last
    // (after the log write) because it carries the delivery proof.
    if (!rec.selfTest) {
      const mail = ownerEmail(rec, false, null);
      const sent = await sendAlertEmail(mail);
      extras.emailId = sent.sent ? sent.id : "";
      result.steps.owner_email = sent.sent ? { ok: true, id: sent.id } : { ok: false, reason: sent.reason };
    }
  }

  if (!rec.doNotCall && PROSPECT_TEXT_OUTCOMES.has(rec.outcome) && rec.callbackMobile) {
    const v = validateSms(rec.callbackMobile, prospectSmsBody(rec));
    if (!v.valid) {
      result.steps.prospect_sms = { ok: false, error: v.error };
    } else {
      try {
        const { sid } = await sendSms(v.to, v.body);
        extras.prospectSmsSid = sid;
        result.steps.prospect_sms = { ok: true, sid };
      } catch (e) {
        result.steps.prospect_sms = { ok: false, error: e.code || String(e) };
      }
    }
  } else if (PROSPECT_TEXT_OUTCOMES.has(rec.outcome)) {
    result.steps.prospect_sms = { ok: false, error: rec.doNotCall ? "suppressed" : "no_mobile_captured" };
  }

  // Log every analyzed call, with the delivery IDs attached.
  const log = await logCall(rec, extras);
  result.steps.log = {
    airtable: log.airtable.ok ? log.airtable.id : log.airtable.reason,
    audit: log.audit.ok ? "written" : log.audit.reason,
  };

  // Self-test only: the owner email goes last and carries the delivery
  // proof (both Twilio SIDs + which store took the log row).
  if (rec.selfTest && !rec.doNotCall && ALERT_OUTCOMES.has(rec.outcome)) {
    const proof = {
      alertSmsSid: extras.alertSmsSid || "",
      prospectSmsSid: extras.prospectSmsSid || "",
      logStore: log.airtable.ok ? `Airtable Outbound_Calls (${log.airtable.id})` : log.audit.ok ? "staff.audit_log (fallback)" : "FAILED",
    };
    const mail = ownerEmail(rec, true, proof);
    const sent = await sendAlertEmail(mail);
    result.steps.owner_email = sent.sent ? { ok: true, id: sent.id } : { ok: false, reason: sent.reason };
  }

  return result;
}

module.exports = {
  verifyRetellSignature,
  parseAnalyzedCall,
  handleAnalyzedCall,
  isSuppressed,
  suppressNumber,
  callAlreadyLogged,
  selfTestGuard,
  markSelfTestStarted,
  ownerSmsBody,
  prospectSmsBody,
  BOOKING_LINK,
  ALERT_OUTCOMES,
};
