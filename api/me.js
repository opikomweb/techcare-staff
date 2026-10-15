// GET /api/me
// Returns the signed-in person's cross-project identity: who they are, which
// projects they're on, and whether they're core staff (sees the cross-project
// shell) or a single-project person (goes straight into their one project).
// This is the first call the portal shell makes after sign-in to decide
// what to render.
const { verifyAndGetPerson } = require("./_staffAuth");

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const result = await verifyAndGetPerson(req);
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }

    const { person, roles } = result;

    return res.status(200).json({
      id: person.id,
      fullName: person.full_name,
      email: person.email,
      phone: person.phone,
      isCoreStaff: person.is_core_staff,
      emergencyContact: {
        name: person.emergency_contact_name,
        phone: person.emergency_contact_phone,
        relationship: person.emergency_contact_relationship,
      },
      projects: roles
        .filter((r) => r.role_active)
        .map((r) => ({
          slug: r.slug,
          name: r.name,
          engagementTrack: r.engagement_track,
          roleTitle: r.role_title,
        })),
    });
  } catch (e) {
    console.error("api/me error:", e);
    return res.status(500).json({ error: "Server error." });
  }
};
