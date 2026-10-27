// Worker Onboarding and E-Sign — ported from the n8n workflow of the
// same name (n8n retirement). "Prepare Worker" and "Shape Worker
// Record" are the original Code nodes verbatim except the input
// source (the parsed form body + uploaded-file count instead of the
// n8n form item). Side effects mirror the workflow: Directory record
// (always new — no dedupe, as the original), one Acknowledgement per
// signed document, signed copies via the ported Make Signed Copy, the
// summary email to Wilton, and the uploaded documents emailed to
// Wilton as attachments (they are stored nowhere else — same as the
// original). Wilton emails go via Resend from tech@, the portal rail.
const { makeSignedCopy } = require("./public/_signedCopy");

const BASE_ID = "appBiAKY6ivoImcaQ";
const DIRECTORY_TABLE = "tbllgRxtl2LbCMg2O";
const POLICIES_TABLE = "tblUgRM9XLfyGplVR";
const ACK_TABLE = "tbl8a0ZsHRAWsObCi";
const FROM = "TechCare by WilGlobo Onboarding <tech@wilglobo.com>";

function prepareWorker(f, docCount) {
  const clean = (s) => String(s || "").trim();
  const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  function e164(raw) {
    let d = clean(raw).replace(/[^0-9+]/g, "");
    if (d.startsWith("+")) { d = "+" + d.slice(1).replace(/\+/g, ""); return d.length >= 11 ? d : ""; }
    if (d.length === 10) { return "+1" + d; }
    if (d.length === 11 && d.startsWith("1")) { return "+" + d; }
    return "";
  }
  const date = (v) => { const s = clean(v); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : ""; };
  const name = clean(f.legal_name);
  const trackPick = clean(f.track);
  const track = trackPick.indexOf("independent business") !== -1 ? "Independent contractor" : (trackPick.indexOf("employee") !== -1 ? "Casual employee (payroll)" : "");
  const workerType = track === "Independent contractor" ? "Independent Contractor" : (track ? "Temporary / Seasonal" : "");
  const craQs = ["cra_hours", "cra_method", "cra_tools", "cra_pay", "cra_costs", "cra_only", "cra_decline", "cra_staff", "cra_ongoing"];
  const yes = craQs.filter((k) => clean(f[k]).toLowerCase().startsWith("yes")).length;
  const answered = craQs.filter((k) => clean(f[k])).length;
  const craResult = track === "Independent contractor" && answered === craQs.length ? (yes === 0 ? "Clearly independent" : (yes <= 2 ? "Mixed - review" : "Points to employment")) : "";
  const skillMap = { "Phones and tablets": "Phones & tablets", "Computers and Windows": "Computers & Windows", "Wi-Fi and networks": "Networking & Wi-Fi", "TV setup and audio": "TV & AV", "TV mounting and physical installs": "Mounting & physical install", "Email and online accounts": "Accounts & email", "Buying devices and dealing with providers": "Purchasing & providers", "AI and automation": "AI & automation", "Creative and media": "Creative & media" };
  const skills = list(f.skills).map((s) => skillMap[s]).filter(Boolean);
  const docs = { "WK-CONDUCT": "agree_conduct", "WK-PRIVACY": "agree_privacy", "WK-SAFETY": "agree_safety", "AI-POLICY": "agree_ai" };
  const signature = clean(f.signature);
  const sigOk = signature.length >= 3;
  let codes = sigOk ? Object.keys(docs).filter((k) => list(f[docs[k]]).length > 0) : [];
  if (sigOk && list(f.agree_main).length > 0 && track) { codes.unshift(track === "Independent contractor" ? "WK-AGREEMENT" : "WK-CASUAL"); }
  const craLines = craQs.map((k, i) => (i + 1) + ". " + (clean(f[k]) || "(no answer)"));
  const notes = [
    "Onboarding form " + new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC",
    "Address: " + clean(f.address) + ", " + clean(f.city),
    "Emergency contact: " + clean(f.emergency_name) + " " + (e164(f.emergency_phone) || clean(f.emergency_phone)),
    "Availability: " + (clean(f.availability) || "(not given)"),
    "Own vehicle and licence: " + (clean(f.vehicle) || "(not given)"),
    "Experience: " + (clean(f.experience) || "(not given)"),
    "Track chosen on form: " + (trackPick || "(not given)"),
    track === "Independent contractor" ? "CRA self-check answers (Yes points to employment): " + yes + " of " + craQs.length + " yes\n" + craLines.join("\n") : "",
    "Documents uploaded: " + (docCount > 0 ? docCount + " file(s), emailed to WilGlobo" : "none"),
    !e164(f.phone) && clean(f.phone) ? "Phone as typed: " + clean(f.phone) : "",
  ].filter(Boolean).join("\n");
  return {
    name, email: clean(f.email).toLowerCase(), phone: e164(f.phone) || clean(f.phone),
    business: [clean(f.business_name), clean(f.gst) ? "GST " + clean(f.gst) : ""].filter(Boolean).join(" / "),
    track, workerType, payBasis: track === "Casual employee (payroll)" ? "Hourly" : (track ? "Per task" : ""),
    skills, police: date(f.police_date), insurance: date(f.insurance_expiry), wcb: date(f.wcb_expiry),
    craDate: craResult ? new Date().toISOString().slice(0, 10) : "", craResult, craYes: yes,
    notes, signature, codes, signedAt: new Date().toISOString(),
    needsAgreement: !codes.includes("WK-AGREEMENT") && !codes.includes("WK-CASUAL"),
  };
}

