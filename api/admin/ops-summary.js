// GET /api/admin/ops-summary
// Pulls live TechCare ops status straight from Airtable (base appBiAKY6ivoImcaQ)
// for the admin dashboard's infographic tiles: jobs by status, jobs that
// need attention, workers not ready (insurance/WCB/compliance gaps),
// clients with unsigned forms, money owed, and signatures this week.
// This mirrors what the Airtable "TechCare Ops Command" interface already
// shows — it does not replace Airtable as the system of record for ops
// data, it just surfaces the same numbers next to the Supabase-backed
// staff/resources admin on one screen.
//
// Needs AIRTABLE_API_KEY (a personal access token scoped read-only to
// this base) as a Vercel env var. Without it, this endpoint returns a
// clear "not configured" error instead of fabricating numbers.
const { requireCoreStaff } = require("./_requireCoreStaff");

const BASE_ID = "appBiAKY6ivoImcaQ";
const TABLES = {
  jobs: "tblpsypl4j8CChNq1",
  directory: "tbllgRxtl2LbCMg2O",
  clients: "tblY473voC9AylgFF",
  acknowledgements: "tbl8a0ZsHRAWsObCi",
};

async function airtableList(tableId, fieldIds) {
  const params = new URLSearchParams();
  params.set("pageSize", "100");
  for (const f of fieldIds) params.append("fields[]", f);
  let records = [];
  let offset;
  do {
    const url = `https://api.airtable.com/v0/${BASE_ID}/${tableId}?${params.toString()}${offset ? `&offset=${offset}` : ""}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Airtable ${tableId} returned ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    records = records.concat(data.records || []);
    offset = data.offset;
  } while (offset);
  return records;
}

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });

  try {
    const gate = await requireCoreStaff(req);
    if (gate.error) return res.status(gate.status || 400).json({ error: gate.error });

    if (!process.env.AIRTABLE_API_KEY) {
      return res.status(503).json({
        error: "Ops summary isn't connected yet — contact WilGlobo support to finish this setup.",
      });
    }

    const [jobs, workers, clients, acks] = await Promise.all([
      airtableList(TABLES.jobs, [
        "Job_Name", "Status", "Start_Time", "Dispatch_Blockers", "Checkout_Overdue",
        "Open_For_Claim", "Job_Total", "Invoice_Status", "Client_Name",
      ]),
      airtableList(TABLES.directory, [
        "Full_Name", "Status", "Dispatch_Gaps", "Insurance_Expiry", "WCB_Clearance_Expiry", "Engagement_Track",
      ]),
      airtableList(TABLES.clients, ["Client_Name", "Client_Gaps"]),
      airtableList(TABLES.acknowledgements, ["Signed_At"]),
    ]);

    // Airtable deep links so "Needs attention" / "Workers not ready" /
    // etc. rows can open straight to the record behind them.
    const recordUrl = (tableId, recordId) => `https://airtable.com/${BASE_ID}/${tableId}/${recordId}`;

    // Jobs by status
    const jobsByStatus = {};
    let openForClaim = 0;
    let needsAttention = [];
    let moneyOwed = 0;
    for (const r of jobs) {
      const f = r.fields;
      const status = f.Status || "Unknown";
      jobsByStatus[status] = (jobsByStatus[status] || 0) + 1;
      if (f.Open_For_Claim) openForClaim++;
      if ((f.Dispatch_Blockers && f.Dispatch_Blockers.trim()) || f.Checkout_Overdue === 1 || status === "Issues/Blocked") {
        needsAttention.push({
          job: f.Job_Name || "Unnamed job",
          client: f.Client_Name || null,
          reason: f.Checkout_Overdue === 1 ? "Checkout overdue" : (f.Dispatch_Blockers || "Issues/Blocked"),
          recordUrl: recordUrl(TABLES.jobs, r.id),
        });
      }
      if (f.Invoice_Status === "Sent" && typeof f.Job_Total === "number") {
        moneyOwed += f.Job_Total;
      }
    }

    // Workers not ready. Full_Name can come back empty (Airtable omits
    // blank fields entirely, so f.Full_Name is undefined, not "") — that
    // used to render as a blank row with no way to tell which worker it
    // was. Always show a name now, falling back to "Unnamed worker" plus
    // a link straight to the Airtable record when there's nothing to show.
    const workersNotReady = [];
    const expiringSoon = [];
    const in30Days = Date.now() + 30 * 24 * 60 * 60 * 1000;
    for (const r of workers) {
      const f = r.fields;
      const name = (f.Full_Name && f.Full_Name.trim()) || "Unnamed worker";
      if (f.Status === "Active" && f.Dispatch_Gaps && f.Dispatch_Gaps.trim()) {
        workersNotReady.push({ name, gaps: f.Dispatch_Gaps.trim(), recordUrl: recordUrl(TABLES.directory, r.id) });
      }
      for (const [label, dateStr] of [["Insurance", f.Insurance_Expiry], ["WCB clearance", f.WCB_Clearance_Expiry]]) {
        if (dateStr) {
          const t = new Date(dateStr).getTime();
          if (!Number.isNaN(t) && t <= in30Days) {
            expiringSoon.push({ name, what: label, expires: dateStr, recordUrl: recordUrl(TABLES.directory, r.id) });
          }
        }
      }
    }

    // Clients with unsigned forms
    const clientsUnsigned = clients
      .filter((r) => r.fields.Client_Gaps && r.fields.Client_Gaps.trim())
      .map((r) => ({
        name: (r.fields.Client_Name && r.fields.Client_Name.trim()) || "Unnamed client",
        gaps: r.fields.Client_Gaps.trim(),
        recordUrl: recordUrl(TABLES.clients, r.id),
      }));

    // Signatures this week
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const signaturesThisWeek = acks.filter((r) => {
      const t = r.fields.Signed_At ? new Date(r.fields.Signed_At).getTime() : NaN;
      return !Number.isNaN(t) && t >= weekAgo;
    }).length;

    return res.status(200).json({
      jobsByStatus,
      openForClaim,
      needsAttention,
      workersNotReady,
      expiringSoon,
      clientsUnsigned,
      signaturesThisWeek,
      moneyOwed,
      totals: { jobs: jobs.length, workers: workers.length, clients: clients.length },
    });
  } catch (e) {
    console.error("api/admin/ops-summary error:", e);
    return res.status(500).json({ error: "Couldn't load ops data right now." });
  }
};
