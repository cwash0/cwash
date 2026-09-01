const crypto = require("crypto");
const { Pool } = require("pg");
const { getSiteById } = require("./_site-data");
const { ensureOrderStorage } = require("./_order-storage");

const pool = new Pool({
  connectionString: process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const STRIPE_API_BASE = "https://api.stripe.com/v1";
const CURRENCY = normalizeCurrency(process.env.ACCESS_CODE_CURRENCY || "GBP");
const PRICE = normalizeMoney(process.env.ACCESS_CODE_PRICE || "3.00");
const ACCESS_DURATION_YEARS = clampInt(process.env.ACCESS_DURATION_YEARS || "1", 1, 10, 1);
const ACCESS_WEEKLY_LIMIT = clampInt(process.env.ACCESS_WEEKLY_LIMIT || "4", 1, 100, 4);
const ACTIVATION_UPGRADE_PRICE = "5.00";
const ACTIVATION_UPGRADE_BONUS = 3;
const MIN_ORDER_TOTAL = normalizeMoney(process.env.PROMO_MIN_ORDER_TOTAL || "0.01");
const BRAND_NAME = String(process.env.STRIPE_BRAND_NAME || process.env.ACCESS_CODE_BRAND_NAME || "CircuitWash").slice(0, 127);
const CODE_LENGTH = normalizeCodeLength(process.env.ACCESS_CODE_LENGTH || "5");
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const RESEND_API_KEY = String(process.env.RESEND_API_KEY || "").trim();
const EMAIL_FROM = String(process.env.ACCESS_CODE_EMAIL_FROM || "").trim();
const SUPPORT_PUBLIC_EMAIL = String(process.env.SUPPORT_PUBLIC_EMAIL || "support@circuitwash.com").trim();
const PUBLIC_SITE_URL = normalizeBaseUrl(
  process.env.PUBLIC_SITE_URL || process.env.URL || "https://circuitwash.com"
);
const SITE_HIT_SALT = String(
  process.env.SITE_HIT_SALT ||
  process.env.CREATE_ORDER_RATE_LIMIT_SALT ||
  PUBLIC_SITE_URL ||
  "laundry-site-hit"
);
const SITE_HIT_DEDUPE_DAYS = clampInt(process.env.SITE_HIT_DEDUPE_DAYS || "30", 1, 365, 30);
const CREATE_ORDER_LIMIT = clampInt(process.env.CREATE_ORDER_RATE_LIMIT || "8", 1, 100, 8);
const CREATE_ORDER_WINDOW_MINUTES = clampInt(process.env.CREATE_ORDER_RATE_WINDOW_MINUTES || "10", 1, 120, 10);
const CREATE_ORDER_ATTEMPT_RETENTION_MINUTES = clampInt(process.env.CREATE_ORDER_ATTEMPT_RETENTION_MINUTES || "1440", 60, 10080, 1440);

let paymentTableReady = false;

class PublicError extends Error {
  constructor(message, statusCode = 400, code = "request_failed") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "GET") {
      const secretKey = requireEnv("STRIPE_SECRET_KEY");
      const publishableKey = requireEnv("STRIPE_PUBLISHABLE_KEY");

      return json({
        ok: true,
        publishableKey,
        currency: CURRENCY,
        price: PRICE,
        brandName: BRAND_NAME,
        codeLength: CODE_LENGTH,
        environment: secretKey.startsWith("sk_live_") ? "live" : "test",
        emailEnabled: Boolean(RESEND_API_KEY && EMAIL_FROM),
        accessProduct: publicAccessProduct()
      });
    }

    if (event.httpMethod !== "POST") {
      return json({ ok: false, error: "method_not_allowed" }, 405);
    }

    let body;
    try {
      body = event.body ? JSON.parse(event.body) : {};
    } catch (_) {
      return json({ ok: false, error: "bad_request" }, 400);
    }

    const action = String(body.action || "").trim();

    if (action === "site_product") {
      const site = getSiteById(String(body.siteId || "").trim());
      if (!site) throw new PublicError("Please select a valid site.", 400, "invalid_site");
      return json({ ok: true, site, accessProduct: publicAccessProduct() });
    }

    if (action === "create_payment_intent") {
      const result = await createPaymentIntent(
        String(body.siteId || "").trim(),
        body.customerEmail,
        body.promoCode,
        event,
        body.analyticsSessionId,
        body.analyticsVisitorId
      );
      return json({ ok: true, ...result });
    }

    if (action === "apply_promo") {
      return json({ ok: true, ...(await getCheckoutPricing(body.promoCode, body.siteId)) });
    }

    if (action === "claim_free_code") {
      const result = await claimFreeAccessCode(
        String(body.siteId || "").trim(),
        body.customerEmail,
        body.promoCode,
        body.analyticsSessionId,
        body.analyticsVisitorId
      );
      return json({ ok: true, ...result });
    }

    if (action === "complete_payment_intent") {
      const result = await completePaymentIntent(String(body.paymentIntentId || "").trim());
      return json({ ok: true, ...result });
    }

    if (action === "create_activation_upgrade") {
      const result = await createActivationUpgrade(
        normalizeAccessCode(body.accessCode),
        event
      );
      return json({ ok: true, ...result });
    }

    if (action === "create_activation_upgrade_preview") {
      return json({ ok: true, ...(await createActivationUpgradePreview(event)) });
    }

    if (action === "create_activation_upgrade_intent") {
      return json({ ok: true, ...(await createActivationUpgradeIntent(normalizeAccessCode(body.accessCode), event)) });
    }

    if (action === "create_activation_upgrade_preview_intent") {
      return json({ ok: true, ...(await createActivationUpgradePreviewIntent()) });
    }

    if (action === "complete_activation_upgrade_intent") {
      return json({ ok: true, ...(await completeActivationUpgradeIntent(
        String(body.paymentIntentId || "").trim(),
        { preview: Boolean(body.preview) }
      )) });
    }

    if (action === "complete_activation_upgrade") {
      const result = await completeActivationUpgrade(String(body.sessionId || "").trim());
      return json({ ok: true, ...result });
    }

    if (action === "resend_email") {
      const result = await resendAccessEmail(
        String(body.orderId || "").trim(),
        body.customerEmail
      );
      return json({ ok: true, ...result });
    }

    return json({ ok: false, error: "unknown_action" }, 400);
  } catch (error) {
    if (error instanceof PublicError) {
      return json({ ok: false, error: error.code, message: error.message }, error.statusCode);
    }

    console.error("[stripe-checkout] fatal:", error?.stack || error);
    return json({ ok: false, error: "server_error" }, 500);
  }
};

