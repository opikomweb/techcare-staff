// Core staff's view of logged hours, for payroll/verification.
// GET    /api/admin/time-entries?personId=&from=&to=   -> list (newest first)
// PUT    /api/admin/time-entries   body: {id, clock_in?, clock_out?, notes?}  -- manual correction
// DELETE /api/admin/time-entries?id=...                 -- remove a bad entry
const { requireCoreStaff } = require("./_requireCoreStaff");
const { withStaffAuth } = require("../_staffAuth");
const { logAudit, rateLimited } = require("./_audit");

module.exports = async (req, res) => {
  try {
    const gate = await requireCoreStaff(req);
    if (gate.error) return res.status(gate.status || 400).json({ error: gate.error });
    const { uid, person: actor } = gate;

    if (req.method === "GET") {
      const { personId, from, to } = req.query || {};
      const entries = await withStaffAuth(uid, async (client) => {
        const clauses = [];
        const values = [];
        let i = 1;
        if (personId) { clauses.push(`t.person_id = $${i++}`); values.push(personId); }
        if (from) { clauses.push(`t.clock_in >= $${i++}`); values.push(from); }
        if (to) { clauses.push(`t.clock_in <= $${i++}`); values.push(to); }
        const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
        const { rows } = await client.query(
          `select t.id, t.person_id, p.full_name, t.job_ref, t.clock_in, t.clock_out, t.notes,
                  extract(epoch from (coalesce(t.clock_out, now()) - t.clock_in)) / 3600.0 as hours
             from staff.time_entries t
             join staff.people p on p.id = t.person_id
             ${where}
            order by t.clock_in desc
            limit 500`,
          values
        );
        return rows;
      });
      return res.status(200).json({ entries });
    }

    if (req.method === "PUT") {
      const body = req.body || {};
      if (!body.id) return res.status(400).json({ error: "Missing id." });
      const EDITABLE = ["clock_in", "clock_out", "notes", "job_ref"];
      const fields = [];
      const values = [];
      let i = 1;
      for (const col of EDITABLE) {
        if (body[col] !== undefined) {
          fields.push(`${col} = $${i++}`);
          values.push(body[col]);
        }
      }
      if (fields.length === 0) return res.status(400).json({ error: "Nothing to update." });

      const updated = await withStaffAuth(uid, async (client) => {
        const blocked = await rateLimited(client, actor.id, "admin.time_entries.write", 30, 300);
        if (blocked) throw Object.assign(new Error("Too many changes in a short time — wait a few minutes and try again."), { httpStatus: 429 });

        const { rows } = await client.query(
          `update staff.time_entries set ${fields.join(", ")} where id = $${i} returning *`,
          [...values, body.id]
        );
        const row = rows[0];
        if (row) {
          await logAudit(client, {
            actorPersonId: actor.id,
            actorEmail: actor.email,
            action: "time_entries.correct",
            entityType: "time_entry",
            entityId: row.id,
            detail: { changed: Object.keys(body).filter((k) => k !== "id") },
          });
        }
        return row;
      });
      if (!updated) return res.status(404).json({ error: "No time entry with that id." });
      return res.status(200).json({ entry: updated });
    }

    if (req.method === "DELETE") {
      const id = (req.query && req.query.id) || null;
      if (!id) return res.status(400).json({ error: "Missing id." });
      const deleted = await withStaffAuth(uid, async (client) => {
        const blocked = await rateLimited(client, actor.id, "admin.time_entries.write", 30, 300);
        if (blocked) throw Object.assign(new Error("Too many changes in a short time — wait a few minutes and try again."), { httpStatus: 429 });

        const { rows } = await client.query(`delete from staff.time_entries where id = $1 returning id`, [id]);
        const row = rows[0];
        if (row) {
          await logAudit(client, {
            actorPersonId: actor.id,
            actorEmail: actor.email,
            action: "time_entries.delete",
            entityType: "time_entry",
            entityId: row.id,
          });
        }
        return row;
      });
      if (!deleted) return res.status(404).json({ error: "No time entry with that id." });
      return res.status(200).json({ deleted: true });
    }

    return res.status(405).json({ error: "Method not allowed." });
  } catch (e) {
    if (e.httpStatus) return res.status(e.httpStatus).json({ error: e.message });
    console.error("api/admin/time-entries error:", e);
    return res.status(500).json({ error: "Server error." });
  }
};
