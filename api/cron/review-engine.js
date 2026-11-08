// GET/POST /api/cron/review-engine — Review Engine + GBP Care
// hourly sweep (core logic: api/_reviewEngine.js runSweep). Per
// active client: poll the Google Business Profile API for new
// reviews (only when that client's token is provisioned in env —
// otherwise a no-op and manual entry is the watcher), fire the
// one gentle +3-day reminder for asks with no detected review,
// draft the weekly Google post on the client's configured
// weekday/hour, and generate last month's report on the 1st.
// Every step is deduped by its store key, so the hourly schedule
// is safe. Same auth policy as the other cron endpoints
// (CRON_SECRET bearer, or a core-staff session).
const { requireCoreStaff } = require("../admin/_requireCoreStaff");
const { runSweep } = require("../_reviewEngine");

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
    if (!authorized && !secret) console.warn("review-engine: CRON_SECRET not set — running unauthenticated (store-key dedupe guards repeats).");
    const summary = await runSweep({});
    return res.status(200).json({ ok: true, ...summary });
  } catch (e) {
    console.error("review-engine sweep failed:", e);
    return res.status(500).json({ error: "Review Engine sweep failed." });
  }
};
