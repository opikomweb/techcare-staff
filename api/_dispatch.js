// Dispatch sync — the portal's own replacement for the n8n workflow
// "WilGlobo Ops Core - Dispatch and Calendar Invites" (retired 2026-10-26,
// n8n retirement tranche 2).
//
// Behavior is a faithful port of that workflow's "Plan Calendar Actions"
// logic, verified against its exported definition:
//   - A job needs an invite when its Airtable formula field
//     Calendar_Signature differs from Synced_Signature (the signature
//     covers start/end epochs, assigned emails, location, job name).
//   - Draft jobs are skipped. Cancelled jobs with a live invite get a
//     CANCEL .ics and Synced_Signature='CANCELLED'.
//   - A first dispatch is blocked when Dispatch_Blockers is non-empty
//     (the Airtable compliance formula) or when worker email / start /
//     end is missing: Sync_Error is written to the job and Wilton is
//     emailed. (Improvement over n8n: the blocked email is sent once per
//     distinct blocker set, not on every poll.)
//   - Sends go from tech@wilglobo.com with an invite.ics attached
//     (method REQUEST, or CANCEL for cancellations), organizer
//     tech@wilglobo.com, one-hour-before VALARM, UID wgb-<recordId>@
//     techcares.ca (stable across updates, so calendars replace rather
//     than duplicate).
//   - Double bookings (same worker email overlapping another live job)
//     still send, but flag Conflict_Flag on the job and email Wilton.
//   - After a successful send the job is stamped: GCal_Event_ID,
//     Synced_Signature, Last_Synced_At, Conflict_Flag (and Job_Key when
//     one had to be minted for the update-form link).
//
// The worker-facing update-form link in the email still points at the
// n8n form until tranche 3 moves that form into the portal.
const crypto = require("crypto");

const BASE_ID = "appBiAKY6ivoImcaQ";
const JOBS_TABLE = "tblpsypl4j8CChNq1";
const ORG_EMAIL = "tech@wilglobo.com";
const FROM = "TechCare by WilGlobo Dispatch <tech@wilglobo.com>";
const WILTON = "wilton@wilglobo.com";
const LOGO_URL = "https://staff.wilglobo.com/assets/techcare-logo.png";
const FORM_BASE = "https://wilglobo.app.n8n.cloud/form/ops-job-update";
const TZ = "America/Edmonton";

const JOB_FIELDS = [
  "Job_Name", "Job_Code", "Status", "Assigned_To", "Assigned_Email",
  "Start_Time", "End_Time", "Location", "Brief_Google_Doc_URL",
  "GCal_Event_ID", "Calendar_Signature", "Synced_Signature",
  "Dispatch_Blockers", "Client_Name", "Client_Phone", "Client_Address",
  "Job_Key", "Sync_Error",
];

// ---------- formatting helpers (ported) ----------
function nice(s) {
  if (!s) return "";
  const d = new Date(s);
  if (isNaN(d)) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, weekday: "long", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).formatToParts(d);
  const get = (t) => (parts.find((p) => p.type === t) || {}).value || "";
  return `${get("weekday")}, ${get("month")} ${get("day")} at ${get("hour")}:${get("minute")} ${get("dayPeriod")}`;
}
function niceShort(d) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
  }).formatToParts(d);
  const get = (t) => (parts.find((p) => p.type === t) || {}).value || "";
  return `${get("month")} ${get("day")} ${get("hour")}:${get("minute")} ${get("dayPeriod")}`;
}
function icsTime(s) {
  const d = new Date(s);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}
const escI = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function fold(line) {
  const out = [];
  let l = line;
  while (l.length > 73) { out.push(l.slice(0, 73)); l = " " + l.slice(73); }
  out.push(l);
  return out.join("\r\n");
}
function newKey() {
  return crypto.randomBytes(16).toString("hex");
}
const arr = (v) => (Array.isArray(v) ? v.filter(Boolean) : v ? [v] : []);

function buildIcs(p, method) {
  const L = [
    "BEGIN:VCALENDAR", "PRODID:-//WilGlobo Inc//TechCare Dispatch//EN", "VERSION:2.0", "CALSCALE:GREGORIAN", "METHOD:" + method,
    "BEGIN:VEVENT",
    "UID:" + p.uid,
    "SEQUENCE:" + p.seq,
    "DTSTAMP:" + icsTime(new Date().toISOString()),
    "DTSTART:" + icsTime(p.start),
    "DTEND:" + icsTime(p.end),
    "SUMMARY:" + escI(p.summary),
    "LOCATION:" + escI(p.location),
    "DESCRIPTION:" + escI(p.description),
    "ORGANIZER;CN=TechCare by WilGlobo Dispatch:mailto:" + ORG_EMAIL,
  ];
  for (const em of p.emails) L.push("ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:" + em);
  L.push("STATUS:" + (method === "CANCEL" ? "CANCELLED" : "CONFIRMED"));
  if (method !== "CANCEL") L.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + escI(p.summary), "TRIGGER:-PT60M", "END:VALARM");
  L.push("END:VEVENT", "END:VCALENDAR");
  return L.map(fold).join("\r\n") + "\r\n";
}

