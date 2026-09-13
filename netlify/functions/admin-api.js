const crypto = require("crypto");
const { databaseUrl, pool } = require("./_db");
const { getPublicSites, searchPublicSites } = require("./_site-data");
// Reload this helper with the admin function during local preview hot updates.
delete require.cache[require.resolve("./_custom-email")];
const customEmail = require("./_custom-email");
const { getValidatedAnalyticsSites } = require("./_analytics-validity");
const { ensureOrderStorage } = require("./_order-storage");
const { ensureSupportSchema } = require("./_support-schema");
const { calculateOrganicSpread } = require("./_city-coverage");
const { getPaidGrowthAnalytics } = require("./_paid-growth-analytics");
const { getUsageAnalytics } = require("./_usage-analytics");

const ADMIN_ACCESS_CODE = String(process.env.ADMIN_ACCESS_CODE || "").trim();
const RESEND_API_KEY = String(process.env.RESEND_API_KEY || "").trim();
const SUPPORT_EMAIL_FROM = String(
  process.env.SUPPORT_EMAIL_FROM ||
  process.env.ACCESS_CODE_EMAIL_FROM ||
  "CircuitWash Support <support@circuitwash.com>"
).trim();
const SUPPORT_PUBLIC_EMAIL = String(process.env.SUPPORT_PUBLIC_EMAIL || "support@circuitwash.com").trim();
const FEEDBACK_EMAIL_FROM = String(
  process.env.FEEDBACK_EMAIL_FROM ||
  process.env.ACCESS_CODE_EMAIL_FROM ||
  SUPPORT_EMAIL_FROM ||
  "CircuitWash <feedback@circuitwash.com>"
).trim();
const PUBLIC_SITE_URL = normalizeBaseUrl(
  process.env.PUBLIC_SITE_URL || process.env.URL || "https://circuitwash.com"
);
const FEEDBACK_INVITE_DAYS = clampInt(process.env.FEEDBACK_INVITE_DAYS, 1, 90, 30);
const ACCESS_CODE_LENGTH = clampInt(process.env.ACCESS_CODE_LENGTH, 4, 12, 5);
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TRIAL_SETTING_KEY = "homepage_free_trial_enabled";
const TRIAL_SITE_LIMITS_KEY = "free_trial_site_weekly_limits";
const CUSTOM_EMAIL_FROM = String(
  process.env.CUSTOM_EMAIL_FROM || process.env.SUPPORT_EMAIL_FROM || process.env.ACCESS_CODE_EMAIL_FROM || SUPPORT_EMAIL_FROM
).trim();
const CUSTOM_EMAIL_CONFIG = {
  apiKey: RESEND_API_KEY,
  from: CUSTOM_EMAIL_FROM,
  supportEmail: SUPPORT_PUBLIC_EMAIL,
  publicUrl: PUBLIC_SITE_URL,
  unsubscribeSecret: String(process.env.EMAIL_UNSUBSCRIBE_SECRET || ADMIN_ACCESS_CODE || "").trim(),
  adminCode: ADMIN_ACCESS_CODE
};

let schemaReady = false;
let adminLoginSchemaReady = false;

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
    if (!ADMIN_ACCESS_CODE) return json({ ok: false, error: "admin_not_configured" }, 500);

    let body;
    try {
      body = event.body ? JSON.parse(event.body) : {};
    } catch (_) {
      return json({ ok: false, error: "bad_request" }, 400);
    }

    await ensureAdminLoginAttemptSchema();
    if (!isAdminCode(body.adminCode)) {
      await logRejectedAdminLogin(event, body).catch((error) => {
        console.error("[admin-api] failed login log error:", error?.stack || error);
      });
      return json({ ok: false, error: "unauthorized" }, 401);
    }

    const action = String(body.action || "authenticate").trim();

    await ensureOrderStorage(pool);

    if (action === "authenticate") {
      return json({ ok: true, supportEmail: SUPPORT_PUBLIC_EMAIL });
    }

    if (action === "analytics") {
      return json({
        ok: true,
        ...(await getPaidGrowthAnalytics({
          pool,
          adminOrderSource: await getAdminOrderSource(),
          publicSites: getPublicSites(),
          periodDays: body.periodDays
        }))
      });
    }
    if (action === "usage_analytics") {
      return json({
        ok: true,
        ...(await getUsageAnalytics({
          pool,
          publicSites: getPublicSites(),
          periodDays: body.periodDays
        }))
      });
    }

    await ensureSchema();
    if (action === "dashboard") return json({ ok: true, ...(await getDashboard()) });
    if (action === "orders") return json({ ok: true, orders: await getOrders(body) });
    if (action === "cleanup_created_orders") return json({ ok: true, ...(await cleanupCreatedOrders(body)) });
    if (action === "customer_notice_data") return json({ ok: true, customers: await getCustomerNoticeCustomers() });
    if (action === "customer_notice_send") return json({ ok: true, ...(await sendCustomerWebsiteNotices(body)) });
    if (action === "search_sites") return json({ ok: true, sites: searchSites(body) });
    if (action === "create_code") return json({ ok: true, ...(await createAccessCode(body)) }, 201);
    if (action === "list_codes") return json({ ok: true, codes: await listAccessCodes(body) });
    if (action === "set_code_active") return json({ ok: true, ...(await setCodeActive(body)) });
    if (action === "set_code_weekly_limit") return json({ ok: true, ...(await setCodeWeeklyLimit(body)) });
    if (action === "delete_code") return json({ ok: true, ...(await deleteAccessCode(body)) });
    if (action === "create_promo") return json({ ok: true, ...(await createPromoCode(body)) }, 201);
    if (action === "list_promos") return json({ ok: true, promos: await listPromoCodes(body) });
    if (action === "update_promo") return json({ ok: true, ...(await updatePromoCode(body)) });
    if (action === "set_promo_active") return json({ ok: true, ...(await setPromoActive(body)) });
    if (action === "delete_promo") return json({ ok: true, ...(await deletePromoCode(body)) });
    if (action === "free_trial_data") return json({ ok: true, ...(await getFreeTrialData()) });
    if (action === "free_trial_set_enabled") return json({ ok: true, enabled: await setFreeTrialEnabled(body) });
    if (action === "free_trial_set_site_limit") return json({ ok: true, ...(await setFreeTrialSiteLimit(body)) });
    if (action === "feedback_data") return json({ ok: true, ...(await getFeedbackData()) });
    if (action === "feedback_set_enabled") return json({ ok: true, enabled: await setFeedbackEnabled(body) });
    if (action === "feedback_send") return json({ ok: true, ...(await sendFeedbackInvitations(body)) });
    if (action === "feedback_test_create") return json({ ok: true, ...(await createFeedbackTestResponse(body)) }, 201);
    if (action === "feedback_test_delete") return json({ ok: true, ...(await deleteFeedbackTestResponses()) });
    if (action === "feedback_popup_test_setup") return json({ ok: true, ...(await setupFeedbackPopupTest(body)) }, 201);
    if (action === "feedback_popup_test_delete") return json({ ok: true, ...(await deleteFeedbackPopupTests()) });
    if (action === "support_list") return json({ ok: true, tickets: await listSupportTickets(body) });
    if (action === "support_get") return json({ ok: true, ...(await getSupportTicket(body)) });
    if (action === "support_reply") return json({ ok: true, ...(await replyToSupportTicket(body)) });
    if (action === "support_status") return json({ ok: true, ...(await setSupportStatus(body)) });
    if (action === "email_data") return json({ ok: true, ...(await customEmail.getEmailData(pool)) });
    if (action === "email_add_contacts") return json({ ok: true, ...(await customEmail.addContacts(pool, body)) });
    if (action === "email_remove_contact") return json({ ok: true, ...(await customEmail.removeContact(pool, body)) });
    if (action === "email_save_draft") return json({ ok: true, ...(await customEmail.saveCampaign(pool, body)) });
    if (action === "email_delete_draft") return json({ ok: true, ...(await customEmail.deleteCampaign(pool, body)) });
    if (action === "email_save_template") return json({ ok: true, ...(await customEmail.saveTemplate(pool, body)) });
    if (action === "email_duplicate_template") return json({ ok: true, ...(await customEmail.duplicateTemplate(pool, body)) });
    if (action === "email_template_status") return json({ ok: true, ...(await customEmail.setTemplateStatus(pool, body)) });
    if (action === "email_recipient_preview") return json({ ok: true, ...(await customEmail.previewRecipients(pool, body)) });
    if (action === "email_render_preview") return json({ ok: true, ...(await customEmail.renderPreview(pool, body, CUSTOM_EMAIL_CONFIG)) });
    if (action === "email_send_test") return json({ ok: true, ...(await customEmail.sendTest(pool, body, CUSTOM_EMAIL_CONFIG)) });
    if (action === "email_send") return json({ ok: true, ...(await customEmail.sendCampaign(pool, body, CUSTOM_EMAIL_CONFIG)) });
    if (action === "email_cancel_scheduled") return json({ ok: true, ...(await customEmail.cancelScheduledCampaign(pool, body, CUSTOM_EMAIL_CONFIG)) });
    if (action === "email_restore_suppression") return json({ ok: true, ...(await customEmail.restoreSuppression(pool, body)) });

    return json({ ok: false, error: "unknown_action" }, 400);
  } catch (error) {
    if (error instanceof AdminError || error?.isAdminError) {
      return json({ ok: false, error: error.code, message: error.message }, error.statusCode);
    }
    console.error("[admin-api] fatal:", error?.stack || error);
    return json({ ok: false, error: "server_error", message: "Server error" }, 500);
  }
};

