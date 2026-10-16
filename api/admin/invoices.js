// GET  /api/admin/invoices            -> list invoices (summary) + totals
// GET  /api/admin/invoices?meta=1      -> contractors + service catalog, for the "new invoice" form
// GET  /api/admin/invoices?id=<uuid>   -> one invoice: line items + full event history
// POST /api/admin/invoices  { action: "create" | "send_email" | "send_sms" | "mark_paid" | "void", ... }
//
// Nothing here touches techcare.jobs/clients through Airtable — this is a
// separate, direct path for invoicing. A job created by "create" below is
// stamped completed immediately (no check-in/out step exists yet; that's
// a later build). All access is gated by core-staff (admin.html's own
// sign-in), then executed against techcare_app with request.jwt.claims set
// to the signed-in person's own uid, so the jobs_own/invoices_via_job
// "role in (admin, owner)" RLS bypass applies.
const { requireCoreStaff } = require("./_requireCoreStaff");
const { withTechcareAuth } = require("../_auth");
const { sendInvoiceEmail, sendInvoiceSms, buildInvoiceSmsBody, createSquareCheckoutUrl } = require("./_invoiceChannels");

function invoiceNo() {
  const d = new Date();
  const ymd = d.toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `TC-${ymd}-${suffix}`;
}

const GST_RATE = 0.05; // Alberta: GST only, no PST. WilGlobo Inc GST/HST # 790403166 RT0001.
function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function invoiceHtml(inv, lineItems, shortLink) {
  const rows = lineItems
    .map(
      (li) =>
        `<tr><td style="padding:4px 8px">${li.label}</td><td style="padding:4px 8px;text-align:right">${li.quantity}</td><td style="padding:4px 8px;text-align:right">$${Number(li.unit_amount).toFixed(2)}</td><td style="padding:4px 8px;text-align:right">$${Number(li.line_total).toFixed(2)}</td></tr>`
    )
    .join("");
  const subtotal = inv.subtotal != null ? Number(inv.subtotal) : Number(inv.total);
  const gst = Number(inv.gst_amount || 0);
  return `<div style="font-family:sans-serif;max-width:480px">
    <h2 style="margin:0 0 4px">WilGlobo TechCare</h2>
    <p style="color:#555;margin:0 0 16px">Invoice ${inv.invoice_no}</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <thead><tr><th style="text-align:left;padding:4px 8px">Item</th><th style="padding:4px 8px">Qty</th><th style="padding:4px 8px">Rate</th><th style="padding:4px 8px">Total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:8px">
      <tr><td style="padding:2px 8px">Subtotal</td><td style="padding:2px 8px;text-align:right">$${subtotal.toFixed(2)}</td></tr>
      <tr><td style="padding:2px 8px">GST (5%)</td><td style="padding:2px 8px;text-align:right">$${gst.toFixed(2)}</td></tr>
    </table>
    <p style="font-size:18px;font-weight:bold;margin:16px 0">Total: $${Number(inv.total).toFixed(2)} CAD</p>
    <p><a href="${shortLink}" style="background:#1c5fd6;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">View & pay invoice</a></p>
    <p style="color:#888;font-size:12px;margin-top:24px">WilGlobo TechCare · tech@wilglobo.com · (403) 679-3039 · GST# 790403166 RT0001</p>
  </div>`;
}

