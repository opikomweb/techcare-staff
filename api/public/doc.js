// GET /doc?code=<Policy_Code>&who=<record id>&kind=<client|worker>&c=<Sign_Code>
// The public document reading page — a faithful port of the retired n8n
// "Document Reader (public)" workflow (n8n retirement, tranche 3).
// Templates come from api/public/_templates.json (migrated from the
// n8n Data Table). Placeholder rules preserved: %%LABEL%% stripped,
// %%LOGO%% becomes the logo, the presence of %%SIGNED_BY%% marks the
// document signable, every other %%TOKEN%% renders as a blank on the
// read page. The sign hand-off now points at the portal's /sign page.
const templates = require("./_templates.json");

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const HOSTED_LOGO = '<img src="https://staff.wilglobo.com/assets/techcare-logo.png" alt="TechCare by WilGlobo" style="height:44px;display:block;border:0">';

function sendHtml(res, status, html) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  return res.status(status).send(html);
}

function shell({ title, bar, body, footer }) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} | TechCare by WilGlobo</title><link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700&family=Source+Sans+3:wght@400;600;700&display=swap" rel="stylesheet"><style>body{margin:0;background:#eef3f9;font-family:'Source Sans 3',Arial,sans-serif;color:#1b2533}.bar{position:sticky;top:0;background:#0b1e33;color:#fff;padding:12px 16px;display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}.bar a.btn,.bar button{background:#0b6fd6;color:#fff;border:0;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:bold;cursor:pointer;font-size:15px}.paper{max-width:780px;margin:22px auto;background:#fff;padding:28px;border-radius:10px;box-shadow:0 1px 4px rgba(11,30,51,.12)}.footer{max-width:780px;margin:0 auto 30px;padding:0 6px;color:#44536a;font-size:15px}.footer a.btn{display:inline-block;background:#0b6fd6;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:bold;margin-top:8px}@media print{.bar,.footer{display:none}.paper{box-shadow:none;margin:0}}</style></head><body>${bar}<div class="paper">${body}</div><div class="footer">${footer}</div></body></html>`;
}

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });
  const q = req.query || {};
  const code = String(q.code || "").toUpperCase().replace(/[^A-Z0-9-]/g, "");
  const who = String(q.who || "").replace(/[^A-Za-z0-9]/g, "");
  const kind = q.kind === "worker" || q.kind === "client" ? q.kind : "";
  const c = String(q.c || "").toLowerCase().replace(/[^a-f0-9]/g, "").slice(0, 64);

  const t = code && code !== "LOGO" ? templates[code] : null;
  if (!t) {
    const html = shell({
      title: "Document not found",
      bar: `<div class="bar"><span>TechCare by WilGlobo document</span><button onclick="window.print()">Print</button></div>`,
      body: `<h1 style="font-family:Montserrat,Arial,sans-serif;color:#0b1e33">We could not find that document</h1><p>The link may be incomplete. Please call 403-679-3039 or email tech@wilglobo.com and we will send it again.</p>`,
      footer: `Questions? Call 403-679-3039 or email tech@wilglobo.com. Printed and large-print copies are available.`,
    });
    return sendHtml(res, 404, html);
  }

  const signable = String(t.html).includes("%%SIGNED_BY%%");
  let bodyHtml = String(t.html).split("%%LABEL%%").join("");
  bodyHtml = bodyHtml.split("%%LOGO%%").join(HOSTED_LOGO);
  bodyHtml = bodyHtml.replace(/%%[A-Z_]+%%/g, "&nbsp;");

  let signUrl = "";
  if (signable && who && kind) {
    signUrl = `https://staff.wilglobo.com/sign?doc=${encodeURIComponent(code)}&who=${encodeURIComponent(who)}&kind=${encodeURIComponent(kind)}` + (c ? `&c=${encodeURIComponent(c)}` : "");
  }

  const bar = signUrl
    ? `<div class="bar"><span>Please read this document. When you are ready, sign it online.</span><span><a class="btn" href="${esc(signUrl)}">Sign this document</a> <button onclick="window.print()">Print</button></span></div>`
    : `<div class="bar"><span>TechCare by WilGlobo document. Version ${esc(t.version)}.</span><button onclick="window.print()">Print</button></div>`;
  const footer = signUrl
    ? `Have you read it all, or had it read to you?<br><a class="btn" href="${esc(signUrl)}">Yes, take me to sign</a><p>Questions first? Call 403-679-3039. We are happy to go through it with you.</p>`
    : `Questions? Call 403-679-3039 or email tech@wilglobo.com. Printed and large-print copies are available.`;

  return sendHtml(res, 200, shell({ title: t.title || code, bar, body: bodyHtml, footer }));
};
