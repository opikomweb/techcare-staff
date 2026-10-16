// GET /api/resources?project=techcare
// The staff "Resources" bookshelf — merges two sources that both hold real
// content, neither of which the worker screen used to read in full:
//
// 1. Airtable (base WilGlobo CRM & Ops Hub, table "Policies") — the signed,
//    versioned compliance documents, where "needs_signature" / "signed" is
//    backed by a real Acknowledgements record. This is also what the
//    compliance-gap checks elsewhere (admin ops-summary) are driven from,
//    so it stays the source of truth for anything with real sign-off.
// 2. staff.resources (Postgres) — the project-scoped resource list the
//    admin dashboard's Resources tab manages (title, category, URL,
//    description, required, engagement-track targeting). Until this file
//    was fixed, this table was write-only from the admin's point of view:
//    rows saved there were never read back out, so anything added through
//    that screen was invisible to staff. It's merged in here now, with its
//    own "required" flag shown the same way as an Airtable required doc
//    (no separate signature tracking exists for these yet — "Sign" and
//    "Read" both just open the link, same as for Airtable docs).
//
// This file only ever reads both sources. Nothing here writes a Policies,
// Acknowledgements, or staff.resources row — "Sign" just opens the
// document; the actual signature is collected wherever WilGlobo's sign-off
// flow lives (Airtable Acknowledgements is written there, not here; the
// Postgres-managed docs have no sign-off mechanism at all yet).
//
// Audience filtering (Airtable docs): a worker sees documents whose
// Airtable "Audience" field includes "Worker" (their own agreements,
// safety, conduct, the company privacy policy, the AI use policy). Core
// staff additionally see "Internal" and "Public" documents. "Client"-only
// documents (service agreements, consent forms clients sign) are a
// different audience entirely and never show up here.
//
// Project/track filtering (Postgres docs): a staff.resources row with a
// project_id shows only to people with an active role on that project;
// project_id null means "all projects". A row with engagement_tracks set
// shows only to people whose engagement track on that project matches;
// null means everyone on the project.
//
// Shelf grouping: Airtable's Policies table has no category field, so its
// documents' shelf is inferred from the code/name — see shelfFor() below.
// staff.resources rows use their own category column directly (see
// CATEGORY_SHELF) since that's reliable and admin-chosen.
// Signature status (Airtable only): Acknowledgement rows record who signed
// what in free text ("Ack_Summary": "<code> v<version> - <full name> -
// <date>"), so a "Signed by you" badge is a case-insensitive match of the
// signed-in person's name against that text for the matching Policy_Code.
// This is a best-effort read of real data, not a guess — but a name
// collision between two people could in principle mismatch, which is
// worth knowing if this badge is ever reported wrong.
const { verifyAndGetPerson, withStaffAuth } = require("./_staffAuth");

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

// staff.resources has a reliable, admin-chosen category — map it straight
// to a shelf rather than guessing from title text.
const CATEGORY_SHELF = {
  policy: "Policies",
  agreement: "Agreements",
  code_of_conduct: "Policies",
  form: "Forms and Templates",
  training: "Training",
  other: "Policies",
};
const CATEGORY_CODE = {
  policy: "POLICY",
  agreement: "AGREEMENT",
  code_of_conduct: "CODE OF CONDUCT",
  form: "FORM",
  training: "TRAINING",
  other: "DOCUMENT",
};

async function loadPostgresResources(uid, personId, projectSlug, roles) {
  return withStaffAuth(uid, async (client) => {
    const { rows } = await client.query(
      `select r.id, r.category, r.title, r.description, r.url, r.required, r.engagement_tracks,
              ack.acknowledged_at
         from staff.resources r
         left join staff.projects proj on proj.id = r.project_id
         left join staff.resource_acknowledgements ack
           on ack.resource_id = r.id and ack.person_id = $2
        where r.project_id is null or proj.slug = $1`,
      [projectSlug, personId]
    );
    const myRole = (roles || []).find((rr) => rr.slug === projectSlug && rr.role_active);
    const myTrack = myRole ? myRole.engagement_track : null;
    return rows
      .filter((r) => !r.engagement_tracks || r.engagement_tracks.length === 0 || (myTrack && r.engagement_tracks.includes(myTrack)))
      .map((r) => ({
        id: "pg_" + r.id,
        resourceId: r.id,
        code: CATEGORY_CODE[r.category] || "DOCUMENT",
        title: r.title,
        version: "",
        lastUpdated: null,
        url: r.url,
        description: r.description || null,
        shelf: CATEGORY_SHELF[r.category] || "Policies",
        badge: !r.required ? "read_only" : r.acknowledged_at ? "signed" : "needs_signature",
        acknowledgeable: !!r.required,
        acknowledgedAt: r.acknowledged_at || null,
      }));
  });
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const result = await verifyAndGetPerson(req);
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    const { person, roles, uid } = result;
    const projectSlug = (req.query.project || "").trim();

    let airtableDocs = [];
    let airtableError = null;
    if (process.env.AIRTABLE_API_KEY) {
      try {
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

        airtableDocs = policyRecords
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
          });
      } catch (e) {
        // Airtable being unreachable shouldn't hide the staff.resources
        // docs that are reachable — surface what we can and note the gap.
        console.error("api/resources Airtable error:", e);
        airtableError = "Some documents (Airtable) couldn't be loaded right now.";
      }
    }

    let pgDocs = [];
    try {
      pgDocs = projectSlug ? await loadPostgresResources(uid, person.id, projectSlug, roles) : [];
    } catch (e) {
      console.error("api/resources staff.resources error:", e);
    }

    // De-dupe: several staff.resources rows are hand-copies of documents
    // that already live in Airtable (same title) — Airtable carries real
    // signature tracking for those, so when a title matches one already
    // visible to this person, drop the staff.resources copy rather than
    // show the same document twice.
    const norm = (s) => (s || "").trim().toLowerCase();
    const airtableTitles = new Set(airtableDocs.map((d) => norm(d.title)));
    pgDocs = pgDocs.filter((d) => !airtableTitles.has(norm(d.title)));

    const docs = airtableDocs.concat(pgDocs)
      .sort((a, b) => SHELF_ORDER.indexOf(a.shelf) - SHELF_ORDER.indexOf(b.shelf) || a.title.localeCompare(b.title));

    return res.status(200).json({
      resources: docs,
      shelves: SHELF_ORDER,
      notice: docs.length === 0 ? (airtableError || "No documents have been added yet — ask WilGlobo support.") : airtableError,
    });
  } catch (e) {
    console.error("api/resources error:", e);
    return res.status(500).json({ error: "Server error." });
  }
};