function wrap(inner) {
  return '<div style="max-width:620px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#1b2533">' +
    '<div style="border-bottom:3px solid #0b6fd6;padding:6px 0 10px;margin-bottom:14px"><img src="' + LOGO_URL + '" alt="TechCare by WilGlobo" height="44" style="height:44px;display:block;border:0"></div>' +
    inner +
    '<p style="color:#66717d;font-size:13px;border-top:1px solid #d5dde8;padding-top:10px;margin-top:18px">WilGlobo Inc., operating as TechCare by WilGlobo. Never take client passwords, PINs, cards or cash. No selling in the home. Safety or questions: 403-679-3039. Emergency: 911.</p></div>';
}
function table(p) {
  const row = (k, v) => '<tr><td style="color:#66717d;padding:4px 14px 4px 0;vertical-align:top">' + k + "</td><td>" + v + "</td></tr>";
  return '<table style="font-size:16px;border-collapse:collapse">' +
    row("Job", "<b>" + esc(p.code) + "</b> " + esc(p.name)) +
    row("When", "<b>" + esc(p.startNice) + "</b> to " + esc(p.endNice)) +
    row("Where", esc(p.location)) +
    (p.client ? row("Client", esc(p.client) + (p.phone ? " (" + esc(p.phone) + ")" : "")) : "") +
    "</table>";
}
const button = (url, label) => '<p><a href="' + esc(url) + '" style="display:inline-block;background:#0b6fd6;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:bold">' + label + "</a></p>";

