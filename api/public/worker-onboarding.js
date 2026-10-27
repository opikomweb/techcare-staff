// GET /join renders the "Join the TechCare team" worker onboarding
// form; POST /api/public/worker-onboarding processes it (multipart —
// it carries document uploads). Ported from the n8n "Worker
// Onboarding and E-Sign" form (n8n retirement): same fields, labels,
// options, CRA questions, agreement wording, and confirmation text;
// read links point at the portal's /doc pages. Uploaded documents are
// forwarded to Wilton by email as attachments and stored nowhere
// else, exactly as the original behaved. Processing in
// api/_onboarding.js.
const { pageShell, sendHtml, esc } = require("./_pageShell");
const { runWorkerOnboarding } = require("../_onboarding");

const DOC = "https://staff.wilglobo.com/doc?code=";
const SKILLS = ["Phones and tablets", "Computers and Windows", "Wi-Fi and networks", "TV setup and audio", "TV mounting and physical installs", "Email and online accounts", "Buying devices and dealing with providers", "AI and automation", "Creative and media"];
const CRA = [
  ["cra_hours", "Will WilGlobo set your hours, or require you to be available at fixed times?"],
  ["cra_method", "Will WilGlobo tell you how to do the technical work (beyond safety, privacy and client care rules)?"],
  ["cra_tools", "Will WilGlobo supply most of your tools, equipment or vehicle?"],
  ["cra_pay", "Will you be paid only by the hour, with no chance to earn more by working efficiently?"],
  ["cra_costs", "Will you have no business costs and no risk of losing money?"],
  ["cra_only", "Will WilGlobo be your only client for this kind of work?"],
  ["cra_decline", "Would you be unable to turn down a job without consequences?"],
  ["cra_staff", "Will clients see you only as WilGlobo staff, with no business of your own?"],
  ["cra_ongoing", "Is this an ongoing, open-ended role rather than defined tasks?"],
];

function yesNo(name, label, required) {
  return `<label>${esc(label)}</label>
<label style="font-weight:normal"><input type="radio" name="${name}" value="Yes"${required ? " required" : ""}> Yes</label>
<label style="font-weight:normal"><input type="radio" name="${name}" value="No"> No</label>`;
}

