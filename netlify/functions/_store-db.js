const crypto = require("crypto");

const STORE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const STORE_CODE_LENGTH = 6;
const STORE_ORDER_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
let schemaReady = false;

async function ensureStoreSchema(pool) {
  if (schemaReady) return;

  await pool.query(`
    create table if not exists store_members (
      id bigserial primary key,
      access_code text unique not null,
      email text,
      active boolean not null default true,
      invited_by_id bigint references store_members(id) on delete set null,
      invite_code text,
      invite_redeemed_at timestamptz,
      invite_limit integer not null default 5 check (invite_limit between 0 and 100),
      invite_count integer not null default 0 check (invite_count >= 0),
      source text not null default 'ADMIN',
      invite_delivery text not null default 'EMAIL',
      store_credit_balance numeric(10, 2) not null default 0,
      laundry_access_code text,
      popup_enabled boolean not null default false,
      popup_claimed_at timestamptz,
      invite_email_status text,
      invite_email_error text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      last_used_at timestamptz
    )
  `);
  await pool.query(`
    alter table store_members
      add column if not exists email text,
      add column if not exists active boolean not null default true,
      add column if not exists invited_by_id bigint references store_members(id) on delete set null,
      add column if not exists invite_code text,
      add column if not exists invite_redeemed_at timestamptz,
      add column if not exists invite_limit integer not null default 5,
      add column if not exists invite_count integer not null default 0,
      add column if not exists source text not null default 'ADMIN',
      add column if not exists invite_delivery text not null default 'EMAIL',
      add column if not exists store_credit_balance numeric(10, 2) not null default 0,
      add column if not exists laundry_access_code text,
      add column if not exists popup_enabled boolean not null default false,
      add column if not exists popup_claimed_at timestamptz,
      add column if not exists invite_email_status text,
      add column if not exists invite_email_error text,
      add column if not exists created_at timestamptz not null default now(),
      add column if not exists updated_at timestamptz not null default now(),
      add column if not exists last_used_at timestamptz
  `);
  await pool.query(`create index if not exists store_members_created_idx on store_members(created_at desc)`);
  await pool.query(`create index if not exists store_members_inviter_idx on store_members(invited_by_id, created_at desc)`);
  await pool.query(`create unique index if not exists store_members_invite_code_idx on store_members(invite_code) where invite_code is not null and trim(invite_code) <> ''`);
  await pool.query(`create unique index if not exists store_members_email_idx on store_members(lower(email)) where email is not null and trim(email) <> ''`);
  await pool.query(`create unique index if not exists store_members_laundry_code_idx on store_members(laundry_access_code) where laundry_access_code is not null and trim(laundry_access_code) <> ''`);

  await pool.query(`
    create table if not exists store_products (
      id bigserial primary key,
      name text not null,
      description text not null default '',
      price numeric(10, 2) not null check (price > 0),
      currency text not null default 'GBP',
      image_url text not null default '',
      active boolean not null default true,
      sort_order integer not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await pool.query(`
    alter table store_products
      add column if not exists description text not null default '',
      add column if not exists currency text not null default 'GBP',
      add column if not exists image_url text not null default '',
      add column if not exists active boolean not null default true,
      add column if not exists sort_order integer not null default 0,
      add column if not exists created_at timestamptz not null default now(),
      add column if not exists updated_at timestamptz not null default now()
  `);
  await pool.query(`create index if not exists store_products_active_sort_idx on store_products(active, sort_order, created_at)`);

  await pool.query(`
    create table if not exists store_orders (
      order_id text primary key,
      order_number text unique,
      member_id bigint references store_members(id) on delete set null,
      product_id bigint references store_products(id) on delete set null,
      product_name text not null,
      image_url text not null default '',
      unit_price numeric(10, 2) not null,
      quantity integer not null default 1 check (quantity between 1 and 20),
      amount numeric(10, 2) not null,
      subtotal_amount numeric(10, 2) not null,
      credit_applied numeric(10, 2) not null default 0,
      credit_refunded_at timestamptz,
      currency text not null default 'GBP',
      customer_email text not null,
      recipient_name text not null,
      address_line1 text not null,
      address_line2 text not null default '',
      city text not null,
      postcode text not null,
      country text not null default 'United Kingdom',
      status text not null default 'CREATED',
      fulfilment_status text not null default 'PENDING',
      payment_method text not null default 'stripe',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      completed_at timestamptz,
      payment_verified_at timestamptz,
      fulfilled_at timestamptz
    )
  `);
  await pool.query(`
    alter table store_orders
      add column if not exists order_number text,
      add column if not exists image_url text not null default '',
      add column if not exists address_line2 text not null default '',
      add column if not exists country text not null default 'United Kingdom',
      add column if not exists subtotal_amount numeric(10, 2),
      add column if not exists credit_applied numeric(10, 2) not null default 0,
      add column if not exists credit_refunded_at timestamptz,
      add column if not exists fulfilment_status text not null default 'PENDING',
      add column if not exists payment_method text not null default 'stripe',
      add column if not exists referral_credit_awarded_at timestamptz,
      add column if not exists payment_verified_at timestamptz,
      add column if not exists updated_at timestamptz not null default now(),
      add column if not exists fulfilled_at timestamptz
  `);
  await pool.query(`update store_orders set subtotal_amount = amount where subtotal_amount is null`);
  await pool.query(`create index if not exists store_orders_created_idx on store_orders(created_at desc)`);
  await pool.query(`create index if not exists store_orders_member_idx on store_orders(member_id, created_at desc)`);
  await pool.query(`create index if not exists store_orders_status_idx on store_orders(status, fulfilment_status, created_at desc)`);
  await pool.query(`create unique index if not exists store_orders_order_number_idx on store_orders(order_number) where order_number is not null and trim(order_number) <> ''`);

  schemaReady = true;
}

function generateStoreCode(length = STORE_CODE_LENGTH) {
  const bytes = crypto.randomBytes(length);
  let output = "";
  for (const byte of bytes) output += STORE_CODE_ALPHABET[byte % STORE_CODE_ALPHABET.length];
  return output;
}

async function createUniqueStoreCode(db, length = STORE_CODE_LENGTH) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = generateStoreCode(length);
    const result = await db.query(`
      select 1
      from store_members
      where access_code = $1 or invite_code = $1
      limit 1
    `, [code]);
    if (!result.rows.length) return code;
  }
  throw new Error("Could not generate a unique store access code.");
}

async function createUniqueStoreOrderNumber(db, dateValue = new Date()) {
  const date = new Date(dateValue);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const stamp = [
    safeDate.getUTCFullYear(),
    String(safeDate.getUTCMonth() + 1).padStart(2, "0"),
    String(safeDate.getUTCDate()).padStart(2, "0")
  ].join("");

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const bytes = crypto.randomBytes(4);
    let suffix = "";
    for (const byte of bytes) suffix += STORE_ORDER_ALPHABET[byte % STORE_ORDER_ALPHABET.length];
    const orderNumber = `ZM-${stamp}-${suffix}`;
    const result = await db.query(`select 1 from store_orders where order_number = $1 limit 1`, [orderNumber]);
    if (!result.rows.length) return orderNumber;
  }
  throw new Error("Could not generate a unique store order number.");
}

async function cleanupStaleStoreOrders(pool, { staleHours = 24 } = {}) {
  const hours = normalizeStaleHours(staleHours);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query(`
      delete from store_orders
      where status = 'CREATED'
        and completed_at is null
        and created_at < now() - make_interval(hours => $1::int)
      returning order_id, member_id, credit_applied, credit_refunded_at
    `, [hours]);
    const refunds = new Map();
    for (const row of result.rows) {
      const memberId = Number(row.member_id) || 0;
      const credit = Number(row.credit_applied) || 0;
      if (!memberId || credit <= 0 || row.credit_refunded_at) continue;
      refunds.set(memberId, (refunds.get(memberId) || 0) + credit);
    }
    for (const [memberId, credit] of refunds) {
      await client.query(`
        update store_members
        set store_credit_balance = store_credit_balance + $2::numeric, updated_at = now()
        where id = $1
      `, [memberId, credit.toFixed(2)]);
    }
    await client.query("commit");
    return {
      deleted: result.rowCount || 0,
      staleHours: hours,
      created: result.rowCount || 0,
      unverifiedCompleted: 0,
      refundedCredit: Array.from(refunds.values()).reduce((total, value) => total + value, 0).toFixed(2)
    };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function backfillStoreOrderNumbers(pool, { limit = 100 } = {}) {
  const maxRows = Math.max(1, Math.min(500, Number.parseInt(String(limit || ""), 10) || 100));
  const result = await pool.query(`
    select order_id, created_at
    from store_orders
    where order_number is null or trim(order_number) = ''
    order by created_at asc
    limit $1
  `, [maxRows]);

  let updated = 0;
  for (const row of result.rows) {
    const orderNumber = await createUniqueStoreOrderNumber(pool, row.created_at);
    const saved = await pool.query(`
      update store_orders
      set order_number = $2, updated_at = now()
      where order_id = $1 and (order_number is null or trim(order_number) = '')
      returning order_id
    `, [row.order_id, orderNumber]);
    updated += saved.rowCount || 0;
  }
  return { updated };
}

async function maintainStoreOrders(pool, options = {}) {
  const [cleanup, backfill] = await Promise.all([
    cleanupStaleStoreOrders(pool, options),
    backfillStoreOrderNumbers(pool)
  ]);
  return { cleanup, backfill };
}

function normalizeStoreCode(value) {
  const code = String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-HJ-NP-Z2-9]{6,16}$/.test(code) ? code : "";
}

function normalizeStoreEmail(value, { allowBlank = false } = {}) {
  const email = String(value || "").trim().toLowerCase();
  if (!email && allowBlank) return "";
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "";
  return email;
}

function normalizeStaleHours(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isInteger(parsed)) return 24;
  return Math.min(168, Math.max(1, parsed));
}

module.exports = {
  STORE_CODE_LENGTH,
  backfillStoreOrderNumbers,
  cleanupStaleStoreOrders,
  createUniqueStoreCode,
  createUniqueStoreOrderNumber,
  ensureStoreSchema,
  maintainStoreOrders,
  normalizeStoreCode,
  normalizeStoreEmail
};