// ---------- planner (pure; ported decision logic) ----------
// job: Airtable fields object. liveJobs: array of {id, fields} for the
// double-booking check. Returns an array of action objects.
function planJob(id, f, liveJobs) {
  const out = [];
  const notes = [];
  const status = f.Status || "";
  const sig = f.Calendar_Signature || "";
  const synced = f.Synced_Signature || "";
  const eventId = f.GCal_Event_ID || "";
  const blockers = String(f.Dispatch_Blockers || "").trim();
  const emails = arr(f.Assigned_Email);
  const code = f.Job_Code || "";
  const name = f.Job_Name || "(untitled job)";
  const client = arr(f.Client_Name).join(", ");
  const phone = arr(f.Client_Phone).join(", ");
  const addr = arr(f.Client_Address).join(" ");
  const location = f.Location || addr;
  const existingKey = String(f.Job_Key || "").trim().toLowerCase();
  const jobKeyValid = /^[a-f0-9]{32}$/.test(existingKey);
  const jobKey = jobKeyValid ? existingKey : newKey();
  const formUrl = FORM_BASE + "?job=" + id + "&c=" + jobKey;
  const brief = f["Brief URL"] || f.Brief_Google_Doc_URL || "";
  const uid = eventId || "wgb-" + id + "@techcares.ca";
  const seq = Math.floor(Date.now() / 1000) - 1790000000;
  const base = {
    recordId: id, code, name, status, uid, seq, emails,
    attendeesCsv: emails.join(","), start: f.Start_Time || "", end: f.End_Time || "",
    startNice: nice(f.Start_Time), endNice: nice(f.End_Time),
    location, client, phone, formUrl, brief, jobKey, jobKeyMinted: !jobKeyValid,
  };

  if (status === "Draft") { notes.push(code + " is still Draft. Set Status to Dispatched first."); return { actions: out, notes }; }

  if (status === "Cancelled") {
    if (eventId && synced !== "CANCELLED" && emails.length && base.start && base.end) {
      const p = Object.assign({ action: "send", kind: "cancel", summary: "[" + code + "] " + name + " (CANCELLED)", description: "This TechCare job has been cancelled. You do not need to attend.", newSignature: "CANCELLED", conflictFlag: false, conflictNote: "" }, base);
      p.subject = "Cancelled: job " + code + " on " + base.startNice;
      p.emailHtml = wrap("<p><b>This job is cancelled.</b> You do not need to go. The calendar entry will be removed.</p>" + table(p) + "<p>Questions? Call 403-679-3039.</p>");
      p.ics = buildIcs(p, "CANCEL");
      out.push(p);
    }
    return { actions: out, notes };
  }

  if (sig && sig === synced) { notes.push(code + " is already up to date. The worker has the latest invite."); return { actions: out, notes }; }

  if (!eventId) {
    if (status !== "Dispatched") { notes.push(code + " has status " + status + " and no invite yet. Set Status to Dispatched to send one."); return { actions: out, notes }; }
    if (blockers) { out.push(Object.assign({ action: "block", blockers }, base)); return { actions: out, notes }; }
  }

  if (!emails.length || !base.start || !base.end) {
    out.push(Object.assign({ action: "block", blockers: "Worker email, start time or end time is missing." }, base));
    return { actions: out, notes };
  }

  const conflicts = [];
  const s1 = Date.parse(f.Start_Time), e1 = Date.parse(f.End_Time);
  for (const o of liveJobs || []) {
    if (o.id === id) continue;
    const of = o.fields || {};
    const oe = arr(of.Assigned_Email);
    const s2 = Date.parse(of.Start_Time), e2 = Date.parse(of.End_Time);
    if (!(s1 < e2 && s2 < e1)) continue;
    for (const em of emails) {
      if (oe.indexOf(em) !== -1) {
        conflicts.push(em + " is also on " + (of.Job_Code || o.id) + " " + (of.Job_Name || "") + " (" + nice(of.Start_Time) + " to " + nice(of.End_Time) + ")");
      }
    }
  }
  const conflictNote = conflicts.join("\n");
  const summary = "[" + code + "] " + name;
  const description = "TechCare by WilGlobo job " + code + "\n" +
    (client ? "Client: " + client + (phone ? "  |  Phone: " + phone : "") + "\n" : "") +
    (location ? "Where: " + location + "\n" : "") +
    (brief ? "Brief: " + brief + "\n" : "") +
    "\nUpdate this job (accept, arrived, left, done, running late, problem, incident):\n" + formUrl + "\n" +
    "\nCheck in when you arrive and when you leave. No client passwords, no client payments, no selling in the home. Questions or safety: 403-679-3039. Emergency: 911.";
  const isNew = !eventId;
  const p = Object.assign({ action: "send", kind: isNew ? "new" : "changed", summary, description, conflictNote, conflictFlag: conflicts.length > 0, newSignature: sig }, base);
  if (isNew) {
    p.subject = "New job " + code + ": " + base.startNice;
    p.emailHtml = wrap("<p>You have a new TechCare job. The calendar invite is attached. Tap <b>Yes</b> or <b>Add to calendar</b> to put it on your phone.</p>" + table(p) + (brief ? '<p><a href="' + esc(brief) + '">Read the job brief</a></p>' : "") + button(formUrl, "Accept this job") + "<p>Use the same button to check in when you arrive, check out when you leave, say you are running late, and report anything that goes wrong.</p>" + '<p style="font-size:14px;color:#66717d">Call the client 30 minutes before you arrive.</p>');
  } else {
    p.subject = "Job changed " + code + ": now " + base.startNice;
    p.emailHtml = wrap("<p><b>This job has changed.</b> The updated calendar invite is attached and replaces the old one.</p>" + table(p) + button(formUrl, "Open job update link") + '<p>If you cannot make the new time, choose "Problem or blocked" on the link and say so.</p>');
  }
  p.ics = buildIcs(p, "REQUEST");
  out.push(p);
  if (conflicts.length) out.push(Object.assign({}, p, { action: "conflict", ics: "" }));
  return { actions: out, notes };
}

// ---------- Airtable + Resend IO ----------
async function airtable(method, path, key, body) {
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data && data.error && data.error.message) || `Airtable ${path} ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function listJobsByFormula(formula, fields, key) {
  const params = new URLSearchParams();
  params.set("pageSize", "100");
  params.set("filterByFormula", formula);
  for (const f of fields) params.append("fields[]", f);
  let records = [];
  let offset;
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${JOBS_TABLE}`);
    url.search = params.toString();
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Airtable list ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    records = records.concat(data.records || []);
    offset = data.offset;
  } while (offset);
  return records;
}

async function sendEmail({ to, subject, html, ics, method }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false, reason: "email_not_configured" };
  const payload = { from: FROM, to: Array.isArray(to) ? to : [to], subject, html };
  if (ics) {
    payload.attachments = [{
      filename: "invite.ics",
      content: Buffer.from(ics, "utf8").toString("base64"),
      content_type: `text/calendar; charset=UTF-8; method=${method || "REQUEST"}`,
    }];
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { sent: false, reason: "email_send_failed", error: data.message || res.status };
    return { sent: true, id: data.id };
  } catch (e) {
    return { sent: false, reason: "email_send_failed", error: String(e) };
  }
}

