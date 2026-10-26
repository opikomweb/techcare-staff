// Handover watcher shared logic — the "job completed, send the client
// their summary" half of the ported n8n "Handover Confirm" workflow.
//
// extractSummary: the completion summary is pulled out of the job's
// append-only Contractor_Feedback log — scanning from the LAST line
// backwards for the first line containing "- Job completed", the
// summary is the text after the first ": " following that marker. This
// convention is load-bearing (the worker job update form writes those
// lines), so it is preserved exactly, including the two different
// fallback sentences the original used on its two surfaces.
function extractSummary(feedback, fallback) {
  const lines = String(feedback || "").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const marker = line.indexOf("- Job completed");
    if (marker !== -1) {
      const colon = line.indexOf(": ", marker);
      if (colon !== -1) {
        const text = line.slice(colon + 2).trim();
        if (text) return text;
      }
      return fallback;
    }
  }
  return fallback;
}

const WATCH_FALLBACK = "The visit is complete. Reach out any time if something needs following up.";
const PAGE_FALLBACK = "The visit is complete.";

module.exports = { extractSummary, WATCH_FALLBACK, PAGE_FALLBACK };