async function createPaymentIntent(siteId, customerEmailValue, promoCodeValue = "", event = {}, analyticsSessionId = "", analyticsVisitorId = "") {
  const site = getSiteById(siteId);
  if (!site) throw new PublicError("Please select a valid site.", 400, "invalid_site");

  const customerEmail = normalizeEmail(customerEmailValue);

  await ensurePaymentTable();
  const pricing = await getCheckoutPricing(promoCodeValue, site.id);
  if (moneyToCents(pricing.total) <= 0) {
    throw new PublicError("Use the free checkout button for this promo code.", 409, "free_checkout_required");
  }
  await enforceCreateOrderRateLimit({
    event,
    customerEmail,
    siteId: site.id,
    paymentMethod: "stripe"
  });

  const requestId = crypto.randomUUID();
  const intent = await createStripePaymentIntent({
    site,
    customerEmail,
    pricing,
    requestId
  });

  await pool.query(
    `
      insert into access_orders
        (order_id, site_id, amount, currency, status, customer_email, email_status, payment_method,
         subtotal_amount, discount_amount, promo_code, created_at, updated_at)
      values ($1, $2, $3::numeric, $4, 'CREATED', $5, 'PENDING', $6, $7::numeric, $8::numeric, $9, now(), now())
      on conflict (order_id) do nothing
    `,
    [
      intent.id,
      site.id,
      pricing.total,
      CURRENCY,
      customerEmail,
      "stripe",
      pricing.subtotal,
      pricing.discountAmount,
      pricing.promo?.code || null
    ]
  );
  await markSiteInterestConverted({
    orderId: intent.id,
    siteId: site.id,
    analyticsSessionId,
    analyticsVisitorId
  });

  return { paymentIntentId: intent.id, clientSecret: intent.client_secret };
}

async function createStripePaymentIntent({ site, customerEmail, pricing, requestId }) {
  const params = new URLSearchParams();
  params.set("payment_method_types[0]", "card");
  params.set("amount", String(moneyToCents(pricing.total)));
  params.set("currency", CURRENCY.toLowerCase());
  params.set("receipt_email", customerEmail);
  params.set("description", `${accessDurationLabel()} laundry access - ${site.name}`.slice(0, 500));
  params.set("metadata[site_id]", site.id);
  params.set("metadata[site_name]", site.name);
  params.set("metadata[promo_code]", pricing.promo?.code || "");
  params.set("metadata[customer_email]", customerEmail);

  const intent = await stripeRequest("payment_intents", {
    method: "POST",
    body: params,
    idempotencyKey: `intent-${requestId}`
  });
  if (!intent?.id || !intent?.client_secret) {
    console.error("[stripe-checkout] create intent failed:", intent);
    throw new PublicError("Stripe could not start the checkout.", 502, "stripe_create_failed");
  }
  return intent;
}

async function createActivationUpgrade(accessCode, event = {}) {
  await ensurePaymentTable();
  const usage = await getActivationUpgradeUsage(accessCode);
  if (usage.remaining > 0) {
    throw new PublicError("This code still has activations available.", 409, "credits_available");
  }

  await enforceCreateOrderRateLimit({
    event,
    customerEmail: `upgrade:${accessCode}`,
    siteId: usage.siteId,
    paymentMethod: "activation_upgrade"
  });

  const orderId = crypto.randomUUID();
  await pool.query(
    `
      insert into activation_upgrade_orders
        (order_id, access_code, bonus_activations, amount, currency, status, created_at)
      values ($1, $2, $3, $4::numeric, $5, 'CREATED', now())
    `,
    [orderId, accessCode, ACTIVATION_UPGRADE_BONUS, ACTIVATION_UPGRADE_PRICE, CURRENCY]
  );

  try {
    const returnBase = activationUpgradeReturnBase(event);
    const params = new URLSearchParams();
    params.set("mode", "payment");
    params.set("payment_method_types[0]", "card");
    params.set("success_url", `${returnBase}/activate.html?upgrade=success&session_id={CHECKOUT_SESSION_ID}`);
    params.set("cancel_url", `${returnBase}/activate.html?upgrade=cancelled`);
    params.set("client_reference_id", orderId);
    params.set("metadata[upgrade_order_id]", orderId);
    params.set("payment_intent_data[metadata][upgrade_order_id]", orderId);
    params.set("line_items[0][quantity]", "1");
    params.set("line_items[0][price_data][currency]", CURRENCY.toLowerCase());
    params.set("line_items[0][price_data][unit_amount]", String(moneyToCents(ACTIVATION_UPGRADE_PRICE)));
    params.set("line_items[0][price_data][product_data][name]", `${ACTIVATION_UPGRADE_BONUS} extra CircuitWash activations`);
    params.set("line_items[0][price_data][product_data][description]", "Extra machine starts for the current weekly allowance");

    const session = await stripeRequest("checkout/sessions", {
      method: "POST",
      body: params,
      idempotencyKey: `activation-upgrade-${orderId}`
    });
    if (!session?.id || !session?.url) {
      throw new PublicError("Stripe could not open the upgrade checkout.", 502, "stripe_create_failed");
    }

    await pool.query(
      `update activation_upgrade_orders set stripe_session_id = $2 where order_id = $1`,
      [orderId, session.id]
    );
    return {
      checkoutUrl: session.url,
      sessionId: session.id,
      amount: ACTIVATION_UPGRADE_PRICE,
      currency: CURRENCY,
      bonusActivations: ACTIVATION_UPGRADE_BONUS
    };
  } catch (error) {
    await pool.query(
      `update activation_upgrade_orders set status = 'FAILED' where order_id = $1 and status = 'CREATED'`,
      [orderId]
    ).catch(() => {});
    throw error;
  }
}

async function createActivationUpgradePreview(event = {}) {
  const secretKey = requireEnv("STRIPE_SECRET_KEY");
  if (!secretKey.startsWith("sk_test_")) {
    throw new PublicError("Preview checkout requires Stripe test-mode keys.", 409, "preview_requires_test_key");
  }

  const returnBase = activationUpgradeReturnBase(event);
  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("payment_method_types[0]", "card");
  params.set("success_url", `${returnBase}/activate.html?upgradePreview=1&checkout=success`);
  params.set("cancel_url", `${returnBase}/activate.html?upgradePreview=1&checkout=cancelled`);
  params.set("metadata[preview]", "activation_upgrade");
  params.set("payment_intent_data[metadata][preview]", "activation_upgrade");
  params.set("line_items[0][quantity]", "1");
  params.set("line_items[0][price_data][currency]", CURRENCY.toLowerCase());
  params.set("line_items[0][price_data][unit_amount]", String(moneyToCents(ACTIVATION_UPGRADE_PRICE)));
  params.set("line_items[0][price_data][product_data][name]", `${ACTIVATION_UPGRADE_BONUS} extra CircuitWash activations — test preview`);
  params.set("line_items[0][price_data][product_data][description]", "Stripe test checkout preview; no access code will be credited");

  const session = await stripeRequest("checkout/sessions", {
    method: "POST",
    body: params,
    idempotencyKey: `activation-upgrade-preview-${crypto.randomUUID()}`
  });
  if (!session?.id || !session?.url) {
    throw new PublicError("Stripe could not open the preview checkout.", 502, "stripe_create_failed");
  }
  return {
    checkoutUrl: session.url,
    sessionId: session.id,
    amount: ACTIVATION_UPGRADE_PRICE,
    currency: CURRENCY,
    bonusActivations: ACTIVATION_UPGRADE_BONUS,
    preview: true
  };
}

