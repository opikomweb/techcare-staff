// The careers-application alert builder — the n8n "Build Safe
// Applicant Alert" Code node, verbatim except the input plumbing.
// ADDED to n8n 13 October 2026 in a security audit: every value from
// the public endpoint is HTML-escaped, length-capped, and the subject
// has CR/LF stripped so a stranger cannot inject markup or mail
// headers into Wilton's inbox. Do not simplify this — see the spec
// (n8n-specs/t6ngUmRO1VgVLbm1.md §7).
function buildCareersAlert(b) {
  function esc(s) {
    return String(s === undefined || s === null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function field(v, max) {
    const raw = String(v === undefined || v === null ? "" : v);
    const cut = raw.length > max;
    return esc(raw.slice(0, max)) + (cut ? " <i>[truncated]</i>" : "");
  }
  function subjectSafe(v, max) {
    return String(v === undefined || v === null ? "" : v)
      .replace(/[\r\n]+/g, " ")
      .slice(0, max);
  }

  const rows = [
    ["Name", field(b.full_name, 120)],
    ["Email", field(b.email, 160)],
    ["Phone", field(b.phone, 40)],
    ["Area", field(b.city_area, 120)],
    ["Availability", field(b.availability, 200)],
    ["Hours/week", field(b.hours_per_week, 40)],
    ["Comfort areas", field(b.comfort_areas, 300)],
    ["Has transportation", field(b.has_transportation, 20)],
    ["OK with background check", field(b.ok_background_check, 20)],
  ];

  let html = '<div style="font-family:Arial,sans-serif;font-size:15px">';
  html += "<p>New application from the careers page:</p><ul>";
  for (let i = 0; i < rows.length; i++) {
    html += "<li><b>" + rows[i][0] + ":</b> " + rows[i][1] + "</li>";
  }
  html += "</ul>";
  html += "<p><b>Experience:</b><br>" + field(b.experience, 4000) + "</p>";
  html += "<p><b>Why TechCare:</b><br>" + field(b.why_techcare, 4000) + "</p>";
  html += "<p>Record saved to Worker_Applicants in Airtable.</p>";
  html += '<p style="color:#777;font-size:12px">Every field above was typed by whoever submitted the form. The careers endpoint is public, so treat the contents as unverified until you have spoken to the person. Links and markup have been neutralised before sending.</p>';
  html += "</div>";

  return {
    alertHtml: html,
    alertSubject: "New TechCare worker interest: " + (subjectSafe(b.full_name, 90) || "(no name given)"),
  };
}

module.exports = { buildCareersAlert };