class AdminError extends Error {
  constructor(message, statusCode = 400, code = "bad_request") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

async function ensureSchema() {
  if (schemaReady) return;

  await ensureSupportSchema(pool);
  await customEmail.ensureCustomEmailSchema(pool);

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
      trial_token_hash char(64) unique,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      activated_at timestamptz
    )
  `);
  await pool.query(`
    alter table free_trial_claims
      add column if not exists trial_token_hash char(64),
      add column if not exists updated_at timestamptz not null default now(),
      add column if not exists activated_at timestamptz
  `);
  await pool.query(`alter table free_trial_claims alter column access_code drop not null`).catch((error) => {
    if (error?.code !== "42703") throw error;
  });
  await pool.query(`create unique index if not exists free_trial_claims_trial_token_idx on free_trial_claims(trial_token_hash) where trial_token_hash is not null`);
  await pool.query(`create index if not exists free_trial_claims_created_idx on free_trial_claims(created_at desc)`);

  await ensureAdminLoginAttemptSchema();

  await pool.query(`
    create table if not exists support_tickets (
      id bigserial primary key,
      resend_email_id text unique not null,
      message_id text,
      message_id_normalized text,
      in_reply_to text,
      references_header text,
      from_name text,
      from_email text not null,
      to_addresses jsonb not null default '[]'::jsonb,
      subject text not null default 'No subject',
      body_text text not null default '',
      attachments jsonb not null default '[]'::jsonb,
      status text not null default 'OPEN',
      is_read boolean not null default false,
      received_at timestamptz not null default now(),
      last_activity_at timestamptz not null default now(),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await pool.query(`
    alter table support_tickets
      add column if not exists is_read boolean not null default false,
      add column if not exists message_id_normalized text
  `);
  await pool.query(`
    create table if not exists support_replies (
      id bigserial primary key,
      ticket_id bigint not null references support_tickets(id) on delete cascade,
      direction text not null default 'OUTBOUND',
      from_email text,
      resend_email_id text,
      received_email_id text unique,
      message_id text,
      message_id_normalized text,
      body_text text not null,
      sent_at timestamptz not null default now()
    )
  `);
  await pool.query(`
    alter table support_replies
      add column if not exists direction text not null default 'OUTBOUND',
      add column if not exists from_email text,
      add column if not exists received_email_id text,
      add column if not exists message_id text,
      add column if not exists message_id_normalized text
  `);
  await pool.query(`
    update support_tickets
    set message_id_normalized = lower(regexp_replace(message_id, '[<>[:space:]]', '', 'g'))
    where message_id is not null and coalesce(message_id_normalized, '') = ''
  `);
  await pool.query(`
    update support_replies
    set message_id_normalized = lower(regexp_replace(message_id, '[<>[:space:]]', '', 'g'))
    where message_id is not null and coalesce(message_id_normalized, '') = ''
  `);
  await pool.query(`create unique index if not exists support_replies_received_email_idx on support_replies(received_email_id) where received_email_id is not null`);
  await pool.query(`create index if not exists support_tickets_activity_idx on support_tickets(last_activity_at desc)`);
  await pool.query(`create index if not exists support_replies_ticket_idx on support_replies(ticket_id, sent_at)`);
  await pool.query(`create index if not exists support_tickets_message_id_idx on support_tickets(message_id_normalized) where message_id_normalized is not null`);
  await pool.query(`create index if not exists support_replies_message_id_idx on support_replies(message_id_normalized) where message_id_normalized is not null`);

  await pool.query(`
    create table if not exists feedback_invitations (
      id bigserial primary key,
      token_hash text unique not null,
      recipient_email text not null,
      order_id text,
      site_id text,
      status text not null default 'PENDING',
      resend_email_id text,
      send_error text,
      sent_at timestamptz,
      expires_at timestamptz not null,
      responded_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await pool.query(`
    alter table feedback_invitations
      add column if not exists access_code text,
      add column if not exists source text not null default 'EMAIL'
  `);
  await pool.query(`
    create table if not exists feedback_responses (
      id bigserial primary key,
      invitation_id bigint unique not null references feedback_invitations(id) on delete cascade,
      rating smallint not null check (rating between 1 and 5),
      recommend text not null check (recommend in ('YES', 'MAYBE', 'NO')),
      comments text not null default '',
      submitted_at timestamptz not null default now()
    )
  `);
  await pool.query(`
    create table if not exists feedback_prompt_state (
      access_code text primary key,
      invitation_id bigint,
      customer_email text,
      site_id text,
      prompted_at timestamptz,
      dismissed_at timestamptz,
      responded_at timestamptz,
      updated_at timestamptz not null default now()
    )
  `);
  await pool.query(`
    alter table feedback_prompt_state
      add column if not exists customer_email text,
      add column if not exists site_id text,
      add column if not exists dismiss_count integer not null default 0
  `);
  await pool.query(`create index if not exists feedback_invitations_email_idx on feedback_invitations(lower(recipient_email), created_at desc)`);
  await pool.query(`create index if not exists feedback_invitations_status_idx on feedback_invitations(status, created_at desc)`);
  await pool.query(`create index if not exists feedback_invitations_code_idx on feedback_invitations(access_code, created_at desc)`);
  await pool.query(`create index if not exists feedback_responses_submitted_idx on feedback_responses(submitted_at desc)`);
  await pool.query(`create index if not exists feedback_prompt_state_email_idx on feedback_prompt_state(lower(customer_email), updated_at desc)`);

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
  await pool.query(`create index if not exists promo_codes_active_idx on promo_codes(active, created_at desc)`);

  await pool.query(`
    create table if not exists access_codes (
      code text primary key,
      site_id text not null,
      active boolean not null default true,
      weekly_limit integer not null default 5,
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
      add column if not exists created_at timestamptz not null default now(),
      add column if not exists source text,
      add column if not exists weekly_limit integer not null default 5,
      add column if not exists max_total_uses integer,
      add column if not exists delete_after_use boolean not null default false,
      add column if not exists deleted_at timestamptz,
      add column if not exists expires_at timestamptz
  `);
  await pool.query(`alter table access_codes alter column weekly_limit set default 5`);
  await pool.query(`
    update access_codes
    set expires_at = created_at + interval '1 year'
    where expires_at is null and source = 'payment'
  `);

  const ordersExist = await tableExists("access_orders");
  if (ordersExist) {
    await pool.query(`
      alter table access_orders
        add column if not exists payment_method text,
        add column if not exists order_type text not null default 'access_code',
        add column if not exists quantity integer not null default 1,
        add column if not exists entitlement_access_code text,
        add column if not exists entitlement_week_start date,
        add column if not exists entitlement_week_end date,
        add column if not exists provider_reference text,
        add column if not exists subtotal_amount numeric(10, 2),
        add column if not exists discount_amount numeric(10, 2) not null default 0,
        add column if not exists promo_code text
    `);
    await pool.query(`
      update access_orders
      set subtotal_amount = amount
      where subtotal_amount is null
    `);
    await pool.query(`create index if not exists access_orders_created_idx on access_orders(created_at desc)`);
    await pool.query(`create index if not exists access_orders_completed_idx on access_orders(completed_at desc) where status = 'COMPLETED'`);
    await pool.query(`alter table access_orders drop constraint if exists access_orders_provider_reference_key`);
    await pool.query(`drop index if exists access_orders_provider_reference_idx`);
    await pool.query(`create unique index if not exists access_orders_provider_reference_provider_idx on access_orders(payment_method, provider_reference) where provider_reference is not null`);
    await pool.query(`create index if not exists access_orders_type_completed_idx on access_orders(order_type, completed_at desc) where status = 'COMPLETED'`);
  }

  if (await tableExists("activation_upgrade_orders")) {
    await pool.query(`alter table activation_upgrade_orders add column if not exists payment_intent_id text`);
    await pool.query(`create unique index if not exists activation_upgrade_payment_intent_idx on activation_upgrade_orders(payment_intent_id) where payment_intent_id is not null`);
    await pool.query(`create index if not exists activation_upgrade_completed_idx on activation_upgrade_orders(completed_at desc) where status = 'COMPLETED'`);
  }

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
      add column if not exists site_id text,
      add column if not exists search_mode text,
      add column if not exists search_query text,
      add column if not exists page_path text,
      add column if not exists referrer text,
      add column if not exists visitor_hash text,
      add column if not exists session_hash text,
      add column if not exists ip_hash text,
      add column if not exists user_agent text,
      add column if not exists is_bot boolean not null default false,
      add column if not exists bot_reason text,
      add column if not exists is_test boolean not null default false,
      add column if not exists environment text not null default 'production',
      add column if not exists valid boolean not null default true,
      add column if not exists validation_reason text not null default '',
      add column if not exists source text not null default 'public_site',
      add column if not exists record_type text not null default 'site_selection',
      add column if not exists order_id text,
      add column if not exists converted_at timestamptz,
      add column if not exists created_at timestamptz not null default now()
  `);
  await pool.query(`create index if not exists site_interest_hits_created_idx on site_interest_hits(created_at desc)`);
  await pool.query(`create index if not exists site_interest_hits_site_created_idx on site_interest_hits(site_id, created_at desc)`);
  await pool.query(`create index if not exists site_interest_hits_site_visitor_idx on site_interest_hits(site_id, visitor_hash) where visitor_hash is not null`);
  await pool.query(`create index if not exists site_interest_hits_site_session_idx on site_interest_hits(site_id, session_hash) where session_hash is not null`);
  await pool.query(`create index if not exists site_interest_hits_session_created_idx on site_interest_hits(session_hash, created_at desc) where session_hash is not null`);
  await pool.query(`create index if not exists site_interest_hits_human_created_idx on site_interest_hits(created_at desc) where is_bot = false`);
  await pool.query(`
    create index if not exists site_interest_hits_analytics_period_idx
    on site_interest_hits(created_at desc)
    where is_bot = false and is_test = false and valid = true
      and environment = 'production' and source = 'public_site' and record_type = 'site_selection'
  `);
  await pool.query(`
    create index if not exists site_interest_hits_analytics_site_period_idx
    on site_interest_hits(site_id, created_at desc)
    where is_bot = false and is_test = false and valid = true
      and environment = 'production' and source = 'public_site' and record_type = 'site_selection'
  `);
  await pool.query(`
    create index if not exists site_interest_hits_analytics_recent_idx
    on site_interest_hits(id desc)
    where is_bot = false and is_test = false and valid = true
      and environment = 'production' and source = 'public_site' and record_type = 'site_selection'
  `);
  await pool.query(`create index if not exists site_interest_hits_bot_created_idx on site_interest_hits(created_at desc) where is_bot = true`);
  if (await tableExists("code_usage_weekly")) {
    await pool.query(`create index if not exists code_usage_weekly_week_idx on code_usage_weekly(week_start desc)`);
  }

  schemaReady = true;
}

async function ensureAdminLoginAttemptSchema() {
  if (adminLoginSchemaReady) return;
  await pool.query(`
    create table if not exists admin_login_attempts (
      id bigserial primary key,
      action text not null default 'authenticate',
      attempted_code_preview text not null default '',
      attempted_code_hash char(64),
      attempted_code_length integer not null default 0,
      ip_hash char(64),
      user_agent text,
      created_at timestamptz not null default now()
    )
  `);
  await pool.query(`create index if not exists admin_login_attempts_created_idx on admin_login_attempts(created_at desc)`);
  adminLoginSchemaReady = true;
}

async function logRejectedAdminLogin(event, body = {}) {
  const attemptedCode = String(body.adminCode || "").trim();
  const action = String(body.action || "authenticate").trim().slice(0, 80) || "authenticate";
  const ip = clientIp(event);
  const userAgent = headerValue(event.headers, "user-agent").slice(0, 500);
  await pool.query(`
    insert into admin_login_attempts
      (action, attempted_code_preview, attempted_code_hash, attempted_code_length, ip_hash, user_agent, created_at)
    values ($1, $2, $3, $4, $5, $6, now())
  `, [
    action,
    maskAttemptedCode(attemptedCode),
    attemptedCode ? loginAttemptFingerprint("code", attemptedCode) : null,
    attemptedCode.length,
    ip ? loginAttemptFingerprint("ip", ip) : null,
    userAgent || null
  ]);
}

function maskAttemptedCode(value) {
  const text = String(value || "");
  const length = text.length;
  if (!length) return "(blank)";
  if (length <= 2) return `${"*".repeat(length)} (${length} chars)`;
  if (length <= 6) return `${text.slice(0, 1)}${"*".repeat(length - 2)}${text.slice(-1)} (${length} chars)`;
  return `${text.slice(0, 2)}${"*".repeat(Math.min(8, length - 4))}${text.slice(-2)} (${length} chars)`;
}

function clientIp(event) {
  return headerValue(event.headers, "x-nf-client-connection-ip") ||
    headerValue(event.headers, "x-forwarded-for").split(",")[0].trim() ||
    headerValue(event.headers, "client-ip");
}

function headerValue(headers = {}, name) {
  const target = String(name || "").toLowerCase();
  const key = Object.keys(headers || {}).find((entry) => entry.toLowerCase() === target);
  return key ? String(headers[key] || "").trim() : "";
}

function loginAttemptFingerprint(scope, value) {
  const key = ADMIN_ACCESS_CODE || databaseUrl || "admin-login-attempts";
  return crypto.createHmac("sha256", key).update(`${scope}:${String(value || "")}`).digest("hex");
}

async function getAdminOrderSource() {
  const [accessOrdersExist, activationUpgradeOrdersExist] = await Promise.all([
    tableExists("access_orders"),
    tableExists("activation_upgrade_orders")
  ]);
  const sources = [];

  if (accessOrdersExist) {
    sources.push(`
      select order_id, site_id, amount, currency, status,
             coalesce(access_code, entitlement_access_code) as linked_access_code,
             coalesce(nullif(trim(customer_email), ''), nullif(trim(payer_email), '')) as customer_email,
             email_status, payment_method,
             order_type, quantity, entitlement_week_start, entitlement_week_end, provider_reference,
             subtotal_amount, discount_amount, promo_code,
             created_at, completed_at
      from access_orders
    `);
  }

  if (activationUpgradeOrdersExist) {
    sources.push(`
      select upgrade.order_id,
             access.site_id,
             upgrade.amount,
             upgrade.currency,
             upgrade.status,
             upgrade.access_code as linked_access_code,
             ${accessOrdersExist ? "original.customer_email" : "null::text"} as customer_email,
             'NOT_REQUIRED'::text as email_status,
             'stripe'::text as payment_method,
             'weekly_activation_addon'::text as order_type,
             greatest(coalesce(upgrade.bonus_activations, 1), 1)::int as quantity,
             upgrade.week_start as entitlement_week_start,
             case when upgrade.week_start is null then null else (upgrade.week_start + interval '7 days')::date end as entitlement_week_end,
             coalesce(upgrade.payment_intent_id, upgrade.stripe_session_id) as provider_reference,
             upgrade.amount as subtotal_amount,
             0::numeric as discount_amount,
             null::text as promo_code,
             upgrade.created_at,
             upgrade.completed_at
      from activation_upgrade_orders upgrade
      left join access_codes access on access.code = upgrade.access_code
      ${accessOrdersExist ? `
      left join lateral (
        select coalesce(nullif(trim(original_order.customer_email), ''), nullif(trim(original_order.payer_email), '')) as customer_email
        from access_orders original_order
        where coalesce(original_order.access_code, original_order.entitlement_access_code) = upgrade.access_code
          and original_order.order_id <> upgrade.order_id
        order by original_order.completed_at desc nulls last, original_order.created_at desc
        limit 1
      ) original on true
      where not exists (
        select 1 from access_orders canonical_order where canonical_order.order_id = upgrade.order_id
      )` : ""}
    `);
  }

  return sources.length ? `admin_orders as (${sources.join(" union all ")})` : "";
}

async function getDashboard() {
  const adminOrderSource = await getAdminOrderSource();
  const usageExists = await tableExists("code_usage_weekly");

  let summary = {
    totalOrders: 0,
    totalRevenue: 0,
    todayOrders: 0,
    todayRevenue: 0,
    sevenDayOrders: 0,
    sevenDayRevenue: 0,
    thirtyDayOrders: 0,
    thirtyDayRevenue: 0,
    emailSent: 0,
    emailFailed: 0,
    createdOrders: 0,
    staleCreatedOrders: 0,
    recentEmailFailures: 0,
    currency: "GBP",
    activations: 0
  };
  let daily = [];
  let methods = [];
  let orderTypes = [];
  let sites = [];
  let recentOrders = [];

  if (adminOrderSource) {
    const result = await pool.query(`
      with ${adminOrderSource}
      select
        count(*) filter (where status = 'COMPLETED')::int as total_orders,
        coalesce(sum(amount) filter (where status = 'COMPLETED'), 0) as total_revenue,
        count(*) filter (where status = 'COMPLETED' and completed_at >= date_trunc('day', now()))::int as today_orders,
        coalesce(sum(amount) filter (where status = 'COMPLETED' and completed_at >= date_trunc('day', now())), 0) as today_revenue,
        count(*) filter (where status = 'COMPLETED' and completed_at >= now() - interval '7 days')::int as seven_day_orders,
        coalesce(sum(amount) filter (where status = 'COMPLETED' and completed_at >= now() - interval '7 days'), 0) as seven_day_revenue,
        count(*) filter (where status = 'COMPLETED' and completed_at >= now() - interval '30 days')::int as thirty_day_orders,
        coalesce(sum(amount) filter (where status = 'COMPLETED' and completed_at >= now() - interval '30 days'), 0) as thirty_day_revenue,
        count(*) filter (where status = 'COMPLETED' and email_status = 'SENT')::int as email_sent,
        count(*) filter (where status = 'COMPLETED' and email_status = 'FAILED')::int as email_failed,
        count(*) filter (where status = 'CREATED')::int as created_orders,
        count(*) filter (where status = 'CREATED' and created_at < now() - interval '24 hours')::int as stale_created_orders,
        count(*) filter (where status = 'COMPLETED' and email_status = 'FAILED' and completed_at >= now() - interval '7 days')::int as recent_email_failures,
        coalesce(max(currency) filter (where status = 'COMPLETED'), 'GBP') as currency
      from admin_orders
    `);
    const row = result.rows[0] || {};
    summary = {
      ...summary,
      totalOrders: number(row.total_orders),
      totalRevenue: number(row.total_revenue),
      todayOrders: number(row.today_orders),
      todayRevenue: number(row.today_revenue),
      sevenDayOrders: number(row.seven_day_orders),
      sevenDayRevenue: number(row.seven_day_revenue),
      thirtyDayOrders: number(row.thirty_day_orders),
      thirtyDayRevenue: number(row.thirty_day_revenue),
      emailSent: number(row.email_sent),
      emailFailed: number(row.email_failed),
      createdOrders: number(row.created_orders),
      staleCreatedOrders: number(row.stale_created_orders),
      recentEmailFailures: number(row.recent_email_failures),
      currency: String(row.currency || "GBP")
    };

    const dailyResult = await pool.query(`
      with ${adminOrderSource},
      dates as (
        select generate_series(current_date - interval '29 days', current_date, interval '1 day')::date as day
      )
      select
        to_char(dates.day, 'YYYY-MM-DD') as date,
        count(o.order_id)::int as orders,
        coalesce(sum(o.amount), 0) as revenue
      from dates
      left join admin_orders o
        on o.status = 'COMPLETED'
       and (o.completed_at at time zone 'UTC')::date = dates.day
      group by dates.day
      order by dates.day
    `);
    daily = dailyResult.rows.map((entry) => ({
      date: entry.date,
      orders: number(entry.orders),
      revenue: number(entry.revenue)
    }));

    const methodsResult = await pool.query(`
      with ${adminOrderSource}
      select coalesce(nullif(payment_method, ''), 'unknown') as method,
             count(*)::int as orders,
             coalesce(sum(amount), 0) as revenue
      from admin_orders
      where status = 'COMPLETED'
      group by 1
      order by orders desc
    `);
    methods = methodsResult.rows.map((entry) => ({
      method: entry.method,
      orders: number(entry.orders),
      revenue: number(entry.revenue)
    }));

    const orderTypesResult = await pool.query(`
      with ${adminOrderSource}
      select coalesce(nullif(order_type, ''), 'access_code') as order_type,
             count(*)::int as orders,
             coalesce(sum(amount), 0) as revenue
      from admin_orders
      where status = 'COMPLETED'
      group by 1
      order by revenue desc, orders desc
    `);
    orderTypes = orderTypesResult.rows.map((entry) => ({
      orderType: entry.order_type,
      orders: number(entry.orders),
      revenue: number(entry.revenue)
    }));

    const sitesResult = await pool.query(`
      with ${adminOrderSource}
      select site_id, count(*)::int as orders, coalesce(sum(amount), 0) as revenue
      from admin_orders
      where status = 'COMPLETED'
      group by site_id
      order by revenue desc, orders desc
      limit 12
    `);
    const siteMap = new Map(getPublicSites().map((site) => [site.id, site]));
    sites = sitesResult.rows.map((entry) => ({
      siteId: entry.site_id,
      siteName: siteMap.get(entry.site_id)?.name || entry.site_id,
      orders: number(entry.orders),
      revenue: number(entry.revenue)
    }));

    recentOrders = await getOrders({ limit: 12 });
  }

  if (usageExists) {
    const usageResult = await pool.query(`select coalesce(sum(login_count), 0)::int as activations from code_usage_weekly`);
    summary.activations = number(usageResult.rows[0]?.activations);
  }

  const supportResult = await pool.query(`
    select
      count(*) filter (where status <> 'RESOLVED')::int as open,
      count(*) filter (where is_read = false)::int as unread
    from support_tickets
  `);
  return {
    summary,
    daily,
    methods,
    orderTypes,
    sites,
    recentOrders,
    support: {
      open: number(supportResult.rows[0]?.open),
      unread: number(supportResult.rows[0]?.unread)
    },
    operations: {
      createdOrders: number(summary.createdOrders),
      staleCreatedOrders: number(summary.staleCreatedOrders),
      recentEmailFailures: number(summary.recentEmailFailures)
    }
  };
}

function analyticsPeriodDays(value) {
  if (String(value || "").toLowerCase() === "all") return 36500;
  const days = Number.parseInt(String(value || "30"), 10);
  return [7, 30, 90, 180, 365, 36500].includes(days) ? days : 30;
}

function analyticsPeriodKey(value) {
  return String(value || "").toLowerCase() === "all" || Number(value) === 36500
    ? "all"
    : String(analyticsPeriodDays(value));
}

function analyticsContext() {
  const publicSites = getPublicSites();
  const validatedSites = getValidatedAnalyticsSites(publicSites);
  return {
    publicSites,
    siteMap: new Map(publicSites.map((site) => [site.id, site])),
    validatedSites,
    validSiteIds: [...validatedSites.valid.keys()]
  };
}

const ANALYTICS_VALID_HIT_WHERE = `
  is_bot = false
  and is_test = false
  and valid = true
  and environment = 'production'
  and source = 'public_site'
  and record_type = 'site_selection'
  and site_id = any($1::text[])
`;

function analyticsUsageTrendQuery(periodDays) {
  if (periodDays <= 90) return `
    with date_range as (
      select generate_series(
        current_date - ($2::int - 1),
        current_date,
        interval '1 day'
      )::date as day
    ), activity as (
      select
        created_at::date as day,
        count(*)::int as hits,
        count(distinct visitor_hash) filter (where visitor_hash is not null)::int as unique_visitors
      from site_interest_hits
      where ${ANALYTICS_VALID_HIT_WHERE}
        and created_at >= current_date - ($2::int - 1)
      group by 1
    )
    select to_char(date_range.day, 'YYYY-MM-DD') as date,
           coalesce(activity.hits, 0)::int as hits,
           coalesce(activity.unique_visitors, 0)::int as unique_visitors
    from date_range
    left join activity using (day)
    order by date_range.day
  `;

  const bucket = periodDays <= 180 ? "week" : "month";
  return `
    select
      to_char(date_trunc('${bucket}', created_at), 'YYYY-MM-DD') as date,
      count(*)::int as hits,
      count(distinct visitor_hash) filter (where visitor_hash is not null)::int as unique_visitors
    from site_interest_hits
    where ${ANALYTICS_VALID_HIT_WHERE}
      and created_at >= now() - ($2::int * interval '1 day')
    group by 1
    order by 1
  `;
}

async function getAnalyticsData(body = {}) {
  const periodDays = analyticsPeriodDays(body.periodDays);
  const periodKey = analyticsPeriodKey(body.periodDays);
  const limit = clampInt(body.limit, 10, 50, 25);
  const context = analyticsContext();
  const { siteMap, validatedSites, validSiteIds } = context;
  const [ordersExist, usageExists] = await Promise.all([
    tableExists("access_orders"),
    tableExists("code_usage_weekly")
  ]);
  const periodParams = [validSiteIds, periodDays];

  const queryTasks = [
    pool.query(`
      select
        count(*)::int as period_hits,
        count(*) filter (where created_at >= date_trunc('day', now()))::int as today_hits,
        count(*) filter (where created_at >= now() - interval '7 days')::int as seven_day_hits,
        count(*) filter (where order_id is null)::int as no_order_hits,
        count(distinct visitor_hash) filter (where visitor_hash is not null)::int as unique_visitors
      from site_interest_hits
      where ${ANALYTICS_VALID_HIT_WHERE}
        and created_at >= now() - ($2::int * interval '1 day')
    `, periodParams),
    pool.query(`
      select
        count(*) filter (where is_bot = true)::int as bot_hits,
        count(*) filter (
          where is_bot = false and not (
            is_test = false
            and valid = true
            and environment = 'production'
            and source = 'public_site'
            and record_type = 'site_selection'
            and site_id = any($1::text[])
          )
        )::int as excluded_hits
      from site_interest_hits
      where created_at >= now() - ($2::int * interval '1 day')
    `, periodParams),
    pool.query(`
      select site_id, count(*)::int as hits
      from site_interest_hits
      where ${ANALYTICS_VALID_HIT_WHERE}
        and created_at >= now() - ($2::int * interval '1 day')
      group by site_id
      order by hits desc, site_id
      limit 12
    `, periodParams),
    pool.query(`
      select coalesce(nullif(search_mode, ''), 'name') as mode, count(*)::int as hits
      from site_interest_hits
      where ${ANALYTICS_VALID_HIT_WHERE}
        and created_at >= now() - ($2::int * interval '1 day')
      group by 1
      order by hits desc
      limit 8
    `, periodParams),
    pool.query(`
      select coalesce(nullif(referrer, ''), 'Direct') as referrer, count(*)::int as hits
      from site_interest_hits
      where ${ANALYTICS_VALID_HIT_WHERE}
        and created_at >= now() - ($2::int * interval '1 day')
      group by 1
      order by hits desc
      limit 8
    `, periodParams),
    pool.query(`
      select lower(trim(search_query)) as query, count(*)::int as searches
      from site_interest_hits
      where ${ANALYTICS_VALID_HIT_WHERE}
        and created_at >= now() - ($2::int * interval '1 day')
        and nullif(trim(search_query), '') is not null
      group by 1
      order by searches desc, query
      limit 10
    `, periodParams),
    pool.query(analyticsUsageTrendQuery(periodDays), periodParams),
    pool.query(`
      select
        count(*) filter (where created_at >= now() - interval '30 days')::int as rejected_30_days,
        count(*) filter (where created_at >= date_trunc('day', now()))::int as rejected_today
      from admin_login_attempts
    `),
    pool.query(`
      select id, action, attempted_code_preview, attempted_code_hash, attempted_code_length, ip_hash, user_agent, created_at
      from admin_login_attempts
      order by id desc
      limit 25
    `),
    getAnalyticsEvents({ periodDays, limit }, context),
    getCityCoverage(periodDays, context)
  ];

  if (ordersExist) {
    queryTasks.push(pool.query(`
      select
        count(*) filter (where created_at >= now() - ($1::int * interval '1 day'))::int as created_orders,
        count(*) filter (where status = 'COMPLETED' and completed_at >= now() - ($1::int * interval '1 day'))::int as completed_orders
      from access_orders
    `, [periodDays]));
  } else queryTasks.push(Promise.resolve({ rows: [{}] }));

  if (usageExists) {
    queryTasks.push(pool.query(`
      with weeks as (
        select generate_series(
          date_trunc('week', current_date) - interval '11 weeks',
          date_trunc('week', current_date),
          interval '1 week'
        )::date as week
      ), activity as (
        select week_start::date as week,
               coalesce(sum(login_count), 0)::int as activations,
               count(distinct code)::int as active_codes
        from code_usage_weekly
        where week_start >= date_trunc('week', current_date) - interval '11 weeks'
        group by 1
      )
      select to_char(weeks.week, 'YYYY-MM-DD') as week,
             coalesce(activity.activations, 0)::int as activations,
             coalesce(activity.active_codes, 0)::int as active_codes
      from weeks
      left join activity using (week)
      order by weeks.week
    `));
  } else queryTasks.push(Promise.resolve({ rows: [] }));

  const [summaryResult, qualityResult, topSitesResult, modesResult, referrersResult, topSearchesResult, dailyResult, adminSummaryResult, adminRowsResult, events, cityCoverage, orderSummaryResult, weeklyResult] = await Promise.all(queryTasks);
  const summaryRow = summaryResult.rows[0] || {};
  const qualityRow = qualityResult.rows[0] || {};
  const orderRow = orderSummaryResult.rows[0] || {};
  const adminRow = adminSummaryResult.rows[0] || {};
  const summary = {
    periodHits: number(summaryRow.period_hits),
    todayHits: number(summaryRow.today_hits),
    sevenDayHits: number(summaryRow.seven_day_hits),
    noOrderHits: number(summaryRow.no_order_hits),
    uniqueVisitors: number(summaryRow.unique_visitors),
    botHits: number(qualityRow.bot_hits),
    excludedHits: number(qualityRow.excluded_hits),
    invalidSites: validatedSites.invalidSites.length,
    rejectedAdminLogins: number(adminRow.rejected_30_days),
    rejectedAdminLoginsToday: number(adminRow.rejected_today),
    createdOrders: number(orderRow.created_orders),
    completedOrders: number(orderRow.completed_orders)
  };
  const topSites = topSitesResult.rows.map((row) => ({
    siteId: row.site_id,
    siteName: siteMap.get(row.site_id)?.name || row.site_id,
    hits: number(row.hits)
  }));
  const modes = modesResult.rows.map((row) => ({ mode: row.mode, hits: number(row.hits) }));
  const referrers = referrersResult.rows.map((row) => ({ referrer: shortReferrer(row.referrer), hits: number(row.hits) }));
  const topSearches = topSearchesResult.rows.map((row) => ({ query: String(row.query || "").slice(0, 120), searches: number(row.searches) }));
  const daily = dailyResult.rows.map((row) => ({ date: row.date, hits: number(row.hits), uniqueVisitors: number(row.unique_visitors) }));
  const weeklyActivations = weeklyResult.rows.map((row) => ({ week: row.week, activations: number(row.activations), activeCodes: number(row.active_codes) }));
  const adminLoginAttempts = adminRowsResult.rows.map((row) => ({
    id: number(row.id),
    action: row.action || "authenticate",
    attemptedCodePreview: row.attempted_code_preview || "",
    attemptedCodeHash: row.attempted_code_hash || "",
    attemptedCodeLength: number(row.attempted_code_length),
    ipHash: row.ip_hash || "",
    userAgent: row.user_agent || "",
    createdAt: row.created_at
  }));

  return {
    meta: { periodDays, periodKey, generatedAt: new Date().toISOString(), payloadModel: "aggregated" },
    summary,
    daily,
    weeklyActivations,
    topSites,
    topSearches,
    modes,
    referrers,
    cityCoverage,
    recentHits: events.recentHits,
    recentHitsPage: events.recentHitsPage,
    adminLoginAttempts
  };
}

async function getCityCoverage(periodDays, context) {
  const activityResult = await pool.query(
    `
      select
        case
          when nullif(trim(visitor_hash), '') is not null then 'visitor:' || trim(visitor_hash)
          when nullif(trim(session_hash), '') is not null then 'session:' || trim(session_hash)
          else 'event:' || id::text
        end as user_id,
        site_id,
        created_at as occurred_at
      from site_interest_hits
      where ${ANALYTICS_VALID_HIT_WHERE}
        and created_at <= now()
      order by created_at asc, id asc
    `,
    [context.validSiteIds]
  );

  const periodEnd = new Date();
  const earliestActivity = activityResult.rows[0]?.occurred_at ? new Date(activityResult.rows[0].occurred_at) : null;
  const periodStart = periodDays >= 36500 && Number.isFinite(earliestActivity?.getTime())
    ? earliestActivity
    : new Date(periodEnd.getTime() - periodDays * 86400000);
  const options = {
    events: activityResult.rows.map((row) => ({
      userId: row.user_id,
      siteId: row.site_id,
      occurredAt: row.occurred_at
    })),
    cityBySite: Object.fromEntries(
      [...context.validatedSites.valid.entries()].map(([siteId, entry]) => [siteId, entry.city || ""])
    ),
    siteById: Object.fromEntries(context.publicSites.map((site) => [site.id, site])),
    rules: {
      activationUsers: process.env.CITY_ACTIVATION_USERS,
      establishedUsers: process.env.CITY_ESTABLISHED_USERS,
      establishedActiveWeeks: process.env.CITY_ESTABLISHED_ACTIVE_WEEKS,
      dormantDays: process.env.CITY_DORMANT_DAYS,
      takeoffDays: process.env.CITY_TAKEOFF_DAYS
    },
    periodStart,
    periodEnd
  };
  const result = calculateOrganicSpread(options);
  return {
    available: true,
    definition: "Each deduplicated user's first valid production site selection determines their join city. Results measure observed city-cluster diffusion, never referral attribution.",
    ...result,
    trend: result.coverageTrend
  };
}

async function getAnalyticsEvents(body = {}, suppliedContext = null) {
  const periodDays = analyticsPeriodDays(body.periodDays);
  const limit = clampInt(body.limit, 10, 50, 25);
  const cursor = Number.parseInt(String(body.cursor || ""), 10);
  const context = suppliedContext || analyticsContext();
  const params = [context.validSiteIds, periodDays, limit + 1];
  const cursorClause = Number.isSafeInteger(cursor) && cursor > 0 ? `and id < $4` : "";
  if (cursorClause) params.push(cursor);
  const result = await pool.query(`
    select id, site_id, search_mode, search_query, page_path, referrer, created_at
    from site_interest_hits
    where ${ANALYTICS_VALID_HIT_WHERE}
      and created_at >= now() - ($2::int * interval '1 day')
      ${cursorClause}
    order by id desc
    limit $3
  `, params);
  const hasMore = result.rows.length > limit;
  const rows = result.rows.slice(0, limit);
  const recentHits = rows.map((row) => ({
    id: number(row.id),
    siteId: row.site_id,
    siteName: context.siteMap.get(row.site_id)?.name || row.site_id,
    searchMode: row.search_mode || "",
    searchQuery: row.search_query || "",
    pagePath: row.page_path || "",
    referrer: shortReferrer(row.referrer || ""),
    createdAt: row.created_at
  }));
  return {
    recentHits,
    recentHitsPage: {
      returned: recentHits.length,
      hasMore,
      nextCursor: hasMore && rows.length ? String(rows[rows.length - 1].id) : null
    }
  };
}

async function getOrders(body = {}) {
  const adminOrderSource = await getAdminOrderSource();
  if (!adminOrderSource) return [];
  const limit = clampInt(body.limit, 1, 200, 50);
  const status = String(body.status || "COMPLETED").trim().toUpperCase();
  const params = [];
  const conditions = [];
  if (status && status !== "ALL") {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  params.push(limit);
  const { rows } = await pool.query(
    `
      with ${adminOrderSource}
      select order_id, site_id, amount, currency, status,
             linked_access_code,
             customer_email, email_status, payment_method,
             order_type, quantity, entitlement_week_start, entitlement_week_end, provider_reference,
             subtotal_amount, discount_amount, promo_code,
             created_at, completed_at
      from admin_orders
      ${conditions.length ? `where ${conditions.join(" and ")}` : ""}
      order by coalesce(completed_at, created_at) desc
      limit $${params.length}
    `,
    params
  );
  const siteMap = new Map(getPublicSites().map((site) => [site.id, site]));
  return rows.map((row) => ({
    orderId: row.order_id,
    siteId: row.site_id,
    siteName: siteMap.get(row.site_id)?.name || row.site_id,
    amount: number(row.amount),
    subtotal: number(row.subtotal_amount || row.amount),
    discountAmount: number(row.discount_amount),
    promoCode: row.promo_code || "",
    currency: row.currency,
    status: row.status,
    code: row.linked_access_code || "",
    email: row.customer_email || "",
    emailStatus: row.email_status || "",
    paymentMethod: row.payment_method || "unknown",
    orderType: row.order_type || "access_code",
    quantity: Math.max(1, number(row.quantity) || 1),
    entitlementWeekStart: row.entitlement_week_start || null,
    entitlementWeekEnd: row.entitlement_week_end || null,
    providerReference: row.provider_reference || "",
    createdAt: row.created_at,
    completedAt: row.completed_at
  }));
}

async function cleanupCreatedOrders(body = {}) {
  if (!(await tableExists("access_orders"))) return { deleted: 0 };
  const olderThanHours = clampInt(body.olderThanHours, 1, 720, 24);
  const limit = clampInt(body.limit, 1, 5000, 1000);
  const result = await pool.query(
    `
      delete from access_orders
      where order_id in (
        select order_id
        from access_orders
        where status = 'CREATED'
          and access_code is null
          and capture_id is null
          and completed_at is null
          and created_at < now() - ($1 || ' hours')::interval
        order by created_at asc
        limit $2
      )
      returning order_id
    `,
    [String(olderThanHours), limit]
  );
  return { deleted: result.rowCount || 0, olderThanHours };
}

async function getCustomerNoticeCustomers() {
  if (!(await tableExists("access_orders"))) return [];
  const { rows } = await pool.query(`
    with ranked as (
      select
        lower(trim(customer_email)) as email_key,
        trim(customer_email) as customer_email,
        site_id,
        order_id,
        email_status,
        coalesce(completed_at, created_at) as purchased_at,
        count(*) over (partition by lower(trim(customer_email)))::int as purchase_count,
        row_number() over (
          partition by lower(trim(customer_email))
          order by coalesce(completed_at, created_at) desc, order_id desc
        ) as row_number
      from access_orders
      where status = 'COMPLETED'
        and customer_email is not null
        and trim(customer_email) <> ''
    )
    select customer_email, site_id, order_id, email_status, purchased_at, purchase_count
    from ranked
    where row_number = 1
    order by purchased_at desc
    limit 1000
  `);
  const siteMap = new Map(getPublicSites().map((site) => [site.id, site]));
  return rows.map((row) => ({
    email: row.customer_email,
    siteId: row.site_id || "",
    siteName: siteMap.get(row.site_id)?.name || row.site_id || "",
    orderId: row.order_id || "",
    emailStatus: row.email_status || "",
    purchasedAt: row.purchased_at || null,
    purchaseCount: number(row.purchase_count)
  }));
}

async function sendCustomerWebsiteNotices(body = {}) {
  if (!RESEND_API_KEY || !SUPPORT_EMAIL_FROM) {
    throw new AdminError("Customer email sending is not configured.", 500, "email_not_configured");
  }

  const rawEmails = Array.isArray(body.emails)
    ? body.emails
    : String(body.emails || "").split(/[\s,;]+/);
  const uniqueEmails = [...new Map(
    rawEmails
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .map((email) => [email.toLowerCase(), email])
  ).values()];

  if (!uniqueEmails.length) throw new AdminError("Select at least one customer.", 400, "missing_recipients");
  if (uniqueEmails.length > 100) throw new AdminError("Send no more than 100 website updates at once.", 400, "too_many_recipients");
  const invalid = uniqueEmails.filter((email) => !isValidEmail(email));
  if (invalid.length) throw new AdminError(`Invalid email address: ${invalid[0]}`, 400, "invalid_email");

  const customerByEmail = new Map();
  if (await tableExists("access_orders")) {
    const keys = uniqueEmails.map((email) => email.toLowerCase());
    const result = await pool.query(
      `
        select distinct on (lower(trim(customer_email)))
               lower(trim(customer_email)) as email_key,
               trim(customer_email) as customer_email,
               site_id,
               order_id
        from access_orders
        where status = 'COMPLETED'
          and lower(trim(customer_email)) = any($1::text[])
        order by lower(trim(customer_email)), coalesce(completed_at, created_at) desc, order_id desc
      `,
      [keys]
    );
    for (const row of result.rows) customerByEmail.set(row.email_key, row);
  }

  const results = [];
  for (let index = 0; index < uniqueEmails.length; index += 4) {
    const batch = uniqueEmails.slice(index, index + 4);
    const batchResults = await Promise.all(batch.map(async (email) => {
      try {
        return await sendOneCustomerWebsiteNotice(email, customerByEmail.get(email.toLowerCase()) || {});
      } catch (error) {
        console.error("[admin-api] customer website notice failed:", error?.stack || error);
        return { email, status: "FAILED", error: String(error?.message || error).slice(0, 500) };
      }
    }));
    results.push(...batchResults);
  }

  return {
    requested: uniqueEmails.length,
    sent: results.filter((item) => item.status === "SENT").length,
    failed: results.filter((item) => item.status === "FAILED").length,
    results
  };
}

async function sendOneCustomerWebsiteNotice(email, customer = {}) {
  const site = getPublicSites().find((entry) => entry.id === customer.site_id);
  const siteName = site?.name || "";
  const siteLine = siteName ? ` for ${siteName}` : "";
  const websiteUrl = `${PUBLIC_SITE_URL}/`;
  const subject = "Our website has moved to circuitwash.com";
  const text = [
    "Hi,",
    `Our laundry website${siteLine} has moved to ${websiteUrl}.`,
    "You can use the new website to buy access codes, activate machines, and contact support.",
    "Any existing access code you have will continue to work.",
    `Need help? Reply to this email or contact ${SUPPORT_PUBLIC_EMAIL}.`,
    "CircuitWash"
  ].join("\n\n");
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a;line-height:1.55">
      <div style="padding:28px;border:1px solid #dbeafe;border-radius:18px;background:#ffffff">
        <div style="font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#0891b2">CircuitWash</div>
        <h1 style="margin:10px 0 8px;font-size:26px;line-height:1.2">Our website has moved</h1>
        <p style="margin:0 0 12px;color:#475569">Please use <strong>circuitwash.com</strong> for laundry access${escapeHtml(siteLine)}.</p>
        <p style="margin:0 0 22px;color:#475569">You can buy access codes, activate machines, and contact support from the new website. Any existing access code you have will continue to work.</p>
        <a href="${escapeHtml(websiteUrl)}" style="display:inline-block;padding:13px 20px;border-radius:11px;background:#0891b2;color:#ffffff;text-decoration:none;font-weight:700">Open circuitwash.com</a>
        <p style="margin:24px 0 0;font-size:12px;color:#64748b">Need support? Reply to this email or <a href="${escapeHtml(PUBLIC_SITE_URL)}/support.html?source=%2Femail">contact support online</a>.</p>
      </div>
    </div>`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `website-update-${crypto.randomUUID()}`
    },
    body: JSON.stringify({
      from: SUPPORT_EMAIL_FROM,
      to: [email],
      reply_to: [SUPPORT_PUBLIC_EMAIL],
      subject,
      text,
      html
    })
  });
  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok || !responseBody.id) {
    throw new Error(responseBody?.message || `Resend returned ${response.status}`);
  }
  return { email, status: "SENT", emailId: String(responseBody.id) };
}

function searchSites(body) {
  const query = String(body.query || "").trim();
  const mode = body.mode === "address" ? "address" : "name";
  if (query.length < 2 || query.length > 100) throw new AdminError("Type at least two characters.", 400, "invalid_query");
  return searchPublicSites(query, mode, 30);
}

async function createAccessCode(body) {
  if (!(await tableExists("access_codes"))) throw new AdminError("The access_codes table does not exist.", 500, "table_missing");
  const siteId = String(body.siteId || "").trim();
  const site = getPublicSites().find((entry) => entry.id === siteId);
  if (!site) throw new AdminError("Select a valid site.", 400, "invalid_site");

  let code = String(body.code || "").trim().toUpperCase();
  if (!code) code = generateCode(ACCESS_CODE_LENGTH);
  if (!/^[A-Z0-9_-]{4,64}$/.test(code)) {
    throw new AdminError("Codes must be 4–64 characters using letters, numbers, - or _.", 400, "invalid_code");
  }
  if (isAdminCode(code)) throw new AdminError("That code is reserved.", 400, "invalid_code");

  const weeklyLimit = clampInt(body.weeklyLimit, 1, 100, 5);
  const maxTotalUses = normalizeOptionalInt(body.maxTotalUses, 1, 100000);
  const deleteAfterUse = Boolean(body.deleteAfterUse);
  const result = await pool.query(
    `
      insert into access_codes (code, site_id, active, created_at, source, weekly_limit, max_total_uses, delete_after_use)
      values ($1, $2, true, now(), 'admin', $3, $4, $5)
      on conflict (code) do nothing
      returning code, site_id, active, created_at, source, weekly_limit, max_total_uses, delete_after_use, expires_at, deleted_at
    `,
    [code, siteId, weeklyLimit, maxTotalUses, deleteAfterUse]
  );
  if (!result.rows[0]) throw new AdminError("That access code already exists.", 409, "code_exists");
  return { code: mapCode(result.rows[0], site) };
}

async function listAccessCodes(body = {}) {
  if (!(await tableExists("access_codes"))) return [];
  const limit = clampInt(body.limit, 1, 500, 150);
  const query = String(body.query || "").trim().toLowerCase();
  const params = [];
  let where = "";
  if (query) {
    params.push(`%${query}%`);
    where = `where a.deleted_at is null and (lower(a.code) like $1 or lower(a.site_id) like $1)`;
  } else {
    where = `where a.deleted_at is null`;
  }
  params.push(limit);
  const limitParam = `$${params.length}`;
  const usageExists = await tableExists("code_usage_weekly");
  const usageJoins = usageExists
    ? `
      left join (
        select code, sum(login_count)::int as uses, max(last_used_at) as last_used_at
        from code_usage_weekly group by code
      ) u on u.code = a.code
      left join code_usage_weekly cw
        on cw.code = a.code and cw.week_start = date_trunc('week', now() at time zone 'UTC')::date
    `
    : "";
  const usageFields = usageExists
    ? "coalesce(u.uses,0) as uses, u.last_used_at, coalesce(cw.login_count,0)::int as weekly_uses"
    : "0 as uses, null::timestamptz as last_used_at, 0::int as weekly_uses";
  const { rows } = await pool.query(
    `
      select a.code, a.site_id, a.active, a.created_at, a.source,
             a.weekly_limit, a.max_total_uses, a.delete_after_use, a.expires_at, a.deleted_at, ${usageFields}
      from access_codes a
      ${usageJoins}
      ${where}
      order by a.created_at desc nulls last, a.code
      limit ${limitParam}
    `,
    params
  );
  const siteMap = new Map(getPublicSites().map((site) => [site.id, site]));
  return rows.map((row) => mapCode(row, siteMap.get(row.site_id)));
}

async function setCodeActive(body) {
  const code = String(body.code || "").trim();
  const active = Boolean(body.active);
  if (!code) throw new AdminError("Missing code.", 400, "missing_code");
  const result = await pool.query(
    `update access_codes set active = $2 where code = $1 and deleted_at is null returning code, site_id, active, created_at, source, weekly_limit, max_total_uses, delete_after_use, expires_at, deleted_at`,
    [code, active]
  );
  if (!result.rows[0]) throw new AdminError("Code not found.", 404, "code_not_found");
  const site = getPublicSites().find((entry) => entry.id === result.rows[0].site_id);
  return { code: mapCode(result.rows[0], site) };
}

async function setCodeWeeklyLimit(body) {
  const code = String(body.code || "").trim();
  const weeklyLimit = clampInt(body.weeklyLimit, 1, 100, 5);
  if (!code) throw new AdminError("Missing code.", 400, "missing_code");
  const result = await pool.query(
    `
      update access_codes
      set weekly_limit = $2
      where code = $1
        and deleted_at is null
      returning code, site_id, active, created_at, source, weekly_limit, max_total_uses, delete_after_use, expires_at, deleted_at
    `,
    [code, weeklyLimit]
  );
  if (!result.rows[0]) throw new AdminError("Code not found.", 404, "code_not_found");
  const site = getPublicSites().find((entry) => entry.id === result.rows[0].site_id);
  return { code: mapCode(result.rows[0], site) };
}

async function deleteAccessCode(body = {}) {
  if (!(await tableExists("access_codes"))) throw new AdminError("The access_codes table does not exist.", 500, "table_missing");
  const code = String(body.code || "").trim();
  if (!code) throw new AdminError("Missing code.", 400, "missing_code");

  const result = await pool.query(
    `
      update access_codes
      set active = false,
          deleted_at = coalesce(deleted_at, now())
      where code = $1
        and deleted_at is null
      returning code
    `,
    [code]
  );
  if (!result.rows[0]) throw new AdminError("Code not found.", 404, "code_not_found");
  return { code, deleted: true, historyRetained: true };
}

async function createPromoCode(body = {}) {
  const code = normalizePromoCode(body.code);
  if (isAdminCode(code)) throw new AdminError("That promo code is reserved.", 400, "invalid_code");

  const { discountType, discountValue } = normalizePromoDiscount(body);
  const siteId = normalizePromoSiteId(body.siteId);
  const allowFree = Boolean(body.allowFree);
  const maxRedemptions = normalizeOptionalInt(body.maxRedemptions, 1, 100000);
  let accessMaxTotalUses = normalizeOptionalInt(body.accessMaxTotalUses, 1, 100000);
  if (allowFree && !accessMaxTotalUses) accessMaxTotalUses = 1;
  const result = await pool.query(
    `
      insert into promo_codes
        (code, discount_type, discount_value, active, site_id, allow_free, max_redemptions, access_max_total_uses, created_at, updated_at)
      values ($1, $2, $3::numeric, true, $4, $5, $6, $7, now(), now())
      on conflict (code) do nothing
      returning code, discount_type, discount_value, active, site_id, allow_free, max_redemptions, access_max_total_uses, created_at, updated_at
    `,
    [code, discountType, discountValue.toFixed(2), siteId || null, allowFree, maxRedemptions, accessMaxTotalUses]
  );
  if (!result.rows[0]) throw new AdminError("That promo code already exists.", 409, "promo_exists");
  return { promo: mapPromo(result.rows[0]) };
}

async function listPromoCodes(body = {}) {
  const limit = clampInt(body.limit, 1, 500, 200);
  const query = String(body.query || "").trim().toUpperCase();
  const params = [];
  let where = "";
  if (query) {
    params.push(`%${query}%`);
    where = `where p.code like $1`;
  }
  params.push(limit);

  const ordersExist = await tableExists("access_orders");
  const orderJoin = ordersExist
    ? `
      left join (
        select
          promo_code,
          count(*)::int as created_orders,
          count(*) filter (where status = 'COMPLETED')::int as successful_orders,
          count(distinct lower(trim(customer_email))) filter (
            where status = 'COMPLETED' and customer_email is not null and trim(customer_email) <> ''
          )::int as customers,
          coalesce(sum(subtotal_amount) filter (where status = 'COMPLETED'), 0) as gross_revenue,
          coalesce(sum(discount_amount) filter (where status = 'COMPLETED'), 0) as discount_total,
          coalesce(sum(amount) filter (where status = 'COMPLETED'), 0) as net_revenue,
          max(completed_at) filter (where status = 'COMPLETED') as last_used_at
        from access_orders
        where promo_code is not null
        group by promo_code
      ) o on o.promo_code = p.code
    `
    : "";
  const orderFields = ordersExist
    ? `
      coalesce(o.created_orders, 0)::int as created_orders,
      coalesce(o.successful_orders, 0)::int as successful_orders,
      coalesce(o.customers, 0)::int as customers,
      coalesce(o.gross_revenue, 0) as gross_revenue,
      coalesce(o.discount_total, 0) as discount_total,
      coalesce(o.net_revenue, 0) as net_revenue,
      o.last_used_at
    `
    : `
      0::int as created_orders,
      0::int as successful_orders,
      0::int as customers,
      0::numeric as gross_revenue,
      0::numeric as discount_total,
      0::numeric as net_revenue,
      null::timestamptz as last_used_at
    `;

  const { rows } = await pool.query(
    `
      select p.code, p.discount_type, p.discount_value, p.active, p.site_id, p.allow_free, p.max_redemptions, p.access_max_total_uses, p.created_at, p.updated_at,
             ${orderFields}
      from promo_codes p
      ${orderJoin}
      ${where}
      order by p.created_at desc, p.code
      limit $${params.length}
    `,
    params
  );
  return rows.map(mapPromo);
}

async function setPromoActive(body = {}) {
  const code = normalizePromoCode(body.code);
  const active = Boolean(body.active);
  const result = await pool.query(
    `
      update promo_codes
      set active = $2, updated_at = now()
      where code = $1
      returning code, discount_type, discount_value, active, site_id, allow_free, max_redemptions, access_max_total_uses, created_at, updated_at
    `,
    [code, active]
  );
  if (!result.rows[0]) throw new AdminError("Promo code not found.", 404, "promo_not_found");
  return { promo: mapPromo(result.rows[0]) };
}

async function updatePromoCode(body = {}) {
  const code = normalizePromoCode(body.code);
  const { discountType, discountValue } = normalizePromoDiscount(body);
  const maxRedemptions = normalizeOptionalInt(body.maxRedemptions, 1, 100000);
  const accessMaxTotalUses = normalizeOptionalInt(body.accessMaxTotalUses, 1, 100000);
  const result = await pool.query(
    `
      update promo_codes
      set discount_type = $2,
          discount_value = $3::numeric,
          max_redemptions = $4,
          access_max_total_uses = $5,
          updated_at = now()
      where code = $1
      returning code, discount_type, discount_value, active, site_id, allow_free, max_redemptions, access_max_total_uses, created_at, updated_at
    `,
    [code, discountType, discountValue.toFixed(2), maxRedemptions, accessMaxTotalUses]
  );
  if (!result.rows[0]) throw new AdminError("Promo code not found.", 404, "promo_not_found");
  return { promo: mapPromo(result.rows[0]) };
}

async function deletePromoCode(body = {}) {
  const code = normalizePromoCode(body.code);

  const client = await pool.connect();
  try {
    await client.query("begin");
    const locked = await client.query(
      `select code from promo_codes where code = $1 for update`,
      [code]
    );
    if (!locked.rows[0]) throw new AdminError("Promo code not found.", 404, "promo_not_found");

    const cleanup = await deletePromoCodesWithHistory(client, [code]);
    await client.query("commit");
    return { code, deleted: true, deletedHistory: cleanup };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function getFreeTrialData() {
  const enabled = await isFreeTrialEnabled();
  const publicSites = getPublicSites();
  const siteMap = new Map(publicSites.map((site) => [site.id, site]));
  const siteLimits = await getFreeTrialSiteLimits();
  const siteStatsResult = await pool.query(`
    select
      site_id,
      count(*)::int as claims,
      count(*) filter (where activated_at is not null)::int as activations,
      max(created_at) as last_claimed_at,
      max(activated_at) as last_activated_at
    from free_trial_claims
    group by site_id
    order by max(created_at) desc
  `);
  const summaryResult = await pool.query(`
    select count(*)::int as issued,
           count(*) filter (where activated_at is not null)::int as activated
    from free_trial_claims
  `);
  const weeklyResult = await pool.query(`
    select site_id, count(*)::int as used
    from free_trial_claims
    where created_at >= date_trunc('week', now())
    group by site_id
  `);
  const weeklyUsage = new Map(weeklyResult.rows.map((row) => [row.site_id, number(row.used)]));
  const limits = Object.entries(siteLimits)
    .map(([siteId, limit]) => {
      const site = siteMap.get(siteId);
      const weeklyLimit = normalizeFreeTrialLimit(limit);
      if (!site || weeklyLimit === null) return null;
      const usedThisWeek = weeklyUsage.get(siteId) || 0;
      return {
        siteId,
        siteName: site.name,
        siteAddress: site.address || "",
        weeklyLimit,
        usedThisWeek,
        remainingThisWeek: Math.max(0, weeklyLimit - usedThisWeek)
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.siteName.localeCompare(b.siteName));
  const siteStats = siteStatsResult.rows.map((row) => ({
    siteId: row.site_id,
    siteName: siteMap.get(row.site_id)?.name || row.site_id,
    siteAddress: siteMap.get(row.site_id)?.address || "",
    claims: number(row.claims),
    activations: number(row.activations),
    lastClaimedAt: row.last_claimed_at || null,
    lastActivatedAt: row.last_activated_at || null
  }));
  const issued = number(summaryResult.rows[0]?.issued);
  const activated = number(summaryResult.rows[0]?.activated);
  return {
    enabled,
    summary: {
      issued,
      activated,
      waiting: Math.max(0, issued - activated),
      activationRate: issued ? Math.round((activated / issued) * 100) : 0
    },
    siteStats,
    limits
  };
}

async function isFreeTrialEnabled() {
  const result = await pool.query(`select value from app_settings where key = $1 limit 1`, [TRIAL_SETTING_KEY]);
  if (!result.rows.length) return true;
  const value = result.rows[0].value;
  if (typeof value === "boolean") return value;
  return value?.enabled !== false;
}

async function setFreeTrialEnabled(body = {}) {
  if (typeof body.enabled !== "boolean") {
    throw new AdminError("Choose whether homepage free trials are enabled.", 400, "invalid_trial_setting");
  }
  await pool.query(`
    insert into app_settings (key, value, updated_at)
    values ($1, $2::jsonb, now())
    on conflict (key) do update set value = excluded.value, updated_at = now()
  `, [TRIAL_SETTING_KEY, JSON.stringify(body.enabled)]);
  return body.enabled;
}

async function getFreeTrialSiteLimits(db = pool) {
  const result = await db.query(`select value from app_settings where key = $1 limit 1`, [TRIAL_SITE_LIMITS_KEY]);
  const value = result.rows[0]?.value;
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeFreeTrialLimit(value) {
  const limit = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(limit) && limit >= 0 ? Math.min(10000, limit) : null;
}

async function setFreeTrialSiteLimit(body = {}) {
  const siteId = String(body.siteId || "").trim();
  const site = getPublicSites().find((entry) => entry.id === siteId);
  if (!site) throw new AdminError("Select a valid site.", 400, "invalid_site");
  const weeklyLimit = normalizeFreeTrialLimit(body.weeklyLimit);
  const remove = Boolean(body.remove);
  if (!remove && weeklyLimit === null) {
    throw new AdminError("Enter a weekly claim limit from 0 to 10,000.", 400, "invalid_trial_limit");
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [TRIAL_SITE_LIMITS_KEY]);
    const limits = await getFreeTrialSiteLimits(client);
    if (remove) {
      delete limits[siteId];
    } else {
      limits[siteId] = weeklyLimit;
    }
    await client.query(`
      insert into app_settings (key, value, updated_at)
      values ($1, $2::jsonb, now())
      on conflict (key) do update set value = excluded.value, updated_at = now()
    `, [TRIAL_SITE_LIMITS_KEY, JSON.stringify(limits)]);
    await client.query("commit");
    return {
      siteId,
      siteName: site.name,
      weeklyLimit: remove ? null : weeklyLimit,
      limits: Object.entries(limits)
        .map(([id, limit]) => {
          const limitSite = getPublicSites().find((entry) => entry.id === id);
          const normalized = normalizeFreeTrialLimit(limit);
          return limitSite && normalized !== null ? { siteId: id, siteName: limitSite.name, siteAddress: limitSite.address || "", weeklyLimit: normalized } : null;
        })
        .filter(Boolean)
    };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function deletePromoCodesWithHistory(client, promoCodes = []) {
  const codes = uniqueText(promoCodes);
  const empty = {
    promos: 0,
    orders: 0,
    accessCodes: 0,
    usageRows: 0,
    feedbackInvitations: 0,
    feedbackPromptStates: 0,
    referralRewards: 0
  };
  if (!codes.length || !(await tableExists("promo_codes", client))) return empty;

  const existing = await client.query(
    `select code from promo_codes where code = any($1::text[]) for update`,
    [codes]
  );
  const existingCodes = existing.rows.map((row) => row.code);
  if (!existingCodes.length) return empty;

  const orderRows = await getOrderRowsForPromoCodes(client, existingCodes);
  const orderIds = orderRows.map((row) => row.order_id).filter(Boolean);
  const accessCodes = uniqueText(orderRows.map((row) => row.access_code));
  const relatedCleanup = await deleteCodeRelatedHistory(client, { codes: accessCodes, orderIds });

  let referralRewards = relatedCleanup.referralRewards;
  if (await tableExists("referral_rewards", client) && await columnExists("referral_rewards", "promo_code", client)) {
    const referralDelete = await client.query(
      `delete from referral_rewards where promo_code = any($1::text[])`,
      [existingCodes]
    );
    referralRewards += referralDelete.rowCount || 0;
  }

  const orderDelete = await deleteOrdersForPromoCodes(client, existingCodes);
  const accessCodeDelete = await deleteAccessCodesByCode(client, accessCodes);
  const promoDelete = await client.query(
    `delete from promo_codes where code = any($1::text[])`,
    [existingCodes]
  );

  return {
    promos: promoDelete.rowCount || 0,
    orders: orderDelete,
    accessCodes: accessCodeDelete,
    usageRows: relatedCleanup.usageRows,
    feedbackInvitations: relatedCleanup.feedbackInvitations,
    feedbackPromptStates: relatedCleanup.feedbackPromptStates,
    referralRewards
  };
}

async function deleteCodeRelatedHistory(client, { codes = [], orderIds = [] } = {}) {
  const cleanCodes = uniqueText(codes);
  const cleanOrderIds = uniqueText(orderIds);
  const counts = {
    usageRows: 0,
    feedbackInvitations: 0,
    feedbackPromptStates: 0,
    referralRewards: 0
  };

  if (cleanCodes.length && await tableExists("code_usage_weekly", client)) {
    const usageDelete = await client.query(
      `delete from code_usage_weekly where code = any($1::text[])`,
      [cleanCodes]
    );
    counts.usageRows = usageDelete.rowCount || 0;
  }

  if (cleanCodes.length && await tableExists("feedback_prompt_state", client) && await columnExists("feedback_prompt_state", "access_code", client)) {
    const promptDelete = await client.query(
      `delete from feedback_prompt_state where access_code = any($1::text[])`,
      [cleanCodes]
    );
    counts.feedbackPromptStates = promptDelete.rowCount || 0;
  }

  if (await tableExists("feedback_invitations", client)) {
    const conditions = [];
    const params = [];
    if (cleanCodes.length && await columnExists("feedback_invitations", "access_code", client)) {
      params.push(cleanCodes);
      conditions.push(`access_code = any($${params.length}::text[])`);
    }
    if (cleanOrderIds.length && await columnExists("feedback_invitations", "order_id", client)) {
      params.push(cleanOrderIds);
      conditions.push(`order_id = any($${params.length}::text[])`);
    }
    if (conditions.length) {
      const feedbackDelete = await client.query(
        `delete from feedback_invitations where ${conditions.join(" or ")}`,
        params
      );
      counts.feedbackInvitations = feedbackDelete.rowCount || 0;
    }
  }

  if (await tableExists("referral_rewards", client)) {
    const conditions = [];
    const params = [];
    if (cleanCodes.length && await columnExists("referral_rewards", "referrer_code", client)) {
      params.push(cleanCodes);
      conditions.push(`referrer_code = any($${params.length}::text[])`);
    }
    if (cleanCodes.length && await columnExists("referral_rewards", "referred_access_code", client)) {
      params.push(cleanCodes);
      conditions.push(`referred_access_code = any($${params.length}::text[])`);
    }
    if (cleanOrderIds.length && await columnExists("referral_rewards", "referred_order_id", client)) {
      params.push(cleanOrderIds);
      conditions.push(`referred_order_id = any($${params.length}::text[])`);
    }
    if (conditions.length) {
      const referralDelete = await client.query(
        `delete from referral_rewards where ${conditions.join(" or ")}`,
        params
      );
      counts.referralRewards = referralDelete.rowCount || 0;
    }
  }

  return counts;
}

async function getOrderRowsForAccessCodes(client, codes = []) {
  const cleanCodes = uniqueText(codes);
  if (!cleanCodes.length || !(await tableExists("access_orders", client))) return [];
  const { rows } = await client.query(
    `select order_id, coalesce(access_code, entitlement_access_code) as access_code from access_orders where access_code = any($1::text[]) or entitlement_access_code = any($1::text[])`,
    [cleanCodes]
  );
  return rows;
}

async function getOrderRowsForPromoCodes(client, promoCodes = []) {
  const codes = uniqueText(promoCodes);
  if (!codes.length || !(await tableExists("access_orders", client))) return [];
  const { rows } = await client.query(
    `select order_id, access_code from access_orders where promo_code = any($1::text[])`,
    [codes]
  );
  return rows;
}

async function getReferralPromoCodesForAccessCodes(client, codes = []) {
  const cleanCodes = uniqueText(codes);
  if (!cleanCodes.length || !(await tableExists("referral_rewards", client))) return [];
  if (!(await columnExists("referral_rewards", "referrer_code", client)) || !(await columnExists("referral_rewards", "promo_code", client))) return [];
  const { rows } = await client.query(
    `select promo_code from referral_rewards where referrer_code = any($1::text[]) and promo_code is not null`,
    [cleanCodes]
  );
  return rows.map((row) => row.promo_code);
}

async function deleteOrdersForAccessCodes(client, codes = []) {
  const cleanCodes = uniqueText(codes);
  if (!cleanCodes.length || !(await tableExists("access_orders", client))) return 0;
  const result = await client.query(
    `delete from access_orders where access_code = any($1::text[]) or entitlement_access_code = any($1::text[])`,
    [cleanCodes]
  );
  return result.rowCount || 0;
}

async function deleteOrdersForPromoCodes(client, promoCodes = []) {
  const codes = uniqueText(promoCodes);
  if (!codes.length || !(await tableExists("access_orders", client))) return 0;
  const result = await client.query(
    `delete from access_orders where promo_code = any($1::text[])`,
    [codes]
  );
  return result.rowCount || 0;
}

async function deleteAccessCodesByCode(client, codes = []) {
  const cleanCodes = uniqueText(codes);
  if (!cleanCodes.length || !(await tableExists("access_codes", client))) return 0;
  const result = await client.query(
    `delete from access_codes where code = any($1::text[])`,
    [cleanCodes]
  );
  return result.rowCount || 0;
}

async function getFeedbackData() {
  const enabled = await isFeedbackEnabled();
  const candidates = [];
  if (await tableExists("access_orders")) {
    const result = await pool.query(`
      with ranked as (
        select
          lower(trim(customer_email)) as email_key,
          trim(customer_email) as customer_email,
          site_id,
          order_id,
          coalesce(completed_at, created_at) as purchased_at,
          count(*) over (partition by lower(trim(customer_email)))::int as purchase_count,
          row_number() over (
            partition by lower(trim(customer_email))
            order by coalesce(completed_at, created_at) desc, order_id desc
          ) as row_number
        from access_orders
        where status = 'COMPLETED'
          and customer_email is not null
          and trim(customer_email) <> ''
      ), invite_status as (
        select
          lower(recipient_email) as email_key,
          max(sent_at) filter (where status in ('SENT', 'RESPONDED')) as last_invited_at,
          max(responded_at) as last_responded_at
        from feedback_invitations
        where coalesce(source, 'EMAIL') <> 'TEST'
        group by lower(recipient_email)
      )
      select r.customer_email, r.site_id, r.order_id, r.purchased_at, r.purchase_count,
             i.last_invited_at, i.last_responded_at
      from ranked r
      left join invite_status i on i.email_key = r.email_key
      where r.row_number = 1
      order by r.purchased_at desc
      limit 500
    `);
    const siteMap = new Map(getPublicSites().map((site) => [site.id, site]));
    for (const row of result.rows) {
      candidates.push({
        email: row.customer_email,
        siteId: row.site_id || "",
        siteName: siteMap.get(row.site_id)?.name || row.site_id || "",
        orderId: row.order_id || "",
        purchasedAt: row.purchased_at || null,
        purchaseCount: number(row.purchase_count),
        lastInvitedAt: row.last_invited_at || null,
        lastRespondedAt: row.last_responded_at || null
      });
    }
  }

  const summaryResult = await pool.query(`
    select
      count(*) filter (
        where i.status in ('SENT', 'RESPONDED')
          and coalesce(i.source, 'EMAIL') = 'EMAIL'
      )::int as invitations_sent,
      count(*) filter (
        where i.status in ('SENT', 'RESPONDED')
          and coalesce(i.source, 'EMAIL') = 'POPUP'
      )::int as popup_prompts,
      count(r.id) filter (where coalesce(i.source, 'EMAIL') <> 'TEST')::int as responses,
      count(r.id) filter (where coalesce(i.source, 'EMAIL') = 'EMAIL')::int as email_responses,
      count(r.id) filter (where coalesce(i.source, 'EMAIL') = 'POPUP')::int as popup_responses,
      count(r.id) filter (where coalesce(i.source, 'EMAIL') = 'TEST')::int as test_responses,
      coalesce(round((avg(r.rating) filter (where coalesce(i.source, 'EMAIL') <> 'TEST'))::numeric, 2), 0) as average_rating,
      count(r.id) filter (where r.recommend = 'YES' and coalesce(i.source, 'EMAIL') <> 'TEST')::int as recommend_yes,
      count(r.id) filter (where r.recommend = 'MAYBE' and coalesce(i.source, 'EMAIL') <> 'TEST')::int as recommend_maybe,
      count(r.id) filter (where r.recommend = 'NO' and coalesce(i.source, 'EMAIL') <> 'TEST')::int as recommend_no
    from feedback_invitations i
    left join feedback_responses r on r.invitation_id = i.id
  `);
  const summaryRow = summaryResult.rows[0] || {};
  const invitationsSent = number(summaryRow.invitations_sent);
  const responsesCount = number(summaryRow.responses);
  const emailResponses = number(summaryRow.email_responses);
  const recommendYes = number(summaryRow.recommend_yes);
  const summary = {
    invitationsSent,
    responses: responsesCount,
    emailResponses,
    popupPrompts: number(summaryRow.popup_prompts),
    popupResponses: number(summaryRow.popup_responses),
    testResponses: number(summaryRow.test_responses),
    responseRate: invitationsSent ? Math.round((emailResponses / invitationsSent) * 1000) / 10 : 0,
    averageRating: number(summaryRow.average_rating),
    recommendYes,
    recommendMaybe: number(summaryRow.recommend_maybe),
    recommendNo: number(summaryRow.recommend_no),
    recommendRate: responsesCount ? Math.round((recommendYes / responsesCount) * 1000) / 10 : 0
  };

  const distributionResult = await pool.query(`
    select r.rating, count(*)::int as responses
    from feedback_responses r
    join feedback_invitations i on i.id = r.invitation_id
    where coalesce(i.source, 'EMAIL') <> 'TEST'
    group by r.rating
    order by r.rating desc
  `);
  const distributionMap = new Map(distributionResult.rows.map((row) => [number(row.rating), number(row.responses)]));
  const distribution = [5, 4, 3, 2, 1].map((rating) => ({ rating, responses: distributionMap.get(rating) || 0 }));

  const responsesResult = await pool.query(`
    select r.id, r.rating, r.recommend, r.comments, r.submitted_at,
           i.recipient_email, i.site_id, i.order_id, coalesce(i.source, 'EMAIL') as source
    from feedback_responses r
    join feedback_invitations i on i.id = r.invitation_id
    order by r.submitted_at desc
    limit 200
  `);
  const siteMap = new Map(getPublicSites().map((site) => [site.id, site]));
  const responses = responsesResult.rows.map((row) => ({
    id: number(row.id),
    email: row.recipient_email,
    siteId: row.site_id || "",
    siteName: siteMap.get(row.site_id)?.name || row.site_id || "",
    orderId: row.order_id || "",
    source: row.source || "EMAIL",
    rating: number(row.rating),
    recommend: row.recommend,
    comments: row.comments || "",
    submittedAt: row.submitted_at
  }));

  const invitationResult = await pool.query(`
    select id, recipient_email, site_id, coalesce(source, 'EMAIL') as source,
           status, sent_at, responded_at, send_error, created_at
    from feedback_invitations
    order by created_at desc
    limit 100
  `);
  const invitations = invitationResult.rows.map((row) => ({
    id: number(row.id),
    email: row.recipient_email,
    siteId: row.site_id || "",
    siteName: siteMap.get(row.site_id)?.name || row.site_id || "",
    source: row.source || "EMAIL",
    status: row.status,
    sentAt: row.sent_at || null,
    respondedAt: row.responded_at || null,
    error: row.send_error || "",
    createdAt: row.created_at
  }));

  return { enabled, candidates, summary, distribution, responses, invitations };
}

async function isFeedbackEnabled() {
  const result = await pool.query(`select value from app_settings where key = 'feedback_enabled' limit 1`);
  if (!result.rows.length) return true;
  const value = result.rows[0].value;
  if (typeof value === "boolean") return value;
  return value?.enabled !== false;
}

async function setFeedbackEnabled(body = {}) {
  if (typeof body.enabled !== "boolean") {
    throw new AdminError("Choose whether feedback is enabled.", 400, "invalid_feedback_setting");
  }
  await pool.query(
    `
      insert into app_settings (key, value, updated_at)
      values ('feedback_enabled', $1::jsonb, now())
      on conflict (key) do update set value = excluded.value, updated_at = now()
    `,
    [JSON.stringify(body.enabled)]
  );
  return body.enabled;
}

async function createFeedbackTestResponse(body = {}) {
  const rating = Number.parseInt(String(body.rating || ""), 10);
  const recommend = String(body.recommend || recommendationForRating(rating)).trim().toUpperCase();
  const comments = String(body.comments || "").trim();
  const email = String(body.email || `test-feedback-${Date.now()}@circuitwash.test`).trim();
  const sites = getPublicSites();
  const requestedSiteId = String(body.siteId || "").trim();
  const siteId = sites.some((site) => site.id === requestedSiteId) ? requestedSiteId : String(sites[0]?.id || "");

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new AdminError("Choose a rating from 1 to 5 stars.", 400, "invalid_rating");
  }
  if (!["YES", "MAYBE", "NO"].includes(recommend)) {
    throw new AdminError("Choose yes, maybe or no for recommendation.", 400, "invalid_recommendation");
  }
  if (!isValidEmail(email)) throw new AdminError("Enter a valid test email address.", 400, "invalid_email");
  if (comments.length > 4000) throw new AdminError("Keep comments under 4,000 characters.", 400, "comments_too_long");

  const tokenHash = crypto.createHash("sha256").update(`test-${crypto.randomUUID()}`).digest("hex");
  const orderId = `TEST-${Date.now()}`;
  const client = await pool.connect();
  try {
    await client.query("begin");
    const invitation = await client.query(
      `
        insert into feedback_invitations (
          token_hash, recipient_email, order_id, site_id, status, sent_at,
          expires_at, responded_at, source, send_error, created_at, updated_at
        )
        values ($1, $2, $3, nullif($4, ''), 'RESPONDED', now(), now() + interval '7 days',
                now(), 'TEST', 'Created from feedback-test.html', now(), now())
        returning id
      `,
      [tokenHash, email, orderId, siteId]
    );
    const response = await client.query(
      `
        insert into feedback_responses (invitation_id, rating, recommend, comments, submitted_at)
        values ($1, $2, $3, $4, now())
        returning id, submitted_at
      `,
      [invitation.rows[0].id, rating, recommend, comments]
    );
    await client.query("commit");
    return {
      invitationId: number(invitation.rows[0].id),
      responseId: number(response.rows[0].id),
      submittedAt: response.rows[0].submitted_at,
      email,
      siteId,
      source: "TEST"
    };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function deleteFeedbackTestResponses() {
  const result = await pool.query(`delete from feedback_invitations where coalesce(source, 'EMAIL') = 'TEST'`);
  return { deleted: result.rowCount || 0 };
}

async function setupFeedbackPopupTest(body = {}) {
  if (!(await tableExists("access_codes"))) throw new AdminError("The access_codes table does not exist.", 500, "table_missing");
  if (!(await tableExists("access_orders"))) throw new AdminError("The access_orders table does not exist.", 500, "table_missing");

  await ensureUsageSchemaForFeedbackTest();

  const sites = getPublicSites();
  const requestedSiteId = String(body.siteId || "").trim();
  const siteId = sites.some((site) => site.id === requestedSiteId) ? requestedSiteId : String(sites[0]?.id || "");
  if (!siteId) throw new AdminError("No public site is configured for the popup test.", 500, "site_missing");

  const stamp = Date.now().toString(36).toUpperCase();
  const code = `FBT-${stamp}-${generateCode(4)}`;
  const email = String(body.email || `popup-test-${stamp.toLowerCase()}@circuitwash.test`).trim();
  if (!isValidEmail(email)) throw new AdminError("Enter a valid popup test email address.", 400, "invalid_email");

  const orderId = `POPUP-TEST-${stamp}`;
  const weekStart = await currentUtcWeekStart();
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `
        insert into access_codes (
          code, site_id, active, created_at, source, weekly_limit,
          max_total_uses, delete_after_use, expires_at, deleted_at
        )
        values ($1, $2, true, now() - interval '10 days', 'feedback-test', 20, null, false,
                now() + interval '30 days', null)
      `,
      [code, siteId]
    );
    await client.query(
      `
        insert into code_usage_weekly (code, week_start, login_count, first_used_at, last_used_at)
        values ($1, $2::date, 4, now() - interval '8 days', now() - interval '1 day')
        on conflict (code, week_start) do update set
          login_count = 4,
          first_used_at = now() - interval '8 days',
          last_used_at = now() - interval '1 day'
      `,
      [code, weekStart]
    );
    await client.query(
      `
        insert into access_orders (
          order_id, site_id, amount, currency, status, access_code, capture_id,
          payer_email, customer_email, payment_method, subtotal_amount, discount_amount,
          promo_code, email_status, completed_at, created_at, updated_at
        )
        values ($1, $2, 0::numeric, 'GBP', 'COMPLETED', $3, $4, $5, $5, 'feedback-test',
                0::numeric, 0::numeric, null, 'TEST', now() - interval '8 days',
                now() - interval '8 days', now())
      `,
      [orderId, siteId, code, `capture-${orderId}`, email]
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  return {
    code,
    email,
    orderId,
    siteId,
    siteName: sites.find((site) => site.id === siteId)?.name || siteId
  };
}

async function deleteFeedbackPopupTests() {
  const client = await pool.connect();
  const counts = {
    feedbackInvitations: 0,
    promptStates: 0,
    orders: 0,
    usageRows: 0,
    accessCodes: 0
  };
  try {
    await client.query("begin");
    const codeResult = await client.query(
      `
        select code
        from access_codes
        where source = 'feedback-test'
           or code like 'FBT-%'
      `
    );
    const codes = codeResult.rows.map((row) => row.code).filter(Boolean);
    if (codes.length) {
      const feedbackResult = await client.query(
        `delete from feedback_invitations where access_code = any($1::text[])`,
        [codes]
      );
      counts.feedbackInvitations = feedbackResult.rowCount || 0;

      const promptResult = await client.query(
        `delete from feedback_prompt_state where access_code = any($1::text[])`,
        [codes]
      );
      counts.promptStates = promptResult.rowCount || 0;

      const orderResult = await client.query(
        `delete from access_orders where access_code = any($1::text[]) or entitlement_access_code = any($1::text[]) or order_id like 'POPUP-TEST-%'`,
        [codes]
      );
      counts.orders = orderResult.rowCount || 0;

      const usageResult = await client.query(
        `delete from code_usage_weekly where code = any($1::text[])`,
        [codes]
      );
      counts.usageRows = usageResult.rowCount || 0;

      const accessResult = await client.query(
        `delete from access_codes where code = any($1::text[])`,
        [codes]
      );
      counts.accessCodes = accessResult.rowCount || 0;
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return counts;
}

async function ensureUsageSchemaForFeedbackTest() {
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
  await pool.query(`alter table code_usage_weekly add column if not exists first_used_at timestamptz`);
}

async function currentUtcWeekStart() {
  const result = await pool.query(`select date_trunc('week', now() at time zone 'UTC')::date as week_start`);
  return result.rows[0]?.week_start;
}

async function sendFeedbackInvitations(body = {}) {
  if (!(await isFeedbackEnabled())) {
    throw new AdminError("Feedback is turned off.", 409, "feedback_disabled");
  }
  if (!RESEND_API_KEY || !FEEDBACK_EMAIL_FROM) {
    throw new AdminError("Feedback email sending is not configured.", 500, "email_not_configured");
  }

  const rawEmails = Array.isArray(body.emails)
    ? body.emails
    : String(body.emails || "").split(/[\s,;]+/);
  const uniqueEmails = [...new Map(
    rawEmails
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .map((email) => [email.toLowerCase(), email])
  ).values()];

  if (!uniqueEmails.length) throw new AdminError("Select or enter at least one email address.", 400, "missing_recipients");
  if (uniqueEmails.length > 50) throw new AdminError("Send no more than 50 feedback requests at once.", 400, "too_many_recipients");
  const invalid = uniqueEmails.filter((email) => !isValidEmail(email));
  if (invalid.length) throw new AdminError(`Invalid email address: ${invalid[0]}`, 400, "invalid_email");

  const orderByEmail = new Map();
  if (await tableExists("access_orders")) {
    const keys = uniqueEmails.map((email) => email.toLowerCase());
    const result = await pool.query(
      `
        select distinct on (lower(trim(customer_email)))
               lower(trim(customer_email)) as email_key,
               order_id, site_id
        from access_orders
        where status = 'COMPLETED'
          and lower(trim(customer_email)) = any($1::text[])
        order by lower(trim(customer_email)), coalesce(completed_at, created_at) desc, order_id desc
      `,
      [keys]
    );
    for (const row of result.rows) orderByEmail.set(row.email_key, row);
  }

  const results = [];
  for (let index = 0; index < uniqueEmails.length; index += 4) {
    const batch = uniqueEmails.slice(index, index + 4);
    const batchResults = await Promise.all(batch.map(async (email) => {
      const order = orderByEmail.get(email.toLowerCase()) || {};
      try {
        return await sendOneFeedbackInvitation(email, order);
      } catch (error) {
        console.error("[admin-api] feedback invite failed:", error?.stack || error);
        return { email, status: "FAILED", error: String(error?.message || error).slice(0, 500) };
      }
    }));
    results.push(...batchResults);
  }

  return {
    requested: uniqueEmails.length,
    sent: results.filter((item) => item.status === "SENT").length,
    failed: results.filter((item) => item.status === "FAILED").length,
    results
  };
}

async function sendOneFeedbackInvitation(email, order = {}) {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const invitationResult = await pool.query(
    `
      insert into feedback_invitations (
        token_hash, recipient_email, order_id, site_id, status, expires_at, source
      )
      values ($1, $2, $3, $4, 'PENDING', now() + ($5 || ' days')::interval, 'EMAIL')
      returning id
    `,
    [tokenHash, email, order.order_id || null, order.site_id || null, String(FEEDBACK_INVITE_DAYS)]
  );
  const invitationId = number(invitationResult.rows[0]?.id);
  const site = getPublicSites().find((entry) => entry.id === order.site_id);
  const siteName = site?.name || "your laundry site";
  const feedbackUrl = `${PUBLIC_SITE_URL}/feedback.html?token=${encodeURIComponent(token)}`;
  const subject = "How was your CircuitWash experience?";
  const text = [
    "We would love your feedback.",
    `Tell us about your experience at ${siteName}. It takes about one minute.`,
    feedbackUrl,
    "If you need help instead, email support@circuitwash.com."
  ].join("\n\n");
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a;line-height:1.55">
      <div style="padding:28px;border:1px solid #dbeafe;border-radius:18px;background:#ffffff">
        <div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#0891b2">CircuitWash</div>
        <h1 style="margin:10px 0 8px;font-size:26px;line-height:1.2">How was your experience?</h1>
        <p style="margin:0 0 8px;color:#475569">We would love your feedback about <strong>${escapeHtml(siteName)}</strong>.</p>
        <p style="margin:0 0 22px;color:#475569">The form takes about one minute.</p>
        <a href="${escapeHtml(feedbackUrl)}" style="display:inline-block;padding:13px 20px;border-radius:11px;background:#0891b2;color:#ffffff;text-decoration:none;font-weight:700">Share feedback</a>
        <p style="margin:24px 0 0;font-size:12px;color:#64748b">This private link expires in ${FEEDBACK_INVITE_DAYS} days and can be submitted once.</p>
        <p style="margin:8px 0 0;font-size:12px;color:#64748b">Need support? Reply to this email or <a href="${escapeHtml(PUBLIC_SITE_URL)}/support.html?source=%2Femail">contact support online</a>.</p>
      </div>
    </div>`;

  let response;
  let responseBody = {};
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `feedback-${invitationId}-${crypto.randomUUID()}`
      },
      body: JSON.stringify({
        from: FEEDBACK_EMAIL_FROM,
        to: [email],
        reply_to: [SUPPORT_PUBLIC_EMAIL],
        subject,
        text,
        html
      })
    });
    responseBody = await response.json().catch(() => ({}));
  } catch (error) {
    await pool.query(
      `update feedback_invitations set status = 'FAILED', send_error = $2, updated_at = now() where id = $1`,
      [invitationId, String(error?.message || error).slice(0, 1000)]
    );
    throw error;
  }
  if (!response.ok || !responseBody.id) {
    const message = responseBody?.message || `Resend returned ${response.status}`;
    await pool.query(
      `update feedback_invitations set status = 'FAILED', send_error = $2, updated_at = now() where id = $1`,
      [invitationId, String(message).slice(0, 1000)]
    );
    throw new Error(message);
  }

  await pool.query(
    `
      update feedback_invitations
      set status = 'SENT', resend_email_id = $2, sent_at = now(), send_error = null, updated_at = now()
      where id = $1
    `,
    [invitationId, String(responseBody.id)]
  );
  return { email, invitationId, status: "SENT", emailId: String(responseBody.id) };
}