function formHtml() {
  const skillBoxes = SKILLS.map((s) =>
    `<label style="font-weight:normal;margin:6px 0"><input type="checkbox" name="skills" value="${esc(s)}"> ${esc(s)}</label>`).join("");
  const body = `
<h1>Join the TechCare team</h1>
<p class="sub">Onboarding for independent contractors, service experts and casual or seasonal staff. About 10 minutes. Questions? Call 403-679-3039.</p>
<p class="meta">WilGlobo Inc., operating as TechCare by WilGlobo. Worker and contractor onboarding. Your information is kept private under our Privacy Policy and the Confidentiality Undertaking.</p>
<form method="POST" action="/api/public/worker-onboarding" enctype="multipart/form-data">
<div class="card">
<h2 class="day" style="margin-top:0">1. About you</h2>
<label>Legal full name <input type="text" name="legal_name" required></label>
<label>Business name (if you have one) <input type="text" name="business_name"></label>
<label>GST/HST number (if registered) <input type="text" name="gst"></label>
<label>Email <input type="text" name="email" required></label>
<label>Mobile phone <input type="text" name="phone" required></label>
<label>Home address <input type="text" name="address" required></label>
<label>City <input type="text" name="city" value="Calgary" required></label>
<label>Emergency contact name <input type="text" name="emergency_name" required></label>
<label>Emergency contact phone <input type="text" name="emergency_phone" required></label>
</div>
<div class="card">
<h2 class="day" style="margin-top:0">2. Your work</h2>
<label>What can you do well? Pick all that apply</label>
${skillBoxes}
<label>Tell us about your experience <textarea name="experience"></textarea></label>
<label>When are you available? <input type="text" name="availability"></label>
${yesNo("vehicle", "Do you have your own vehicle and a valid driver licence?", false)}
<label>How do you want to work with us?</label>
<label style="font-weight:normal"><input type="radio" name="track" value="As an independent business (contractor): I invoice, carry my own insurance and WCB clearance, and I can work for others" required> As an independent business (contractor): I invoice, carry my own insurance and WCB clearance, and I can work for others</label>
<label style="font-weight:normal"><input type="radio" name="track" value="As a casual or seasonal employee on WilGlobo payroll"> As a casual or seasonal employee on WilGlobo payroll</label>
<label style="font-weight:normal"><input type="radio" name="track" value="Not sure yet, let us talk"> Not sure yet, let us talk</label>
</div>
<div class="card">
<h2 class="day" style="margin-top:0">3. Checks and documents</h2>
<p class="meta">Upload clear photos or PDFs. Everyone needs a police information check with vulnerable sector check. Independent contractors also need liability insurance and a WCB-Alberta clearance letter. You can send these later if you do not have them yet.</p>
<label>Police check with vulnerable sector check: date issued <input type="text" name="police_date" placeholder="YYYY-MM-DD"></label>
<label>Liability insurance: expiry date (contractors) <input type="text" name="insurance_expiry" placeholder="YYYY-MM-DD"></label>
<label>WCB-Alberta clearance letter: expiry date (contractors) <input type="text" name="wcb_expiry" placeholder="YYYY-MM-DD"></label>
<label>Upload your documents (police check, insurance certificate, WCB clearance, ID if asked) <input type="file" name="documents" multiple accept=".pdf,.jpg,.jpeg,.png,.heic"></label>
</div>
<div class="card">
<h2 class="day" style="margin-top:0">4. Contractor check (independent business only)</h2>
<p class="meta">These are the questions the Canada Revenue Agency uses to tell a contractor from an employee (guide RC4110). Answer honestly. There are no wrong answers. If most answers are Yes, the casual employee route is usually the right fit and protects you. Choose No if this section does not apply to you.</p>
${CRA.map(([n, l]) => yesNo(n, l, true)).join("\n")}
</div>
<div class="card">
<h2 class="day" style="margin-top:0">5. Read and agree</h2>
<p class="meta">Open and read each document. Tick to agree. Your main agreement is chosen from your answer in section 2.</p>
<p class="meta"><a href="${DOC}WK-AGREEMENT" target="_blank" rel="noopener">Read: Worker Services Agreement (contractors)</a><br><a href="${DOC}WK-CASUAL" target="_blank" rel="noopener">Read: Casual Employment Letter (employees)</a></p>
<label style="font-weight:normal"><input type="checkbox" name="agree_main" value="I have read the agreement that matches how I chose to work, and I agree to it."> Main agreement — I have read the agreement that matches how I chose to work, and I agree to it.</label>
<p class="meta"><a href="${DOC}WK-CONDUCT" target="_blank" rel="noopener">Read: Code of Conduct, Ethics and Client Safeguarding (WK-CONDUCT)</a></p>
<label style="font-weight:normal"><input type="checkbox" name="agree_conduct" value="I have read the Code of Conduct, Ethics and Client Safeguarding and I agree to follow it." required> Code of Conduct, Ethics and Client Safeguarding — I have read the Code of Conduct, Ethics and Client Safeguarding and I agree to follow it.</label>
<p class="meta"><a href="${DOC}WK-PRIVACY" target="_blank" rel="noopener">Read: Confidentiality and Privacy Undertaking (WK-PRIVACY)</a></p>
<label style="font-weight:normal"><input type="checkbox" name="agree_privacy" value="I have read the Confidentiality and Privacy Undertaking and I agree to follow it." required> Confidentiality and Privacy Undertaking — I have read the Confidentiality and Privacy Undertaking and I agree to follow it.</label>
<p class="meta"><a href="${DOC}WK-SAFETY" target="_blank" rel="noopener">Read: Health and Safety Rules (WK-SAFETY)</a></p>
<label style="font-weight:normal"><input type="checkbox" name="agree_safety" value="I have read the Health and Safety Rules and I agree to follow it." required> Health and Safety Rules — I have read the Health and Safety Rules and I agree to follow it.</label>
<p class="meta"><a href="${DOC}AI-POLICY" target="_blank" rel="noopener">Read: AI Use Policy (AI-POLICY)</a></p>
<label style="font-weight:normal"><input type="checkbox" name="agree_ai" value="I have read the AI Use Policy and I agree to follow it." required> AI Use Policy — I have read the AI Use Policy and I agree to follow it.</label>
</div>
<div class="card">
<h2 class="day" style="margin-top:0">6. Sign</h2>
<p class="meta">Typing your legal name is your electronic signature on each document you ticked. We record the date, time and version and email you signed copies.</p>
<label>Your legal full name (this is your signature) <input type="text" name="signature" required></label>
<button class="submit" type="submit">Sign and submit</button>
</div>
</form>`;
  return pageShell({ title: "Join the TechCare team", body });
}

