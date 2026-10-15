// POST /api/admin/roles  { person_id, project_id, engagement_track, role_title?, active? }
//   -> assigns (or updates) a person's role on a project. This is the
//   "pending assignment" action: a person with no staff.project_roles row
//   for a project isn't on it yet.
// DELETE /api/admin/roles?id=...  -> unassigns.
const { requireCoreStaff } = require("./_requireCoreStaff");
const { withStaffAuth } = require("../_staffAuth");
const { logAudit, rateLimited } = require("./_audit");

module.exports = async (req, res) => {
  try {
    const gate = await requireCoreStaff(req);
    if (gate.error) return res.status(gate.status || 400).json({ error: gate.error });
    const { uid, person: actor } = gate;

    if (req.method === "POST") {
      const body = req.body || {};
      if (!body.person_id || !body.project_id || !body.engagement_track) {
        return res.status(400).json({ error: "person_id, project_id and engagement_track are required." });
      }
      const role = await withStaffAuth(uid, async (client) => {
        const blocked = await rateLimited(client, actor.id, "admin.roles.write", 30, 300);
        if (blocked) throw Object.assign(new Error("Too many changes in a short time — wait a few minutes and try again."), { httpStatus: 429 });

        const { rows } = await client.query(
          `insert into staff.project_roles (person_id, project_id, engagement_track, role_title, active)
           values ($1, $2, $3, $4, coalesce($5, true))
           on conflict (person_id, project_id) do update
             set engagement_track = excluded.engagement_track,
                 role_title = excluded.role_title,
                 active = excluded.active
           returning *`,
          [body.person_id, body.project_id, body.engagement_track, body.role_title || null, body.active]
        );
        const row = rows[0];
        await logAudit(client, {
          actorPersonId: actor.id,
          actorEmail: actor.email,
          action: "roles.upsert",
          entityType: "role",
          entityId: row.id,
          detail: { person_id: body.person_id, project_id: body.project_id, engagement_track: body.engagement_track },
        });
        return row;
      }).catch(async (e) => {
        if (e.httpStatus) throw e;
        // No unique constraint to upsert on yet — fall back to plain insert.
        if (e.code === "42P10") {
          return withStaffAuth(uid, async (client) => {
            const { rows } = await client.query(
              `insert into staff.project_roles (person_id, project_id, engagement_track, role_title, active)
               values ($1, $2, $3, $4, coalesce($5, true)) returning *`,
              [body.person_id, body.project_id, body.engagement_track, body.role_title || null, body.active]
            );
            const row = rows[0];
            await logAudit(client, {
              actorPersonId: actor.id,
              actorEmail: actor.email,
              action: "roles.create",
              entityType: "role",
              entityId: row.id,
              detail: { person_id: body.person_id, project_id: body.project_id, engagement_track: body.engagement_track },
            });
            return row;
          });
        }
        throw e;
      });
      return res.status(201).json({ role });
    }

    if (req.method === "DELETE") {
      const id = (req.query && req.query.id) || null;
      if (!id) return res.status(400).json({ error: "Missing id." });
      const deleted = await withStaffAuth(uid, async (client) => {
        const blocked = await rateLimited(client, actor.id, "admin.roles.write", 30, 300);
        if (blocked) throw Object.assign(new Error("Too many changes in a short time — wait a few minutes and try again."), { httpStatus: 429 });

        const { rows } = await client.query(
          `delete from staff.project_roles where id = $1 returning id`,
          [id]
        );
        const row = rows[0];
        if (row) {
          await logAudit(client, {
            actorPersonId: actor.id,
            actorEmail: actor.email,
            action: "roles.delete",
            entityType: "role",
            entityId: row.id,
          });
        }
        return row;
      });
      if (!deleted) return res.status(404).json({ error: "No role with that id." });
      return res.status(200).json({ deleted: true });
    }

    return res.status(405).json({ error: "Method not allowed." });
  } catch (e) {
    if (e.httpStatus) return res.status(e.httpStatus).json({ error: e.message });
    console.error("api/admin/roles error:", e);
    return res.status(500).json({ error: "Server error." });
  }
};
