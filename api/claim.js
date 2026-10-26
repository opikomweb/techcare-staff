// POST /api/claim  body: { jobId: "recXXXXXXXXXXXXXX" }
// Claims an open shift. Thin proxy to the n8n workflow "WilGlobo Ops Core -
// Claim Shift", which does the real work server-side against Airtable
// (re-checks the job is still open AND that this worker clears the same
// compliance gates as admin dispatch — police/vulnerable-sector check,
// insurance, WCB, CRA self-check, Status=Active — before assigning it).
// This endpoint's own job is just: confirm who's asking, pass their real
// Airtable worker id (never trust a client-supplied one), and relay the
// result.
const { verifyAndGetContractor } = require("./_auth");

const N8N_BASE = "https://wilglobo.app.n8n.cloud";
const JOB_ID_RE = /^rec[A-Za-z0-9]{14}$/;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const result = await verifyAndGetContractor(req);
    if (result.error) return res.status(result.status).json({ error: result.error });
    const { contractor } = result;

    if (!contractor.airtable_worker_id) {
      return res.status(409).json({ error: "Your account isn't linked to your Airtable worker profile yet — ask WilGlobo support." });
    }

    const jobId = req.body && req.body.jobId;
    if (typeof jobId !== "string" || !JOB_ID_RE.test(jobId)) {
      return res.status(400).json({ error: "That shift doesn't look right. Refresh the list and try again." });
    }

    // Same n8n "ignore bots" webhook filter as shifts.js — and the same
    // trap: the old custom "WilGlobo-TechCare-Staff/1.0" UA is rejected
    // with 403 "Authorization data is wrong!" (verified 2026-10-26).
    // A standard browser UA is required here too.
    const n8nRes = await fetch(`${N8N_BASE}/webhook/ops-claim`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      },
      body: JSON.stringify({
        job: jobId,
        worker: contractor.airtable_worker_id,
        workerName: contractor.full_name,
      }),
    });

    const data = await n8nRes.json().catch(() => ({}));

    if (n8nRes.status === 200) {
      return res.status(200).json({ claimed: true, jobName: data.jobName || "Shift" });
    }
    if (n8nRes.status === 409) {
      return res.status(409).json({ error: data.message || "This shift is no longer available." });
    }
    if (n8nRes.status === 400) {
      return res.status(400).json({ error: data.message || "That shift doesn't look right." });
    }
    console.error("claim.js: n8n returned", n8nRes.status, data);
    return res.status(502).json({ error: "Couldn't claim that shift right now. Try again shortly." });
  } catch (e) {
    console.error("claim.js failed:", e);
    return res.status(500).json({ error: "Server error." });
  }
};
