// GET  /sign?doc=<Policy_Code>&who=<record id>&kind=<client|worker>&c=<Sign_Code>
// POST /api/public/sign
//
// The single-document signing form — a faithful port of the retired
// n8n "Signature Form" (n8n retirement, tranche 3). Typed name + the
// agreement tick is the signature; the bearer link (record id +
// Sign_Code) is the authority. Validation failures are silently thanked
// (the signer never learns which check failed) and reported to Wilton
// as possible link probes. Valid signatures write an Acknowledgement,
// tick CASL marketing consent when it applies, email Wilton the record,
// and trigger the signed-copy email (fire-and-forget semantics kept:
// a signed-copy failure never fails the signing).
const { pageShell, sendHtml, esc } = require("./_pageShell");
const { makeSignedCopy } = require("./_signedCopy");

const BASE_ID = "appBiAKY6ivoImcaQ";
const CLIENTS_TABLE = "tblY473voC9AylgFF";
const DIRECTORY_TABLE = "tbllgRxtl2LbCMg2O";
const POLICIES_TABLE = "tblUgRM9XLfyGplVR";
const ACK_TABLE = "tbl8a0ZsHRAWsObCi";
const WILTON = "wilton@wilglobo.com";
const FROM = "TechCare by WilGlobo Records <tech@wilglobo.com>";
const CONFIRMATION = "Thank you. Your signature is recorded with today's date and the document version. You can ask us for a copy at any time: 403-679-3039 or tech@wilglobo.com.";
const METHOD = "Typed name and agreement tick box on the TechCare secure web form";

const cleanHeader = (s, n) => String(s ?? "").replace(/[\r\n]+/g, " ").slice(0, n);

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [to], subject, html }),
    });
    const data = await res.json().catch(() => ({}));
    return res.ok ? { sent: true, id: data.id } : { sent: false, error: data.message || res.status };
  } catch (e) {
    return { sent: false, error: String(e) };
  }
}

async function airtable(method, path, key, body) {
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data && data.error && data.error.message) || `Airtable ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function findPolicy(doc, key) {
  const formula = encodeURIComponent(`{Policy_Code}='${doc.replace(/'/g, "")}'`);
  const data = await airtable("GET", `/${POLICIES_TABLE}?pageSize=1&filterByFormula=${formula}`, key);
  return (data.records || [])[0] || null;
}

function formPage({ doc, who, kind, c }) {
  const q = (v) => esc(v || "");
  const body = `
<h1>Sign your document</h1>
<p class="sub">Please read the document we sent you first, or have someone read it with you. Typing your name below is your signature. Questions? Call 403-679-3039 or email tech@wilglobo.com.</p>
<form id="f" method="post">
  <label for="signature">Your full name (this is your signature)</label>
  <input type="text" id="signature" name="signature" required autocomplete="name">
  <label style="font-weight:normal"><input type="checkbox" id="agree" name="agree" required style="width:auto"> I have read this document, or had it read to me, and I agree to it.</label>
  <label for="on_behalf">Signing for someone else? Put their name, your relationship, and your authority (e.g. power of attorney)</label>
  <input type="text" id="on_behalf" name="on_behalf">
  <label style="font-weight:normal"><input type="checkbox" id="marketing" name="marketing" style="width:auto"> Optional, for the Privacy form only: you may send me offers and updates by email or text. I can stop these at any time.</label>
  <button class="submit" type="submit">Sign</button>
  <p id="msg" style="margin-top:10px"></p>
</form>
<script>
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = { doc: ${JSON.stringify(doc)}, who: ${JSON.stringify(who)}, kind: ${JSON.stringify(kind)}, c: ${JSON.stringify(c)},
    signature: fd.get('signature') || '', agree: !!fd.get('agree'), on_behalf: fd.get('on_behalf') || '', marketing: !!fd.get('marketing') };
  const msg = document.getElementById('msg');
  msg.textContent = 'Recording…';
  try {
    const res = await fetch('/api/public/sign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const html = await res.text();
    document.open(); document.write(html); document.close();
  } catch (err) {
    msg.textContent = 'Could not record. Check your connection and try again, or call 403-679-3039.';
  }
});
</script>`;
  return pageShell({ title: "Sign your document | TechCare by WilGlobo", body });
}

function confirmationPage() {
  return pageShell({
    title: "Thank you | TechCare by WilGlobo",
    body: `<h1>Thank you</h1><div class="empty">${esc(CONFIRMATION)}</div>`,
  });
}

