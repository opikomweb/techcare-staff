// Jobs live in Airtable (Jobs_Schedules), not in Postgres — see
// wilglobo-db/migrations/20261012T0300_techcare_contractors_airtable_link.sql
// for why. This endpoint turns a verified Supabase login into the
// worker's personal My Jobs page link.
//
// The page itself is served by the portal (api/public/my-jobs.js, a
// port of the retired n8n "Worker My Jobs Page"). Its link needs the
// worker's Directory Sign_Code as the `c` parameter — the old version
// of this endpoint built the n8n URL WITHOUT the code, which the page
// (n8n's and now the portal's) rejects as "not valid", so the signed-in
// My Jobs link never actually worked. The code is fetched from the
// Directory here and never sent anywhere else.
const { verifyAndGetContractor } = require("./_auth");

const BASE_ID = "appBiAKY6ivoImcaQ";
const DIRECTORY_TABLE = "tbllgRxtl2LbCMg2O";

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

    let signCode = "";
    if (process.env.AIRTABLE_API_KEY) {
      try {
        const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${DIRECTORY_TABLE}/${contractor.airtable_worker_id}`, {
          headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` },
        });
        if (r.ok) {
          const rec = await r.json();
          signCode = String((rec.fields || {}).Sign_Code || "");
        }
      } catch (e) {
        console.error("jobs.js: sign code fetch failed:", e);
      }
    }

    if (!signCode) {
      return res.status(200).json({
        name: contractor.full_name,
        myJobsUrl: null,
        notice: "Your My Jobs link isn't ready yet — ask WilGlobo support.",
      });
    }

    res.status(200).json({
      name: contractor.full_name,
      myJobsUrl: `https://staff.wilglobo.com/my-jobs?w=${encodeURIComponent(contractor.airtable_worker_id)}&c=${encodeURIComponent(signCode)}`,
    });
  } catch (e) {
    console.error("jobs.js failed:", e);
    res.status(500).json({ error: "Server error." });
  }
};
