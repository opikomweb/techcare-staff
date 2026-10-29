// POST /api/retell-outbound — Retell call_analyzed webhook for the
// outbound agent (spec: outbound-calling/interest-alerts.md). All of
// the routing lives in api/_retellOutbound.js; this file is transport:
// raw-body read, signature verification, event filter, responses.
//
// Signature: X-Retell-Signature v=<ms>,d=<hmac-sha256 hex> over
// rawBody + timestamp, keyed by RETELL_WEBHOOK_API_KEY (Retell's
// webhook-designated API key, portal env only — never in code/logs).
// Retell expects a fast 2xx with no body dependence; retries (3x) are
// absorbed by the call_id idempotency check in the pipeline.
//
// GET /api/retell-outbound?dnc_check=+1785... — the do-not-call read
// the dial flow consults before a batch. Internal: requires the
// portal's x-techcare-key header (TECHCARE_SMS_KEY, the same internal
// key as api/public/send-sms.js).
const {
  verifyRetellSignature,
  handleAnalyzedCall,
  isSuppressed,
} = require("./_retellOutbound");

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

module.exports = async (req, res) => {
  if (req.method === "GET") {
    const phone = (req.query && req.query.dnc_check) || "";
    if (!phone) return res.status(405).json({ ok: false, error: "Method not allowed." });
    const expected = process.env.TECHCARE_SMS_KEY;
    const provided = req.headers["x-techcare-key"] || "";
    if (!expected || provided !== expected) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }
    const out = await isSuppressed(String(phone));
    return res.status(200).json({ ok: true, phone: String(phone), ...out });
  }
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed." });

  const apiKey = process.env.RETELL_WEBHOOK_API_KEY;
  if (!apiKey) {
    // Fail closed: without the key we cannot prove a request is
    // Retell's, and this endpoint sends real texts.
    console.error("retell-outbound: RETELL_WEBHOOK_API_KEY is not set.");
    return res.status(503).json({ ok: false, error: "webhook_not_configured" });
  }

  let raw;
  try {
    raw = await readRawBody(req);
  } catch (e) {
    return res.status(400).json({ ok: false, error: "body_read_failed" });
  }
  const signature = req.headers["x-retell-signature"] || "";
  if (!verifyRetellSignature(raw, signature, apiKey)) {
    return res.status(401).json({ ok: false, error: "bad_signature" });
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (e) {
    return res.status(400).json({ ok: false, error: "bad_json" });
  }

  // Only call_analyzed carries the analysis fields the pipeline keys
  // on. Everything else is acknowledged and dropped.
  if (!payload || payload.event !== "call_analyzed") {
    return res.status(200).json({ ok: true, ignored: (payload && payload.event) || "unknown" });
  }

  try {
    const result = await handleAnalyzedCall(payload, {});
    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    console.error("retell-outbound failed:", e && e.message ? e.message : e);
    // 500 (not 200) so Retell retries — the pipeline is idempotent.
    return res.status(500).json({ ok: false, error: "pipeline_failed" });
  }
};

// Vercel: keep the raw body — signature verification needs it verbatim.
module.exports.config = { api: { bodyParser: false } };
