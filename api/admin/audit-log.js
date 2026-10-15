// GET /api/admin/audit-log?limit=50
// Recent admin actions (who changed what, when) for the Overview tab.
// Read-only; enforcement is the audit_log_read_by_core_staff RLS policy.
const { requireCoreStaff } = require("./_requireCoreStaff");
const { withStaffAuth } = require("../_staffAuth");

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });
  try {
    const gate = await requireCoreStaff(req);
    if (gate.error) return res.status(gate.status || 400).json({ error: gate.error });
    const { uid } = gate;

    const limitRaw = parseInt((req.query && req.query.limit) || "50", 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;

    const entries = await withStaffAuth(uid, async (client) => {
      const { rows } = await client.query(
        `select a.id, a.action, a.entity_type, a.entity_id, a.detail, a.created_at,
                a.actor_email, p.full_name as actor_name
           from staff.audit_log a
           left join staff.people p on p.id = a.actor_person_id
          order by a.created_at desc
          limit $1`,
        [limit]
      );
      return rows;
    });
    return res.status(200).json({ entries });
  } catch (e) {
    console.error("api/admin/audit-log error:", e);
    return res.status(500).json({ error: "Server error." });
  }
};
