// /api/admin/ops — the Operations tab: handy editing for the
// Airtable ops data (jobs + their tasks, clients, Directory staff,
// Inbox requests, follow-ups) without leaving the portal. Core-staff
// gated like every admin endpoint; reads use AIRTABLE_API_KEY,
// writes use AIRTABLE_WRITE_KEY. Airtable stays the system of
// record — this is a friendlier front end on the same tables the
// sweeps and forms already use, with strict field whitelists so the
// UI can never scribble on formulas or system fields.
//
// GET  ?view=job&id=rec…   one job: fields, tasks, recent updates
// GET  ?view=clients       all clients
// GET  ?view=staff         all Directory workers
// GET  ?view=pending       Inbox rows + open follow-ups
// POST { action, … }       update_job | save_task | delete_task |
//                          update_client | create_client |
//                          update_worker | followup_done |
//                          add_job_note | convert_inbox
const { requireCoreStaff } = require("./_requireCoreStaff");
const { runConvert } = require("../_inboxConvert");

const BASE_ID = "appBiAKY6ivoImcaQ";
const JOBS = "tblpsypl4j8CChNq1";
const TASKS = "tblDgvj31fP5rMvkI";
const CLIENTS = "tblY473voC9AylgFF";
const DIRECTORY = "tbllgRxtl2LbCMg2O";
const INBOX = "tblMCfG4rm7G6l3nH";
const FOLLOWUPS = "tblfxDBlBIcnWIT8E";
const UPDATES = "tbldn4SgxiBjSuRBf";

const { STATUSES, isRec, str, pickFields, shapeJobFields, shapeClientFields, shapeWorkerFields } = require("./_opsShape");

