// GET /pack?kind=<client|worker>&id=<record id>
// The "send this person their signing pack now" link — replaces the
// retired n8n ops-pack webhook. The n8n link used HTTP Basic Auth; the
// portal version requires a signed-in core-staff session instead
// (stronger, and Wilton is the only person who ever clicks it). The
// response text is the original's, so the Airtable-side habit carries
// over. Invalid ids get the same page with no action taken, as before.
const { fetchPolicies, sendPackFor } = require("../_signpack");
const { requireCoreStaff } = require("../admin/_requireCoreStaff");

const BASE_ID = "appBiAKY6ivoImcaQ";
const CLIENTS_TABLE = "tblY473voC9AylgFF";
const DIRECTORY_TABLE = "tbllgRxtl2LbCMg2O";
const REC_RE = /^rec[A-Za-z0-9]{14}$/;
const TEXT = "Signing pack is on its way. If everything is already signed, or there is no email on the record, Wilton gets an email instead. You can close this tab.";

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  try {
    const gate = await requireCoreStaff(req);
    if (gate.error) return res.status(gate.status || 401).send("Sign in as core staff first, then open this link again.");
    const id = String(req.query?.id || "");
    const kind = req.query?.kind === "worker" ? "worker" : "client";
    if (REC_RE.test(id) && process.env.AIRTABLE_API_KEY) {
      const tableId = kind === "worker" ? DIRECTORY_TABLE : CLIENTS_TABLE;
      const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${tableId}/${id}`, {
        headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` },
      });
      if (r.ok) {
        const record = await r.json();
        // A full record may lack a field the sweep normally requests;
        // re-read with the pack field set for correctness.
        const fields = kind === "worker"
          ? ["Full_Name", "Email", "Phone_E164", "Phone", "Signed_Codes", "Sign_Code", "Engagement_Track"]
          : ["Client_Name", "Email", "Phone", "Signed_Codes", "Sign_Code"];
        const params = new URLSearchParams();
        for (const f of fields) params.append("fields[]", f);
        const r2 = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${tableId}/${id}?${params}`, {
          headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` },
        });
        const full = r2.ok ? await r2.json() : record;
        const policies = await fetchPolicies(process.env.AIRTABLE_API_KEY);
        await sendPackFor(full, kind, policies, {
          readKey: process.env.AIRTABLE_API_KEY,
          writeKey: process.env.AIRTABLE_WRITE_KEY || process.env.AIRTABLE_API_KEY,
        });
      }
    }
    return res.status(200).send(TEXT);
  } catch (e) {
    console.error("pack failed:", e);
    return res.status(200).send(TEXT);
  }
};
