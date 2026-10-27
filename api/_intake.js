// Client Intake and E-Sign — ported from the n8n workflow of the same
// name (n8n retirement). "Prepare Client" and "Build Signature
// Records" below are the original Code nodes, verbatim except for the
// input source (the parsed form body instead of the n8n form item);
// every mapping, note line, and gate is the original's. Side effects
// mirror the workflow: Clients record (always new — no dedupe, as the
// original), a Draft job, one Acknowledgement per signed document,
// signed copies via api/public/_signedCopy.js (the ported Make Signed
// Copy), and the summary email to Wilton (Resend from tech@, the
// portal's mail rail; the original used Gmail).
// Conscious deviation, empty values only: single-select fields
// (Preferred_Contact, Lead_Source) are omitted from the create when
// empty so Airtable does not grow a blank select option; the original
// wrote whatever the form node produced.
const { makeSignedCopy } = require("./public/_signedCopy");

const BASE_ID = "appBiAKY6ivoImcaQ";
const CLIENTS_TABLE = "tblY473voC9AylgFF";
const JOBS_TABLE = "tblpsypl4j8CChNq1";
const POLICIES_TABLE = "tblUgRM9XLfyGplVR";
const ACK_TABLE = "tbl8a0ZsHRAWsObCi";

function prepareClient(f) {
  const clean = (s) => String(s || "").trim();
  const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  function e164(raw) {
    let d = clean(raw).replace(/[^0-9+]/g, "");
    if (d.startsWith("+")) { d = "+" + d.slice(1).replace(/\+/g, ""); return d.length >= 11 ? d : ""; }
    if (d.length === 10) { return "+1" + d; }
    if (d.length === 11 && d.startsWith("1")) { return "+" + d; }
    return "";
  }
  const name = clean(f.full_name);
  const phone = e164(f.phone);
  const supportPhone = e164(f.support_phone);
  const agreed = {
    "CL-SERVICE": list(f.agree_service).length > 0,
    "CL-PRIVACY": list(f.agree_privacy).length > 0,
    "CL-DEVICE": list(f.agree_device).length > 0,
    "CL-PHOTO": list(f.agree_photo).length > 0,
  };
  const signature = clean(f.signature);
  const sigOk = signature.length >= 3;
  const marketingTick = list(f.marketing).length > 0;
  const services = list(f.services);
  const contactMap = { "Phone call": "Phone", "Email": "Email", "Text message": "Text" };
  const sourceMap = { "A friend or family member": "Referral", "Website": "Website", "Social media": "Social media", "Newspaper or magazine": "Print ad", "I am a returning client": "Returning client", "Other": "Other" };
  const notes = [
    "Intake form " + new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC",
    "Services wanted: " + (services.join(", ") || "(not given)"),
    "What they need help with: " + (clean(f.problem) || "(not given)"),
    "Best days and times: " + (clean(f.availability) || "(not given)"),
    !phone && clean(f.phone) ? "Phone as typed (could not convert to +1 format): " + clean(f.phone) : "",
  ].filter(Boolean).join("\n");
  const codes = sigOk ? Object.keys(agreed).filter((k) => agreed[k]) : [];
  const missing = ["CL-SERVICE", "CL-PRIVACY", "CL-DEVICE"].filter((k) => !codes.includes(k));
  return {
    name, email: clean(f.email).toLowerCase(), phone, phoneTyped: clean(f.phone),
    address: clean(f.address), city: clean(f.city) || "Calgary",
    preferred: contactMap[f.preferred_contact] || "",
    supportPerson: clean(f.support_name), supportContact: supportPhone || clean(f.support_phone),
    accessibility: clean(f.accessibility),
    source: sourceMap[f.heard_from] || "",
    marketing: marketingTick && agreed["CL-PRIVACY"] && sigOk,
    services, notes, signature, onBehalf: clean(f.on_behalf),
    codes, missing, signedAt: new Date().toISOString(),
    jobName: "Intake: " + name + " - " + (services.slice(0, 3).join(", ") || "help request"),
  };
}