function shapeWorkerRecord(p) {
  const rec = { Full_Name: p.name, Email: p.email, Phone_E164: p.phone, Status: "Onboarding", Notes: p.notes };
  if (p.workerType) { rec.Worker_Type = p.workerType; }
  if (p.payBasis) { rec.Pay_Basis = p.payBasis; }
  if (p.track) { rec.Engagement_Track = p.track; }
  if (p.skills.length) { rec.Skills = p.skills; }
  if (p.police) { rec.Police_Check_Date = p.police; }
  if (p.insurance) { rec.Insurance_Expiry = p.insurance; }
  if (p.wcb) { rec.WCB_Clearance_Expiry = p.wcb; }
  if (p.business) { rec.Business_Name_or_GST = p.business; }
  if (p.craResult) { rec.CRA_Check_Date = p.craDate; rec.CRA_Check_Result = p.craResult; }
  return rec;
}

function wiltonEmailHtml(p, workerId) {
  const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const row = (k, v) => '<tr><td style="color:#6b665c;padding:4px 14px 4px 0;vertical-align:top">' + k + "</td><td>" + v + "</td></tr>";
  return '<div style="font-family:Arial,sans-serif;font-size:15px;max-width:640px"><p><b>New worker onboarding submission.</b> Status is Onboarding. Nothing can be dispatched until Dispatch_Gaps is empty.</p><table>'
    + row("Name", "<b>" + esc(p.name) + "</b>")
    + row("Phone", esc(p.phone))
    + row("Email", esc(p.email))
    + row("Track", esc(p.track || "Not sure: call them and decide"))
    + row("Skills", esc(p.skills.join(", ")))
    + row("Police check", esc(p.police || "missing"))
    + row("Insurance expiry", esc(p.insurance || "missing"))
    + row("WCB clearance", esc(p.wcb || "missing"))
    + (p.craResult ? row("CRA self-check", "<b>" + esc(p.craResult) + "</b> (" + p.craYes + " of 9 yes)") : "")
    + row("Signed", esc(p.codes.join(", ")) || "nothing")
    + (p.needsAgreement ? row("Still to sign", '<b style="color:#c62828">Main agreement (send the signing pack once the track is set)</b>') : "")
    + '</table><pre style="white-space:pre-wrap;background:#f7f5f0;padding:10px">' + esc(p.notes) + "</pre>"
    + '<p><a href="https://airtable.com/appBiAKY6ivoImcaQ/tbllgRxtl2LbCMg2O/' + workerId + '">Open worker in Airtable</a></p>'
    + '<p style="color:#6b665c;font-size:13px">Next: check the uploaded documents (separate email), verify dates, set Status to Active when Dispatch_Gaps is empty. Store police checks in the restricted folder only.</p></div>';
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

async function resend(payload) {
  if (!process.env.RESEND_API_KEY) return { ok: false, reason: "email_not_configured" };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { ok: res.ok };
}

async function runWorkerOnboarding(formBody, files) {
  const p = prepareWorker(formBody, (files || []).length);

  // Get Policies (worker audience)
  const params = new URLSearchParams();
  params.set("filterByFormula", "FIND('Worker', ARRAYJOIN({Audience}))");
  params.set("pageSize", "50");
  for (const f of ["Policy_Code", "Version"]) params.append("fields[]", f);
  const polData = await airtable(`${POLICIES_TABLE}?${params}`, "GET");
  const pols = (polData.records || []).map((r) => ({ id: r.id, ...(r.fields || {}) }));

  // Create Worker (always new, as the original)
  const worker = await airtable(DIRECTORY_TABLE, "POST", { fields: shapeWorkerRecord(p), typecast: true });
  const workerId = worker.id;

  // Email Wilton The Documents (parallel branch in the original)
  let docsEmailed = false;
  if (files && files.length) {
    const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const r = await resend({
      from: FROM,
      to: ["wilton@wilglobo.com"],
      subject: "Worker documents (confidential): " + p.name,
      html: '<p style="font-family:Arial,sans-serif">Documents uploaded by <b>' + esc(p.name) + "</b> on the onboarding form. Check them, record the dates in Airtable, then save police checks in the restricted folder only and delete this email when done (IN-RETENTION).</p>",
      attachments: files.map((fl) => ({
        filename: fl.filename,
        content: fl.data.toString("base64"),
        content_type: fl.contentType || "application/octet-stream",
      })),
    });
    docsEmailed = r.ok;
  }

  // Build Signature Records + Record Signatures + Send Signed Copies
  const signedResults = [];
  for (const c of p.codes) {
    const pol = pols.find((x) => x.Policy_Code === c);
    if (!pol || !workerId) continue;
    const summary = c + " v" + (pol.Version || "") + " - " + p.name + " - " + p.signedAt.slice(0, 10);
    const ack = await airtable(ACK_TABLE, "POST", {
      fields: {
        Ack_Summary: summary,
        Policy: [pol.id],
        Worker: [workerId],
        Version_Signed: pol.Version || "",
        Typed_Signature: p.signature,
        Signed_At: p.signedAt,
        Method: "Web form",
        Notes: "Signed on the TechCare worker onboarding form.",
      },
      typecast: true,
    });
    const copy = await makeSignedCopy({
      code: c, signerName: p.signature, preparedFor: p.name, email: p.email,
      signedAt: p.signedAt, onBehalf: "",
      method: "Agreement tick box and typed name on the TechCare worker onboarding form",
      ackId: ack.id,
    });
    signedResults.push({ code: c, ackId: ack.id, copyOk: copy.ok });
  }

  // Email Wilton New Worker
  const subject = "New worker onboarding: " + p.name + (p.craResult === "Points to employment" ? " (CRA check points to employment)" : "");
  const summary = await resend({ from: FROM, to: ["wilton@wilglobo.com"], subject, html: wiltonEmailHtml(p, workerId) });

  return { workerId, codes: p.codes, needsAgreement: p.needsAgreement, craResult: p.craResult, signedResults, docsEmailed, wiltonEmailed: summary.ok };
}

module.exports = { prepareWorker, shapeWorkerRecord, runWorkerOnboarding, _test: { wiltonEmailHtml } };
