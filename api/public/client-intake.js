// GET /start renders the "Start your TechCare visit" intake form;
// POST /api/public/client-intake processes it. Ported from the n8n
// "Client Intake and E-Sign" form (n8n retirement): same fields,
// labels, options, agreement wording, and confirmation text; the
// document read links point at the portal's own /doc pages instead of
// the retired n8n webhook. Processing lives in api/_intake.js.
const { pageShell, sendHtml, esc } = require("./_pageShell");
const { runClientIntake } = require("../_intake");

const DOC_BASE = "https://staff.wilglobo.com/doc?code=";

const SERVICES = [
  "App install (phone, tablet or computer)", "Email setup", "Help buying something online",
  "Call my internet, TV, phone or subscription company with me", "Help buying or renting a device",
  "Fix a problem (troubleshooting)", "Wi-Fi or network setup", "Windows installation",
  "TV setup", "TV mounting on the wall", "Something else",
];

function formHtml() {
  const serviceBoxes = SERVICES.map((s) =>
    `<label style="font-weight:normal;margin:6px 0"><input type="checkbox" name="services" value="${esc(s)}"> ${esc(s)}</label>`).join("");
  const body = `
<h1>Start your TechCare visit</h1>
<p class="sub">Friendly, patient tech help at home in Calgary. This form takes about 5 minutes. A family member or friend is welcome to fill it in with you. Prefer to talk? Call 403-679-3039.</p>
<p class="meta">WilGlobo Inc., operating as TechCare by WilGlobo. 105 26 Ave SW, Calgary. 403-679-3039.</p>
<form method="POST" action="/api/public/client-intake">
<div class="card">
<h2 class="day" style="margin-top:0">1. About you</h2>
<label>Your full name <input type="text" name="full_name" required></label>
<label>Phone number <input type="text" name="phone" placeholder="e.g. 403-555-0123" required></label>
<label>Email (we send your signed copies here) <input type="text" name="email"></label>
<label>Home address where we will help you <input type="text" name="address" placeholder="Street, unit, postal code" required></label>
<label>City or town <input type="text" name="city" value="Calgary"></label>
<label>How should we contact you?</label>
<label style="font-weight:normal"><input type="radio" name="preferred_contact" value="Phone call"> Phone call</label>
<label style="font-weight:normal"><input type="radio" name="preferred_contact" value="Text message"> Text message</label>
<label style="font-weight:normal"><input type="radio" name="preferred_contact" value="Email"> Email</label>
<label>Support person (optional): name of a family member or friend we may talk to <input type="text" name="support_name"></label>
<label>Support person phone (optional) <input type="text" name="support_phone"></label>
<label>Anything that helps us help you? (hearing, vision, mobility, stairs, pets, best way to explain things) <textarea name="accessibility"></textarea></label>
</div>
<div class="card">
<h2 class="day" style="margin-top:0">2. What you need</h2>
<label>What can we help with? Pick any that apply</label>
${serviceBoxes}
<label>Tell us a little about it <textarea name="problem"></textarea></label>
<label>Best days and times for a visit <input type="text" name="availability"></label>
<label>How did you hear about us?
<select name="heard_from">
<option value=""></option>
<option>A friend or family member</option>
<option>Website</option>
<option>Social media</option>
<option>Newspaper or magazine</option>
<option>I am a returning client</option>
<option>Other</option>
</select></label>
</div>
<div class="card">
<h2 class="day" style="margin-top:0">3. Read and agree</h2>
<p class="meta">Please open and read each document (or have it read to you). Each one opens on its own page. Tick the box to agree.</p>
<p class="meta"><a href="${DOC_BASE}CL-SERVICE" target="_blank" rel="noopener">Read: Service Agreement and Liability Waiver (CL-SERVICE)</a></p>
<label style="font-weight:normal"><input type="checkbox" name="agree_service" value="I have read the Service Agreement and Liability Waiver, or had it read to me, and I agree to it." required> Service Agreement and Liability Waiver — I have read the Service Agreement and Liability Waiver, or had it read to me, and I agree to it.</label>
<p class="meta"><a href="${DOC_BASE}CL-PRIVACY" target="_blank" rel="noopener">Read: Privacy Notice and Consent (CL-PRIVACY)</a></p>
<label style="font-weight:normal"><input type="checkbox" name="agree_privacy" value="I have read the Privacy Notice and I consent to WilGlobo Inc. collecting and using my information as it describes." required> Privacy Notice and Consent — I have read the Privacy Notice and I consent to WilGlobo Inc. collecting and using my information as it describes.</label>
<p class="meta"><a href="${DOC_BASE}CL-DEVICE" target="_blank" rel="noopener">Read: Device and Account Access Consent (CL-DEVICE)</a></p>
<label style="font-weight:normal"><input type="checkbox" name="agree_device" value="I have read the Device and Account Access Consent and I agree to it. I will type my own passwords and card details." required> Device and Account Access Consent — I have read the Device and Account Access Consent and I agree to it. I will type my own passwords and card details.</label>
<p class="meta"><a href="${DOC_BASE}CL-PHOTO" target="_blank" rel="noopener">Read: Photo and Testimonial Consent (CL-PHOTO), optional</a></p>
<label style="font-weight:normal"><input type="checkbox" name="agree_photo" value="Yes, I agree to the Photo and Testimonial Consent."> Photo and Testimonial Consent (optional, you can say no) — Yes, I agree to the Photo and Testimonial Consent.</label>
<label style="font-weight:normal"><input type="checkbox" name="marketing" value="Yes, WilGlobo Inc. may send me tips, news and offers by email or text. I can unsubscribe at any time."> Tips and offers (optional) — Yes, WilGlobo Inc. may send me tips, news and offers by email or text. I can unsubscribe at any time.</label>
</div>
<div class="card">
<h2 class="day" style="margin-top:0">4. Sign</h2>
<p class="meta">Typing your full name below is your electronic signature on each document you ticked. We record the date, time and document version, and email you a signed copy.</p>
<label>Your full name (this is your signature) <input type="text" name="signature" required></label>
<label>Only if you are filling this in for someone else: your name, your relationship to them, and your authority (for example, power of attorney) <input type="text" name="on_behalf"></label>
<button class="submit" type="submit">Sign and send</button>
</div>
</form>`;
  return pageShell({ title: "Start your TechCare visit", body });
}

const CONFIRMATION = "Thank you. We have your details and your signed forms. Your signed copies are on their way by email. We will call you within one business day to book your visit. Need us sooner? Call 403-679-3039.";

module.exports = async (req, res) => {
  if (req.method === "GET") {
    return sendHtml(res, formHtml());
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  try {
    const result = await runClientIntake(req.body || {});
    const body = `<h1>Thank you</h1><div class="card"><p class="meta" style="font-size:16px">${esc(CONFIRMATION)}</p></div>`;
    return sendHtml(res, pageShell({ title: "Thank you", body }));
  } catch (e) {
    console.error("client-intake failed:", e);
    const body = `<h1>Something went wrong</h1><div class="card"><p class="meta">We could not save the form just now. Please call us at 403-679-3039 and we will take your details by phone.</p></div>`;
    return sendHtml(res, pageShell({ title: "Please call us", body }));
  }
};

module.exports._test = { formHtml, CONFIRMATION };
