const assert = require("assert");
const { createPoolConfig, getDatabaseUrl, pool } = require("../netlify/functions/_db");

const directUrl = "postgresql://direct.example/db";
const pooledUrl = "postgresql://pooler.example/db";

assert.strictEqual(
  getDatabaseUrl({ DB_URL: directUrl, DB_URL_POOLED: pooledUrl }),
  pooledUrl,
  "serverless functions should prefer the Supabase pooler"
);
assert.strictEqual(
  getDatabaseUrl({ DB_URL: directUrl }),
  directUrl,
  "the direct Supabase URL should remain a fallback"
);
assert.strictEqual(
  getDatabaseUrl({ DATABASE_URL: "legacy", NETLIFY_DATABASE_URL: "legacy" }),
  "",
  "legacy Neon environment variables should not be used"
);

const config = createPoolConfig({ DB_URL_POOLED: pooledUrl });
assert.strictEqual(config.connectionString, pooledUrl);
assert.strictEqual(config.max, 1, "each warm serverless instance should use at most one connection");
assert.strictEqual(config.allowExitOnIdle, true);
assert.strictEqual(config.connectionTimeoutMillis, 10_000);
assert.deepStrictEqual(config.ssl, { rejectUnauthorized: false });

pool.end().then(() => console.log("Supabase database configuration tests passed"));
