// GET /api/shifts
// Lists open (unclaimed) TechCare shifts. Thin proxy to the n8n workflow
// "WilGlobo Ops Core - Open Shifts List", which reads Jobs_Schedules
// directly (Open_For_Claim=true, Status=Draft, Assigned_To blank) — Airtable
// stays the system of record for job data, same as api/jobs.js.
// Requires a signed-in, active TechCare contractor (identity check only;
// Airtable itself still has the final say on what's actually claimable).
const { verifyAndGetContractor } = require("./_auth");

const N8N_BASE = "https://wilglobo.app.n8n.cloud";

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const result = await verifyAndGetContractor(req);
    if (result.error) return res.status(result.status).json({ error: result.error });

    // n8n's webhook node has "ignore bots" on for this workflow (it blocks
    // requests that look automated). Node's fetch() sends no User-Agent by
    // default, which n8n's bot filter treats as a bot and rejects with 403
    // before the workflow even runs. A normal-looking UA avoids that.
    const n8nRes = await fetch(`${N8N_BASE}/webhook/ops-open-shifts`, {
      method: "GET",
      headers: { "User-Agent": "WilGlobo-TechCare-Staff/1.0 (+https://staff.wilglobo.com)" },
    });
    if (!n8nRes.ok) {
      console.error("shifts.js: n8n returned", n8nRes.status);
      return res.status(502).json({ error: "Couldn't load open shifts right now. Try again shortly." });
    }
    const data = await n8nRes.json();
    return res.status(200).json({ shifts: data.shifts || [] });
  } catch (e) {
    console.error("shifts.js failed:", e);
    return res.status(500).json({ error: "Server error." });
  }
};
