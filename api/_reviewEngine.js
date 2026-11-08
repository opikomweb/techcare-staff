// Review Engine + Google Profile Care — post-job review asks,
// review watching with owner-approved AI-drafted replies, weekly
// Google Business Profile posts, and a monthly one-page report.
// Product: $149/mo CAD standalone, $99/mo bundled with an Ops
// Handled / Salon retainer (spec: goals/ops-handled-launch/files/
// review-engine/README.md; Candidate #3 in the Oct 29 opportunities
// report).
//
// The loop:
//   1. A job completes → the customer gets ONE thank-you text with
//      the business's real Google review link. Every customer gets
//      the identical ask — no sentiment filtering, no gating, no
//      incentives (Google policy, non-negotiable). One gentle
//      reminder at +3 days, and only if no review has been detected
//      for the business since the ask. STOP is honoured forever.
//   2. A new review is detected (GBP API poll when a per-client
//      token is provisioned in env, else manual entry) → an AI or
//      template draft reply is written and the OWNER approves it
//      from a one-tap SMS link. Nothing ever auto-posts. Approve →
//      posted via the GBP API when connected; otherwise the final
//      text is texted back to the owner to paste under the review.
//   3. Weekly: one GBP post draft per client (service spotlight /
//      seasonal / review highlight — the Content Engine's rotating
//      patterns), same one-tap approval, same posting rule.
//   4. Monthly: a one-page report (asks sent, reviews, rating
//      trend, replies, posts). Profile views/actions are shown ONLY
//      when API data exists — otherwise the report says "not
//      connected". Numbers are never invented.
//
// Stores (same two-layer pattern as api/_shield.js — Airtable first
// as the intended system of record, staff.audit_log fallback; the
// connector token has no schema scope, so the tables are a go-live
// checkbox and the audit log carries everything until they exist):
//   Review_Engine_Clients / _Asks / _Reviews / _Posts / _Reports
//   Audit actions: review.config / review.ask / review.review /
//   review.post / review.report / review.optout / review.optin.
//
// Credentials: NONE are stored. GBP API access is provisioned per
// client as an env var (GBP_ACCESS_TOKEN_<CLIENT_KEY>) by ops —
// config rows hold only the public location resource name. Secrets
// come only from env: TWILIO_* via _sms.js, AIRTABLE_*,
// TECHCARE_SMS_KEY (portal internal key + approve-link signing
// fallback), REVIEW_ENGINE_LINK_SECRET, REVIEW_AI_* via
// _reviewAi.js, RESEND_API_KEY.
const crypto = require("crypto");
const { validateSms, sendSms, workerPhoneE164 } = require("./_sms");
const { draftReviewReply, draftGbpPost, firstNameOf } = require("./_reviewAi");

const BASE_ID = "appBiAKY6ivoImcaQ";
const CLIENTS_TABLE = "Review_Engine_Clients";
const ASKS_TABLE = "Review_Engine_Asks";
const REVIEWS_TABLE = "Review_Engine_Reviews";
const POSTS_TABLE = "Review_Engine_Posts";
const REPORTS_TABLE = "Review_Engine_Reports";

const PORTAL_BASE = process.env.PORTAL_BASE_URL || "https://staff.wilglobo.com";
const DEFAULT_TIMEZONE = "America/Edmonton";
// The ask invites an honest review from EVERY customer, worded the
// same for all — deliberately not "if we did a good job" (that
// phrasing edges toward selective solicitation; see README).
const DEFAULT_ASK_TEMPLATE =
  "Hi {first} — thanks for choosing {business}! How did we do? A quick Google review helps neighbours find us and helps us get better: {link} Reply STOP to opt out.";
const DEFAULT_REMINDER_TEMPLATE =
  "Hi {first} — a gentle nudge from {business}: if you have 60 seconds, a Google review would mean a lot to us: {link} Reply STOP to opt out.";
const DEFAULT_REMINDER_DAYS = 3;
const DEFAULT_POST_WEEKDAY = 1; // Monday (0 = Sunday)
const DEFAULT_POST_HOUR = "09";
const LINK_TTL_MS = 14 * 24 * 3600 * 1000;

// ---------- small helpers ----------
const str = (v) => (v === undefined || v === null ? "" : String(v).trim());
const bool = (v) => v === true || v === "true" || v === "Yes" || v === 1 || v === "1";
const escFormula = (v) => String(v).replace(/'/g, "");

function localParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || DEFAULT_TIMEZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
  });
  const parts = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  return parts;
}
function localDateString(date, timeZone) {
  const p = localParts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}
function localMonthString(date, timeZone) {
  return localDateString(date, timeZone).slice(0, 7);
}
function localHourString(date, timeZone) {
  return localParts(date, timeZone).hour;
}
// Monday (YYYY-MM-DD, client-local) of the week containing `date`,
// plus a week index for rotation.
function localWeek(date, timeZone) {
  const p = localParts(date, timeZone);
  const d = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)));
  const dow = d.getUTCDay(); // 0 = Sunday
  const monday = new Date(d.getTime() - ((dow + 6) % 7) * 24 * 3600 * 1000);
  const iso = monday.toISOString().slice(0, 10);
  return { monday: iso, dow, weekIndex: Math.floor(monday.getTime() / (7 * 24 * 3600 * 1000)) };
}
function prevMonthOf(month) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 7);
}
function sha1(s) {
  return crypto.createHash("sha1").update(String(s)).digest("hex").slice(0, 16);
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
    if (!res.ok) return { ok: false, reason: "airtable_write_failed", status: res.status, error: (data.error && data.error.type) || "" };
    return { ok: true, id: data.records && data.records[0] && data.records[0].id };
  } catch (e) {
    return { ok: false, reason: "airtable_write_failed", error: String(e) };
  }
}

async function airtableList(table, formula, maxRecords) {
  const { readKey } = airtableKeys();
  if (!readKey) return { ok: false, reason: "airtable_not_configured", records: [] };
  try {
    const params = new URLSearchParams();
    params.set("pageSize", String(Math.min(maxRecords || 100, 100)));
    if (formula) params.set("filterByFormula", formula);
    const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}?${params}`, {
      headers: { Authorization: `Bearer ${readKey}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, reason: "airtable_read_failed", status: res.status, records: [] };
    return { ok: true, records: data.records || [] };
  } catch (e) {
    return { ok: false, reason: "airtable_read_failed", error: String(e), records: [] };
  }
}