function wiltonEmailHtml(p, clientId, jobId) {
  const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const row = (k, v) => '<tr><td style="color:#6b665c;padding:4px 14px 4px 0;vertical-align:top">' + k + "</td><td>" + v + "</td></tr>";
  return '<div style="font-family:Arial,sans-serif;font-size:15px;max-width:640px"><p><b>New client from the TechCare form.</b> Call them within one business day.</p><table>'
    + row("Name", "<b>" + esc(p.name) + "</b>")
    + row("Phone", esc(p.phone || p.phoneTyped))
    + row("Email", esc(p.email))
    + row("Address", esc(p.address) + ", " + esc(p.city))
    + row("Contact by", esc(p.preferred))
    + row("Support person", esc(p.supportPerson) + " " + esc(p.supportContact))
    + row("Needs", esc(p.accessibility))
    + row("Services", esc(p.services.join(", ")))
    + row("Signed", esc(p.codes.join(", ")) || "nothing")
    + (p.missing.length ? row("Still missing", '<b style="color:#c62828">' + esc(p.missing.join(", ")) + "</b>") : "")
    + row("Marketing opt-in", p.marketing ? "Yes" : "No")
    + '</table><pre style="white-space:pre-wrap;background:#f7f5f0;padding:10px">' + esc(p.notes) + "</pre>"
    + '<p><a href="https://airtable.com/appBiAKY6ivoImcaQ/tblY473voC9AylgFF/' + clientId + '">Open client</a> &middot; <a href="https://airtable.com/appBiAKY6ivoImcaQ/tblpsypl4j8CChNq1/' + jobId + '">Open draft job</a></p>'
    + '<p style="color:#6b665c;font-size:13px">Next: confirm the price, set times, assign a worker, add Job_Tasks, then set Status to Dispatched.</p></div>';
}

async function airtable(path, method, body) {
  const key = method === "GET" ? process.env.AIRTABLE_API_KEY : process.env.AIRTABLE_WRITE_KEY || process.env.AIRTABLE_API_KEY;
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Airtable ${method} ${path.split("?")[0]} ${res.status}`);
  return res.json();
}

async function runClientIntake(formBody) {
  const p = prepareClient(formBody);

  // Get Policies (the four CL codes)
  const params = new URLSearchParams();
  params.set("filterByFormula", "OR({Policy_Code}='CL-SERVICE',{Policy_Code}='CL-PRIVACY',{Policy_Code}='CL-DEVICE',{Policy_Code}='CL-PHOTO')");
  params.set("pageSize", "10");
  for (const f of ["Policy_Code", "Version"]) params.append("fields[]", f);
  const polData = await airtable(`${POLICIES_TABLE}?${params}`, "GET");
  const pols = (polData.records || []).map((r) => ({ id: r.id, ...(r.fields || {}) }));

  // Create Client (always new, as the original)
  const clientFields = {
    Client_Name: p.name,
    Client_Type: "Individual / Household",
    Email: p.email,
    Phone: p.phone || p.phoneTyped,
    Service_Address: p.address,
    City: p.city,
    Support_Person: p.supportPerson,
    Support_Person_Contact: p.supportContact,
    Accessibility_Notes: p.accessibility,
    Marketing_Consent: p.marketing,
    Notes: p.notes,
  };
  if (p.preferred) clientFields.Preferred_Contact = p.preferred;
  if (p.source) clientFields.Lead_Source = p.source;
  const client = await airtable(CLIENTS_TABLE, "POST", { fields: clientFields, typecast: true });
  const clientId = client.id;

  // Create Draft Job
  const job = await airtable(JOBS_TABLE, "POST", {
    fields: { Job_Name: p.jobName, Client: [clientId], Status: "Draft", Location: p.address + ", " + p.city },
    typecast: true,
  });

  // Build Signature Records + Record Signatures + Send Signed Copies
  const signedResults = [];
  for (const c of p.codes) {
    const pol = pols.find((x) => x.Policy_Code === c);
    if (!pol || !clientId) continue;
    const summary = c + " v" + (pol.Version || "") + " - " + p.name + " - " + p.signedAt.slice(0, 10);
    const ackFields = {
      Ack_Summary: summary,
      Policy: [pol.id],
      Client: [clientId],
      Version_Signed: pol.Version || "",
      Typed_Signature: p.signature,
      Signed_At: p.signedAt,
      Method: "Web form",
      Signed_On_Behalf: p.onBehalf,
      Notes: "Signed on the TechCare new client form." + (c === "CL-PRIVACY" && p.marketing ? " Opted in to marketing messages (CASL express consent)." : ""),
    };
    const ack = await airtable(ACK_TABLE, "POST", { fields: ackFields, typecast: true });
    const copy = await makeSignedCopy({
      code: c, signerName: p.signature, preparedFor: p.name, email: p.email,
      signedAt: p.signedAt, onBehalf: p.onBehalf,
      method: "Agreement tick box and typed name on the TechCare new client form",
      ackId: ack.id,
    });
    signedResults.push({ code: c, ackId: ack.id, copyOk: copy.ok });
  }

  // Email Wilton New Client
  let wiltonEmailed = false;
  if (process.env.RESEND_API_KEY) {
    const subject = "New TechCare client: " + p.name + " (" + (p.services.slice(0, 2).join(", ") || "help request") + ")";
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "TechCare by WilGlobo Intake <tech@wilglobo.com>",
        to: ["wilton@wilglobo.com"],
        subject,
        html: wiltonEmailHtml(p, clientId, job.id),
      }),
    });
    wiltonEmailed = res.ok;
  }

  return { clientId, jobId: job.id, codes: p.codes, missing: p.missing, signedResults, wiltonEmailed };
}

module.exports = { prepareClient, runClientIntake, _test: { wiltonEmailHtml } };