async function createActivationUpgradeIntent(accessCode, event = {}) {
  await ensurePaymentTable();
  const usage = await getActivationUpgradeUsage(accessCode);
  if (usage.remaining > 0) {
    throw new PublicError("This code still has activations available.", 409, "credits_available");
  }
  await enforceCreateOrderRateLimit({
    event,
    customerEmail: `upgrade:${accessCode}`,
    siteId: usage.siteId,
    paymentMethod: "activation_upgrade"
  });

  const orderId = crypto.randomUUID();
  await pool.query(
    `
      insert into activation_upgrade_orders
        (order_id, access_code, bonus_activations, amount, currency, status, created_at)
      values ($1, $2, $3, $4::numeric, $5, 'CREATED', now())
    `,
    [orderId, accessCode, ACTIVATION_UPGRADE_BONUS, ACTIVATION_UPGRADE_PRICE, CURRENCY]
  );

  try {
    const params = new URLSearchParams();
    params.set("payment_method_types[0]", "card");
    params.set("amount", String(moneyToCents(ACTIVATION_UPGRADE_PRICE)));
    params.set("currency", CURRENCY.toLowerCase());
    params.set("description", `${ACTIVATION_UPGRADE_BONUS} extra CircuitWash activations`);
    params.set("metadata[upgrade_order_id]", orderId);
    const intent = await stripeRequest("payment_intents", {
      method: "POST",
      body: params,
      idempotencyKey: `activation-upgrade-intent-${orderId}`
    });
    if (!intent?.id || !intent?.client_secret) {
      throw new PublicError("Stripe could not prepare the upgrade payment.", 502, "stripe_create_failed");
    }
    await pool.query(
      `update activation_upgrade_orders set payment_intent_id = $2 where order_id = $1`,
      [orderId, intent.id]
    );
    return {
      paymentIntentId: intent.id,
      clientSecret: intent.client_secret,
      amount: ACTIVATION_UPGRADE_PRICE,
      currency: CURRENCY,
      bonusActivations: ACTIVATION_UPGRADE_BONUS
    };
  } catch (error) {
    await pool.query(
      `update activation_upgrade_orders set status = 'FAILED' where order_id = $1 and status = 'CREATED'`,
      [orderId]
    ).catch(() => {});
    throw error;
  }
}

async function createActivationUpgradePreviewIntent() {
  const secretKey = requireEnv("STRIPE_SECRET_KEY");
  if (!secretKey.startsWith("sk_test_")) {
    throw new PublicError("Preview checkout requires Stripe test-mode keys.", 409, "preview_requires_test_key");
  }
  const params = new URLSearchParams();
  params.set("payment_method_types[0]", "card");
  params.set("amount", String(moneyToCents(ACTIVATION_UPGRADE_PRICE)));
  params.set("currency", CURRENCY.toLowerCase());
  params.set("description", `${ACTIVATION_UPGRADE_BONUS} extra CircuitWash activations — preview`);
  params.set("metadata[preview]", "activation_upgrade");
  const intent = await stripeRequest("payment_intents", {
    method: "POST",
    body: params,
    idempotencyKey: `activation-upgrade-preview-intent-${crypto.randomUUID()}`
  });
  if (!intent?.id || !intent?.client_secret) {
    throw new PublicError("Stripe could not prepare the preview payment.", 502, "stripe_create_failed");
  }
  return {
    paymentIntentId: intent.id,
    clientSecret: intent.client_secret,
    amount: ACTIVATION_UPGRADE_PRICE,
    currency: CURRENCY,
    bonusActivations: ACTIVATION_UPGRADE_BONUS,
    preview: true
  };
}

