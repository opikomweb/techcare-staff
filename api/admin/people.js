// GET  /api/admin/people            -> every staff.people row + their project roles
// POST /api/admin/people  { id, full_name?, phone?, is_core_staff?, active? }
//      -> edits any one person's record. Assigning someone to a project
//      is done through /api/admin/roles, not here.
const { requireCoreStaff } = require("./_requireCoreStaff");
const { withStaffAuth } = require("../_staffAuth");
const { logAudit, rateLimited } = require("./_audit");

module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const gate = await requireCoreStaff(req);
    if (gate.error) return res.status(gate.status || 400).json({ error: gate.error });
    const { uid, person: actor } = gate;

    if (req.method === "GET") {
      const people = await withStaffAuth(uid, async (client) => {
        const { rows } = await client.query(
          `select p.id, p.full_name, p.email, p.phone, p.is_core_staff, p.active,
                  p.auth_user_id is not null as has_signed_in,
                  coalesce(
                    jsonb_agg(
                      jsonb_build_object(
                        'project_slug', proj.slug,
                        'project_name', proj.name,
                        'role_title', pr.role_title,
                        'engagement_track', pr.engagement_track,
                        'active', pr.active
                      )
                    ) filter (where pr.id is not null),
                    '[]'
                  ) as roles
             from staff.people p
             left join staff.project_roles pr on pr.person_id = p.id
             left join staff.projects proj on proj.id = pr.project_id
            group by p.id
            order by p.full_name`
        );
        return rows;
      });
      return res.status(200).json({ people });
    }

    // POST — edit one person
    const body = req.body || {};
    if (!body.id) return res.status(400).json({ error: "Missing id." });

    const fields = [];
    const values = [];
    let i = 1;
    for (const [col, val] of Object.entries({
      full_name: body.full_name,
      phone: body.phone,
      is_core_staff: body.is_core_staff,
      active: body.active,
    })) {
      if (val !== undefined) {
        fields.push(`${col} = $${i++}`);
        values.push(val);
      }
    }
    if (fields.length === 0) return res.status(400).json({ error: "Nothing to update." });

    const updated = await withStaffAuth(uid, async (client) => {
      const blocked = await rateLimited(client, actor.id, "admin.people.write", 30, 300);
      if (blocked) throw Object.assign(new Error("Too many changes in a short time — wait a few minutes and try again."), { httpStatus: 429 });

      const { rows } = await client.query(
        `update staff.people set ${fields.join(", ")}, updated_at = now()
           where id = $${i}
           returning id, full_name, email, phone, is_core_staff, active`,
        [...values, body.id]
      );
      const row = rows[0];
      if (row) {
        await logAudit(client, {
          actorPersonId: actor.id,
          actorEmail: actor.email,
          action: "people.update",
          entityType: "person",
          entityId: row.id,
          detail: { changed: Object.keys(req.body || {}).filter((k) => k !== "id") },
        });
      }
      return row;
    });

    if (!updated) return res.status(404).json({ error: "No person with that id." });
    return res.status(200).json({ person: updated });
  } catch (e) {
    if (e.httpStatus) return res.status(e.httpStatus).json({ error: e.message });
    console.error("api/admin/people error:", e);
    return res.status(500).json({ error: "Server error." });
  }
};
