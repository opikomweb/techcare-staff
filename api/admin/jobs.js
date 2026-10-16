// /api/admin/jobs — admin job list, creation, and staff assignment.
//
// Jobs_Schedules (Airtable base appBiAKY6ivoImcaQ) stays the system of
// record for ops data, same as ops-summary.js and resources.js. This
// endpoint is a thin Airtable proxy, not a new data model:
//   GET   — list recent/live jobs for the admin Jobs tab.
//   POST  — create a new Draft job (name, client, time window, location).
//   PATCH ?id=recXXXX — set Assigned_To and/or Status on an existing job.
//
// Reads use AIRTABLE_API_KEY (read-only token, same as every other admin
// endpoint). Writes use AIRTABLE_WRITE_KEY — a separate, write-scoped
// token — because the read-only key cannot create or update records.
// Until AIRTABLE_WRITE_KEY is set, POST/PATCH return a clear 503 instead
// of a confusing Airtable 403.
//
// Setting Status to "Dispatched" (with Assigned_To, Start_Time and
// End_Time already filled in) is all this endpoint does to "dispatch" a
// job — it never calls n8n directly. The existing "WilGlobo Ops Core -
// Dispatch and Calendar Invites" workflow polls Jobs_Schedules once a
// minute and picks up the change itself (same path as editing the record
// by hand in Airtable), so the compliance gate, calendar invite and
// worker email logic is reused exactly as-is, not duplicated here.
const crypto = require("crypto");
const { requireCoreStaff } = require("./_requireCoreStaff");

const BASE_ID = "appBiAKY6ivoImcaQ";
const JOBS_TABLE = "tblpsypl4j8CChNq1";

const STATUSES = ["Draft", "Dispatched", "Accepted", "In Progress", "Completed", "Issues/Blocked", "Cancelled"];

async function airtable(method, path, key, body) {
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Airtable ${path} returned ${res.status}`);
    err.status = res.status;
    err.airtable = data;
    throw err;
  }
  return data;
}

async function listJobs(readKey) {
  const params = new URLSearchParams();
  params.set("pageSize", "100");
  params.set(
    "filterByFormula",
    "AND({Status}!='Cancelled', OR({Status}!='Completed', IS_AFTER({End_Time}, DATEADD(NOW(),-30,'days'))))"
  );
  [
    "Job_Code", "Job_Name", "Status", "Start_Time", "End_Time", "Location",
    "Client", "Assigned_To", "Assigned_Email", "Dispatch_Blockers",
    "Status_Form_URL", "Open_For_Claim", "Job_Key",
  ].forEach((f) => params.append("fields[]", f));
  params.set("sort[0][field]", "Start_Time");
  params.set("sort[0][direction]", "desc");

  let records = [];
  let offset;
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${JOBS_TABLE}`);
    url.search = params.toString();
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${readKey}` } });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Airtable jobs list ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    records = records.concat(data.records || []);
    offset = data.offset;
  } while (offset);

  return records.map((r) => {
    const f = r.fields;
    return {
      id: r.id,
      code: f.Job_Code || "",
      name: f.Job_Name || "Untitled job",
      status: f.Status || "Draft",
      start: f.Start_Time || null,
      end: f.End_Time || null,
      location: f.Location || "",
      // Client and Assigned_To are Airtable link fields — the plain
      // REST API returns these as arrays of record IDs, not names. The
      // admin UI resolves IDs to names against the clients/workers lists
      // from /api/admin/job-form-data (loaded once, reused for every row)
      // rather than this endpoint guessing at a second lookup field name.
      clientIds: f.Client || [],
      assignedTo: f.Assigned_To || [],
      assignedEmails: f.Assigned_Email || [],
      blockers: f.Dispatch_Blockers || "",
      checkinUrl: f.Status_Form_URL || null,
      openForClaim: !!f.Open_For_Claim,
      recordUrl: `https://airtable.com/${BASE_ID}/${JOBS_TABLE}/${r.id}`,
    };
  });
}

module.exports = async (req, res) => {
  try {
    const gate = await requireCoreStaff(req);
    if (gate.error) return res.status(gate.status || 400).json({ error: gate.error });

    if (!process.env.AIRTABLE_API_KEY) {
      return res.status(503).json({ error: "Jobs aren't connected yet — contact WilGlobo support to finish this setup." });
    }

    if (req.method === "GET") {
      const jobs = await listJobs(process.env.AIRTABLE_API_KEY);
      return res.status(200).json({ jobs });
    }

    // POST (create) and PATCH (assign/update) both need write access.
    if (!process.env.AIRTABLE_WRITE_KEY) {
      return res.status(503).json({
        error: "Creating or assigning jobs needs a write-enabled Airtable key that hasn't been added yet — contact WilGlobo support to finish this setup.",
      });
    }
    const writeKey = process.env.AIRTABLE_WRITE_KEY;

    if (req.method === "POST") {
      const body = req.body || {};
      const jobName = String(body.jobName || "").trim();
      const clientId = String(body.clientId || "").trim();
      const startTime = String(body.startTime || "").trim();
      const endTime = String(body.endTime || "").trim();
      const location = String(body.location || "").trim();
      if (!jobName) return res.status(400).json({ error: "Job name is required." });
      if (!clientId) return res.status(400).json({ error: "Pick a client." });
      if (!startTime || !endTime) return res.status(400).json({ error: "Start and end time are required." });
      if (new Date(startTime).getTime() >= new Date(endTime).getTime()) {
        return res.status(400).json({ error: "End time must be after start time." });
      }

      const jobKey = crypto.randomBytes(16).toString("hex");
      const fields = {
        Job_Name: jobName,
        Client: [clientId],
        Start_Time: new Date(startTime).toISOString(),
        End_Time: new Date(endTime).toISOString(),
        Status: "Draft",
        Job_Key: jobKey,
      };
      if (location) fields.Location = location;

      const created = await airtable("POST", `/${JOBS_TABLE}`, writeKey, { records: [{ fields }], typecast: true });
      const rec = created.records[0];
      return res.status(201).json({
        job: {
          id: rec.id,
          code: rec.fields.Job_Code || "",
          name: rec.fields.Job_Name,
          status: rec.fields.Status,
          recordUrl: `https://airtable.com/${BASE_ID}/${JOBS_TABLE}/${rec.id}`,
        },
      });
    }

    if (req.method === "PATCH") {
      const id = String(req.query?.id || "").trim();
      if (!id || !id.startsWith("rec")) return res.status(400).json({ error: "Missing or invalid job id." });
      const body = req.body || {};
      const fields = {};
      if (Array.isArray(body.assignedTo)) {
        fields.Assigned_To = body.assignedTo.filter((x) => typeof x === "string" && x.startsWith("rec"));
      }
      if (body.status) {
        if (!STATUSES.includes(body.status)) return res.status(400).json({ error: "Unknown status." });
        fields.Status = body.status;
      }
      if (Object.keys(fields).length === 0) return res.status(400).json({ error: "Nothing to update." });

      const updated = await airtable("PATCH", `/${JOBS_TABLE}/${id}`, writeKey, { fields, typecast: true });
      return res.status(200).json({
        job: { id: updated.id, status: updated.fields.Status, assignedTo: updated.fields.Assigned_To || [] },
      });
    }

    return res.status(405).json({ error: "Method not allowed." });
  } catch (e) {
    console.error("api/admin/jobs error:", e);
    const status = e.status && e.status >= 400 && e.status < 500 ? e.status : 500;
    return res.status(status).json({ error: status === 500 ? "Couldn't reach Airtable right now." : (e.message || "Request failed.") });
  }
};
