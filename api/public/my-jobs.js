// GET /my-jobs?w=<Directory record id>&c=<Sign_Code>
// The worker's personal, no-login My Jobs page — a faithful port of the
// retired n8n workflow "WilGlobo Ops Core - Worker My Jobs Page"
// (n8n retirement, tranche 3). Same link format, same validation, same
// window (today through +15 days, plus In Progress/Accepted jobs started
// up to 2 days ago), same "not valid" page for every failure mode, and
// the same cards. The only deliberate change: the logo is self-hosted.
const { pageShell, sendHtml, esc } = require("./_pageShell");

const BASE_ID = "appBiAKY6ivoImcaQ";
const JOBS_TABLE = "tblpsypl4j8CChNq1";
const DIRECTORY_TABLE = "tbllgRxtl2LbCMg2O";
const TZ = "America/Edmonton";
const REC_RE = /^rec[A-Za-z0-9]{14}$/;
const CODE_RE = /^[a-f0-9]{32}$/;

function edmontonMidnightUTC(ref = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(ref);
  const get = (t) => Number((parts.find((p) => p.type === t) || {}).value);
  let guess = Date.UTC(get("year"), get("month") - 1, get("day"));
  for (let i = 0; i < 2; i++) {
    const wall = new Date(new Date(guess).toLocaleString("en-US", { timeZone: TZ }));
    const offset = wall.getTime() - guess;
    if (offset === 0) break;
    guess -= offset;
  }
  return new Date(guess);
}

function dayKey(iso) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
  const get = (t) => (parts.find((p) => p.type === t) || {}).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function dayHeading(iso, todayKeyStr, tomorrowKeyStr) {
  const k = dayKey(iso);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric" }).formatToParts(new Date(iso));
  const get = (t) => (parts.find((p) => p.type === t) || {}).value || "";
  if (k === tomorrowKeyStr) return `Tomorrow, ${get("month")} ${get("day")}`;
  return `${get("weekday")}, ${get("month")} ${get("day")}`;
}
function timeRange(startIso, endIso) {
  const fmt = (iso) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(new Date(iso));
    const get = (t) => (parts.find((p) => p.type === t) || {}).value || "";
    return `${get("hour")}:${get("minute")} ${get("dayPeriod")}`;
  };
  return endIso ? `${fmt(startIso)} to ${fmt(endIso)}` : fmt(startIso);
}

function pill(status) {
  switch (status) {
    case "Dispatched": return '<span class="pill amber">Please accept</span>';
    case "Accepted": return '<span class="pill">Accepted</span>';
    case "In Progress": return '<span class="pill">On site now</span>';
    case "Completed": return '<span class="pill">Done</span>';
    case "Issues/Blocked": return '<span class="pill red">Problem reported</span>';
    default: return `<span class="pill">${esc(status || "")}</span>`;
  }
}

function jobCard(f) {
  const status = f.Status || "";
  const address = (Array.isArray(f.Client_Address) ? f.Client_Address.join(" ") : f.Client_Address) || f.Location || "";
  const phone = Array.isArray(f.Client_Phone) ? f.Client_Phone[0] : f.Client_Phone;
  const client = Array.isArray(f.Client_Name) ? f.Client_Name.join(", ") : f.Client_Name || "";
  const formUrl = f.Status_Form_URL || "";
  const brief = f.Brief_Google_Doc_URL || "";
  const cls = status === "Completed" ? "card done" : status === "Issues/Blocked" ? "card blocked" : "card";
  let html = `<div class="${cls}">`;
  html += `<div class="time">${esc(timeRange(f.Start_Time, f.End_Time))}${pill(status)}</div>`;
  html += `<div class="meta"><b>${esc(f.Job_Code || "")}</b> ${esc(f.Job_Name || "Job")}</div>`;
  if (client) html += `<div class="meta">Client: ${esc(client)}</div>`;
  if (address) html += `<div class="meta">${esc(address)}</div>`;
  html += '<div class="chips">';
  if (address) html += `<a class="chip" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}">Map</a>`;
  if (phone) html += `<a class="chip" href="tel:${esc(String(phone).replace(/[^+0-9]/g, ""))}">Call ${esc(phone)}</a>`;
  html += "</div>";
  if (/^https?:\/\//i.test(formUrl)) {
    html += `<a class="bigbtn" href="${esc(formUrl)}">Open job</a>`;
  } else {
    html += `<div class="meta" style="margin-top:12px">Job link not ready yet. Call 403-679-3039.</div>`;
  }
  if (/^https?:\/\//i.test(brief)) {
    html += `<a class="brief" href="${esc(brief)}">Read brief</a>`;
  }
  html += "</div>";
  return html;
}

function notValidPage() {
  return pageShell({
    title: "Link not valid | TechCare by WilGlobo",
    body: `<h1>Sorry</h1><div class="empty">This link is not valid. Call 403-679-3039.</div>`,
  });
}

