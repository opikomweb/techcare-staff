// GET/POST /api/cron/dispatch-sync — runs the dispatch sync (see
// api/_dispatch.js). Invoked every minute by Vercel Cron (vercel.json),
// replacing the retired n8n workflow's one-minute Airtable poll.
//
// Auth: when the CRON_SECRET env var is set, Vercel Cron's
// "Authorization: Bearer <CRON_SECRET>" header is required. A signed-in
// core-staff session is also accepted (manual "sync now"). Until
// CRON_SECRET is set the endpoint relies on the sync being idempotent —
// it only ever sends what the signature check says is owed, so repeat
// calls send nothing.
//
// Query options: ?job=recXXXX syncs one job; ?dryRun=1 plans without
// sending or writing; ?format=html returns the human result page (the
// shape the old Airtable "send invite" link showed).
const { runDispatchSync } = require("../_dispatch");
const { requireCoreStaff } = require("../admin/_requireCoreStaff");

function esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function resultPage(summary) {
  const lines = [];
  for (const r of summary.results || []) {
    for (const a of r.actions || []) {
      if (a.startsWith("send")) lines.push(`Invite ${a.includes("cancel") ? "cancellation " : ""}processed for <b>${esc(r.job)}</b>.`);
      else if (a === "block") lines.push(`<b style="color:#c62828">Not sent.</b> ${esc(r.job)} is blocked — see the job's Sync Error in Airtable.`);
      else if (a === "conflict") lines.push(`<b style="color:#b45309">Double booking warning</b> on ${esc(r.job)} — Wilton has been emailed.`);
    }
    for (const n of r.notes || []) lines.push(esc(n));
  }
  if (!lines.length) lines.push("Nothing to send.");
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TechCare dispatch</title></head><body style="margin:0;background:#eef3f9;font-family:Arial,sans-serif;color:#1b2533"><div style="max-width:560px;margin:40px auto;background:#fff;padding:28px;border-radius:10px;border-top:5px solid #0b6fd6"><img src="https://staff.wilglobo.com/assets/techcare-logo.png" alt="TechCare by WilGlobo" style="height:44px;display:block"><h2 style="font-family:Montserrat,Arial,sans-serif;color:#0b1e33">Dispatch</h2>' +
    lines.map((l) => '<p style="font-size:16px;line-height:1.5">' + l + "</p>").join("") +
    '<p style="color:#66717d;font-size:13px">You can close this tab.</p></div></body></html>';
}

module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }
  try {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.authorization || "";
    let authorized = false;
    if (secret && auth === `Bearer ${secret}`) authorized = true;
    if (!authorized) {
      const gate = await requireCoreStaff(req).catch(() => ({ error: "no session" }));
      if (!gate.error) authorized = true;
    }
    if (!authorized && secret) {
      return res.status(401).json({ error: "Unauthorized." });
    }
    if (!authorized && !secret) {
      console.warn("dispatch-sync: CRON_SECRET not set — running unauthenticated (sync is idempotent).");
    }

    const jobId = typeof req.query?.job === "string" && req.query.job.startsWith("rec") ? req.query.job : undefined;
    const dryRun = req.query?.dryRun === "1" || req.query?.dryRun === "true";
    const summary = await runDispatchSync({ jobId, dryRun });

    if (req.query?.format === "html") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(resultPage(summary));
    }
    return res.status(200).json({ ok: true, dryRun: !!dryRun, ...summary });
  } catch (e) {
    console.error("dispatch-sync failed:", e);
    return res.status(500).json({ error: "Dispatch sync failed." });
  }
};
