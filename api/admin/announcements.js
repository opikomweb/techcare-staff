// Core staff's broadcast/communication tool: post a message to everyone on
// a project (or company-wide), optionally pinned to the top of the feed.
// Mirrors api/admin/resources.js's shape and security pattern exactly —
// same core-staff gate, same withStaffAuth + RLS, same audit log + rate
// limit. Staff read their visible announcements via GET /api/announcements.
//
// GET    /api/admin/announcements            -> list (newest/pinned first)
// POST   /api/admin/announcements             body: {project_id, title, body, pinned, emailNow}
// PUT    /api/admin/announcements              body: {id, ...fields to change}
// DELETE /api/admin/announcements?id=...
const { requireCoreStaff } = require("./_requireCoreStaff");
const { withStaffAuth } = require("../_staffAuth");
const { logAudit, rateLimited } = require("./_audit");
const { sendInvoiceEmail: sendEmail, sendInvoiceSms: sendSms, buildAnnouncementSmsBody } = require("./_invoiceChannels");

module.exports = async (req, res) => {
  try {
    const gate = await requireCoreStaff(req);
    if (gate.error) return res.status(gate.status || 400).json({ error: gate.error });
    const { uid, person: actor } = gate;

    if (req.method === "GET") {
      const announcements = await withStaffAuth(uid, async (client) => {
        const { rows } = await client.query(
          `select a.id, a.project_id, proj.slug as project_slug, a.title, a.body, a.pinned,
                  a.created_at, p.full_name as created_by_name
             from staff.announcements a
             left join staff.projects proj on proj.id = a.project_id
             left join staff.people p on p.id = a.created_by
            order by a.pinned desc, a.created_at desc`
        );
        return rows;
      });
      return res.status(200).json({ announcements });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      if (!body.title || !body.body) {
        return res.status(400).json({ error: "title and body are required." });
      }
      const { created, recipients } = await withStaffAuth(uid, async (client) => {
        const blocked = await rateLimited(client, actor.id, "admin.announcements.write", 20, 300);
        if (blocked) throw Object.assign(new Error("Too many changes in a short time — wait a few minutes and try again."), { httpStatus: 429 });

        const { rows } = await client.query(
          `insert into staff.announcements (project_id, title, body, pinned, created_by)
           values ($1, $2, $3, $4, $5)
           returning *`,
          [body.project_id || null, body.title, body.body, !!body.pinned, actor.id]
        );
        const row = rows[0];
        await logAudit(client, {
          actorPersonId: actor.id,
          actorEmail: actor.email,
          action: "announcements.create",
          entityType: "announcement",
          entityId: row.id,
          detail: { title: row.title, project_id: row.project_id },
        });

        let recipientRows = [];
        if (body.emailNow || body.smsNow) {
          const { rows: people } = await client.query(
            body.project_id
              ? `select distinct p.email, p.phone, p.full_name from staff.people p
                   join staff.project_roles pr on pr.person_id = p.id
                  where p.active and pr.project_id = $1 and pr.active and (p.email is not null or p.phone is not null)`
              : `select email, phone, full_name from staff.people where active and (email is not null or phone is not null)`,
            body.project_id ? [body.project_id] : []
          );
          recipientRows = people;
        }
        return { created: row, recipients: recipientRows };
      });

      let emailResult = null;
      if (body.emailNow && recipients.length) {
        const html = `<div style="font-family:sans-serif;max-width:520px">
          <h2 style="margin:0 0 4px">${escapeHtml(created.title)}</h2>
          <p style="color:#555;font-size:12px;margin:0 0 16px">WilGlobo TechCare — staff announcement</p>
          <div style="white-space:pre-wrap;font-size:15px;line-height:1.5">${escapeHtml(created.body)}</div>
          <p style="color:#888;font-size:12px;margin-top:24px">WilGlobo TechCare · tech@wilglobo.com</p>
        </div>`;
        const emailRecipients = recipients.filter((r) => r.email);
        const results = await Promise.all(
          emailRecipients.map((r) => sendEmail({ to: r.email, subject: "TechCare: " + created.title, html }))
        );
        const sentCount = results.filter((r) => r.sent).length;
        emailResult = { attempted: emailRecipients.length, sent: sentCount, configured: results.some((r) => r.reason !== "email_not_configured") || sentCount > 0 };
      }

      let smsResult = null;
      if (body.smsNow && recipients.length) {
        const smsBody = buildAnnouncementSmsBody(created.title, created.body);
        const smsRecipients = recipients.filter((r) => r.phone);
        const results = await Promise.all(
          smsRecipients.map((r) => sendSms({ to: r.phone, body: smsBody, invoiceId: null }))
        );
        const sentCount = results.filter((r) => r.sent).length;
        smsResult = { attempted: smsRecipients.length, sent: sentCount, configured: results.some((r) => r.reason !== "sms_not_configured") || sentCount > 0 };
      }

      return res.status(201).json({ announcement: created, email: emailResult, sms: smsResult });
    }

    if (req.method === "PUT") {
      const body = req.body || {};
      if (!body.id) return res.status(400).json({ error: "Missing id." });
      const EDITABLE = ["title", "body", "pinned", "project_id"];
      const fields = [];
      const values = [];
      let i = 1;
      for (const col of EDITABLE) {
        if (body[col] !== undefined) {
          fields.push(`${col} = $${i++}`);
          values.push(body[col]);
        }
      }
      if (fields.length === 0) return res.status(400).json({ error: "Nothing to update." });

      const updated = await withStaffAuth(uid, async (client) => {
        const blocked = await rateLimited(client, actor.id, "admin.announcements.write", 20, 300);
        if (blocked) throw Object.assign(new Error("Too many changes in a short time — wait a few minutes and try again."), { httpStatus: 429 });

        const { rows } = await client.query(
          `update staff.announcements set ${fields.join(", ")}, updated_at = now()
             where id = $${i}
             returning *`,
          [...values, body.id]
        );
        const row = rows[0];
        if (row) {
          await logAudit(client, {
            actorPersonId: actor.id,
            actorEmail: actor.email,
            action: "announcements.update",
            entityType: "announcement",
            entityId: row.id,
            detail: { changed: Object.keys(body).filter((k) => k !== "id") },
          });
        }
        return row;
      });
      if (!updated) return res.status(404).json({ error: "No announcement with that id." });
      return res.status(200).json({ announcement: updated });
    }

    if (req.method === "DELETE") {
      const id = (req.query && req.query.id) || null;
      if (!id) return res.status(400).json({ error: "Missing id." });
      const deleted = await withStaffAuth(uid, async (client) => {
        const blocked = await rateLimited(client, actor.id, "admin.announcements.write", 20, 300);
        if (blocked) throw Object.assign(new Error("Too many changes in a short time — wait a few minutes and try again."), { httpStatus: 429 });

        const { rows } = await client.query(`delete from staff.announcements where id = $1 returning id`, [id]);
        const row = rows[0];
        if (row) {
          await logAudit(client, {
            actorPersonId: actor.id,
            actorEmail: actor.email,
            action: "announcements.delete",
            entityType: "announcement",
            entityId: row.id,
          });
        }
        return row;
      });
      if (!deleted) return res.status(404).json({ error: "No announcement with that id." });
      return res.status(200).json({ deleted: true });
    }

    return res.status(405).json({ error: "Method not allowed." });
  } catch (e) {
    if (e.httpStatus) return res.status(e.httpStatus).json({ error: e.message });
    console.error("api/admin/announcements error:", e);
    return res.status(500).json({ error: "Server error." });
  }
};

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
