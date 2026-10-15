// Jobs live in Airtable (Jobs_Schedules), not in Postgres — see
// wilglobo-db/migrations/20261012T0300_techcare_contractors_airtable_link.sql
// for why. This endpoint's only job is to turn a verified Supabase login
// into the worker's existing n8n "My Jobs" page link, which already does
// the real work (today's jobs, next 14 days, map, call client).
const { verifyAndGetContractor } = require("./_auth");

module.exports = async (req, res) => {
  try {
    const result = await verifyAndGetContractor(req);
    if (result.error) return res.status(result.status).json({ error: result.error });
    const { contractor } = result;

    if (!contractor.airtable_worker_id) {
      return res.status(200).json({
        name: contractor.full_name,
        myJobsUrl: null,
        notice: "Your account isn't linked to your Airtable worker profile yet — ask WilGlobo support.",
      });
    }

    res.status(200).json({
      name: contractor.full_name,
      myJobsUrl: `https://wilglobo.app.n8n.cloud/webhook/ops-myjobs?w=${encodeURIComponent(contractor.airtable_worker_id)}`,
    });
  } catch (e) {
    console.error("jobs.js failed:", e);
    res.status(500).json({ error: "Server error." });
  }
};
