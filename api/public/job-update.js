// GET  /job-update?job=<Jobs record id>&c=<Job_Key>   — the form page
// POST /api/public/job-update                          — a submission
//
// The worker's one link for everything on a job — a faithful port of the
// retired n8n "Worker Job Update Form" (n8n retirement, tranche 3),
// preserving its update→status mapping, its Job_Updates log row, its
// append-only Contractor_Feedback line format (parsed by the Working
// Alone Watch and Feedback Keyword Watch), its notify rules, and its
// bad-link behavior (no writes, one email to Wilton, same thank-you
// page either way).
//
// Known gap vs the n8n form: photo uploads. The n8n form uploaded photos
// to a Google Drive folder; the portal has no Drive connection, so this
// form has no photo field for now — workers can paste a link to photos
// in the "Link to photos or files" field instead. Wire Drive uploads
// here when a Drive credential exists.
const { pageShell, sendHtml, esc } = require("./_pageShell");

const BASE_ID = "appBiAKY6ivoImcaQ";
const JOBS_TABLE = "tblpsypl4j8CChNq1";
const UPDATES_TABLE = "tbldn4SgxiBjSuRBf";
const WILTON = "wilton@wilglobo.com";
const FROM = "TechCare by WilGlobo Dispatch <tech@wilglobo.com>";
const THANK_YOU = "Thank you. Your update is recorded. For anything urgent or unsafe, call WilGlobo now at 403-679-3039. In an emergency, call 911 first.";
const JOB_KEY_RE = /^[a-f0-9]{32}$/;

const UPDATES = [
  "I accept this job",
  "Arrived on site",
  "Left the site",
  "Job completed",
  "Running late",
  "Problem or blocked",
  "Incident report",
];
const INCIDENT_TYPES = ["Not an incident", "Near miss", "Property damage", "Injury", "Privacy / data", "Client complaint"];

// update → status / form type / arrival-departure stamps / notify.
// Ported verbatim, including: "Left the site" stamps Departed_At but
// leaves Status alone; "Job completed" sets Completed AND Departed_At;
// an unknown value defaults to a notifying Site Check-in.
function mapUpdate(update) {
  switch (update) {
    case "I accept this job": return { status: "Accepted", formType: "Accept Job", notify: true };
    case "Arrived on site": return { status: "In Progress", formType: "Site Check-in", arrived: true };
    case "Left the site": return { formType: "Site Check-in", departed: true };
    case "Job completed": return { status: "Completed", formType: "Milestone Signoff", departed: true, notify: true };
    case "Running late": return { formType: "Site Check-in", notify: true };
    case "Problem or blocked": return { status: "Issues/Blocked", formType: "Incident Report", notify: true };
    case "Incident report": return { formType: "Incident Report", notify: true };
    default: return { formType: "Site Check-in", notify: true };
  }
}

function feedbackStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false, reason: "email_not_configured" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [to], subject, html }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { sent: false, reason: "email_send_failed", error: data.message || res.status };
    return { sent: true, id: data.id };
  } catch (e) {
    return { sent: false, reason: "email_send_failed", error: String(e) };
  }
}

async function airtable(method, path, key, body) {
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data && data.error && data.error.message) || `Airtable ${path} ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function formPage(job, c) {
  const options = UPDATES.map((u) => `<option value="${esc(u)}">${esc(u)}</option>`).join("");
  const incidentOptions = INCIDENT_TYPES.map((u) => `<option value="${esc(u)}">${esc(u)}</option>`).join("");
  const body = `