async function airtableGet(tableId, recordId, key) {
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${tableId}/${recordId}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Airtable get ${res.status}`);
  return res.json();
}

async function airtableSearch(formula, fields, key) {
  const params = new URLSearchParams();
  params.set("pageSize", "100");
  params.set("filterByFormula", formula);
  for (const f of fields) params.append("fields[]", f);
  params.append("sort[0][field]", "Start_Time");
  params.append("sort[0][direction]", "asc");
  let records = [];
  let offset;
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${JOBS_TABLE}`);
    url.search = params.toString();
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) throw new Error(`Airtable search ${res.status}`);
    const data = await res.json();
    records = records.concat(data.records || []);
    offset = data.offset;
  } while (offset);
  return records;
}

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });
  try {
    const w = String(req.query?.w || "").trim();
    const c = String(req.query?.c || "").trim().toLowerCase();
    if (!REC_RE.test(w) || !CODE_RE.test(c) || !process.env.AIRTABLE_API_KEY) {
      return sendHtml(res, notValidPage());
    }
    const key = process.env.AIRTABLE_API_KEY;
    const worker = await airtableGet(DIRECTORY_TABLE, w, key).catch(() => null);
    if (!worker || worker.id !== w) return sendHtml(res, notValidPage());
    const wf = worker.fields || {};
    const statusName = wf.Status && typeof wf.Status === "object" ? wf.Status.name : wf.Status;
    const signCode = String(wf.Sign_Code || "");
    if (statusName === "Inactive" || signCode.length !== 32 || signCode.toLowerCase() !== c) {
      return sendHtml(res, notValidPage());
    }

    const firstName = String(wf.Full_Name || "").trim().split(/\s+/)[0] || "there";
    const t0 = edmontonMidnightUTC();
    const minus1s = new Date(t0.getTime() - 1000).toISOString();
    const plus15 = new Date(t0.getTime() + 15 * 24 * 3600 * 1000).toISOString();
    const minus2d = new Date(t0.getTime() - 2 * 24 * 3600 * 1000).toISOString();
    const formula =
      `AND({Status}!='Cancelled',{Status}!='Draft',{Start_Time},` +
      `OR(AND(IS_AFTER({Start_Time},DATETIME_PARSE('${minus1s}')),IS_BEFORE({Start_Time},DATETIME_PARSE('${plus15}'))),` +
      `AND(OR({Status}='In Progress',{Status}='Accepted'),IS_AFTER({Start_Time},DATETIME_PARSE('${minus2d}')))))`;
    const records = await airtableSearch(formula, [
      "Job_Name", "Job_Code", "Assigned_To", "Location", "Start_Time", "End_Time",
      "Status", "Client_Name", "Client_Phone", "Client_Address", "Status_Form_URL", "Brief_Google_Doc_URL",
    ], key);
    const jobs = records
      .map((r) => r.fields || {})
      .filter((f) => Array.isArray(f.Assigned_To) && f.Assigned_To.includes(w) && f.Start_Time && !isNaN(Date.parse(f.Start_Time)))
      .sort((a, b) => Date.parse(a.Start_Time) - Date.parse(b.Start_Time));

    const todayKey = dayKey(t0.toISOString());
    const tomorrowKey = dayKey(new Date(t0.getTime() + 24 * 3600 * 1000).toISOString());
    const todayParts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric" }).formatToParts(new Date());
    const tget = (t) => (todayParts.find((p) => p.type === t) || {}).value || "";

    let body = `<h1>Hi ${esc(firstName)}</h1><p class="sub">${esc(tget("weekday"))}, ${esc(tget("month"))} ${esc(tget("day"))}. Here are your jobs.</p>`;
    if (!jobs.length) {
      body += `<div class="empty">No jobs right now. We will email you when a new one is booked.</div>`;
    } else {
      const stillOpen = jobs.filter((f) => dayKey(f.Start_Time) < todayKey);
      const today = jobs.filter((f) => dayKey(f.Start_Time) === todayKey);
      const upcoming = jobs.filter((f) => dayKey(f.Start_Time) > todayKey);
      if (stillOpen.length) {
        body += `<h2 class="day">Still open</h2>`;
        let lastDay = "";
        for (const f of stillOpen) {
          const dk = dayKey(f.Start_Time);
          if (dk !== lastDay) { body += `<h2 class="day">${esc(dayHeading(f.Start_Time, todayKey, tomorrowKey))}</h2>`; lastDay = dk; }
          body += jobCard(f);
        }
      }
      body += `<h2 class="day">Today</h2>`;
      body += today.length ? today.map(jobCard).join("") : `<div class="empty">No jobs today.</div>`;
      if (upcoming.length) {
        body += `<h2 class="day">Coming up</h2>`;
        let lastDay = "";
        for (const f of upcoming) {
          const dk = dayKey(f.Start_Time);
          if (dk !== lastDay) { body += `<h2 class="day">${esc(dayHeading(f.Start_Time, todayKey, tomorrowKey))}</h2>`; lastDay = dk; }
          body += jobCard(f);
        }
      }
    }
    return sendHtml(res, pageShell({ title: "My jobs | TechCare by WilGlobo", body }));
  } catch (e) {
    console.error("my-jobs failed:", e);
    return sendHtml(res, notValidPage());
  }
};
