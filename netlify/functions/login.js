const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { pool } = require("./_db");
const { getActivateCommand, getMachineCycles } = require("./_machine-command");

let cachedSiteMap = null;
let cachedSiteIndex = null;
let cachedAddressIndex = null;
let usageSchemaReady = false;

function loadSiteMap() {
  if (cachedSiteMap) return cachedSiteMap;

  const candidatePaths = [
    path.join(process.cwd(), "netlify", "data", "access-config.json"),
    path.join(__dirname, "..", "data", "access-config.json"),
    "/var/task/netlify/data/access-config.json"
  ];

  let raw = null;
  let usedPath = null;

  for (const candidate of candidatePaths) {
    try {
      raw = fs.readFileSync(candidate, "utf8");
      usedPath = candidate;
      break;
    } catch (_) {
      // Try the next runtime path.
    }
  }

  if (!raw) {
    throw new Error(`Config file not found. Tried: ${candidatePaths.join(" | ")}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in ${usedPath}: ${error.message}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Config root must be an object keyed by site_id");
  }

  cachedSiteMap = parsed;
  return cachedSiteMap;
}

function getSiteIndex() {
  if (cachedSiteIndex) return cachedSiteIndex;

  cachedSiteIndex = Object.entries(loadSiteMap())
    .map(([id, value]) => {
      const name = String(value?.siteName || id);
      return {
        id,
        name,
        idSearch: id.toLowerCase(),
        nameSearch: name.toLowerCase()
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return cachedSiteIndex;
}

function searchSites(query, limit = 20) {
  const term = String(query || "").trim().toLowerCase();
  if (term.length < 2) return [];

  return getSiteIndex()
    .map((site) => {
      let score = 99;

      if (site.idSearch === term || site.nameSearch === term) score = 0;
      else if (site.nameSearch.startsWith(term)) score = 1;
      else if (site.idSearch.startsWith(term)) score = 2;
      else if (site.nameSearch.includes(term)) score = 3;
      else if (site.idSearch.includes(term)) score = 4;

      return { site, score };
    })
    .filter((entry) => entry.score < 99)
    .sort((a, b) => a.score - b.score || a.site.name.localeCompare(b.site.name))
    .slice(0, limit)
    .map(({ site }) => ({ id: site.id, name: site.name }));
}

function loadAddressIndex() {
  if (cachedAddressIndex) return cachedAddressIndex;

  const candidatePaths = [
    path.join(process.cwd(), "addresses.json"),
    path.join(process.cwd(), "netlify", "data", "addresses.json"),
    path.join(__dirname, "..", "data", "addresses.json"),
    path.join(__dirname, "..", "..", "addresses.json"),
    "/var/task/addresses.json",
    "/var/task/netlify/data/addresses.json"
  ];

  let raw = null;
  let usedPath = null;

  for (const candidate of candidatePaths) {
    try {
      raw = fs.readFileSync(candidate, "utf8");
      usedPath = candidate;
      break;
    } catch (_) {
      // Try the next runtime path.
    }
  }

  if (!raw) {
    throw new Error(`Addresses file not found. Tried: ${candidatePaths.join(" | ")}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in ${usedPath}: ${error.message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Addresses root must be an array");
  }

  const siteMap = loadSiteMap();

  cachedAddressIndex = parsed
    .map((entry) => {
      const id = String(entry?.site_id || "").trim();
      const name = String(entry?.site_name || id).trim();
      const address = String(entry?.address || "").trim();
      return {
        id,
        name,
        address,
        addressSearch: address.toLowerCase(),
        addressCompact: address.toLowerCase().replace(/[^a-z0-9]/g, "")
      };
    })
    .filter((site) => site.id && site.address && Object.prototype.hasOwnProperty.call(siteMap, site.id))
    .sort((a, b) => a.address.localeCompare(b.address));

  return cachedAddressIndex;
}

function searchAddresses(query, limit = 20) {
  const term = String(query || "").trim().toLowerCase();
  const compactTerm = term.replace(/[^a-z0-9]/g, "");
  if (term.length < 2) return [];

  return loadAddressIndex()
    .map((site) => {
      let score = 99;

      if (site.addressSearch === term) score = 0;
      else if (site.addressSearch.startsWith(term)) score = 1;
      else if (site.addressSearch.includes(term)) score = 2;
      else if (compactTerm.length >= 2 && site.addressCompact.includes(compactTerm)) score = 3;

      return { site, score };
    })
    .filter((entry) => entry.score < 99)
    .sort((a, b) => a.score - b.score || a.site.address.localeCompare(b.site.address))
    .slice(0, limit)
    .map(({ site }) => ({ id: site.id, name: site.name, address: site.address }));
}

function sanitizeMachines(machines) {
  return (Array.isArray(machines) ? machines : [])
    .filter((machine) => machine && typeof machine === "object")
    .map((machine) => {
      const type = String(machine.type || "").toLowerCase().trim();
      const id = String(machine.id || "").trim();
      const name = String(machine.name || "").trim();
      const bluetoothName = String(machine.bluetoothName || "").trim();
      const hasPassword = Boolean(String(machine.password || "").trim());

      let cycles = {};
      if (
        machine.cycles &&
        typeof machine.cycles === "object" &&
        !Array.isArray(machine.cycles)
      ) {
        cycles = Object.fromEntries(
          Object.entries(machine.cycles).map(([key, value]) => [
            String(key),
            String(value)
          ])
        );
      }

      return { id, name, bluetoothName, type, cycles, hasPassword };
    })
    .filter(
      (machine) =>
        machine.id &&
        machine.name &&
        machine.bluetoothName &&
        machine.hasPassword &&
        (machine.type === "washer" || machine.type === "dryer")
    )
    .map(({ hasPassword, ...machine }) => machine);
}

function getMachineKey(machine) {
  return String(machine?.id || machine?.name || "").trim();
}

function findMachineForActivation(machines, machineId) {
  const requestedId = String(machineId || "").trim();
  if (!requestedId) return null;

  return (Array.isArray(machines) ? machines : [])
    .filter((machine) => machine && typeof machine === "object")
    .find((machine) => getMachineKey(machine) === requestedId) || null;
}

function getWeekStartUTC(date = new Date()) {
  const value = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  const day = value.getUTCDay();
  value.setUTCDate(value.getUTCDate() - ((day + 6) % 7));
  return value.toISOString().slice(0, 10);
}

function safeTextEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function isAdminCode(code) {
  const configured = String(process.env.ADMIN_ACCESS_CODE || "").trim();
  return Boolean(configured) && safeTextEqual(String(code || "").trim(), configured);
}

function validNewCode(code) {
  return code.length >= 1 && code.length <= 64;
}

async function ensureUsageSchema() {
  if (usageSchemaReady) return;
  await pool.query(`
    create table if not exists access_codes (
      code text primary key,
      site_id text not null,
      active boolean not null default true,
      weekly_limit integer not null default 4,
      expires_at timestamptz,
      created_at timestamptz not null default now(),
      max_total_uses integer,
      delete_after_use boolean not null default false,
      deleted_at timestamptz,
      source text
    )
  `);
  await pool.query(`
    alter table access_codes
      add column if not exists weekly_limit integer not null default 4,
      add column if not exists expires_at timestamptz,
      add column if not exists created_at timestamptz not null default now(),
      add column if not exists max_total_uses integer,
      add column if not exists delete_after_use boolean not null default false,
      add column if not exists deleted_at timestamptz,
      add column if not exists source text
  `);
  await pool.query(`
    update access_codes
    set expires_at = created_at + interval '1 year'
    where expires_at is null and source = 'payment'
  `);
  await pool.query(`
    create table if not exists code_usage_weekly (
      code text not null references access_codes(code) on delete cascade,
      week_start date not null,
      login_count integer not null default 0,
      first_used_at timestamptz,
      last_used_at timestamptz,
      primary key (code, week_start)
    )
  `);
  await pool.query(`
    alter table code_usage_weekly
      add column if not exists first_used_at timestamptz,
      add column if not exists reset_count integer not null default 0
  `);
  await pool.query(`
    create table if not exists code_activation_history (
      id bigserial primary key,
      code text not null references access_codes(code) on delete cascade,
      site_id text not null,
      machine_id text not null,
      machine_name text not null,
      machine_type text,
      cycle_key text not null,
      cycle_label text not null,
      recorded_at timestamptz not null default now()
    )
  `);
  await pool.query(`create index if not exists code_activation_history_code_recorded_idx on code_activation_history(code, recorded_at desc)`);
  await pool.query(`
    create table if not exists code_activation_attempts (
      activation_id text primary key,
      code text not null references access_codes(code) on delete cascade,
      site_id text not null,
      machine_id text not null,
      cycle_key text not null,
      status text not null default 'pending',
      prepared_at timestamptz not null default now(),
      completed_at timestamptz,
      cancelled_at timestamptz,
      cancel_reason text
    )
  `);
  await pool.query(`create index if not exists code_activation_attempts_code_prepared_idx on code_activation_attempts(code, prepared_at desc)`);
  await pool.query(`
    create table if not exists activation_upgrade_orders (
      order_id text primary key,
      stripe_session_id text unique,
      access_code text not null references access_codes(code) on delete cascade,
      bonus_activations integer not null default 3,
      amount numeric(10, 2) not null default 10,
      currency varchar(3) not null default 'GBP',
      status text not null default 'CREATED',
      week_start date,
      created_at timestamptz not null default now(),
      completed_at timestamptz
    )
  `);
  await pool.query(`alter table activation_upgrade_orders alter column bonus_activations set default 3`);
  await pool.query(`create index if not exists activation_upgrade_code_week_idx on activation_upgrade_orders(access_code, week_start, status)`);
  usageSchemaReady = true;
}

function getNextWeekStartUTC(date = new Date()) {
  const current = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = current.getUTCDay();
  const daysUntilMonday = (8 - day) % 7 || 7;
  current.setUTCDate(current.getUTCDate() + daysUntilMonday);
  return current.toISOString();
}

async function getWeeklyUsage(code, weeklyLimit, maxTotalUses = null, db = pool) {
  const weekStart = getWeekStartUTC();
  const bonus = await getActivationUpgradeBonus(code, weekStart, db);
  const { rows } = await db.query(
    `
      select
        coalesce(sum(login_count), 0)::int as total_uses,
        coalesce(sum(greatest(login_count - coalesce(reset_count, 0), 0)) filter (where week_start = $2::date), 0)::int as weekly_uses,
        max(last_used_at) as last_used_at
      from code_usage_weekly
      where code = $1
    `,
    [code, weekStart]
  );
  const used = Number(rows[0]?.weekly_uses || 0);
  const totalUsed = Number(rows[0]?.total_uses || 0);
  const baseLimit = Number.isInteger(Number(weeklyLimit)) && Number(weeklyLimit) > 0 ? Number(weeklyLimit) : 4;
  const limit = baseLimit + bonus;
  const totalLimit = Number.isInteger(Number(maxTotalUses)) && Number(maxTotalUses) > 0 ? Number(maxTotalUses) : null;
  const weeklyRemaining = Math.max(0, limit - used);
  const totalRemaining = totalLimit ? Math.max(0, totalLimit - totalUsed) : weeklyRemaining;
  return {
    used,
    limit,
    baseLimit,
    bonus,
    totalUsed,
    totalLimit,
    remaining: Math.min(weeklyRemaining, totalRemaining),
    resetAt: getNextWeekStartUTC(),
    lastUsedAt: rows[0]?.last_used_at || null
  };
}

async function consumeWeeklyUsage(code, weeklyLimit, maxTotalUses = null, deleteAfterUse = false, db = pool) {
  const weekStart = getWeekStartUTC();
  const baseLimit = Number.isInteger(Number(weeklyLimit)) && Number(weeklyLimit) > 0 ? Number(weeklyLimit) : 4;
  const bonus = await getActivationUpgradeBonus(code, weekStart, db);
  const limit = baseLimit + bonus;
  const totalLimit = Number.isInteger(Number(maxTotalUses)) && Number(maxTotalUses) > 0
    ? Number(maxTotalUses)
    : (deleteAfterUse ? 1 : null);
  if (totalLimit) {
    const current = await getWeeklyUsage(code, baseLimit, totalLimit, db);
    if (Number(current.totalUsed || 0) >= totalLimit) return { allowed: false, ...current };
  }
  const { rows } = await db.query(
    `
      insert into code_usage_weekly (code, week_start, login_count, first_used_at, last_used_at)
      values ($1, $2::date, 1, now(), now())
      on conflict (code, week_start)
      do update set
        first_used_at = coalesce(code_usage_weekly.first_used_at, code_usage_weekly.last_used_at, now()),
        login_count = code_usage_weekly.login_count + 1,
        last_used_at = now()
      where greatest(code_usage_weekly.login_count - coalesce(code_usage_weekly.reset_count, 0), 0) < $3
      returning login_count, last_used_at
    `,
    [code, weekStart, limit]
  );
  if (!rows[0]) {
    const usage = await getWeeklyUsage(code, baseLimit, totalLimit, db);
    return { allowed: false, ...usage };
  }
  const usage = await getWeeklyUsage(code, baseLimit, totalLimit, db);
  if (deleteAfterUse && Number(usage.totalUsed || 0) >= Number(totalLimit || 1)) {
    await db.query(
      `update access_codes set active = false, deleted_at = coalesce(deleted_at, now()) where code = $1`,
      [code]
    );
  }
  return {
    allowed: true,
    ...usage,
    used: Number(usage.used || 0),
    limit,
    baseLimit,
    bonus,
    resetAt: getNextWeekStartUTC(),
    lastUsedAt: rows[0].last_used_at || null
  };
}

async function getActivationUpgradeBonus(code, weekStart = getWeekStartUTC(), db = pool) {
  const { rows } = await db.query(
    `
      select coalesce(sum(bonus_activations), 0)::int as bonus
      from activation_upgrade_orders
      where access_code = $1
        and week_start = $2::date
        and status = 'COMPLETED'
    `,
    [code, weekStart]
  );
  return Number(rows[0]?.bonus || 0);
}

async function consumeAndRecordActivation({
  code,
  siteId,
  machine,
  cycleKey,
  weeklyLimit,
  maxTotalUses = null,
  deleteAfterUse = false
}) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const usage = await consumeWeeklyUsage(code, weeklyLimit, maxTotalUses, deleteAfterUse, client);
    if (usage.allowed !== false) {
      await recordActivationHistory(client, { code, siteId, machine, cycleKey });
    }
    await client.query("commit");
    return usage;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function recordActivationHistory(db, { code, siteId, machine, cycleKey }) {
  const key = String(cycleKey || "").trim();
  const cycle = getMachineCycles(machine)[key];
  const cycleLabel = typeof cycle === "string"
    ? cycle
    : String(cycle?.label || key || "Cycle").trim();
  const result = await db.query(
    `
      insert into code_activation_history
        (code, site_id, machine_id, machine_name, machine_type, cycle_key, cycle_label, recorded_at)
      values ($1, $2, $3, $4, $5, $6, $7, now())
      returning id, recorded_at
    `,
    [
      code,
      siteId,
      getMachineKey(machine),
      String(machine?.name || getMachineKey(machine)),
      String(machine?.type || ""),
      key,
      cycleLabel || key
    ]
  );
  return result.rows[0] || null;
}

async function createActivationAttempt({ code, siteId, machine, cycleKey }) {
  const activationId = crypto.randomUUID();
  await pool.query(
    `
      insert into code_activation_attempts
        (activation_id, code, site_id, machine_id, cycle_key, status, prepared_at)
      values ($1, $2, $3, $4, $5, 'pending', now())
    `,
    [activationId, code, siteId, getMachineKey(machine), String(cycleKey || "").trim()]
  );
  return activationId;
}

async function cancelActivationAttempt({ activationId, code, reason }) {
  const result = await pool.query(
    `
      update code_activation_attempts
      set status = 'cancelled', cancelled_at = now(), cancel_reason = $3
      where activation_id = $1 and code = $2 and status = 'pending'
      returning activation_id
    `,
    [activationId, code, String(reason || "unconfirmed").slice(0, 120)]
  );
  return Boolean(result.rows[0]);
}

async function completeActivationAttempt({
  activationId,
  code,
  weeklyLimit,
  maxTotalUses,
  deleteAfterUse
}) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const attemptResult = await client.query(
      `
        select activation_id, site_id, machine_id, cycle_key, status
        from code_activation_attempts
        where activation_id = $1 and code = $2
        limit 1
        for update
      `,
      [activationId, code]
    );
    const attempt = attemptResult.rows[0];
    if (!attempt) {
      await client.query("rollback");
      return { error: "activation_not_found", statusCode: 404 };
    }
    if (attempt.status === "completed") {
      const usage = await getWeeklyUsage(code, weeklyLimit, maxTotalUses || (deleteAfterUse ? 1 : null), client);
      await client.query("commit");
      return { ...usage, allowed: true, activationId, alreadyCompleted: true };
    }
    if (attempt.status !== "pending") {
      await client.query("rollback");
      return { error: "activation_not_pending", statusCode: 409 };
    }

    const entry = loadSiteMap()[attempt.site_id];
    const machine = entry ? findMachineForActivation(entry.machines, attempt.machine_id) : null;
    if (!machine || !getActivateCommand(machine, attempt.cycle_key)) {
      await client.query("rollback");
      return { error: "invalid_machine_or_cycle", statusCode: 400 };
    }

    const usage = await consumeWeeklyUsage(code, weeklyLimit, maxTotalUses, deleteAfterUse, client);
    if (usage.allowed === false) {
      await client.query("rollback");
      return { error: "weekly_limit_reached", statusCode: 429, ...usage };
    }
    await recordActivationHistory(client, {
      code,
      siteId: attempt.site_id,
      machine,
      cycleKey: attempt.cycle_key
    });
    await client.query(
      `update code_activation_attempts set status = 'completed', completed_at = now() where activation_id = $1`,
      [activationId]
    );
    await client.query("commit");
    return { ...usage, allowed: true, activationId, alreadyCompleted: false };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function isExpired(mapping) {
  if (!mapping?.expires_at) return false;
  const expiry = new Date(mapping.expires_at);
  return !Number.isNaN(expiry.getTime()) && expiry.getTime() <= Date.now();
}

async function findAccessCode(code) {
  const query = `
    select code, site_id, active, weekly_limit, max_total_uses, delete_after_use, expires_at
    from access_codes
    where code = $1
      and deleted_at is null
    limit 1
  `;
  const { rows } = await pool.query(query, [code]);
  return rows[0] || null;
}

async function findAccessCodeForCompletedAttempt(code, activationId) {
  if (!activationId) return null;
  const { rows } = await pool.query(
    `
      select ac.code, ac.site_id, ac.active, ac.weekly_limit, ac.max_total_uses,
             ac.delete_after_use, ac.expires_at
      from access_codes ac
      join code_activation_attempts caa on caa.code = ac.code
      where ac.code = $1 and caa.activation_id = $2 and caa.status = 'completed'
      limit 1
    `,
    [code, activationId]
  );
  return rows[0] || null;
}

async function addAccessCode(code, siteId) {
  const query = `
    insert into access_codes (code, site_id, active, weekly_limit)
    values ($1, $2, true, 4)
    on conflict (code) do nothing
    returning code
  `;
  const { rows } = await pool.query(query, [code, siteId]);
  return Boolean(rows[0]);
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return text("Method Not Allowed", 405);
    }

    let body = {};
    try {
      body = event.body ? JSON.parse(event.body) : {};
    } catch (_) {
      return json({ ok: false, error: "bad_request" }, 400);
    }

    const action = String(body.action || "login").trim();

    if (action === "search_sites") {
      const adminCode = String(body.adminCode || "").trim();
      const query = String(body.query || "").trim();
      const searchMode = body.searchMode === "address" ? "address" : "config";

      if (!isAdminCode(adminCode)) {
        return json({ ok: false, error: "unauthorized" }, 401);
      }

      if (query.length < 2 || query.length > 100) {
        return json({ ok: false, error: "invalid_query" }, 400);
      }

      const sites = searchMode === "address"
        ? searchAddresses(query)
        : searchSites(query);

      return json({ ok: true, searchMode, sites }, 200);
    }

    if (action === "add_access_code") {
      await ensureUsageSchema();
      const adminCode = String(body.adminCode || "").trim();
      const newCode = String(body.code || "").trim();
      const siteId = String(body.siteId || "").trim();
      const siteMap = loadSiteMap();

      if (!isAdminCode(adminCode)) {
        return json({ ok: false, error: "unauthorized" }, 401);
      }

      if (!validNewCode(newCode) || isAdminCode(newCode)) {
        return json({ ok: false, error: "invalid_code" }, 400);
      }

      if (!Object.prototype.hasOwnProperty.call(siteMap, siteId)) {
        return json({ ok: false, error: "invalid_site" }, 400);
      }

      const inserted = await addAccessCode(newCode, siteId);
      if (!inserted) {
        return json({ ok: false, error: "code_exists" }, 409);
      }

      return json({ ok: true, code: newCode, siteId }, 201);
    }

    const code = String(body.code || "").trim();
    if (!code) {
      return json({ ok: false, error: "missing_code" }, 400);
    }

    await ensureUsageSchema();
    const completionActivationId = action === "complete_activation" ? String(body.activationId || "").trim() : "";
    let mapping = await findAccessCode(code);
    const completedAttemptRetry = (!mapping || mapping.active !== true) && completionActivationId
      ? await findAccessCodeForCompletedAttempt(code, completionActivationId)
      : null;
    if (completedAttemptRetry) mapping = completedAttemptRetry;
    if (!mapping || (mapping.active !== true && !completedAttemptRetry)) {
      return json({ ok: false, error: "unknown_code" }, 404);
    }
    if (!completedAttemptRetry && isExpired(mapping)) {
      return json({ ok: false, error: "expired_code", expiresAt: mapping.expires_at }, 410);
    }

    const weeklyLimit = Number(mapping.weekly_limit || 4);
    const maxTotalUses = Number(mapping.max_total_uses || 0) || null;
    const deleteAfterUse = Boolean(mapping.delete_after_use);
    if (action === "change_site") {
      const siteId = String(body.siteId || "").trim();
      const siteMap = loadSiteMap();
      const entry = siteMap[siteId];
      if (!entry || typeof entry !== "object") {
        return json({ ok: false, error: "invalid_site" }, 400);
      }
      await pool.query(`
        update access_codes
        set site_id = $2
        where code = $1 and active = true and deleted_at is null
      `, [code, siteId]);
      const usage = await getWeeklyUsage(code, weeklyLimit, maxTotalUses || (deleteAfterUse ? 1 : null));
      return json({
        ok: true,
        activationProtocol: "deferred_v1",
        siteId,
        siteName: String(entry.siteName || "Site"),
        machines: sanitizeMachines(entry.machines),
        weeklyLimit: usage.limit,
        weeklyBaseLimit: usage.baseLimit,
        weeklyBonus: usage.bonus,
        weeklyUsed: usage.used,
        weeklyRemaining: usage.remaining,
        weeklyResetAt: usage.resetAt,
        totalUsed: usage.totalUsed,
        totalLimit: usage.totalLimit,
        deleteAfterUse
      }, 200);
    }
    if (action === "usage_status") {
      const usage = await getWeeklyUsage(code, weeklyLimit, maxTotalUses || (deleteAfterUse ? 1 : null));
      return json({ ok: true, ...usage, deleteAfterUse }, 200);
    }

    if (action === "consume_usage" || action === "increment_usage") {
      const usage = await consumeWeeklyUsage(code, weeklyLimit, maxTotalUses, deleteAfterUse);
      if (usage.allowed === false) {
        return json({ ok: false, error: "weekly_limit_reached", ...usage }, 429);
      }
      return json({ ok: true, ...usage }, 200);
    }

    if (action === "cancel_activation") {
      const activationId = String(body.activationId || "").trim();
      if (!activationId) return json({ ok: false, error: "missing_activation_id" }, 400);
      await cancelActivationAttempt({ activationId, code, reason: body.reason });
      const usage = await getWeeklyUsage(code, weeklyLimit, maxTotalUses || (deleteAfterUse ? 1 : null));
      return json({ ok: true, ...usage, deleteAfterUse }, 200);
    }

    if (action === "complete_activation") {
      const activationId = String(body.activationId || "").trim();
      if (body.requireUsageRecord === true && !activationId) {
        return json({ ok: false, error: "missing_activation_id" }, 400);
      }
      if (activationId) {
        const result = await completeActivationAttempt({
          activationId,
          code,
          weeklyLimit,
          maxTotalUses,
          deleteAfterUse
        });
        if (result.error) return json({ ok: false, ...result, deleteAfterUse }, result.statusCode || 400);
        return json({ ok: true, ...result, deleteAfterUse }, 200);
      }
      if (!deleteAfterUse) {
        const usage = await getWeeklyUsage(code, weeklyLimit, maxTotalUses);
        return json({ ok: true, ...usage, deleteAfterUse }, 200);
      }
      const entry = loadSiteMap()[mapping.site_id];
      const machineId = String(body.machineId || "").trim();
      const cycleKey = String(body.cycleKey || "").trim();
      const machine = entry && machineId ? findMachineForActivation(entry.machines, machineId) : null;
      const usage = machine && getActivateCommand(machine, cycleKey)
        ? await consumeAndRecordActivation({
            code,
            siteId: mapping.site_id,
            machine,
            cycleKey,
            weeklyLimit,
            maxTotalUses,
            deleteAfterUse
          })
        : await consumeWeeklyUsage(code, weeklyLimit, maxTotalUses, deleteAfterUse);
      if (!usage.allowed) {
        return json({ ok: false, error: "weekly_limit_reached", ...usage, deleteAfterUse }, 429);
      }
      return json({ ok: true, ...usage, deleteAfterUse }, 200);
    }

    if (action === "prepare_activation") {
      const siteMap = loadSiteMap();
      const entry = siteMap[mapping.site_id];
      const machineId = String(body.machineId || "").trim();
      const cycleKey = String(body.cycleKey || "").trim();

      if (!entry || typeof entry !== "object") {
        console.error(`[login] site_id not found in access-config.json: ${mapping.site_id}`);
        return json({ ok: false, error: "site_not_configured" }, 500);
      }

      const machine = findMachineForActivation(entry.machines, machineId);
      const activationCommand = machine ? getActivateCommand(machine, cycleKey) : "";

      if (!activationCommand) {
        return json({ ok: false, error: "invalid_machine_or_cycle" }, 400);
      }

      const deferredUsage = body.deferUsage === true;
      const usage = deferredUsage || deleteAfterUse
        ? await getWeeklyUsage(code, weeklyLimit, maxTotalUses || (deleteAfterUse ? 1 : null))
        : await consumeAndRecordActivation({
            code,
            siteId: mapping.site_id,
            machine,
            cycleKey,
            weeklyLimit,
            maxTotalUses,
            deleteAfterUse: false
          });
      if (usage.allowed === false) {
        return json({ ok: false, error: "weekly_limit_reached", ...usage }, 429);
      }
      if (deleteAfterUse && Number(usage.remaining || 0) <= 0) {
        return json({ ok: false, error: "weekly_limit_reached", ...usage, deleteAfterUse }, 429);
      }
      if (deferredUsage && Number(usage.remaining || 0) <= 0) {
        return json({ ok: false, error: "weekly_limit_reached", ...usage, deleteAfterUse }, 429);
      }

      const activationId = deferredUsage
        ? await createActivationAttempt({
            code,
            siteId: mapping.site_id,
            machine,
            cycleKey
          })
        : "";

      return json({
        ok: true,
        activationId,
        machineId: getMachineKey(machine),
        cycleKey,
        activationCommand,
        limit: usage.limit,
        baseLimit: usage.baseLimit,
        bonus: usage.bonus,
        used: usage.used,
        remaining: usage.remaining,
        resetAt: usage.resetAt,
        totalUsed: usage.totalUsed,
        totalLimit: usage.totalLimit,
        deleteAfterUse
      }, 200);
    }

    const usage = await getWeeklyUsage(code, weeklyLimit, maxTotalUses || (deleteAfterUse ? 1 : null));
    const siteMap = loadSiteMap();
    const entry = siteMap[mapping.site_id];

    if (!entry || typeof entry !== "object") {
      console.error(`[login] site_id not found in access-config.json: ${mapping.site_id}`);
      return json({ ok: false, error: "site_not_configured" }, 500);
    }

    return json(
      {
        ok: true,
        activationProtocol: "deferred_v1",
        siteId: mapping.site_id,
        siteName: String(entry.siteName || "Site"),
        machines: sanitizeMachines(entry.machines),
        expiresAt: mapping.expires_at || null,
        weeklyLimit: usage.limit,
        weeklyBaseLimit: usage.baseLimit,
        weeklyBonus: usage.bonus,
        weeklyUsed: usage.used,
        weeklyRemaining: usage.remaining,
        weeklyResetAt: usage.resetAt,
        totalUsed: usage.totalUsed,
        totalLimit: usage.totalLimit,
        deleteAfterUse
      },
      200
    );
  } catch (error) {
    console.error("[login] fatal:", error?.stack || error);
    return text("Server error", 500);
  }
};

function json(value, statusCode = 200) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate, private",
      "Pragma": "no-cache",
      "Expires": "0"
    },
    body: JSON.stringify(value)
  };
}

function text(body, statusCode = 200) {
  return {
    statusCode,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate, private",
      "Pragma": "no-cache",
      "Expires": "0"
    },
    body
  };
}
