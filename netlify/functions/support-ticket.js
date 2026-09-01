const crypto = require("crypto");
const { Pool } = require("pg");
const { getSiteById } = require("./_site-data");
const { ensureOrderStorage } = require("./_order-storage");
const { ensureSupportSchema } = require("./_support-schema");

const pool = new Pool({
  connectionString: process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const CONTEXT_SALT = String(
  process.env.SUPPORT_CONTEXT_SALT ||
  process.env.SITE_HIT_SALT ||
  process.env.ADMIN_ACCESS_CODE ||
  "circuitwash-support-context"
);
const MAX_MESSAGE_LENGTH = 10000;

class PublicError extends Error {
  constructor(message, statusCode = 400, code = "bad_request") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

    let body;
    try {
      body = event.body ? JSON.parse(event.body) : {};
    } catch (_) {
      throw new PublicError("Invalid request.", 400, "bad_request");
    }

    await ensureOrderStorage(pool);
    await ensureSupportSchema(pool);

    const action = String(body.action || "submit").trim().toLowerCase();
    if (action === "context") {
      const context = await resolveCustomerContext({ accessCode: body.accessCode, orderId: body.orderId });
      return json({ ok: true, email: context.email || "" });
    }
    if (action !== "submit") throw new PublicError("Invalid request.", 400, "bad_request");

    const email = normalizeEmail(body.email);
    const message = String(body.message || "").normalize("NFKC").trim();
    const idempotencyKey = String(body.idempotencyKey || "").trim();

    if (!isValidEmail(email)) throw new PublicError("Enter a valid email address.", 400, "invalid_email");
    if (message.length < 10) throw new PublicError("Tell us a little more so we can help.", 400, "message_too_short");
    if (message.length > MAX_MESSAGE_LENGTH) throw new PublicError("Your message is too long.", 400, "message_too_long");
    if (idempotencyKey.length < 12 || idempotencyKey.length > 200) {
      throw new PublicError("Refresh the page and try again.", 400, "invalid_submission");
    }

    const customerContext = await resolveCustomerContext({
      accessCode: body.accessCode,
      orderId: body.orderId,
      email
    });
    const sourceRoute = normalizeRoute(body.sourceRoute);
    const sessionHash = body.sessionId ? keyedHash(`session:${String(body.sessionId).slice(0, 200)}`) : null;
    const submissionKeyHash = keyedHash(`submission:${idempotencyKey}`);
    const userAgent = String(event.headers?.["user-agent"] || event.headers?.["User-Agent"] || "").slice(0, 500);

    const result = await pool.query(
      `
        insert into support_tickets (
          submission_key_hash, from_email, subject, body_text, status, source,
          source_route, session_hash, site_id, site_name, machine_id,
          access_code_hash, linked_access_code, linked_order_id, context_match,
          user_agent, is_read, received_at, last_activity_at
        ) values (
          $1, $2, 'CircuitWash support request', $3, 'NEW', 'WEB',
          $4, $5, $6, $7, $8, $9, $10, $11, $12,
          $13, false, now(), now()
        )
        on conflict (submission_key_hash) where submission_key_hash is not null do update
          set submission_key_hash = excluded.submission_key_hash
        returning id, from_email
      `,
      [
        submissionKeyHash,
        email,
        message,
        sourceRoute,
        sessionHash,
        customerContext.siteId,
        customerContext.siteName,
        normalizeMachineId(body.machineId),
        customerContext.accessCodeHash,
        customerContext.accessCode,
        customerContext.orderId,
        customerContext.match,
        userAgent
      ]
    );

    const ticket = result.rows[0];
    return json({ ok: true, ticketId: `CW-${ticket.id}`, email: ticket.from_email }, 201);
  } catch (error) {
    if (error instanceof PublicError) {
      return json({ ok: false, error: error.code, message: error.message }, error.statusCode);
    }
    console.error("[support-ticket] fatal:", error?.stack || error);
    return json({ ok: false, error: "server_error", message: "Support is unavailable right now. Please try again." }, 500);
  }
};

async function resolveCustomerContext({ accessCode: accessCodeValue, orderId: orderIdValue, email: emailValue } = {}) {
  const requestedCode = normalizeAccessCode(accessCodeValue);
  const requestedOrderId = normalizeOrderId(orderIdValue);
  const submittedEmail = normalizeEmail(emailValue);
  let verifiedCode = "";
  let access = null;
  let order = null;
  let match = "EMAIL";

  if (requestedCode) {
    const accessResult = await pool.query(
      `select code, site_id from access_codes where code = $1 and deleted_at is null limit 1`,
      [requestedCode]
    ).catch(() => ({ rows: [] }));
    access = accessResult.rows[0] || null;
    if (access) {
      verifiedCode = requestedCode;
      match = "ACCESS_CODE";
    }
  }

  const tableResult = await pool.query(`select to_regclass('public.access_orders') as table_name`);
  if (tableResult.rows[0]?.table_name && requestedOrderId) {
    const exactResult = await pool.query(
      `
        select order_id, site_id, coalesce(access_code, entitlement_access_code) as access_code,
               coalesce(nullif(customer_email, ''), payer_email, '') as email
        from access_orders
        where order_id = $1
        limit 1
      `,
      [requestedOrderId]
    );
    const candidate = exactResult.rows[0] || null;
    const candidateEmail = normalizeEmail(candidate?.email);
    const candidateCode = normalizeAccessCode(candidate?.access_code);
    if (candidate && ((submittedEmail && candidateEmail === submittedEmail) || (verifiedCode && candidateCode === verifiedCode))) {
      order = candidate;
      match = "ORDER_ID";
    }
  }

  if (tableResult.rows[0]?.table_name && !order && verifiedCode) {
    const codeOrderResult = await pool.query(
      `
        select order_id, site_id, coalesce(access_code, entitlement_access_code) as access_code,
               coalesce(nullif(customer_email, ''), payer_email, '') as email
        from access_orders
        where access_code = $1 or entitlement_access_code = $1
        order by completed_at desc nulls last, created_at desc
        limit 1
      `,
      [verifiedCode]
    );
    order = codeOrderResult.rows[0] || null;
    match = "ACCESS_CODE";
  }

  if (tableResult.rows[0]?.table_name && !order && isValidEmail(submittedEmail)) {
    const emailOrderResult = await pool.query(
      `
        select order_id, site_id, coalesce(access_code, entitlement_access_code) as access_code,
               coalesce(nullif(customer_email, ''), payer_email, '') as email
        from access_orders
        where lower(coalesce(nullif(customer_email, ''), payer_email, '')) = $1
        order by completed_at desc nulls last, created_at desc
        limit 1
      `,
      [submittedEmail]
    );
    order = emailOrderResult.rows[0] || null;
    match = "EMAIL";
  }

  const siteId = String(access?.site_id || order?.site_id || "").trim();
  const site = siteId ? getSiteById(siteId) : null;
  return {
    email: normalizeEmail(order?.email),
    siteId: site?.id || siteId || null,
    siteName: site?.name || null,
    accessCode: verifiedCode || null,
    accessCodeHash: verifiedCode ? keyedHash(`access:${verifiedCode}`) : null,
    orderId: order?.order_id || null,
    match: order || verifiedCode ? match : null
  };
}

function emptyContext() {
  return { email: "", siteId: null, siteName: null, accessCode: null, accessCodeHash: null, orderId: null, match: null };
}

function keyedHash(value) {
  return crypto.createHmac("sha256", CONTEXT_SALT).update(String(value)).digest("hex");
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase().slice(0, 320);
}

function normalizeAccessCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "").slice(0, 32);
}

function normalizeOrderId(value) {
  const orderId = String(value || "").trim().slice(0, 255);
  return /^[A-Za-z0-9_-]{6,255}$/.test(orderId) ? orderId : "";
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeRoute(value) {
  const route = String(value || "/support.html").trim().slice(0, 300);
  return route.startsWith("/") ? route : "/support.html";
}

function normalizeMachineId(value) {
  const machineId = String(value || "").trim().slice(0, 100);
  return machineId || null;
}

function json(data, statusCode = 200) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    },
    body: JSON.stringify(data)
  };
}

exports._test = { normalizeEmail, normalizeAccessCode, normalizeOrderId, isValidEmail, normalizeRoute, normalizeMachineId };
