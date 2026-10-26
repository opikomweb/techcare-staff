// GET  /api/admin/people            -> every staff.people row + their project roles
// POST /api/admin/people  { full_name, email, phone?, is_core_staff?,
//                           project_id?, engagement_track?, role_title? }
//      -> with no id, creates a new person. The new row starts active with
//      no auth_user_id; their first magic-link sign-in claims it by email
//      (see verifyAndGetPerson in ../_staffAuth.js). If project_id and
//      engagement_track are given, the person is also assigned to that
//      project in the same transaction.
// POST /api/admin/people  { id, full_name?, phone?, is_core_staff?, active? }
//      -> with an id, edits that person's record. Reassigning projects is
//      done through /api/admin/roles, not here.
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

    const body = req.body || {};

    // POST without an id — create a new person
    if (!body.id) {
      const fullName = String(body.full_name || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const phone = body.phone ? String(body.phone).trim() || null : null;
      if (!fullName) return res.status(400).json({ error: "Full name is required." });
      if (fullName.length > 120) return res.status(400).json({ error: "Full name is too long." });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: "A valid email is required — it is how the person signs in." });
      }
      if (body.project_id && !body.engagement_track) {
        return res.status(400).json({ error: "Pick an engagement track to assign the project." });
      }

      try {
        const created = await withStaffAuth(uid, async (client) => {
          const blocked = await rateLimited(client, actor.id, "admin.people.write", 30, 300);
          if (blocked) throw Object.assign(new Error("Too many changes in a short time — wait a few minutes and try again."), { httpStatus: 429 });

          const { rows } = await client.query(
            `insert into staff.people (full_name, email, phone, is_core_staff, active)
             values ($1, $2, $3, $4, true)
             returning id, full_name, email, phone, is_core_staff, active`,
            [fullName, email, phone, body.is_core_staff === true]
          );
          const person = rows[0];

          let assigned = false;
          if (body.project_id) {
            await client.query(
              `insert into staff.project_roles (person_id, project_id, engagement_track, role_title, active)
               values ($1, $2, $3, $4, true)`,
              [person.id, body.project_id, body.engagement_track, body.role_title ? String(body.role_title).trim() || null : null]
            );
            assigned = true;
          }

          await logAudit(client, {
            actorPersonId: actor.id,
            actorEmail: actor.email,
            action: "people.create",
            entityType: "person",
            entityId: person.id,
            detail: { email, is_core_staff: person.is_core_staff, assigned_project_id: body.project_id || null },
          });
          return { person, assigned };
        });
        return res.status(201).json(created);
      } catch (e) {
        if (e.httpStatus) throw e;
        if (e.code === "23505") {
          return res.status(409).json({ error: "That email is already on file — this person may already have a staff record." });
        }
        if (e.code === "42501") {
          return res.status(403).json({ error: "The database blocked this insert (row-level security). A staff.people insert policy for core staff is needed." });
        }
        throw e;
      }
    }

    // POST with an id — edit one person

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
