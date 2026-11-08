// POST /api/review-sms — Twilio inbound-SMS webhook for a Review
// Engine number (core logic: api/_reviewEngine.js). Point the
// number a client's review asks send FROM (their configured
// from_number, or the portal line for the TechCare dogfood config)
// at this webhook. Its one job is consent bookkeeping: STOP / START
// keywords are recorded per client + number and honoured by every
// later ask. Customer replies that aren't keywords are ignored here
// — conversations belong to TextBack Shield / the portal inbox, not
// the review engine. Always answers with an empty TwiML response.
const { handleReviewInboundSms, shouldVerifyTwilio } = require("./_reviewEngine");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed." });
  const params = req.body || {};
  const url = `https://${req.headers.host || "staff.wilglobo.com"}${req.url || "/api/review-sms"}`;
  const sig = shouldVerifyTwilio(req, url, params);
  if (sig.enforce && !sig.ok) {
    console.error("review-sms: Twilio signature mismatch — check the webhook URL or set REVIEW_SKIP_SIG_VERIFY=1 (see the Review Engine README).");
    return res.status(401).json({ ok: false, error: "bad_signature" });
  }
  try {
    await handleReviewInboundSms(params, {});
  } catch (e) {
    console.error("review-sms failed:", e && e.message ? e.message : e);
  }
  res.setHeader("Content-Type", "text/xml");
  return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
};
