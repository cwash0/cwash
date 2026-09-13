const crypto = require("crypto");
const { pool } = require("./_db");
const { normalizeAnalyticsEnvironment } = require("./_analytics-validity");

const ALLOWED_EVENTS = new Set([
  "landing_view",
  "trial_cta_clicked",
  "login_clicked",
  "access_code_clicked",
  "trial_started",
  "trial_activation_completed",
  "trial_conversion_screen_viewed",
  "trial_converted_to_paid",
  "access_code_submitted",
  "support_page_viewed",
  "support_ticket_submitted",
  "extra_activation_checkout_started",
  "extra_activation_purchase_completed",
  "extra_activation_purchase_failed",
  "bluetooth_connection_failed",
  "bluetooth_activation_failed",
  "bluetooth_unexpected_disconnect"
]);
const BLUETOOTH_FAILURE_EVENTS = new Set([
  "bluetooth_connection_failed",
  "bluetooth_activation_failed",
  "bluetooth_unexpected_disconnect"
]);
const ANALYTICS_SALT = String(
  process.env.FUNNEL_ANALYTICS_SALT ||
  process.env.SITE_HIT_SALT ||
  process.env.CREATE_ORDER_RATE_LIMIT_SALT ||
  "circuitwash-funnel"
);
let schemaReady = false;

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

    let body;
    try {
      body = event.body ? JSON.parse(event.body) : {};
    } catch (_) {
      return json({ ok: false, error: "bad_request" }, 400);
    }

    const eventName = cleanText(body.event_name, 80);
    if (!ALLOWED_EVENTS.has(eventName)) return json({ ok: false, error: "invalid_event" }, 400);

    const eventId = cleanText(body.event_id, 120);
    const sessionHash = hashOptional(body.session_id);
    const visitorHash = hashOptional(body.visitor_id);
    if (!eventId || !sessionHash) return json({ ok: false, error: "missing_event_identity" }, 400);

    await ensureSchema();

    const ipHash = hashOptional(getClientIp(event));
    const userAgent = getHeader(event, "user-agent").slice(0, 500);
    const bot = detectBot({ body, userAgent });
    const environment = normalizeAnalyticsEnvironment(process.env.CONTEXT || process.env.NODE_ENV);
    const failure = BLUETOOTH_FAILURE_EVENTS.has(eventName);
    const recent = await pool.query(
      `
        select count(*)::int as events
        from funnel_events
        where created_at >= now() - interval '1 minute'
          and (session_hash = $1 or ($2::text is not null and ip_hash = $2))
      `,
      [sessionHash, ipHash]
    );
    if (Number(recent.rows[0]?.events || 0) >= 120) {
      return json({ ok: true, recorded: false, reason: "rate_limited" });
    }

    const result = await pool.query(
      `
        insert into funnel_events (
          event_name, event_id_hash, source, route, device_type,
          session_hash, visitor_hash, auth_state, trial_eligibility,
          ip_hash, user_agent, is_bot, bot_reason, is_test, environment,
          site_id, site_name, machine_id, machine_name, bluetooth_device_name,
          failure_stage, error_code, error_message, created_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                $16, $17, $18, $19, $20, $21, $22, $23, now())
        on conflict (event_id_hash) do nothing
        returning id
      `,
      [
        eventName,
        hashValue(eventId),
        cleanText(body.source, 100),
        cleanText(body.route, 300),
        allowValue(body.device_type, ["mobile", "tablet", "desktop"], "unknown"),
        sessionHash,
        visitorHash,
        allowValue(body.auth_state, ["anonymous", "authenticated"], "unknown"),
        allowValue(body.trial_eligibility, ["available", "claimed", "used", "disabled", "unavailable"], "unknown"),
        ipHash,
        userAgent,
        bot.isBot,
        bot.reason,
        environment !== "production",
        environment,
        failure ? cleanText(body.site_id, 120) : "",
        failure ? cleanText(body.site_name, 180) : "",
        failure ? cleanText(body.machine_id, 120) : "",
        failure ? cleanText(body.machine_name, 180) : "",
        failure ? cleanText(body.bluetooth_device_name, 180) : "",
        failure ? cleanText(body.failure_stage, 80).toLowerCase() : "",
        failure ? cleanText(body.error_code, 100).toLowerCase() : "",
        failure ? cleanText(body.error_message, 300) : ""
      ]
    );

    return json({ ok: true, recorded: Boolean(result.rows[0]) });
  } catch (error) {
    console.error("[track-funnel-event] fatal:", error?.stack || error);
    return json({ ok: false, error: "server_error" }, 500);
  }
};

