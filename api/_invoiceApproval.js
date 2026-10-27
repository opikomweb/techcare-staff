// Invoice approval flow (added Oct 27, 2026 at Opik's direction):
// when a job is completed, the owner is texted the total with a
// one-tap approve link; approving sends the client their invoice —
// a Square checkout link for card payment, plus Interac e-transfer
// to sales@wilglobo.com — by text and, when the client has one, by
// email. Airtable stays the system of record (Jobs, Job_Tasks,
// Clients); the Square link comes from the same seam the admin
// invoices use (api/admin/_invoiceChannels.js). The amount charged
// is the job's agreed Job_Total — the price the client was quoted —
// with worker pay shown to the owner in the approval text only.
// Idempotency: Job_Updates markers ("Invoice Approval Text" when the
// owner is texted, "Invoice Sent" when the client is sent to) make
// both steps once-only per job.
const { validateSms, sendSms, workerPhoneE164 } = require("./_sms");
const { createSquareCheckoutUrl, sendInvoiceEmail } = require("./admin/_invoiceChannels");

const BASE_ID = "appBiAKY6ivoImcaQ";
const JOBS_TABLE = "tblpsypl4j8CChNq1";
const TASKS_TABLE = "tblDgvj31fP5rMvkI";
const CLIENTS_TABLE = "tblY473voC9AylgFF";
const UPDATES_TABLE = "tbldn4SgxiBjSuRBf";
const OWNER_PHONE = "+18259626061"; // Opik's number, given for portal texts Oct 27
const ETRANSFER_TO = "sales@wilglobo.com";

const first = (v) => (Array.isArray(v) ? v[0] || "" : v || "");
const money = (n) => "$" + Number(n || 0).toFixed(2);
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function invoiceNo() {
  const d = new Date();
  const ymd = d.toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `TC-${ymd}-${suffix}`;
}

function approvalText(f, approveUrl) {
  const full = `WilGlobo TechCare: ${f.Job_Code || "Job"} complete - ${first(f.Client_Name)}. Total ${money(f.Job_Total)} (worker pay ${money(f.Worker_Pay_Total)}). Tap to approve + send the invoice (Square card link / e-transfer): ${approveUrl} Reply STOP to opt out.`;
  if (full.length <= 320) return full;
  return `WilGlobo TechCare: ${f.Job_Code || "Job"} complete. Total ${money(f.Job_Total)}. Approve + send invoice: ${approveUrl} Reply STOP to opt out.`;
}

function clientSmsBody(f, squareUrl) {
  const pay = squareUrl ? `Pay by card: ${squareUrl} ` : "";
  return `WilGlobo TechCare: your invoice for ${f.Job_Code || "your visit"} is ${money(f.Job_Total)} CAD. ${pay}Or e-transfer to ${ETRANSFER_TO}. Questions? Call 403-679-3039. Reply STOP to opt out.`;
}