async function completeActivationUpgradeIntent(paymentIntentId, { preview = false } = {}) {
  validateOrderId(paymentIntentId);
  const intent = await retrieveStripePaymentIntent(paymentIntentId);
  if (intent?.status !== "succeeded") {
    throw new PublicError("The upgrade payment is not complete.", 409, "payment_not_completed");
  }
  if (Number(intent.amount_received || intent.amount || 0) !== moneyToCents(ACTIVATION_UPGRADE_PRICE) || normalizeCurrency(intent.currency || "") !== CURRENCY) {
    throw new PublicError("The completed upgrade amount is incorrect.", 409, "amount_mismatch");
  }
  if (preview) {
    if (intent.metadata?.preview !== "activation_upgrade") {
      throw new PublicError("This is not a preview payment.", 409, "order_mismatch");
    }
    return { preview: true, bonusActivations: ACTIVATION_UPGRADE_BONUS };
  }

  await ensurePaymentTable();
  const client = await pool.connect();
  let accessCode = "";
  try {
    await client.query("BEGIN");
    const lockedResult = await client.query(
      `select * from activation_upgrade_orders where payment_intent_id = $1 for update`,
      [paymentIntentId]
    );
    const order = lockedResult.rows[0];
    if (!order) throw new PublicError("This upgrade payment was not created by this site.", 404, "order_not_found");
    if (String(intent.metadata?.upgrade_order_id || "") !== order.order_id) {
      throw new PublicError("The upgrade payment reference does not match.", 409, "order_mismatch");
    }
    accessCode = order.access_code;
    const weekStart = getWeekStartUTC();
    if (order.status !== "COMPLETED") {
      await client.query(
        `update activation_upgrade_orders set status = 'COMPLETED', week_start = $2::date, completed_at = now() where order_id = $1`,
        [order.order_id, weekStart]
      );
    }
    await persistActivationUpgradeOrder(client, order, paymentIntentId, weekStart);
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
  const usage = await getActivationUpgradeUsage(accessCode);
  return {
    bonusActivations: ACTIVATION_UPGRADE_BONUS,
    weeklyLimit: usage.limit,
    weeklyUsed: usage.used,
    weeklyRemaining: usage.remaining,
    weeklyResetAt: usage.resetAt
  };
}

async function completeActivationUpgrade(sessionId) {
  validateCheckoutSessionId(sessionId);
  await ensurePaymentTable();
  const session = await stripeRequest(`checkout/sessions/${encodeURIComponent(sessionId)}`);
  if (session?.payment_status !== "paid") {
    throw new PublicError("The upgrade payment is not complete.", 409, "payment_not_completed");
  }

  const client = await pool.connect();
  let accessCode = "";
  try {
    await client.query("BEGIN");
    const lockedResult = await client.query(
      `select * from activation_upgrade_orders where stripe_session_id = $1 for update`,
      [sessionId]
    );
    const order = lockedResult.rows[0];
    if (!order) throw new PublicError("This upgrade payment was not created by this site.", 404, "order_not_found");
    if (String(session.client_reference_id || "") !== order.order_id || String(session.metadata?.upgrade_order_id || "") !== order.order_id) {
      throw new PublicError("The upgrade payment reference does not match.", 409, "order_mismatch");
    }
    if (Number(session.amount_total || 0) !== moneyToCents(order.amount) || normalizeCurrency(session.currency || "") !== order.currency) {
      throw new PublicError("The completed upgrade amount is incorrect.", 409, "amount_mismatch");
    }

    accessCode = order.access_code;
    const weekStart = getWeekStartUTC();
    if (order.status !== "COMPLETED") {
      await client.query(
        `
          update activation_upgrade_orders
          set status = 'COMPLETED', week_start = $2::date, completed_at = now()
          where order_id = $1
        `,
        [order.order_id, weekStart]
      );
    }
    await persistActivationUpgradeOrder(client, order, String(session.payment_intent || session.id), weekStart);
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }

  const usage = await getActivationUpgradeUsage(accessCode);
  return {
    bonusActivations: ACTIVATION_UPGRADE_BONUS,
    weeklyLimit: usage.limit,
    weeklyUsed: usage.used,
    weeklyRemaining: usage.remaining,
    weeklyResetAt: usage.resetAt
  };
}

async function persistActivationUpgradeOrder(db, upgradeOrder, providerReference, weekStart) {
  const contextResult = await db.query(
    `
      select ac.site_id,
             (
               select coalesce(nullif(o.customer_email, ''), o.payer_email)
               from access_orders o
               where o.access_code = ac.code
               order by o.completed_at desc nulls last, o.created_at desc
               limit 1
             ) as customer_email
      from access_codes ac
      where ac.code = $1
      limit 1
    `,
    [upgradeOrder.access_code]
  );
  const context = contextResult.rows[0];
  if (!context?.site_id) throw new PublicError("The upgraded access code has no site.", 409, "order_context_missing");

  await db.query(
    `
      insert into access_orders (
        order_id, site_id, amount, currency, status, customer_email, payer_email,
        email_status, payment_method, order_type, quantity,
        entitlement_access_code, entitlement_week_start, entitlement_week_end,
        provider_reference, subtotal_amount, discount_amount,
        created_at, updated_at, completed_at
      ) values (
        $1, $2, $3::numeric, $4, 'COMPLETED', $5, $5,
        'NOT_REQUIRED', 'stripe', 'weekly_activation_addon', $6,
        $7, $8::date, ($8::date + interval '7 days')::date,
        $9, $3::numeric, 0,
        coalesce($10::timestamptz, now()), now(), now()
      )
      on conflict (order_id) do nothing
    `,
    [
      upgradeOrder.order_id,
      context.site_id,
      upgradeOrder.amount,
      upgradeOrder.currency,
      context.customer_email || null,
      Math.max(1, Number(upgradeOrder.bonus_activations || ACTIVATION_UPGRADE_BONUS)),
      upgradeOrder.access_code,
      weekStart,
      providerReference,
      upgradeOrder.created_at || null
    ]
  );
}

async function backfillCompletedActivationUpgradeOrders(db) {
  await db.query(`
    insert into access_orders (
      order_id, site_id, amount, currency, status, customer_email, payer_email,
      email_status, payment_method, order_type, quantity,
      entitlement_access_code, entitlement_week_start, entitlement_week_end,
      provider_reference, subtotal_amount, discount_amount,
      created_at, updated_at, completed_at
    )
    select
      upgrade.order_id,
      access.site_id,
      upgrade.amount,
      upgrade.currency,
      'COMPLETED',
      original.customer_email,
      original.customer_email,
      'NOT_REQUIRED',
      'stripe',
      'weekly_activation_addon',
      greatest(upgrade.bonus_activations, 1),
      upgrade.access_code,
      upgrade.week_start,
      (upgrade.week_start + interval '7 days')::date,
      coalesce(upgrade.payment_intent_id, upgrade.stripe_session_id),
      upgrade.amount,
      0,
      upgrade.created_at,
      now(),
      upgrade.completed_at
    from activation_upgrade_orders upgrade
    join access_codes access on access.code = upgrade.access_code
    left join lateral (
      select coalesce(nullif(orders.customer_email, ''), orders.payer_email) as customer_email
      from access_orders orders
      where orders.access_code = upgrade.access_code
      order by orders.completed_at desc nulls last, orders.created_at desc
      limit 1
    ) original on true
    where upgrade.status = 'COMPLETED'
      and upgrade.completed_at is not null
      and upgrade.week_start is not null
      and coalesce(upgrade.payment_intent_id, upgrade.stripe_session_id) is not null
    on conflict (order_id) do nothing
  `);
}

async function getActivationUpgradeUsage(accessCode, db = pool) {
  const accessResult = await db.query(
    `
      select code, site_id, active, weekly_limit, max_total_uses, delete_after_use, expires_at
      from access_codes
      where code = $1 and deleted_at is null
      limit 1
    `,
    [accessCode]
  );
  const access = accessResult.rows[0];
  if (!access || access.active !== true) throw new PublicError("This access code is no longer available.", 404, "unknown_code");
  if (access.expires_at && new Date(access.expires_at).getTime() <= Date.now()) {
    throw new PublicError("This access code has expired.", 410, "expired_code");
  }
  if (Boolean(access.delete_after_use) || Number(access.max_total_uses || 0) === 1) {
    throw new PublicError("Upgrades are not available for this access code.", 409, "upgrade_not_available");
  }

  const weekStart = getWeekStartUTC();
  const usageResult = await db.query(
    `
      select
        coalesce((select login_count from code_usage_weekly where code = $1 and week_start = $2::date), 0)::int as used,
        coalesce((
          select sum(bonus_activations)
          from activation_upgrade_orders
          where access_code = $1 and week_start = $2::date and status = 'COMPLETED'
        ), 0)::int as bonus
    `,
    [accessCode, weekStart]
  );
  const used = Number(usageResult.rows[0]?.used || 0);
  const bonus = Number(usageResult.rows[0]?.bonus || 0);
  const baseLimit = Math.max(1, Number(access.weekly_limit || ACCESS_WEEKLY_LIMIT));
  const limit = baseLimit + bonus;
  return {
    siteId: access.site_id,
    baseLimit,
    bonus,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    resetAt: getNextWeekStartUTC()
  };
}

async function getCheckoutPricing(promoCodeValue = "", siteIdValue = "", db = pool, { lockPromo = false } = {}) {
  await ensurePaymentTable();
  const subtotalCents = moneyToCents(PRICE);
  const minTotalCents = Math.max(1, moneyToCents(MIN_ORDER_TOTAL));
  const code = normalizePromoCode(promoCodeValue, { allowBlank: true });
  const siteId = String(siteIdValue || "").trim();

  if (!code) {
    return {
      currency: CURRENCY,
      subtotal: PRICE,
      discountAmount: "0.00",
      total: PRICE,
      promo: null
    };
  }

  const { rows } = await db.query(
    `
      select code, discount_type, discount_value, active, site_id, allow_free, max_redemptions, access_max_total_uses
      from promo_codes
      where code = $1
      limit 1
      ${lockPromo ? "for update" : ""}
    `,
    [code]
  );
  const promo = rows[0];
  if (!promo || !promo.active) {
    throw new PublicError("That promo code is not valid.", 404, "invalid_promo");
  }
  if (promo.site_id && promo.site_id !== siteId) {
    throw new PublicError("That promo code is not valid for the selected site.", 409, "promo_site_mismatch");
  }
  if (promo.max_redemptions) {
    const usage = await db.query(
      `select count(*)::int as redemptions from access_orders where promo_code = $1`,
      [code]
    );
    if (Number(usage.rows[0]?.redemptions || 0) >= Number(promo.max_redemptions)) {
      throw new PublicError("That promo code has already been used.", 409, "promo_used");
    }
  }
  const value = Number(promo.discount_value);
  let rawDiscountCents = 0;
  if (promo.discount_type === "percent") {
    rawDiscountCents = Math.round(subtotalCents * Math.min(100, Math.max(0, value)) / 100);
  } else if (promo.discount_type === "amount") {
    rawDiscountCents = moneyToCents(value);
  } else {
    throw new PublicError("That promo code is not configured correctly.", 409, "invalid_promo");
  }

  const maxDiscountCents = promo.allow_free ? subtotalCents : Math.max(0, subtotalCents - minTotalCents);
  const discountCents = Math.min(Math.max(0, rawDiscountCents), maxDiscountCents);
  if (discountCents <= 0) {
    throw new PublicError("That promo code does not reduce this order.", 409, "invalid_promo");
  }

  return {
    currency: CURRENCY,
    subtotal: centsToMoney(subtotalCents),
    discountAmount: centsToMoney(discountCents),
    total: centsToMoney(subtotalCents - discountCents),
    promo: {
      code: promo.code,
      type: promo.discount_type,
      value: centsToMoney(moneyToCents(promo.discount_value)),
      siteId: promo.site_id || "",
      allowFree: Boolean(promo.allow_free),
      maxRedemptions: promo.max_redemptions ? Number(promo.max_redemptions) : null,
      accessMaxTotalUses: promo.access_max_total_uses ? Number(promo.access_max_total_uses) : (promo.allow_free ? 1 : null)
    }
  };
}

async function completePaymentIntent(paymentIntentId) {
  validateOrderId(paymentIntentId);
  await ensurePaymentTable();

  const existing = await getPaymentOrder(paymentIntentId);
  if (!existing) {
    throw new PublicError("This Stripe payment was not created by this site.", 404, "order_not_found");
  }

  if (existing.status === "COMPLETED" && existing.access_code) {
    return finaliseCompletedOrder(existing);
  }

  const intent = await retrieveStripePaymentIntent(paymentIntentId);
  const verified = verifyCompletedPaymentIntent(intent, existing);
  const completed = await saveAccessCode(existing, verified);
  return finaliseCompletedOrder(completed);
}

async function retrieveStripePaymentIntent(paymentIntentId) {
  return stripeRequest(`payment_intents/${encodeURIComponent(paymentIntentId)}?expand[]=latest_charge`);
}

function verifyCompletedPaymentIntent(intent, storedOrder) {
  if (intent?.status !== "succeeded") {
    throw new PublicError("The Stripe payment is not complete.", 409, "payment_not_completed");
  }

  const siteId = String(intent.metadata?.site_id || "");
  const amount = centsToMoney(intent.amount_received || intent.amount || 0);
  const currency = normalizeCurrency(intent.currency || "");
  const latestCharge = typeof intent.latest_charge === "object" ? intent.latest_charge : null;
  const chargeId = String(latestCharge?.id || intent.id || "");

  if (siteId !== storedOrder.site_id) {
    throw new PublicError("The payment site does not match the selected site.", 409, "site_mismatch");
  }
  if (amount !== normalizeMoney(storedOrder.amount) || currency !== storedOrder.currency) {
    throw new PublicError("The completed payment amount is incorrect.", 409, "amount_mismatch");
  }
  if (!chargeId) {
    throw new PublicError("The completed Stripe payment could not be verified.", 409, "capture_missing");
  }

  return {
    captureId: chargeId,
    payerEmail: String(latestCharge?.billing_details?.email || intent.receipt_email || storedOrder.customer_email || "").slice(0, 320),
    paymentMethod: completedPaymentMethodFromStripe(latestCharge)
  };
}

function completedPaymentMethodFromStripe(charge) {
  const details = charge?.payment_method_details || {};
  if (details.type === "card") {
    const walletType = String(details.card?.wallet?.type || "").toLowerCase();
    if (walletType === "apple_pay") return "applepay";
    if (walletType === "google_pay") return "googlepay";
    return "card";
  }
  return String(details.type || "stripe").toLowerCase();
}

async function resendAccessEmail(orderId, customerEmailValue) {
  validateOrderId(orderId);
  const customerEmail = normalizeEmail(customerEmailValue);
  await ensurePaymentTable();

  const existing = await getPaymentOrder(orderId);
  if (!existing || existing.status !== "COMPLETED" || !existing.access_code) {
    throw new PublicError("The completed purchase could not be found.", 404, "order_not_found");
  }

  if (normalizeEmail(existing.customer_email) !== customerEmail) {
    throw new PublicError("The email address does not match this purchase.", 403, "email_mismatch");
  }

  const result = await ensureAccessCodeEmail(existing, { forceRetry: true });
  const accessMeta = await getAccessCodeMeta(result.row.access_code);
  return completedResponse(result.row, result.emailStatus, accessMeta);
}

async function saveAccessCode(storedOrder, verified) {
  const client = await pool.connect();
  let completedRow;

  try {
    await client.query("BEGIN");
    const lockedResult = await client.query(
      `select * from access_orders where order_id = $1 for update`,
      [storedOrder.order_id]
    );
    const locked = lockedResult.rows[0];

    if (!locked) throw new PublicError("Payment order was not found.", 404, "order_not_found");

    if (locked.status === "COMPLETED" && locked.access_code) {
      await client.query("COMMIT");
      return locked;
    }

    const code = await createAccessCodeForOrder(client, locked);

    const updatedResult = await client.query(
      `
        update access_orders
        set status = 'COMPLETED',
            access_code = $2,
            capture_id = $3,
            payer_email = $4,
            payment_method = $5,
            email_status = coalesce(email_status, 'PENDING'),
            completed_at = now(),
            updated_at = now()
        where order_id = $1
        returning *
      `,
      [locked.order_id, code, verified.captureId, verified.payerEmail || null, verified.paymentMethod || locked.payment_method || "stripe"]
    );
    await client.query("COMMIT");
    completedRow = updatedResult.rows[0];
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }

  return completedRow;
}

async function claimFreeAccessCode(siteId, customerEmailValue, promoCodeValue = "", analyticsSessionId = "", analyticsVisitorId = "") {
  const site = getSiteById(siteId);
  if (!site) throw new PublicError("Please select a valid site.", 400, "invalid_site");
  const customerEmail = normalizeEmail(customerEmailValue);
  const orderId = `FREE-${crypto.randomUUID()}`;
  const captureId = `FREE-${crypto.randomUUID()}`;
  await ensurePaymentTable();
  const client = await pool.connect();
  let completedRow;

  try {
    await client.query("BEGIN");
    const pricing = await getCheckoutPricing(promoCodeValue, site.id, client, { lockPromo: true });
    if (moneyToCents(pricing.total) > 0 || !pricing.promo?.allowFree) {
      throw new PublicError("That promo code does not make this site free.", 409, "not_free_promo");
    }

    const inserted = await client.query(
      `
        insert into access_orders
          (order_id, site_id, amount, currency, status, customer_email, email_status, payment_method,
           subtotal_amount, discount_amount, promo_code, access_code, capture_id, payer_email,
           completed_at, created_at, updated_at)
        values ($1, $2, 0::numeric, $3, 'COMPLETED', $4, 'PENDING', 'promo',
                $5::numeric, $6::numeric, $7, null, $8, $4, now(), now(), now())
        returning *
      `,
      [orderId, site.id, CURRENCY, customerEmail, pricing.subtotal, pricing.discountAmount, pricing.promo.code, captureId]
    );
    const order = inserted.rows[0];
    const code = await createAccessCodeForOrder(client, order);
    const updated = await client.query(
      `
        update access_orders
        set access_code = $2,
            updated_at = now()
        where order_id = $1
        returning *
      `,
      [order.order_id, code]
    );
    await client.query("COMMIT");
    completedRow = updated.rows[0];
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }

  await markSiteInterestConverted({
    orderId,
    siteId: site.id,
    analyticsSessionId,
    analyticsVisitorId
  });
  return finaliseCompletedOrder(completedRow);
}

async function createAccessCodeForOrder(client, order) {
  const accessMaxTotalUses = await getPromoAccessMaxTotalUses(client, order.promo_code);
  const deleteAfterUse = Number(accessMaxTotalUses || 0) === 1;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = generateAccessCode(CODE_LENGTH);
    const inserted = await client.query(
      `
        insert into access_codes (code, site_id, active, source, weekly_limit, max_total_uses, delete_after_use, expires_at)
        values ($1, $2, true, 'payment', $5, $3, $4, now() + ($6 * interval '1 year'))
        on conflict (code) do nothing
        returning code
      `,
      [candidate, order.site_id, accessMaxTotalUses, deleteAfterUse, ACCESS_WEEKLY_LIMIT, ACCESS_DURATION_YEARS]
    );
    if (inserted.rows[0]?.code) return inserted.rows[0].code;
  }
  throw new Error("Could not generate a unique access code");
}

