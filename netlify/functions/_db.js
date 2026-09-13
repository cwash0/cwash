const { Pool } = require("pg");

function getDatabaseUrl(env = process.env) {
  return String(env.DB_URL_POOLED || "").trim() || String(env.DB_URL || "").trim();
}

function createPoolConfig(env = process.env) {
  return {
    // Netlify is serverless, so use Supabase's transaction pooler whenever it is configured.
    connectionString: getDatabaseUrl(env) || undefined,
    application_name: "circuitwash-netlify",
    ssl: { rejectUnauthorized: false },
    max: 1,
    min: 0,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
    keepAlive: true,
    allowExitOnIdle: true
  };
}

const databaseUrl = getDatabaseUrl();
const pool = new Pool(createPoolConfig());

// Prevent an idle socket error from becoming an uncaught process error. The pool
// removes failed idle clients and opens a replacement lazily on the next query.
pool.on("error", (error) => {
  console.error("[database] Idle Supabase connection failed", error);
});

module.exports = {
  createPoolConfig,
  databaseUrl,
  getDatabaseUrl,
  pool
};