async function ensureSchema() {
  if (schemaReady) return;
  await pool.query(`
    create table if not exists funnel_events (
      id bigserial primary key,
      event_name text not null,
      event_id_hash char(64) unique not null,
      source text,
      route text,
      device_type text not null default 'unknown',
      session_hash char(64) not null,
      visitor_hash char(64),
      auth_state text not null default 'unknown',
      trial_eligibility text not null default 'unknown',
      ip_hash char(64),
      user_agent text,
      is_bot boolean not null default false,
      bot_reason text not null default '',
      is_test boolean not null default false,
      environment text not null default 'production',
      site_id text,
      site_name text,
      machine_id text,
      machine_name text,
      bluetooth_device_name text,
      failure_stage text,
      error_code text,
      error_message text,
      created_at timestamptz not null default now()
    )
  `);
  await pool.query(`
    alter table funnel_events
      add column if not exists site_id text,
      add column if not exists site_name text,
      add column if not exists machine_id text,
      add column if not exists machine_name text,
      add column if not exists bluetooth_device_name text,
      add column if not exists failure_stage text,
      add column if not exists error_code text,
      add column if not exists error_message text
  `);
  await pool.query(`create index if not exists funnel_events_name_created_idx on funnel_events(event_name, created_at desc)`);
  await pool.query(`create index if not exists funnel_events_session_created_idx on funnel_events(session_hash, created_at desc)`);
  await pool.query(`create index if not exists funnel_events_human_created_idx on funnel_events(created_at desc) where is_bot = false`);
  await pool.query(`create index if not exists funnel_events_bluetooth_failure_idx on funnel_events(created_at desc, site_id) where event_name like 'bluetooth_%'`);
  schemaReady = true;
}

function detectBot({ body, userAgent }) {
  const ua = String(userAgent || "").toLowerCase();
  if (!ua) return { isBot: true, reason: "missing_user_agent" };
  if (/\b(bot|crawler|spider|slurp|bingpreview|facebookexternalhit|whatsapp|telegrambot|discordbot|curl|wget|python-requests|headlesschrome|phantomjs)\b/.test(ua)) {
    return { isBot: true, reason: "bot_user_agent" };
  }
  if (body.webdriver === true) return { isBot: true, reason: "webdriver" };
  return { isBot: false, reason: "" };
}

function allowValue(value, allowed, fallback) {
  const clean = cleanText(value, 40).toLowerCase();
  return allowed.includes(clean) ? clean : fallback;
}

function cleanText(value, maxLength) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function getHeader(event, name) {
  const target = String(name || "").toLowerCase();
  for (const [key, value] of Object.entries(event?.headers || {})) {
    if (String(key).toLowerCase() === target) return String(value || "");
  }
  return "";
}

function getClientIp(event) {
  const direct = getHeader(event, "x-nf-client-connection-ip") ||
    getHeader(event, "client-ip") ||
    getHeader(event, "x-real-ip");
  if (direct) return direct.trim();
  return getHeader(event, "x-forwarded-for").split(",")[0]?.trim() || "";
}

function hashOptional(value) {
  const clean = String(value || "").trim();
  return clean ? hashValue(clean) : null;
}

function hashValue(value) {
  return crypto.createHash("sha256").update(`${ANALYTICS_SALT}:${String(value || "").trim()}`).digest("hex");
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
