// Shared helpers for the admin dashboard's security layer:
//  - logAudit: records who did what, to what, inside the same transaction
//    as the write itself (so a logged write and an unlogged write can't
//    drift apart).
//  - rateLimited: blocks a person from hammering a write endpoint even if
//    their token is valid — caps writes per person per action per window.
//    Uses staff.check_rate_limit (SECURITY DEFINER), scoped to the staff
//    schema only.
async function logAudit(client, { actorPersonId, actorEmail, action, entityType, entityId, detail }) {
  await client.query(
    `insert into staff.audit_log (actor_person_id, actor_email, action, entity_type, entity_id, detail)
     values ($1, $2, $3, $4, $5, $6)`,
    [actorPersonId, actorEmail || null, action, entityType, entityId != null ? String(entityId) : null, detail ? JSON.stringify(detail) : null]
  );
}

// Returns true if the action should be BLOCKED (limit exceeded).
async function rateLimited(client, personId, actionKey, limit, windowSeconds) {
  const { rows } = await client.query(
    "select staff.check_rate_limit($1, $2, $3, $4) as ok",
    [personId, actionKey, limit, windowSeconds]
  );
  return !rows[0].ok;
}

module.exports = { logAudit, rateLimited };
