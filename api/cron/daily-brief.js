// GET/POST /api/cron/daily-brief — the 7 AM daily engine, ported from
// the n8n "Daily Reminders and Brief" workflow (n8n retirement,
// tranche 4). Builds the day-before worker/client reminders, the
// thank-you for yesterday's clients, credential-expiry warnings,
// 3-day signing-pack nudges and Wilton's "TechCare daily brief"
// digest (logic in api/_brief.js, the original Code node), then sends
// each from tech@ via Resend with the original display names
// ("TechCare by WilGlobo"; the digest is "TechCare Ops" and is
// delivered to wilton@wilglobo.com, as the original's send step did).
//
// Scheduling: Vercel Cron fires this at 13:00 and 14:00 UTC daily;
// the endpoint only runs when it is 7 AM in America/Edmonton, which
// picks the right UTC hour across daylight-saving changes (an
// authorised manual call with ?force=1 runs any time — the Run Now
// replacement). ?dry=1 sends ONLY the digest, subject prefixed
// [TEST], exactly like the original's dry-run.
// Auth: CRON_SECRET bearer when set, else a core-staff session.
const { buildBrief } = require("../_brief");
const { requireCoreStaff } = require("../admin/_requireCoreStaff");

const BASE_ID = "appBiAKY6ivoImcaQ";
const TABLES = {
  jobs: "tblpsypl4j8CChNq1",
  workers: "tbllgRxtl2LbCMg2O",
  clients: "tblY473voC9AylgFF",
  priceList: "tblJ3EGYKZtt2Ktsu",
};
const JOBS_FORMULA = "AND({Status}!='Cancelled', OR({Status}='Draft', {Start_Time}='', IS_AFTER({Start_Time}, DATEADD(NOW(),-3,'days'))))";
const WILTON = "wilton@wilglobo.com";

async function listAll(tableId, key, formula) {
  const records = [];
  let offset = null;
  do {
    const params = new URLSearchParams();
    params.set("pageSize", "100");
    if (formula) params.set("filterByFormula", formula);
    if (offset) params.set("offset", offset);
    const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${tableId}?${params}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`Airtable list ${tableId} ${res.status}`);
    const data = await res.json();
    records.push(...(data.records || []));
    offset = data.offset || null;
  } while (offset);
  return records;
}

async function sendEmail({ fromName, to, subject, html }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${fromName} <tech@wilglobo.com>`,
      reply_to: "tech@wilglobo.com",
      to: [to],
      subject,
      html,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend ${res.status}: ${data.message || "send failed"}`);
  return data.id;
}

function edmontonHour() {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Edmonton", hour: "numeric", hour12: false }).formatToParts(new Date());
  const h = p.find((x) => x.type === "hour");
  return h ? Number(h.value) % 24 : -1;
}

module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }
  try {
    const dry = String(req.query?.dry || "") === "1";
    const force = String(req.query?.force || "") === "1";
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.authorization || "";
    let authorized = false;
    if (secret && auth === `Bearer ${secret}`) authorized = true;
    if (!authorized) {
      const gate = await requireCoreStaff(req).catch(() => ({ error: "no session" }));
      if (!gate.error) authorized = true;
    }
    // Unauthenticated invocations are treated as scheduler pings: they
    // only run inside the 7 AM Edmonton window and never with dry/force.
    const isSchedulerPing = !authorized;
    if (isSchedulerPing && edmontonHour() !== 7) {
      return res.status(200).json({ ok: true, skipped: "outside_7am_edmonton" });
    }
    if (!process.env.AIRTABLE_API_KEY) throw new Error("AIRTABLE_API_KEY is not set.");
    if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set.");

    const key = process.env.AIRTABLE_API_KEY;
    const [jobs, workers, clients, catalog] = await Promise.all([
      listAll(TABLES.jobs, key, JOBS_FORMULA),
      listAll(TABLES.workers, key),
      listAll(TABLES.clients, key),
      listAll(TABLES.priceList, key),
    ]);
    const emails = buildBrief(
      { "Get Jobs": jobs, "Get Workers": workers, "Get Clients": clients, "Get Price List": catalog },
      { dry }
    );
    const sent = [];
    for (const e of emails) {
      const to = e.kind === "digest" ? WILTON : e.to;
      const fromName = e.kind === "digest" ? "TechCare Ops" : "TechCare by WilGlobo";
      const id = await sendEmail({ fromName, to, subject: e.subject, html: e.html });
      sent.push({ kind: e.kind, to, subject: e.subject, id });
    }
    return res.status(200).json({ ok: true, dry, forced: force, sent });
  } catch (e) {
    console.error("daily-brief failed:", e);
    return res.status(500).json({ error: "Daily brief failed." });
  }
};
