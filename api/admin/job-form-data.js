// GET /api/admin/job-form-data
// Clients and Active workers for the "+ New Job" / "Assign staff" forms
// on the admin Jobs tab. Read-only (AIRTABLE_API_KEY) — this endpoint
// never writes; api/admin/jobs.js does the actual create/assign.
const { requireCoreStaff } = require("./_requireCoreStaff");

const BASE_ID = "appBiAKY6ivoImcaQ";
const CLIENTS_TABLE = "tblY473voC9AylgFF";
const DIRECTORY_TABLE = "tbllgRxtl2LbCMg2O";

async function airtableList(tableId, fieldIds, extraParams) {
  const params = new URLSearchParams();
  params.set("pageSize", "100");
  for (const f of fieldIds) params.append("fields[]", f);
  Object.entries(extraParams || {}).forEach(([k, v]) => params.set(k, v));
  let records = [];
  let offset;
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${tableId}`);
    url.search = params.toString();
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` } });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Airtable ${tableId} ${res.status}: ${text.slice(0, 200)}`);
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
      return res.status(503).json({ error: "Not connected yet — contact WilGlobo support to finish this setup." });
    }

    const [clientRecords, workerRecords] = await Promise.all([
      airtableList(CLIENTS_TABLE, ["Client_Name", "Client_Gaps"]),
      airtableList(DIRECTORY_TABLE, ["Full_Name", "Status", "Dispatch_Gaps"], {
        filterByFormula: "{Status}='Active'",
      }),
    ]);

    const clients = clientRecords
      .map((r) => ({ id: r.id, name: r.fields.Client_Name || "Unnamed client", gaps: r.fields.Client_Gaps || "" }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const workers = workerRecords
      .map((r) => ({
        id: r.id,
        name: r.fields.Full_Name || "Unnamed worker",
        ready: !(r.fields.Dispatch_Gaps && r.fields.Dispatch_Gaps.trim()),
        gaps: r.fields.Dispatch_Gaps || "",
      }))
      .sort((a, b) => (a.ready === b.ready ? a.name.localeCompare(b.name) : a.ready ? -1 : 1));

    return res.status(200).json({ clients, workers });
  } catch (e) {
    console.error("api/admin/job-form-data error:", e);
    return res.status(500).json({ error: "Couldn't load job form data right now." });
  }
};