async function handleSubmission(req, res) {
  const b = req.body || {};
  const docRaw = String(b.doc || "");
  const doc = docRaw.replace(/[^A-Z0-9-]/gi, "");
  const who = String(b.who || "").trim();
  const kind = b.kind === "worker" ? "worker" : "client";
  const given = String(b.c || "").trim().toLowerCase();
  const signature = String(b.signature || "").trim();
  const agree = !!b.agree;
  const onBehalf = String(b.on_behalf || "").trim();
  const marketingRaw = !!b.marketing;
  const readKey = process.env.AIRTABLE_API_KEY;
  const writeKey = process.env.AIRTABLE_WRITE_KEY || process.env.AIRTABLE_API_KEY;

  const problems = [];
  let policy = null;
  let person = null;
  if (readKey) {
    policy = doc ? await findPolicy(doc, readKey).catch(() => null) : null;
    if (!policy) problems.push(`Document code not found: ${doc}`);
    const table = kind === "worker" ? DIRECTORY_TABLE : CLIENTS_TABLE;
    if (who.startsWith("rec")) {
      person = await airtable("GET", `/${table}/${who}`, readKey).catch(() => null);
    }
    if (!person || person.id !== who) problems.push(`Signer record not found: ${who}`);
  } else {
    problems.push("Signing is not connected yet.");
  }

  const pf = (person && person.fields) || {};
  const personName = kind === "worker" ? pf.Full_Name || "" : pf.Client_Name || "";
  const onFile = String(pf.Sign_Code || "").trim().toLowerCase();
  const codeOk = onFile.length >= 32 && given === onFile;
  if (person && !codeOk) {
    problems.push(given ? "Signing code does not match this person (old or altered link)" : "Link has no signing code (old link from before 13 Oct, or altered)");
  }
  if (signature.length < 3) problems.push("Typed name too short");
  if (!agree) problems.push("Agreement box not ticked");

  const code = policy ? (policy.fields || {}).Policy_Code || doc : doc;
  const version = policy ? (policy.fields || {}).Version || "" : "";
  const docName = policy ? (policy.fields || {}).Policy_Name || "" : "";
  const marketing = marketingRaw && code === "CL-PRIVACY" && kind === "client";
  const ok = problems.length === 0;

  if (!ok) {
    await sendEmail({
      to: WILTON,
      subject: `Signature NOT recorded: ${cleanHeader(code, 80)} from ${cleanHeader(signature, 80)}`,
      html: `<div style="font-family:Arial,sans-serif;font-size:15px"><p>Someone submitted the signing form but it could not be recorded:</p><p><b>${esc(problems.join("; "))}</b></p><p>Typed name: ${esc(signature)}<br>Kind: ${esc(kind)}<br>Record: ${esc(who)}</p><p style="background:#fff4e5;padding:10px">The form is public and unauthenticated by design — read an unexpected one of these emails as a possible probe of a signing link.</p><p>To send a genuine signer a fresh link, tick Send_Sign_Pack on their Airtable record.</p></div>`,
    }).catch(() => {});
    return sendHtml(res, confirmationPage());
  }

  const signedAt = new Date().toISOString();
  const summary = `${code} v${version} - ${personName || signature} - ${signedAt.slice(0, 10)}`;
  const ackFields = {
    Ack_Summary: summary,
    Policy: [policy.id],
    Version_Signed: version,
    Typed_Signature: signature,
    Signed_At: signedAt,
    Method: "Web form",
    Signed_On_Behalf: onBehalf,
    Notes: marketing ? "Opted in to marketing messages (CASL express consent) on this form." : "",
  };
  if (kind === "client") ackFields.Client = [who]; else ackFields.Worker = [who];
  const ack = await airtable("POST", `/${ACK_TABLE}`, writeKey, { records: [{ fields: ackFields }], typecast: true });
  const ackId = ack.records && ack.records[0] && ack.records[0].id;

  if (marketing) {
    await airtable("PATCH", `/${CLIENTS_TABLE}/${who}`, writeKey, { fields: { Marketing_Consent: true }, typecast: true }).catch(() => {});
  }

  await sendEmail({
    to: WILTON,
    subject: `Signed: ${cleanHeader(code, 60)} by ${cleanHeader(signature, 60)}`,
    html: `<div style="font-family:Arial,sans-serif;font-size:15px"><table style="border-collapse:collapse"><tr><td style="color:#66717d;padding:4px 14px 4px 0">Document</td><td>${esc(docName)} (${esc(code)} v${esc(version)})</td></tr><tr><td style="color:#66717d;padding:4px 14px 4px 0">Typed name</td><td>${esc(signature)}</td></tr><tr><td style="color:#66717d;padding:4px 14px 4px 0">On record as</td><td>${esc(personName)}</td></tr><tr><td style="color:#66717d;padding:4px 14px 4px 0">Who</td><td>${esc(kind)} ${esc(who)}</td></tr><tr><td style="color:#66717d;padding:4px 14px 4px 0">Signed on behalf</td><td>${esc(onBehalf || "no")}</td></tr><tr><td style="color:#66717d;padding:4px 14px 4px 0">Marketing consent</td><td>${marketing ? "YES, ticked on this form" : "no"}</td></tr><tr><td style="color:#66717d;padding:4px 14px 4px 0">Signed at</td><td>${esc(signedAt)}</td></tr><tr><td style="color:#66717d;padding:4px 14px 4px 0">Acknowledgement</td><td>${esc(ackId || "")}</td></tr></table><p style="color:#66717d;font-size:13px">The link carried this person's Sign_Code. Clearing Sign_Code on their record cancels all of their outstanding links.</p></div>`,
  }).catch(() => {});

  // Fire-and-forget in spirit: a signed-copy failure must not fail the
  // signing. We await it inside a catch-all only so the function does
  // not get frozen mid-send by the platform.
  try {
    await makeSignedCopy({
      code,
      signerName: signature,
      preparedFor: personName || signature,
      email: pf.Email || "",
      signedAt,
      onBehalf,
      method: METHOD,
      ackId,
    });
  } catch (e) {
    console.error("sign: signed copy failed:", e);
  }

  return sendHtml(res, confirmationPage());
}

module.exports = async (req, res) => {
  try {
    if (req.method === "GET") {
      return sendHtml(res, formPage({
        doc: String(req.query?.doc || ""),
        who: String(req.query?.who || ""),
        kind: String(req.query?.kind || ""),
        c: String(req.query?.c || ""),
      }));
    }
    if (req.method === "POST") return await handleSubmission(req, res);
    return res.status(405).json({ error: "Method not allowed." });
  } catch (e) {
    console.error("sign failed:", e);
    return sendHtml(res, confirmationPage());
  }
};
