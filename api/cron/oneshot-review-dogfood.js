// DIAGNOSTIC PROBE (Nov 8, 2026) — temporary. Determines which
// staff.audit_log insert shape the production RLS policies accept,
// so the Review Engine's audit store can be repaired precisely.
// Writes only harmless 'review.dogfood_probe' audit rows. NO sends,
// NO config, NO engine actions. Deleted once the repair lands.
const { getStaffPool, withStaffAuth } = require("../_staffAuth");

const OWNER_EMAIL = "wilton@wilglobo.com";
const ACTION = "review.dogfood_probe";

async function tryInsert(label, run) {
  try {
    await run();
    return { label, ok: true };
  } catch (e) {
    return { label, ok: false, code: e && e.code, detail: String(e && e.message ? e.message : e) };
  }
}

module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }
  const out = { probe: true, steps: {} };
  try {
    const db = getStaffPool();
    // 1) Owner's staff.people row (plain read).
    try {
      const { rows } = await db.query(
        `select id, auth_user_id, email, is_core_staff, active from staff.people where lower(email) = lower($1) limit 1`,
        [OWNER_EMAIL]
      );
      out.steps.people = rows.length ? { found: true, id: rows[0].id, has_auth_uid: Boolean(rows[0].auth_user_id), is_core_staff: rows[0].is_core_staff, active: rows[0].active } : { found: false };
      out._person = rows[0] || null;
    } catch (e) {
      out.steps.people = { found: false, error: String(e && e.message ? e.message : e), code: e && e.code };
      out._person = null;
    }
    const person = out._person;
    delete out._person;
    if (!person) return res.status(200).json({ ...out, ok: false, aborted: "no_owner_person_row" });

    const detail = JSON.stringify({ probe: "2026-11-08" });
    const insertSql = `insert into staff.audit_log (actor_person_id, actor_email, action, entity_type, entity_id, detail) values ($1, $2, $3, 'review_engine', $4, $5)`;

    // A) plain pool, real actor_person_id, owner actor_email.
    out.steps.variantA = await tryInsert("plain_actor_id", () =>
      db.query(insertSql, [person.id, OWNER_EMAIL, ACTION, "probe-a", detail]));

    // B) claims transaction (withStaffAuth), real actor_person_id.
    out.steps.variantB = person.auth_user_id
      ? await tryInsert("claims_actor_id", () =>
          withStaffAuth(person.auth_user_id, (client) => client.query(insertSql, [person.id, OWNER_EMAIL, ACTION, "probe-b", detail])))
      : { label: "claims_actor_id", ok: false, skipped: "no_auth_uid" };

    // C) claims transaction, NULL actor (the engine's current shape, but with claims).
    out.steps.variantC = person.auth_user_id
      ? await tryInsert("claims_null_actor", () =>
          withStaffAuth(person.auth_user_id, (client) => client.query(insertSql, [null, "reviews@wilglobo.com", ACTION, "probe-c", detail])))
      : { label: "claims_null_actor", ok: false, skipped: "no_auth_uid" };

    return res.status(200).json({ ...out, ok: true });
  } catch (e) {
    return res.status(500).json({ ...out, ok: false, error: "probe_failed", detail: String(e && e.message ? e.message : e) });
  }
};
