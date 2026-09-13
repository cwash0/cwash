const crypto = require("crypto");
const { pool } = require("./_db");
const { getSiteById } = require("./_site-data");
const { normalizeAnalyticsEnvironment, validateAnalyticsSite } = require("./_analytics-validity");

const HIT_SALT = String(
  process.env.SITE_HIT_SALT ||
  process.env.CREATE_ORDER_RATE_LIMIT_SALT ||
  process.env.PUBLIC_SITE_URL ||
  "laundry-site-hit"
);
const HIT_RATE_LIMIT = clampInt(process.env.SITE_HIT_RATE_LIMIT || "30", 5, 300, 30);
const HIT_DEDUPE_DAYS = clampInt(process.env.SITE_HIT_DEDUPE_DAYS || "30", 1, 365, 30);

let schemaReady = false;

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return json({ ok: false, error: "method_not_allowed" }, 405);
    }

    let body;
    try {
      body = event.body ? JSON.parse(event.body) : {};
    } catch (_) {
      return json({ ok: false, error: "bad_request" }, 400);
    }

    const siteId = String(body.siteId || "").trim();
    const site = getSiteById(siteId);
    if (!site) return json({ ok: false, error: "invalid_site" }, 400);
    const siteValidation = validateAnalyticsSite(site);
    if (!siteValidation.valid) return json({ ok: true, recorded: false, reason: siteValidation.reason });

    await ensureSchema();

    const ipHash = hashValue(getClientIp(event) || "unknown");
    const userAgent = getHeader(event, "user-agent").slice(0, 500);
    const sessionHash = hashOptional(body.sessionId);
    const visitorHash = hashOptional(body.visitorId);
    const bot = detectBot({ event, body, userAgent });
    const environment = normalizeAnalyticsEnvironment(process.env.CONTEXT || process.env.NODE_ENV);
    const isTest = environment !== "production";

    if (sessionHash || visitorHash) {
      const duplicate = await pool.query(
        `
          select id
          from site_interest_hits
          where site_id = $1
            and created_at >= now() - ($4 || ' days')::interval
            and (
              ($2::text is not null and session_hash = $2)
              or ($3::text is not null and visitor_hash = $3)
            )
          limit 1
        `,
        [site.id, sessionHash, visitorHash, String(HIT_DEDUPE_DAYS)]
      );
      if (duplicate.rows[0]) {
        return json({ ok: true, recorded: false, reason: "duplicate_site_person" });
      }
    }

    const recent = await pool.query(
      `
        select count(*)::int as hits
        from site_interest_hits
        where created_at >= now() - interval '1 minute'
          and (ip_hash = $1 or ($2::text is not null and session_hash = $2))
      `,
      [ipHash, sessionHash]
    );
    if (number(recent.rows[0]?.hits) >= HIT_RATE_LIMIT) {
      return json({ ok: true, recorded: false, reason: "rate_limited" });
    }

    await pool.query(
      `
        insert into site_interest_hits (
          site_id, search_mode, search_query, page_path, referrer,
          visitor_hash, session_hash, ip_hash, user_agent,
          is_bot, bot_reason, is_test, environment, valid, validation_reason,
          source, record_type, created_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, true, '', 'public_site', 'site_selection', now())
      `,
      [
        site.id,
        body.searchMode === "address" ? "address" : "name",
        cleanText(body.searchQuery, 120),
        cleanText(body.pagePath, 300),
        cleanText(body.referrer, 500),
        visitorHash,
        sessionHash,
        ipHash,
        userAgent,
        bot.isBot,
        bot.reason,
        isTest,
        environment
      ]
    );

    return json({ ok: true, recorded: true });
  } catch (error) {
    console.error("[track-site-hit] fatal:", error?.stack || error);
    return json({ ok: false, error: "server_error" }, 500);
  }
};

async function ensureSchema() {
  if (schemaReady) return;

  await pool.query(`
    create table if not exists site_interest_hits (
      id bigserial primary key,
      site_id text not null,
      search_mode text,
      search_query text,
      page_path text,
      referrer text,
      visitor_hash text,
      session_hash text,
      ip_hash text,
      user_agent text,
      is_bot boolean not null default false,
      bot_reason text,
      is_test boolean not null default false,
      environment text not null default 'production',
      valid boolean not null default true,
      validation_reason text not null default '',
      source text not null default 'public_site',
      record_type text not null default 'site_selection',
      order_id text,
      converted_at timestamptz,
      created_at timestamptz not null default now()
    )
  `);
  await pool.query(`
    alter table site_interest_hits
      add column if not exists is_test boolean not null default false,
      add column if not exists environment text not null default 'production',
      add column if not exists valid boolean not null default true,
      add column if not exists validation_reason text not null default '',
      add column if not exists source text not null default 'public_site',
      add column if not exists record_type text not null default 'site_selection',
      add column if not exists order_id text,
      add column if not exists converted_at timestamptz
  `);
  await pool.query(`create index if not exists site_interest_hits_created_idx on site_interest_hits(created_at desc)`);
  await pool.query(`create index if not exists site_interest_hits_site_created_idx on site_interest_hits(site_id, created_at desc)`);
  await pool.query(`create index if not exists site_interest_hits_site_visitor_idx on site_interest_hits(site_id, visitor_hash) where visitor_hash is not null`);
  await pool.query(`create index if not exists site_interest_hits_site_session_idx on site_interest_hits(site_id, session_hash) where session_hash is not null`);
  await pool.query(`create index if not exists site_interest_hits_session_created_idx on site_interest_hits(session_hash, created_at desc) where session_hash is not null`);
  await pool.query(`create index if not exists site_interest_hits_human_created_idx on site_interest_hits(created_at desc) where is_bot = false`);

  schemaReady = true;
}

function detectBot({ body, userAgent }) {
  const ua = String(userAgent || "").toLowerCase();
  if (!ua) return { isBot: true, reason: "missing_user_agent" };
  if (/\b(bot|crawler|spider|slurp|bingpreview|facebookexternalhit|whatsapp|telegrambot|discordbot|curl|wget|python-requests|headlesschrome|phantomjs)\b/.test(ua)) {
    return { isBot: true, reason: "bot_user_agent" };
  }
  if (body.webdriver === true) return { isBot: true, reason: "webdriver" };
  if (!body.sessionId && !body.visitorId) return { isBot: true, reason: "missing_browser_ids" };
  return { isBot: false, reason: "" };
}

function getHeader(event, name) {
  const headers = event?.headers || {};
  const target = String(name || "").toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() === target) return String(value || "");
  }
  return "";
}

function getClientIp(event) {
  const direct = getHeader(event, "x-nf-client-connection-ip") ||
    getHeader(event, "client-ip") ||
    getHeader(event, "x-real-ip");
  if (direct) return direct.trim();

  const forwarded = getHeader(event, "x-forwarded-for");
  return forwarded.split(",")[0]?.trim() || "";
}

function hashOptional(value) {
  const clean = String(value || "").trim();
  return clean ? hashValue(clean) : null;
}

function hashValue(value) {
  return crypto
    .createHash("sha256")
    .update(`${HIT_SALT}:${String(value || "").trim().toLowerCase()}`)
    .digest("hex");
}

function cleanText(value, maxLength) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function json(value, statusCode = 200) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(value)
  };
}
