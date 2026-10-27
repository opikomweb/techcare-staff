// POST /api/public/send-sms — the SMS gateway endpoint, contract-
// compatible with the n8n "TechCare - Send SMS" webhook it replaces:
// header `x-techcare-key` must match TECHCARE_SMS_KEY; JSON body
// {to, body, invoiceId}; responses 200 {ok:true, sid} /
// 400 {ok:false, error} / 502 {ok:false, error:"sms_send_failed"}.
// Validation + sending live in api/_sms.js. Callers (invoice channel,
// sign packs) point TECHCARE_SMS_WEBHOOK_URL here or use the portal
// default now set in _invoiceChannels.js / _signpack.js.
const { validateSms, sendSms } = require("../_sms");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed." });
  const expected = process.env.TECHCARE_SMS_KEY;
  const provided = req.headers["x-techcare-key"] || "";
  if (!expected || provided !== expected) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  const { to, body } = req.body || {};
  const v = validateSms(to, body);
  if (!v.valid) return res.status(400).json({ ok: false, error: v.error });
  try {
    const { sid } = await sendSms(v.to, v.body);
    return res.status(200).json({ ok: true, sid });
  } catch (e) {
    console.error("send-sms failed:", e.message);
    return res.status(502).json({ ok: false, error: "sms_send_failed" });
  }
};