module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const gate = await requireCoreStaff(req);
    if (gate.error) return res.status(gate.status || 400).json({ error: gate.error });
    const { uid, person: actor } = gate;

    // -------------------------------------------------------------- GET
    if (req.method === "GET") {
      if (req.query && req.query.meta) {
        const meta = await withTechcareAuth(uid, async (client) => {
          const { rows: contractors } = await client.query(
            "select id, full_name, role from techcare.contractors where active order by full_name"
          );
          const { rows: serviceItems } = await client.query(
            "select id, code, label, category, pricing_type, amount from techcare.service_items where active order by sort_order"
          );
          return { contractors, serviceItems };
        });
        return res.status(200).json(meta);
      }

      if (req.query && req.query.id) {
        const detail = await withTechcareAuth(uid, async (client) => {
          const { rows: invRows } = await client.query(
            `select i.*, j.client_id, j.contractor_id, j.scope_text, cl.full_name as client_name, cl.phone as client_phone, cl.email as client_email, cl.sms_consent
               from techcare.invoices i
               join techcare.jobs j on j.id = i.job_id
               join techcare.clients cl on cl.id = j.client_id
              where i.id = $1`,
            [req.query.id]
          );
          if (invRows.length === 0) return null;
          const { rows: lineItems } = await client.query(
            `select li.quantity, li.unit_amount, li.line_total, si.label
               from techcare.job_line_items li join techcare.service_items si on si.id = li.service_item_id
              where li.job_id = $1
              order by si.sort_order`,
            [invRows[0].job_id]
          );
          const { rows: events } = await client.query(
            "select event_type, channel, detail, created_at from techcare.invoice_events where invoice_id = $1 order by created_at desc",
            [req.query.id]
          );
          return { invoice: invRows[0], lineItems, events };
        });
        if (!detail) return res.status(404).json({ error: "No invoice with that id." });
        return res.status(200).json(detail);
      }

      const invoices = await withTechcareAuth(uid, async (client) => {
        const { rows } = await client.query(
          `select i.id, i.invoice_no, i.subtotal, i.gst_amount, i.total, i.payment_method, i.status, i.sent_via, i.sent_at, i.paid_at, i.created_at, i.public_token,
                  cl.full_name as client_name
             from techcare.invoices i
             join techcare.jobs j on j.id = i.job_id
             join techcare.clients cl on cl.id = j.client_id
            order by i.created_at desc`
        );
        return rows;
      });
      return res.status(200).json({ invoices });
    }

    // ------------------------------------------------------------- POST
    const body = req.body || {};
    const action = body.action;

    if (action === "create") {
      const clientName = (body.clientName || "").trim();
      const clientPhone = (body.clientPhone || "").trim() || null;
      const clientEmail = (body.clientEmail || "").trim().toLowerCase() || null;
      const clientAddress = (body.clientAddress || "").trim() || null;
      const contractorId = body.contractorId;
      const scopeText = (body.scopeText || "").trim() || null;
      const smsConsent = !!body.smsConsent;
      const lineItemsIn = Array.isArray(body.lineItems) ? body.lineItems : [];

      if (!clientName) return res.status(400).json({ error: "Client name is required." });
      if (!contractorId) return res.status(400).json({ error: "Pick a contractor." });
      if (lineItemsIn.length === 0) return res.status(400).json({ error: "Add at least one line item." });
      if (smsConsent && !clientPhone) return res.status(400).json({ error: "A phone number is required to set SMS consent." });

      const result = await withTechcareAuth(uid, async (client) => {
        // Find-or-create the client by email, then phone, else a new row.
        let clientRow = null;
        if (clientEmail) {
          const { rows } = await client.query("select * from techcare.clients where lower(email) = $1", [clientEmail]);
          clientRow = rows[0];
        }
        if (!clientRow && clientPhone) {
          const { rows } = await client.query("select * from techcare.clients where phone = $1", [clientPhone]);
          clientRow = rows[0];
        }
        if (clientRow) {
          const { rows } = await client.query(
            `update techcare.clients set
               full_name = $1,
               phone = coalesce($2, phone),
               email = coalesce($3, email),
               address = coalesce($4, address),
               sms_consent = $5
             where id = $6 returning *`,
            [clientName, clientPhone, clientEmail, clientAddress, smsConsent || clientRow.sms_consent, clientRow.id]
          );
          clientRow = rows[0];
        } else {
          const { rows } = await client.query(
            `insert into techcare.clients (full_name, phone, email, address, sms_consent)
             values ($1, $2, $3, $4, $5) returning *`,
            [clientName, clientPhone, clientEmail, clientAddress, smsConsent]
          );
          clientRow = rows[0];
        }

        // One job per invoice today (no check-in/out flow yet — stamped
        // completed at the moment the invoice is created).
        const { rows: jobRows } = await client.query(
          `insert into techcare.jobs (client_id, contractor_id, status, scope_text, completed_at)
           values ($1, $2, 'completed', $3, now()) returning id`,
          [clientRow.id, contractorId, scopeText]
        );
        const jobId = jobRows[0].id;

        let total = 0;
        const lineItemRows = [];
        for (const li of lineItemsIn) {
          const qty = Number(li.quantity) || 0;
          if (qty <= 0) continue;
          const { rows: svcRows } = await client.query(
            "select id, label, amount from techcare.service_items where id = $1 and active",
            [li.serviceItemId]
          );
          const svc = svcRows[0];
          if (!svc) continue;
          const lineTotal = qty * Number(svc.amount);
          total += lineTotal;
          await client.query(
            `insert into techcare.job_line_items (job_id, service_item_id, quantity, unit_amount, line_total)
             values ($1, $2, $3, $4, $5)`,
            [jobId, svc.id, qty, svc.amount, lineTotal]
          );
          lineItemRows.push({ label: svc.label, quantity: qty, unit_amount: svc.amount, line_total: lineTotal });
        }
        if (lineItemRows.length === 0) {
          throw Object.assign(new Error("None of the line items matched an active service."), { httpStatus: 400 });
        }

        const subtotal = round2(total);
        const gstAmount = round2(subtotal * GST_RATE);
        const grandTotal = round2(subtotal + gstAmount);

        const square = await createSquareCheckoutUrl({ amount: grandTotal, invoiceNo: invoiceNo() });
        const no = invoiceNo();
        const { rows: invRows } = await client.query(
          `insert into techcare.invoices (job_id, invoice_no, subtotal, gst_amount, total, square_checkout_url, status)
           values ($1, $2, $3, $4, $5, $6, 'pending') returning *`,
          [jobId, no, subtotal, gstAmount, grandTotal, square.url]
        );
        const invoice = invRows[0];

        await client.query(
          `insert into techcare.invoice_events (invoice_id, event_type, detail) values ($1, 'created', $2)`,
          [invoice.id, JSON.stringify({ by: actor.email, square: square.reason || "ok" })]
        );

        return { invoice, lineItems: lineItemRows, client: clientRow };
      });

      return res.status(201).json(result);
    }

    if (action === "send_email" || action === "send_sms") {
      const invoiceId = body.invoiceId;
      if (!invoiceId) return res.status(400).json({ error: "Missing invoiceId." });

      const data = await withTechcareAuth(uid, async (client) => {
        const { rows } = await client.query(
          `select i.*, cl.full_name as client_name, cl.email as client_email, cl.phone as client_phone, cl.sms_consent
             from techcare.invoices i
             join techcare.jobs j on j.id = i.job_id
             join techcare.clients cl on cl.id = j.client_id
            where i.id = $1`,
          [invoiceId]
        );
        if (rows.length === 0) return null;
        const { rows: lineItems } = await client.query(
          `select li.quantity, li.unit_amount, li.line_total, si.label
             from techcare.job_line_items li join techcare.service_items si on si.id = li.service_item_id
            where li.job_id = $1 order by si.sort_order`,
          [rows[0].job_id]
        );
        return { invoice: rows[0], lineItems };
      });
      if (!data) return res.status(404).json({ error: "No invoice with that id." });

      const host = req.headers["x-forwarded-host"] || req.headers.host;
      const shortLink = `https://${host}/invoice/${data.invoice.public_token}`;

      if (action === "send_email") {
        if (!data.invoice.client_email) {
          return res.status(400).json({ error: "This client has no email on file." });
        }
        const sendResult = await sendInvoiceEmail({
          to: data.invoice.client_email,
          subject: `WilGlobo TechCare — Invoice ${data.invoice.invoice_no}`,
          html: invoiceHtml(data.invoice, data.lineItems, shortLink),
        });
        await withTechcareAuth(uid, async (client) => {
          if (sendResult.sent) {
            await client.query(
              "update techcare.invoices set status = case when status = 'pending' then 'sent' else status end, sent_via = 'email', sent_at = now() where id = $1",
              [invoiceId]
            );
          }
          await client.query(
            "insert into techcare.invoice_events (invoice_id, event_type, channel, detail) values ($1, $2, 'email', $3)",
            [invoiceId, sendResult.sent ? "emailed" : "email_failed", JSON.stringify({ by: actor.email, ...sendResult })]
          );
        });
        return res.status(200).json({ result: sendResult });
      }

      // send_sms — hard-gated: phone on file AND explicit consent.
      if (!data.invoice.client_phone || !data.invoice.sms_consent) {
        const skip = { sent: false, reason: "no_consent_or_phone" };
        await withTechcareAuth(uid, (client) =>
          client.query(
            "insert into techcare.invoice_events (invoice_id, event_type, channel, detail) values ($1, 'sms_skipped', 'sms', $2)",
            [invoiceId, JSON.stringify({ by: actor.email, ...skip })]
          )
        );
        return res.status(200).json({ result: skip });
      }
      const smsBody = buildInvoiceSmsBody(shortLink);
      const sendResult = await sendInvoiceSms({ to: data.invoice.client_phone, body: smsBody, invoiceId });
      await withTechcareAuth(uid, async (client) => {
        if (sendResult.sent) {
          await client.query(
            "update techcare.invoices set status = case when status = 'pending' then 'sent' else status end, sent_via = 'sms', sent_at = now() where id = $1",
            [invoiceId]
          );
        }
        await client.query(
          "insert into techcare.invoice_events (invoice_id, event_type, channel, detail) values ($1, $2, 'sms', $3)",
          [invoiceId, sendResult.sent ? "sms_sent" : "sms_failed", JSON.stringify({ by: actor.email, ...sendResult })]
        );
      });
      return res.status(200).json({ result: sendResult });
    }

    if (action === "mark_paid" || action === "void") {
      const invoiceId = body.invoiceId;
      if (!invoiceId) return res.status(400).json({ error: "Missing invoiceId." });

      let paymentMethod = null;
      if (action === "mark_paid") {
        paymentMethod = body.paymentMethod;
        if (!["e_transfer", "square_card", "cash"].includes(paymentMethod)) {
          return res.status(400).json({ error: "paymentMethod must be e_transfer, square_card, or cash." });
        }
        // Cash is recorded here only — this endpoint is core-staff-gated
        // (requireCoreStaff), so field contractors (index.html, no admin
        // access) can never mark an invoice paid or record a cash amount.
      }

      const newStatus = action === "mark_paid" ? "paid" : "void";
      const updated = await withTechcareAuth(uid, async (client) => {
        const { rows } = await client.query(
          `update techcare.invoices set
             status = $1,
             paid_at = case when $1 = 'paid' then now() else paid_at end,
             payment_method = case when $1 = 'paid' then $3 else payment_method end
             where id = $2 returning *`,
          [newStatus, invoiceId, paymentMethod]
        );
        if (rows[0]) {
          await client.query(
            "insert into techcare.invoice_events (invoice_id, event_type, detail) values ($1, $2, $3)",
            [
              invoiceId,
              action === "mark_paid" ? "marked_paid" : "voided",
              JSON.stringify({ by: actor.email, ...(paymentMethod ? { paymentMethod } : {}) }),
            ]
          );
        }
        return rows[0];
      });
      if (!updated) return res.status(404).json({ error: "No invoice with that id." });
      return res.status(200).json({ invoice: updated });
    }

    return res.status(400).json({ error: "Unknown action." });
  } catch (e) {
    if (e.httpStatus) return res.status(e.httpStatus).json({ error: e.message });
    console.error("api/admin/invoices error:", e);
    return res.status(500).json({ error: "Server error." });
  }
};
