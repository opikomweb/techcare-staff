// GET  /job-consent?job=<Jobs record id>&c=<Job_Key>  — the consent page
// POST /api/public/job-consent                        — the submission
//
// Per-job consent: the client reviews the itemised tasks and charges
// and either e-signs by typing their name or has the tech record a
// verbal on-site confirmation. A faithful port of the retired n8n
// "Job Consent (Tasks and Charges)" (n8n retirement, tranche 3),
// preserving: the strict Job_Key equality check (403 on mismatch), the
// stored strings ('E-Sign Link' / 'Verbal Confirm (on-site)' /
// 'Confirmed verbally on-site - ' prefix), the line-total rule
// (Line_Total, else Quantity × Unit_Price, Quantity default 1), and
// the fields sealed on the job (Signoff_Method, Client_Signed_Name,
// Invoice_Signed_At). As in the original there is deliberately no
// non-empty check on the typed name — flagged in the spec as existing
// behavior, kept rather than silently changed.
const { pageShell, sendHtml, esc } = require("./_pageShell");

const BASE_ID = "appBiAKY6ivoImcaQ";
const JOBS_TABLE = "tblpsypl4j8CChNq1";
const TASKS_TABLE = "tblDgvj31fP5rMvkI";
const WILTON = "wilton@wilglobo.com";
const FROM = "TechCare by WilGlobo <tech@wilglobo.com>";

const money = (n) => "$" + (Number(n) || 0).toFixed(2);

async function sendEmail({ to, subject, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [to], subject, text }),
    });
    const data = await res.json().catch(() => ({}));
    return res.ok ? { sent: true } : { sent: false, error: data.message || res.status };
  } catch (e) {
    return { sent: false, error: String(e) };
  }
}

async function airtable(method, path, key, body) {
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data && data.error && data.error.message) || `Airtable ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function getJob(jobId, key) {
  if (!jobId || !jobId.startsWith("rec")) return null;
  return airtable("GET", `/${JOBS_TABLE}/${jobId}`, key).catch(() => null);
}

async function listTasks(jobFields, key) {
  const ids = Array.isArray(jobFields.Job_Tasks) ? jobFields.Job_Tasks : [];
  if (!ids.length) return [];
  const formula = "OR(" + ids.map((id) => `RECORD_ID()='${id}'`).join(",") + ")";
  const params = new URLSearchParams();
  params.set("filterByFormula", formula);
  for (const f of ["Task_Line", "Quantity", "Unit_Price", "Line_Total", "Complexity_Note"]) params.append("fields[]", f);
  const data = await airtable("GET", `/${TASKS_TABLE}?${params}`, key);
  // Preserve the job's linked order.
  const byId = new Map((data.records || []).map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

function forbidden(res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(403).send(pageShell({
    title: "Link not valid | TechCare by WilGlobo",
    body: `<h1>Sorry</h1><div class="empty">This link is not valid. Call 403-679-3039.</div>`,
  }));
}

function consentPage(job, jobFields, tasks, c) {
  const name = jobFields.Job_Name || "Your TechCare visit";
  let total = 0;
  const rows = tasks.map((t) => {
    const f = t.fields || {};
    const qty = f.Quantity || 1;
    const unit = f.Unit_Price || 0;
    const line = f.Line_Total != null ? f.Line_Total : qty * unit;
    total += line;
    return `<tr><td style="padding:8px 6px;border-bottom:1px solid #e5eaf1">${esc(f.Task_Line || "Service")}${f.Complexity_Note ? `<div style="color:#66717d;font-size:13px">${esc(f.Complexity_Note)}</div>` : ""}</td><td style="padding:8px 6px;border-bottom:1px solid #e5eaf1;text-align:right">${esc(qty)}</td><td style="padding:8px 6px;border-bottom:1px solid #e5eaf1;text-align:right">${money(unit)}</td><td style="padding:8px 6px;border-bottom:1px solid #e5eaf1;text-align:right">${money(line)}</td></tr>`;
  }).join("");
  const body = `
