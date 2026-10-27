// TechCare SMS — the guarded send path, ported from the n8n
// "TechCare - Send SMS" gateway (n8n retirement, tranche 4). Every
// validation rule is the original's, verbatim and in order: they are
// compliance/safety controls (North-American numbers only, 320-char
// cap, mandatory STOP opt-out line, no card-number-like strings), not
// decoration. Sending is a direct Twilio REST call from the WilGlobo
// line configured in TWILIO_FROM_NUMBER (+1 825-425-2239).
function validateSms(toRaw, bodyRaw) {
  let to = String(toRaw || "").replace(/[^0-9+]/g, "");
  if (/^[0-9]{10}$/.test(to)) to = "+1" + to;
  else if (/^1[0-9]{10}$/.test(to)) to = "+" + to;
  const body = String(bodyRaw || "");
  if (!/^\+1[2-9][0-9]{9}$/.test(to)) return { valid: false, error: "to must be a North American number" };
  if (!body.trim()) return { valid: false, error: "body is required" };
  if (body.length > 320) return { valid: false, error: "body too long (max 320)" };
  if (!/STOP/.test(body)) return { valid: false, error: "body must include Reply STOP to opt out" };
  if (/\b(?:\d[ -]?){13,19}\b/.test(body)) return { valid: false, error: "body looks like it contains a card number" };
  return { valid: true, to, body };
}

async function sendSms(to, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) {
    const err = new Error("Twilio is not configured.");
    err.code = "sms_not_configured";
    throw err;
  }
  const form = new URLSearchParams({ From: from, To: to, Body: body });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Twilio ${res.status}: ${data.message || "send failed"}`);
    err.code = "sms_send_failed";
    throw err;
  }
  return { sid: data.sid };
}


// From the Dispatch SMS Confirm workflow: the worker phone comes from
// the Directory lookup; 10 digits -> +1, 11 starting with 1 -> +,
// anything else is unusable ("").
function workerPhoneE164(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return "";
}

// 'Tue, Oct 27, 3:30 PM' in America/Edmonton — the dispatch text's
// start-time format (JS toLocaleString with the same options).
function startTimeLocal(iso) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Edmonton", weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  }).format(new Date(iso));
}

module.exports = { validateSms, sendSms, workerPhoneE164, startTimeLocal };
