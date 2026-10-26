// GET /api/shifts
// Lists open (unclaimed) TechCare shifts, read directly from Airtable —
// the system of record for job data, same as api/jobs.js.
//
// This endpoint used to proxy the n8n workflow "WilGlobo Ops Core - Open
// Shifts List". As of 2026-10-26 it is served by the portal itself (n8n
// retirement, tranche 1). The workflow's behavior is preserved exactly,
// including its 13 Oct 2026 security hardening: the client's name and exact
// address are never returned — the location is coarsened to a city
// quadrant before it leaves this endpoint, because a worker choosing
// whether to claim a shift needs roughly where/when/how long, not who.
// Requires a signed-in, active TechCare contractor (identity check only;
// Airtable itself still has the final say on what's actually claimable).
const { verifyAndGetContractor } = require("./_auth");

const BASE_ID = "appBiAKY6ivoImcaQ";
const JOBS_TABLE = "tblpsypl4j8CChNq1";
const OPEN_FORMULA = "AND({Open_For_Claim}=TRUE(),{Status}='Draft',{Assigned_To}=BLANK())";

function coarseArea(raw) {
  const s = String(raw || "");
  if (!s) return "Calgary";
  const q = s.toUpperCase().match(/\b(NW|NE|SW|SE)\b/);
  if (q) return "Calgary " + q[1];
  if (/\bairdrie\b/i.test(s)) return "Airdrie";
  if (/\bcochrane\b/i.test(s)) return "Cochrane";
  if (/\bchestermere\b/i.test(s)) return "Chestermere";
  if (/\bokotoks\b/i.test(s)) return "Okotoks";
  return "Calgary";
}

function hours(a, b) {
  if (!a || !b) return null;
  const t0 = Date.parse(a);
  const t1 = Date.parse(b);
  if (!isFinite(t0) || !isFinite(t1) || t1 <= t0) return null;
  return Math.round(((t1 - t0) / 3600000) * 10) / 10;
}

async function fetchOpenJobs() {
  const params = new URLSearchParams();
  params.set("pageSize", "100");
  params.set("filterByFormula", OPEN_FORMULA);
  for (const f of ["Job_Name", "Job_Code", "Location", "Start_Time", "End_Time"]) params.append("fields[]", f);
  params.append("sort[0][field]", "Start_Time");
  params.append("sort[0][direction]", "asc");
  let records = [];
  let offset;
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${JOBS_TABLE}`);
    url.search = params.toString();
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` } });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Airtable jobs ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    records = records.concat(data.records || []);
    offset = data.offset;
  } while (offset);
  return records;
}

function shapeShift(record) {
  const f = record.fields || {};
  const area = coarseArea(f.Location);
  return {
    id: record.id,
    title: f.Job_Name || "Job",
    code: f.Job_Code || "",
    area,
    // The staff page renders `location`; the old n8n payload only sent
    // `area`, so the area line never displayed. Send both, same value.
    location: area,
    start: f.Start_Time || null,
    end: f.End_Time || null,
    durationHours: hours(f.Start_Time, f.End_Time),
  };
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const result = await verifyAndGetContractor(req);
    if (result.error) return res.status(result.status).json({ error: result.error });

    if (!process.env.AIRTABLE_API_KEY) {
      return res.status(503).json({ error: "Not connected yet — contact WilGlobo support to finish this setup." });
    }

    const records = await fetchOpenJobs();
    const shifts = records.filter((r) => r.id && r.id.indexOf("rec") === 0).map(shapeShift);
    return res.status(200).json({ shifts, count: shifts.length });
  } catch (e) {
    console.error("shifts.js failed:", e);
    return res.status(500).json({ error: "Couldn't load open shifts right now. Try again shortly." });
  }
};

// Exported for tests.
module.exports._test = { coarseArea, hours, shapeShift, OPEN_FORMULA };