async function listSupportTickets(body = {}) {
  const limit = clampInt(body.limit, 1, 200, 100);
  const status = String(body.status || "UNRESOLVED").toUpperCase();
  const search = String(body.search || "").trim().toLowerCase().slice(0, 200);
  const params = [];
  const conditions = [];
  if (["NEW", "OPEN", "RESOLVED"].includes(status)) {
    params.push(status);
    conditions.push(`t.status = $${params.length}`);
  } else if (status === "UNRESOLVED") {
    conditions.push(`t.status <> 'RESOLVED'`);
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(
      lower(t.from_email) like $${params.length}
      or lower(coalesce(t.from_name, '')) like $${params.length}
      or cast(t.id as text) like $${params.length}
      or lower(coalesce(t.site_name, '')) like $${params.length}
      or lower(coalesce(t.linked_order_id, '')) like $${params.length}
      or lower(coalesce(t.linked_access_code, '')) like $${params.length}
    )`);
  }
  params.push(limit);
  const where = conditions.length ? `where ${conditions.join(" and ")}` : "";
  const { rows } = await pool.query(
    `
      select t.id, t.from_name, t.from_email, t.subject, t.body_text,
             t.status, t.source, t.site_name, t.linked_order_id, t.linked_access_code,
             t.is_read, t.received_at, t.last_activity_at,
             jsonb_array_length(coalesce(t.attachments, '[]'::jsonb))::int as attachment_count,
             count(r.id)::int as reply_count
      from support_tickets t
      left join support_replies r on r.ticket_id = t.id
      ${where}
      group by t.id
      order by t.last_activity_at desc
      limit $${params.length}
    `,
    params
  );
  return rows.map((row) => ({
    id: number(row.id),
    fromName: row.from_name || "",
    fromEmail: row.from_email,
    subject: row.subject,
    snippet: String(row.body_text || "").replace(/\s+/g, " ").slice(0, 180),
    status: row.status,
    source: row.source || "EMAIL",
    siteName: row.site_name || "",
    linkedOrderId: row.linked_order_id || "",
    hasAccessContext: Boolean(row.linked_access_code),
    isRead: Boolean(row.is_read),
    receivedAt: row.received_at,
    lastActivityAt: row.last_activity_at,
    attachmentCount: number(row.attachment_count),
    replyCount: number(row.reply_count)
  }));
}

async function getSupportTicket(body) {
  const ticketId = positiveId(body.ticketId);
  const result = await pool.query(`select * from support_tickets where id = $1 limit 1`, [ticketId]);
  const ticket = result.rows[0];
  if (!ticket) throw new AdminError("Support message not found.", 404, "ticket_not_found");
  await pool.query(`update support_tickets set is_read = true, updated_at = now() where id = $1`, [ticketId]);
  const repliesResult = await pool.query(
    `select id, direction, from_email, body_text, sent_at, resend_email_id from support_replies where ticket_id = $1 order by sent_at`,
    [ticketId]
  );
  const customerContext = await getSupportCustomerContext(ticket);
  return {
    ticket: {
      id: number(ticket.id),
      fromName: ticket.from_name || "",
      fromEmail: ticket.from_email,
      subject: ticket.subject,
      body: ticket.body_text,
      status: ticket.status,
      source: ticket.source || "EMAIL",
      sourceRoute: ticket.source_route || "",
      siteId: ticket.site_id || "",
      siteName: ticket.site_name || "",
      machineId: ticket.machine_id || "",
      contextMatch: ticket.context_match || "",
      sessionReference: ticket.session_hash ? String(ticket.session_hash).slice(0, 12) : "",
      userAgent: ticket.user_agent || "",
      receivedAt: ticket.received_at,
      attachments: Array.isArray(ticket.attachments) ? ticket.attachments : []
    },
    customerContext,
    replies: repliesResult.rows.map((reply) => ({
      id: number(reply.id),
      direction: reply.direction || "OUTBOUND",
      fromEmail: reply.from_email || "",
      body: reply.body_text,
      sentAt: reply.sent_at,
      resendEmailId: reply.resend_email_id || ""
    }))
  };
}

async function getSupportCustomerContext(ticket) {
  const email = String(ticket.from_email || "").trim().toLowerCase();
  const linkedOrderId = String(ticket.linked_order_id || "").trim();
  let accessCode = String(ticket.linked_access_code || "").trim();
  const siteMap = new Map(getPublicSites().map((site) => [site.id, site]));

  const orderResult = await pool.query(
    `
      select order_id, site_id, amount, currency, status,
             coalesce(access_code, entitlement_access_code) as access_code,
             order_type, quantity, payment_method, provider_reference,
             coalesce(completed_at, created_at) as purchased_at
      from access_orders
      where ($1 <> '' and lower(coalesce(nullif(customer_email, ''), payer_email, '')) = $1)
         or ($2 <> '' and order_id = $2)
         or ($3 <> '' and (access_code = $3 or entitlement_access_code = $3))
      order by coalesce(completed_at, created_at) desc
      limit 30
    `,
    [email, linkedOrderId, accessCode]
  );
  if (!accessCode) {
    accessCode = String(orderResult.rows.find((row) => row.order_id === linkedOrderId)?.access_code || "").trim();
  }

  let access = null;
  if (accessCode) {
    const accessResult = await pool.query(
      `
        select code, site_id, active, source, weekly_limit, max_total_uses,
               delete_after_use, expires_at, created_at
        from access_codes
        where code = $1 and deleted_at is null
        limit 1
      `,
      [accessCode]
    );
    access = accessResult.rows[0] || null;
  }

  let weeklyUsed = 0;
  let weeklyBonus = 0;
  let totalUsed = 0;
  let lastUsedAt = null;
  if (accessCode && await tableExists("code_usage_weekly")) {
    const usageResult = await pool.query(
      `
        select coalesce(sum(login_count), 0)::int as total_used,
               coalesce(max(last_used_at), max(first_used_at)) as last_used_at,
               coalesce(sum(login_count) filter (
                 where week_start = date_trunc('week', now() at time zone 'UTC')::date
               ), 0)::int as weekly_used
        from code_usage_weekly
        where code = $1
      `,
      [accessCode]
    );
    weeklyUsed = number(usageResult.rows[0]?.weekly_used);
    totalUsed = number(usageResult.rows[0]?.total_used);
    lastUsedAt = usageResult.rows[0]?.last_used_at || null;
  }
  if (accessCode && await tableExists("activation_upgrade_orders")) {
    const bonusResult = await pool.query(
      `
        select coalesce(sum(bonus_activations), 0)::int as weekly_bonus
        from activation_upgrade_orders
        where access_code = $1
          and status = 'COMPLETED'
          and week_start = date_trunc('week', now() at time zone 'UTC')::date
      `,
      [accessCode]
    );
    weeklyBonus = number(bonusResult.rows[0]?.weekly_bonus);
  }

  const revenue = new Map();
  orderResult.rows.filter((row) => row.status === "COMPLETED").forEach((row) => {
    const currency = String(row.currency || "GBP").toUpperCase();
    revenue.set(currency, (revenue.get(currency) || 0) + number(row.amount));
  });
  const orders = orderResult.rows.map((row) => ({
    orderId: row.order_id,
    siteId: row.site_id || "",
    siteName: siteMap.get(row.site_id)?.name || row.site_id || "Unknown site",
    amount: number(row.amount),
    currency: row.currency || "GBP",
    status: row.status,
    orderType: row.order_type || "access_code",
    quantity: Math.max(1, number(row.quantity) || 1),
    paymentMethod: row.payment_method || "unknown",
    providerReference: row.provider_reference || "",
    accessCodeMasked: maskAccessCode(row.access_code),
    purchasedAt: row.purchased_at
  }));
  const baseLimit = number(access?.weekly_limit);
  const weeklyLimit = baseLimit + weeklyBonus;
  const accessSiteId = String(access?.site_id || ticket.site_id || "").trim();

  return {
    matchedBy: ticket.context_match || (accessCode ? "ACCESS_CODE" : email ? "EMAIL" : ""),
    linkedOrderId,
    access: accessCode ? {
      code: accessCode,
      maskedCode: maskAccessCode(accessCode),
      exists: Boolean(access),
      active: Boolean(access?.active),
      source: access?.source || "",
      siteId: accessSiteId,
      siteName: siteMap.get(accessSiteId)?.name || ticket.site_name || accessSiteId,
      weeklyBaseLimit: baseLimit,
      weeklyBonus,
      weeklyLimit,
      weeklyUsed,
      weeklyRemaining: Math.max(0, weeklyLimit - weeklyUsed),
      totalUsed,
      lastUsedAt,
      expiresAt: access?.expires_at || null,
      createdAt: access?.created_at || null,
      oneTime: Boolean(access?.delete_after_use) || number(access?.max_total_uses) === 1
    } : null,
    orders,
    summary: {
      totalOrders: orders.length,
      completedOrders: orders.filter((order) => order.status === "COMPLETED").length,
      revenue: [...revenue.entries()].map(([currency, amount]) => ({ currency, amount }))
    }
  };
}

function maskAccessCode(value) {
  const code = String(value || "").trim();
  if (!code) return "";
  if (code.length <= 4) return "•".repeat(code.length);
  return `${"•".repeat(Math.min(6, code.length - 4))}${code.slice(-4)}`;
}

async function replyToSupportTicket(body) {
  if (!RESEND_API_KEY || !SUPPORT_EMAIL_FROM) {
    throw new AdminError("Support email sending is not configured.", 500, "email_not_configured");
  }

  const ticketId = positiveId(body.ticketId);
  const replyBody = String(body.message || "").trim();
  if (!replyBody || replyBody.length > 20000) {
    throw new AdminError("Enter a reply under 20,000 characters.", 400, "invalid_reply");
  }

  const result = await pool.query(`select * from support_tickets where id = $1 limit 1`, [ticketId]);
  const ticket = result.rows[0];
  if (!ticket) throw new AdminError("Support message not found.", 404, "ticket_not_found");

  const cleanSubject = stripTicketToken(ticket.subject).replace(/^re:\s*/i, "").trim() || "Support request";
  const subject = `Re: [CW-${ticketId}] ${cleanSubject}`;

  const threadResult = await pool.query(
    `select message_id from support_replies where ticket_id = $1 and message_id is not null order by sent_at, id`,
    [ticketId]
  );

  const threadMessageIds = threadResult.rows.map((row) => String(row.message_id || "").trim()).filter(Boolean);
  const parentMessageId = threadMessageIds.at(-1) || ticket.message_id || "";
  const references = [...new Set([
    ...extractMessageIdsForHeader(ticket.references_header),
    ticket.message_id,
    ...threadMessageIds
  ].filter(Boolean))].join(" ");

  const headers = {};
  if (parentMessageId) headers["In-Reply-To"] = parentMessageId;
  if (references) headers.References = references;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `support-${ticketId}-${crypto.randomUUID()}`
    },
    body: JSON.stringify({
      from: SUPPORT_EMAIL_FROM,
      to: [ticket.from_email],
      reply_to: [SUPPORT_PUBLIC_EMAIL],
      subject,
      text: replyBody,
      html: buildSupportReplyEmail({
        message: replyBody,
        ticketId
      }),
      headers
    })
  });

  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok || !responseBody.id) {
    throw new AdminError(responseBody?.message || "The reply could not be sent.", 502, "email_failed");
  }

  const sentEmailId = String(responseBody.id);
  const sentMessageId = await retrieveSentMessageId(sentEmailId);

  await pool.query(
    `
      insert into support_replies (
        ticket_id, direction, from_email, resend_email_id, message_id, message_id_normalized, body_text, sent_at
      )
      values ($1, 'OUTBOUND', $2, $3, $4, $5, $6, now())
    `,
    [ticketId, SUPPORT_PUBLIC_EMAIL, sentEmailId, sentMessageId || null, normalizeMessageId(sentMessageId) || null, replyBody]
  );

  await pool.query(
    `update support_tickets set status = 'OPEN', is_read = true, last_activity_at = now(), updated_at = now() where id = $1`,
    [ticketId]
  );

  return { ticketId, emailId: sentEmailId, status: "OPEN" };
}

function buildSupportReplyEmail({ message, ticketId }) {
  return `
    <div style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a">
      <div style="max-width:580px;margin:0 auto;padding:24px 16px">
        <div style="padding:24px;border:1px solid #dbeafe;border-radius:16px;background:#ffffff">
          <div style="font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#0891b2">
            CircuitWash Support
          </div>

          <div style="margin-top:18px;font-size:15px;line-height:1.65;color:#0f172a">
            ${escapeHtml(message)}
          </div>

          <div style="margin-top:24px;padding-top:14px;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;line-height:1.5">
            <div>Reply to this email if you still need help.</div>
            <div style="margin-top:6px">Ticket CW-${escapeHtml(ticketId)}</div>
          </div>
        </div>
      </div>
    </div>`;
}

async function retrieveSentMessageId(emailId) {
  const delays = [0, 250, 600, 1200];
  for (const delay of delays) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(emailId)}`, {
        headers: { Authorization: `Bearer ${RESEND_API_KEY}` }
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok && body.message_id) return String(body.message_id);
    } catch (_) {}
  }
  return "";
}

