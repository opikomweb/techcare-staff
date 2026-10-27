// POST /api/public/careers-apply — the intake endpoint behind the
// "join TechCare" form on techcares.ca, ported from the n8n
// "TechCare Careers: Apply Form Intake" workflow (tranche 4).
// Public by design (the careers form posts here); the contract is
// preserved exactly: body field names, the Airtable mapping
// (Availability/Comfort_Areas split on "," with no trimming, Status
// "New", Source constant), the sanitized alert email to Wilton
// (api/_careersAlert.js — a security-audit artifact, kept verbatim),
// the CORS allowlist, and the exact success JSON. As in the original,
// the record is saved before the alert is sent; a failure in either
// surfaces as an error rather than the success response.
const { buildCareersAlert } = require("../_careersAlert");

const BASE_ID = "appBiAKY6ivoImcaQ";
const APPLICANTS_TABLE = "tblyZYIfRs3GTHwsq";
const WILTON = "wilton@wilglobo.com";
const ALLOWED_ORIGINS = ["https://techcares.ca", "https://www.techcares.ca"];

module.exports = async (req, res) => {
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed." });
  try {
    const b = req.body || {};
    const writeKey = process.env.AIRTABLE_WRITE_KEY || process.env.AIRTABLE_API_KEY;
    if (!writeKey) throw new Error("Airtable key not configured.");
    const create = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${APPLICANTS_TABLE}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${writeKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        records: [{
          fields: {
            Full_Name: b.full_name || "",
            Email: b.email || "",
            Phone: b.phone || "",
            City_Area: b.city_area || "",
            Availability: b.availability ? String(b.availability).split(",") : [],
            Hours_Per_Week: b.hours_per_week || "",
            Comfort_Areas: b.comfort_areas ? String(b.comfort_areas).split(",") : [],
            Experience: b.experience || "",
            Why_TechCare: b.why_techcare || "",
            Has_Transportation: b.has_transportation === "yes",
            OK_Background_Check: b.ok_background_check === "yes",
            Status: "New",
            Source: "Careers page (techcares.ca)",
          },
        }],
        typecast: true,
      }),
    });
    if (!create.ok) {
      const data = await create.json().catch(() => ({}));
      throw new Error(`Airtable create ${create.status}: ${(data.error && data.error.message) || ""}`);
    }
    const { alertHtml, alertSubject } = buildCareersAlert(b);
    const send = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "TechCare by WilGlobo <tech@wilglobo.com>",
        to: [WILTON],
        subject: alertSubject,
        html: alertHtml,
      }),
    });
    if (!send.ok) throw new Error(`Resend ${send.status}`);
    return res.status(200).json({ ok: true, message: "Thanks! We'll be in touch soon." });
  } catch (e) {
    console.error("careers-apply failed:", e);
    return res.status(500).json({ ok: false, error: "Submission failed." });
  }
};