async function getPromoAccessMaxTotalUses(db, promoCode) {
  const code = String(promoCode || "").trim().toUpperCase();
  if (!code) return null;
  const { rows } = await db.query(
    `select access_max_total_uses, allow_free from promo_codes where code = $1 limit 1`,
    [code]
  );
  const value = Number(rows[0]?.access_max_total_uses || 0);
  if ((!Number.isInteger(value) || value <= 0) && rows[0]?.allow_free) return 1;
  return Number.isInteger(value) && value > 0 ? value : null;
}

async function finaliseCompletedOrder(row) {
  const result = await ensureAccessCodeEmail(row);
  const accessMeta = await getAccessCodeMeta(result.row.access_code);
  return completedResponse(result.row, result.emailStatus, accessMeta);
}

async function ensureAccessCodeEmail(row, { forceRetry = false } = {}) {
  if (!row?.customer_email) return { row, emailStatus: "MISSING" };
  if (row.email_status === "SENT") return { row, emailStatus: "SENT" };
  if (!RESEND_API_KEY || !EMAIL_FROM) return { row, emailStatus: "NOT_CONFIGURED" };

  const statuses = forceRetry
    ? ["PENDING", "FAILED", "NOT_CONFIGURED"]
    : ["PENDING", "FAILED", "NOT_CONFIGURED"];

  const claimedResult = await pool.query(
    `
      update access_orders
      set email_status = 'SENDING',
          email_error = null,
          updated_at = now()
      where order_id = $1
        and (
          email_status is null
          or email_status = any($2::text[])
          or (email_status = 'SENDING' and updated_at < now() - interval '5 minutes')
        )
      returning *
    `,
    [row.order_id, statuses]
  );

  if (!claimedResult.rows[0]) {
    const latest = await getPaymentOrder(row.order_id);
    return { row: latest || row, emailStatus: latest?.email_status || "PENDING" };
  }

  const claimed = claimedResult.rows[0];
  try {
    const emailId = await sendAccessCodeEmail(claimed);
    const sentResult = await pool.query(
      `
        update access_orders
        set email_status = 'SENT',
            email_id = $2,
            email_sent_at = now(),
            email_error = null,
            updated_at = now()
        where order_id = $1
        returning *
      `,
      [claimed.order_id, emailId]
    );
    return { row: sentResult.rows[0], emailStatus: "SENT" };
  } catch (error) {
    console.error("[stripe-checkout] email failed:", error?.stack || error);
    const failedResult = await pool.query(
      `
        update access_orders
        set email_status = 'FAILED',
            email_error = $2,
            updated_at = now()
        where order_id = $1
        returning *
      `,
      [claimed.order_id, String(error?.message || error).slice(0, 1000)]
    );
    return { row: failedResult.rows[0] || claimed, emailStatus: "FAILED" };
  }
}

