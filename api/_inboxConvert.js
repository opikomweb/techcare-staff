// Inbox To Client And Job — ported from the n8n workflow of the same
// name (n8n retirement). One-click conversion of an Inbox request:
// find or create the Client, create a Draft job, mark the Inbox row
// "Converted to job". Idempotent via the Inbox Job link, exactly as
// the original. "Plan" below is the original Code node verbatim except
// for its inputs (the fetched Inbox record + the Find Client match).
// The client-matching formula is the original's (last-10-digit phone
// OR lowercase email, each side degrading to FALSE()).
const BASE_ID = "appBiAKY6ivoImcaQ";
const INBOX_TABLE = "tblMCfG4rm7G6l3nH";
const CLIENTS_TABLE = "tblY473voC9AylgFF";
const JOBS_TABLE = "tblpsypl4j8CChNq1";

function findClientFormula(phone, email) {
  const d = String(phone || "").replace(/[^0-9]/g, "").slice(-10);
  const e = String(email || "").toLowerCase().replace(/'/g, "");
  return "OR("
    + (d.length === 10 ? `RIGHT(REGEX_REPLACE({Phone} & '', '[^0-9]', ''), 10) = '${d}'` : "FALSE()")
    + ", "
    + (e ? `LOWER({Email} & '') = '${e}'` : "FALSE()")
    + ")";
}

function planConvert(it, found) {
  const f = it.fields || it;
  if (!it.id) { return { action: "error", message: "That request was not found. It may have been deleted." }; }
  const jobs = f.Job || [];
  const linked = (f.Client || [])[0] || "";
  if (jobs.length) { return { action: "already", inboxId: it.id, jobId: jobs[0], clientId: linked }; }
  const clientId = linked || (found ? found.id : "");
  const name = String(f.Caller_Name || "").trim() || String(f.Phone || "").trim() || "New client (name needed)";
  const notes = "From Inbox " + new Date().toISOString().slice(0, 10) + " (" + (f.Source || "") + "): " + String(f.Need || "").slice(0, 900);
  const clientFields = { Client_Name: name, Phone: f.Phone || undefined, Email: f.Email || undefined, City: f.City || undefined, Notes: notes };
  Object.keys(clientFields).forEach((k) => { if (clientFields[k] === undefined || clientFields[k] === "") { delete clientFields[k]; } });
  const svc = String(f.Service_Guess || "").trim();
  const jobName = ((svc && svc !== "Other") ? svc : "Tech help") + " for " + name;
  return { action: "convert", inboxId: it.id, clientId, isNewClient: !clientId, clientFields, jobName, need: f.Need || "", preferred: f.Preferred_Time || "" };
}

async function airtable(path, method, body) {
  const key = method === "GET" ? process.env.AIRTABLE_API_KEY : process.env.AIRTABLE_WRITE_KEY || process.env.AIRTABLE_API_KEY;
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (method === "GET" && res.status === 404) return null;
  if (!res.ok) throw new Error(`Airtable ${method} ${path.split("?")[0]} ${res.status}`);
  return res.json();
}

async function runConvert(id) {
  const item = await airtable(`${INBOX_TABLE}/${id}`, "GET");
  if (!item) return { action: "error", message: "That request was not found. It may have been deleted." };
  const f = item.fields || {};

  // Find Client (skipped when the Plan short-circuits, same result:
  // the original ran the search before Plan; Plan ignores it when a
  // Job link already exists)
  let found = null;
  if (!(f.Job || []).length && !(f.Client || []).length) {
    const params = new URLSearchParams();
    params.set("filterByFormula", findClientFormula(f.Phone, f.Email));
    params.set("pageSize", "1");
    params.append("fields[]", "Client_Name");
    const data = await airtable(`${CLIENTS_TABLE}?${params}`, "GET");
    found = ((data && data.records) || [])[0] || null;
    if (found) found = { id: found.id, ...(found.fields || {}) };
  }

  const plan = planConvert(item, found);
  if (plan.action !== "convert") return plan;

  let clientId = plan.clientId;
  if (plan.isNewClient) {
    const created = await airtable(CLIENTS_TABLE, "POST", { fields: plan.clientFields, typecast: true });
    clientId = created.id;
  }
  const job = await airtable(JOBS_TABLE, "POST", {
    fields: { Client: [clientId], Job_Name: plan.jobName, Status: "Draft" },
    typecast: true,
  });
  await airtable(`${INBOX_TABLE}/${plan.inboxId}`, "PATCH", {
    fields: { Client: [clientId], Existing_Client: !plan.isNewClient, Job: [job.id], Status: "Converted to job" },
    typecast: true,
  });
  return { ...plan, clientId, jobId: job.id };
}

module.exports = { findClientFormula, planConvert, runConvert };
