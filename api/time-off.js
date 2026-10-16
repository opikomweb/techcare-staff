// Staff-facing time-off / shift-change requests.
// GET  /api/time-off           -> { requests: [<row>...] }  (own requests, newest first)
// POST /api/time-off  { startDate, endDate, reason }  -> creates a pending request
// RLS (time_off_self_*) is the real enforcement; this just shapes the calls.
const { verifyAndGetPerson, withStaffAuth } = require("./_staffAuth");

module.exports = async (req, res) => {
  try {
    const result = await verifyAndGetPerson(req);
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    const { uid, person } = result;

    if (req.method === "GET") {
      const requests = await withStaffAuth(uid, async (client) => {
        const { rows } = await client.query(
          `select id, start_date, end_date, reason, status, requested_at, decision_note, decided_at
             from staff.time_off_requests
            where person_id = $1
            order by requested_at desc
            limit 50`,
          [person.id]
        );
        return rows;
      });
      return res.status(200).json({ requests });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      if (!body.startDate || !body.endDate) {
        return res.status(400).json({ error: "startDate and endDate are required." });
      }
      if (new Date(body.endDate) < new Date(body.startDate)) {
        return res.status(400).json({ error: "End date can't be before the start date." });
      }
      const row = await withStaffAuth(uid, async (client) => {
        const { rows } = await client.query(
          `insert into staff.time_off_requests (person_id, start_date, end_date, reason)
           values ($1, $2, $3, $4) returning *`,
          [person.id, body.startDate, body.endDate, body.reason || null]
        );
        return rows[0];
      });
      return res.status(201).json({ request: row });
    }

    return res.status(405).json({ error: "Method not allowed." });
  } catch (e) {
    console.error("api/time-off error:", e);
    return res.status(500).json({ error: "Server error." });
  }
};