async function airtable(method, path, body, write) {
  const key = write ? process.env.AIRTABLE_WRITE_KEY : process.env.AIRTABLE_API_KEY;
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data.error && data.error.message) || `Airtable ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function listAll(table, fields, formula) {
  const params = new URLSearchParams();
  params.set("pageSize", "100");
  if (formula) params.set("filterByFormula", formula);
  for (const f of fields) params.append("fields[]", f);
  let records = [];
  let offset;
  do {
    if (offset) params.set("offset", offset);
    const data = await airtable("GET", `/${table}?${params.toString()}`, null, false);
    records = records.concat(data.records || []);
    offset = data.offset;
  } while (offset);
  return records;
}

module.exports = async (req, res) => {
  try {
    const gate = await requireCoreStaff(req);
    if (gate.error) return res.status(gate.status || 400).json({ error: gate.error });
    if (!process.env.AIRTABLE_API_KEY) return res.status(503).json({ error: "Not connected yet." });

    if (req.method === "GET") {
      const view = (req.query && req.query.view) || "";
      if (view === "job") {
        const id = (req.query && req.query.id) || "";
        if (!isRec(id)) return res.status(400).json({ error: "Invalid job id." });
        const job = await airtable("GET", `/${JOBS}/${id}`, null, false);
        const taskRecs = await listAll(TASKS, ["Task_Line", "Quantity", "Unit_Price", "Worker_Rate", "Line_Total", "Worker_Pay", "Job"]);
        const tasks = taskRecs.filter((t) => (((t.fields || {}).Job) || []).includes(id)).map((t) => ({ id: t.id, ...(t.fields || {}) }));
        const updRecs = await listAll(UPDATES, ["Submission", "Form_Type", "Submitted_By", "Status_Set", "Notes", "Related_Job", "Submitted_At"]);
        const updates = updRecs
          .filter((u) => (((u.fields || {}).Related_Job) || []).includes(id))
          .map((u) => ({ id: u.id, created: u.createdTime, ...(u.fields || {}) }))
          .sort((a, b) => String(b.created).localeCompare(String(a.created)))
          .slice(0, 20);
        const f = job.fields || {};
        const jobOut = { id: job.id };
        for (const k of JOB_FIELDS) jobOut[k] = f[k];
        return res.status(200).json({ job: jobOut, tasks, updates });
      }
      if (view === "clients") {
        const recs = await listAll(CLIENTS, CLIENT_FIELDS);
        return res.status(200).json({ clients: recs.map((r) => ({ id: r.id, ...(r.fields || {}) })).sort((a, b) => String(a.Client_Name || "").localeCompare(String(b.Client_Name || ""))) });
      }
      if (view === "staff") {
        const recs = await listAll(DIRECTORY, WORKER_FIELDS);
        return res.status(200).json({ staff: recs.map((r) => ({ id: r.id, ...(r.fields || {}) })).sort((a, b) => String(a.Full_Name || "").localeCompare(String(b.Full_Name || ""))) });
      }
      if (view === "pending") {
        const inbox = await listAll(INBOX, ["Summary", "Source", "Status", "Urgency", "Caller_Name", "Phone", "Email", "City", "Need", "Service_Guess", "Preferred_Time", "Received_At", "Callback_Due", "Client", "Job"]);
        let followups = [];
        try {
          const fu = await listAll(FOLLOWUPS, ["Task_Title", "Status", "Matched_Keywords", "Source_Note", "Priority", "Related_Job", "Created_At"]);
          followups = fu.map((r) => ({ id: r.id, created: r.createdTime, ...(r.fields || {}) }));
        } catch (e) { /* follow-ups table readable only once the watch writes; show empty */ }
        return res.status(200).json({
          inbox: inbox.map((r) => ({ id: r.id, created: r.createdTime, ...(r.fields || {}) })),
          followups,
        });
      }
      return res.status(400).json({ error: "Unknown view." });
    }

    if (req.method === "POST") {
      if (!process.env.AIRTABLE_WRITE_KEY) return res.status(503).json({ error: "Editing needs the write key — it hasn't been added yet." });
      const body = req.body || {};
      const action = body.action;

      if (action === "update_job") {
        if (!isRec(body.id)) return res.status(400).json({ error: "Invalid job id." });
        const fields = shapeJobFields(pickFields(body, ["Job_Name", "Location", "Status", "Start_Time", "End_Time", "Assigned_To", "Open_For_Claim"]));
        if (!Object.keys(fields).length) return res.status(400).json({ error: "Nothing to update." });
        const updated = await airtable("PATCH", `/${JOBS}/${body.id}`, { fields, typecast: true }, true);
        let dispatch = null;
        try {
          const { runDispatchSync } = require("../_dispatch");
          dispatch = await runDispatchSync({ jobId: body.id });
        } catch (e) { console.error("ops update_job dispatch sync failed:", e); }
        return res.status(200).json({ ok: true, job: { id: updated.id, ...(updated.fields || {}) }, dispatch });
      }

      if (action === "save_task") {
        const fields = {
          Task_Line: str(body.Task_Line),
          Quantity: Number(body.Quantity) || 1,
          Unit_Price: Number(body.Unit_Price) || 0,
          Worker_Rate: Number(body.Worker_Rate) || 0,
        };
        if (!fields.Task_Line) return res.status(400).json({ error: "Describe the task." });
        if (body.taskId && isRec(body.taskId)) {
          const updated = await airtable("PATCH", `/${TASKS}/${body.taskId}`, { fields, typecast: true }, true);
          return res.status(200).json({ ok: true, task: { id: updated.id, ...(updated.fields || {}) } });
        }
        if (!isRec(body.jobId)) return res.status(400).json({ error: "Invalid job id." });
        fields.Job = [body.jobId];
        const created = await airtable("POST", `/${TASKS}`, { records: [{ fields }], typecast: true }, true);
        return res.status(201).json({ ok: true, task: { id: created.records[0].id, ...(created.records[0].fields || {}) } });
      }

      if (action === "delete_task") {
        if (!isRec(body.taskId)) return res.status(400).json({ error: "Invalid task id." });
        await airtable("DELETE", `/${TASKS}/${body.taskId}`, null, true);
        return res.status(200).json({ ok: true });
      }

      if (action === "update_client" || action === "create_client") {
        const fields = shapeClientFields(pickFields(body, ["Client_Name", "Phone", "Email", "Service_Address", "City", "Preferred_Contact", "Support_Person", "Support_Person_Contact", "Accessibility_Notes", "Notes", "Marketing_Consent"]));
        if (action === "create_client") {
          if (!fields.Client_Name) return res.status(400).json({ error: "Client name is required." });
          const created = await airtable("POST", `/${CLIENTS}`, { records: [{ fields }], typecast: true }, true);
          return res.status(201).json({ ok: true, client: { id: created.records[0].id, ...(created.records[0].fields || {}) } });
        }
        if (!isRec(body.id)) return res.status(400).json({ error: "Invalid client id." });
        const updated = await airtable("PATCH", `/${CLIENTS}/${body.id}`, { fields, typecast: true }, true);
        return res.status(200).json({ ok: true, client: { id: updated.id, ...(updated.fields || {}) } });
      }

      if (action === "update_worker") {
        if (!isRec(body.id)) return res.status(400).json({ error: "Invalid worker id." });
        const fields = shapeWorkerFields(pickFields(body, ["Full_Name", "Email", "Phone_E164", "Status", "Worker_Type", "Pay_Basis", "Engagement_Track", "Role", "Default_Hourly_Rate", "Skills", "Police_Check_Date", "Insurance_Expiry", "WCB_Clearance_Expiry", "Business_Name_or_GST", "Notes"]));
        if (!Object.keys(fields).length) return res.status(400).json({ error: "Nothing to update." });
        const updated = await airtable("PATCH", `/${DIRECTORY}/${body.id}`, { fields, typecast: true }, true);
        return res.status(200).json({ ok: true, worker: { id: updated.id, ...(updated.fields || {}) } });
      }

      if (action === "followup_done") {
        if (!isRec(body.id)) return res.status(400).json({ error: "Invalid follow-up id." });
        await airtable("PATCH", `/${FOLLOWUPS}/${body.id}`, { fields: { Status: "Done" }, typecast: true }, true);
        return res.status(200).json({ ok: true });
      }

      if (action === "add_job_note") {
        if (!isRec(body.jobId)) return res.status(400).json({ error: "Invalid job id." });
        const text = str(body.text);
        if (!text) return res.status(400).json({ error: "Write the note first." });
        await airtable("POST", `/${UPDATES}`, {
          records: [{
            fields: {
              Submission: `${body.jobCode || body.jobId} - Admin note`,
              Related_Job: [body.jobId],
              Form_Type: "Admin Note",
              Submitted_By: gate.person && gate.person.email ? gate.person.email : "Admin",
              Status_Set: "(no status change)",
              Notes: text,
            },
          }],
          typecast: true,
        }, true);
        return res.status(201).json({ ok: true });
      }

      if (action === "convert_inbox") {
        if (!isRec(body.id)) return res.status(400).json({ error: "Invalid inbox id." });
        const result = await runConvert(body.id);
        return res.status(200).json({ ok: true, result });
      }

      return res.status(400).json({ error: "Unknown action." });
    }

    return res.status(405).json({ error: "Method not allowed." });
  } catch (e) {
    console.error("api/admin/ops error:", e);
    const status = e.status && e.status >= 400 && e.status < 500 ? e.status : 500;
    return res.status(status).json({ error: status === 500 ? "Couldn't reach Airtable right now." : (e.message || "Request failed.") });
  }
};

