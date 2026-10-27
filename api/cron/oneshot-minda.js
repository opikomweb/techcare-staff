// ONE-OFF (Oct 27, 2026): text Minda Buhat about the WGB-7 no-show —
// what happened, the new policy (upfront payment + no-show fee on
// future bookings), three rebooking options, and the booking link.
// Guarded by a Job_Updates marker ("No-Show Text") so it can only
// ever send once. DELETE this file after its run is confirmed.
const { validateSms, sendSms } = require("../_sms");
const { markerExists, addMarker } = require("../_invoiceApproval");

const JOB_ID = "recRMkVKurhT7Ltkw";
const TO = "+18254883732";
const BOOKING = "https://calendar.google.com/calendar/u/0/appointments/schedules/AcZssZ0T0pEaBkmhSA8V2SoQxDkoD5UZuZRWhsxSukGDOEaV4jpQ5ptplsBheejNfEix6SfpMV1cUZOI";
const MSG1 = "WilGlobo TechCare: Hi Minda, Tanya arrived for today's 3:30 PM visit and called and texted several times, but we could not reach you, so the session did not happen. Because this was a no-show, future bookings need the session paid upfront, and a no-show fee applies. Reply STOP to opt out.";
const MSG2 = `To rebook, reply with the time that suits you: 1) Wed Oct 28 at 3:30 PM 2) Thu Oct 29 at 10:30 AM 3) Fri Oct 30 at 3:30 PM - or book here: ${BOOKING} Reply STOP to opt out.`;

module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }
  try {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.authorization || "";
    if (secret && auth !== `Bearer ${secret}`) {
      const { requireCoreStaff } = require("../admin/_requireCoreStaff");
      const gate = await requireCoreStaff(req).catch(() => ({ error: "no session" }));
      if (gate.error) return res.status(401).json({ error: "Unauthorized." });
    }
    if (await markerExists(JOB_ID, "No-Show Text")) {
      return res.status(200).json({ ok: true, already: true });
    }
    const sids = [];
    for (const body of [MSG1, MSG2]) {
      const v = validateSms(TO, body);
      if (!v.valid) return res.status(400).json({ error: v.error, body });
      const { sid } = await sendSms(v.to, v.body);
      sids.push(sid);
    }
    await addMarker(JOB_ID, "No-Show Text", "WGB-7", `No-show text sent to Minda (2 messages): ${sids.join(", ")}.`);
    return res.status(200).json({ ok: true, sids });
  } catch (e) {
    console.error("oneshot-minda failed:", e);
    return res.status(500).json({ error: "Send failed." });
  }
};
