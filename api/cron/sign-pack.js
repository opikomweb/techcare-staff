// GET/POST /api/cron/sign-pack — sends signing packs for every record
// with Send_Sign_Pack ticked (see api/_signpack.js). Runs every minute
// via Vercel Cron, replacing the retired n8n workflow's Airtable poll.
// Same auth policy as the dispatch sync: CRON_SECRET bearer when set,
// or a core-staff session.
const { runSignPackSweep } = require("../_signpack");
const { requireCoreStaff } = require("../admin/_requireCoreStaff");

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
    if (!authorized && !secret) console.warn("sign-pack: CRON_SECRET not set — running unauthenticated (work is tick-driven and idempotent).");

    const summary = await runSignPackSweep();
    return res.status(200).json({ ok: true, ...summary });
  } catch (e) {
    console.error("sign-pack failed:", e);
    return res.status(500).json({ error: "Sign pack sweep failed." });
  }
};