async function airtablePatchByKey(table, keyField, keyValue, fields) {
  const found = await airtableList(table, `{${keyField}}='${escFormula(keyValue)}'`, 1);
  if (!found.ok || !found.records.length) return { ok: false, reason: found.ok ? "not_found" : found.reason };
  const { writeKey } = airtableKeys();
  try {
    const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}/${found.records[0].id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${writeKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields, typecast: true }),
    });
    if (!res.ok) return { ok: false, reason: "airtable_write_failed", status: res.status };
    return { ok: true, id: found.records[0].id };
  } catch (e) {
    return { ok: false, reason: "airtable_write_failed", error: String(e) };
  }
}

// Snapshot save: patch-or-create in Airtable + always write the
// audit snapshot (the fallback store, and the read source until the
// tables exist). Latest snapshot per key wins on read.
async function saveSnapshot({ table, keyField, keyValue, fields, auditAction, snapshot }) {
  const patched = await airtablePatchByKey(table, keyField, keyValue, fields);
  let at = patched;
  if (!patched.ok && patched.reason === "not_found") at = await airtableCreate(table, fields);
  const audit = await auditInsert({ action: auditAction, entityId: keyValue, detail: snapshot });
  return { airtable: at.ok ? "ok" : at.reason, audit: audit.ok ? "written" : audit.reason };
}

// Latest audit snapshot per entity for one action, optionally
// filtered by detail.client_key. Map key = entity_id.
async function latestSnapshots(auditAction, clientKey, limit) {
  const res = await auditList(auditAction, null, limit || 500);
  const byKey = new Map();
  if (!res.ok) return byKey;
  for (const row of res.rows) {
    if (!row.entity_id || byKey.has(row.entity_id)) continue;
    if (clientKey && row.detail && row.detail.client_key !== clientKey) continue;
    byKey.set(row.entity_id, row.detail);
  }
  return byKey;
}

// ---------- staff DB fallback store (staff.audit_log) ----------
function staffDb() {
  const { getStaffPool } = require("./_staffAuth");
  return getStaffPool();
}

async function auditInsert({ action, entityId, detail }) {
  try {
    const db = staffDb();
    await db.query(
      `insert into staff.audit_log (actor_person_id, actor_email, action, entity_type, entity_id, detail)
       values (NULL, $1, $2, 'review_engine', $3, $4)`,
      ["reviews@wilglobo.com", action, entityId != null ? String(entityId) : null, JSON.stringify(detail || {})]
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "audit_insert_failed", error: String(e && e.message ? e.message : e) };
  }
}

async function auditList(action, entityId, limit) {
  try {
    const db = staffDb();
    const sql = entityId != null
      ? `select id, entity_id, detail, created_at from staff.audit_log where action = $1 and entity_id = $2 order by id desc limit $3`
      : `select id, entity_id, detail, created_at from staff.audit_log where action = $1 order by id desc limit $2`;
    const params = entityId != null ? [action, String(entityId), limit || 100] : [action, limit || 100];
    const { rows } = await db.query(sql, params);
    return { ok: true, rows: rows.map((r) => ({ id: r.id, entity_id: r.entity_id, detail: r.detail || {}, created_at: r.created_at })) };
  } catch (e) {
    return { ok: false, reason: "audit_read_failed", error: String(e && e.message ? e.message : e), rows: [] };
  }
}

