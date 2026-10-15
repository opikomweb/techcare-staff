// Shared helper: verify the Supabase access token sent from the browser,
// then look up the matching contractor row in techcare.contractors.
// Uses techcare_app (server-side Postgres role) via DATABASE_URL — never
// the anon/service_role keys, which have zero grants on the techcare schema
// by design (see shared-supabase-standard.md). This is identity only:
// confirming who is logged in and that they're an active contractor. Job
// data itself lives in Airtable, not here.
const { Pool } = require("pg");

const SUPABASE_URL = "https://gyfuaynrqpfpdexbwyxs.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5ZnVheW5ycXBmcGRleGJ3eXhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzNDM1MDMsImV4cCI6MjA5OTkxOTUwM30.OpZgDkNPZu-KC3RQ8erZF6j7cvA-Gb3eUg-3zao0U4c";

// A newer `pg`/pg-connection-string release started treating a connection
// string's own `sslmode=require` as an alias for `verify-full`, which
// overrides the explicit `ssl: { rejectUnauthorized: false }` below and
// fails with SELF_SIGNED_CERT_IN_CHAIN against Supabase's pooler (it
// presents a chain Node doesn't have a root for). Stripping sslmode from
// the string leaves the explicit ssl object as the only source of truth.
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
function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error("NOT_CONFIGURED");
    }
    // Supabase's direct DB host (db.<ref>.supabase.co) is IPv6-only, which
    // Vercel's serverless runtime can't reach. DATABASE_URL must point at
    // the Supavisor pooler (aws-0-<region>.pooler.supabase.com:6543) with
    // username "<role>.<project-ref>". sslmode is stripped from the string
    // below; the explicit ssl option is now the only thing controlling TLS.
    pool = new Pool({
      connectionString: stripSslMode(process.env.DATABASE_URL),
      max: 3,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 8000,
    });
  }
  return pool;
}

// Runs `fn(client)` inside a transaction with request.jwt.claims set to the
// given uid, so techcare.* RLS policies (jobs_own, invoices_via_job, etc.)
// see the right auth.uid(). Mirrors api/_staffAuth.js's withStaffAuth, but
// against techcare_app/DATABASE_URL instead of staff_app/STAFF_DATABASE_URL.
async function withTechcareAuth(uid, fn) {
  const db = getPool();
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

async function verifyAndGetContractor(req) {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return { error: "No sign-in token.", status: 401 };

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return { error: "Sign-in expired, please sign in again.", status: 401 };
  const user = await userRes.json();
  const email = user.email;
  const uid = user.id;
  if (!email || !uid) return { error: "No email on account.", status: 401 };

  let db;
  try {
    db = getPool();
  } catch (e) {
    return { error: "Staff portal isn't fully connected yet — contact WilGlobo support to finish the database setup.", status: 503 };
  }

  // techcare_app has no BYPASSRLS (by design — see shared-supabase-standard.md),
  // so every query here is still filtered by RLS. The `contractor_self` policy
  // checks auth.uid(), which reads the request.jwt.claims GUC — normally set by
  // PostgREST per-request, but this is a raw server-side connection, so we set
  // it ourselves from the token we just verified above. set_config(..., true)
  // scopes it to this transaction only, so it can't leak to another request on
  // a reused pooled connection.
  const client = await db.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: uid, role: "authenticated" }),
    ]);

    // First sign-in claims the row Wilton created by hand (auth_user_id starts
    // null). RLS only allows this while the row is still unclaimed, and only
    // lets you claim it as your own uid — see the contractor_self_claim policy.
    await client.query(
      "update techcare.contractors set auth_user_id = $1 where lower(email) = lower($2) and auth_user_id is null",
      [uid, email]
    );

    const { rows } = await client.query(
      "select id, full_name, email, active, airtable_worker_id from techcare.contractors where auth_user_id = $1 limit 1",
      [uid]
    );
    await client.query("commit");

    if (rows.length === 0) return { error: "No contractor profile found for " + email + ". Ask WilGlobo support to add you.", status: 403 };
    if (!rows[0].active) return { error: "Your account is not active yet.", status: 403 };

    return { contractor: rows[0] };
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { verifyAndGetContractor, getPool, withTechcareAuth };
