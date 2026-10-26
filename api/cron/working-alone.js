// GET/POST /api/cron/working-alone — the Working Alone Watch sweep
// (ported from the n8n workflow; logic in api/_watch.js). Runs every
// minute: any job with a worker checked in (Arrived_At set, no valid
// checkout, job not Completed/Cancelled) whose first check time has
// passed gets the Decide test; an "alert" decision emails Wilton the
// URGENT escalation and records a Job_Updates row (Form_Type
// "Working Alone Watch") — those rows are the durable watch state:
// they enforce the hourly cadence (no re-alert within 55 minutes) and
// the 12-alert cap, keyed to the current Arrived_At so a new arrival
// starts a fresh watch. Same auth policy as the other cron endpoints.
const { firstCheckMs, decideWatch, alertEmailHtml } = require("../_watch");
const { requireCoreStaff } = require("../admin/_requireCoreStaff");

const BASE_ID = "appBiAKY6ivoImcaQ";
const JOBS_TABLE = "tblpsypl4j8CChNq1";
const UPDATES_TABLE = "tbldn4SgxiBjSuRBf";
const WILTON = "wilton@wilglobo.com";
const WATCH_FORM_TYPE = "Working Alone Watch";

async function atGet(path, key) {
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}${path}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`Airtable ${res.status} on ${path.split("?")[0]}`);
  return res.json();
}

async function listAll(tableId, key, formula, fields) {
  const records = [];
  let offset = null;
  do {
    const params = new URLSearchParams();
    params.set("pageSize", "100");
    if (formula) params.set("filterByFormula", formula);
    for (const f of fields || []) params.append("fields[]", f);
    if (offset) params.set("offset", offset);
    const data = await atGet(`/${tableId}?${params}`, key);
    records.push(...(data.records || []));
    offset = data.offset || null;
  } while (offset);
  return records;
}

async function sendUrgent(d, jobId) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "TechCare by WilGlobo Safety <tech@wilglobo.com>",
      to: [WILTON],
      subject: `URGENT working alone: ${d.code} ${d.worker || "worker"} has not checked out`,
      html: alertEmailHtml(d, jobId),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend ${res.status}: ${data.message || "send failed"}`);
  return data.id;
}

async function runWatch() {
  const readKey = process.env.AIRTABLE_API_KEY;
  const writeKey = process.env.AIRTABLE_WRITE_KEY || readKey;
  if (!readKey) throw new Error("AIRTABLE_API_KEY is not set.");
  const now = Date.now();

  const jobs = await listAll(
    JOBS_TABLE,
    readKey,
    "AND({Arrived_At}!='',NOT(OR({Status}='Completed',{Status}='Cancelled')))",
    ["Job_Code", "Job_Name", "Status", "Arrived_At", "Departed_At", "End_Time", "Contractor_Feedback", "Assigned_Name", "Assigned_Email", "Assigned_Phone", "Client_Name", "Client_Phone", "Location", "Client_Address"]
  );
  if (!jobs.length) return { watching: 0, alerts: [] };

  const watchRows = await listAll(
    UPDATES_TABLE,
    readKey,
    `AND({Form_Type}='${WATCH_FORM_TYPE}',IS_AFTER(CREATED_TIME(),DATEADD(NOW(),-2,'days')))`,
    ["Related_Job"]
  );

  const alerts = [];
  let watching = 0;
  for (const job of jobs) {
    const f = job.fields || {};
    const arrivedMs = f.Arrived_At ? Date.parse(f.Arrived_At) : 0;
    const departedMs = f.Departed_At ? Date.parse(f.Departed_At) : 0;
    if (departedMs && departedMs >= arrivedMs) continue; // checked out
    if (now < firstCheckMs(f, now)) continue; // not due yet
    watching += 1;

    const rows = watchRows.filter((r) => {
      const rel = (r.fields || {}).Related_Job || [];
      return rel.includes(job.id) && Date.parse(r.createdTime) >= arrivedMs;
    });
    const lastAlertMs = rows.reduce((m, r) => Math.max(m, Date.parse(r.createdTime)), 0);
    if (lastAlertMs && now - lastAlertMs < 55 * 60 * 1000) continue; // hourly cadence

    const d = decideWatch(f, rows.length, now);
    if (d.decision !== "alert") continue;

    const emailId = await sendUrgent(d, job.id);
    const n = rows.length + 1;
    await fetch(`https://api.airtable.com/v0/${BASE_ID}/${UPDATES_TABLE}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${writeKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        records: [{
          fields: {
            Submission: `${d.code || job.id} - Working alone alert ${n}`,
            Related_Job: [job.id],
            Form_Type: WATCH_FORM_TYPE,
            Submitted_By: d.worker || "Working Alone Watch",
            Status_Set: "(no status change)",
            Notes: `Alert ${n} of 12. Worker checked in ${d.arrivedAt || f.Arrived_At} and has not checked out. Urgent email sent to Wilton (Resend ${emailId || "n/a"}).`,
          },
        }],
        typecast: true,
      }),
    });
    alerts.push({ job: d.code || job.id, alert: n });
  }
  return { watching, alerts };
}

module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }
  try {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.authorization || "";
    let authorized = false;
    if (secret && auth === `Bearer ${secret}`) authorized = true;
    if (!authorized) {
      const gate = await requireCoreStaff(req).catch(() => ({ error: "no session" }));
      if (!gate.error) authorized = true;
    }
    if (!authorized && secret) return res.status(401).json({ error: "Unauthorized." });
    if (!authorized && !secret) console.warn("working-alone: CRON_SECRET not set — running unauthenticated (alerts are state-guarded).");
    const summary = await runWatch();
    return res.status(200).json({ ok: true, ...summary });
  } catch (e) {
    console.error("working-alone sweep failed:", e);
    return res.status(500).json({ error: "Working-alone sweep failed." });
  }
};
