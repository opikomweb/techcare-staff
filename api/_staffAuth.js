// Shared helper for the cross-project `staff` schema (identity + role
// routing across every WilGlobo project). This is deliberately separate
// from api/_auth.js (techcare.contractors) — that file and the existing
// "My jobs" flow are never touched by this, so they can't be broken by it.
//
// Same RLS shape and same reason for it as techcare_app: staff_app has no
// BYPASSRLS, so every query here sets request.jwt.claims itself (see
// api/_auth.js for the fuller explanation) before touching staff.people.
const { Pool } = require("pg");

const SUPABASE_URL = "https://gyfuaynrqpfpdexbwyxs.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5ZnVheW5ycXBmcGRleGJ3eXhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzNDM1MDMsImV4cCI6MjA5OTkxOTUwM30.OpZgDkNPZu-KC3RQ8erZF6j7cvA-Gb3eUg-3zao0U4c";

// A newer `pg`/pg-connection-string release started treating a connection
// string's own `sslmode=require` as an alias for `verify-full`, which
// overrides the explicit `ssl: { rejectUnauthorized: false }` below and
// made every connection fail with SELF_SIGNED_CERT_IN_CHAIN against
// Supabase's pooler (it presents a chain Node doesn't have a root for).
// Stripping sslmode from the string leaves the explicit ssl object as the
// only source of truth.
function stripSslMode(connectionString) {
  try {
    const u = new URL(connectionString);
    u.searchParams.delete("sslmode");
    return u.toString();
  } catch (e) {
    return connectionString;
  }
}

let pool;
function getStaffPool() {
  if (!pool) {
    if (!process.env.STAFF_DATABASE_URL) {
      throw new Error("NOT_CONFIGURED");
    }
    pool = new Pool({
      connectionString: stripSslMode(process.env.STAFF_DATABASE_URL),
      max: 3,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 8000,
    });
  }
  return pool;
}

async function verifyToken(req) {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return { error: "No sign-in token.", status: 401 };

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return { error: "Sign-in expired, please sign in again.", status: 401 };
  const user = await userRes.json();
  if (!user.email || !user.id) return { error: "No email on account.", status: 401 };
  return { email: user.email, uid: user.id };
}

// Runs `fn(client)` inside a transaction with request.jwt.claims set, so
// staff.* RLS policies see the right auth.uid(). Commits/rolls back and
// releases the client itself.
async function withStaffAuth(uid, fn) {
  const db = getStaffPool();
  const client = await db.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: uid, role: "authenticated" }),
    ]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function verifyAndGetPerson(req) {
  const v = await verifyToken(req);
  if (v.error) return v;
  const { email, uid } = v;

  let db;
  try {
    db = getStaffPool();
  } catch (e) {
    return { error: "Staff portal isn't fully connected yet — contact WilGlobo support to finish the database setup.", status: 503 };
  }

  try {
    const { person, roles } = await withStaffAuth(uid, async (client) => {
      // First sign-in claims the row Wilton created by hand, same self-claim
      // pattern as techcare.contractors (see people_self_claim policy).
      await client.query(
        "update staff.people set auth_user_id = $1 where lower(email) = lower($2) and auth_user_id is null",
        [uid, email]
      );
      const { rows } = await client.query(
        `select id, full_name, email, phone, is_core_staff, active,
                emergency_contact_name, emergency_contact_phone, emergency_contact_relationship
         from staff.people where auth_user_id = $1 limit 1`,
        [uid]
      );
      if (rows.length === 0) return { person: null, roles: [] };
      const person = rows[0];
      const { rows: roleRows } = await client.query(
        `select pr.engagement_track, pr.role_title, pr.active as role_active, p.slug, p.name
         from staff.project_roles pr
         join staff.projects p on p.id = pr.project_id
         where pr.person_id = $1`,
        [person.id]
      );
      return { person, roles: roleRows };
    });

    if (!person) return { error: "No staff profile found for " + email + ". Ask WilGlobo support to add you.", status: 403 };
    if (!person.active) return { error: "Your account is not active yet.", status: 403 };

    return { person, roles, uid };
  } catch (e) {
    throw e;
  }
}

module.exports = { verifyAndGetPerson, getStaffPool, withStaffAuth };
