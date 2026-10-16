// GET /api/announcements?project=techcare
// Staff-facing read of staff.announcements — company-wide (project_id
// null) plus anything posted to a project the signed-in person has an
// active role on. RLS (announcements_visible_to_assigned_or_core_staff)
// is the real enforcement; this just shapes the response.
const { verifyAndGetPerson, withStaffAuth } = require("./_staffAuth");

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });

  try {
    const result = await verifyAndGetPerson(req);
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    const { uid } = result;
    const projectSlug = (req.query.project || "").trim();

    const announcements = await withStaffAuth(uid, async (client) => {
      const { rows } = await client.query(
        `select a.id, a.title, a.body, a.pinned, a.created_at, p.full_name as created_by_name
           from staff.announcements a
           left join staff.projects proj on proj.id = a.project_id
           left join staff.people p on p.id = a.created_by
          where a.project_id is null or proj.slug = $1
          order by a.pinned desc, a.created_at desc
          limit 50`,
        [projectSlug]
      );
      return rows;
    });

    return res.status(200).json({ announcements });
  } catch (e) {
    console.error("api/announcements error:", e);
    return res.status(500).json({ error: "Server error." });
  }
};
