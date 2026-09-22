const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { pool } = require("./_db");
const { getSiteById } = require("./_site-data");
const { getActivateCommand, getMachineCycles } = require("./_machine-command");

const TRIAL_SETTING_KEY = "homepage_free_trial_enabled";
const TRIAL_SITE_LIMITS_KEY = "free_trial_site_weekly_limits";

let schemaReady = false;
let schemaReadyPromise = null;
let cachedSiteMap = null;

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
    let body = {};
    try {
      body = event.body ? JSON.parse(event.body) : {};
    } catch (_) {
      return json({ ok: false, error: "bad_request" }, 400);
    }

    const action = String(body.action || "status").trim();
    if (action === "status") {
      return json({ ok: true, enabled: await withSchemaFallback(() => isTrialEnabled()) });
    }
    if (action === "site_status") {
      return json({ ok: true, ...(await withSchemaFallback(() => getTrialSiteStatus(body))) });
    }
    if (action === "session") {
      return json({ ok: true, ...(await withSchemaFallback(() => getTrialSession(body))) });
    }

    await ensureSchema();
    if (action === "claim") return json({ ok: true, ...(await claimTrial(body)) }, 201);
    if (action === "change_site") return json({ ok: true, ...(await changeTrialSite(body)) });
    if (action === "prepare_activation") return json({ ok: true, ...(await prepareTrialActivation(body)) });
    if (action === "complete_activation") return json({ ok: true, ...(await completeTrialActivation(body)) });
    if (action === "cancel_activation") return json({ ok: true, ...(await cancelTrialActivation(body)) });
    return json({ ok: false, error: "unknown_action" }, 400);
  } catch (error) {
    if (error instanceof TrialError) {
      return json({ ok: false, error: error.code, message: error.message }, error.statusCode);
    }
    console.error("[free-trial] fatal:", error?.stack || error);
    return json({ ok: false, error: "server_error", message: "The free trial could not be loaded." }, 500);
  }
};

