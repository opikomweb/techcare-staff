// GET /api/resources?project=techcare
// Lists the forms/agreements/codes of conduct/policies relevant to the
// signed-in person for that project — filtered to their engagement track
// (staff vs part-time/temporary/volunteer/independent_contractor) when a
// resource specifies one. staff.resources has no seed content yet (nothing
// fabricated here) — an empty list is an honest "ask WilGlobo support to add these,"
// not a bug.
const { verifyAndGetPerson, withStaffAuth } = require("./_staffAuth");

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const result = await verifyAndGetPerson(req);
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    const { person, roles, uid } = result;

    const projectSlug = (req.query && req.query.project) || null;
    const role = projectSlug ? roles.find((r) => r.slug === projectSlug) : null;
    const engagementTrack = role ? role.engagement_track : null;

    if (projectSlug && !role && !person.is_core_staff) {
      return res.status(403).json({ error: "You're not on that project." });
    }

    const resources = await withStaffAuth(uid, async (client) => {
      const { rows } = await client.query(
        `select r.id, r.category, r.title, r.description, r.url, r.required, r.engagement_tracks
           from staff.resources r
           left join staff.projects p on p.id = r.project_id
          where (r.project_id is null or p.slug = $1 or $1 is null)
            and (
              r.engagement_tracks is null
              or array_length(r.engagement_tracks, 1) is null
              or $2::text is null
              or $2::text = any(r.engagement_tracks)
            )
          order by r.sort_order, r.title`,
        [projectSlug, engagementTrack]
      );
      return rows;
    });

    return res.status(200).json({
      resources: resources.map((r) => ({
        id: r.id,
        category: r.category,
        title: r.title,
        description: r.description,
        url: r.url,
        required: r.required,
      })),
      notice: resources.length === 0 ? "No resources have been added for this project yet — ask WilGlobo support." : null,
    });
  } catch (e) {
    console.error("api/resources error:", e);
    return res.status(500).json({ error: "Server error." });
  }
};
