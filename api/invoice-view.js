// GET /api/invoice-view?token=<uuid>
//
// The only unauthenticated read in this app. Backs the client-facing
// /invoice/<token> page (reached via the email/SMS link) — no sign-in,
// because clients don't have accounts. Safety comes from the token being
// an unguessable 128-bit value and from techcare.get_invoice_by_token_v2
// (SECURITY DEFINER) returning only what a client should see: no phone,
// email, address, job notes, or internal ids. Rate-limited per token and
// per IP so a token can't be hammered or enumerated.
const { getPool } = require("./_auth");

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });

  const token = (req.query && req.query.token) || "";
  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    return res.status(400).json({ error: "Invalid invoice link." });
  }

  const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();

  let db;
  try {
    db = getPool();
  } catch (e) {
    return res.status(503).json({ error: "Invoice lookup isn't available right now." });
  }

  try {
    const client = await db.connect();
    try {
      const { rows: r1 } = await client.query("select techcare.check_rate_limit_key($1, $2, $3) as ok", [`token:${token}`, 20, 600]);
      const { rows: r2 } = await client.query("select techcare.check_rate_limit_key($1, $2, $3) as ok", [`ip:${ip}`, 60, 600]);
      if (!r1[0].ok || !r2[0].ok) {
        return res.status(429).json({ error: "Too many requests — try again shortly." });
      }

      const { rows } = await client.query("select * from techcare.get_invoice_by_token_v2($1)", [token]);
      if (rows.length === 0) {
        return res.status(404).json({ error: "We couldn't find that invoice. Check the link or contact WilGlobo TechCare." });
      }
      return res.status(200).json({ invoice: rows[0] });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error("api/invoice-view error:", e);
    return res.status(500).json({ error: "Server error." });
  }
};
