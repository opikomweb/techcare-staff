// POST /api/request-signin-link  { email }
//
// Replaces calling sb.auth.signInWithOtp directly from the browser. The old
// flow would happily email a magic link to ANY address typed into the box —
// access was only checked after the click, when the API looked the email up
// in staff.people. That let a stranger trigger sign-in emails to arbitrary
// addresses (spam/abuse risk) and gave no real gate on who even gets a link.
//
// This endpoint gates the send itself: only an email already on file in
// staff.people as an active person gets an actual magic-link email. Every
// request — found or not — gets the same generic response, so this can't
// be used to enumerate who is or isn't on staff. It's also rate-limited
// per email+IP so it can't be hammered.
const { getStaffPool, withStaffAuth } = require("./_staffAuth");

const SUPABASE_URL = "https://gyfuaynrqpfpdexbwyxs.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5ZnVheW5ycXBmcGRleGJ3eXhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzNDM1MDMsImV4cCI6MjA5OTkxOTUwM30.OpZgDkNPZu-KC3RQ8erZF6j7cvA-Gb3eUg-3zao0U4c";

const GENERIC_MSG = "If that email is on file with WilGlobo, a sign-in link is on its way — check your inbox.";

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  const body = req.body || {};
  const email = String(body.email || "").trim().toLowerCase();
  // The redirect target is never taken from the browser — only from our own
  // PUBLIC_SITE_URL env var. Supabase's /auth/v1/otp endpoint only honors
  // redirect_to as a URL query parameter; a redirect_to (or the wrong key,
  // email_redirect_to) placed inside the JSON body is silently ignored, so
  // a sign-in link would fall back to the Auth project's default Site URL
  // (a stale v0 vercel.app deployment) instead of staff.wilglobo.com.

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }

  const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();

  let db;
  try {
    db = getStaffPool();
  } catch (e) {
    return res.status(503).json({ error: "Staff portal isn't fully connected yet — contact WilGlobo support to finish the database setup." });
  }

  try {
    // No uid yet (pre-auth), so query staff_app directly — the helper
    // functions below are SECURITY DEFINER and don't need request.jwt.claims.
    const client = await db.connect();
    let registered = false;
    try {
      // Two independent rate-limit keys: per-email (stop one address being
      // hammered) and per-IP (stop one requester trying many addresses).
      const { rows: r1 } = await client.query("select staff.check_rate_limit_key($1, $2, $3) as ok", [`email:${email}`, 5, 600]);
      const { rows: r2 } = await client.query("select staff.check_rate_limit_key($1, $2, $3) as ok", [`ip:${ip}`, 15, 600]);
      if (!r1[0].ok || !r2[0].ok) {
        // Still return the generic message — don't reveal that the limit is
        // what's blocking this particular request.
        return res.status(200).json({ message: GENERIC_MSG });
      }
      const { rows } = await client.query("select staff.email_is_registered($1) as ok", [email]);
      registered = !!(rows[0] && rows[0].ok);
    } finally {
      client.release();
    }

    if (registered) {
      const siteUrl = process.env.PUBLIC_SITE_URL || "https://staff.wilglobo.com";
      const redirectTo = `${siteUrl.replace(/\/+$/, "")}/`;
      const otpRes = await fetch(
        `${SUPABASE_URL}/auth/v1/otp?redirect_to=${encodeURIComponent(redirectTo)}`,
        {
          method: "POST",
          headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ email, create_user: true }),
        }
      );
      // Even on a Supabase-side failure, don't leak details to the caller —
      // log it for us, tell the visitor the same generic thing.
      if (!otpRes.ok) {
        const text = await otpRes.text().catch(() => "");
        console.error("request-signin-link: supabase otp send failed", otpRes.status, text);
      }
    }

    return res.status(200).json({ message: GENERIC_MSG });
  } catch (e) {
    console.error("api/request-signin-link error:", e);
    // Fail generically here too.
    return res.status(200).json({ message: GENERIC_MSG });
  }
};
