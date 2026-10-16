// POST /api/resource-ack  { resourceId }
// Records that the signed-in person has read/acknowledged a staff.resources
// document. This is the missing half of the "required" badge on a
// Postgres-managed resource: until this existed, "required" was shown but
// nothing recorded whether anyone had actually opened it. One immutable
// row per (resource, person) — staff.resource_acknowledgements enforces
// that with a unique constraint and RLS that only lets a person insert
// their own row.
const { verifyAndGetPerson, withStaffAuth } = require("./_staffAuth");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  try {
    const result = await verifyAndGetPerson(req);
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    const { person, uid } = result;

    const resourceId = req.body && req.body.resourceId;
    if (!resourceId) return res.status(400).json({ error: "Missing resourceId." });

    const row = await withStaffAuth(uid, async (client) => {
      const { rows } = await client.query(
        `insert into staff.resource_acknowledgements (resource_id, person_id)
         values ($1, $2)
         on conflict (resource_id, person_id) do nothing
         returning *`,
        [resourceId, person.id]
      );
      if (rows[0]) return rows[0];
      // Already acknowledged earlier — return the existing row instead of
      // treating a repeat click as an error.
      const { rows: existing } = await client.query(
        `select * from staff.resource_acknowledgements where resource_id = $1 and person_id = $2`,
        [resourceId, person.id]
      );
      return existing[0] || null;
    });

    if (!row) return res.status(404).json({ error: "That resource couldn't be found." });
    return res.status(200).json({ acknowledgedAt: row.acknowledged_at });
  } catch (e) {
    console.error("api/resource-ack error:", e);
    return res.status(500).json({ error: "Server error." });
  }
};
