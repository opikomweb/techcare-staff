// GET /api/contact  -> current contact + emergency-contact info
// POST /api/contact -> self-service edit of phone + emergency contact.
// Relies on the people_self_update_contact RLS policy (auth_user_id =
// auth.uid() on both sides), so this can never touch anyone else's row.
const { verifyAndGetPerson, withStaffAuth } = require("./_staffAuth");

module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const result = await verifyAndGetPerson(req);
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    const { person, uid } = result;

    if (req.method === "GET") {
      return res.status(200).json({
        phone: person.phone,
        emergencyContact: {
          name: person.emergency_contact_name,
          phone: person.emergency_contact_phone,
          relationship: person.emergency_contact_relationship,
        },
      });
    }

    // POST — body: { phone, emergencyContactName, emergencyContactPhone, emergencyContactRelationship }
    const body = req.body || {};
    const phone = typeof body.phone === "string" ? body.phone.trim() : person.phone;
    const ecName = typeof body.emergencyContactName === "string" ? body.emergencyContactName.trim() : person.emergency_contact_name;
    const ecPhone = typeof body.emergencyContactPhone === "string" ? body.emergencyContactPhone.trim() : person.emergency_contact_phone;
    const ecRel = typeof body.emergencyContactRelationship === "string" ? body.emergencyContactRelationship.trim() : person.emergency_contact_relationship;

    const updated = await withStaffAuth(uid, async (client) => {
      const { rows } = await client.query(
        `update staff.people
           set phone = $1,
               emergency_contact_name = $2,
               emergency_contact_phone = $3,
               emergency_contact_relationship = $4,
               updated_at = now()
         where auth_user_id = $5
         returning phone, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship`,
        [phone || null, ecName || null, ecPhone || null, ecRel || null, uid]
      );
      return rows[0];
    });

    if (!updated) {
      return res.status(500).json({ error: "Nothing was saved. Try again." });
    }

    return res.status(200).json({
      phone: updated.phone,
      emergencyContact: {
        name: updated.emergency_contact_name,
        phone: updated.emergency_contact_phone,
        relationship: updated.emergency_contact_relationship,
      },
    });
  } catch (e) {
    console.error("api/contact error:", e);
    return res.status(500).json({ error: "Server error." });
  }
};