// Minimal multipart/form-data parser (fields + files, in memory).
// The onboarding form is the portal's only multipart endpoint; files
// are a few small compliance documents forwarded by email.
function parseMultipart(buf, boundary) {
  const fields = {};
  const files = [];
  const delim = Buffer.from("--" + boundary);
  let pos = 0;
  const parts = [];
  let idx = buf.indexOf(delim, pos);
  while (idx !== -1) {
    const next = buf.indexOf(delim, idx + delim.length);
    if (next === -1) break;
    let start = idx + delim.length;
    if (buf[start] === 45 && buf[start + 1] === 45) break; // closing --
    if (buf[start] === 13 && buf[start + 1] === 10) start += 2;
    let end = next;
    if (buf[end - 2] === 13 && buf[end - 1] === 10) end -= 2;
    parts.push(buf.subarray(start, end));
    idx = next;
  }
  for (const part of parts) {
    const headEnd = part.indexOf("\r\n\r\n");
    if (headEnd === -1) continue;
    const head = part.subarray(0, headEnd).toString("utf8");
    const data = part.subarray(headEnd + 4);
    const nameM = head.match(/name="([^"]+)"/);
    if (!nameM) continue;
    const name = nameM[1];
    const fileM = head.match(/filename="([^"]*)"/);
    if (fileM) {
      if (fileM[1]) {
        const ct = (head.match(/Content-Type:\s*([^\r\n]+)/i) || [])[1] || "application/octet-stream";
        files.push({ field: name, filename: fileM[1], contentType: ct.trim(), data: Buffer.from(data) });
      }
      continue;
    }
    const value = data.toString("utf8");
    if (fields[name] === undefined) fields[name] = value;
    else if (Array.isArray(fields[name])) fields[name].push(value);
    else fields[name] = [fields[name], value];
  }
  return { fields, files };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const CONFIRMATION = "Thank you. Your details and signed documents are recorded, and signed copies are on their way by email. Wilton will review your checks and call you. You cannot be dispatched until every check is complete.";

module.exports = async (req, res) => {
  if (req.method === "GET") {
    return sendHtml(res, formHtml());
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  try {
    const buf = await readBody(req);
    const ct = req.headers["content-type"] || "";
    let fields = {};
    let files = [];
    if (ct.includes("multipart/form-data")) {
      const boundary = (ct.match(/boundary=([^;]+)/) || [])[1];
      if (!boundary) throw new Error("multipart boundary missing");
      ({ fields, files } = parseMultipart(buf, boundary.trim()));
    } else if (ct.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(buf.toString("utf8"));
      for (const [k, v] of params) {
        if (fields[k] === undefined) fields[k] = v;
        else if (Array.isArray(fields[k])) fields[k].push(v);
        else fields[k] = [fields[k], v];
      }
    } else {
      fields = JSON.parse(buf.toString("utf8") || "{}");
    }
    await runWorkerOnboarding(fields, files);
    const body = `<h1>Thank you</h1><div class="card"><p class="meta" style="font-size:16px">${esc(CONFIRMATION)}</p></div>`;
    return sendHtml(res, pageShell({ title: "Thank you", body }));
  } catch (e) {
    console.error("worker-onboarding failed:", e);
    const body = `<h1>Something went wrong</h1><div class="card"><p class="meta">We could not save the form just now. Please call us at 403-679-3039 and we will take your details by phone.</p></div>`;
    return sendHtml(res, pageShell({ title: "Please call us", body }));
  }
};

module.exports.config = { api: { bodyParser: false } };
module.exports._test = { formHtml, parseMultipart, CONFIRMATION };
