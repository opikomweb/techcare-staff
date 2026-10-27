// Pure helpers for the visit-day worker texts (api/cron/visit-texts.js),
// kept dependency-free so they can be unit-tested outside the portal's
// serverless environment. startTimeLocal is re-exported from _sms.js.
const { startTimeLocal } = require("./_sms");

const first = (v) => (Array.isArray(v) ? v[0] || "" : v || "");

function soonText(f, jobId) {
  const client = first(f.Client_Name) || "your client";
  const consent = `https://staff.wilglobo.com/job-consent?job=${jobId}&c=${f.Job_Key || ""}`;
  return `WilGlobo TechCare: visit in about 30 min - ${client} at ${startTimeLocal(f.Start_Time)}, ${f.Location || ""}. Before you start, ask the client to confirm the work + waiver here: ${consent} Reply STOP to opt out.`;
}

function wrapText(f) {
  const client = first(f.Client_Name) || "the client";
  return `WilGlobo TechCare: almost done? Did ${client} request anything extra? Note it in your feedback on the job link (or just leave feedback + mark complete if not): ${f.Status_Form_URL || ""} Reply STOP to opt out.`;
}

function decideSoon(f, nowMs) {
  const start = Date.parse(f.Start_Time || "");
  if (!start) return false;
  const mins = (start - nowMs) / 60000;
  return mins > 0 && mins <= 30;
}

function decideWrap(f, nowMs) {
  const end = Date.parse(f.End_Time || "");
  if (!end) return false;
  const minsAgo = (nowMs - end) / 60000;
  return minsAgo >= 0 && minsAgo <= 20;
}


module.exports = { soonText, wrapText, decideSoon, decideWrap };
