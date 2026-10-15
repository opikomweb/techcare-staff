// GET /api/resources?project=techcare
// The staff "Resources" bookshelf — WilGlobo's branded documents, read live
// from Airtable (base WilGlobo CRM & Ops Hub, table "Policies"), never
// hard-coded here. staff.resources (Postgres) still exists but has no seed
// content; Airtable is the real source of truth for these 17 documents, so
// that's what this endpoint reads.
//
// Read-only: this file only ever GETs from Airtable. It never creates or
// edits a Policies or Acknowledgements row — "Sign" just opens the document;
// the actual signature is collected wherever WilGlobo's sign-off flow lives
// (the Acknowledgements table is written there, not from this endpoint).
//
// Audience filtering: a worker sees documents whose Airtable "Audience"
// field includes "Worker" (their own agreements, safety, conduct, the
// company privacy policy, the AI use policy). Core staff additionally see
// "Internal" and "Public" documents (internal rules, public-facing terms).
// "Client"-only documents (service agreements, consent forms clients sign)
// are a different audience entirely and never show up here.
//
// Shelf grouping: the Policies table has no category field, so each
// document's shelf is inferred from its code/name — see shelfFor() below.
// Signature status: the Policies table has no per-worker signed flag either.
// Acknowledgement rows record who signed what in free text
// ("Ack_Summary": "<code> v<version> - <full name> - <date>"), so a
// "Signed by you" badge is a case-insensitive match of the signed-in
// person's name against that text for the matching Policy_Code. This is a
// best-effort read of real data, not a guess — but a name collision between
// two people could in principle mismatch, which is worth knowing if this
// badge is ever reported wrong.
const { verifyAndGetPerson } = require("./_staffAuth");

const AIRTABLE_BASE = "appBiAKY6ivoImcaQ";
const POLICIES_TABLE = "tblUgRM9XLfyGplVR";
const ACK_TABLE = "tbl8a0ZsHRAWsObCi";

async function airtableGet(table, params) {
  const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${table}`);
  for (const [k, v] of Object.entries(params || {})) {
    if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, item));
    else url.searchParams.set(k, v);
  }
  const out = [];
  let offset;
  do {
    if (offset) url.searchParams.set("offset", offset);
    else url.searchParams.delete("offset");
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Airtable ${table} ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    out.push(...(data.records || []));
    offset = data.offset;
  } while (offset);
  return out;
}

// Keyword-based shelf assignment, in priority order — see the file header
// comment for why this can't just be a Category field.
function shelfFor(code, name) {
  const n = (name || "").toLowerCase();
  if (/safety/.test(n)) return "Safety";
  if (/privacy|confidential|breach/.test(n)) return "Privacy";
  if (/agreement|terms|waiver|employment letter/.test(n)) return "Agreements";
  if (/onboard/.test(n)) return "Training";
  if (/consent/.test(n)) return "Forms and Templates";
  return "Policies";
}

const SHELF_ORDER = ["Agreements", "Policies", "Safety", "Privacy", "Training", "Forms and Templates"];

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const result = await verifyAndGetPerson(req);
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    const { person } = result;

    if (!process.env.AIRTABLE_API_KEY) {
      return res.status(503).json({ error: "Resources aren't connected yet — contact WilGlobo support to finish this setup." });
    }

    const [policyRecords, ackRecords] = await Promise.all([
      airtableGet(POLICIES_TABLE, {
        "fields[]": ["Policy_Name", "Policy_Code", "Audience", "Requires_Signature", "Version", "Effective_Date", "Status", "Doc_URL"],
        pageSize: 100,
      }),
      airtableGet(ACK_TABLE, {
        "fields[]": ["Ack_Summary", "Policy_Code"],
        pageSize: 100,
      }),
    ]);

    const personName = (person.full_name || "").trim().toLowerCase();
    const signedCodes = new Set();
    if (personName) {
      for (const rec of ackRecords) {
        const summary = (rec.fields.Ack_Summary || "").toLowerCase();
        if (!summary.includes(personName)) continue;
        const codes = rec.fields.Policy_Code;
        (Array.isArray(codes) ? codes : [codes]).filter(Boolean).forEach((c) => signedCodes.add(c));
      }
    }

    const audiences = person.is_core_staff ? ["Worker", "Internal", "Public"] : ["Worker"];

    const docs = policyRecords
      .filter((r) => r.fields.Status === "Approved")
      .filter((r) => (r.fields.Audience || []).some((a) => audiences.includes(a)))
      .map((r) => {
        const f = r.fields;
        const requiresSignature = !!f.Requires_Signature;
        const badge = !requiresSignature
          ? "read_only"
          : signedCodes.has(f.Policy_Code)
          ? "signed"
          : "needs_signature";
        return {
          id: r.id,
          code: f.Policy_Code || "",
          title: f.Policy_Name || "Untitled document",
          version: f.Version || "",
          lastUpdated: f.Effective_Date || null,
          url: f.Doc_URL || null,
          shelf: shelfFor(f.Policy_Code, f.Policy_Name),
          badge,
        };
      })
      .sort((a, b) => SHELF_ORDER.indexOf(a.shelf) - SHELF_ORDER.indexOf(b.shelf) || a.title.localeCompare(b.title));

    return res.status(200).json({
      resources: docs,
      shelves: SHELF_ORDER,
      notice: docs.length === 0 ? "No documents have been added yet — ask WilGlobo support." : null,
    });
  } catch (e) {
    console.error("api/resources error:", e);
    return res.status(500).json({ error: "Server error." });
  }
};
