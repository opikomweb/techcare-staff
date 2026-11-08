// GET/POST /review-approve?t=<signed token> — the owner's one-tap
// approval page for Review Engine drafts (core logic:
// api/_reviewEngine.js). The token is HMAC-signed + expiring and
// names exactly one item (a review reply or a weekly Google post).
//
//   GET  → shows the review (or post draft), the drafted reply in
//          an editable box, and Approve / Skip buttons. Viewing
//          changes nothing.
//   POST → approve (with the edited text, if changed) or skip.
//          Approve on an API-connected profile posts the reply;
//          otherwise the item is marked approved and the engine
//          texts the owner the final text to paste themselves.
//          This page is the ONLY path that can post anything —
//          drafts wait here (or in the internal API) until a human
//          taps.
const engine = require("../_reviewEngine");

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function page(title, inner) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} — Review Engine</title>
<style>body{font-family:-apple-system,'Segoe UI',Arial,sans-serif;background:#f5f6f8;color:#0b1e33;margin:0;padding:24px 16px}.card{max-width:520px;margin:0 auto;background:#fff;border-radius:14px;padding:22px;box-shadow:0 2px 14px rgba(11,30,51,.08)}h1{font-size:19px;margin:0 0 4px}.sub{color:#66717d;font-size:13px;margin:0 0 16px}.stars{color:#f5a623;font-size:18px;letter-spacing:2px}.review{background:#f5f6f8;border-radius:10px;padding:12px 14px;font-size:14px;margin:12px 0;white-space:pre-wrap}label{font-size:13px;font-weight:600;display:block;margin:14px 0 6px}textarea{width:100%;box-sizing:border-box;border:1px solid #ccd3da;border-radius:10px;padding:10px;font:inherit;font-size:14px;min-height:110px}button{border:0;border-radius:10px;padding:12px 18px;font:inherit;font-weight:600;cursor:pointer}.go{background:#0b6fd6;color:#fff;width:100%}.skip{background:none;color:#66717d;width:100%;margin-top:6px}.note{font-size:12px;color:#66717d;margin-top:14px;line-height:1.5}.ok{font-size:15px;line-height:1.55}</style></head>
<body><div class="card">${inner}</div></body></html>`;
}

function parseForm(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return Object.fromEntries(new URLSearchParams(req.body));
  return {};
}

async function loadItem(payload) {
  if (payload.kind === "review") {
    const review = await engine.getReview(payload.key);
    return review ? { kind: "review", review, config: await engine.getConfigByKey(review.client_key) } : null;
  }
  if (payload.kind === "post") {
    const post = await engine.getPost(payload.key);
    return post ? { kind: "post", post, config: await engine.getConfigByKey(post.client_key) } : null;
  }
  return null;
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const token = (req.query && req.query.t) || parseForm(req).t || "";
  const payload = engine.verifyToken(String(token));
  if (!payload) {
    return res.status(401).send(page("Link expired", `<h1>This approval link has expired</h1><p class="ok">Approval links last 14 days. The draft is still saved — open the portal's Review Engine list, or ask WilGlobo to send a fresh link. Nothing was posted.</p>`));
  }
  const item = await loadItem(payload);
  if (!item) {
    return res.status(404).send(page("Not found", `<h1>That draft is gone</h1><p class="ok">We couldn't find the item this link points to. Nothing was posted.</p>`));
  }
  const { config } = item;
  const business = (config && config.business_name) || "your business";
  const connected = item.kind === "review"
    ? (item.review.source === "gbp_api" && engine.gbpConnected(config))
    : engine.gbpConnected(config);
  const doneStatus = item.kind === "review" ? item.review.status : item.post.status;

  if (req.method === "POST") {
    const form = parseForm(req);
    const decision = String(form.decision || "");
    try {
      if (decision === "dismiss") {
        if (item.kind === "review") await engine.dismissReview(item.review.review_key);
        else await engine.dismissPost(item.post.post_key);
        return res.status(200).send(page("Skipped", `<h1>Skipped</h1><p class="ok">No problem — nothing was posted, and the draft is marked skipped for ${esc(business)}.</p>`));
      }
      if (decision === "approve") {
        let out;
        if (item.kind === "review") out = await engine.approveReview(item.review.review_key, { reply_text: String(form.text || "") });
        else out = await engine.approvePost(item.post.post_key, { body: String(form.text || "") });
        if (!out.ok) return res.status(400).send(page("Something's off", `<h1>That didn't go through</h1><p class="ok">${esc(out.error || "approval_failed")} — nothing was posted. Try the portal, or ask WilGlobo to take a look.</p>`));
        const msg = out.posted
          ? `Posted. Your ${item.kind === "review" ? "reply is live under the review" : "post is live on your Google profile"} for ${esc(business)}.`
          : `Approved. We've just texted you the final ${item.kind === "review" ? "reply" : "post"} — paste it ${item.kind === "review" ? "under the review on Google" : "into your Google Business Profile posts"} when you get a moment. (Your profile isn't API-connected yet, so this last step is manual for now.)`;
        return res.status(200).send(page("Approved", `<h1>Approved ✓</h1><p class="ok">${msg}</p>`));
      }
      return res.status(400).send(page("Missing choice", `<h1>Missing choice</h1><p class="ok">Use the Approve or Skip button on the form.</p>`));
    } catch (e) {
      console.error("review-approve POST failed:", e && e.message ? e.message : e);
      return res.status(500).send(page("Error", `<h1>Something went wrong</h1><p class="ok">Nothing was posted. The draft is still saved — please try again in a bit.</p>`));
    }
  }

  if (req.method !== "GET") return res.status(405).send(page("Method not allowed", `<h1>Method not allowed</h1>`));

  if (["posted", "approved", "dismissed"].includes(doneStatus)) {
    return res.status(200).send(page("Already handled", `<h1>Already handled</h1><p class="ok">This draft for ${esc(business)} is marked <b>${esc(doneStatus)}</b> — nothing more to do here.</p>`));
  }

  let inner = "";
  if (item.kind === "review") {
    const r = item.review;
    inner = `<h1>Review reply — ${esc(business)}</h1>
<p class="sub">A new review came in. Your reply is drafted below — edit it if you like, then approve. Nothing posts without this tap.</p>
<div class="stars">${esc(engine.starsOf(r.rating))}</div>
<div class="review"><b>${esc(r.reviewer_name)}</b>\n${esc(r.text || "(no written review)")}</div>
<form method="POST">
<input type="hidden" name="t" value="${esc(String(token))}">
<label for="text">Your reply</label>
<textarea id="text" name="text" maxlength="1400">${esc(r.final_reply || r.draft_reply)}</textarea>
<button class="go" type="submit" name="decision" value="approve">${connected ? "Approve & post reply" : "Approve reply"}</button>
<button class="skip" type="submit" name="decision" value="dismiss">Skip — don't reply</button>
</form>
<p class="note">${connected ? "Your Google profile is API-connected: approving posts this reply under the review right away." : "Your profile isn't API-connected yet: approving texts you the final reply so you can paste it under the review — 20 seconds on your phone."} Draft source: ${esc(r.draft_source || "template")}.</p>`;
  } else {
    const p = item.post;
    inner = `<h1>Weekly Google post — ${esc(business)}</h1>
<p class="sub">One post a week keeps the profile alive. Edit if you like, then approve. Nothing posts without this tap.</p>
<form method="POST">
<input type="hidden" name="t" value="${esc(String(token))}">
<label for="text">Post text (${esc(p.kind.replace(/_/g, " "))}, week of ${esc(p.week_of)})</label>
<textarea id="text" name="text" maxlength="1500">${esc(p.body)}</textarea>
<label>Suggested photo</label>
<div class="review">${esc(p.image_suggestion || "A real photo of the team or a recent job.")}</div>
<button class="go" type="submit" name="decision" value="approve">${connected ? "Approve & publish post" : "Approve post"}</button>
<button class="skip" type="submit" name="decision" value="dismiss">Skip this week</button>
</form>
<p class="note">${connected ? "Your Google profile is API-connected: approving publishes the post (add the photo from your profile if you'd like one attached)." : "Your profile isn't API-connected yet: approving texts you the final post + photo idea to paste into your Google Business Profile."} Draft source: ${esc(p.source || "template")}.</p>`;
  }
  return res.status(200).send(page(item.kind === "review" ? "Approve review reply" : "Approve Google post", inner));
};