class TrialError extends Error {
  constructor(message, statusCode = 400, code = "bad_request") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

async function ensureSchema() {
  if (schemaReady) return;
  if (!schemaReadyPromise) {
    schemaReadyPromise = prepareSchema().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  await schemaReadyPromise;
}

async function prepareSchema() {
  if (await hasCurrentSchema()) {
    schemaReady = true;
    return;
  }

  await pool.query(`
    create table if not exists app_settings (
      key text primary key,
      value jsonb not null,
      updated_at timestamptz not null default now()
    )
  `);
  await pool.query(`
    create table if not exists free_trial_claims (
      id bigserial primary key,
      browser_token_hash char(64) unique not null,
      site_id text not null,
      customer_email text,
      trial_token_hash char(64) unique,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      activated_at timestamptz,
      activation_machine_id text,
      activation_cycle_key text,
      activation_status text,
      activation_prepared_at timestamptz
    )
  `);
  await pool.query(`
    alter table free_trial_claims
      add column if not exists trial_token_hash char(64),
      add column if not exists customer_email text,
      add column if not exists updated_at timestamptz not null default now(),
      add column if not exists activated_at timestamptz,
      add column if not exists activation_machine_id text,
      add column if not exists activation_cycle_key text,
      add column if not exists activation_status text,
      add column if not exists activation_prepared_at timestamptz
  `);
  await pool.query(`alter table free_trial_claims alter column access_code drop not null`).catch((error) => {
    if (error?.code !== "42703") throw error;
  });
  await pool.query(`create unique index if not exists free_trial_claims_trial_token_idx on free_trial_claims(trial_token_hash) where trial_token_hash is not null`);
  await pool.query(`create index if not exists free_trial_claims_created_idx on free_trial_claims(created_at desc)`);
  schemaReady = true;
}

async function hasCurrentSchema() {
  try {
    const result = await pool.query(`
      select
        (select count(*) from (
          select key, value, updated_at from app_settings limit 0
        ) settings_shape) as settings_shape,
        (select count(*) from (
          select id, browser_token_hash, site_id, customer_email, trial_token_hash,
                 created_at, updated_at, activated_at, activation_machine_id,
                 activation_cycle_key, activation_status, activation_prepared_at
          from free_trial_claims
          limit 0
        ) claims_shape) as claims_shape,
        to_regclass('public.free_trial_claims_trial_token_idx') is not null as token_index_ready,
        to_regclass('public.free_trial_claims_created_idx') is not null as created_index_ready
    `);
    return Boolean(result.rows[0]?.token_index_ready && result.rows[0]?.created_index_ready);
  } catch (error) {
    if (isSchemaCompatibilityError(error)) return false;
    throw error;
  }
}

async function withSchemaFallback(operation) {
  try {
    return await operation();
  } catch (error) {
    if (!isSchemaCompatibilityError(error)) throw error;
    await ensureSchema();
    return operation();
  }
}

function isSchemaCompatibilityError(error) {
  return error?.code === "42P01" || error?.code === "42703";
}

async function isTrialEnabled(db = pool) {
  const result = await db.query(`select value from app_settings where key = $1 limit 1`, [TRIAL_SETTING_KEY]);
  if (!result.rows.length) return true;
  const value = result.rows[0].value;
  if (typeof value === "boolean") return value;
  return value?.enabled !== false;
}

async function claimTrial(body = {}) {
  const site = requireSite(body.siteId);
  const customerEmail = validateCustomerEmail(body.customerEmail);
  const browserToken = validateBrowserToken(body.browserToken);
  const browserTokenHash = hashToken(browserToken);
  const trialToken = crypto.randomBytes(32).toString("base64url");
  const trialTokenHash = hashToken(trialToken);
  const client = await pool.connect();

  try {
    await client.query("begin");
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [browserTokenHash]);
    await lockTrialSiteLimit(client, site.id);
    if (!(await isTrialEnabled(client))) {
      throw new TrialError("The free trial promotion is not available right now.", 409, "trial_disabled");
    }
    const existing = await client.query(`
      select id, activated_at
      from free_trial_claims
      where browser_token_hash = $1
      limit 1
      for update
    `, [browserTokenHash]);
    if (existing.rows.length) {
      const claim = existing.rows[0];
      if (claim.activated_at) {
        throw new TrialError("This free trial has already been used.", 409, "trial_used");
      }
      await assertTrialSiteAvailable(client, site.id, claim.id);
      await client.query(`
        update free_trial_claims
        set site_id = $2, trial_token_hash = $3, customer_email = $4, updated_at = now()
        where id = $1
      `, [claim.id, site.id, trialTokenHash, customerEmail]);
      await client.query("commit");
      return {
        trialToken,
        email: customerEmail,
        site: publicSite(site),
        activationUrl: "/trial-activate.html"
      };
    }
    await assertTrialSiteAvailable(client, site.id);

    await client.query(`
      insert into free_trial_claims
        (browser_token_hash, site_id, customer_email, trial_token_hash, created_at, updated_at)
      values ($1, $2, $3, $4, now(), now())
    `, [browserTokenHash, site.id, customerEmail, trialTokenHash]);
    await client.query("commit");
    return {
      trialToken,
      email: customerEmail,
      site: publicSite(site),
      activationUrl: "/trial-activate.html"
    };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    if (error?.code === "23505") {
      throw new TrialError("A free trial has already been claimed in this browser.", 409, "trial_already_claimed");
    }
    throw error;
  } finally {
    client.release();
  }
}

async function getTrialSession(body = {}) {
  const claim = await findTrial(body.trialToken);
  return trialSessionPayload(claim);
}

async function getTrialSiteStatus(body = {}) {
  const site = requireSite(body.siteId);
  const status = await trialSiteLimitStatus(pool, site.id);
  return {
    site: publicSite(site),
    limit: status.limit,
    used: status.used,
    remaining: status.remaining,
    limited: status.limited,
    available: status.available
  };
}

async function changeTrialSite(body = {}) {
  const site = requireSite(body.siteId);
  const tokenHash = validateTrialToken(body.trialToken);
  const client = await pool.connect();
  try {
    await client.query("begin");
    await lockTrialSiteLimit(client, site.id);
    const existing = await client.query(`
      select id, site_id, customer_email, created_at, activated_at,
             activation_machine_id, activation_cycle_key, activation_status, activation_prepared_at
      from free_trial_claims
      where trial_token_hash = $1
      limit 1
      for update
    `, [tokenHash]);
    const claim = existing.rows[0];
    if (!claim) throw new TrialError("This free trial is no longer available.", 404, "trial_not_found");
    if (claim.activated_at) throw new TrialError("This free trial has already been used.", 409, "trial_used");
    await assertTrialSiteAvailable(client, site.id, claim.id);
    const result = await client.query(`
      update free_trial_claims
      set site_id = $2, updated_at = now()
      where id = $1
       returning id, site_id, customer_email, created_at, activated_at,
                activation_machine_id, activation_cycle_key, activation_status, activation_prepared_at
    `, [claim.id, site.id]);
    await client.query("commit");
    return trialSessionPayload(result.rows[0]);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function prepareTrialActivation(body = {}) {
  const tokenHash = validateTrialToken(body.trialToken);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query(`
      select id, site_id, created_at, activated_at
      from free_trial_claims
      where trial_token_hash = $1
      limit 1
      for update
    `, [tokenHash]);
    const claim = result.rows[0];
    if (!claim) throw new TrialError("This free trial is no longer available.", 404, "trial_not_found");
    if (claim.activated_at) throw new TrialError("This free trial has already been used.", 409, "trial_used");
    await lockTrialSiteLimit(client, claim.site_id);
    await assertTrialSiteAvailable(client, claim.site_id);

    const entry = loadSiteMap()[claim.site_id];
    if (!entry || typeof entry !== "object") {
      throw new TrialError("This accommodation is not configured for activation.", 500, "site_not_configured");
    }
    const machine = findMachine(entry.machines, body.machineId);
    const cycleKey = String(body.cycleKey || "").trim();
    const activationCommand = machine ? getActivateCommand(machine, cycleKey) : "";
    if (!activationCommand) {
      throw new TrialError("Select a valid machine and cycle.", 400, "invalid_machine_or_cycle");
    }
    const prepared = await client.query(`
      update free_trial_claims
      set activation_machine_id = $2,
          activation_cycle_key = $3,
          activation_status = 'pending',
          activation_prepared_at = now(),
          updated_at = now()
      where id = $1
      returning activation_prepared_at
    `, [claim.id, machineKey(machine), cycleKey]);
    await client.query("commit");
    return {
      activationId: activationIdForClaim(claim.id),
      machineId: machineKey(machine),
      cycleKey,
      activationCommand,
      activationStatus: "pending",
      preparedAt: prepared.rows[0]?.activation_prepared_at || null,
      remaining: 1
    };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function completeTrialActivation(body = {}) {
  const tokenHash = validateTrialToken(body.trialToken);
  const requestedActivationId = String(body.activationId || "").trim();
  if (requestedActivationId) {
    const pending = await findTrial(body.trialToken);
    if (requestedActivationId !== activationIdForClaim(pending.id)) {
      throw new TrialError("This activation could not be confirmed.", 404, "activation_not_found");
    }
  }
  const result = await pool.query(`
    update free_trial_claims
    set activated_at = now(), activation_status = 'accepted', updated_at = now()
    where trial_token_hash = $1 and activated_at is null
    returning id, site_id, customer_email, created_at, activated_at,
              activation_machine_id, activation_cycle_key, activation_status, activation_prepared_at
  `, [tokenHash]);
  if (result.rows.length) return trialSessionPayload(result.rows[0]);

  const existing = await findTrial(body.trialToken);
  if (existing.activated_at) return trialSessionPayload(existing);
  throw new TrialError("This free trial could not be completed.", 409, "trial_unavailable");
}

async function cancelTrialActivation(body = {}) {
  const tokenHash = validateTrialToken(body.trialToken);
  const claim = await findTrial(body.trialToken);
  const requestedActivationId = String(body.activationId || "").trim();
  if (!requestedActivationId || requestedActivationId !== activationIdForClaim(claim.id)) {
    throw new TrialError("This activation could not be updated.", 404, "activation_not_found");
  }
  if (claim.activated_at) return trialSessionPayload(claim);
  const result = await pool.query(`
    update free_trial_claims
    set activation_status = 'unconfirmed', updated_at = now()
    where id = $1 and trial_token_hash = $2 and activated_at is null
    returning id, site_id, customer_email, created_at, activated_at,
              activation_machine_id, activation_cycle_key, activation_status, activation_prepared_at
  `, [claim.id, tokenHash]);
  if (!result.rows.length) throw new TrialError("This activation could not be updated.", 409, "trial_unavailable");
  return trialSessionPayload(result.rows[0]);
}

async function findTrial(rawToken) {
  const tokenHash = validateTrialToken(rawToken);
  const result = await pool.query(`
    select id, site_id, customer_email, created_at, activated_at,
           activation_machine_id, activation_cycle_key, activation_status, activation_prepared_at
    from free_trial_claims
    where trial_token_hash = $1
    limit 1
  `, [tokenHash]);
  if (!result.rows.length) throw new TrialError("This free trial is no longer available.", 404, "trial_not_found");
  return result.rows[0];
}

function trialSessionPayload(claim) {
  const site = requireSite(claim.site_id);
  const entry = loadSiteMap()[site.id];
  if (!entry || typeof entry !== "object") {
    throw new TrialError("This accommodation is not configured for activation.", 500, "site_not_configured");
  }
  const machines = sanitizeMachines(entry.machines);
  return {
    site: publicSite(site),
    email: String(claim.customer_email || "").trim().toLowerCase(),
    machines,
    used: Boolean(claim.activated_at),
    remaining: claim.activated_at ? 0 : 1,
    activatedAt: claim.activated_at || null,
    activation: publicActivation(claim, machines)
  };
}

function publicActivation(claim, machines) {
  const machineId = String(claim.activation_machine_id || "").trim();
  const cycleKey = String(claim.activation_cycle_key || "").trim();
  const machine = machines.find((item) => machineKey(item) === machineId) || null;
  const cycleValue = machine ? getMachineCycles(machine)[cycleKey] : "";
  const cycleLabel = typeof cycleValue === "string"
    ? cycleValue
    : String(cycleValue?.label || cycleKey || "").trim();
  const status = String(claim.activation_status || (claim.activated_at ? "accepted" : "")).trim();
  if (!status && !machineId && !claim.activated_at) return null;
  return {
    id: activationIdForClaim(claim.id),
    status: status || "accepted",
    machine: machine ? { id: machineKey(machine), name: machine.name, type: machine.type } : null,
    cycle: cycleKey ? { key: cycleKey, label: cycleLabel || cycleKey } : null,
    preparedAt: claim.activation_prepared_at || null,
    activatedAt: claim.activated_at || null
  };
}

function activationIdForClaim(id) {
  return `FT-${String(id || "").padStart(6, "0")}`;
}

function requireSite(rawSiteId) {
  const site = getSiteById(String(rawSiteId || "").trim());
  if (!site) throw new TrialError("Select a valid accommodation.", 400, "invalid_site");
  return site;
}

function publicSite(site) {
  return { id: site.id, name: site.name, address: site.address || "" };
}

async function getTrialSiteLimits(db = pool) {
  const result = await db.query(`select value from app_settings where key = $1 limit 1`, [TRIAL_SITE_LIMITS_KEY]);
  const value = result.rows[0]?.value;
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeTrialLimit(value) {
  const limit = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(limit) && limit >= 0 ? limit : null;
}

async function trialSiteLimitStatus(db, siteId, excludeClaimId = null) {
  const limits = await getTrialSiteLimits(db);
  const limit = normalizeTrialLimit(limits[siteId]);
  const countResult = await db.query(`
    select count(*)::int as used
    from free_trial_claims
    where site_id = $1
      and created_at >= date_trunc('week', now())
      and ($2::bigint is null or id <> $2::bigint)
  `, [siteId, excludeClaimId ? Number(excludeClaimId) : null]);
  const used = Number(countResult.rows[0]?.used || 0);
  const limited = limit !== null;
  const remaining = limited ? Math.max(0, limit - used) : null;
  return {
    limit,
    used,
    remaining,
    limited,
    available: !limited || used < limit
  };
}

async function assertTrialSiteAvailable(db, siteId, excludeClaimId = null) {
  const status = await trialSiteLimitStatus(db, siteId, excludeClaimId);
  if (!status.available) {
    throw new TrialError("Free trials are currently full for this site. Please try again later.", 409, "site_trial_limit_reached");
  }
  return status;
}

async function lockTrialSiteLimit(db, siteId) {
  await db.query(`select pg_advisory_xact_lock(hashtext($1))`, [`free_trial_site:${siteId}`]);
}

function validateBrowserToken(rawToken) {
  const token = String(rawToken || "").trim();
  if (!/^[A-Za-z0-9._:-]{16,200}$/.test(token)) {
    throw new TrialError("Refresh the page and try again.", 400, "invalid_browser_token");
  }
  return token;
}

function validateCustomerEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new TrialError("Enter a valid email address to continue.", 400, "invalid_email");
  }
  return email;
}

function validateTrialToken(rawToken) {
  const token = String(rawToken || "").trim();
  if (!/^[A-Za-z0-9_-]{32,100}$/.test(token)) {
    throw new TrialError("This free trial is no longer available.", 404, "trial_not_found");
  }
  return hashToken(token);
}

function hashToken(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function loadSiteMap() {
  if (cachedSiteMap) return cachedSiteMap;
  const candidatePaths = [
    path.join(process.cwd(), "netlify", "data", "access-config.json"),
    path.join(__dirname, "..", "data", "access-config.json"),
    "/var/task/netlify/data/access-config.json"
  ];
  for (const candidate of candidatePaths) {
    try {
      cachedSiteMap = JSON.parse(fs.readFileSync(candidate, "utf8"));
      return cachedSiteMap;
    } catch (_) {}
  }
  throw new Error("Activation configuration could not be loaded.");
}

function sanitizeMachines(machines) {
  return (Array.isArray(machines) ? machines : [])
    .filter((machine) => machine && typeof machine === "object")
    .map((machine) => {
      const type = String(machine.type || "").toLowerCase().trim();
      const cycles = machine.cycles && typeof machine.cycles === "object" && !Array.isArray(machine.cycles)
        ? Object.fromEntries(Object.entries(machine.cycles).map(([key, value]) => [String(key), String(value)]))
        : {};
      return {
        id: String(machine.id || "").trim(),
        name: String(machine.name || "").trim(),
        bluetoothName: String(machine.bluetoothName || "").trim(),
        type,
        cycles,
        hasPassword: Boolean(String(machine.password || "").trim())
      };
    })
    .filter((machine) => machine.id && machine.name && machine.bluetoothName && machine.hasPassword && ["washer", "dryer"].includes(machine.type))
    .map(({ hasPassword, ...machine }) => machine);
}

function machineKey(machine) {
  return String(machine?.id || machine?.name || "").trim();
}

function findMachine(machines, machineId) {
  const requestedId = String(machineId || "").trim();
  return (Array.isArray(machines) ? machines : []).find((machine) => machineKey(machine) === requestedId) || null;
}

function json(value, statusCode = 200) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate, private"
    },
    body: JSON.stringify(value)
  };
}

module.exports.isTrialEnabled = isTrialEnabled;
