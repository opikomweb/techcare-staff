// ONE-OFF (Oct 29, 2026): end-to-end proof of the outbound interest-
// alert pipeline (api/_retellOutbound.js) with a FAKE call_analyzed
// payload — no Retell call happens. The owner's own cell
// +1 825-962-6061 plays BOTH roles (business dialed + prospect mobile),
// so the run delivers: owner alert SMS, prospect follow-up text,
// owner email carrying both Twilio SIDs as proof, and the call-log
// row. No prospect anywhere receives anything.
//
// Run-once guard: the pipeline's own log store is checked for the
// self-test call_id first; if the check itself fails, the run aborts
// WITHOUT sending (fail closed). The temporary cron entry in
// vercel.json is removed once the run is confirmed, and this file is
// deleted after — same convention as the Oct 27 one-off text.
// Auth: CRON_SECRET bearer <redacted> set (Vercel Cron supplies it),
// else a core-staff session — the oneshot-minda pattern.
const { handleAnalyzedCall, selfTestGuard, markSelfTestStarted } = require("../_retellOutbound");

const SELFTEST_CALL_ID = "selftest-2026-10-29-001";

const FAKE_PAYLOAD = {
  event: "call_analyzed",
  call: {
    call_id: SELFTEST_CALL_ID,
    agent_id: "agent_8c43677b40315e9065008f6337",
    from_number: "+18254252239",
    to_number: "+18259626061",
    duration_ms: 95000,
    recording_url: "https://staff.wilglobo.com/self-test-no-recording",
    transcript:
      "SELF-TEST transcript (no real call): the outbound agent ran the K&R sheet flow; the owner played the prospect, asked about price, and took the callback close for tomorrow morning.",
    retell_llm_dynamic_variables: {
      business_name: "K&R Plumbing and Heating (SELF-TEST)",
      trade: "plumbing & heating",
      city: "Edmonton",
      sheet_ref: "01",
    },
    call_analysis: {
      custom_analysis_data: {
        call_outcome: "booked_callback",
        prospect_name: "Wilton (self-test)",
        callback_mobile: "8259626061",
        preferred_window: "tomorrow morning, Fri Oct 30, 9-11 AM",
        interest_summary:
          "SELF-TEST: prospect asked the price ($997 founding pilot), hesitated at the booking link, and took Wilton's callback at the agreed window.",
        do_not_call_flag: false,
      },
    },
  },
};

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

    // Run-once guard, fail closed: if we cannot prove the run has not
    // already happened, do not send anything. The started-marker is
    // written BEFORE the pipeline runs, so even a crashed run can
    // never send twice.
    const guard = await selfTestGuard(SELFTEST_CALL_ID);
    if (guard === "found") return res.status(200).json({ ok: true, already: true });
    if (guard !== "absent") return res.status(500).json({ ok: false, error: "guard_unknown_no_send" });
    const marker = await markSelfTestStarted(SELFTEST_CALL_ID);
    if (!marker.ok) return res.status(500).json({ ok: false, error: "marker_write_failed_no_send" });

    const result = await handleAnalyzedCall(FAKE_PAYLOAD, { selfTest: true });
    return res.status(200).json({ ok: true, selftest: result });
  } catch (e) {
    console.error("oneshot-retell-selftest failed:", e);
    return res.status(500).json({ ok: false, error: "selftest_failed" });
  }
};
