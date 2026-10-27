// Pure field-shaping helpers for api/admin/ops.js — dependency-free
// so they can be unit-tested without the staff-auth chain. The
// whitelists live here too: the Operations tab may only ever write
// these fields.
const STATUSES = ["Draft", "Dispatched", "Accepted", "In Progress", "Completed", "Issues/Blocked", "Cancelled"];
const WORKER_STATUSES = ["Active", "Onboarding", "Inactive"];
const CONTACT_PREFS = ["Phone", "Text", "Email"];

const isRec = (v) => typeof v === "string" && /^rec[A-Za-z0-9]{14}$/.test(v);
const str = (v) => String(v == null ? "" : v).trim();

function pickFields(body, allowed) {
  const out = {};
  for (const k of allowed) {
    if (body[k] !== undefined) out[k] = body[k];
  }
  return out;
}

function shapeJobFields(input) {
  const f = {};
  if (input.Job_Name !== undefined) f.Job_Name = str(input.Job_Name);
  if (input.Location !== undefined) f.Location = str(input.Location);
  if (input.Status !== undefined) {
    if (!STATUSES.includes(input.Status)) throw new Error("Unknown job status.");
    f.Status = input.Status;
  }
  if (input.Start_Time !== undefined) f.Start_Time = input.Start_Time ? new Date(input.Start_Time).toISOString() : null;
  if (input.End_Time !== undefined) f.End_Time = input.End_Time ? new Date(input.End_Time).toISOString() : null;
  if (input.Assigned_To !== undefined) {
    f.Assigned_To = Array.isArray(input.Assigned_To) ? input.Assigned_To.filter(isRec) : [];
  }
  if (input.Open_For_Claim !== undefined) f.Open_For_Claim = !!input.Open_For_Claim;
  return f;
}

function shapeClientFields(input) {
  const f = {};
  for (const k of ["Client_Name", "Phone", "Email", "Service_Address", "City", "Support_Person", "Support_Person_Contact", "Accessibility_Notes", "Notes"]) {
    if (input[k] !== undefined) f[k] = str(input[k]);
  }
  if (input.Preferred_Contact !== undefined) {
    f.Preferred_Contact = CONTACT_PREFS.includes(input.Preferred_Contact) ? input.Preferred_Contact : "";
  }
  if (input.Marketing_Consent !== undefined) f.Marketing_Consent = !!input.Marketing_Consent;
  return f;
}

function shapeWorkerFields(input) {
  const f = {};
  for (const k of ["Full_Name", "Email", "Phone_E164", "Worker_Type", "Pay_Basis", "Engagement_Track", "Role", "Business_Name_or_GST", "Notes", "Police_Check_Date", "Insurance_Expiry", "WCB_Clearance_Expiry"]) {
    if (input[k] !== undefined) f[k] = str(input[k]);
  }
  if (input.Status !== undefined) {
    if (!WORKER_STATUSES.includes(input.Status)) throw new Error("Unknown worker status.");
    f.Status = input.Status;
  }
  if (input.Default_Hourly_Rate !== undefined) {
    const n = Number(input.Default_Hourly_Rate);
    f.Default_Hourly_Rate = Number.isFinite(n) ? n : 0;
  }
  if (input.Skills !== undefined) {
    f.Skills = Array.isArray(input.Skills) ? input.Skills.map(str).filter(Boolean)
      : str(input.Skills).split(",").map((s) => s.trim()).filter(Boolean);
  }
  return f;
}

module.exports = { STATUSES, WORKER_STATUSES, CONTACT_PREFS, isRec, str, pickFields, shapeJobFields, shapeClientFields, shapeWorkerFields };
