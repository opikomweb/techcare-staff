// GET /api/job-checkins
// The worker's own jobs (recent + upcoming) with a direct link to that
// job's check-in/update form — accept, arrive, leave, finish, running
// late, problem, incident, notes and photos. The form itself already
// exists and already does all of this (n8n "Worker Job Update Form",
// linked from each job's Status_Form_URL); this endpoint just lists a
// worker's own jobs natively in the WilGlobo app instead of only inside
// the separate "My Jobs" iframe, so "check in" is a visible, branded
// button in the portal itself.
// Read-only (AIRTABLE_API_KEY) — never writes.
const { verifyAndGetContractor } = require("./_auth");

const BASE_ID = "appBiAKY6ivoImcaQ";
const JOBS_TABLE = "tblpsypl4j8CChNq1";

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });

  try {
    const result = await verifyAndGetContractor(req);
    if (result.error) return res.status(result.status).json({ error: result.error });
    const { contractor } = result;

    if (!contractor.airtable_worker_id) {
      return res.status(200).json({ jobs: [], notice: "Your account isn't linked to your Airtable worker profile yet — ask WilGlobo support." });
    }
    if (!process.env.AIRTABLE_API_KEY) {
      return res.status(503).json({ error: "Not connected yet — contact WilGlobo support to finish this setup." });
    }

    const params = new URLSearchParams();
    params.set("pageSize", "100");
    params.set(
      "filterByFormula",
      "AND({Status}!='Cancelled', {End_Time}!='', IS_AFTER({End_Time}, DATEADD(NOW(),-7,'days')), IS_BEFORE({Start_Time}, DATEADD(NOW(),30,'days')))"
    );
    ["Job_Name", "Job_Code", "Status", "Start_Time", "End_Time", "Location", "Assigned_To", "Status_Form_URL"].forEach((f) =>
      params.append("fields[]", f)
    );

    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${JOBS_TABLE}`);
    url.search = params.toString();
    const atRes = await fetch(url, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` } });
    if (!atRes.ok) {
      const text = await atRes.text().catch(() => "");
      console.error("job-checkins.js: Airtable returned", atRes.status, text.slice(0, 200));
      return res.status(502).json({ error: "Couldn't load your jobs right now. Try again shortly." });
    }
    const data = await atRes.json();
    const workerId = contractor.airtable_worker_id;

    const jobs = (data.records || [])
      .filter((r) => (r.fields.Assigned_To || []).includes(workerId))
      .map((r) => ({
        id: r.id,
        code: r.fields.Job_Code || "",
        name: r.fields.Job_Name || "Untitled job",
        status: r.fields.Status || "",
        start: r.fields.Start_Time || null,
        end: r.fields.End_Time || null,
        location: r.fields.Location || "",
        checkinUrl: r.fields.Status_Form_URL || null,
      }))
      .sort((a, b) => new Date(a.start || 0) - new Date(b.start || 0));

    return res.status(200).json({ jobs });
  } catch (e) {
    console.error("api/job-checkins error:", e);
    return res.status(500).json({ error: "Server error." });
  }
};