<h1>${esc(name)}</h1>
<p class="sub">Please review the tasks and charges below before work begins.</p>
<div class="card">
<table style="width:100%;border-collapse:collapse;font-size:15px">
<tr><th style="text-align:left;padding:6px">Task</th><th style="text-align:right;padding:6px">Qty</th><th style="text-align:right;padding:6px">Rate</th><th style="text-align:right;padding:6px">Line total</th></tr>
${rows}
<tr><td colspan="3" style="padding:10px 6px;text-align:right"><b>Total</b></td><td style="padding:10px 6px;text-align:right"><b>${money(total)}</b></td></tr>
</table>
<p style="color:#66717d;font-size:13px;margin:10px 0 0">GST (if applicable) is added at invoicing.</p>
</div>
<form id="f" method="post">
  <div class="card">
    <label style="margin-top:0"><input type="radio" name="signoffMethod" value="E-Sign Link" checked style="width:auto"> Sign with my name</label>
    <label for="signedName">Your full name</label>
    <input type="text" id="signedName" name="signedName" autocomplete="name">
  </div>
  <div class="card">
    <label style="margin-top:0"><input type="radio" name="signoffMethod" value="Verbal Confirm (on-site)" style="width:auto"> Confirmed verbally on-site</label>
    <label for="verbalNote">Technician note</label>
    <input type="text" id="verbalNote" name="verbalNote" placeholder="Technician: note who confirmed, e.g. 'Diane, in person'">
  </div>
  <button class="submit" type="submit">Confirm tasks and charges</button>
  <p id="msg" style="margin-top:10px"></p>
</form>
<script>
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = { job: ${JSON.stringify(job.id)}, c: ${JSON.stringify(c)},
    signoffMethod: fd.get('signoffMethod') || '', signedName: fd.get('signedName') || '', verbalNote: fd.get('verbalNote') || '' };
  const msg = document.getElementById('msg');
  msg.textContent = 'Recording…';
  try {
    const res = await fetch('/api/public/job-consent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const html = await res.text();
    document.open(); document.write(html); document.close();
  } catch (err) {
    msg.textContent = 'Could not record. Check your connection and try again, or call 403-679-3039.';
  }
});
</script>`;
  return pageShell({ title: "Confirm tasks and charges | TechCare by WilGlobo", body });
}

function thanksPage() {
  return pageShell({
    title: "Confirmed | TechCare by WilGlobo",
    body: `<h1>Thank you</h1><div class="empty">Your confirmation is recorded. We will get started.</div>`,
  });
}

module.exports = async (req, res) => {
  try {
    const readKey = process.env.AIRTABLE_API_KEY;
    if (!readKey) return forbidden(res);
    if (req.method === "GET") {
      const jobId = String(req.query?.job || "");
      const c = String(req.query?.c || "");
      const job = await getJob(jobId, readKey);
      if (!job || c !== String((job.fields || {}).Job_Key || "")) return forbidden(res);
      const tasks = await listTasks(job.fields || {}, readKey);
      return sendHtml(res, consentPage(job, job.fields || {}, tasks, c));
    }
    if (req.method === "POST") {
      const b = req.body || {};
      const jobId = String(b.job || "");
      const c = String(b.c || "");
      const job = await getJob(jobId, readKey);
      if (!job || c !== String((job.fields || {}).Job_Key || "")) return forbidden(res);
      const method = String(b.signoffMethod || "");
      const signedName = method === "E-Sign Link"
        ? String(b.signedName || "")
        : "Confirmed verbally on-site - " + (String(b.verbalNote || "") || "no note");
      const signedAt = new Date().toISOString();
      const writeKey = process.env.AIRTABLE_WRITE_KEY || readKey;
      await airtable("PATCH", `/${JOBS_TABLE}/${job.id}`, writeKey, {
        fields: { Signoff_Method: method, Client_Signed_Name: signedName, Invoice_Signed_At: signedAt },
        typecast: true,
      });
      const jobName = (job.fields || {}).Job_Name || "Your TechCare visit";
      await sendEmail({
        to: WILTON,
        subject: `Client confirmed tasks/charges - ${jobName}`,
        text: `${jobName} was confirmed by the client.\nMethod: ${method}\nSigned as: ${signedName}\nAt: ${signedAt}`,
      }).catch(() => {});
      return sendHtml(res, thanksPage());
    }
    return res.status(405).json({ error: "Method not allowed." });
  } catch (e) {
    console.error("job-consent failed:", e);
    return forbidden(res);
  }
};
