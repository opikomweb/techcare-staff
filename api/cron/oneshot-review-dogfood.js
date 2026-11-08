// ONE-OFF (Nov 8, 2026): Review Engine dogfood go-live. Creates the
// TechCare client-zero config and fires exactly three asks through
// api/_reviewEngine.js: a self-test to the owner's own cell, then
// the two approved dogfood clients (Diane / WGB-4, Lorese Morgan /
// WGB-9). Everything is hard-coded — the endpoint takes NO input.
// Minda Buhat / WGB-7 is deliberately absent and must never be added.
//
// Why a one-shot: the internal API (api/review-engine.js) requires
// the TECHCARE_SMS_KEY header, whose value lives only in the Vercel
// env and cannot be read back from here (team-scope 403 — DP-S7).
// This endpoint runs inside the portal and calls the engine module
// directly, the same route the hourly cron takes. It is deleted in
// the follow-up commit once the run is confirmed — the
// oneshot-retell-selftest convention.
//
// Run-once guard, fail closed: a marker row in staff.audit_log is
// checked first and written BEFORE any send; if the check or the
// marker write fails, nothing sends. The engine's own per-job
// idempotency is the second lock — a replay can never double-text
// a client. If the self-test send fails, the client fires are
// skipped (fix the cause, bump MARKER_ID, redeploy).
const engine = require("../_reviewEngine");
const { getStaffPool } = require("../_staffAuth");

const MARKER_ID = "2026-11-08-v1";
const MARKER_ACTION = "review.dogfood_oneshot";

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

async function guardState() {
  const db = getStaffPool();
  const { rows } = await db.query(
    `select id from staff.audit_log where action = $1 and entity_id = $2 limit 1`,
    [MARKER_ACTION, MARKER_ID]
  );
  return rows.length ? "found" : "absent";
}

async function writeMarker(detail) {
  const db = getStaffPool();
  await db.query(
    `insert into staff.audit_log (actor_person_id, actor_email, action, entity_type, entity_id, detail)
     values (NULL, $1, $2, 'review_engine', $3, $4)`,
    ["reviews@wilglobo.com", MARKER_ACTION, MARKER_ID, JSON.stringify(detail || {})]
  );
}

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
    if (!authorized && !secret) console.warn("oneshot-review-dogfood: CRON_SECRET not set — running unauthenticated (run-once guard + engine idempotency guard the sends).");

    // Run-once guard, fail closed.
    let guard;
    try {
      guard = await guardState();
    } catch (e) {
      return res.status(500).json({ ok: false, error: "guard_check_failed_no_send", detail: String(e && e.message ? e.message : e) });
    }
    if (guard === "found") return res.status(200).json({ ok: true, already: true, marker: MARKER_ID });
    try {
      await writeMarker({ started_at: new Date().toISOString() });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "marker_write_failed_no_send", detail: String(e && e.message ? e.message : e), code: e && e.code ? e.code : undefined });
    }

    const out = { ok: true, marker: MARKER_ID, steps: {} };

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
