// Working Alone Watch — the decision logic, ported from the n8n
// workflow of the same name (n8n retirement, tranche 4). The original
// ran one long-lived execution per arrival (Wait nodes, an in-memory
// loop counter); the portal instead sweeps jobs every minute and keeps
// the watch state durably as Job_Updates rows (Form_Type
// "Working Alone Watch"), one per alert sent. Preserved exactly: the
// first-check rule (planned End_Time + 30 min, else Arrived_At + 3 h,
// never sooner than 60 s after the watch would start), the hourly
// re-alert, the 45-minute "Running late" suppression (which depends on
// the job update form's `[YYYY-MM-DD HH:MM UTC] Name - Running late`
// feedback lines), the checkout test (Departed_At >= Arrived_At, so a
// stale departure from an earlier visit does not end the watch), the
// 12-check cap, and the escalation email (worker → client after
// 10 min → 911) to wilton@wilglobo.com.
const { DateTime } = require("./_luxon");

const arr = (v) => (Array.isArray(v) ? v.filter(Boolean) : v ? [v] : []);

function firstCheckMs(f, nowMs) {
  const end = f.End_Time ? Date.parse(f.End_Time) : 0;
  const arrived = f.Arrived_At ? Date.parse(f.Arrived_At) : nowMs;
  let first = end ? end + 30 * 60 * 1000 : arrived + 3 * 60 * 60 * 1000;
  if (first < nowMs + 60 * 1000) first = nowMs + 60 * 1000;
  return first;
}

// alertCount replaces n8n's in-memory $runIndex loop counter.
function decideWatch(f, alertCount, nowMs) {
  const arrived = f.Arrived_At ? Date.parse(f.Arrived_At) : 0;
  const departed = f.Departed_At ? Date.parse(f.Departed_At) : 0;
  const status = f.Status || "";
  let decision = "alert";
  let reason = "";
  if (["Completed", "Cancelled"].includes(status) || (departed && departed >= arrived)) {
    decision = "done";
    reason = "Checked out or job closed.";
  } else if (alertCount >= 12) {
    decision = "done";
    reason = "Stopped after 12 hourly checks.";
  } else {
    const lines = String(f.Contractor_Feedback || "").split("\n").filter((l) => /Running late/i.test(l));
    const last = lines.length ? lines[lines.length - 1] : "";
    const m = last.match(/^\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) UTC\]/);
    const lateAt = m ? Date.parse(m[1] + "T" + m[2] + ":00Z") : 0;
    if (lateAt && nowMs - lateAt <= 45 * 60 * 1000) {
      decision = "late-ok";
      reason = "Worker sent Running late at " + m[2] + " UTC.";
    }
  }
  const fmt = (s) => (s ? DateTime.fromISO(s).setZone("America/Edmonton").toFormat("h:mm a") : "");
  return {
    decision,
    reason,
    code: f.Job_Code || "",
    name: f.Job_Name || "",
    worker: arr(f.Assigned_To_Name || f.Assigned_Email).join(", "),
    workerEmail: arr(f.Assigned_Email).join(", "),
    workerPhone: arr(f.Assigned_Phone).join(", "),
    client: arr(f.Client_Name).join(", "),
    clientPhone: arr(f.Client_Phone).join(", "),
    address: f.Location || arr(f.Client_Address).join(" "),
    arrivedAt: fmt(f.Arrived_At),
    plannedEnd: fmt(f.End_Time),
  };
}

function alertEmailHtml(d, jobId) {
  const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const row = (k, v) => '<tr><td style="color:#555;padding:4px 14px 4px 0;vertical-align:top">' + k + "</td><td>" + v + "</td></tr>";
  return '<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5;color:#0d1b2e;max-width:620px"><div style="background:#fdecea;border-left:5px solid #c62828;padding:14px;margin:0 0 14px"><b>Working-alone check missed.</b> ' + esc(d.worker || "The worker") + " checked in at " + esc(d.arrivedAt) + ' and has not checked out or sent an update.</div><ol style="padding-left:20px"><li><b>Call the worker now</b>' + (d.workerPhone ? ': <a href="tel:' + esc(d.workerPhone) + '">' + esc(d.workerPhone) + "</a>" : "") + '.</li><li>No answer in 10 minutes: <b>call the client</b>' + (d.clientPhone ? ': <a href="tel:' + esc(d.clientPhone) + '">' + esc(d.clientPhone) + "</a>" : "") + '.</li><li>Still no contact: <b>call 911</b> and give the address below.</li></ol><table style="font-size:15px;border-collapse:collapse">' + row("Job", "<b>" + esc(d.code) + "</b> " + esc(d.name)) + row("Address", "<b>" + esc(d.address) + "</b>") + row("Client", esc(d.client)) + row("Planned finish", esc(d.plannedEnd)) + row("Worker email", esc(d.workerEmail)) + '</table><p>If they are fine, ask them to send "Left the site" or "Running late" on their job link. This check repeats every hour until they check out.</p><p><a href="https://airtable.com/appBiAKY6ivoImcaQ/tblpsypl4j8CChNq1/' + jobId + '">Open the job in Airtable</a></p></div>';
}

module.exports = { firstCheckMs, decideWatch, alertEmailHtml };
