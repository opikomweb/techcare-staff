// GET /api/admin/projects -> staff.projects list, for the project dropdowns
// in the admin screen (resources editor, people editor). Read-only for now.
const { requireCoreStaff } = require("./_requireCoreStaff");
const { withStaffAuth } = require("../_staffAuth");

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });
  try {
    const gate = await requireCoreStaff(req);
    if (gate.error) return res.status(gate.status || 400).json({ error: gate.error });
    const { uid } = gate;

    const projects = await withStaffAuth(uid, async (client) => {
      const { rows } = await client.query(
        `select id, slug, name, description, status from staff.projects order by name`
      );
      return rows;
    });
    return res.status(200).json({ projects });
  } catch (e) {
    console.error("api/admin/projects error:", e);
    return res.status(500).json({ error: "Server error." });
  }
};