// ---------- sending ----------
// _sms.sendSms always sends from TWILIO_FROM_NUMBER. Review asks
// come from the client's own number when one is configured (Shield
// pattern), so this is the same direct Twilio REST call with an
// explicit From. The guarded validateSms check still runs before
// every customer-facing send.
async function sendSmsFrom(to, body, fromNumber) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = fromNumber || process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) {
    const err = new Error("Twilio is not configured.");
    err.code = "sms_not_configured";
    throw err;
  }
  const form = new URLSearchParams({ From: from, To: to, Body: body });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Twilio ${res.status}: ${data.message || "send failed"}`);
    err.code = "sms_send_failed";
    throw err;
  }
  return { sid: data.sid, from };
}

// Owner notifications are internal (the _retellOutbound pattern):
// raw sendSms to the business owner's own mobile.
async function notifyOwner(config, body, opts = {}) {
  if (!config.owner_mobile) return { sent: false, reason: "no_owner_mobile" };
  if (opts.dryRun) return { sent: false, dry_run: true, would_send_to: config.owner_mobile, body };
  try {
    const { sid } = await sendSms(config.owner_mobile, body);
    return { sent: true, sid };
  } catch (e) {
    return { sent: false, reason: e.code || "send_failed", error: String(e.message || e) };
  }
}

// ---------- approve-link tokens ----------
// HMAC-signed, expiring links for the owner's one-tap approve page.
// Secret: REVIEW_ENGINE_LINK_SECRET, falling back to the portal's
// internal key. No secret → no link (the draft still waits in the
// admin API; we never emit an unsigned approve URL).
function linkSecret() {
  return process.env.REVIEW_ENGINE_LINK_SECRET || process.env.TECHCARE_SMS_KEY || "";
}
function signToken(payload) {
  const secret = linkSecret();
  if (!secret) return null;
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}
function verifyToken(token) {
  const secret = linkSecret();
  const t = str(token);
  if (!secret || !t.includes(".")) return null;
  const [body, sig] = t.split(".");
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(sig || "", "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch (e) { return null; }
  if (!payload || !payload.key || !payload.exp || Date.now() > payload.exp) return null;
  return payload;
}
function approveLink(kind, key) {
  const token = signToken({ kind, key, exp: Date.now() + LINK_TTL_MS });
  return token ? `${PORTAL_BASE}/review-approve?t=${token}` : null;
}

// ---------- config store ----------
function normalizeConfig(raw) {
  const c = raw || {};
  const servicesRaw = c.services !== undefined ? c.services : c.Services;
  const services = Array.isArray(servicesRaw)
    ? servicesRaw.map(str).filter(Boolean)
    : str(servicesRaw).split(/[;|]/).map((s) => s.trim()).filter(Boolean);
  return {
    client_key: str(c.client_key || c.Client_Key),
    business_name: str(c.business_name || c.Business_Name),
    review_link: str(c.review_link || c.Review_Link),
    owner_name: str(c.owner_name || c.Owner_Name),
    owner_mobile: workerPhoneE164(c.owner_mobile || c.Owner_Mobile) || str(c.owner_mobile || c.Owner_Mobile),
    owner_email: str(c.owner_email || c.Owner_Email),
    from_number: workerPhoneE164(c.from_number || c.From_Number) || str(c.from_number || c.From_Number),
    timezone: str(c.timezone || c.Timezone) || DEFAULT_TIMEZONE,
    ask_template: str(c.ask_template || c.Ask_Template) || DEFAULT_ASK_TEMPLATE,
    reminder_template: str(c.reminder_template || c.Reminder_Template) || DEFAULT_REMINDER_TEMPLATE,
    reminder_days: Number(c.reminder_days !== undefined ? c.reminder_days : c.Reminder_Days) || DEFAULT_REMINDER_DAYS,
    reminder_enabled: c.reminder_enabled === undefined && c.Reminder_Enabled === undefined ? true : bool(c.reminder_enabled !== undefined ? c.reminder_enabled : c.Reminder_Enabled),
    services,
    city: str(c.city || c.City),
    review_highlight: c.review_highlight === undefined && c.Review_Highlight === undefined ? true : bool(c.review_highlight !== undefined ? c.review_highlight : c.Review_Highlight),
    post_weekday: c.post_weekday !== undefined ? Number(c.post_weekday) : c.Post_Weekday !== undefined ? Number(c.Post_Weekday) : DEFAULT_POST_WEEKDAY,
    post_hour: str(c.post_hour || c.Post_Hour) || DEFAULT_POST_HOUR,
    gbp_location: str(c.gbp_location || c.Gbp_Location),
    active: c.active === undefined && c.Active === undefined ? true : bool(c.active !== undefined ? c.active : c.Active),
  };
}

function configToAirtableFields(c) {
  return {
    Client_Key: c.client_key,
    Business_Name: c.business_name,
    Review_Link: c.review_link,
    Owner_Name: c.owner_name,
    Owner_Mobile: c.owner_mobile,
    Owner_Email: c.owner_email,
    From_Number: c.from_number,
    Timezone: c.timezone,
    Ask_Template: c.ask_template,
    Reminder_Template: c.reminder_template,
    Reminder_Days: c.reminder_days,
    Reminder_Enabled: c.reminder_enabled,
    Services: c.services.join("; "),
    City: c.city,
    Review_Highlight: c.review_highlight,
    Post_Weekday: c.post_weekday,
    Post_Hour: c.post_hour,
    Gbp_Location: c.gbp_location,
    Active: c.active,
  };
}

async function configsFromAudit() {
  const byKey = await latestSnapshots("review.config", null, 200);
  return [...byKey.values()].map((d) => normalizeConfig(d));
}

async function listConfigs() {
  const at = await airtableList(CLIENTS_TABLE, null, 100);
  if (at.ok && at.records.length) return at.records.map((r) => normalizeConfig(r.fields));
  return configsFromAudit();
}

async function getConfigByKey(clientKey) {
  const key = str(clientKey);
  if (!key) return null;
  const at = await airtableList(CLIENTS_TABLE, `{Client_Key}='${escFormula(key)}'`, 1);
  if (at.ok && at.records.length) return normalizeConfig(at.records[0].fields);
  const all = await configsFromAudit();
  return all.find((c) => c.client_key === key) || null;
}

function renderAsk(config, customerName) {
  return String(config.ask_template || DEFAULT_ASK_TEMPLATE)
    .replace(/\{first\}/gi, firstNameOf(customerName) || "there")
    .replace(/\{business\}/gi, config.business_name || "us")
    .replace(/\{link\}/gi, config.review_link || "");
}
function renderReminder(config, customerName) {
  return String(config.reminder_template || DEFAULT_REMINDER_TEMPLATE)
    .replace(/\{first\}/gi, firstNameOf(customerName) || "there")
    .replace(/\{business\}/gi, config.business_name || "us")
    .replace(/\{link\}/gi, config.review_link || "");
}

async function upsertConfig(input) {
  const c = normalizeConfig(input);
  if (!c.client_key) return { ok: false, error: "client_key is required" };
  if (!c.business_name) return { ok: false, error: "business_name is required" };
  if (!/^https:\/\/\S+$/.test(c.review_link)) return { ok: false, error: "review_link must be the business's real https Google review link" };
  // Validate both customer-facing templates against the guarded SMS
  // rules at save time (Shield pattern) — a config that can never
  // send is rejected now, not at a customer's job completion.
  const probeTo = "+14165550100";
  const askProbe = validateSms(probeTo, renderAsk(c, "Jamie"));
  if (!askProbe.valid) return { ok: false, error: `ask_template fails SMS rules: ${askProbe.error}` };
  const remProbe = validateSms(probeTo, renderReminder(c, "Jamie"));
  if (!remProbe.valid) return { ok: false, error: `reminder_template fails SMS rules: ${remProbe.error}` };
  const saved = await saveSnapshot({
    table: CLIENTS_TABLE, keyField: "Client_Key", keyValue: c.client_key,
    fields: configToAirtableFields(c), auditAction: "review.config", snapshot: c,
  });
  return { ok: true, config: c, stored: saved };
}

// ---------- opt-outs ----------
// A STOP from a customer is recorded per client + number and
// honoured forever (a later START/UNSTOP from the same number is
// the only thing that clears it — latest event wins).
async function recordOptOut(clientKey, mobile, opts = {}) {
  const key = `${clientKey}:${mobile}`;
  const action = opts.optIn ? "review.optin" : "review.optout";
  const out = await auditInsert({ action, entityId: key, detail: { client_key: clientKey, mobile, at: new Date().toISOString(), keyword: opts.keyword || "" } });
  return { ok: out.ok, key };
}
async function isOptedOut(clientKey, mobile) {
  const key = `${clientKey}:${mobile}`;
  const outs = await auditList("review.optout", key, 1);
  if (!outs.ok || !outs.rows.length) return false;
  const ins = await auditList("review.optin", key, 1);
  if (ins.ok && ins.rows.length && ins.rows[0].id > outs.rows[0].id) return false;
  return true;
}

// ---------- asks ----------
function askKeyOf(clientKey, jobRef) {
  return `${clientKey}:${jobRef}`;
}
function normalizeAsk(raw, fallbackKey) {
  const a = raw || {};
  return {
    ask_key: str(a.ask_key || a.Ask_Key) || fallbackKey || "",
    client_key: str(a.client_key || a.Client_Key),
    job_ref: str(a.job_ref || a.Job_Ref),
    customer_name: str(a.customer_name || a.Customer_Name),
    customer_mobile: str(a.customer_mobile || a.Customer_Mobile),
    status: str(a.status || a.Status) || "pending",
    sent_at: str(a.sent_at || a.Sent_At),
    ask_sid: str(a.ask_sid || a.Ask_SID),
    reminded_at: str(a.reminded_at || a.Reminded_At),
    reminder_sid: str(a.reminder_sid || a.Reminder_SID),
    created_at: str(a.created_at || a.Created_At),
  };
}
function askToAirtableFields(a) {
  return {
    Ask_Key: a.ask_key, Client_Key: a.client_key, Job_Ref: a.job_ref,
    Customer_Name: a.customer_name, Customer_Mobile: a.customer_mobile,
    Status: a.status, Sent_At: a.sent_at, Ask_SID: a.ask_sid,
    Reminded_At: a.reminded_at, Reminder_SID: a.reminder_sid, Created_At: a.created_at,
  };
}
async function saveAsk(ask) {
  await saveSnapshot({
    table: ASKS_TABLE, keyField: "Ask_Key", keyValue: ask.ask_key,
    fields: askToAirtableFields(ask), auditAction: "review.ask", snapshot: ask,
  });
  return ask;
}
async function getAsk(askKey) {
  const at = await airtableList(ASKS_TABLE, `{Ask_Key}='${escFormula(askKey)}'`, 1);
  if (at.ok && at.records.length) return normalizeAsk(at.records[0].fields, askKey);
  const rows = await auditList("review.ask", askKey, 1);
  if (rows.ok && rows.rows.length) return normalizeAsk(rows.rows[0].detail, askKey);
  return null;
}
async function listAsks(clientKey, limit) {
  const at = await airtableList(ASKS_TABLE, `{Client_Key}='${escFormula(clientKey)}'`, limit || 100);
  if (at.ok && at.records.length) {
    return at.records.map((r) => normalizeAsk(r.fields)).sort((a, b) => String(b.sent_at || b.created_at).localeCompare(String(a.sent_at || a.created_at)));
  }
  const byKey = await latestSnapshots("review.ask", clientKey, 500);
  return [...byKey.values()].map((d) => normalizeAsk(d)).sort((a, b) => String(b.sent_at || b.created_at).localeCompare(String(a.sent_at || a.created_at)));
}

// The post-job ask. Idempotent per (client, job): the portal can
// fire this from a job-completion hook AND the event can be retried
// — the customer still gets exactly one ask.
async function handleJobCompleted(input, opts = {}) {
  const clientKey = str(input && input.client_key);
  const jobRef = str(input && input.job_ref);
  const result = { client_key: clientKey, job_ref: jobRef, steps: {} };
  if (!clientKey || !jobRef) { result.skipped = "missing_client_or_job"; return result; }
  const config = await getConfigByKey(clientKey);
  if (!config || !config.active) { result.skipped = "no_active_config"; return result; }

  const askKey = askKeyOf(clientKey, jobRef);
  result.ask_key = askKey;
  const existing = await getAsk(askKey);
  if (existing && ["sent", "reminded", "review_detected", "opted_out"].includes(existing.status)) {
    result.steps.ask = { sent: false, reason: "already_asked", status: existing.status };
    return result;
  }

  const mobile = workerPhoneE164(input.customer_mobile) || "";
  const ask = normalizeAsk({
    ask_key: askKey, client_key: clientKey, job_ref: jobRef,
    customer_name: str(input.customer_name), customer_mobile: mobile,
    created_at: new Date().toISOString(),
  }, askKey);

  if (!mobile) {
    ask.status = "skipped_no_mobile";
    await saveAsk(ask);
    result.steps.ask = { sent: false, reason: "no_customer_mobile" };
    return result;
  }
  if (await isOptedOut(clientKey, mobile)) {
    ask.status = "opted_out";
    await saveAsk(ask);
    result.steps.ask = { sent: false, reason: "customer_opted_out" };
    return result;
  }

  const body = renderAsk(config, ask.customer_name);
  const v = validateSms(mobile, body);
  if (!v.valid) {
    ask.status = "failed_validation";
    await saveAsk(ask);
    result.steps.ask = { sent: false, reason: "validate_failed", error: v.error };
    return result;
  }
  if (opts.dryRun) {
    result.steps.ask = { sent: false, dry_run: true, would_send_to: v.to, body: v.body };
    return result;
  }
  try {
    const { sid, from } = await sendSmsFrom(v.to, v.body, config.from_number || undefined);
    ask.status = "sent";
    ask.sent_at = new Date().toISOString();
    ask.ask_sid = sid;
    await saveAsk(ask);
    result.steps.ask = { sent: true, sid, from };
  } catch (e) {
    ask.status = "send_failed";
    await saveAsk(ask);
    result.steps.ask = { sent: false, reason: e.code || "send_failed", error: String(e.message || e) };
  }
  return result;
}

// True when any review for this client was detected after `iso`.
// (Public review data carries no reliable customer identity, so
// detection is at business level: a new review landing soon after
// an ask suppresses that ask's reminder. The conservative failure
// mode is a skipped reminder, never an extra text.)
async function reviewDetectedSince(clientKey, iso) {
  const reviews = await listReviews(clientKey, 100);
  return reviews.some((r) => r.detected_at && String(r.detected_at) > String(iso));
}

// One gentle reminder per ask, at +reminder_days, only when no
// review has been detected since the ask went out.
async function runRemindersForConfig(config, now, opts = {}) {
  const out = { client_key: config.client_key, reminded: 0, detected: 0, skipped: 0 };
  if (!config.reminder_enabled) { out.skipped_reason = "reminders_disabled"; return out; }
  const asks = await listAsks(config.client_key, 200);
  const dueMs = (config.reminder_days || DEFAULT_REMINDER_DAYS) * 24 * 3600 * 1000;
  for (const ask of asks) {
    if (ask.status !== "sent" || !ask.sent_at) continue;
    if (now.getTime() - Date.parse(ask.sent_at) < dueMs) { out.skipped += 1; continue; }
    if (await reviewDetectedSince(config.client_key, ask.sent_at)) {
      ask.status = "review_detected";
      await saveAsk(ask);
      out.detected += 1;
      continue;
    }
    if (await isOptedOut(config.client_key, ask.customer_mobile)) {
      ask.status = "opted_out";
      await saveAsk(ask);
      out.skipped += 1;
      continue;
    }
    const v = validateSms(ask.customer_mobile, renderReminder(config, ask.customer_name));
    if (!v.valid) { out.skipped += 1; continue; }
    if (opts.dryRun) { out.reminded += 1; out.dry_run = true; continue; }
    try {
      const { sid } = await sendSmsFrom(v.to, v.body, config.from_number || undefined);
      ask.status = "reminded";
      ask.reminded_at = now.toISOString();
      ask.reminder_sid = sid;
      await saveAsk(ask);
      out.reminded += 1;
    } catch (e) {
      out.skipped += 1;
    }
  }
  return out;
}

// ---------- reviews ----------
// GBP access is provisioned per client by ops as an env token; the
// config row carries only the public location resource name. No
// credentials are ever stored in Airtable or the audit log.
function gbpTokenFor(config) {
  const envName = `GBP_ACCESS_TOKEN_${String(config.client_key || "").toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  return process.env[envName] || "";
}
function gbpConnected(config) {
  return Boolean(config && config.gbp_location && gbpTokenFor(config));
}