async function sendAccessCodeEmail(row) {
  const site = getSiteById(row.site_id);
  const siteName = site?.name || row.site_id;
  const siteAddress = site?.address || "";
  const activateUrl = `${PUBLIC_SITE_URL}/activate.html`;
  const accessMeta = await getAccessCodeMeta(row.access_code);
  const isFreeTrial = isFreeTrialAccess(accessMeta);
  const subject = isFreeTrial ? `Your free trial laundry code: ${row.access_code}` : `Your laundry access code: ${row.access_code}`;

  const text = [
    isFreeTrial ? `Your free trial laundry code is ${row.access_code}.` : `Your laundry access code is ${row.access_code}.`,
    `Site: ${siteName}`,
    siteAddress ? `Address: ${siteAddress}` : "",
    isFreeTrial ? "Access term: temporary free trial" : `Access term: ${accessDurationLabel()} from purchase`,
    isFreeTrial ? "Allowance: 1 machine activation to test the product" : `Weekly allowance: up to ${ACCESS_WEEKLY_LIMIT} machine activations`,
    `Activate your machine: ${activateUrl}`,
    `Stripe checkout: ${row.order_id}`,
    `Support: ${SUPPORT_PUBLIC_EMAIL}`
  ].filter(Boolean).join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
      <h1 style="font-size:24px;margin:0 0 12px">${isFreeTrial ? "Your free trial code" : "Your laundry access code"}</h1>
      <p style="margin:0 0 8px;color:#475569">${isFreeTrial ? "Free trial ready" : "Payment confirmed"} for ${escapeHtml(siteName)}.</p>
      <p style="margin:0 0 20px;color:#475569">${isFreeTrial ? "<strong>Temporary free trial</strong> for 1 machine activation to test the product." : `<strong>Valid for ${escapeHtml(accessDurationLabel())}</strong> with up to ${ACCESS_WEEKLY_LIMIT} machine activations per week.`}</p>
      <div style="padding:20px;border-radius:14px;background:#ecfeff;border:1px solid #a5f3fc;text-align:center">
        <div style="font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:#0e7490">Access code</div>
        <div style="margin-top:8px;font-size:36px;font-weight:800;letter-spacing:.14em;color:#0f172a">${escapeHtml(row.access_code)}</div>
      </div>
      <p style="margin:20px 0 4px"><strong>${escapeHtml(siteName)}</strong></p>
      ${siteAddress ? `<p style="margin:0 0 20px;color:#475569">${escapeHtml(siteAddress)}</p>` : ""}
      <p style="margin:22px 0">
        <a href="${escapeHtml(activateUrl)}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#0891b2;color:white;text-decoration:none;font-weight:700">Activate machine</a>
      </p>
      <p style="font-size:12px;color:#64748b">Stripe checkout: ${escapeHtml(row.order_id)}</p>
      <p style="font-size:12px;color:#64748b">Need help? <a href="${escapeHtml(PUBLIC_SITE_URL)}/support.html?source=%2Femail" style="color:#0e7490">Contact support</a></p>
    </div>`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `laundry-access-${row.order_id}`
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [row.customer_email],
      subject,
      html,
      text
    })
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.id) {
    throw new Error(body?.message || `Resend returned ${response.status}`);
  }
  return String(body.id);
}

async function getAccessCodeMeta(code) {
  const value = String(code || "").trim();
  if (!value) return {};
  const { rows } = await pool.query(
    `select max_total_uses, delete_after_use from access_codes where code = $1 limit 1`,
    [value]
  );
  return rows[0] || {};
}

function isFreeTrialAccess(accessMeta = {}) {
  return Boolean(accessMeta.delete_after_use) && Number(accessMeta.max_total_uses || 1) <= 1;
}

function completedResponse(row, emailStatusOverride = "", accessMeta = {}) {
  const site = getSiteById(row.site_id);
  const emailStatus = emailStatusOverride || row.email_status || "PENDING";
  const isFreeTrial = isFreeTrialAccess(accessMeta);
  return {
    code: row.access_code,
    orderId: row.order_id,
    email: row.customer_email || "",
    emailSent: emailStatus === "SENT",
    emailStatus,
    amount: centsToMoney(moneyToCents(row.amount || PRICE)),
    subtotal: centsToMoney(moneyToCents(row.subtotal_amount || row.amount || PRICE)),
    discountAmount: centsToMoney(moneyToCents(row.discount_amount || 0)),
    promoCode: row.promo_code || "",
    accessTerm: isFreeTrial ? "free_trial" : `${ACCESS_DURATION_YEARS}_year`,
    weeklyLimit: isFreeTrial ? 1 : ACCESS_WEEKLY_LIMIT,
    maxTotalUses: accessMeta.max_total_uses ? Number(accessMeta.max_total_uses) : null,
    deleteAfterUse: Boolean(accessMeta.delete_after_use),
    site: {
      id: row.site_id,
      name: site?.name || row.site_id,
      address: site?.address || ""
    }
  };
}

async function getPaymentOrder(orderId) {
  const { rows } = await pool.query(
    `select * from access_orders where order_id = $1 limit 1`,
    [orderId]
  );
  return rows[0] || null;
}

async function ensurePaymentTable() {
  if (paymentTableReady) return;

  // Rename historical provider-specific storage before creating the canonical
  // table so an existing deployment never forks into two order sources.
  await ensureOrderStorage(pool);

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
    create table if not exists promo_codes (
      code text primary key,
      discount_type text not null check (discount_type in ('percent', 'amount')),
      discount_value numeric(10, 2) not null check (discount_value > 0),
      active boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await pool.query(`
    alter table promo_codes
      add column if not exists discount_type text not null default 'percent',
      add column if not exists discount_value numeric(10, 2) not null default 10,
      add column if not exists active boolean not null default true,
      add column if not exists site_id text,
      add column if not exists allow_free boolean not null default false,
      add column if not exists max_redemptions integer,
      add column if not exists access_max_total_uses integer,
      add column if not exists created_at timestamptz not null default now(),
      add column if not exists updated_at timestamptz not null default now()
  `);

  await pool.query(`
    create table if not exists access_orders (
      order_id text primary key,
      site_id text not null,
      amount numeric(10, 2) not null,
      currency varchar(3) not null,
      status text not null default 'CREATED',
      access_code text unique,
      capture_id text unique,
      payer_email text,
      customer_email text,
      payment_method text not null default 'unknown',
      order_type text not null default 'access_code',
      quantity integer not null default 1,
      entitlement_access_code text,
      entitlement_week_start date,
      entitlement_week_end date,
      provider_reference text,
      subtotal_amount numeric(10, 2),
      discount_amount numeric(10, 2) not null default 0,
      promo_code text references promo_codes(code),
      email_status text default 'PENDING',
      email_id text,
      email_error text,
      email_sent_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      completed_at timestamptz
    )
  `);

  await pool.query(`
    create table if not exists checkout_create_order_attempts (
      id bigserial primary key,
      ip_hash text not null,
      email_hash text not null,
      site_id text,
      payment_method text,
      user_agent text,
      created_at timestamptz not null default now()
    )
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
    create table if not exists activation_upgrade_orders (
      order_id text primary key,
      stripe_session_id text unique,
      payment_intent_id text unique,
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
  await pool.query(`alter table activation_upgrade_orders add column if not exists payment_intent_id text`);
  await pool.query(`create unique index if not exists activation_upgrade_payment_intent_idx on activation_upgrade_orders(payment_intent_id) where payment_intent_id is not null`);
  await pool.query(`create index if not exists activation_upgrade_code_week_idx on activation_upgrade_orders(access_code, week_start, status)`);
  await pool.query(`create index if not exists checkout_attempts_ip_created_idx on checkout_create_order_attempts(ip_hash, created_at desc)`);
  await pool.query(`create index if not exists checkout_attempts_email_created_idx on checkout_create_order_attempts(email_hash, created_at desc)`);

  await pool.query(`
    alter table access_orders
      add column if not exists customer_email text,
      add column if not exists payment_method text,
      add column if not exists order_type text not null default 'access_code',
      add column if not exists quantity integer not null default 1,
      add column if not exists entitlement_access_code text,
      add column if not exists entitlement_week_start date,
      add column if not exists entitlement_week_end date,
      add column if not exists provider_reference text,
      add column if not exists subtotal_amount numeric(10, 2),
      add column if not exists discount_amount numeric(10, 2) not null default 0,
      add column if not exists promo_code text,
      add column if not exists email_status text default 'PENDING',
      add column if not exists email_id text,
      add column if not exists email_error text,
      add column if not exists email_sent_at timestamptz
  `);

  await pool.query(`
    update access_orders
    set subtotal_amount = amount,
        order_type = coalesce(nullif(order_type, ''), 'access_code'),
        quantity = greatest(coalesce(quantity, 1), 1)
    where subtotal_amount is null or order_type is null or order_type = '' or quantity is null or quantity < 1
  `);
  await pool.query(`alter table access_orders drop constraint if exists access_orders_provider_reference_key`);
  await pool.query(`drop index if exists access_orders_provider_reference_idx`);
  await pool.query(`create unique index if not exists access_orders_provider_reference_provider_idx on access_orders(payment_method, provider_reference) where provider_reference is not null`);
  await pool.query(`create index if not exists access_orders_type_completed_idx on access_orders(order_type, completed_at desc) where status = 'COMPLETED'`);
  await backfillCompletedActivationUpgradeOrders(pool);

  await pool.query(`
    alter table access_codes
      add column if not exists created_at timestamptz not null default now(),
      add column if not exists source text,
      add column if not exists weekly_limit integer not null default 4,
      add column if not exists max_total_uses integer,
      add column if not exists delete_after_use boolean not null default false,
      add column if not exists deleted_at timestamptz,
      add column if not exists expires_at timestamptz
  `);

  await pool.query(`
    update access_codes
    set expires_at = created_at + interval '1 year'
    where expires_at is null and source = 'payment'
  `);

  paymentTableReady = true;
}

async function enforceCreateOrderRateLimit({ event, customerEmail, siteId, paymentMethod }) {
  const ipHash = hashRateLimitValue(getClientIp(event) || "unknown");
  const emailHash = hashRateLimitValue(customerEmail);
  const userAgent = getHeader(event, "user-agent").slice(0, 500);

  await pool.query(
    `
      insert into checkout_create_order_attempts (ip_hash, email_hash, site_id, payment_method, user_agent)
      values ($1, $2, $3, $4, $5)
    `,
    [ipHash, emailHash, siteId, paymentMethod, userAgent]
  );

  const { rows } = await pool.query(
    `
      select count(*)::int as attempts
      from checkout_create_order_attempts
      where created_at >= now() - ($1 || ' minutes')::interval
        and (ip_hash = $2 or email_hash = $3)
    `,
    [String(CREATE_ORDER_WINDOW_MINUTES), ipHash, emailHash]
  );

  const attempts = Number(rows[0]?.attempts || 0);
  if (attempts > CREATE_ORDER_LIMIT) {
    throw new PublicError(
      "Too many checkout attempts. Please wait a few minutes and try again.",
      429,
      "too_many_checkout_attempts"
    );
  }

  await pool.query(
    `delete from checkout_create_order_attempts where created_at < now() - ($1 || ' minutes')::interval`,
    [String(Math.max(CREATE_ORDER_ATTEMPT_RETENTION_MINUTES, CREATE_ORDER_WINDOW_MINUTES))]
  );
}

function accessDurationLabel() {
  return ACCESS_DURATION_YEARS === 1 ? "1 year" : `${ACCESS_DURATION_YEARS} years`;
}

function publicAccessProduct() {
  return {
    name: ACCESS_DURATION_YEARS === 1 ? "1-year access" : `${ACCESS_DURATION_YEARS}-year access`,
    durationYears: ACCESS_DURATION_YEARS,
    durationLabel: accessDurationLabel(),
    weeklyLimit: ACCESS_WEEKLY_LIMIT,
    price: PRICE,
    currency: CURRENCY,
    billing: "one_time",
    renews: false
  };
}

async function markSiteInterestConverted({ orderId, siteId, analyticsSessionId, analyticsVisitorId }) {
  const sessionHash = hashSiteHitValue(analyticsSessionId);
  const visitorHash = hashSiteHitValue(analyticsVisitorId);
  if (!sessionHash && !visitorHash) return;

  try {
    const tableResult = await pool.query(`select to_regclass('public.site_interest_hits') as table_name`);
    if (!tableResult.rows[0]?.table_name) return;

    await pool.query(`
      alter table site_interest_hits
        add column if not exists order_id text,
        add column if not exists converted_at timestamptz
    `);
    await pool.query(
      `
        update site_interest_hits
        set order_id = $1,
            converted_at = now()
        where id in (
          select id
          from site_interest_hits
          where site_id = $2
            and is_bot = false
            and order_id is null
            and created_at >= now() - ($5 || ' days')::interval
            and (
              ($3::text is not null and session_hash = $3)
              or ($4::text is not null and visitor_hash = $4)
            )
          order by created_at desc
          limit 1
        )
      `,
      [orderId, siteId, sessionHash, visitorHash, String(SITE_HIT_DEDUPE_DAYS)]
    );
  } catch (error) {
    console.warn("[stripe-checkout] could not mark site interest conversion:", error?.message || error);
  }
}

async function stripeRequest(path, { method = "GET", body = null, idempotencyKey = "" } = {}) {
  const headers = {
    Authorization: `Bearer ${requireEnv("STRIPE_SECRET_KEY")}`
  };
  if (body) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const response = await fetch(`${STRIPE_API_BASE}/${path}`, {
    method,
    headers,
    ...(body ? { body: body.toString() } : {})
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error("[stripe-checkout] Stripe API failed:", response.status, data);
    throw new PublicError(
      data?.error?.message || "Stripe could not process the checkout.",
      response.status >= 500 ? 502 : 400,
      data?.error?.code || "stripe_request_failed"
    );
  }
  return data;
}

function generateAccessCode(length = 5) {
  const bytes = crypto.randomBytes(length);
  let output = "";
  for (const byte of bytes) output += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return output;
}

function validateOrderId(orderId) {
  if (!/^[A-Za-z0-9_-]{6,255}$/.test(orderId)) {
    throw new PublicError("Invalid payment reference.", 400, "invalid_order");
  }
}

function validateCheckoutSessionId(sessionId) {
  if (!/^cs_(?:test_|live_)?[A-Za-z0-9_]{6,255}$/.test(sessionId)) {
    throw new PublicError("Invalid upgrade payment reference.", 400, "invalid_order");
  }
}

function normalizeAccessCode(value) {
  const code = String(value || "").trim();
  if (!code || code.length > 64 || /[\u0000-\u001f\u007f]/.test(code)) {
    throw new PublicError("Enter a valid access code.", 400, "invalid_access_code");
  }
  return code;
}

function getWeekStartUTC(date = new Date()) {
  const value = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
  return value.toISOString().slice(0, 10);
}

function getNextWeekStartUTC(date = new Date()) {
  const value = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const daysUntilMonday = (8 - value.getUTCDay()) % 7 || 7;
  value.setUTCDate(value.getUTCDate() + daysUntilMonday);
  return value.toISOString();
}

function activationUpgradeReturnBase(event) {
  const origin = getHeader(event, "origin");
  try {
    const parsed = new URL(origin);
    const isLoopback = ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
    if (isLoopback && ["http:", "https:"].includes(parsed.protocol)) return parsed.origin;
  } catch (_) {}
  return PUBLIC_SITE_URL;
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new PublicError("Enter a valid email address.", 400, "invalid_email");
  }
  return email;
}

function normalizeCardholderName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 300);
}

