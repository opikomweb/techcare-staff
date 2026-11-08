// ONE-OFF (Nov 8, 2026): Review Engine dogfood go-live. Ensures the
// five Review_Engine_* Airtable tables exist (the product README's
// go-live checkbox — the Muse connector token has no schema scope,
// so this runs server-side with the portal's own Airtable key),
// creates the TechCare client-zero config, and fires exactly three
// asks through api/_reviewEngine.js: a self-test to the owner's own
// cell, then the two approved dogfood clients (Diane / WGB-4,
// Lorese Morgan / WGB-9). Everything is hard-coded — the endpoint
// takes NO input. Minda Buhat / WGB-7 is deliberately absent and
// must never be added.
//
// Why a one-shot: the internal API (api/review-engine.js) requires
// the TECHCARE_SMS_KEY header, whose value lives only in the Vercel
// env and cannot be read back from here (team-scope 403 — DP-S7).
// This endpoint runs inside the portal and calls the engine module
// directly, the same route the hourly cron takes. It is deleted in
// the follow-up commit once the run is confirmed — the
// oneshot-retell-selftest convention.
//
// Stores note (found live, Nov 8): the engine's audit-log fallback
// cannot persist in production — staff.audit_log RLS rejects the
// portal role's NULL-actor inserts (SQLSTATE 42501). Airtable is
// the product's intended system of record, so the tables are
// ensured FIRST and every step below reads/writes through them.
// Replay safety: handleJobCompleted is idempotent per (client, job)
// against that store — a second invocation returns already_asked
// and sends nothing. If the self-test send fails, the client fires
// are skipped.
const engine = require("../_reviewEngine");

const BASE_ID = "appBiAKY6ivoImcaQ";
const TABLES = [
  ["Review_Engine_Clients", ["Client_Key", "Business_Name", "Review_Link", "Owner_Name", "Owner_Mobile", "Owner_Email", "From_Number", "Timezone", "Ask_Template", "Reminder_Template", "Reminder_Days", "Reminder_Enabled", "Services", "City", "Review_Highlight", "Post_Weekday", "Post_Hour", "Gbp_Location", "Active"]],
  ["Review_Engine_Asks", ["Ask_Key", "Client_Key", "Job_Ref", "Customer_Name", "Customer_Mobile", "Status", "Sent_At", "Ask_SID", "Reminded_At", "Reminder_SID", "Created_At"]],
  ["Review_Engine_Reviews", ["Review_Key", "Client_Key", "Reviewer_Name", "Rating", "Text", "Source", "External_Id", "Posted_At", "Detected_At", "Status", "Draft_Reply", "Draft_Source", "Final_Reply", "Reply_Posted_At"]],
  ["Review_Engine_Posts", ["Post_Key", "Client_Key", "Week_Of", "Kind", "Body", "Image_Suggestion", "Source", "Source_Review_Key", "Status", "Created_At", "Posted_At"]],
  ["Review_Engine_Reports", ["Report_Key", "Client_Key", "Month", "Markdown", "Generated_At"]],
];
const LONG_TEXT = new Set(["Ask_Template", "Reminder_Template", "Services", "Text", "Draft_Reply", "Final_Reply", "Body", "Markdown"]);

async function ensureTables() {
  const key = process.env.AIRTABLE_WRITE_KEY || process.env.AIRTABLE_API_KEY;
  if (!key) return { ok: false, error: "no_airtable_key_in_env" };
  const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const listRes = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, { headers });
  if (!listRes.ok) return { ok: false, error: `schema_list_http_${listRes.status}` };
  const list = await listRes.json().catch(() => ({}));
  const existing = new Set((list.tables || []).map((t) => t.name));
  const results = [];
  for (const [name, fieldNames] of TABLES) {
    if (existing.has(name)) { results.push({ table: name, state: "exists" }); continue; }
    const fields = fieldNames.map((n) => ({ name: n, type: LONG_TEXT.has(n) ? "multilineText" : "singleLineText" }));
    const res = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, {
      method: "POST", headers, body: JSON.stringify({ name, fields }),
    });
    const body = await res.json().catch(() => ({}));
    results.push({ table: name, state: res.ok ? "created" : `http_${res.status}`, error: res.ok ? undefined : (body.error && body.error.type) || undefined });
    if (!res.ok) return { ok: false, results };
  }
  return { ok: true, results };
}