function reviewKeyOf(clientKey, externalId, input) {
  if (externalId) return `${clientKey}:gbp:${sha1(externalId)}`;
  return `${clientKey}:manual:${sha1([input.reviewer_name, input.rating, input.text, input.posted_at || ""].join("|"))}`;
}
function normalizeReview(raw, fallbackKey) {
  const r = raw || {};
  return {
    review_key: str(r.review_key || r.Review_Key) || fallbackKey || "",
    client_key: str(r.client_key || r.Client_Key),
    reviewer_name: str(r.reviewer_name || r.Reviewer_Name),
    rating: Number(r.rating !== undefined ? r.rating : r.Rating) || 0,
    text: str(r.text || r.Text),
    source: str(r.source || r.Source) || "manual",
    external_id: str(r.external_id || r.External_Id),
    posted_at: str(r.posted_at || r.Posted_At),
    detected_at: str(r.detected_at || r.Detected_At),
    status: str(r.status || r.Status) || "new",
    draft_reply: str(r.draft_reply || r.Draft_Reply),
    draft_source: str(r.draft_source || r.Draft_Source),
    final_reply: str(r.final_reply || r.Final_Reply),
    reply_posted_at: str(r.reply_posted_at || r.Reply_Posted_At),
  };
}
function reviewToAirtableFields(r) {
  return {
    Review_Key: r.review_key, Client_Key: r.client_key, Reviewer_Name: r.reviewer_name,
    Rating: r.rating, Text: r.text, Source: r.source, External_Id: r.external_id,
    Posted_At: r.posted_at, Detected_At: r.detected_at, Status: r.status,
    Draft_Reply: r.draft_reply, Draft_Source: r.draft_source,
    Final_Reply: r.final_reply, Reply_Posted_At: r.reply_posted_at,
  };
}
async function saveReview(review) {
  await saveSnapshot({
    table: REVIEWS_TABLE, keyField: "Review_Key", keyValue: review.review_key,
    fields: reviewToAirtableFields(review), auditAction: "review.review", snapshot: review,
  });
  return review;
}
async function getReview(reviewKey) {
  const at = await airtableList(REVIEWS_TABLE, `{Review_Key}='${escFormula(reviewKey)}'`, 1);
  if (at.ok && at.records.length) return normalizeReview(at.records[0].fields, reviewKey);
  const rows = await auditList("review.review", reviewKey, 1);
  if (rows.ok && rows.rows.length) return normalizeReview(rows.rows[0].detail, reviewKey);
  return null;
}
async function listReviews(clientKey, limit) {
  const at = await airtableList(REVIEWS_TABLE, `{Client_Key}='${escFormula(clientKey)}'`, limit || 100);
  if (at.ok && at.records.length) {
    return at.records.map((r) => normalizeReview(r.fields)).sort((a, b) => String(b.detected_at).localeCompare(String(a.detected_at)));
  }
  const byKey = await latestSnapshots("review.review", clientKey, 500);
  return [...byKey.values()].map((d) => normalizeReview(d)).sort((a, b) => String(b.detected_at).localeCompare(String(a.detected_at)));
}