async function setSupportStatus(body) {
  const ticketId = positiveId(body.ticketId);
  const status = String(body.status || "").toUpperCase();
  if (!["NEW", "OPEN", "RESOLVED"].includes(status)) throw new AdminError("Invalid status.", 400, "invalid_status");
  const result = await pool.query(
    `update support_tickets set status = $2, updated_at = now() where id = $1 returning id, status`,
    [ticketId, status]
  );
  if (!result.rows[0]) throw new AdminError("Support message not found.", 404, "ticket_not_found");
  return { ticketId, status };
}

function mapCode(row, site) {
  const weeklyLimit = clampInt(row.weekly_limit, 1, 100, 5);
  const weeklyUses = number(row.weekly_uses);
  return {
    code: row.code,
    siteId: row.site_id,
    siteName: site?.name || row.site_id,
    active: Boolean(row.active),
    source: row.source || "",
    createdAt: row.created_at || null,
    expiresAt: row.expires_at || null,
    uses: number(row.uses),
    weeklyUses,
    weeklyLimit,
    maxTotalUses: row.max_total_uses ? number(row.max_total_uses) : null,
    deleteAfterUse: Boolean(row.delete_after_use),
    weeklyRemaining: Math.max(0, weeklyLimit - weeklyUses),
    lastUsedAt: row.last_used_at || null,
    deletedAt: row.deleted_at || null
  };
}

