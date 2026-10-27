// ONE-OFF (Oct 27, 2026): text Minda Buhat after the WGB-7 visit
// fell through — Tanya was weather-delayed ~15 min (she texted
// ahead), Minda sounded frustrated and hung up, and callbacks from
// Tanya and from TechCare admin went unanswered. Opik chose the
// softer version: acknowledge the delay, no blame or fee for this
// incident, rebooking confirmed with upfront payment, three time
// options plus the booking link. Guarded by a Job_Updates marker
// ("No-Show Text") so it can only ever send once. DELETE this file
// after its run is confirmed.
const { validateSms, sendSms } = require("../_sms");
const { markerExists, addMarker } = require("../_invoiceApproval");

const JOB_ID = "recRMkVKurhT7Ltkw";
const TO = "+18254883732";
const BOOKING = "https://calendar.google.com/calendar/u/0/appointments/schedules/AcZssZ0T0pEaBkmhSA8V2SoQxDkoD5UZuZRWhsxSukGDOEaV4jpQ5ptplsBheejNfEix6SfpMV1cUZOI";
const MSG1 = "WilGlobo TechCare: Hi Minda, we are sorry - Tanya was delayed by the weather today and let you know she would be about 15 minutes late. When she arrived and tried to reach you, we could not get through, so the session did not happen. We would still like to help you. Reply STOP to opt out.";
const MSG2 = `Rebook options (confirmed with upfront payment): 1) Wed Oct 28 3:30 PM 2) Thu Oct 29 10:30 AM 3) Fri Oct 30 3:30 PM. Reply your pick, or book: ${BOOKING} Reply STOP to opt out.`;

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
    await addMarker(JOB_ID, "No-Show Text", "WGB-7", `Reschedule text (softer version) sent to Minda (2 messages): ${sids.join(", ")}.`);
    return res.status(200).json({ ok: true, sids });
  } catch (e) {
    console.error("oneshot-minda failed:", e);
    return res.status(500).json({ error: "Send failed." });
  }
};
