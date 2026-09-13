const crypto = require("crypto");

const FORM_TOKEN_MIN_AGE_MS = 1500;
const FORM_TOKEN_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const MAX_REQUEST_BYTES = 15000;
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

function abuseSecret() {
  return String(
    process.env.SUPPORT_ABUSE_SALT ||
    process.env.SUPPORT_CONTEXT_SALT ||
    process.env.SITE_HIT_SALT ||
    process.env.CREATE_ORDER_RATE_LIMIT_SALT ||
    process.env.DB_URL_POOLED ||
    process.env.DB_URL ||
    "circuitwash-support-abuse"
  );
}

function assertJsonRequest(event) {
  const contentType = getHeader(event, "content-type").toLowerCase();
  if (!contentType.startsWith("application/json")) return abuseError("Invalid request.", 415, "unsupported_media_type");
  if (Buffer.byteLength(String(event.body || ""), "utf8") > MAX_REQUEST_BYTES) {
    return abuseError("Request is too large.", 413, "request_too_large");
  }
  return null;
}

function assertAllowedOrigin(event) {
  const origin = getHeader(event, "origin").trim();
  if (!origin) return null;
  let parsed;
  try { parsed = new URL(origin); } catch (_) { return abuseError("Invalid request origin.", 403, "invalid_origin"); }

  if (isLocalDevelopmentHostname(parsed.hostname) && ["http:", "https:"].includes(parsed.protocol)) return null;
  return allowedOrigins().has(parsed.origin) ? null : abuseError("Invalid request origin.", 403, "invalid_origin");
}

function createFormToken(now = Date.now()) {
  const payload = `${Math.floor(now)}.${crypto.randomBytes(16).toString("hex")}`;
  return `${payload}.${sign(`form:${payload}`)}`;
}

function verifyFormToken(value, { now = Date.now(), enforceMinimumAge = false } = {}) {
  const token = String(value || "").trim();
  const match = token.match(/^(\d{13})\.([a-f0-9]{32})\.([a-f0-9]{64})$/i);
  if (!match) return { valid: false, reason: "missing_form_token" };
  const payload = `${match[1]}.${match[2]}`;
  const expected = sign(`form:${payload}`);
  const supplied = match[3].toLowerCase();
  if (!safeEqual(expected, supplied)) return { valid: false, reason: "invalid_form_token" };
  const age = Number(now) - Number(match[1]);
  if (!Number.isFinite(age) || age < 0 || age > FORM_TOKEN_MAX_AGE_MS) return { valid: false, reason: "expired_form_token" };
  if (enforceMinimumAge && age < FORM_TOKEN_MIN_AGE_MS) return { valid: false, reason: "submitted_too_fast" };
  return { valid: true, age };
}

function inspectMessage(value) {
  const message = String(value || "");
  const urlCount = (message.match(/(?:https?:\/\/|www\.)/gi) || []).length;
  const visible = message.replace(/[\s\p{P}\p{S}]/gu, "");
  if (urlCount > 3) return { allowed: false, reason: "too_many_links" };
  if (visible.length < 5) return { allowed: false, reason: "too_little_content" };
  if (/(.)\1{19,}/u.test(message)) return { allowed: false, reason: "repeated_characters" };
  return { allowed: true, reason: "" };
}

function isHoneypotFilled(value) {
  return Boolean(String(value || "").trim());
}

function isObviousBot(event) {
  const userAgent = getHeader(event, "user-agent").toLowerCase();
  return /\b(bot|crawler|spider|slurp|headlesschrome|phantomjs|curl|wget|python-requests|scrapy)\b/.test(userAgent);
}

function getClientIp(event) {
  const direct = getHeader(event, "x-nf-client-connection-ip") ||
    getHeader(event, "client-ip") ||
    getHeader(event, "x-real-ip");
  if (direct) return direct.trim().slice(0, 100);
  return getHeader(event, "x-forwarded-for").split(",")[0]?.trim().slice(0, 100) || "";
}

function hashIdentifier(kind, value) {
  const clean = String(value || "").trim().toLowerCase();
  return clean ? sign(`${kind}:${clean}`) : null;
}

async function consumeRateLimits(pool, action, { clientIp = "", email = "", sessionId = "", message = "", now = Date.now() } = {}) {
  const rules = rateRules(action, { clientIp, email, sessionId, message });
  const entries = rules.map((rule) => {
    const bucketStart = Math.floor(Number(now) / rule.windowMs) * rule.windowMs;
    return {
      ...rule,
      bucketStart,
      key: sign(`rate:${action}:${rule.scope}:${rule.value}:${rule.windowMs}:${bucketStart}`),
      expiresAt: new Date(bucketStart + rule.windowMs + 60 * 60 * 1000).toISOString()
    };
  });
  if (!entries.length) return { allowed: true, retryAfter: 0 };

  let exceeded = [];
  for (const stage of rateLimitStages(entries)) {
    exceeded = await incrementRateEntries(pool, stage);
    if (exceeded.length) break;
  }
  if (Math.random() < 0.02) await pool.query(`delete from support_rate_limits where expires_at < now()`).catch(() => {});
  if (!exceeded.length) return { allowed: true, retryAfter: 0 };
  const retryAfter = Math.max(...exceeded.map((entry) => Math.ceil((entry.bucketStart + entry.windowMs - Number(now)) / 1000)), 1);
  return { allowed: false, retryAfter, scope: exceeded[0].scope };
}

function rateLimitStages(entries) {
  const scopeStages = [new Set(["ip", "session"]), new Set(["email"]), new Set(["content"]), new Set(["global"])];
  return scopeStages
    .map((scopes) => entries.filter((entry) => scopes.has(entry.scope)))
    .filter((stage) => stage.length);
}

