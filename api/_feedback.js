// Feedback keyword scan — the pure logic of the ported n8n "Feedback
// Keyword Watch" (see api/cron/feedback-watch.js). Keyword lists and
// the High/Normal split are the original's, verbatim; matching is
// substring on the lowercased unscanned suffix.
const HIGH = ["injury", "unsafe", "complaint", "angry", "refund", "lawsuit", "police", "privacy breach", "data breach", "upset"];
const NORMAL = ["part needed", "parts needed", "need parts", "order parts", "reschedule", "follow up", "followup", "call back", "callback", "quote", "upgrade", "warranty", "missing", "damage", "broken", "revisit", "return visit", "extra charge", "additional charge"];

function scanFeedback(job) {
  const f = job.fields || {};
  const feedback = String(f.Contractor_Feedback || "");
  const scanLen = Number(f.Feedback_Scan_Length) || 0;
  const newText = feedback.slice(scanLen);
  const lower = newText.toLowerCase();
  const matchedHigh = HIGH.filter((k) => lower.indexOf(k) !== -1);
  const matchedNormal = NORMAL.filter((k) => lower.indexOf(k) !== -1);
  const matched = matchedHigh.concat(matchedNormal);
  return {
    jobId: job.id,
    jobCode: f.Job_Code || "record " + job.id,
    jobName: f.Job_Name || "(unknown job)",
    fullLength: feedback.length,
    newText: newText.trim(),
    matchedKeywords: matched.join(", "),
    hasMatch: matched.length > 0,
    priority: matchedHigh.length > 0 ? "High" : "Normal",
  };
}


module.exports = { scanFeedback, HIGH, NORMAL };
