// GET /api/cron/sms-test?to=+1XXXXXXXXXX — TEMPORARY one-shot proof
// endpoint (Oct 27, 2026): sends one fixed test text through the
// portal SMS path (api/_sms.js validate + Twilio send) so the Twilio
// credentials pasted into Vercel env are proven end-to-end. Delete
// this file immediately after the proof lands; it is not part of the
// portal. Same auth policy as the other cron endpoints.
const { requireCoreStaff } = require("../admin/_requireCoreStaff");
const { validateSms, sendSms } = require("../_sms");

const TEST_BODY = "WilGlobo TechCare test: the staff portal SMS gateway is live. This is the one test text. Reply STOP to opt out.";

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
    if (!authorized && !secret) console.warn("sms-test: CRON_SECRET not set — running unauthenticated (temporary proof endpoint).");
    const to = (req.query && req.query.to) || "";
    const v = validateSms(to, TEST_BODY);
    if (!v.valid) return res.status(400).json({ ok: false, error: v.error });
    const { sid } = await sendSms(v.to, v.body);
    return res.status(200).json({ ok: true, sid, to: v.to });
  } catch (e) {
    console.error("sms-test failed:", e);
    return res.status(500).json({ ok: false, error: e.code || "sms_test_failed" });
  }
};
