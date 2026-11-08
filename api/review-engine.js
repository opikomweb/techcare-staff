// Review Engine + GBP Care — internal API (core logic:
// api/_reviewEngine.js). Internal only: every route requires the
// portal's x-techcare-key header (TECHCARE_SMS_KEY — the same
// internal key as /api/shield-admin and the /api/retell-outbound
// DNC read).
//
//   GET  /api/review-engine?configs=1
//          → all client configs (latest snapshot per client)
//   GET  /api/review-engine?asks=<client_key>
//          → review asks for the client (newest first)
//   GET  /api/review-engine?reviews=<client_key>
//          → recorded reviews with draft/final replies + status
//   GET  /api/review-engine?posts=<client_key>
//          → weekly GBP post drafts with status
//   GET  /api/review-engine?report=<client_key>&month=YYYY-MM
//          → the monthly one-page report (markdown) for that month
//   POST /api/review-engine { action: "upsert_config", config }
//   POST /api/review-engine { action: "job_completed", client_key,
//          job_ref, customer_name, customer_mobile }
//          → the post-job review ask (idempotent per job)
//   POST /api/review-engine { action: "new_review", client_key,
//          reviewer_name, rating, text, posted_at? }
//          → manual review entry (the no-API watcher fallback):
//            records it, drafts the reply, texts the owner the
//            one-tap approve link. Nothing posts.
//   POST /api/review-engine { action: "approve_review", review_key,
//          reply_text? } / { action: "dismiss_review", review_key }
//   POST /api/review-engine { action: "approve_post", post_key,
//          body? } / { action: "dismiss_post", post_key }
//   POST /api/review-engine { action: "generate_report",
//          client_key, month, email_owner? }
//   POST /api/review-engine { action: "record_optout",
//          client_key, mobile } / { action: "run_sweep", dry_run? }
const engine = require("./_reviewEngine");

function authorized(req) {
  const expected = process.env.TECHCARE_SMS_KEY;
  const provided = req.headers["x-techcare-key"] || "";
  return Boolean(expected) && provided === expected;
}

module.exports = async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ ok: false, error: "unauthorized" });

  if (req.method === "GET") {
    const q = req.query || {};
    try {
      if (q.configs) return res.status(200).json({ ok: true, configs: await engine.listConfigs() });
      if (q.asks) return res.status(200).json({ ok: true, asks: await engine.listAsks(String(q.asks), 200) });
      if (q.reviews) return res.status(200).json({ ok: true, reviews: await engine.listReviews(String(q.reviews), 200) });
      if (q.posts) return res.status(200).json({ ok: true, posts: await engine.listPosts(String(q.posts), 100) });
      if (q.report) {
        const month = String(q.month || new Date().toISOString().slice(0, 7));
        const rep = await engine.generateMonthlyReport(String(q.report), month, {});
        if (!rep.ok) return res.status(400).json({ ok: false, error: rep.error });
        return res.status(200).json({ ok: true, month: rep.month, counts: rep.counts, markdown: rep.markdown });
      }
      return res.status(400).json({ ok: false, error: "specify configs=1, asks=<client_key>, reviews=<client_key>, posts=<client_key>, or report=<client_key>&month=YYYY-MM" });
    } catch (e) {
      console.error("review-engine GET failed:", e && e.message ? e.message : e);
      return res.status(500).json({ ok: false, error: "review_engine_failed" });
    }
  }

  if (req.method === "POST") {
    const body = req.body || {};
    try {
      switch (body.action) {
        case "upsert_config": {
          const out = await engine.upsertConfig(body.config || {});
          if (!out.ok) return res.status(400).json({ ok: false, error: out.error || "config_save_failed" });
          return res.status(200).json({ ok: true, config: out.config, stored: out.stored });
        }
        case "job_completed": {
          const out = await engine.handleJobCompleted(body, {});
          return res.status(200).json({ ok: true, ...out });
        }
        case "new_review": {
          const out = await engine.recordReview({ ...body, source: "manual" }, {});
          if (out.skipped) return res.status(400).json({ ok: false, error: out.skipped });
          return res.status(200).json({ ok: true, ...out, review: undefined });
        }
        case "approve_review": {
          const out = await engine.approveReview(String(body.review_key || ""), { reply_text: body.reply_text });
          if (!out.ok) return res.status(400).json({ ok: false, error: out.error });
          return res.status(200).json({ ok: true, posted: !!out.posted, review: out.review });
        }
        case "dismiss_review": {
          const out = await engine.dismissReview(String(body.review_key || ""));
          if (!out.ok) return res.status(400).json({ ok: false, error: out.error });
          return res.status(200).json({ ok: true, review: out.review });
        }
        case "approve_post": {
          const out = await engine.approvePost(String(body.post_key || ""), { body: body.body });
          if (!out.ok) return res.status(400).json({ ok: false, error: out.error });
          return res.status(200).json({ ok: true, posted: !!out.posted, post: out.post });
        }
        case "dismiss_post": {
          const out = await engine.dismissPost(String(body.post_key || ""));
          if (!out.ok) return res.status(400).json({ ok: false, error: out.error });
          return res.status(200).json({ ok: true, post: out.post });
        }
        case "generate_report": {
          const out = await engine.generateMonthlyReport(String(body.client_key || ""), String(body.month || ""), { emailOwner: !!body.email_owner });
          if (!out.ok) return res.status(400).json({ ok: false, error: out.error });
          return res.status(200).json({ ok: true, month: out.month, counts: out.counts, markdown: out.markdown, email: out.email });
        }
        case "record_optout": {
          const { workerPhoneE164 } = require("./_sms");
          const mobile = workerPhoneE164(body.mobile) || "";
          if (!mobile) return res.status(400).json({ ok: false, error: "mobile must be a North American number" });
          const out = await engine.recordOptOut(String(body.client_key || ""), mobile, {});
          return res.status(200).json({ ok: true, ...out });
        }
        case "run_sweep": {
          const out = await engine.runSweep({ dryRun: !!body.dry_run });
          return res.status(200).json({ ok: true, ...out });
        }
        default:
          return res.status(400).json({ ok: false, error: "unknown action" });
      }
    } catch (e) {
      console.error("review-engine POST failed:", e && e.message ? e.message : e);
      return res.status(500).json({ ok: false, error: "review_engine_failed" });
    }
  }

  return res.status(405).json({ ok: false, error: "Method not allowed." });
};