function mapPromo(row) {
  const site = row.site_id ? getPublicSites().find((entry) => entry.id === row.site_id) : null;
  return {
    code: row.code,
    discountType: row.discount_type,
    discountValue: number(row.discount_value),
    active: Boolean(row.active),
    siteId: row.site_id || "",
    siteName: site?.name || row.site_id || "",
    allowFree: Boolean(row.allow_free),
    maxRedemptions: row.max_redemptions ? number(row.max_redemptions) : null,
    accessMaxTotalUses: row.access_max_total_uses ? number(row.access_max_total_uses) : null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    createdOrders: number(row.created_orders),
    successfulOrders: number(row.successful_orders),
    customers: number(row.customers),
    grossRevenue: number(row.gross_revenue),
    discountTotal: number(row.discount_total),
    netRevenue: number(row.net_revenue),
    lastUsedAt: row.last_used_at || null
  };
}

function normalizePromoCode(value) {
  const code = String(value || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{3,32}$/.test(code)) {
    throw new AdminError("Promo codes must be 3-32 uppercase letters and numbers.", 400, "invalid_promo_code");
  }
  return code;
}

function normalizePromoDiscount(body = {}) {
  const discountType = String(body.discountType || "").trim().toLowerCase();
  if (!["percent", "amount"].includes(discountType)) {
    throw new AdminError("Choose percent or amount discount.", 400, "invalid_discount_type");
  }

  const discountValue = Number(body.discountValue);
  if (!Number.isFinite(discountValue) || discountValue <= 0) {
    throw new AdminError("Enter a discount greater than zero.", 400, "invalid_discount_value");
  }
  if (discountType === "percent" && discountValue > 100) {
    throw new AdminError("Percent discounts must be 100 or less.", 400, "invalid_discount_value");
  }

  return { discountType, discountValue };
}