function starsOf(rating) {
  const r = Math.round(Number(rating) || 0);
  return "★".repeat(Math.max(0, Math.min(5, r))) + "☆".repeat(Math.max(0, 5 - r));
}

// Record a newly detected review → draft a reply → notify the
// owner with the one-tap approve link. NOTHING posts here, ever:
// posting happens only inside approveReview, on the owner's action.
async function recordReview(input, opts = {}) {
  const clientKey = str(input && input.client_key);
  const result = { client_key: clientKey, steps: {} };
  const config = await getConfigByKey(clientKey);
  if (!config || !config.active) { result.skipped = "no_active_config"; return result; }

  const externalId = str(input.external_id);
  const reviewKey = reviewKeyOf(clientKey, externalId, input);
  result.review_key = reviewKey;
  const existing = await getReview(reviewKey);
  if (existing) { result.steps.review = { recorded: false, reason: "already_known", status: existing.status }; return result; }

  const review = normalizeReview({
    review_key: reviewKey, client_key: clientKey,
    reviewer_name: str(input.reviewer_name) || "A customer",
    rating: Number(input.rating) || 0,
    text: str(input.text),
    source: str(input.source) || (externalId ? "gbp_api" : "manual"),
    external_id: externalId,
    posted_at: str(input.posted_at),
    detected_at: new Date().toISOString(),
    status: "new",
  }, reviewKey);

  const { draft, source } = await draftReviewReply({
    business_name: config.business_name, reviewer_name: review.reviewer_name,
    rating: review.rating, text: review.text,
    owner_name: config.owner_name, owner_mobile: config.owner_mobile,
    services: config.services,
  }, opts);
  review.draft_reply = draft;
  review.draft_source = source;
  review.status = "draft_ready";
  await saveReview(review);
  result.steps.review = { recorded: true, draft_source: source };

  const link = approveLink("review", reviewKey);
  const snippet = review.text.replace(/\s+/g, " ").slice(0, 110);
  const body =
    `New ${starsOf(review.rating)} review for ${config.business_name} — ${review.reviewer_name}: "${snippet}"\n` +
    `Draft reply is ready${link ? `: approve or edit here ${link}` : " in the portal (Review Engine)"}. Nothing posts until you approve it.`;
  result.steps.owner_notify = await notifyOwner(config, body, opts);
  result.review = review;
  return result;
}

// Poll the GBP API for new reviews — only when this client's token
// has been provisioned in env. Without it this is a clean no-op
// and manual entry (recordReview) is the watcher.
async function pollGbpReviews(config, opts = {}) {
  if (!gbpConnected(config)) return { client_key: config.client_key, connected: false };
  const fetchImpl = opts.fetchImpl || fetch;
  const url = `https://mybusiness.googleapis.com/v4/${config.gbp_location}/reviews?pageSize=50`;
  let data;
  try {
    const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${gbpTokenFor(config)}` } });
    if (!res.ok) return { client_key: config.client_key, connected: true, error: `gbp_http_${res.status}` };
    data = await res.json().catch(() => ({}));
  } catch (e) {
    return { client_key: config.client_key, connected: true, error: String(e && e.message ? e.message : e) };
  }
  const starMap = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
  let added = 0;
  for (const r of data.reviews || []) {
    const out = await recordReview({
      client_key: config.client_key,
      reviewer_name: (r.reviewer && r.reviewer.displayName) || "A customer",
      rating: starMap[r.starRating] || 0,
      text: r.comment || "",
      source: "gbp_api",
      external_id: r.name || "",
      posted_at: r.createTime || "",
    }, opts);
    if (out.steps.review && out.steps.review.recorded) added += 1;
  }
  return { client_key: config.client_key, connected: true, seen: (data.reviews || []).length, added };
}

// Post an approved reply through the GBP API. Only reachable from
// approveReview, only for API-sourced reviews on connected clients.
async function postGbpReply(config, review, comment, opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch;
  const res = await fetchImpl(`https://mybusiness.googleapis.com/v4/${review.external_id}/reply`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${gbpTokenFor(config)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ comment }),
  });
  if (!res.ok) return { posted: false, reason: `gbp_http_${res.status}` };
  return { posted: true };
}

