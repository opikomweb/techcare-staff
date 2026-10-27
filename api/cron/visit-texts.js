// GET/POST /api/cron/visit-texts — the two visit-day worker texts
// (added Oct 27, 2026 at Opik's direction; these did not exist in
// n8n). Minutely sweep with two passes, each sent at most once per
// job (durable markers as Job_Updates rows, the Working Alone Watch
// pattern):
//
//  1. "Visit Soon" — about 30 minutes before Start_Time, the worker
//     is texted the visit (client, time, address) and the job's
//     consent-page link, so at the door they can ask the client to
//     confirm the itemised work + waiver before the task begins.
//  2. "Wrap-Up Prompt" — at the planned End_Time, the worker is
//     texted the job-update link and asked whether the client
//     requested anything extra: if yes, note what it was in the
//     feedback; if no, just record feedback and mark the job
//     complete. (Additions land in Contractor_Feedback, where the
//     Feedback Keyword Watch already surfaces them to Wilton; the
//     invoice is then built from Job_Tasks at the agreed rates.)
//
// Sends go through api/_sms.js (the guarded Twilio path, STOP line
// included, 320-char cap enforced — a text that cannot fit is
// skipped and logged, never truncated). Same auth policy as the
// other cron endpoints.
const { validateSms, sendSms, workerPhoneE164 } = require("../_sms");
const { soonText, wrapText, decideSoon, decideWrap } = require("../_visitTexts");
const { requireCoreStaff } = require("../admin/_requireCoreStaff");

const BASE_ID = "appBiAKY6ivoImcaQ";
const JOBS_TABLE = "tblpsypl4j8CChNq1";
const UPDATES_TABLE = "tbldn4SgxiBjSuRBf";
const SOON_TYPE = "Visit Soon Text";
const WRAP_TYPE = "Wrap-Up Prompt";

const first = (v) => (Array.isArray(v) ? v[0] || "" : v || "");

async function fetchJobs(readKey, formula, fields) {
  const params = new URLSearchParams();
  params.set("pageSize", "100");
  params.set("filterByFormula", formula);
  for (const f of fields) params.append("fields[]", f);
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${JOBS_TABLE}?${params}`, {
    headers: { Authorization: `Bearer ${readKey}` },
  });
  if (!res.ok) throw new Error(`Airtable visit-texts scan ${res.status}`);
  const data = await res.json();
  return data.records || [];
}

async function sentJobIds(readKey, formType) {
  const params = new URLSearchParams();
  params.set("pageSize", "100");
  params.set("filterByFormula", `AND({Form_Type}='${formType}',IS_AFTER(CREATED_TIME(),DATEADD(NOW(),-2,'days')))`);
  for (const f of ["Related_Job"]) params.append("fields[]", f);
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${UPDATES_TABLE}?${params}`, {
    headers: { Authorization: `Bearer ${readKey}` },
  });
  if (!res.ok) throw new Error(`Airtable marker scan ${res.status}`);
  const data = await res.json();
  const ids = new Set();
  for (const r of data.records || []) {
    for (const j of (r.fields || {}).Related_Job || []) ids.add(j);
  }
  return ids;
}

async function markSent(writeKey, job, formType, code) {
  await fetch(`https://api.airtable.com/v0/${BASE_ID}/${UPDATES_TABLE}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${writeKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      records: [{
        fields: {
          Submission: `${code || job.id} - ${formType}`,
          Related_Job: [job.id],
          Form_Type: formType,
          Submitted_By: "Visit Texts (portal)",
          Status_Set: "(no status change)",
          Notes: `${formType} sent to the assigned worker by SMS.`,
        },
      }],
      typecast: true,
    }),
  });
}

async function runVisitTexts(nowMs = Date.now()) {
  const readKey = process.env.AIRTABLE_API_KEY;
  const writeKey = process.env.AIRTABLE_WRITE_KEY || readKey;
  if (!readKey) throw new Error("AIRTABLE_API_KEY is not set.");
  const out = { soon: [], wrap: [] };

  // Pass 1 — Visit Soon
  const soonSent = await sentJobIds(readKey, SOON_TYPE);
  const soonJobs = await fetchJobs(readKey,
    "AND(OR({Status}='Accepted',{Status}='Dispatched'),IS_AFTER({Start_Time},DATEADD(NOW(),-5,'minutes')),IS_BEFORE({Start_Time},DATEADD(NOW(),35,'minutes')))",
    ["Job_Name", "Job_Code", "Client_Name", "Location", "Start_Time", "Assigned_Phone", "Job_Key"]);
  for (const job of soonJobs) {
    const f = job.fields || {};
    if (soonSent.has(job.id) || !decideSoon(f, nowMs)) continue;
    const phone = workerPhoneE164(first(f.Assigned_Phone));
    if (!phone) { out.soon.push({ job: f.Job_Code || job.id, skipped: "no_worker_phone" }); continue; }
    const v = validateSms(phone, soonText(f, job.id));
    if (!v.valid) { out.soon.push({ job: f.Job_Code || job.id, skipped: "invalid", error: v.error }); continue; }
    const { sid } = await sendSms(v.to, v.body);
    await markSent(writeKey, job, SOON_TYPE, f.Job_Code);
    out.soon.push({ job: f.Job_Code || job.id, texted: phone, sid });
  }

  // Pass 2 — Wrap-Up Prompt
  const wrapSent = await sentJobIds(readKey, WRAP_TYPE);
  const wrapJobs = await fetchJobs(readKey,
    "AND(OR({Status}='In Progress',{Status}='Accepted'),IS_AFTER({End_Time},DATEADD(NOW(),-25,'minutes')),IS_BEFORE({End_Time},DATEADD(NOW(),1,'minutes')))",
    ["Job_Name", "Job_Code", "Client_Name", "End_Time", "Assigned_Phone", "Status_Form_URL"]);
  for (const job of wrapJobs) {
    const f = job.fields || {};
    if (wrapSent.has(job.id) || !decideWrap(f, nowMs)) continue;
    const phone = workerPhoneE164(first(f.Assigned_Phone));
    if (!phone) { out.wrap.push({ job: f.Job_Code || job.id, skipped: "no_worker_phone" }); continue; }
    const v = validateSms(phone, wrapText(f));
    if (!v.valid) { out.wrap.push({ job: f.Job_Code || job.id, skipped: "invalid", error: v.error }); continue; }
    const { sid } = await sendSms(v.to, v.body);
    await markSent(writeKey, job, WRAP_TYPE, f.Job_Code);
    out.wrap.push({ job: f.Job_Code || job.id, texted: phone, sid });
  }

  return out;
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
    if (!authorized && !secret) console.warn("visit-texts: CRON_SECRET not set — running unauthenticated (once-only markers guard sends).");
    const summary = await runVisitTexts();
    return res.status(200).json({ ok: true, ...summary });
  } catch (e) {
    console.error("visit-texts failed:", e);
    return res.status(500).json({ error: "Visit texts sweep failed." });
  }
};

module.exports._test = { runVisitTexts };