function normalizePromoSiteId(value) {
  const siteId = String(value || "").trim();
  if (!siteId) return "";
  if (!getPublicSites().some((entry) => entry.id === siteId)) {
    throw new AdminError("Select a valid promo site.", 400, "invalid_site");
  }
  return siteId;
}

function normalizeOptionalInt(value, min, max) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new AdminError(`Enter a whole number between ${min} and ${max}.`, 400, "invalid_number");
  }
  return parsed;
}

function extractMessageIdsForHeader(value) {
  const text = String(value || "");
  const angleIds = [...text.matchAll(/<([^<>]+)>/g)].map((match) => `<${match[1]}>`);
  if (angleIds.length) return angleIds;
  return text.split(/\s+/).map((item) => item.trim()).filter(Boolean);
}

function normalizeMessageId(value) {
  return String(value || "").trim().replace(/[<>\s]/g, "").toLowerCase();
}

function stripTicketToken(subject) {
  return String(subject || "").replace(/\s*\[LS-\d+\]\s*/ig, " ").replace(/\s{2,}/g, " ").trim();
}

function isValidEmail(value) {
  const email = String(value || "").trim();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function recommendationForRating(value) {
  if (value >= 4) return "YES";
  if (value === 3) return "MAYBE";
  return "NO";
}

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function shortReferrer(value) {
  const referrer = String(value || "").trim();
  if (!referrer) return "Direct";
  try {
    const url = new URL(referrer);
    return url.hostname.replace(/^www\./, "") || "Direct";
  } catch (_) {
    return referrer.slice(0, 80) || "Direct";
  }
}

function isAdminCode(value) {
  const left = Buffer.from(String(value || "").trim());
  const right = Buffer.from(ADMIN_ACCESS_CODE);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function tableExists(name, db = pool) {
  const result = await db.query(`select to_regclass($1) as table_name`, [`public.${name}`]);
  return Boolean(result.rows[0]?.table_name);
}

async function columnExists(tableName, columnName, db = pool) {
  const result = await db.query(
    `
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = $1
        and column_name = $2
      limit 1
    `,
    [tableName, columnName]
  );
  return Boolean(result.rows[0]);
}

function uniqueText(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function generateCode(length) {
  const bytes = crypto.randomBytes(length);
  let output = "";
  for (const byte of bytes) output += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return output;
}

function positiveId(value) {
  const id = Number.parseInt(String(value), 10);
  if (!Number.isInteger(id) || id <= 0) throw new AdminError("Invalid ID.", 400, "invalid_id");
  return id;
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
    .replace(/\n/g, "<br>");
}

function json(value, statusCode = 200) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    body: JSON.stringify(value)
  };
}