<h1>TechCare by WilGlobo: job update</h1>
<p class="sub">Use this link for every update on this job: accept it, arrive, leave, finish, or report a problem. It takes 30 seconds. Never type a client password or card number here.</p>
<form id="f" method="post">
  <label for="update">What is happening?</label>
  <select id="update" name="update" required>${options}</select>
  <label for="worker_name">Your full name</label>
  <input type="text" id="worker_name" name="worker_name" required autocomplete="name">
  <label for="notes">Notes</label>
  <textarea id="notes" name="notes"></textarea>
  <label for="new_finish">If running late: new expected finish time</label>
  <input type="text" id="new_finish" name="new_finish" placeholder="e.g. 3:45 PM">
  <label for="incident_type">Incident type</label>
  <select id="incident_type" name="incident_type">${incidentOptions}</select>
  <label for="link">Link to photos or files</label>
  <input type="text" id="link" name="link" placeholder="https://…">
  <button class="submit" type="submit">Send update</button>
  <p class="notice" id="msg" style="margin-top:10px"></p>
</form>
<script>
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = { job: ${JSON.stringify(job)}, c: ${JSON.stringify(c)} };
  for (const [k, v] of fd.entries()) payload[k] = v;
  const msg = document.getElementById('msg');
  msg.textContent = 'Sending…';
  try {
    const res = await fetch('/api/public/job-update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const html = await res.text();
    document.open(); document.write(html); document.close();
  } catch (err) {
    msg.textContent = 'Could not send. Check your connection and try again, or call 403-679-3039.';
  }
});
</script>`;
  return pageShell({ title: "Job update | TechCare by WilGlobo", body });
}

function thankYouPage() {
  return pageShell({
    title: "Recorded | TechCare by WilGlobo",
    body: `<h1>Recorded</h1><div class="empty">${esc(THANK_YOU)}</div>`,
  });
}

async function handleSubmission(req, res) {
  const b = req.body || {};
  const job = String(b.job || "").trim();
  const c = String(b.c || "").trim().toLowerCase();
  const update = String(b.update || "").trim();
  const workerName = String(b.worker_name || "").trim();
  const notes = String(b.notes || "").trim();
  const newFinish = String(b.new_finish || "").trim();
  const incidentTypeRaw = String(b.incident_type || "").trim();
  const link = String(b.link || "").trim();

  const readKey = process.env.AIRTABLE_API_KEY;
  const writeKey = process.env.AIRTABLE_WRITE_KEY || process.env.AIRTABLE_API_KEY;

  let jobRec = null;
  if (readKey && job.startsWith("rec")) {
    jobRec = await airtable("GET", `/${JOBS_TABLE}/${job}`, readKey).catch(() => null);
  }
  const jf = (jobRec && jobRec.fields) || {};
  const realKey = String(jf.Job_Key || "").trim().toLowerCase();
  const isReal = !!jobRec && jobRec.id === job && JOB_KEY_RE.test(realKey) && c === realKey;

  if (!isReal) {
    // Bad link: no writes anywhere — one email to Wilton, and the worker
    // sees the same thank-you page as a valid submission.
    await sendEmail({
      to: WILTON,
      subject: `Job update with no matching job: ${update} from ${workerName}`,
      html: `<div style="font-family:Arial,sans-serif;font-size:15px"><p>A job update was submitted with a link that does not match any job, so <b>nothing was changed in Airtable</b>.</p><p><b>Update:</b> ${esc(update)}<br><b>Name given:</b> ${esc(workerName)}<br><b>Job value:</b> ${esc(job)}<br><b>Notes:</b> ${esc(notes)}</p><p>Links from before 13 Oct no longer work — if this was a real worker, send them the current job link.</p></div>`,
    }).catch(() => {});
    return sendHtml(res, thankYouPage());
  }

  const m = mapUpdate(update);
  const incident = incidentTypeRaw && incidentTypeRaw !== "Not an incident" ? incidentTypeRaw : "";
  const urgent = update === "Problem or blocked" || update === "Incident report" || incident === "Injury" || incident === "Privacy / data";
  const notify = !!m.notify || urgent;
  const nowIso = new Date().toISOString();

  // Append-only feedback line (format parsed by other workflows — keep exact).
  let feedback = null;
  if (notes || update === "Running late") {
    const line = `[${feedbackStamp()}] ${workerName} - ${update}${newFinish ? ` (new finish ${newFinish})` : ""}${notes ? `: ${notes}` : ""}`;
    const existing = String(jf.Contractor_Feedback || "");
    feedback = existing ? existing + "\n" + line : line;
  }

  const jobFields = {};
  if (m.status) jobFields.Status = m.status;
  if (m.arrived) jobFields.Arrived_At = nowIso;
  if (m.departed) jobFields.Departed_At = nowIso;
  if (feedback !== null) jobFields.Contractor_Feedback = feedback;
  if (update === "Job completed" && !jf.Deliverables_Folder && /^https?:\/\//i.test(link)) {
    jobFields.Deliverables_Folder = link;
  }

  const logNotes = [update, newFinish ? `New finish: ${newFinish}` : "", notes].filter(Boolean).join("\n");
  const logFields = {
    Submission: `${jf.Job_Code || ""} - ${update} - ${workerName}`,
    Related_Job: [job],
    Form_Type: m.formType,
    Submitted_By: workerName,
    Status_Set: m.status || "(no status change)",
    Notes: logNotes,
    Incident_Severity: incident || "",
  };
  if (/^https?:\/\//i.test(link)) logFields.Link_Provided = link;

  await airtable("POST", `/${UPDATES_TABLE}`, writeKey, { records: [{ fields: logFields }], typecast: true });
  if (Object.keys(jobFields).length) {
    await airtable("PATCH", `/${JOBS_TABLE}/${job}`, writeKey, { fields: jobFields, typecast: true });
  }

  // NOTE (tranche 4): the n8n form also started the Working Alone Watch
  // on "Arrived on site". That watch moves to the portal in tranche 4;
  // until then an arrival here does not start a watch.

  if (notify) {
    const client = Array.isArray(jf.Client_Name) ? jf.Client_Name.join(", ") : jf.Client_Name || "";
    const rows = [
      ["Job", `<b>${esc(jf.Job_Code || "")}</b> ${esc(jf.Job_Name || "")}`],
      client ? ["Client", esc(client)] : null,
      ["Update", esc(update)],
      ["Worker", esc(workerName)],
      ["Status now", esc(m.status || "unchanged")],
      newFinish ? ["New finish", esc(newFinish)] : null,
      incident ? ["Incident", esc(incident)] : null,
    ].filter(Boolean);
    const tableHtml = '<table style="font-size:15px;border-collapse:collapse">' + rows.map(([k, v]) => `<tr><td style="color:#66717d;padding:4px 14px 4px 0;vertical-align:top">${k}</td><td>${v}</td></tr>`).join("") + "</table>";
    await sendEmail({
      to: WILTON,
      subject: `${urgent ? "URGENT " : ""}${jf.Job_Code || ""}: ${update} (${workerName})`,
      html: `<div style="font-family:Arial,sans-serif;font-size:15px">${urgent ? '<p style="background:#fdecec;border:1px solid #e0a3a3;padding:10px"><b>This needs you now.</b> Call the worker: check they and the client are safe before anything else. If it is a privacy issue, open IN-BREACH.</p>' : ""}${tableHtml}${notes ? `<pre style="white-space:pre-wrap;background:#f4f6f9;padding:12px">${esc(notes)}</pre>` : ""}${/^https?:\/\//i.test(link) ? `<p><a href="${esc(link)}">Worker's link</a></p>` : ""}<p><a href="https://airtable.com/${BASE_ID}/${JOBS_TABLE}/${job}">Open the job in Airtable</a></p></div>`,
    }).catch(() => {});
  }

  return sendHtml(res, thankYouPage());
}

module.exports = async (req, res) => {
  try {
    if (req.method === "GET") {
      const job = String(req.query?.job || "");
      const c = String(req.query?.c || "");
      return sendHtml(res, formPage(job, c));
    }
    if (req.method === "POST") {
      return await handleSubmission(req, res);
    }
    return res.status(405).json({ error: "Method not allowed." });
  } catch (e) {
    console.error("job-update failed:", e);
    // Even on a server error, the worker sees the standard thank-you —
    // the n8n form answered immediately by design.
    return sendHtml(res, thankYouPage());
  }
};

// Exported for tests.
module.exports._test = { mapUpdate, feedbackStamp };
