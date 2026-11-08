// Review Engine — reply/post drafting (used by api/_reviewEngine.js).
//
// Two layers, same contract ({ draft, source }):
//   1. AI — only when REVIEW_AI_API_KEY is set in the portal env.
//      OpenAI-compatible chat completions: REVIEW_AI_BASE_URL
//      (default https://api.openai.com/v1), REVIEW_AI_MODEL
//      (default gpt-4o-mini). Any failure (no key, timeout, HTTP
//      error, empty answer) falls through to layer 2 — drafting
//      NEVER blocks on the model and never throws.
//   2. Deterministic templates — the house rules, in code:
//      grateful and specific for happy reviews; for unhappy reviews
//      the calm take-it-offline template: thank them, own it without
//      arguing the facts, invite a direct call to the owner. Never
//      defensive, never an excuse list, never a request to change
//      or remove the review (Google policy), never an incentive.
//
// Nothing in this module sends or posts anything. A draft is only
// ever a suggestion until the owner approves it (see _reviewEngine).

const str = (v) => (v === undefined || v === null ? "" : String(v).trim());

function aiConfigured() {
  return Boolean(process.env.REVIEW_AI_API_KEY);
}

async function callAi(system, user, opts = {}) {
  const key = process.env.REVIEW_AI_API_KEY;
  if (!key) return null;
  const base = (process.env.REVIEW_AI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.REVIEW_AI_MODEL || "gpt-4o-mini";
  const fetchImpl = opts.fetchImpl || fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs || 10000);
  try {
    const res = await fetchImpl(`${base}/chat/completions`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.5,
        max_tokens: 300,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    const text = str(data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content);
    return text || null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function firstNameOf(name) {
  return str(name).split(/\s+/)[0] || "there";
}

// A detail we can honestly echo back: a service word from the
// client's own service list that literally appears in the review
// text. Nothing is invented — no match, no echo.
function serviceEcho(text, services) {
  const t = ` ${String(text || "").toLowerCase()} `;
  for (const s of services || []) {
    const w = str(s).toLowerCase();
    if (w && w.length >= 4 && t.includes(w)) return str(s);
  }
  return "";
}

function templateReviewReply({ business_name, reviewer_name, rating, text, owner_name, owner_mobile, services }) {
  const first = firstNameOf(reviewer_name);
  const business = str(business_name) || "us";
  const owner = str(owner_name) || "the owner";
  const echo = serviceEcho(text, services);
  const r = Number(rating) || 0;
  if (r >= 4) {
    const detail = echo ? ` Glad the ${echo} went well.` : "";
    return `Hi ${first} — thank you for the kind words and for choosing ${business}.${detail} We really appreciate you taking the time to share this. — ${owner}, ${business}`;
  }
  if (r === 3) {
    return `Hi ${first} — thanks for the honest feedback and for giving ${business} a try. We'd love the chance to make your next visit a five-star one${owner_mobile ? ` — call me directly at ${owner_mobile} and I'll look after it personally` : ""}. — ${owner}, ${business}`;
  }
  // 1–2 stars (or unrated): calm, take it offline. No arguing, no
  // excuses, no disputing their account in public.
  return `Hi ${first} — thank you for telling us. I'm sorry your experience with ${business} fell short of what you should expect, and I'd like to hear more so we can make it right. Please call me directly${owner_mobile ? ` at ${owner_mobile}` : ""} and we'll sort it out together. — ${owner}, ${business}`;
}

async function draftReviewReply(input, opts = {}) {
  const fallback = templateReviewReply(input);
  if (!aiConfigured()) return { draft: fallback, source: "template" };
  const system =
    "You write Google review replies for a local business. Voice: grateful, specific, human, never defensive. " +
    "For 4-5 star reviews: thank them warmly and echo one real detail from their review. " +
    "For 1-2 star reviews: thank them, apologise plainly without arguing facts or making excuses, and invite them to call the owner directly at the number provided. " +
    "Never ask anyone to change or remove a review. Never offer incentives. Keep it under 90 words. Sign off with the owner's name and business name as provided. Output only the reply text.";
  const user =
    `Business: ${input.business_name}\nOwner: ${input.owner_name || "the owner"}${input.owner_mobile ? ` (direct phone ${input.owner_mobile})` : ""}\n` +
    `Reviewer: ${input.reviewer_name}\nRating: ${input.rating} of 5\nReview: ${String(input.text || "").slice(0, 800)}`;
  const ai = await callAi(system, user, opts);
  if (ai) return { draft: ai, source: "ai" };
  return { draft: fallback, source: "template" };
}

// ---------- weekly Google Business Profile post drafts ----------
// Kinds mirror the Content Engine's rotating feed patterns:
// service spotlight, seasonal, and review highlight (first name and
// a short quote from a PUBLIC review, only when the client config
// allows highlights).
const SEASONAL_LINES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const SEASONAL_ANGLES = {
  0: "New year, same reliable call — if the holidays exposed a problem at home, January is the month to get ahead of it.",
  1: "Deep-winter is when small problems turn into emergencies. A quick check now beats a big repair later.",
  2: "Spring is around the corner — the best time to get on the schedule before the busy season hits.",
  3: "Spring cleanup season is here. Book early and beat the rush.",
  4: "Longer days, fuller schedules — May is when our calendar fills fastest. Thanks for keeping us busy.",
  5: "Summer project season is in full swing. If it's been on your list since spring, now's the time.",
  6: "Mid-summer check-in: we're grateful for every neighbour who has trusted us with their home this year.",
  7: "August is for finishing the jobs you meant to do in June. We're here when you're ready.",
  8: "Fall is coming — a little preparation now saves a lot of stress when the cold arrives.",
  9: "The first cold snap is furnace season in Alberta. If yours hasn't been looked at in a while, October is the month.",
  10: "Winter is on the doorstep. Emergency or planned, November is when being on a local crew's list matters most.",
  11: "Thank you for an incredible year. From our family to yours — happy holidays, and we're here if the season throws you a curveball.",
};

function templateGbpPost({ kind, business_name, city, service, review }) {
  const business = str(business_name) || "We";
  const where = str(city) ? ` in ${str(city)}` : "";
  if (kind === "review_highlight" && review) {
    const first = firstNameOf(review.reviewer_name);
    const quote = String(review.text || "").replace(/\s+/g, " ").slice(0, 140);
    return {
      body: `Word of mouth is everything to a local business${where}. ${first} recently said: "${quote}" Thank you, ${first} — and thank you to everyone who trusts ${business}.`,
      image_suggestion: "A real photo of the team or a recent finished job (no stock).",
    };
  }
  if (kind === "seasonal") {
    const month = new Date().getMonth();
    return {
      body: `${SEASONAL_ANGLES[month]} ${business} is a local crew${where} — real people, real answers, written estimates. Reach out any time.`,
      image_suggestion: "A seasonal, real photo — the crew, the truck, or a job in progress.",
    };
  }
  const svc = str(service) || "our services";
  return {
    body: `Need ${svc}${where}? ${business} shows up when promised, gives you the price in writing before work starts, and stands behind it. Call us for a free estimate — no pressure, just a clear answer.`,
    image_suggestion: `A real photo of a recent ${svc} job, before/after if you have one.`,
  };
}

async function draftGbpPost(input, opts = {}) {
  const fallback = templateGbpPost(input);
  if (!aiConfigured()) return { ...fallback, source: "template" };
  const system =
    "You write one short Google Business Profile post for a local business. Plain-spoken, specific, no hype, no hashtags, no emojis. " +
    "Under 120 words. Never invent prices, offers, reviews, or facts that are not in the brief. Output only the post text.";
  const user =
    `Kind: ${input.kind}\nBusiness: ${input.business_name}\nCity: ${input.city || ""}\nService in focus: ${input.service || ""}\n` +
    (input.review ? `Public review to highlight — reviewer first name ${firstNameOf(input.review.reviewer_name)}, rated ${input.review.rating}/5, said: ${String(input.review.text || "").slice(0, 300)}` : "");
  const ai = await callAi(system, user, opts);
  if (ai) return { body: ai, image_suggestion: fallback.image_suggestion, source: "ai" };
  return { ...fallback, source: "template" };
}

module.exports = {
  aiConfigured,
  draftReviewReply,
  draftGbpPost,
  // exported for the harness + previews
  templateReviewReply,
  templateGbpPost,
  firstNameOf,
  SEASONAL_LINES,
};
