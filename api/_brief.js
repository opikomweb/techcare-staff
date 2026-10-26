// The daily brief builder — a faithful port of the n8n "Daily
// Reminders and Brief" workflow's 'Work Out Reminders' Code node
// (n8n retirement, tranche 4). The body below is the original logic,
// with three plumbing changes only: records arrive via the datasets
// argument instead of n8n's $() node reads, the logo is the portal's
// self-hosted asset instead of the n8n Logo Server, and the dry flag
// comes from opts instead of the Run Now webhook query. Day bucketing
// is America/Edmonton throughout, via the ../_luxon shim.
// buildBrief returns [{ kind, to, subject, html }]; the caller sends.
const { DateTime } = require("./_luxon");

function buildBrief(datasets, opts) {
  const TZ = 'America/Edmonton';
  const F = r => (r && r.fields) ? Object.assign({ id: r.id }, r.fields) : (r || {});
  const all = n => (datasets[n] || []).map(i => F(i)).filter(j => j && j.id);
  const arr = v => Array.isArray(v) ? v.filter(Boolean) : (v ? [v] : []);
  const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const now = DateTime.now().setZone(TZ);
  const today = now.toISODate();
  const dayOf = s => s ? DateTime.fromISO(s).setZone(TZ).toISODate() : '';
  const plus = n => now.plus({ days: n }).toISODate();
  const time = s => s ? DateTime.fromISO(s).setZone(TZ).toFormat('h:mm a') : '';
  const nice = s => s ? DateTime.fromISO(s).setZone(TZ).toFormat("cccc, LLLL d 'at' h:mm a") : '';
  const first = n => String(n || '').trim().split(' ')[0] || 'there';
  const LOGO = '<img src="https://staff.wilglobo.com/assets/techcare-logo.png" alt="TechCare by WilGlobo" height="44" style="height:44px;display:block;border:0">';
  const wrap = inner => '<div style="max-width:620px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#1b2533"><div style="border-bottom:3px solid #0b6fd6;padding:6px 0 10px;margin-bottom:16px">' + LOGO + '</div>' + inner + '<p style="color:#66717d;font-size:13px;border-top:1px solid #d5dde8;padding-top:10px;margin-top:20px">WilGlobo Inc., operating as TechCare by WilGlobo. 105 26 Ave SW, Calgary, Alberta. 403-679-3039. tech@wilglobo.com</p></div>';
  const btn = (url, label) => '<p><a href="' + esc(url) + '" style="display:inline-block;background:#0b6fd6;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:bold">' + label + '</a></p>';
  const AT = 'https://airtable.com/appBiAKY6ivoImcaQ/';

  const jobs = all('Get Jobs');
  const workers = all('Get Workers');
  const clients = all('Get Clients');
  const catalog = all('Get Price List');
  const clientById = {}; clients.forEach(c => { clientById[c.id] = c; });
  const out = [];
  const send = (kind, to, subject, html) => { if (to && String(to).indexOf('@') !== -1) { out.push({ json: { kind, to, subject, html } }); } };

  const live = jobs.filter(j => ['Cancelled'].indexOf(j.Status) === -1);
  const tomorrow = live.filter(j => dayOf(j.Start_Time) === plus(1) && ['Dispatched', 'Accepted'].indexOf(j.Status) !== -1);
  const todays = live.filter(j => dayOf(j.Start_Time) === today && j.Status !== 'Draft');
  const doneYesterday = jobs.filter(j => j.Status === 'Completed' && dayOf(j.Departed_At || j.End_Time) === plus(-1));
  // Digest-only views: unlike the reminder-email lists above, these include Draft jobs so a
  // job scheduled for today or tomorrow is never hidden just because it has not been dispatched yet.
  const digestToday = live.filter(j => dayOf(j.Start_Time) === today);
  const digestTomorrow = live.filter(j => dayOf(j.Start_Time) === plus(1));

  // 1. Worker reminder, day before
  for (const j of tomorrow) {
    const cl = clientById[arr(j.Client)[0]] || {};
    const where = j.Location || arr(j.Client_Address).join(' ');
    for (const em of arr(j.Assigned_Email)) {
      send('worker-reminder', em, 'Reminder: job ' + j.Job_Code + ' tomorrow at ' + time(j.Start_Time),
        wrap('<p>Hello,</p><p>Quick reminder. You have a TechCare job tomorrow.</p><table style="font-size:16px;border-collapse:collapse"><tr><td style="color:#66717d;padding:4px 14px 4px 0">Job</td><td><b>' + esc(j.Job_Code) + '</b> ' + esc(j.Job_Name) + '</td></tr><tr><td style="color:#66717d;padding:4px 14px 4px 0">When</td><td><b>' + esc(nice(j.Start_Time)) + '</b> to ' + esc(time(j.End_Time)) + '</td></tr><tr><td style="color:#66717d;padding:4px 14px 4px 0">Where</td><td>' + esc(where) + '</td></tr><tr><td style="color:#66717d;padding:4px 14px 4px 0">Client</td><td>' + esc(cl.Client_Name || arr(j.Client_Name).join(', ')) + ' ' + esc(arr(j.Client_Phone).join(', ')) + '</td></tr>' + (cl.Accessibility_Notes ? '<tr><td style="color:#66717d;padding:4px 14px 4px 0">Notes</td><td>' + esc(cl.Accessibility_Notes) + '</td></tr>' : '') + '</table>' + (j.Status === 'Dispatched' ? '<p><b>You have not accepted this job yet.</b> Please accept it now or tell us you cannot make it.</p>' : '') + btn(j.Status_Form_URL, 'Open my job link') + '<p>Call the client 30 minutes before you arrive. Tap "Arrived on site" when you get there and "Left the site" when you leave. If we do not hear from you after the planned finish, we will call to check you are safe.</p>'));
    }
  }
  // 2. Client reminder, day before (service message)
  for (const j of tomorrow) {
    const cl = clientById[arr(j.Client)[0]];
    if (!cl || !cl.Email) { continue; }
    const worker = arr(j.Assigned_Email).length ? (workers.find(w => w.Email === arr(j.Assigned_Email)[0]) || {}).Full_Name : '';
    send('client-reminder', cl.Email, 'Your TechCare visit is tomorrow at ' + time(j.Start_Time),
      wrap('<p>Hello ' + esc(first(cl.Client_Name)) + ',</p><p>This is a friendly reminder that your TechCare visit is <b>' + esc(nice(j.Start_Time)) + '</b>' + (worker ? ' with <b>' + esc(first(worker)) + '</b>' : '') + '.</p><p>To help the visit go well:</p><ul><li>Have your devices charged and nearby.</li><li>Know where your passwords are. You will type them yourself. We never ask for them.</li><li>A family member or friend is welcome to join.</li></ul><p>We never ask for card numbers, PINs or cash. All payments go to WilGlobo Inc.</p><p>Need to change the time? Call 403-679-3039 or reply to this email.</p>'));
  }
  // 3. Thank you after a completed visit
  for (const j of doneYesterday) {
    const cl = clientById[arr(j.Client)[0]];
    if (!cl || !cl.Email) { continue; }
    send('client-thanks', cl.Email, 'Thank you from TechCare',
      wrap('<p>Hello ' + esc(first(cl.Client_Name)) + ',</p><p>Thank you for having us yesterday. We hope everything is working well.</p><p>If anything is not working the way it should, reply to this email or call 403-679-3039 and we will make it right.</p><p>How did we do? A one-line reply helps us a lot.</p>'));
  }
  // 4. Worker credential reminders (30 and 7 days before)
  const expiring = [];
  for (const w of workers) {
    if (['Inactive', 'Former', 'Archived'].indexOf(w.Status) !== -1) { continue; }
    const items = [];
    if (w.Police_Check_Date) { items.push(['Vulnerable sector police check', DateTime.fromISO(w.Police_Check_Date).plus({ years: 3 }).toISODate()]); }
    if (w.Insurance_Expiry) { items.push(['Liability insurance', w.Insurance_Expiry]); }
    if (w.WCB_Clearance_Expiry) { items.push(['WCB clearance', w.WCB_Clearance_Expiry]); }
    for (const [label, due] of items) {
      const days = Math.round(DateTime.fromISO(due, { zone: TZ }).diff(now.startOf('day'), 'days').days);
      if (days <= 30) { expiring.push({ name: w.Full_Name, label, due, days, id: w.id }); }
      if (days === 30 || days === 7) {
        send('worker-expiry', w.Email, label + ' expires in ' + days + ' days',
          wrap('<p>Hello ' + esc(first(w.Full_Name)) + ',</p><p>Your <b>' + esc(label) + '</b> on file with WilGlobo expires on <b>' + esc(DateTime.fromISO(due).toFormat('LLLL d, yyyy')) + '</b>.</p><p>Please renew it and email the new copy to tech@wilglobo.com. We cannot send you jobs once it expires.</p>'));
      }
    }
  }
  // 5. One friendly nudge, 3 days after a signing pack went out, if still unsigned
  const unsignedClients = clients.filter(c => String(c.Client_Gaps || '').indexOf('not signed') !== -1);
  const unsignedWorkers = workers.filter(w => String(w.Dispatch_Gaps || '').indexOf('not signed') !== -1);
  for (const p of unsignedClients.concat(unsignedWorkers)) {
    if (dayOf(p.Sign_Pack_Sent_At) !== plus(-3)) { continue; }
    const isClient = !!p.Client_Name;
    send('sign-nudge', p.Email, isClient ? 'A reminder about your TechCare forms' : 'A reminder about your WilGlobo documents',
      wrap('<p>Hello ' + esc(first(p.Client_Name || p.Full_Name)) + ',</p><p>A few ' + (isClient ? 'forms are' : 'documents are') + ' still waiting for your signature. The links are in our email from ' + esc(DateTime.fromISO(p.Sign_Pack_Sent_At).setZone(TZ).toFormat('cccc, LLLL d')) + '.</p><p>Cannot find it, or would like help? Reply to this email or call 403-679-3039 and we will go through them with you.</p>'));
  }
  // 6. Daily digest to Wilton
  const li = (t) => '<li style="margin:3px 0">' + t + '</li>';
  const link = (tbl, id, label) => '<a href="' + AT + tbl + '/' + id + '" style="color:#0a56b0">' + esc(label) + '</a>';
  const statusLabel = s => s === 'Accepted' ? '<b style="color:#1b7f3a">Confirmed by worker</b>' : s === 'Dispatched' ? '<b style="color:#b45309">Sent, not yet confirmed</b>' : s === 'Draft' ? '<b style="color:#c62828">Draft, not dispatched</b>' : s === 'Completed' ? 'Completed' : esc(s || 'No status');
  const sec = (title, rows, empty) => '<h3 style="font-family:Montserrat,Arial,sans-serif;color:#0b1e33;font-size:17px;margin:20px 0 6px;border-bottom:2px solid #e8f2fc;padding-bottom:4px">' + title + ' (' + rows.length + ')</h3>' + (rows.length ? '<ul style="padding-left:20px;margin:0">' + rows.join('') + '</ul>' : '<p style="color:#66717d;margin:0">' + empty + '</p>');
  const J = 'tblpsypl4j8CChNq1';
  const jobLine = j => li(link(J, j.id, (j.Job_Code || '') + ' ' + (j.Job_Name || '')) + ' &middot; ' + esc(time(j.Start_Time)) + ' &middot; ' + statusLabel(j.Status) + ' &middot; ' + esc(arr(j.Assigned_Email).join(', ') || 'no worker'));
  const notSent = live.filter(j => j.Status === 'Dispatched' && !j.GCal_Event_ID);
  const blocked = live.filter(j => ['Dispatched', 'Accepted'].indexOf(j.Status) !== -1 && String(j.Dispatch_Blockers || '').trim());
  const notAccepted = tomorrow.filter(j => j.Status === 'Dispatched');
  const drafts = jobs.filter(j => j.Status === 'Draft');
  const overdue = live.filter(j => j.Arrived_At && !(j.Departed_At && Date.parse(j.Departed_At) >= Date.parse(j.Arrived_At)) && j.End_Time && Date.parse(j.End_Time) < Date.now() - 30 * 60000 && j.Status !== 'Completed');
  const pending = workers.filter(w => w.Status !== 'Active' && ['Inactive', 'Former', 'Archived'].indexOf(w.Status) === -1);
  const mixedCra = workers.filter(w => w.CRA_Check_Result && w.CRA_Check_Result !== 'Clearly independent');
  const noRate = catalog.filter(s => s.Active && !s.Worker_Rate);
  const actions = [];
  if (overdue.length) { actions.push('<b style="color:#c62828">Check on ' + overdue.length + ' worker(s) still on site past finish time.</b>'); }
  if (notSent.length) { actions.push('Click Send_Invite_Link on ' + notSent.length + ' dispatched job(s) with no invite yet.'); }
  if (notAccepted.length) { actions.push(notAccepted.length + ' job(s) tomorrow not accepted yet. Call the worker.'); }
  if (noRate.length) { actions.push('Set Worker_Rate on ' + noRate.length + ' service(s) in the price list before paying anyone.'); }
  const digest = wrap('<p style="font-size:15px;color:#66717d;margin:0 0 6px">' + esc(now.toFormat('cccc, LLLL d')) + '</p><h2 style="font-family:Montserrat,Arial,sans-serif;color:#0b1e33;margin:0 0 10px">TechCare daily brief</h2>' +
    (actions.length ? '<div style="background:#e8f2fc;border-left:4px solid #0b6fd6;padding:12px 14px"><b>Do today</b><ul style="padding-left:20px;margin:6px 0 0">' + actions.map(li).join('') + '</ul></div>' : '<div style="background:#e8f2fc;border-left:4px solid #0b6fd6;padding:12px 14px">Nothing urgent. All clear.</div>') +
    sec('Still on site past finish', overdue.map(jobLine), 'None.') +
    sec('Today', digestToday.map(jobLine), 'No visits today.') +
    sec('Tomorrow', digestTomorrow.map(jobLine), 'No visits tomorrow.') +
    sec('Dispatched but no invite sent', notSent.map(jobLine), 'None.') +
    sec('Blocked by missing paperwork', blocked.map(j => li(link(J, j.id, j.Job_Code + ' ' + j.Job_Name) + ': ' + esc(j.Dispatch_Blockers))), 'None.') +
    sec('Draft jobs (all, any date)', drafts.map(jobLine), 'None.') +
    sec('Clients with unsigned forms', unsignedClients.map(c => li(link('tblY473voC9AylgFF', c.id, c.Client_Name) + (c.Sign_Pack_Sent_At ? ' &middot; pack sent ' + esc(dayOf(c.Sign_Pack_Sent_At)) : ' &middot; <b>no pack sent</b>'))), 'None.') +
    sec('Workers with unsigned documents', unsignedWorkers.map(w => li(link('tbllgRxtl2LbCMg2O', w.id, w.Full_Name) + (w.Sign_Pack_Sent_At ? ' &middot; pack sent ' + esc(dayOf(w.Sign_Pack_Sent_At)) : ' &middot; <b>no pack sent</b>'))), 'None.') +
    sec('Workers not yet active', pending.map(w => li(link('tbllgRxtl2LbCMg2O', w.id, w.Full_Name) + ' &middot; ' + esc(w.Status || 'no status') + (w.Dispatch_Gaps ? ' &middot; ' + esc(String(w.Dispatch_Gaps).replace(/\n/g, ' ')) : ''))), 'None.') +
    sec('Worker checks expiring within 30 days', expiring.map(e => li(link('tbllgRxtl2LbCMg2O', e.id, e.name) + ': ' + esc(e.label) + ' ' + (e.days < 0 ? '<b style="color:#c62828">expired ' + esc(e.due) + '</b>' : 'on ' + esc(e.due) + ' (' + e.days + ' days)'))), 'None.') +
    sec('CRA self-check needs review', mixedCra.map(w => li(link('tbllgRxtl2LbCMg2O', w.id, w.Full_Name) + ': ' + esc(w.CRA_Check_Result))), 'None.') +
    sec('Reminders sent automatically this morning', out.map(o => li(esc(o.json.kind) + ' to ' + esc(o.json.to) + ': ' + esc(o.json.subject))), 'None.'));
  out.push({ json: { kind: 'digest', to: 'wilglobo.int@gmail.com', subject: (actions.length ? 'TechCare brief: ' + actions.length + ' to do' : 'TechCare brief: all clear') + ' (' + now.toFormat('LLL d') + ')', html: digest } });
  let dry = false;
  dry = !!opts.dry;
  if (dry) { return out.filter(o => o.json.kind === 'digest').map(o => Object.assign({}, o.json, { subject: '[TEST] ' + o.json.subject })); }
  return out.map(o => o.json);
}

module.exports = { buildBrief };
