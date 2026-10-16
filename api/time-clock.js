// Staff-facing time clock.
// GET  /api/time-clock            -> { open: <row|null>, recent: [<row>...] }
// POST /api/time-clock  { action: "clock_in",  jobRef? }
// POST /api/time-clock  { action: "clock_out", notes? }
//
// One open entry (clock_out is null) per person at a time — clocking in
// again while one is open is rejected rather than silently opening a
// second shift. RLS (time_entries_self_*) is the real enforcement; this
// just shapes the calls.
const { verifyAndGetPerson, withStaffAuth } = require("./_staffAuth");

module.exports = async (req, res) => {
  try {
    const result = await verifyAndGetPerson(req);
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    const { uid, person } = result;

    if (req.method === "GET") {
      const data = await withStaffAuth(uid, async (client) => {
        const { rows: openRows } = await client.query(
          `select id, job_ref, clock_in from staff.time_entries
            where person_id = $1 and clock_out is null
            order by clock_in desc limit 1`,
          [person.id]
        );
        const { rows: recent } = await client.query(
          `select id, job_ref, clock_in, clock_out, notes from staff.time_entries
            where person_id = $1
            order by clock_in desc limit 20`,
          [person.id]
        );
        return { open: openRows[0] || null, recent };
      });
      return res.status(200).json(data);
    }

    if (req.method === "POST") {
      const body = req.body || {};

      if (body.action === "clock_in") {
        const row = await withStaffAuth(uid, async (client) => {
          const { rows: openRows } = await client.query(
            `select id from staff.time_entries where person_id = $1 and clock_out is null`,
            [person.id]
          );
          if (openRows.length) {
            throw Object.assign(new Error("You're already clocked in — clock out first."), { httpStatus: 409 });
          }
          const { rows } = await client.query(
            `insert into staff.time_entries (person_id, job_ref) values ($1, $2) returning *`,
            [person.id, body.jobRef || null]
          );
          return rows[0];
        });
        return res.status(201).json({ entry: row });
      }

      if (body.action === "clock_out") {
        const row = await withStaffAuth(uid, async (client) => {
          const { rows: openRows } = await client.query(
            `select id from staff.time_entries where person_id = $1 and clock_out is null
              order by clock_in desc limit 1`,
            [person.id]
          );
          if (!openRows.length) {
            throw Object.assign(new Error("You're not clocked in right now."), { httpStatus: 409 });
          }
          const { rows } = await client.query(
            `update staff.time_entries set clock_out = now(), notes = coalesce($2, notes)
              where id = $1 returning *`,
            [openRows[0].id, body.notes || null]
          );
          return rows[0];
        });
        return res.status(200).json({ entry: row });
      }

      return res.status(400).json({ error: "action must be clock_in or clock_out." });
    }

    return res.status(405).json({ error: "Method not allowed." });
  } catch (e) {
    if (e.httpStatus) return res.status(e.httpStatus).json({ error: e.message });
    console.error("api/time-clock error:", e);
    return res.status(500).json({ error: "Server error." });
  }
};
