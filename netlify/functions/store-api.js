const crypto = require("crypto");
const { Pool } = require("pg");
const {
  createUniqueStoreCode,
  createUniqueStoreOrderNumber,
  ensureStoreSchema,
  maintainStoreOrders,
  normalizeStoreCode,
  normalizeStoreEmail
} = require("./_store-db");
const { STRIPE_GBP_MINIMUM_CHARGE_CENTS, calculateCreditRedemption } = require("./_store-credit");

const pool = new Pool({
  connectionString: process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const STRIPE_API_BASE = "https://api.stripe.com/v1";
const REFERRAL_CREDIT_AMOUNT = "5.00";
const STORE_REFERRAL_LIMIT = 5;
const STORE_ORDER_STALE_HOURS = clampInt(process.env.STORE_ORDER_STALE_HOURS, 1, 168, 24);
const RESEND_API_KEY = String(process.env.RESEND_API_KEY || "").trim();
const STORE_EMAIL_FROM = String(
  process.env.STORE_EMAIL_FROM || process.env.ACCESS_CODE_EMAIL_FROM || "CircuitWash <support@circuitwash.com>"
).trim();
const SUPPORT_PUBLIC_EMAIL = String(process.env.SUPPORT_PUBLIC_EMAIL || "support@circuitwash.com").trim();
const PUBLIC_SITE_URL = String(
  process.env.PUBLIC_SITE_URL || process.env.URL || "https://circuitwash.com"
).trim().replace(/\/+$/, "");

class StoreError extends Error {
  constructor(message, statusCode = 400, code = "request_failed") {
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
      return json({ ok: false, error: "bad_request" }, 400);
    }

    await ensureStoreSchema(pool);
    const action = String(body.action || "").trim();

    if (action === "authenticate") return json({ ok: true, ...(await authenticate(body.accessCode)) });
    if (action === "create_invite") return json({ ok: true, ...(await createInvite(body)) }, 201);
    if (action === "create_payment_intent") return json({ ok: true, ...(await createPaymentIntent(body)) }, 201);
    if (action === "complete_payment_intent") return json({ ok: true, ...(await completePaymentIntent(body)) });
    if (action === "abandon_payment_intent") return json({ ok: true, ...(await abandonPaymentIntent(body)) });
    if (action === "get_order") return json({ ok: true, ...(await getOrder(body)) });
    if (action === "cancel_order") return json({ ok: true, ...(await cancelOrder(body)) });

    return json({ ok: false, error: "unknown_action" }, 400);
  } catch (error) {
    if (error instanceof StoreError) {
      return json({ ok: false, error: error.code, message: error.message }, error.statusCode);
    }
    if (error?.code === "23505") {
      return json({ ok: false, error: "already_invited", message: "That email already has store access." }, 409);
    }
    console.error("[store-api] fatal:", error?.stack || error);
    return json({ ok: false, error: "server_error", message: "Store request failed." }, 500);
  }
};

async function authenticate(accessCodeValue) {
  await maintainStoreOrders(pool, { staleHours: STORE_ORDER_STALE_HOURS });
  let member;
  try {
    member = await requireMember(accessCodeValue, pool, { touch: true });
  } catch (error) {
    if (!(error instanceof StoreError) || error.statusCode !== 401) throw error;
    member = await redeemInviteCode(accessCodeValue);
  }
  if (member.popup_enabled && !member.popup_claimed_at) {
    await pool.query(`
      update store_members set popup_claimed_at = now(), updated_at = now() where id = $1
    `, [member.id]);
  }
  const [productsResult, invitesResult, ordersResult] = await Promise.all([
    pool.query(`
      select id, name, description, price, currency, image_url, sort_order
      from store_products
      where active = true
      order by sort_order asc, created_at asc, id asc
    `),
    pool.query(`
      select
        invited.id,
        invited.access_code,
        invited.invite_code,
        invited.invite_redeemed_at,
        invited.email,
        invited.active,
        invited.invite_limit,
        invited.invite_count,
        invited.popup_claimed_at,
        invited.last_used_at,
        invited.created_at,
        count(orders.order_id) filter (where orders.status = 'COMPLETED')::int as completed_orders
      from store_members invited
      left join store_orders orders on orders.member_id = invited.id
      where invited.invited_by_id = $1
      group by invited.id
      order by invited.created_at desc
      limit 100
    `, [member.id]),
    pool.query(`
      select order_id, order_number, member_id, product_name, image_url, quantity, amount,
             subtotal_amount, credit_applied, credit_refunded_at, currency,
             customer_email, recipient_name, address_line1, address_line2, city, postcode, country,
             status, fulfilment_status, payment_verified_at, created_at, completed_at, fulfilled_at
      from store_orders
      where member_id = $1
        and status = 'COMPLETED'
      order by created_at desc
      limit 50
    `, [member.id])
  ]);

  return {
    publishableKey: requireEnv("STRIPE_PUBLISHABLE_KEY"),
    environment: requireEnv("STRIPE_SECRET_KEY").startsWith("sk_live_") ? "live" : "test",
    member: serializeMember(member, invitesResult.rows),
    products: productsResult.rows.map(serializeProduct),
    invitations: invitesResult.rows.map(serializeInvitation),
    // The customer Orders tab opens details from this response before it may
    // request get_order, so return the full customer-owned order shape here.
    orders: ordersResult.rows.map(serializeOrder)
  };
}

async function redeemInviteCode(inviteCodeValue) {
  const inviteCode = normalizeStoreCode(inviteCodeValue);
  if (!inviteCode) throw new StoreError("Enter a valid store access code.", 401, "unauthorized");

  const client = await pool.connect();
  try {
    await client.query("begin");
    const inviteResult = await client.query(`
      select *
      from store_members
      where invite_code = $1
        and invited_by_id is not null
      limit 1
      for update
    `, [inviteCode]);
    const invite = inviteResult.rows[0];
    if (!invite) throw new StoreError("This invite code is not active.", 401, "unauthorized");
    if (invite.invite_redeemed_at) {
      throw new StoreError("This invite has already been accepted. Use your store code to sign in.", 409, "invite_already_redeemed");
    }

    const accessCode = await createUniqueStoreCode(client, 6);
    const updated = await client.query(`
      update store_members
      set access_code = $2,
          active = true,
          invite_redeemed_at = now(),
          last_used_at = now(),
          updated_at = now()
      where id = $1
      returning *
    `, [invite.id, accessCode]);
    await client.query(`
      update store_members
      set invite_count = least($2, invite_count + 1),
          updated_at = now()
      where id = $1
    `, [invite.invited_by_id, STORE_REFERRAL_LIMIT]);
    await client.query("commit");
    return updated.rows[0];
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function createInvite(body) {
  const accessCode = normalizeStoreCode(body.accessCode);
  if (!accessCode) throw new StoreError("Enter a valid store access code.", 401, "unauthorized");

  const client = await pool.connect();
  let invitation;
  try {
    await client.query("begin");
    const inviter = await requireMember(accessCode, client, { lock: true });
    const inviteState = await client.query(`
      select
        count(*) filter (
          where invited.invite_redeemed_at is not null
            or invited.popup_claimed_at is not null
            or invited.last_used_at is not null
            or exists (
              select 1
              from store_orders orders
              where orders.member_id = invited.id
                and orders.status = 'COMPLETED'
            )
        )::int as accepted_invites,
        count(*) filter (
          where (
              invited.invite_code is not null
              and invited.invite_redeemed_at is null
            )
            or (
              invited.invite_code is null
              and invited.active = true
              and invited.popup_claimed_at is null
              and invited.last_used_at is null
              and not exists (
                select 1
                from store_orders orders
                where orders.member_id = invited.id
                  and orders.status = 'COMPLETED'
              )
            )
        )::int as pending_invites
      from store_members invited
      where invited.invited_by_id = $1
    `, [inviter.id]);
    if (Number(inviteState.rows[0]?.accepted_invites || 0) >= STORE_REFERRAL_LIMIT) {
      throw new StoreError("You have used all 5 referral codes.", 409, "referral_limit_reached");
    }
    if (Number(inviteState.rows[0]?.pending_invites || 0) > 0) {
      throw new StoreError(
        "Wait for your pending invite to be accepted before creating another code.",
        409,
        "pending_referral"
      );
    }

    const inviteCode = await createUniqueStoreCode(client, 6);
    const holdingCode = await createUniqueStoreCode(client, 12);
    const inserted = await client.query(`
      insert into store_members
        (access_code, invite_code, email, active, invited_by_id, invite_limit, invite_count, source, created_at, updated_at)
      values ($1, $2, $3, false, $4, $5, 0, 'MEMBER', now(), now())
      returning *
    `, [holdingCode, inviteCode, null, inviter.id, STORE_REFERRAL_LIMIT]);
    invitation = inserted.rows[0];
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  const link = storeInviteLink(invitation.invite_code);

  return {
    invitation: serializeInvitation({ ...invitation, completed_orders: 0 }),
    link,
    emailStatus: "NOT_REQUESTED"
  };
}

async function cancelOrder(body) {
  const orderId = String(body.orderId || "").trim();
  if (!/^[A-Za-z0-9_-]{6,255}$/.test(orderId)) {
    throw new StoreError("Invalid order.", 400, "invalid_order");
  }
  const client = await pool.connect();
  try {
    await client.query("begin");
    const member = await requireMember(body.accessCode, client, { lock: true });
    const updated = await client.query(`
      update store_orders
      set fulfilment_status = 'CANCELLED',
          fulfilled_at = null,
          updated_at = now()
      where order_id = $1
        and member_id = $2
        and status = 'COMPLETED'
        and fulfilment_status = 'PENDING'
      returning *
    `, [orderId, member.id]);
    if (!updated.rows.length) {
      throw new StoreError("Only pending orders can be cancelled.", 409, "order_not_pending");
    }
    let order = updated.rows[0];
    const creditApplied = Number(order.credit_applied) || 0;
    if (creditApplied > 0 && !order.credit_refunded_at) {
      await client.query(`
        update store_members
        set store_credit_balance = store_credit_balance + $2::numeric, updated_at = now()
        where id = $1
      `, [member.id, creditApplied.toFixed(2)]);
      const refunded = await client.query(`
        update store_orders set credit_refunded_at = now(), updated_at = now() where order_id = $1 returning *
      `, [orderId]);
      order = refunded.rows[0] || order;
    }
    await client.query("commit");
    return { order: serializeOrder(order) };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function abandonPaymentIntent(body) {
  const member = await requireMember(body.accessCode);
  const paymentIntentId = String(body.paymentIntentId || "").trim();
  if (!/^pi_[A-Za-z0-9_]{6,255}$/.test(paymentIntentId)) {
    throw new StoreError("Invalid payment reference.", 400, "invalid_order");
  }
  const orderResult = await pool.query(`
    select * from store_orders where order_id = $1 and member_id = $2 and status = 'CREATED' limit 1
  `, [paymentIntentId, member.id]);
  if (!orderResult.rows.length) return { abandoned: false };

  const intent = await stripeRequest(`payment_intents/${encodeURIComponent(paymentIntentId)}`);
  if (intent.status === "succeeded") {
    throw new StoreError("Payment has already completed.", 409, "payment_already_completed");
  }
  if (intent.status !== "canceled") {
    await stripeRequest(`payment_intents/${encodeURIComponent(paymentIntentId)}/cancel`, { method: "POST" });
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    await requireMember(body.accessCode, client, { lock: true });
    const locked = await client.query(`
      select * from store_orders
      where order_id = $1 and member_id = $2 and status = 'CREATED'
      limit 1 for update
    `, [paymentIntentId, member.id]);
    const order = locked.rows[0];
    if (!order) {
      await client.query("commit");
      return { abandoned: false };
    }
    const creditApplied = Number(order.credit_applied) || 0;
    if (creditApplied > 0 && !order.credit_refunded_at) {
      await client.query(`
        update store_members
        set store_credit_balance = store_credit_balance + $2::numeric, updated_at = now()
        where id = $1
      `, [member.id, creditApplied.toFixed(2)]);
    }
    await client.query(`delete from store_orders where order_id = $1`, [paymentIntentId]);
    await client.query("commit");
    return { abandoned: true, creditRestored: creditApplied.toFixed(2) };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function getOrder(body) {
  const member = await requireMember(body.accessCode);
  const orderId = String(body.orderId || "").trim();
  if (!/^[A-Za-z0-9_-]{6,255}$/.test(orderId)) {
    throw new StoreError("Invalid order.", 400, "invalid_order");
  }
  const result = await pool.query(`
    select *
    from store_orders
    where order_id = $1
      and member_id = $2
      and status = 'COMPLETED'
    limit 1
  `, [orderId, member.id]);
  if (!result.rows.length) throw new StoreError("Store order not found.", 404, "order_not_found");
  return { order: serializeOrder(result.rows[0]) };
}

async function createPaymentIntent(body) {
  await maintainStoreOrders(pool, { staleHours: STORE_ORDER_STALE_HOURS });
  const productId = positiveId(body.productId, "Select a product.");
  const quantity = clampInt(body.quantity, 1, 5, 1);
  const customerEmail = normalizeStoreEmail(body.customerEmail);
  if (!customerEmail) throw new StoreError("Enter a valid email address.", 400, "invalid_email");
  const address = normalizeAddress(body.address);
  const client = await pool.connect();
  let intent = null;
  try {
    await client.query("begin");
    const member = await requireMember(body.accessCode, client, { lock: true });
    const productResult = await client.query(`
      select id, name, description, price, currency, image_url
      from store_products
      where id = $1 and active = true
      limit 1
    `, [productId]);
    const product = productResult.rows[0];
    if (!product) throw new StoreError("That product is no longer available.", 404, "product_unavailable");

    const unitPriceCents = moneyToCents(product.price);
    const subtotalCents = unitPriceCents * quantity;
    if (subtotalCents < 1) throw new StoreError("This product cannot be purchased.", 409, "invalid_price");
    const currency = normalizeCurrency(product.currency);
    const redemption = calculateCreditRedemption(subtotalCents, member.store_credit_balance, currency);
    if (redemption.amountCents > 0 && redemption.amountCents < STRIPE_GBP_MINIMUM_CHARGE_CENTS) {
      throw new StoreError("This order total is below the minimum card charge.", 409, "amount_too_small");
    }
    const requestId = crypto.randomUUID();
    const orderNumber = await createUniqueStoreOrderNumber(client);

    if (redemption.amountCents === 0) {
      const order = await insertStoreOrder(client, {
        orderId: `credit_${requestId.replace(/-/g, "")}`,
        orderNumber,
        member,
        product,
        unitPriceCents,
        quantity,
        subtotalCents,
        creditAppliedCents: redemption.creditAppliedCents,
        amountCents: 0,
        currency,
        customerEmail,
        address,
        status: "COMPLETED",
        paymentMethod: "credit"
      });
      await deductStoreCredit(client, member.id, redemption.creditAppliedCents);
      await client.query("commit");
      await awardReferralCredit(order, member).catch((error) => {
        console.error("[store-api] referral credit award failed:", error?.stack || error);
      });
      return {
        paidWithCredit: true,
        order: serializeOrder({ ...order, payment_verified: true }),
        orderNumber,
        subtotal: centsToMoney(subtotalCents),
        creditApplied: centsToMoney(redemption.creditAppliedCents),
        amount: "0.00",
        currency
      };
    }

    const params = new URLSearchParams();
    params.set("payment_method_types[0]", "card");
    params.set("amount", String(redemption.amountCents));
    params.set("currency", currency.toLowerCase());
    params.set("receipt_email", customerEmail);
    params.set("description", "CircuitWash Store");
    params.set("metadata[zaft_order_type]", "merch");
    params.set("metadata[store_member_id]", String(member.id));
    params.set("metadata[store_order_number]", orderNumber);
    params.set("metadata[store_credit_applied]", centsToMoney(redemption.creditAppliedCents));

    intent = await stripeRequest("payment_intents", {
      method: "POST",
      body: params,
      idempotencyKey: `zaft-merch-${requestId}`
    });
    if (!intent?.id || !intent?.client_secret) {
      throw new StoreError("Stripe could not start checkout.", 502, "stripe_create_failed");
    }

    await insertStoreOrder(client, {
      orderId: intent.id,
      orderNumber,
      member,
      product,
      unitPriceCents,
      quantity,
      subtotalCents,
      creditAppliedCents: redemption.creditAppliedCents,
      amountCents: redemption.amountCents,
      currency,
      customerEmail,
      address,
      status: "CREATED",
      paymentMethod: "stripe"
    });
    await deductStoreCredit(client, member.id, redemption.creditAppliedCents);
    await client.query("commit");

    return {
      paymentIntentId: intent.id,
      orderNumber,
      clientSecret: intent.client_secret,
      subtotal: centsToMoney(subtotalCents),
      creditApplied: centsToMoney(redemption.creditAppliedCents),
      amount: centsToMoney(redemption.amountCents),
      remainingCredit: centsToMoney(Math.max(0, redemption.availableCreditCents - redemption.creditAppliedCents)),
      currency
    };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    if (intent?.id) {
      await stripeRequest(`payment_intents/${encodeURIComponent(intent.id)}/cancel`, { method: "POST" }).catch(() => {});
    }
    throw error;
  } finally {
    client.release();
  }
}

async function insertStoreOrder(db, values) {
  const result = await db.query(`
    insert into store_orders
      (order_id, order_number, member_id, product_id, product_name, image_url, unit_price, quantity,
       amount, subtotal_amount, credit_applied, currency, customer_email, recipient_name, address_line1,
       address_line2, city, postcode, country, status, fulfilment_status, payment_method,
       payment_verified_at, completed_at, created_at, updated_at)
    values
      ($1, $2, $3, $4, $5, $6, $7::numeric, $8, $9::numeric, $10::numeric, $11::numeric, $12,
       $13, $14, $15, $16, $17, $18, $19, $20, 'PENDING', $21,
       case when $20 = 'COMPLETED' then now() else null end,
       case when $20 = 'COMPLETED' then now() else null end, now(), now())
    returning *
  `, [
    values.orderId,
    values.orderNumber,
    values.member.id,
    values.product.id,
    values.product.name,
    values.product.image_url || "",
    centsToMoney(values.unitPriceCents),
    values.quantity,
    centsToMoney(values.amountCents),
    centsToMoney(values.subtotalCents),
    centsToMoney(values.creditAppliedCents),
    values.currency,
    values.customerEmail,
    values.address.recipientName,
    values.address.line1,
    values.address.line2,
    values.address.city,
    values.address.postcode,
    values.address.country,
    values.status,
    values.paymentMethod
  ]);
  return result.rows[0];
}

async function deductStoreCredit(db, memberId, creditAppliedCents) {
  if (creditAppliedCents <= 0) return;
  await db.query(`
    update store_members
    set store_credit_balance = greatest(0::numeric, store_credit_balance - $2::numeric), updated_at = now()
    where id = $1
  `, [memberId, centsToMoney(creditAppliedCents)]);
}

async function completePaymentIntent(body) {
  const member = await requireMember(body.accessCode);
  const paymentIntentId = String(body.paymentIntentId || "").trim();
  if (!/^pi_[A-Za-z0-9_]{6,255}$/.test(paymentIntentId)) {
    throw new StoreError("Invalid payment reference.", 400, "invalid_order");
  }

  const orderResult = await pool.query(`
    select * from store_orders where order_id = $1 and member_id = $2 limit 1
  `, [paymentIntentId, member.id]);
  const order = orderResult.rows[0];
  if (!order) throw new StoreError("Store order not found.", 404, "order_not_found");

  const intent = await stripeRequest(`payment_intents/${encodeURIComponent(paymentIntentId)}?expand[]=latest_charge`);
  if (!isPaidStripeIntentForOrder(intent, order)) {
    await resetUnverifiedCompletedOrder(order, member);
    throw new StoreError("Payment has not completed yet.", 409, "payment_not_completed");
  }

  if (order.status === "COMPLETED") {
    const numberedOrder = await markPaymentVerified(await ensureOrderNumber(order));
    await awardReferralCredit(numberedOrder, member);
    return { order: serializeOrder({ ...numberedOrder, payment_verified: true }) };
  }

  const paymentMethod = String(
    intent.latest_charge?.payment_method_details?.type || intent.payment_method_types?.[0] || "stripe"
  ).slice(0, 40);
  const updated = await pool.query(`
    update store_orders
    set status = 'COMPLETED',
        order_number = coalesce(nullif(trim(order_number), ''), $3),
        payment_method = $2,
        payment_verified_at = coalesce(payment_verified_at, now()),
        completed_at = coalesce(completed_at, now()),
        updated_at = now()
    where order_id = $1
    returning *
  `, [paymentIntentId, paymentMethod, await createUniqueStoreOrderNumber(pool)]);
  await awardReferralCredit(updated.rows[0], member);
  return { order: serializeOrder({ ...updated.rows[0], payment_verified: true }) };
}

function isPaidStripeIntentForOrder(intent, order) {
  const expectedAmount = moneyToCents(order.amount);
  const amountReceived = Number(intent?.amount_received);
  const currencyMatches = String(intent?.currency || "").toUpperCase() === String(order.currency || "").toUpperCase();
  const charge = intent?.latest_charge && typeof intent.latest_charge === "object" ? intent.latest_charge : null;
  const chargeSucceeded = !charge || (charge.paid === true && String(charge.status || "") === "succeeded");
  const chargeAmount = charge ? Number(charge.amount_captured ?? charge.amount) : amountReceived;
  const metadata = intent?.metadata || {};
  const metadataMemberMatches = !metadata.store_member_id || String(metadata.store_member_id) === String(order.member_id);
  const metadataOrderMatches = !metadata.store_order_number
    || !order.order_number
    || String(metadata.store_order_number) === String(order.order_number);
  return intent?.status === "succeeded"
    && amountReceived === expectedAmount
    && chargeAmount === expectedAmount
    && currencyMatches
    && chargeSucceeded
    && metadataMemberMatches
    && metadataOrderMatches;
}

async function resetUnverifiedCompletedOrder(order, member) {
  if (String(order?.status || "").toUpperCase() !== "COMPLETED") return;
  const client = await pool.connect();
  try {
    await client.query("begin");
    const updated = await client.query(`
      with target as (
        select order_id, referral_credit_awarded_at
        from store_orders
        where order_id = $1 and status = 'COMPLETED'
        for update
      )
      update store_orders
      set status = 'CREATED',
          fulfilment_status = 'PENDING',
          completed_at = null,
          fulfilled_at = null,
          referral_credit_awarded_at = null,
          payment_verified_at = null,
          updated_at = now()
      from target
      where store_orders.order_id = target.order_id
      returning target.referral_credit_awarded_at
    `, [order.order_id]);
    if (updated.rows[0]?.referral_credit_awarded_at && Number(member?.invited_by_id)) {
      await client.query(`
        update store_members
        set store_credit_balance = greatest(0::numeric, store_credit_balance - $2::numeric),
            updated_at = now()
        where id = $1
      `, [member.invited_by_id, REFERRAL_CREDIT_AMOUNT]);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function ensureOrderNumber(order) {
  if (String(order?.order_number || "").trim()) return order;
  const orderNumber = await createUniqueStoreOrderNumber(pool, order?.created_at);
  const updated = await pool.query(`
    update store_orders
    set order_number = $2, updated_at = now()
    where order_id = $1 and (order_number is null or trim(order_number) = '')
    returning *
  `, [order.order_id, orderNumber]);
  return updated.rows[0] || { ...order, order_number: orderNumber };
}

async function markPaymentVerified(order) {
  if (order?.payment_verified_at) return order;
  const updated = await pool.query(`
    update store_orders
    set payment_verified_at = coalesce(payment_verified_at, now()),
        updated_at = now()
    where order_id = $1
    returning *
  `, [order.order_id]);
  return updated.rows[0] || { ...order, payment_verified_at: new Date().toISOString() };
}

async function awardReferralCredit(order, member) {
  const inviterId = Number(member?.invited_by_id) || 0;
  const memberId = Number(member?.id) || 0;
  const orderId = String(order?.order_id || "").trim();
  if (!inviterId || !memberId || !orderId) return;

  const client = await pool.connect();
  try {
    await client.query("begin");
    const alreadyCredited = await client.query(`
      select 1
      from store_orders
      where member_id = $1 and referral_credit_awarded_at is not null
      limit 1
    `, [memberId]);
    if (alreadyCredited.rows.length) {
      await client.query("commit");
      return;
    }

    const marked = await client.query(`
      update store_orders
      set referral_credit_awarded_at = now(), updated_at = now()
      where order_id = $1 and referral_credit_awarded_at is null
      returning order_id
    `, [orderId]);
    if (marked.rows.length) {
      await client.query(`
        update store_members
        set store_credit_balance = store_credit_balance + $2::numeric, updated_at = now()
        where id = $1
      `, [inviterId, REFERRAL_CREDIT_AMOUNT]);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function requireMember(accessCodeValue, db = pool, { lock = false, touch = false } = {}) {
  const accessCode = normalizeStoreCode(accessCodeValue);
  if (!accessCode) throw new StoreError("Enter a valid store access code.", 401, "unauthorized");
  const result = await db.query(`
    select * from store_members where access_code = $1 limit 1 ${lock ? "for update" : ""}
  `, [accessCode]);
  const member = result.rows[0];
  if (!member || !member.active) throw new StoreError("This store access code is not active.", 401, "unauthorized");
  if (touch) {
    await db.query(`update store_members set last_used_at = now(), updated_at = now() where id = $1`, [member.id]);
  }
  return member;
}

async function sendStoreInviteEmail(email, code, link) {
  if (!RESEND_API_KEY || !STORE_EMAIL_FROM) return { status: "NOT_CONFIGURED", error: "" };
  const subject = "Your CircuitWash store invitation";
  const text = [
    "You've been invited to the secret store.",
    `Store access code: ${code}`,
    `Press the icon: ${link}`,
    `Need help? Contact ${SUPPORT_PUBLIC_EMAIL}.`
  ].join("\n\n");
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#111827;line-height:1.55">
      <div style="padding:28px;border:1px solid #d1d5db;border-radius:12px;background:#ffffff">
        <div style="font-size:12px;font-weight:800;text-transform:uppercase;color:#6d28d9">CircuitWash Store</div>
        <h1 style="margin:10px 0 8px;font-size:26px">You've been invited to the secret store</h1>
        <p style="margin:0 0 18px;color:#4b5563">Press the icon to open it.</p>
        <div style="padding:15px;border:1px solid #ddd6fe;border-radius:10px;background:#f5f3ff;font-size:28px;font-weight:800;letter-spacing:.12em">${escapeHtml(code)}</div>
        <a href="${escapeHtml(link)}" style="display:inline-block;margin-top:20px;padding:12px 18px;border-radius:8px;background:#6d28d9;color:#ffffff;text-decoration:none;font-weight:700">Open store</a>
        <p style="margin:22px 0 0;font-size:12px;color:#6b7280">Need help? ${escapeHtml(SUPPORT_PUBLIC_EMAIL)}</p>
      </div>
    </div>`;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `store-invite-${crypto.randomUUID()}`
      },
      body: JSON.stringify({
        from: STORE_EMAIL_FROM,
        to: [email],
        reply_to: [SUPPORT_PUBLIC_EMAIL],
        subject,
        text,
        html
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.id) throw new Error(result.message || `Resend returned ${response.status}`);
    return { status: "SENT", error: "" };
  } catch (error) {
    console.error("[store-api] invite email failed:", error?.stack || error);
    return { status: "FAILED", error: String(error?.message || error).slice(0, 500) };
  }
}

async function stripeRequest(path, { method = "GET", body = null, idempotencyKey = "" } = {}) {
  const headers = { Authorization: `Bearer ${requireEnv("STRIPE_SECRET_KEY")}` };
  if (body) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const response = await fetch(`${STRIPE_API_BASE}/${path}`, {
    method,
    headers,
    ...(body ? { body: body.toString() } : {})
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("[store-api] Stripe API failed:", response.status, data);
    throw new StoreError(data?.error?.message || "Stripe could not process checkout.", 502, "stripe_request_failed");
  }
  return data;
}

function normalizeAddress(value = {}) {
  const address = value && typeof value === "object" ? value : {};
  const recipientName = cleanText(address.recipientName, 120);
  const line1 = cleanText(address.line1, 160);
  const line2 = cleanText(address.line2, 160);
  const city = cleanText(address.city, 100);
  const postcode = cleanText(address.postcode, 24).toUpperCase();
  const country = cleanText(address.country || "United Kingdom", 80);
  if (!recipientName || !line1 || !city || !postcode || !country) {
    throw new StoreError("Complete the delivery address.", 400, "invalid_address");
  }
  return { recipientName, line1, line2, city, postcode, country };
}

function serializeMember(row, invitations = []) {
  const inviteRows = Array.isArray(invitations) ? invitations : [];
  const inviteCount = inviteRows.filter((invite) =>
    Boolean(invite.invite_redeemed_at)
      || Boolean(invite.popup_claimed_at)
      || Boolean(invite.last_used_at)
      || Number(invite.completed_orders || 0) > 0
  ).length;
  const hasPendingReferral = inviteRows.some((invite) =>
    (
      Boolean(invite.invite_code)
        && !invite.invite_redeemed_at
    )
      || (
        !invite.invite_code
        && Boolean(invite.active)
        && !invite.popup_claimed_at
        && !invite.last_used_at
        && Number(invite.completed_orders || 0) < 1
      )
  );
  const invitesRemainingByLimit = Math.max(0, STORE_REFERRAL_LIMIT - inviteCount);
  return {
    email: row.email || "",
    accessCode: row.access_code,
    inviteLimit: STORE_REFERRAL_LIMIT,
    inviteCount,
    invitesRemaining: invitesRemainingByLimit,
    pendingReferral: hasPendingReferral,
    canCreateReferral: !hasPendingReferral && invitesRemainingByLimit > 0,
    unlimitedInvites: false,
    creditBalance: Number(row.store_credit_balance || 0).toFixed(2)
  };
}

function serializeProduct(row) {
  return {
    id: Number(row.id),
    name: row.name,
    description: row.description || "",
    price: Number(row.price).toFixed(2),
    currency: row.currency || "GBP",
    imageUrl: row.image_url || "",
    sortOrder: Number(row.sort_order) || 0
  };
}

function serializeInvitation(row) {
  const inviteCode = row.invite_code || row.access_code;
  return {
    id: Number(row.id),
    code: inviteCode,
    email: row.email || "",
    active: Boolean(row.active),
    inviteLimit: Number(row.invite_limit) || 0,
    inviteCount: Number(row.invite_count) || 0,
    completedOrders: Number(row.completed_orders) || 0,
    acceptedAt: row.invite_redeemed_at || row.last_used_at || row.popup_claimed_at || "",
    creditAmount: Number(row.completed_orders) > 0 ? REFERRAL_CREDIT_AMOUNT : "0.00",
    link: row.invite_code ? storeInviteLink(row.invite_code) : storeLink(row.access_code),
    emailStatus: row.invite_email_status || "",
    createdAt: row.created_at
  };
}

function serializeOrderSummary(row) {
  return {
    orderId: row.order_id,
    orderNumber: row.order_number || "",
    productName: row.product_name,
    imageUrl: row.image_url || "",
    quantity: Number(row.quantity) || 1,
    amount: Number(row.amount).toFixed(2),
    subtotal: Number(row.subtotal_amount ?? row.amount ?? 0).toFixed(2),
    creditApplied: Number(row.credit_applied || 0).toFixed(2),
    creditRefunded: Boolean(row.credit_refunded_at),
    currency: row.currency,
    status: row.status,
    fulfilmentStatus: row.fulfilment_status,
    paymentMethod: row.payment_method || "stripe",
    paymentVerified: row.payment_verified === true || Boolean(row.payment_verified_at),
    createdAt: row.created_at,
    completedAt: row.completed_at,
    fulfilledAt: row.fulfilled_at
  };
}

function serializeOrder(row) {
  return {
    ...serializeOrderSummary(row),
    customerEmail: row.customer_email || "",
    recipientName: row.recipient_name || "",
    addressLine1: row.address_line1 || "",
    addressLine2: row.address_line2 || "",
    city: row.city || "",
    postcode: row.postcode || "",
    country: row.country || "",
    address: {
      line1: row.address_line1 || "",
      line2: row.address_line2 || "",
      city: row.city || "",
      postcode: row.postcode || "",
      country: row.country || ""
    }
  };
}

function storeLink(code) {
  return `${PUBLIC_SITE_URL}/store.html?code=${encodeURIComponent(code)}`;
}

function storeInviteLink(code) {
  return `${PUBLIC_SITE_URL}/store.html?invite=${encodeURIComponent(code)}`;
}

function cleanText(value, maxLength) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function positiveId(value, message) {
  const id = Number.parseInt(String(value || ""), 10);
  if (!Number.isInteger(id) || id <= 0) throw new StoreError(message, 400, "invalid_product");
  return id;
}

function normalizeCurrency(value) {
  const currency = String(value || "GBP").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new StoreError("Invalid product currency.", 500, "invalid_currency");
  return currency;
}

function moneyToCents(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number * 100)) : 0;
}

function centsToMoney(value) {
  return (Math.max(0, Math.round(Number(value) || 0)) / 100).toFixed(2);
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function requireEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new StoreError(`${name} is not configured.`, 500, "store_not_configured");
  return value;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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