const TECHCARE_CONFIG = {
  client_key: "techcare",
  business_name: "TechCare by WilGlobo",
  review_link: "https://g.page/r/CZ8G2uJ0q4R6EBM/review",
  owner_name: "Wilton",
  owner_mobile: "+18259626061",
  owner_email: "wilton@wilglobo.com",
  from_number: "",
  timezone: "America/Edmonton",
  services: ["computer help at home", "email and account setup", "phone and tablet help", "scam-safety check"],
  city: "Calgary",
  review_highlight: true,
  active: true,
};

const SELF_TEST = { client_key: "techcare", job_ref: "SELFTEST-2026-11-08", customer_name: "Wilton (self-test)", customer_mobile: "+18259626061" };
const DOGFOOD_FIRES = [
  { client_key: "techcare", job_ref: "WGB-4", customer_name: "Diane", customer_mobile: "+14034003731" },
  { client_key: "techcare", job_ref: "WGB-9", customer_name: "Lorese Morgan", customer_mobile: "+14033835046" },
];

module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }
  try {
    // Same auth policy as the other cron endpoints.
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.authorization || "";
    let authorized = false;
    if (secret && auth === `Bearer ${secret}`) authorized = true;
    if (!authorized) {
      const { requireCoreStaff } = require("../admin/_requireCoreStaff");
      const gate = await requireCoreStaff(req).catch(() => ({ error: "no session" }));
      if (!gate.error) authorized = true;
    }
    if (!authorized && secret) return res.status(401).json({ error: "Unauthorized." });
    if (!authorized && !secret) console.warn("oneshot-review-dogfood: CRON_SECRET not set — running unauthenticated (hard-coded payload + engine idempotency guard the sends).");

    const out = { ok: true, steps: {} };

    // 0) The store: ensure the five Airtable tables exist.
    out.steps.tables = await ensureTables();
    if (!out.steps.tables.ok) return res.status(200).json({ ...out, ok: false, aborted: "tables_not_ready_no_sends" });

    // 1) Client-zero config (idempotent upsert; validates templates).
    const cfg = await engine.upsertConfig(TECHCARE_CONFIG);
    out.steps.config = { ok: cfg.ok, error: cfg.error || undefined, stored: cfg.stored, config: cfg.config };
    if (!cfg.ok) return res.status(200).json({ ...out, ok: false, aborted: "config_failed_no_sends" });
    out.steps.rendered_ask = engine.renderAsk(cfg.config, "Diane");

    // 2) Self-test through the real production path, owner cell only.
    const test = await engine.handleJobCompleted(SELF_TEST, {});
    out.steps.selftest = test;
    if (!test.steps || !test.steps.ask || !test.steps.ask.sent) {
      return res.status(200).json({ ...out, ok: false, aborted: "selftest_not_sent_clients_skipped" });
    }

    // 3) The two approved dogfood asks — and nobody else.
    out.steps.dogfood = [];
    for (const fire of DOGFOOD_FIRES) {
      out.steps.dogfood.push(await engine.handleJobCompleted(fire, {}));
    }

    // 4) Read-back from the engine's own store.
    out.asks = await engine.listAsks("techcare", 50);
    return res.status(200).json(out);
  } catch (e) {
    console.error("oneshot-review-dogfood failed:", e);
    return res.status(500).json({ ok: false, error: "oneshot_failed", detail: String(e && e.message ? e.message : e) });
  }
};
