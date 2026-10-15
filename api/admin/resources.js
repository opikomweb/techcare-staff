// Full CRUD on staff.resources (the forms/policies/training list shown in
// every project's Resources tab). Replaces hand-written SQL migrations
// for this table — core staff can now add/edit/remove documents from the
// admin screen directly.
//
// GET    /api/admin/resources
// POST   /api/admin/resources            body: new row (no id)
// PUT    /api/admin/resources             body: row with id -> updates it
// DELETE /api/admin/resources?id=...
const { requireCoreStaff } = require("./_requireCoreStaff");
const { withStaffAuth } = require("../_staffAuth");
const { logAudit, rateLimited } = require("./_audit");

const EDITABLE_COLS = [
  "project_id", "category", "title", "description", "url",
  "required", "engagement_tracks", "sort_order",
];

module.exports = async (req, res) => {
  try {
    const gate = await requireCoreStaff(req);
    if (gate.error) return res.status(gate.status || 400).json({ error: gate.error });
    const { uid, person: actor } = gate;

    if (req.method === "GET") {
      const resources = await withStaffAuth(uid, async (client) => {
        const { rows } = await client.query(
          `select r.id, r.project_id, proj.slug as project_slug, r.category, r.title,
                  r.description, r.url, r.required, r.engagement_tracks, r.sort_order
             from staff.resources r
             left join staff.projects proj on proj.id = r.project_id
            order by proj.slug nulls first, r.sort_order, r.title`
        );
        return rows;
      });
      return res.status(200).json({ resources });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      if (!body.title || !body.category) {
        return res.status(400).json({ error: "title and category are required." });
      }
      const created = await withStaffAuth(uid, async (client) => {
        const blocked = await rateLimited(client, actor.id, "admin.resources.write", 30, 300);
        if (blocked) throw Object.assign(new Error("Too many changes in a short time — wait a few minutes and try again."), { httpStatus: 429 });

        const { rows } = await client.query(
          `insert into staff.resources
             (project_id, category, title, description, url, required, engagement_tracks, sort_order)
           values ($1, $2, $3, $4, $5, $6, $7, $8)
           returning *`,
          [
            body.project_id || null,
            body.category,
            body.title,
            body.description || null,
            body.url || null,
            !!body.required,
            body.engagement_tracks && body.engagement_tracks.length ? body.engagement_tracks : null,
            Number.isFinite(body.sort_order) ? body.sort_order : 999,
          ]
        );
        const row = rows[0];
        await logAudit(client, {
          actorPersonId: actor.id,
          actorEmail: actor.email,
          action: "resources.create",
          entityType: "resource",
          entityId: row.id,
          detail: { title: row.title },
        });
        return row;
      });
      return res.status(201).json({ resource: created });
    }

    if (req.method === "PUT") {
      const body = req.body || {};
      if (!body.id) return res.status(400).json({ error: "Missing id." });

      const fields = [];
      const values = [];
      let i = 1;
      for (const col of EDITABLE_COLS) {
        if (body[col] !== undefined) {
          fields.push(`${col} = $${i++}`);
          values.push(col === "engagement_tracks" && Array.isArray(body[col]) && body[col].length === 0 ? null : body[col]);
        }
      }
      if (fields.length === 0) return res.status(400).json({ error: "Nothing to update." });

      const updated = await withStaffAuth(uid, async (client) => {
        const blocked = await rateLimited(client, actor.id, "admin.resources.write", 30, 300);
        if (blocked) throw Object.assign(new Error("Too many changes in a short time — wait a few minutes and try again."), { httpStatus: 429 });

        const { rows } = await client.query(
          `update staff.resources set ${fields.join(", ")}, updated_at = now()
             where id = $${i}
             returning *`,
          [...values, body.id]
        );
        const row = rows[0];
        if (row) {
          await logAudit(client, {
            actorPersonId: actor.id,
            actorEmail: actor.email,
            action: "resources.update",
            entityType: "resource",
            entityId: row.id,
            detail: { changed: Object.keys(body).filter((k) => k !== "id") },
          });
        }
        return row;
      });
      if (!updated) return res.status(404).json({ error: "No resource with that id." });
      return res.status(200).json({ resource: updated });
    }

    if (req.method === "DELETE") {
      const id = (req.query && req.query.id) || null;
      if (!id) return res.status(400).json({ error: "Missing id." });
      const deleted = await withStaffAuth(uid, async (client) => {
        const blocked = await rateLimited(client, actor.id, "admin.resources.write", 30, 300);
        if (blocked) throw Object.assign(new Error("Too many changes in a short time — wait a few minutes and try again."), { httpStatus: 429 });

        const { rows } = await client.query(
          `delete from staff.resources where id = $1 returning id`,
          [id]
        );
        const row = rows[0];
        if (row) {
          await logAudit(client, {
            actorPersonId: actor.id,
            actorEmail: actor.email,
            action: "resources.delete",
            entityType: "resource",
            entityId: row.id,
          });
        }
        return row;
      });
      if (!deleted) return res.status(404).json({ error: "No resource with that id." });
      return res.status(200).json({ deleted: true });
    }

    return res.status(405).json({ error: "Method not allowed." });
  } catch (e) {
    if (e.httpStatus) return res.status(e.httpStatus).json({ error: e.message });
    console.error("api/admin/resources error:", e);
    return res.status(500).json({ error: "Server error." });
  }
};