// The owner's tap. Approve (optionally with edited text) → post via
// the API when this review came from a connected profile; otherwise
// mark approved and text the owner the final reply to paste under
// the review themselves. Either way, the owner acted — the engine
// never posts unapproved text.
async function approveReview(reviewKey, opts = {}) {
  const review = await getReview(reviewKey);
  if (!review) return { ok: false, error: "review_not_found" };
  if (review.status === "posted") return { ok: true, already: "posted", review };
  if (review.status === "dismissed") return { ok: false, error: "review_dismissed" };
  const config = await getConfigByKey(review.client_key);
  if (!config) return { ok: false, error: "client_config_not_found" };
  const finalText = str(opts.reply_text) || review.draft_reply;
  if (!finalText) return { ok: false, error: "no_reply_text" };
  review.final_reply = finalText;

  if (review.source === "gbp_api" && review.external_id && gbpConnected(config)) {
    const posted = await postGbpReply(config, review, finalText, opts);
    if (posted.posted) {
      review.status = "posted";
      review.reply_posted_at = new Date().toISOString();
      await saveReview(review);
      return { ok: true, posted: true, review };
    }
    // API refused — fall through to the manual-paste path rather
    // than losing the owner's approval.
    review.status = "approved";
    await saveReview(review);
    const note = await notifyOwner(config, `Approved reply for ${review.reviewer_name}'s review (Google wouldn't take the automatic post — please paste it under the review): ${finalText}`, opts);
    return { ok: true, posted: false, fell_back: posted.reason, owner_note: note, review };
  }

  review.status = "approved";
  await saveReview(review);
  const note = await notifyOwner(config, `Approved reply for ${review.reviewer_name}'s ${starsOf(review.rating)} review — paste it under the review on Google: ${finalText}`, opts);
  return { ok: true, posted: false, owner_note: note, review };
}

async function dismissReview(reviewKey) {
  const review = await getReview(reviewKey);
  if (!review) return { ok: false, error: "review_not_found" };
  review.status = "dismissed";
  await saveReview(review);
  return { ok: true, review };
}

// ---------- weekly GBP posts ----------
function postKeyOf(clientKey, monday) {
  return `${clientKey}:post:${monday}`;
}
function normalizePost(raw, fallbackKey) {
  const p = raw || {};
  return {
    post_key: str(p.post_key || p.Post_Key) || fallbackKey || "",
    client_key: str(p.client_key || p.Client_Key),
    week_of: str(p.week_of || p.Week_Of),
    kind: str(p.kind || p.Kind),
    body: str(p.body || p.Body),
    image_suggestion: str(p.image_suggestion || p.Image_Suggestion),
    source: str(p.source || p.Source),
    source_review_key: str(p.source_review_key || p.Source_Review_Key),
    status: str(p.status || p.Status) || "draft",
    created_at: str(p.created_at || p.Created_At),
    posted_at: str(p.posted_at || p.Posted_At),
  };
}
function postToAirtableFields(p) {
  return {
    Post_Key: p.post_key, Client_Key: p.client_key, Week_Of: p.week_of, Kind: p.kind,
    Body: p.body, Image_Suggestion: p.image_suggestion, Source: p.source,
    Source_Review_Key: p.source_review_key, Status: p.status,
    Created_At: p.created_at, Posted_At: p.posted_at,
  };
}
async function savePost(post) {
  await saveSnapshot({
    table: POSTS_TABLE, keyField: "Post_Key", keyValue: post.post_key,
    fields: postToAirtableFields(post), auditAction: "review.post", snapshot: post,
  });
  return post;
}
async function getPost(postKey) {
  const at = await airtableList(POSTS_TABLE, `{Post_Key}='${escFormula(postKey)}'`, 1);
  if (at.ok && at.records.length) return normalizePost(at.records[0].fields, postKey);
  const rows = await auditList("review.post", postKey, 1);
  if (rows.ok && rows.rows.length) return normalizePost(rows.rows[0].detail, postKey);
  return null;
}
async function listPosts(clientKey, limit) {
  const at = await airtableList(POSTS_TABLE, `{Client_Key}='${escFormula(clientKey)}'`, limit || 100);
  if (at.ok && at.records.length) {
    return at.records.map((r) => normalizePost(r.fields)).sort((a, b) => String(b.week_of).localeCompare(String(a.week_of)));
  }
  const byKey = await latestSnapshots("review.post", clientKey, 300);
  return [...byKey.values()].map((d) => normalizePost(d)).sort((a, b) => String(b.week_of).localeCompare(String(a.week_of)));
}

// One draft per client per week. Kind selection: a recent public
// 4–5★ review the client allows us to highlight wins; otherwise
// service spotlight and seasonal alternate by week.
async function generateWeeklyPost(config, now, opts = {}) {
  const { monday, weekIndex } = localWeek(now, config.timezone);
  const postKey = postKeyOf(config.client_key, monday);
  const existing = await getPost(postKey);
  if (existing) return { client_key: config.client_key, created: false, reason: "already_drafted_this_week", post: existing };

  let kind = weekIndex % 2 === 0 ? "service_spotlight" : "seasonal";
  let review = null;
  if (config.review_highlight) {
    const reviews = await listReviews(config.client_key, 50);
    const cutoff = new Date(now.getTime() - 35 * 24 * 3600 * 1000).toISOString();
    review = reviews.find((r) => r.rating >= 4 && r.text && String(r.detected_at) >= cutoff) || null;
    if (review) kind = "review_highlight";
  }
  const services = config.services || [];
  const service = services.length ? services[Math.abs(weekIndex) % services.length] : "";
  const drafted = await draftGbpPost({
    kind, business_name: config.business_name, city: config.city, service, review,
  }, opts);
  const post = normalizePost({
    post_key: postKey, client_key: config.client_key, week_of: monday, kind,
    body: drafted.body, image_suggestion: drafted.image_suggestion, source: drafted.source,
    source_review_key: review ? review.review_key : "",
    status: "draft", created_at: now.toISOString(),
  }, postKey);
  await savePost(post);

  const link = approveLink("post", postKey);
  const note = await notifyOwner(config,
    `Your weekly Google post for ${config.business_name} is drafted (${kind.replace(/_/g, " ")}): "${post.body.slice(0, 140)}"${link ? ` — approve or edit: ${link}` : " — approve it in the portal (Review Engine)"}. Nothing posts until you approve it.`, opts);
  return { client_key: config.client_key, created: true, post, owner_notify: note };
}

