// Spam/phishing gate for the public careers intake — added Nov 10,
// 2026 after a phishing submission ("4k USD waiting in your
// account. SIGN IN -> <link>" in the name field) sailed through to
// Wilton's inbox and into Worker_Applicants. Design rules:
// - Hard-drop signals are things no genuine applicant produces: a
//   filled honeypot, a URL in the name/area field, an empty name
//   or area, or BOTH a malformed email and an impossible phone.
// - Softer signals (one bad contact field, gibberish tokens, both
//   free-text fields empty) must combine — two or more — before
//   they drop anything, so a real applicant with imperfect English
//   or a typo is never filtered out by a single heuristic.
// - A drop is silent: the endpoint returns its normal success
//   response and saves/sends nothing, so the submitter — usually
//   a bot — learns nothing about why nothing happened.
const URL_RX = /https?:\/\/|www\.|[a-z0-9-]+\.(com|net|org|io|co|info|biz|xyz|click|live|site|online|top|club|shop)\b/i;
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function junkToken(raw) {
  const t = String(raw || "").toLowerCase();
  if (t.length < 4) return false;
  const hasDigit = /\d/.test(t);
  const hasLetter = /[a-z]/.test(t);
  if (hasDigit && hasLetter) return true; // 4ey3fc, v9wcu4, wezx7z-style
  if (hasLetter && t.length >= 5 && !/[aeiouy]/.test(t)) return true;
  return false;
}

function junkCount(text) {
  return String(text || "")
    .split(/[^A-Za-z0-9]+/)
    .filter(junkToken).length;
}

function assessCareersSubmission(b) {
  const reasons = [];
  const name = String(b.full_name || "");
  const email = String(b.email || "").trim();
  const phoneDigits = String(b.phone || "").replace(/\D/g, "");
  const area = String(b.city_area || "");
  const experience = String(b.experience || "");
  const why = String(b.why_techcare || "");

  if (String(b.company_website || "").trim() !== "") reasons.push("honeypot");
  if (URL_RX.test(name) || URL_RX.test(area)) reasons.push("url-in-name-or-area");
  if (name.trim() === "" || area.trim() === "") reasons.push("missing-required");

  const badEmail = !EMAIL_RX.test(email);
  const phoneOk =
    phoneDigits.length === 10 ||
    (phoneDigits.length === 11 && phoneDigits.startsWith("1"));
  const badPhone = !phoneOk;
  if (badEmail && badPhone) reasons.push("bad-email-and-phone");

  const hard = reasons.filter((r) =>
    ["honeypot", "url-in-name-or-area", "missing-required", "bad-email-and-phone"].includes(r)
  );
  if (hard.length) return { drop: true, reasons };

  let signals = 0;
  if (badEmail) { signals++; reasons.push("bad-email"); }
  if (badPhone) { signals++; reasons.push("bad-phone"); }
  const junk = junkCount(name) + junkCount(area) + junkCount(experience) + junkCount(why);
  if (junk >= 2) { signals++; reasons.push("gibberish-x" + junk); }
  if (experience.trim() === "" && why.trim() === "") { signals++; reasons.push("empty-free-text"); }

  if (signals >= 2) return { drop: true, reasons };
  return { drop: false, reasons };
}

module.exports = { assessCareersSubmission };
