// Shared gate for every /api/admin/* endpoint. Confirms the signed-in
// person exists, is active, and is_core_staff — otherwise 403. All the
// actual data access still goes through withStaffAuth so RLS (the
// *_write_by_core_staff policies) is the real enforcement; this is just
// the friendly early exit.
const { verifyAndGetPerson } = require("../_staffAuth");

async function requireCoreStaff(req) {
  const result = await verifyAndGetPerson(req);
  if (result.error) return result;
  if (!result.person.is_core_staff) {
    return { error: "Admin access only.", status: 403 };
  }
  return result;
}

module.exports = { requireCoreStaff };