// Post an approved GBP post through the API. Only from approvePost,
// only on connected clients.
async function postGbpLocalPost(config, post, opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch;
  const res = await fetchImpl(`https://mybusiness.googleapis.com/v4/${config.gbp_location}/localPosts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${gbpTokenFor(config)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ languageCode: "en-CA", summary: post.body, topicType: "STANDARD" }),
  });
  if (!res.ok) return { posted: false, reason: `gbp_http_${res.status}` };
  return { posted: true };
}

async function approvePost(postKey, opts = {}) {
  const post = await getPost(postKey);
  if (!post) return { ok: false, error: "post_not_found" };
  if (post.status === "posted") return { ok: true, already: "posted", post };
  if (post.status === "dismissed") return { ok: false, error: "post_dismissed" };
  const config = await getConfigByKey(post.client_key);
  if (!config) return { ok: false, error: "client_config_not_found" };
  if (opts.body) post.body = str(opts.body);

  if (gbpConnected(config)) {
    const posted = await postGbpLocalPost(config, post, opts);
    if (posted.posted) {
      post.status = "posted";
      post.posted_at = new Date().toISOString();
      await savePost(post);
      return { ok: true, posted: true, post };
    }
    post.status = "approved";
    await savePost(post);
    const note = await notifyOwner(config, `Approved Google post for ${config.business_name} (automatic posting failed — please post it manually). Photo: ${post.image_suggestion || "a real job photo"}. Text: ${post.body}`, opts);
    return { ok: true, posted: false, fell_back: posted.reason, owner_note: note, post };
  }
  post.status = "approved";
  await savePost(post);
  const note = await notifyOwner(config, `Approved Google post for ${config.business_name} — paste it into your Google Business Profile posts. Photo: ${post.image_suggestion || "a real job photo"}. Text: ${post.body}`, opts);
  return { ok: true, posted: false, owner_note: note, post };
}

async function dismissPost(postKey) {
  const post = await getPost(postKey);
  if (!post) return { ok: false, error: "post_not_found" };
  post.status = "dismissed";
  await savePost(post);
  return { ok: true, post };
}

// ---------- monthly report ----------
// One page of markdown. Counts come only from this engine's own
// records; Google profile views/actions appear only when API data
// exists — this module does not pull performance metrics, so the
// report says so instead of estimating. That honesty is the point.
async function generateMonthlyReport(clientKey, month, opts = {}) {
  const config = await getConfigByKey(clientKey);
  if (!config) return { ok: false, error: "client_config_not_found" };
  const tz = config.timezone;
  const inMonth = (iso, m) => iso && localMonthString(new Date(iso), tz) === m;
  const prev = prevMonthOf(month);

  const asks = await listAsks(clientKey, 500);
  const reviews = await listReviews(clientKey, 500);
  const posts = await listPosts(clientKey, 100);

  const asksSent = asks.filter((a) => inMonth(a.sent_at, month)).length;
  const asksReminded = asks.filter((a) => inMonth(a.reminded_at, month)).length;
  const monthReviews = reviews.filter((r) => inMonth(r.detected_at, month));
  const prevReviews = reviews.filter((r) => inMonth(r.detected_at, prev));
  const rated = monthReviews.filter((r) => r.rating > 0);
  const avg = rated.length ? rated.reduce((s, r) => s + r.rating, 0) / rated.length : null;
  const prevRated = prevReviews.filter((r) => r.rating > 0);
  const prevAvg = prevRated.length ? prevRated.reduce((s, r) => s + r.rating, 0) / prevRated.length : null;
  const dist = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  for (const r of rated) dist[r.rating] = (dist[r.rating] || 0) + 1;
  const repliesHandled = monthReviews.filter((r) => ["approved", "posted"].includes(r.status)).length;
  const monthPosts = posts.filter((p) => String(p.week_of).slice(0, 7) === month && ["approved", "posted"].includes(p.status));

  let trend;
  if (avg === null) trend = "No reviews recorded this month.";
  else if (prevAvg === null) trend = `Average ${avg.toFixed(1)}★ — first month on record, no trend yet.`;
  else {
    const d = avg - prevAvg;
    trend = `Average ${avg.toFixed(1)}★ (${d > 0.04 ? `up ${d.toFixed(1)}` : d < -0.04 ? `down ${Math.abs(d).toFixed(1)}` : "steady"} vs ${prevAvg.toFixed(1)}★ in ${prev}).`;
  }

  const gbpLine = gbpConnected(config)
    ? "Google profile: API connected for review data. Profile view/action counts are not pulled by this report yet — nothing is estimated."
    : "Google profile: not API-connected. Reviews above come from the watcher/manual entry; profile views and actions are not shown because we don't guess numbers.";

  const md = [
    `# ${config.business_name} — Review report, ${month}`,
    ``,
    `## Reviews`,
    `- New reviews recorded: **${monthReviews.length}**`,
    `- ${trend}`,
    `- Mix: ${dist[5]}× ★★★★★ · ${dist[4]}× ★★★★ · ${dist[3]}× ★★★ · ${dist[2]}× ★★ · ${dist[1]}× ★`,
    `- Replies approved/posted: **${repliesHandled}**`,
    ``,
    `## Review asks`,
    `- Thank-you texts sent: **${asksSent}** (every completed job, same ask for everyone)`,
    `- Gentle reminders sent: **${asksReminded}**`,
    ``,
    `## Google profile posts`,
    `- Posts approved/published: **${monthPosts.length}**`,
    ``,
    `## Visibility`,
    `- ${gbpLine}`,
    ``,
    `_Review Engine + Google Profile Care by WilGlobo — generated ${new Date().toISOString().slice(0, 10)}. Counts are this engine's own records._`,
  ].join("\n");

  const counts = { asks_sent: asksSent, asks_reminded: asksReminded, reviews: monthReviews.length, avg_rating: avg === null ? null : Number(avg.toFixed(2)), replies_handled: repliesHandled, posts: monthPosts.length };
  const saved = await saveSnapshot({
    table: REPORTS_TABLE, keyField: "Report_Key", keyValue: `${clientKey}:${month}`,
    fields: { Report_Key: `${clientKey}:${month}`, Client_Key: clientKey, Month: month, Markdown: md, Generated_At: new Date().toISOString() },
    auditAction: "review.report",
    snapshot: { client_key: clientKey, month, markdown: md, counts, generated_at: new Date().toISOString() },
  });

  let email = { sent: false, reason: "not_requested" };
  if (opts.emailOwner && config.owner_email && process.env.RESEND_API_KEY) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: process.env.RESEND_FROM || "WilGlobo <tech@wilglobo.com>",
          to: [config.owner_email],
          subject: `${config.business_name} — review report ${month}`,
          html: `<div style="font-family:Arial,sans-serif;max-width:560px"><pre style="white-space:pre-wrap;font-family:Arial,sans-serif;font-size:14px">${md.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre></div>`,
        }),
      });
      email = res.ok ? { sent: true } : { sent: false, reason: `resend_http_${res.status}` };
    } catch (e) {
      email = { sent: false, reason: String(e && e.message ? e.message : e) };
    }
  }
  return { ok: true, client_key: clientKey, month, counts, markdown: md, stored: saved, email };
}

