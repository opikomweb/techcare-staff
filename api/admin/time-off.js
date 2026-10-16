// Core staff's approve/deny queue for time-off requests.
// GET /api/admin/time-off?status=pending   -> list (defaults to all, newest first)
// PUT /api/admin/time-off   body: {id, status: "approved"|"denied", decisionNote?}
const { requireCoreStaff } = require("./_requireCoreStaff");
const { withStaffAuth } = require("../_staffAuth");
const { logAudit, rateLimited } = require("./_audit");

module.exports = async (req, res) => {
  try {
    const gate = await requireCoreStaff(req);
    if (gate.error) return res.status(gate.status || 400).json({ error: gate.error });
    const { uid, person: actor } = gate;

    if (req.method === "GET") {
      const status = (req.query && req.query.status) || null;
      const requests = await withStaffAuth(uid, async (client) => {
        const { rows } = await client.query(
          status
            ? `select r.id, r.person_id, p.full_name, r.start_date, r.end_date, r.reason, r.status,
                      r.requested_at, r.decided_at, r.decision_note, d.full_name as decided_by_name
                 from staff.time_off_requests r
                 join staff.people p on p.id = r.person_id
                 left join staff.people d on d.id = r.decided_by
                where r.status = $1
                order by r.requested_at desc`
            : `select r.id, r.person_id, p.full_name, r.start_date, r.end_date, r.reason, r.status,
                      r.requested_at, r.decided_at, r.decision_note, d.full_name as decided_by_name
                 from staff.time_off_requests r
                 join staff.people p on p.id = r.person_id
                 left join staff.people d on d.id = r.decided_by
                order by r.requested_at desc`,
          status ? [status] : []
        );
        return rows;
      });
      return res.status(200).json({ requests });
    }

    if (req.method === "PUT") {
      const body = req.body || {};
      if (!body.id || !["approved", "denied"].includes(body.status)) {
        return res.status(400).json({ error: "id and a status of approved or denied are required." });
      }
      const updated = await withStaffAuth(uid, async (client) => {
        const blocked = await rateLimited(client, actor.id, "admin.time_off.write", 30, 300);
        if (blocked) throw Object.assign(new Error("Too many changes in a short time — wait a few minutes and try again."), { httpStatus: 429 });

        const { rows } = await client.query(
          `update staff.time_off_requests
              set status = $2, decided_by = $3, decided_at = now(), decision_note = $4
            where id = $1
            returning *`,
          [body.id, body.status, actor.id, body.decisionNote || null]
        );
        const row = rows[0];
        if (row) {
          await logAudit(client, {
            actorPersonId: actor.id,
            actorEmail: actor.email,
            action: "time_off." + body.status,
            entityType: "time_off_request",
            entityId: row.id,
            detail: { decisionNote: body.decisionNote || null },
          });
        }
        return row;
      });
      if (!updated) return res.status(404).json({ error: "No request with that id." });
      return res.status(200).json({ request: updated });
    }

    return res.status(405).json({ error: "Method not allowed." });
  } catch (e) {
    if (e.httpStatus) return res.status(e.httpStatus).json({ error: e.message });
    console.error("api/admin/time-off error:", e);
    return res.status(500).json({ error: "Server error." });
  }
};
