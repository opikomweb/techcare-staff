// GET/POST /api/cron/visit-confirmed — ported from the n8n "Client
// Visit Confirmed" workflow (n8n retirement, tranche 4). Every minute
// it finds jobs that are Accepted with Client_Time_Request_Sent unset
// and emails the client the visit-time request (verbatim template),
// then stamps the flag so each job gets the email at most once. A
// client with no email on file is skipped WITHOUT stamping (retried
// while the job stays Accepted), exactly as the original behaved.
// Same auth policy as the other cron endpoints.
const { requireCoreStaff } = require("../admin/_requireCoreStaff");

const BASE_ID = "appBiAKY6ivoImcaQ";
const JOBS_TABLE = "tblpsypl4j8CChNq1";
const FROM = "TechCare by WilGlobo <tech@wilglobo.com>";

const first = (v) => (Array.isArray(v) ? v[0] || "" : v || "");
const firstName = (n) => String(n || "").trim().split(" ")[0] || "there";

async function listAll(formula, fields, key) {
  const records = [];
  let offset = null;
  do {
    const params = new URLSearchParams();
    params.set("pageSize", "100");
    params.set("filterByFormula", formula);
    for (const f of fields) params.append("fields[]", f);
    if (offset) params.set("offset", offset);
    const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${JOBS_TABLE}?${params}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`Airtable list ${res.status}`);
    const data = await res.json();
    records.push(...(data.records || []));
    offset = data.offset || null;
  } while (offset);
  return records;
}

async function runVisitConfirmed() {
  const readKey = process.env.AIRTABLE_API_KEY;
  const writeKey = process.env.AIRTABLE_WRITE_KEY || readKey;
  if (!readKey) throw new Error("AIRTABLE_API_KEY is not set.");
  const jobs = await listAll(
    "AND({Status}='Accepted',NOT({Client_Time_Request_Sent}))",
    ["Job_Name", "Job_Code", "Assigned_Name", "Client_Email", "Client_Name", "Location"],
    readKey
  );
  const results = [];
  for (const job of jobs) {
    const f = job.fields || {};
    const email = first(f.Client_Email);
    if (!email) {
      results.push({ job: f.Job_Code || job.id, skipped: "no_client_email" });
      continue;
    }
    const workerName = first(f.Assigned_Name) || "your WilGlobo technician";
    const name = firstName(first(f.Client_Name));
    const text = `Hi ${name},\n\n${workerName} has been assigned to your TechCare visit at ${f.Location || ""}.\n\nCould you text or reply with at least two convenient times this week? For example: "Tuesday 6-7pm" or "Saturday afternoon".\n\nOnce we hear back we will confirm the exact time.\n\nThanks,\nWilGlobo TechCare`;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: [email],
        subject: `WilGlobo TechCare - confirming your visit (${f.Job_Name || "Your TechCare visit"})`,
        text,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(`Resend ${res.status}: ${data.message || "send failed"}`);
    }
    const stamp = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${JOBS_TABLE}/${job.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${writeKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { Client_Time_Request_Sent: true }, typecast: true }),
    });
    results.push({ job: f.Job_Code || job.id, emailed: email, stamped: stamp.ok });
  }
  return { processed: jobs.length, results };
}

module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }
  try {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.authorization || "";
    let authorized = false;
    if (secret && auth === `Bearer ${secret}`) authorized = true;
    if (!authorized) {
      const gate = await requireCoreStaff(req).catch(() => ({ error: "no session" }));
      if (!gate.error) authorized = true;
    }
    if (!authorized && secret) return res.status(401).json({ error: "Unauthorized." });
    if (!authorized && !secret) console.warn("visit-confirmed: CRON_SECRET not set — running unauthenticated (once-only stamp guards sends).");
    const summary = await runVisitConfirmed();
    return res.status(200).json({ ok: true, ...summary });
  } catch (e) {
    console.error("visit-confirmed failed:", e);
    return res.status(500).json({ error: "Visit-confirmed sweep failed." });
  }
};