// ---------- inbound SMS (STOP / START on the ask number) ----------
async function handleReviewInboundSms(params, opts = {}) {
  const p = params || {};
  const to = workerPhoneE164(p.To) || str(p.To);
  const from = workerPhoneE164(p.From) || str(p.From);
  const body = str(p.Body);
  const result = { to, from, steps: {} };
  if (!to || !from) { result.skipped = "missing_numbers"; return result; }

  // Which client does this number belong to? A dedicated
  // from_number wins; on the shared portal line, the customer's own
  // ask history decides.
  const configs = (await listConfigs()).filter((c) => c.active);
  let config = configs.find((c) => c.from_number && c.from_number === to) || null;
  if (!config) {
    const portalFrom = process.env.TWILIO_FROM_NUMBER || "";
    if (to === portalFrom) {
      const candidates = configs.filter((c) => !c.from_number);
      if (candidates.length === 1) config = candidates[0];
      else {
        for (const c of candidates) {
          const mine = (await listAsks(c.client_key, 100)).find((a) => a.customer_mobile === from);
          if (mine) { config = c; break; }
        }
      }
    }
  }
  if (!config) { result.skipped = "no_config_for_number"; return result; }
  result.client_key = config.client_key;

  const keyword = body.toUpperCase();
  if (["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"].includes(keyword)) {
    await recordOptOut(config.client_key, from, { keyword });
    result.steps.optout = true;
    return result;
  }
  if (["START", "UNSTOP", "YES"].includes(keyword)) {
    await recordOptOut(config.client_key, from, { optIn: true, keyword });
    result.steps.optin = true;
    return result;
  }
  result.steps.note = "non_keyword_inbound_ignored";
  return result;
}

// ---------- Twilio webhook signature (same scheme as _shield) ----------
function verifyTwilioSignature(url, params, signature) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token || !signature) return false;
  const keys = Object.keys(params || {}).sort();
  let data = String(url);
  for (const k of keys) data += k + (params[k] === undefined || params[k] === null ? "" : String(params[k]));
  const expected = crypto.createHmac("sha1", token).update(Buffer.from(data, "utf8")).digest("base64");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(signature), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function shouldVerifyTwilio(req, url, params) {
  if (process.env.REVIEW_SKIP_SIG_VERIFY === "1") return { enforce: false };
  const signature = req.headers && req.headers["x-twilio-signature"];
  if (!signature || !process.env.TWILIO_AUTH_TOKEN) return { enforce: false };
  return { enforce: true, ok: verifyTwilioSignature(url, params, signature) };
}

// ---------- the sweep (hourly cron) ----------
// Per active client: poll GBP (env-gated no-op when unconnected),
// fire due reminders, draft the weekly post on the client's
// configured weekday/hour, and generate last month's report on the
// 1st at the post hour. Every step is deduped by its store key, so
// hourly runs are safe.
async function runSweep(opts = {}) {
  const now = opts.now || new Date();
  const configs = (await listConfigs()).filter((c) => c.active);
  const summary = { clients: configs.length, results: [] };
  for (const config of configs) {
    const r = { client_key: config.client_key };
    r.poll = await pollGbpReviews(config, opts);
    r.reminders = await runRemindersForConfig(config, now, opts);
    const parts = localParts(now, config.timezone);
    const dow = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day))).getUTCDay();
    if (dow === Number(config.post_weekday) && parts.hour === String(config.post_hour).padStart(2, "0")) {
      r.weekly_post = await generateWeeklyPost(config, now, opts);
    }
    if (parts.day === "01" && parts.hour === String(config.post_hour).padStart(2, "0")) {
      const lastMonth = localMonthString(new Date(now.getTime() - 24 * 3600 * 1000), config.timezone);
      const existing = await auditList("review.report", `${config.client_key}:${lastMonth}`, 1);
      if (!existing.ok || !existing.rows.length) {
        const rep = await generateMonthlyReport(config.client_key, lastMonth, { ...opts, emailOwner: true });
        r.monthly_report = rep.ok ? { month: lastMonth, counts: rep.counts } : { error: rep.error };
        if (rep.ok) {
          await notifyOwner(config, `${config.business_name} review report for ${lastMonth} is ready: ${rep.counts.reviews} reviews, ${rep.counts.avg_rating === null ? "no average yet" : `avg ${rep.counts.avg_rating}★`}, ${rep.counts.asks_sent} asks sent. Full report emailed / in the portal.`, opts);
        }
      }
    }
    summary.results.push(r);
  }
  return summary;
}

module.exports = {
  // config
  normalizeConfig, upsertConfig, listConfigs, getConfigByKey,
  renderAsk, renderReminder,
  // asks + opt-outs
  handleJobCompleted, runRemindersForConfig, reviewDetectedSince,
  recordOptOut, isOptedOut, getAsk, listAsks, askKeyOf,
  // reviews
  recordReview, approveReview, dismissReview, getReview, listReviews,
  pollGbpReviews, gbpConnected, gbpTokenFor,
  // posts
  generateWeeklyPost, approvePost, dismissPost, getPost, listPosts,
  // report
  generateMonthlyReport,
  // inbound + sweep
  handleReviewInboundSms, runSweep,
  // tokens + twilio signature
  signToken, verifyToken, approveLink,
  verifyTwilioSignature, shouldVerifyTwilio,
  // composition (harness + previews)
  starsOf, DEFAULT_ASK_TEMPLATE, DEFAULT_REMINDER_TEMPLATE,
};