async function incrementRateEntries(pool, entries) {
  const params = [];
  const values = entries.map((entry, index) => {
    params.push(entry.key, entry.expiresAt);
    const offset = index * 2;
    return `($${offset + 1}, 1, $${offset + 2}::timestamptz, now(), now())`;
  }).join(",");
  const result = await pool.query(
    `
      insert into support_rate_limits (rate_key, request_count, expires_at, created_at, updated_at)
      values ${values}
      on conflict (rate_key) do update
        set request_count = support_rate_limits.request_count + 1,
            updated_at = now()
      returning rate_key, request_count
    `,
    params
  );
  const counts = new Map(result.rows.map((row) => [row.rate_key, Number(row.request_count || 0)]));
  return entries.filter((entry) => (counts.get(entry.key) || 0) > entry.max);
}

function turnstileConfig() {
  const siteKey = String(process.env.TURNSTILE_SITE_KEY || "").trim();
  const secretKey = String(process.env.TURNSTILE_SECRET_KEY || "").trim();
  return { enabled: Boolean(siteKey && secretKey), siteKey };
}

async function verifyTurnstile(token, clientIp) {
  const config = turnstileConfig();
  if (!config.enabled) return { success: true, skipped: true };
  const responseToken = String(token || "").trim();
  if (responseToken.length < 10 || responseToken.length > 2048) return { success: false, reason: "missing_turnstile" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const body = new URLSearchParams({ secret: String(process.env.TURNSTILE_SECRET_KEY), response: responseToken });
    if (clientIp) body.set("remoteip", clientIp);
    const response = await fetch(TURNSTILE_VERIFY_URL, { method: "POST", body, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    const actionMatches = data.action === "support_submit";
    const hostnameMatches = isTurnstileHostnameAllowed(data.hostname);
    const success = Boolean(response.ok && data.success && actionMatches && hostnameMatches);
    const reason = data.success && !actionMatches
      ? "wrong_turnstile_action"
      : data.success && !hostnameMatches
        ? "wrong_turnstile_hostname"
        : "turnstile_failed";
    return { success, reason };
  } catch (_) {
    return { success: false, reason: "turnstile_unavailable" };
  } finally {
    clearTimeout(timeout);
  }
}

function allowedOrigins() {
  const allowed = new Set(["https://circuitwash.com", "https://www.circuitwash.com"]);
  for (const value of [process.env.PUBLIC_SITE_URL, process.env.URL, process.env.DEPLOY_PRIME_URL, process.env.DEPLOY_URL]) {
    try { if (value) allowed.add(new URL(value).origin); } catch (_) {}
  }
  return allowed;
}

function isLocalDevelopmentHostname(hostname) {
  return process.env.CONTEXT !== "production" &&
    process.env.NODE_ENV !== "production" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(String(hostname || "").toLowerCase());
}

function isTurnstileHostnameAllowed(hostname) {
  const candidate = String(hostname || "").trim().toLowerCase().replace(/\.$/, "");
  if (!candidate) return false;
  if (isLocalDevelopmentHostname(candidate)) return true;
  const allowed = new Set([...allowedOrigins()].map((origin) => new URL(origin).hostname.toLowerCase()));
  return allowed.has(candidate);
}

function rateRules(action, { clientIp, email, sessionId, message }) {
  const values = {
    ip: clientIp,
    email: String(email || "").trim().toLowerCase(),
    session: String(sessionId || "").trim().slice(0, 200),
    content: String(message || "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 10000),
    global: "all"
  };
  const definitions = action === "submit"
    ? [
        ["global", 10 * 60 * 1000, 60],
        ["global", 24 * 60 * 60 * 1000, 500],
        ["ip", 15 * 60 * 1000, 8],
        ["ip", 24 * 60 * 60 * 1000, 40],
        ["email", 30 * 60 * 1000, 4],
        ["email", 24 * 60 * 60 * 1000, 10],
        ["session", 15 * 60 * 1000, 5],
        ["content", 24 * 60 * 60 * 1000, 8]
      ]
    : action === "challenge"
      ? [
          ["global", 10 * 60 * 1000, 1000],
          ["global", 24 * 60 * 60 * 1000, 10000],
          ["ip", 10 * 60 * 1000, 20],
          ["ip", 24 * 60 * 60 * 1000, 100],
          ["session", 10 * 60 * 1000, 20]
        ]
      : [
        ["global", 10 * 60 * 1000, 300],
        ["global", 24 * 60 * 60 * 1000, 3000],
        ["ip", 10 * 60 * 1000, 40],
        ["ip", 24 * 60 * 60 * 1000, 200],
        ["session", 10 * 60 * 1000, 25]
      ];
  return definitions
    .filter(([scope]) => values[scope])
    .map(([scope, windowMs, max]) => ({ scope, value: values[scope], windowMs, max }));
}

function getHeader(event, name) {
  const target = String(name || "").toLowerCase();
  for (const [key, value] of Object.entries(event?.headers || {})) {
    if (String(key).toLowerCase() === target) return String(value || "");
  }
  return "";
}

function sign(value) {
  return crypto.createHmac("sha256", abuseSecret()).update(String(value)).digest("hex");
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function abuseError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.isAbuseError = true;
  return error;
}

module.exports = {
  FORM_TOKEN_MIN_AGE_MS,
  MAX_REQUEST_BYTES,
  assertAllowedOrigin,
  assertJsonRequest,
  consumeRateLimits,
  createFormToken,
  getClientIp,
  hashIdentifier,
  inspectMessage,
  isHoneypotFilled,
  isObviousBot,
  turnstileConfig,
  verifyFormToken,
  verifyTurnstile,
  _test: { isTurnstileHostnameAllowed, rateLimitStages, rateRules }
};