// Runs the sync. With jobId: just that job. Without: every job whose
// signature is out of sync (the sweep the Vercel cron runs each minute).
// dryRun returns the plan without sending or writing anything.
async function runDispatchSync({ jobId, dryRun } = {}) {
  const readKey = process.env.AIRTABLE_API_KEY;
  const writeKey = process.env.AIRTABLE_WRITE_KEY || process.env.AIRTABLE_API_KEY;
  if (!readKey) throw new Error("AIRTABLE_API_KEY is not set.");

  const liveJobs = await listJobsByFormula(
    "AND({Status}!='Draft',{Status}!='Cancelled',{Status}!='Completed',{End_Time}!='',IS_AFTER({End_Time},DATEADD(NOW(),-1,'days')))",
    ["Job_Code", "Job_Name", "Assigned_Email", "Start_Time", "End_Time", "Status"],
    readKey
  );

  let changed;
  if (jobId) {
    const rec = await airtable("GET", `/${JOBS_TABLE}/${jobId}`, readKey).catch(() => null);
    if (!rec) return { processed: 0, results: [], notes: ["Job not found."] };
    // Re-read with the full field set (the record GET returns all fields).
    changed = [rec];
  } else {
    changed = await listJobsByFormula(
      "AND({Synced_Signature}!={Calendar_Signature},{Status}!='Completed')",
      JOB_FIELDS,
      readKey
    );
    // Cancelled jobs whose stamp already reads CANCELLED are done; the
    // planner skips them, but don't even fetch noise beyond 2 days old.
    changed = changed.filter((r) => {
      const end = Date.parse((r.fields || {}).End_Time || "");
      return isNaN(end) || end > Date.now() - 2 * 24 * 3600 * 1000;
    });
  }

  const results = [];
  for (const rec of changed) {
    const f = rec.fields || {};
    const { actions, notes } = planJob(rec.id, f, liveJobs);
    const entry = { job: f.Job_Code || rec.id, actions: actions.map((a) => a.action + (a.kind ? ":" + a.kind : "")), notes };
    if (!dryRun) {
      for (const a of actions) {
        if (a.action === "send") {
          const sent = await sendEmail({ to: a.emails, subject: a.subject, html: a.emailHtml, ics: a.ics, method: a.kind === "cancel" ? "CANCEL" : "REQUEST" });
          entry.sendResult = sent;
          if (sent.sent) {
            const stamp = {
              GCal_Event_ID: a.uid,
              Synced_Signature: a.newSignature,
              Last_Synced_At: new Date().toISOString(),
              Conflict_Flag: !!a.conflictFlag,
            };
            if (a.jobKeyMinted) stamp.Job_Key = a.jobKey;
            await airtable("PATCH", `/${JOBS_TABLE}/${rec.id}`, writeKey, { fields: stamp, typecast: true });
            entry.stamped = true;
          }
        } else if (a.action === "block") {
          const stamp = `NOT SENT ${niceShort(new Date())}. Fix these, then set Status to Draft and back to Dispatched:\n${a.blockers}`;
          const already = String(f.Sync_Error || "");
          entry.blocked = true;
          if (!already.includes(a.blockers)) {
            await airtable("PATCH", `/${JOBS_TABLE}/${rec.id}`, writeKey, { fields: { Sync_Error: stamp }, typecast: true });
            await sendEmail({
              to: WILTON,
              subject: `Dispatch blocked: ${a.code} ${a.name}`,
              html: `<div style="font-family:Arial,sans-serif;font-size:15px"><p>No invite was sent for <b>${esc(a.code)} ${esc(a.name)}</b>. The job is set to Dispatched but these are missing:</p><pre style="white-space:pre-wrap;background:#fff4e5;padding:12px">${esc(a.blockers)}</pre><p>Fix them in Airtable, then set the job back to Draft and to Dispatched again.</p></div>`,
            });
            entry.blockEmailSent = true;
          }
        } else if (a.action === "conflict") {
          await sendEmail({
            to: WILTON,
            subject: `Double booking on ${a.code} ${a.name}`,
            html: `<div style="font-family:Arial,sans-serif;font-size:15px"><p>The invite went out, but the same person is booked on another job at the same time:</p><pre style="white-space:pre-wrap;background:#fff4e5;padding:12px">${esc(a.conflictNote)}</pre><p>Move one of the jobs or reassign it. <a href="https://airtable.com/${BASE_ID}/${JOBS_TABLE}/${rec.id}">Open the job in Airtable</a></p></div>`,
          });
          entry.conflictEmailSent = true;
        }
      }
    }
    results.push(entry);
  }
  return { processed: changed.length, results };
}

module.exports = { runDispatchSync, planJob, buildIcs, _test: { nice, icsTime, fold } };
