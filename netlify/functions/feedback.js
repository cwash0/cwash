const crypto = require("crypto");
const { Pool } = require("pg");
const { getSiteById } = require("./_site-data");
const { ensureOrderStorage } = require("./_order-storage");

const pool = new Pool({
  connectionString: process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const PROMPT_EXPIRY_DAYS = Math.max(1, Math.min(90, Number(process.env.FEEDBACK_INVITE_DAYS || 30)));
const PROMPT_DISMISS_COOLDOWN_DAYS = Math.max(1, Math.min(180, Number(process.env.FEEDBACK_DISMISS_DAYS || 30)));
const PROMPT_REPEAT_COOLDOWN_HOURS = Math.max(1, Math.min(168, Number(process.env.FEEDBACK_PROMPT_REPEAT_HOURS || 24)));
const PROMPT_MAX_DISMISSALS = 2;
let schemaReady = false;

class PublicError extends Error {
  constructor(message, statusCode = 400, code = "bad_request") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

exports.handler = async (event) => {
  try {
    await ensureSchema();

    if (event.httpMethod === "GET") {
      const token = String(event.queryStringParameters?.token || "").trim();
      const invitation = await getInvitation(token);
      return json({
        ok: true,
        site: invitation.site,
        emailHint: maskEmail(invitation.recipient_email),
        expiresAt: invitation.expires_at,
        source: invitation.source || "EMAIL"
      });
    }

    if (event.httpMethod === "POST") {
      let body;
      try {
        body = event.body ? JSON.parse(event.body) : {};
      } catch (_) {
        throw new PublicError("Invalid request.", 400, "bad_request");
      }

      const action = String(body.action || "submit").trim().toLowerCase();
      if (action === "prepare_prompt") {
        if (!(await isFeedbackEnabled())) {
          return json({ ok: true, eligible: false, reason: "disabled" });
        }
        return json({ ok: true, ...(await prepareFeedbackPrompt(body)) });
      }
      if (action === "dismiss_prompt") {
        return json({ ok: true, ...(await dismissFeedbackPrompt(body)) });
      }
      if (action === "update_rating") {
        return json({ ok: true, ...(await updateFeedbackRating(body)) });
      }
      if (action === "update_comment") {
        return json({ ok: true, ...(await updateFeedbackComment(body)) });
      }

      const result = await submitFeedback(body);
      return json({ ok: true, ...result });
    }

    return json({ ok: false, error: "method_not_allowed" }, 405);
  } catch (error) {
    if (error instanceof PublicError) {
      return json({ ok: false, error: error.code, message: error.message }, error.statusCode);
    }
    console.error("[feedback] fatal:", error?.stack || error);
    return json({ ok: false, error: "server_error", message: "Feedback is unavailable right now." }, 500);
  }
};

async function ensureSchema() {
  if (schemaReady) return;

  await ensureOrderStorage(pool);

  await pool.query(`
    create table if not exists app_settings (
      key text primary key,
      value jsonb not null,
      updated_at timestamptz not null default now()
    )
  `);

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
  await pool.query(`create index if not exists feedback_invitations_code_idx on feedback_invitations(access_code, created_at desc)`);
  await pool.query(`create index if not exists feedback_responses_submitted_idx on feedback_responses(submitted_at desc)`);
  await pool.query(`create index if not exists feedback_prompt_state_email_idx on feedback_prompt_state(lower(customer_email), updated_at desc)`);
  if (await tableExists("code_usage_weekly")) {
    await pool.query(`alter table code_usage_weekly add column if not exists first_used_at timestamptz`);
  }
  schemaReady = true;
}

async function isFeedbackEnabled() {
  const result = await pool.query(`select value from app_settings where key = 'feedback_enabled' limit 1`);
  if (!result.rows.length) return true;
  const value = result.rows[0].value;
  if (typeof value === "boolean") return value;
  return value?.enabled !== false;
}

async function prepareFeedbackPrompt(body) {
  const code = validateAccessCode(body.code);
  const context = await getAccessCodeContext(code);
  const order = await getOrderForCode(code);
  const siteId = String(order?.site_id || context.site_id || "").trim();
  const customerEmail = String(order?.customer_email || "").trim();
  const state = await getPromptState({ code, customerEmail });

  if (state?.responded_at) return { eligible: false, reason: "responded" };
  if (Number(state?.dismiss_count || 0) >= PROMPT_MAX_DISMISSALS) return { eligible: false, reason: "dismissed" };
  if (state?.dismissed_at && !isDismissCooldownOver(state.dismissed_at)) {
    return { eligible: false, reason: "dismissed" };
  }
  if (state?.prompted_at && !isPromptRepeatCooldownOver(state.prompted_at)) {
    return { eligible: false, reason: "prompted" };
  }

  const activationStats = await getActivationStats(code);
  if (activationStats.activationCount < 4) {
    return { eligible: false, reason: "not_enough_activations", ...activationStats };
  }
  if (!isAtLeastOneWeekOld(activationStats.firstActivatedAt)) {
    return { eligible: false, reason: "too_recent", ...activationStats };
  }
  const orderId = String(order?.order_id || "").trim();

  if (await hasExistingResponse({ code, orderId, customerEmail, siteId })) {
    await markPromptStateResponded(code, pool, { customerEmail, siteId });
    return { eligible: false, reason: "responded", ...activationStats };
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const result = await pool.query(
    `
      insert into feedback_invitations (
        token_hash, recipient_email, order_id, site_id, status,
        sent_at, expires_at, access_code, source, created_at, updated_at
      )
      values ($1, $2, $3, $4, 'SENT', now(), now() + ($5 || ' days')::interval, $6, 'POPUP', now(), now())
      returning id
    `,
    [tokenHash, customerEmail, orderId || null, siteId || null, String(PROMPT_EXPIRY_DAYS), code]
  );
  const invitationId = Number(result.rows[0]?.id || 0);

  await pool.query(
    `
      insert into feedback_prompt_state (access_code, invitation_id, customer_email, site_id, prompted_at, updated_at)
      values ($1, $2, nullif($3, ''), nullif($4, ''), now(), now())
      on conflict (access_code) do update set
        invitation_id = excluded.invitation_id,
        customer_email = coalesce(excluded.customer_email, feedback_prompt_state.customer_email),
        site_id = coalesce(excluded.site_id, feedback_prompt_state.site_id),
        prompted_at = now(),
        dismissed_at = null,
        updated_at = now()
      where feedback_prompt_state.responded_at is null
        and (
          feedback_prompt_state.dismissed_at is null
          or (
            feedback_prompt_state.dismiss_count < ${PROMPT_MAX_DISMISSALS}
            and feedback_prompt_state.dismissed_at <= now() - (${String(PROMPT_DISMISS_COOLDOWN_DAYS)} || ' days')::interval
          )
        )
    `,
    [code, invitationId, customerEmail, siteId]
  );

  return {
    eligible: true,
    ...activationStats,
    url: `/feedback.html?token=${encodeURIComponent(token)}`
  };
}

async function dismissFeedbackPrompt(body) {
  const code = validateAccessCode(body.code);
  const context = await getAccessCodeContext(code);
  const order = await getOrderForCode(code);
  const invitation = await getLatestPopupInvitationForCode(code);
  const customerEmail = String(order?.customer_email || invitation?.recipient_email || "").trim();
  const siteId = String(order?.site_id || invitation?.site_id || context.site_id || "").trim();
  const invitationId = Number(invitation?.id || 0) || null;
  await pool.query(
    `
      insert into feedback_prompt_state (access_code, invitation_id, customer_email, site_id, dismissed_at, dismiss_count, updated_at)
      values ($1, $2, nullif($3, ''), nullif($4, ''), now(), 1, now())
      on conflict (access_code) do update set
        invitation_id = coalesce(feedback_prompt_state.invitation_id, excluded.invitation_id),
        customer_email = coalesce(excluded.customer_email, feedback_prompt_state.customer_email),
        site_id = coalesce(excluded.site_id, feedback_prompt_state.site_id),
        dismissed_at = now(),
        dismiss_count = least(${PROMPT_MAX_DISMISSALS}, coalesce(feedback_prompt_state.dismiss_count, 0) + 1),
        updated_at = now()
    `,
    [code, invitationId, customerEmail, siteId]
  );
  return { dismissed: true };
}

async function getAccessCodeContext(code) {
  let result;
  try {
    result = await pool.query(
      `select code, site_id, active, expires_at from access_codes where code = $1 limit 1`,
      [code]
    );
  } catch (error) {
    if (error?.code === "42P01") throw new PublicError("Feedback is unavailable for this code.", 503, "feedback_unavailable");
    throw error;
  }

  const row = result.rows[0];
  if (!row || row.active !== true) throw new PublicError("This access code is not available.", 404, "unknown_code");
  if (row.expires_at) {
    const expiry = new Date(row.expires_at);
    if (!Number.isNaN(expiry.getTime()) && expiry.getTime() <= Date.now()) {
      throw new PublicError("This access code has expired.", 410, "expired_code");
    }
  }
  return row;
}

async function getActivationStats(code) {
  try {
    const result = await pool.query(
      `
        select
          coalesce(sum(login_count), 0)::int as activation_count,
          min(coalesce(first_used_at, last_used_at, week_start::timestamptz)) as first_activated_at
        from code_usage_weekly
        where code = $1
      `,
      [code]
    );
    return {
      activationCount: Number(result.rows[0]?.activation_count || 0),
      firstActivatedAt: result.rows[0]?.first_activated_at || null
    };
  } catch (error) {
    if (error?.code === "42P01") return { activationCount: 0, firstActivatedAt: null };
    throw error;
  }
}

function isAtLeastOneWeekOld(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() <= Date.now() - 7 * 24 * 60 * 60 * 1000;
}

function isDismissCooldownOver(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() <= Date.now() - PROMPT_DISMISS_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
}

function isPromptRepeatCooldownOver(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() <= Date.now() - PROMPT_REPEAT_COOLDOWN_HOURS * 60 * 60 * 1000;
}

async function getOrderForCode(code) {
  if (!(await tableExists("access_orders"))) return null;
  const result = await pool.query(
    `
      select order_id, site_id, customer_email
      from access_orders
      where status = 'COMPLETED' and access_code = $1
      order by coalesce(completed_at, created_at) desc, order_id desc
      limit 1
    `,
    [code]
  );
  return result.rows[0] || null;
}

async function getLatestPopupInvitationForCode(code, client = pool) {
  const result = await client.query(
    `
      select id, recipient_email, site_id
      from feedback_invitations
      where access_code = $1 and source = 'POPUP'
      order by created_at desc, id desc
      limit 1
    `,
    [code]
  );
  return result.rows[0] || null;
}

async function hasExistingResponse({ code, orderId, customerEmail, siteId }) {
  const result = await pool.query(
    `
      select 1
      from feedback_responses r
      join feedback_invitations i on i.id = r.invitation_id
      where i.access_code = $1
         or ($2 <> '' and i.order_id = $2)
         or ($3 <> '' and lower(i.recipient_email) = lower($3) and coalesce(i.site_id, '') = $4)
      limit 1
    `,
    [code, orderId, customerEmail, siteId]
  );
  return Boolean(result.rows[0]);
}

async function getPromptState({ code, customerEmail }) {
  const result = await pool.query(
    `
      select s.prompted_at, s.dismissed_at, s.responded_at, coalesce(s.dismiss_count, 0)::int as dismiss_count
      from feedback_prompt_state s
      left join feedback_invitations i on i.id = s.invitation_id
      where s.access_code = $1
         or (
           $2 <> ''
           and (
             lower(coalesce(s.customer_email, '')) = lower($2)
             or lower(coalesce(i.recipient_email, '')) = lower($2)
           )
         )
      order by
        case
          when s.responded_at is not null then 0
          when s.dismissed_at is not null then 1
          when s.prompted_at is not null then 2
          else 3
        end,
        coalesce(s.responded_at, s.dismissed_at, s.prompted_at, s.updated_at) desc
      limit 1
    `,
    [code, String(customerEmail || "").trim()]
  );
  return result.rows[0] || null;
}

async function markPromptStateResponded(code, client = pool, meta = {}) {
  if (!code) return;
  const customerEmail = String(meta.customerEmail || "").trim();
  const siteId = String(meta.siteId || "").trim();
  const invitationId = Number(meta.invitationId || 0) || null;
  await client.query(
    `
      insert into feedback_prompt_state (access_code, invitation_id, customer_email, site_id, responded_at, updated_at)
      values ($1, $2, nullif($3, ''), nullif($4, ''), now(), now())
      on conflict (access_code) do update set
        invitation_id = coalesce(feedback_prompt_state.invitation_id, excluded.invitation_id),
        customer_email = coalesce(excluded.customer_email, feedback_prompt_state.customer_email),
        site_id = coalesce(excluded.site_id, feedback_prompt_state.site_id),
        responded_at = coalesce(feedback_prompt_state.responded_at, now()),
        updated_at = now()
    `,
    [code, invitationId, customerEmail, siteId]
  );
}

async function getInvitation(token) {
  validateToken(token);
  const tokenHash = hashToken(token);
  const result = await pool.query(
    `
      select i.*, r.id as response_id
      from feedback_invitations i
      left join feedback_responses r on r.invitation_id = i.id
      where i.token_hash = $1
      limit 1
    `,
    [tokenHash]
  );
  const invitation = result.rows[0];
  validateInvitation(invitation);
  const site = getSiteById(invitation.site_id);
  return {
    ...invitation,
    site: {
      id: invitation.site_id || "",
      name: site?.name || "CircuitWash",
      address: site?.address || ""
    }
  };
}

async function submitFeedback(body) {
  const token = String(body.token || "").trim();
  validateToken(token);
  const rating = Number.parseInt(String(body.rating || ""), 10);
  const recommend = String(body.recommend || "").trim().toUpperCase();
  const comments = String(body.comments || "").trim();

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new PublicError("Choose a rating from 1 to 5 stars.", 400, "invalid_rating");
  }
  if (!["YES", "MAYBE", "NO"].includes(recommend)) {
    throw new PublicError("Tell us whether you would recommend CircuitWash.", 400, "invalid_recommendation");
  }
  if (comments.length > 4000) {
    throw new PublicError("Keep your comments under 4,000 characters.", 400, "comments_too_long");
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query(
      `select * from feedback_invitations where token_hash = $1 limit 1 for update`,
      [hashToken(token)]
    );
    const invitation = result.rows[0];
    validateInvitation(invitation);

    const inserted = await client.query(
      `
        insert into feedback_responses (invitation_id, rating, recommend, comments, submitted_at)
        values ($1, $2, $3, $4, now())
        returning id, submitted_at
      `,
      [invitation.id, rating, recommend, comments]
    );
    await client.query(
      `
        update feedback_invitations
        set status = 'RESPONDED', responded_at = now(), updated_at = now()
        where id = $1
      `,
      [invitation.id]
    );

    let accessCode = String(invitation.access_code || "").trim();
    if (!accessCode && invitation.order_id) {
      const tableResult = await client.query(`select to_regclass('public.access_orders') as table_name`);
      if (tableResult.rows[0]?.table_name) {
        const orderResult = await client.query(
          `select access_code from access_orders where order_id = $1 limit 1`,
          [invitation.order_id]
        );
        accessCode = String(orderResult.rows[0]?.access_code || "").trim();
      }
    }
    if (accessCode) {
      await markPromptStateResponded(accessCode, client, {
        invitationId: invitation.id,
        customerEmail: invitation.recipient_email,
        siteId: invitation.site_id
      });
    }

    await client.query("commit");
    return {
      responseId: Number(inserted.rows[0]?.id || 0),
      submittedAt: inserted.rows[0]?.submitted_at || new Date().toISOString()
    };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    if (error?.code === "23505") {
      throw new PublicError("This feedback form has already been submitted.", 409, "already_submitted");
    }
    throw error;
  } finally {
    client.release();
  }
}

async function updateFeedbackComment(body) {
  const token = String(body.token || "").trim();
  validateToken(token);
  const comments = String(body.comments || "").trim();
  if (comments.length > 4000) {
    throw new PublicError("Keep your comments under 4,000 characters.", 400, "comments_too_long");
  }

  const result = await pool.query(
    `
      select r.id as response_id
      from feedback_invitations i
      left join feedback_responses r on r.invitation_id = i.id
      where i.token_hash = $1
      limit 1
    `,
    [hashToken(token)]
  );
  const responseId = Number(result.rows[0]?.response_id || 0);
  if (!result.rows[0]) {
    throw new PublicError("This feedback link is invalid.", 404, "invalid_link");
  }
  if (!responseId) {
    throw new PublicError("Choose a star rating first.", 409, "rating_required");
  }

  await pool.query(
    `update feedback_responses set comments = $2 where id = $1`,
    [responseId, comments]
  );
  return { updated: true };
}

async function updateFeedbackRating(body) {
  const token = String(body.token || "").trim();
  validateToken(token);
  const rating = Number.parseInt(String(body.rating || ""), 10);
  const recommend = String(body.recommend || "").trim().toUpperCase();

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new PublicError("Choose a rating from 1 to 5 stars.", 400, "invalid_rating");
  }
  if (!["YES", "MAYBE", "NO"].includes(recommend)) {
    throw new PublicError("Tell us whether you would recommend CircuitWash.", 400, "invalid_recommendation");
  }

  const result = await pool.query(
    `
      select r.id as response_id
      from feedback_invitations i
      left join feedback_responses r on r.invitation_id = i.id
      where i.token_hash = $1
      limit 1
    `,
    [hashToken(token)]
  );
  const responseId = Number(result.rows[0]?.response_id || 0);
  if (!result.rows[0]) {
    throw new PublicError("This feedback link is invalid.", 404, "invalid_link");
  }
  if (!responseId) {
    throw new PublicError("Choose a star rating first.", 409, "rating_required");
  }

  await pool.query(
    `update feedback_responses set rating = $2, recommend = $3 where id = $1`,
    [responseId, rating, recommend]
  );
  return { updated: true };
}

function validateInvitation(invitation) {
  if (!invitation) {
    throw new PublicError("This feedback link is invalid.", 404, "invalid_link");
  }
  if (invitation.response_id || invitation.responded_at || invitation.status === "RESPONDED") {
    throw new PublicError("This feedback form has already been submitted. Thank you.", 409, "already_submitted");
  }
  if (invitation.status !== "SENT") {
    throw new PublicError("This feedback link is not available.", 410, "link_unavailable");
  }
  const expiresAt = new Date(invitation.expires_at);
  if (!Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() <= Date.now()) {
    throw new PublicError("This feedback link has expired.", 410, "link_expired");
  }
}

function validateAccessCode(value) {
  const code = String(value || "").trim();
  if (!code || code.length > 64) throw new PublicError("Invalid access code.", 400, "invalid_code");
  return code;
}

function validateToken(token) {
  if (!token || token.length < 30 || token.length > 200 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    throw new PublicError("This feedback link is invalid.", 404, "invalid_link");
  }
}

async function tableExists(name) {
  const result = await pool.query(`select to_regclass($1) as table_name`, [`public.${name}`]);
  return Boolean(result.rows[0]?.table_name);
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function maskEmail(value) {
  const email = String(value || "").trim();
  const [local, domain] = email.split("@");
  if (!local || !domain) return "";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"•".repeat(Math.max(2, Math.min(6, local.length - visible.length)))}@${domain}`;
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
