// Shared shell for the portal's public worker/client pages (the ones
// that used to be served by n8n webhooks): same look as the n8n pages —
// logo header, centered column, safety footer — but self-hosted so the
// pages survive the n8n retirement.
const LOGO_URL = "https://staff.wilglobo.com/assets/techcare-logo.png";

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

function pageShell({ title, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<style>
  body { margin:0; background:#eef3f9; font-family: Arial, Helvetica, sans-serif; color:#1b2533; }
  .wrap { max-width:560px; margin:0 auto; padding:20px 16px 40px; }
  .logo { height:44px; display:block; margin:8px 0 18px; }
  h1 { font-size:22px; margin:0 0 4px; color:#0b1e33; }
  .sub { color:#66717d; margin:0 0 18px; font-size:15px; }
  .card { background:#fff; border:1px solid #d5dde8; border-radius:10px; padding:16px; margin:0 0 14px; }
  .card.done { opacity:.65; }
  .card.blocked { border-color:#e0a3a3; box-shadow: inset 3px 0 0 #c62828; }
  .time { font-size:17px; font-weight:bold; }
  .pill { display:inline-block; font-size:12px; font-weight:bold; padding:3px 9px; border-radius:999px; background:#eef3f9; color:#33506e; margin-left:8px; vertical-align:2px; }
  .pill.amber { background:#fff4e5; color:#8a5a00; }
  .pill.red { background:#fdecec; color:#a11; }
  .meta { color:#44536a; font-size:15px; line-height:1.55; margin-top:6px; }
  .chips { margin-top:10px; display:flex; gap:8px; flex-wrap:wrap; }
  .chip { display:inline-block; padding:9px 14px; border:1px solid #b9c9dd; border-radius:999px; color:#0b6fd6; text-decoration:none; font-size:14px; font-weight:bold; background:#fff; }
  .bigbtn { display:block; text-align:center; background:#0b6fd6; color:#fff; text-decoration:none; padding:14px; border-radius:8px; font-weight:bold; font-size:16px; margin-top:12px; }
  .brief { display:inline-block; margin-top:10px; color:#0b6fd6; font-size:14px; }
  .empty { background:#fff; border:1px dashed #b9c9dd; border-radius:10px; padding:18px; color:#44536a; font-size:15px; }
  h2.day { font-size:16px; color:#0b1e33; margin:20px 0 8px; }
  .footer { color:#66717d; font-size:13px; border-top:1px solid #d5dde8; padding-top:12px; margin-top:22px; }
  label { display:block; font-weight:bold; font-size:14px; margin:14px 0 6px; }
  select, input[type=text], textarea { width:100%; box-sizing:border-box; padding:12px; border:1px solid #b9c9dd; border-radius:8px; font-size:16px; font-family:inherit; }
  textarea { min-height:80px; }
  button.submit { width:100%; background:#0b6fd6; color:#fff; border:0; padding:15px; border-radius:8px; font-weight:bold; font-size:16px; margin-top:18px; cursor:pointer; }
</style>
</head>
<body>
<div class="wrap">
<img class="logo" src="${LOGO_URL}" alt="TechCare by WilGlobo">
${body}
<p class="footer">Questions or safety: 403-679-3039. Emergency: 911.</p>
</div>
</body>
</html>`;
}

function sendHtml(res, html) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  return res.status(200).send(html);
}

module.exports = { pageShell, sendHtml, esc, LOGO_URL };