function invoiceEmailHtml(f, tasks, squareUrl, invNo) {
  const rows = tasks.map((t) => {
    const tf = t.fields || {};
    const line = tf.Line_Total != null ? Number(tf.Line_Total) : Number(tf.Quantity || 1) * Number(tf.Unit_Price || 0);
    return `<tr><td style="padding:4px 8px">${esc(tf.Task_Line || "TechCare service")}</td><td style="padding:4px 8px;text-align:right">${Number(tf.Quantity || 1)}</td><td style="padding:4px 8px;text-align:right">${money(tf.Unit_Price)}</td><td style="padding:4px 8px;text-align:right">${money(line)}</td></tr>`;
  }).join("");
  return `<div style="font-family:sans-serif;max-width:480px">
    <h2 style="margin:0 0 4px">WilGlobo TechCare</h2>
    <p style="color:#555;margin:0 0 16px">Invoice ${esc(invNo)} — ${esc(f.Job_Code || "")}</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <thead><tr><th style="text-align:left;padding:4px 8px">Item</th><th style="padding:4px 8px">Qty</th><th style="padding:4px 8px">Rate</th><th style="padding:4px 8px">Total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="font-size:18px;font-weight:bold;margin:16px 0">Total: ${money(f.Job_Total)} CAD</p>
    ${squareUrl ? `<p><a href="${esc(squareUrl)}" style="background:#1c5fd6;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Pay by card (Square)</a></p>` : ""}
    <p style="font-size:14px">Or pay by Interac e-transfer to <b>${ETRANSFER_TO}</b>.</p>
    <p style="color:#888;font-size:12px;margin-top:24px">WilGlobo TechCare · tech@wilglobo.com · (403) 679-3039 · GST# 790403166 RT0001</p>
  </div>`;
}

async function airtable(path, method, body, write) {
  const key = write ? process.env.AIRTABLE_WRITE_KEY || process.env.AIRTABLE_API_KEY : process.env.AIRTABLE_API_KEY;
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (method === "GET" && res.status === 404) return null;
  if (!res.ok) throw new Error(`Airtable ${method} ${path.split("?")[0]} ${res.status}`);
  return res.json();
}

async function markerExists(jobId, formType) {
  const params = new URLSearchParams();
  params.set("pageSize", "100");
  params.set("filterByFormula", `AND({Form_Type}='${formType}',IS_AFTER(CREATED_TIME(),DATEADD(NOW(),-30,'days')))`);
  params.append("fields[]", "Related_Job");
  const data = await airtable(`${UPDATES_TABLE}?${params}`, "GET");
  return ((data && data.records) || []).some((r) => (((r.fields || {}).Related_Job) || []).includes(jobId));
}

async function addMarker(jobId, formType, code, notes) {
  await airtable(UPDATES_TABLE, "POST", {
    records: [{
      fields: {
        Submission: `${code || jobId} - ${formType}`,
        Related_Job: [jobId],
        Form_Type: formType,
        Submitted_By: "Invoice Approval (portal)",
        Status_Set: "(no status change)",
        Notes: notes,
      },
    }],
    typecast: true,
  }, true);
}

// Sends the client invoice for an approved job. Returns a result the
// confirmation page renders. Once-only via the "Invoice Sent" marker.
async function runInvoiceApproval(jobId) {
  const job = await airtable(`${JOBS_TABLE}/${jobId}`, "GET");
  if (!job) return { action: "error", message: "That job was not found." };
  const f = job.fields || {};
  if (f.Status !== "Completed") {
    return { action: "not_completed", message: "This job is not marked Completed yet, so no invoice was sent." };
  }
  if (await markerExists(jobId, "Invoice Sent")) {
    return { action: "already", total: f.Job_Total, code: f.Job_Code };
  }

  const clientId = (f.Client || [])[0];
  const client = clientId ? await airtable(`${CLIENTS_TABLE}/${clientId}`, "GET") : null;
  const cf = (client && client.fields) || {};

  const tParams = new URLSearchParams();
  tParams.set("pageSize", "100");
  for (const tf of ["Task_Line", "Quantity", "Unit_Price", "Line_Total", "Job"]) tParams.append("fields[]", tf);
  const allTasks = await airtable(`${TASKS_TABLE}?${tParams}`, "GET");
  const tasks = ((allTasks && allTasks.records) || []).filter((t) => (((t.fields || {}).Job) || []).includes(jobId));

  const invNo = invoiceNo();
  const square = await createSquareCheckoutUrl({ amount: Number(f.Job_Total || 0), description: `TechCare ${f.Job_Code || ""}`, invoiceNo: invNo });
  const squareUrl = square.url || null;

  const sent = { sms: null, email: null, squareUrl, invoiceNo: invNo, total: f.Job_Total, code: f.Job_Code, client: cf.Client_Name || first(f.Client_Name) };

  const phone = workerPhoneE164(cf.Phone || "");
  if (phone) {
    const body = clientSmsBody(f, squareUrl);
    const v = validateSms(phone, body);
    if (v.valid) {
      try {
        const { sid } = await sendSms(v.to, v.body);
        sent.sms = { to: phone, sid };
      } catch (e) {
        sent.sms = { to: phone, error: e.code || "sms_send_failed" };
      }
    } else {
      sent.sms = { to: phone, error: v.error };
    }
  }

  if (cf.Email) {
    const r = await sendInvoiceEmail({
      to: cf.Email,
      subject: `WilGlobo TechCare — Invoice ${invNo}`,
      html: invoiceEmailHtml(f, tasks, squareUrl, invNo),
    });
    sent.email = { to: cf.Email, ...r };
  }

  await addMarker(jobId, "Invoice Sent", f.Job_Code,
    `Invoice ${invNo} for ${money(f.Job_Total)} approved by Wilton and sent. Square: ${squareUrl || square.reason || "none"}. SMS: ${sent.sms ? JSON.stringify(sent.sms) : "no client phone"}. Email: ${sent.email ? JSON.stringify(sent.email) : "no client email"}.`);
  return { action: "sent", ...sent };
}

module.exports = { approvalText, clientSmsBody, invoiceEmailHtml, runInvoiceApproval, markerExists, addMarker, OWNER_PHONE, _tables: { JOBS_TABLE, UPDATES_TABLE } };
