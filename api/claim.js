// POST /api/claim  body: { jobId: "recXXXXXXXXXXXXXX" }
// Claims an open shift, done entirely by the portal against Airtable.
//
// This endpoint used to proxy the n8n workflow "WilGlobo Ops Core - Claim
// Shift". As of 2026-10-26 it is served by the portal itself (n8n
// retirement, tranche 1), with the workflow's checks preserved exactly:
// the job must still be Open_For_Claim + Status=Draft + unassigned, and
// the worker must be Directory Status=Active with no Dispatch_Gaps (the
// same compliance gates as admin dispatch — police/vulnerable-sector
// check, insurance, WCB, CRA self-check). The worker id always comes
// from the signed-in session, never from the request body.
// On success the job becomes Status=Accepted, Open_For_Claim=false, a
// Job_Key is minted if the job doesn't have a valid one, and Wilton gets
// a "shift claimed" email.
const crypto = require("crypto");
const { verifyAndGetContractor } = require("./_auth");
const { sendInvoiceEmail } = require("./admin/_invoiceChannels");

const BASE_ID = "appBiAKY6ivoImcaQ";
const JOBS_TABLE = "tblpsypl4j8CChNq1";
const DIRECTORY_TABLE = "tbllgRxtl2LbCMg2O";
const JOB_ID_RE = /^rec[A-Za-z0-9]{14}$/;
const JOB_KEY_RE = /^[a-f0-9]{32}$/;

function readKey() {
  return process.env.AIRTABLE_API_KEY;
}
function writeKey() {
  return process.env.AIRTABLE_WRITE_KEY || process.env.AIRTABLE_API_KEY;
}

async function airtableGet(tableId, recordId, key) {
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${tableId}/${recordId}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Airtable get ${tableId} ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function airtableUpdateJob(jobId, fields, key) {
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${JOBS_TABLE}/${jobId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields, typecast: true }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Airtable update job ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function statusName(v) {
  if (v && typeof v === "object") return String(v.name || "");
  return String(v || "");
}

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
    if (typeof jobId !== "string" || !JOB_ID_RE.test(jobId) || !JOB_ID_RE.test(contractor.airtable_worker_id)) {
      return res.status(400).json({ error: "That shift doesn't look right. Refresh the list and try again." });
    }

    if (!readKey()) {
      return res.status(503).json({ error: "Not connected yet — contact WilGlobo support to finish this setup." });
    }

    const [job, worker] = await Promise.all([
      airtableGet(JOBS_TABLE, jobId, readKey()),
      airtableGet(DIRECTORY_TABLE, contractor.airtable_worker_id, readKey()),
    ]);

    if (!job) {
      return res.status(409).json({ error: "Shift not found." });
    }
    const jf = job.fields || {};
    const assigned = Array.isArray(jf.Assigned_To) ? jf.Assigned_To.length > 0 : !!jf.Assigned_To;
    const jobOk = !!jf.Open_For_Claim && statusName(jf.Status) === "Draft" && !assigned;
    if (!jobOk) {
      return res.status(409).json({ error: "This shift is no longer available." });
    }

    const wf = (worker && worker.fields) || {};
    const workerEligible = !!worker && statusName(wf.Status) === "Active" && !String(wf.Dispatch_Gaps || "").trim();
    if (!workerEligible) {
      return res.status(409).json({ error: "This shift needs a compliance check cleared first (police check, insurance, WCB or CRA self-check). Ask Wilton." });
    }

    const fields = {
      Assigned_To: [contractor.airtable_worker_id],
      Status: "Accepted",
      Open_For_Claim: false,
    };
    if (!JOB_KEY_RE.test(String(jf.Job_Key || "").toLowerCase())) {
      fields.Job_Key = crypto.randomBytes(16).toString("hex");
    }
    await airtableUpdateJob(jobId, fields, writeKey());

    // Notify Wilton — same notice the n8n workflow sent. A failed email
    // must not fail the claim itself; the assignment is already recorded.
    const jobName = jf.Job_Name || "Job";
    const jobCode = jf.Job_Code || "";
    try {
      await sendInvoiceEmail({
        to: "wilton@wilglobo.com",
        subject: `Shift claimed: ${jobCode} by ${contractor.full_name}`,
        html: `<p><b>${contractor.full_name}</b> claimed an open shift.</p><p><b>Job:</b> ${jobName}${jobCode ? ` (${jobCode})` : ""}</p>`,
      });
    } catch (e) {
      console.error("claim.js: notify email failed:", e);
    }

    return res.status(200).json({ claimed: true, jobName });
  } catch (e) {
    console.error("claim.js failed:", e);
    return res.status(500).json({ error: "Couldn't claim that shift right now. Try again shortly." });
  }
};