function normalizeCurrency(value) {
  const currency = String(value || "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error("ACCESS_CODE_CURRENCY must be a 3-letter currency code");
  }
  return currency;
}

function normalizeMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error("ACCESS_CODE_PRICE must be a positive number");
  }
  return number.toFixed(2);
}

function moneyToCents(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.round(number * 100));
}

function centsToMoney(value) {
  const cents = Number.isFinite(Number(value)) ? Number(value) : 0;
  return (Math.max(0, Math.round(cents)) / 100).toFixed(2);
}

function normalizePromoCode(value, { allowBlank = false } = {}) {
  const code = String(value || "").trim().toUpperCase();
  if (!code && allowBlank) return "";
  if (!/^[A-Z0-9]{3,32}$/.test(code)) {
    throw new PublicError("Promo codes use 3-32 uppercase letters and numbers.", 400, "invalid_promo_code");
  }
  return code;
}

function normalizeCodeLength(value) {
  const length = Number.parseInt(String(value), 10);
  if (!Number.isInteger(length) || length < 4 || length > 12) {
    throw new Error("ACCESS_CODE_LENGTH must be a whole number between 4 and 12");
  }
  return length;
}

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
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

function hashRateLimitValue(value) {
  const salt = String(process.env.CREATE_ORDER_RATE_LIMIT_SALT || PUBLIC_SITE_URL || "laundry-checkout");
  return crypto
    .createHash("sha256")
    .update(`${salt}:${String(value || "").trim().toLowerCase()}`)
    .digest("hex");
}

function hashSiteHitValue(value) {
  const clean = String(value || "").trim();
  if (!clean) return null;
  return crypto
    .createHash("sha256")
    .update(`${SITE_HIT_SALT}:${clean.toLowerCase()}`)
    .digest("hex");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function requireEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new PublicError(`${name} is not configured.`, 500, "stripe_not_configured");
  }
  return value;
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

exports._test = {
  persistActivationUpgradeOrder,
  backfillCompletedActivationUpgradeOrders,
  getWeekStartUTC
};
