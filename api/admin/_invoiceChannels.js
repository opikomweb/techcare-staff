// Delivery channels for an invoice: email, SMS, and the Square payment
// link. Each is a single seam function that either does the real thing
// (when its credentials are configured as Vercel env vars) or returns a
// clear "not configured yet" result — never a guessed credential, never a
// secret typed into chat. Wire each one up by setting its env var(s) in
// the Vercel project; nothing here needs to change when that happens.

// ---------------------------------------------------------------------
// Email — Resend (chosen because wilglobo-core already has a Resend-based
// edge function for other products; swap providers here if that's wrong).
// Env: RESEND_API_KEY, optionally RESEND_FROM (defaults below).
async function sendInvoiceEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { sent: false, reason: "email_not_configured" };
  }
  const from = process.env.RESEND_FROM || "WilGlobo TechCare <invoices@wilglobo.com>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { sent: false, reason: "email_send_failed", error: data.message || res.status };
    }
    return { sent: true, id: data.id };
  } catch (e) {
    return { sent: false, reason: "email_send_failed", error: String(e) };
  }
}

// ---------------------------------------------------------------------
// SMS — goes through an n8n webhook that holds the actual Twilio
// credential; this app never sees a Twilio key. Env: TECHCARE_SMS_KEY
// (required — its absence is what triggers the not-configured fallback),
// TECHCARE_SMS_WEBHOOK_URL (optional override of the default below).
const DEFAULT_SMS_WEBHOOK = "https://wilglobo.app.n8n.cloud/webhook/techcare-send-sms";

async function sendInvoiceSms({ to, body, invoiceId }) {
  const key = process.env.TECHCARE_SMS_KEY;
  if (!key) {
    return { sent: false, reason: "sms_not_configured" };
  }
  const url = process.env.TECHCARE_SMS_WEBHOOK_URL || DEFAULT_SMS_WEBHOOK;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-techcare-key": key },
      body: JSON.stringify({ to, body, invoiceId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      return { sent: false, reason: "sms_send_failed", error: data.error || res.status };
    }
    return { sent: true, sid: data.sid };
  } catch (e) {
    return { sent: false, reason: "sms_send_failed", error: String(e) };
  }
}

// Builds the exact text sent to a client. Deliberately leaves out the
// amount and any card/account detail — just a name, a short link, and the
// opt-out line every commercial text needs.
function buildInvoiceSmsBody(shortLink) {
  return `WilGlobo TechCare: your invoice is ready. View & pay: ${shortLink} Reply STOP to opt out.`;
}

// ---------------------------------------------------------------------
// Square checkout link. Env: SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID.
// Returns null (no link — invoice falls back to e-transfer/contact
// instructions on the client-facing page) when not configured.
async function createSquareCheckoutUrl({ amount, description, invoiceNo }) {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.SQUARE_LOCATION_ID;
  if (!token || !locationId) {
    return { url: null, reason: "square_not_configured" };
  }
  try {
    const res = await fetch("https://connect.squareup.com/v2/online-checkout/payment-links", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        idempotency_key: `invoice-${invoiceNo}-${Date.now()}`,
        quick_pay: {
          name: `WilGlobo TechCare — Invoice ${invoiceNo}`,
          price_money: { amount: Math.round(amount * 100), currency: "CAD" },
          location_id: locationId,
        },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { url: null, reason: "square_create_failed", error: data.errors || res.status };
    }
    return { url: data.payment_link && data.payment_link.url, reason: null };
  } catch (e) {
    return { url: null, reason: "square_create_failed", error: String(e) };
  }
}

module.exports = { sendInvoiceEmail, sendInvoiceSms, buildInvoiceSmsBody, createSquareCheckoutUrl };
