// GET /api/admin/job-activity
// Feed of worker check-ins, notes, photos and incident reports, straight
// from Airtable's Contextual_Forms table — the log the existing "Worker
// Job Update Form" (n8n) already writes to every time someone accepts a
// job, checks in/out, reports a problem, or files an incident, photos
// included (uploaded to Drive, linked in Notes). This endpoint doesn't
// create or change that flow; it just surfaces it on the admin dashboard
// instead of leaving it something only visible by opening Airtable.
// Read-only (AIRTABLE_API_KEY).
const { requireCoreStaff } = require("./_requireCoreStaff");

const BASE_ID = "appBiAKY6ivoImcaQ";
const FORMS_TABLE = "tbldn4SgxiBjSuRBf";
const JOBS_TABLE = "tblpsypl4j8CChNq1";

async function airtableList(tableId, fieldIds, extraParams) {
  const params = new URLSearchParams();
  params.set("pageSize", String(extraParams?.pageSize || 100));
  for (const f of fieldIds) params.append("fields[]", f);
  if (extraParams?.sortField) {
    params.set("sort[0][field]", extraParams.sortField);
    params.set("sort[0][direction]", extraParams.sortDir || "desc");
  }
  if (extraParams?.maxRecords) params.set("maxRecords", String(extraParams.maxRecords));
  const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${tableId}`);
  url.search = params.toString();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Airtable ${tableId} ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.records || [];
}

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });

  try {
    const gate = await requireCoreStaff(req);
    if (gate.error) return res.status(gate.status || 400).json({ error: gate.error });

    if (!process.env.AIRTABLE_API_KEY) {
      return res.status(503).json({ error: "Not connected yet — contact WilGlobo support to finish this setup." });
    }

    const records = await airtableList(
      FORMS_TABLE,
      ["Submission", "Related_Job", "Form_Type", "Submitted_By", "Status_Set", "Notes", "Link_Provided", "Incident_Severity"],
      { sortField: "Submitted_At", sortDir: "desc", maxRecords: 40 }
    ).catch(async () => {
      // Submitted_At may not be the real created-time field name — fall
      // back to Airtable's row order (newest last) without a server sort
      // rather than fail the whole feed over a field-name guess.
      return airtableList(
        FORMS_TABLE,
        ["Submission", "Related_Job", "Form_Type", "Submitted_By", "Status_Set", "Notes", "Link_Provided", "Incident_Severity"],
        { maxRecords: 40 }
      );
    });

    const entries = records
      .map((r) => {
        const f = r.fields;
        const jobId = (f.Related_Job || [])[0] || null;
        const incident = f.Incident_Severity || "";
        const urgent = f.Form_Type === "Incident Report" || (f.Status_Set || "").includes("Issues") || !!incident;
        return {
          id: r.id,
          submission: f.Submission || "",
          formType: f.Form_Type || "",
          submittedBy: f.Submitted_By || "Unknown",
          statusSet: f.Status_Set || "",
          notes: f.Notes || "",
          link: f.Link_Provided || null,
          incident,
          urgent,
          jobRecordUrl: jobId ? `https://airtable.com/${BASE_ID}/${JOBS_TABLE}/${jobId}` : null,
          recordUrl: `https://airtable.com/${BASE_ID}/${FORMS_TABLE}/${r.id}`,
        };
      })
      .reverse(); // newest first when createdTime sort wasn't available

    return res.status(200).json({ entries });
  } catch (e) {
    console.error("api/admin/job-activity error:", e);
    return res.status(500).json({ error: "Couldn't load job activity right now." });
  }
};
