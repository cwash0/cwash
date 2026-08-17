const crypto = require("crypto");
const { getPublicSites } = require("./_site-data");

const BLOCK_TYPES = new Set(["heading", "paragraph", "image", "button", "link", "divider", "spacer", "list", "callout", "footer"]);
const VARIABLE_KEYS = new Set(["email", "site_name", "order_id", "company_name", "support_email", "unsubscribe_url"]);
const CAMPAIGN_STATUSES = new Set(["DRAFT", "SCHEDULED", "SENDING", "SENT", "FAILED", "CANCELLED"]);
const MAX_IMMEDIATE_RECIPIENTS = 100;
const MAX_SCHEDULED_RECIPIENTS = 25;
const BRAND_CYAN = "#24d7f0";
const DEFAULT_THEME = Object.freeze({ preset: "circuit", primary: BRAND_CYAN, accent: "#102a3d", page: "#050b14", card: "#0b1726", heading: "#f4f8ff", body: "#91a3ba" });

const STARTER_TEMPLATES = [
  {
    id: "starter-announcement",
    name: "Announcement",
    subject: "An update from CircuitWash",
    preheader: "Important news from CircuitWash.",
    blocks: [
      { id: "heading-1", type: "heading", text: "An update from CircuitWash", level: 1 },
      { id: "paragraph-1", type: "paragraph", text: "Hello {{email}},\n\nWe have an important update to share with you." },
      { id: "button-1", type: "button", text: "Learn more", url: "https://circuitwash.com" }
    ]
  },
  {
    id: "starter-service",
    name: "Service notice",
    subject: "Service notice for {{site_name}}",
    preheader: "Information about your CircuitWash service.",
    blocks: [
      { id: "heading-1", type: "heading", text: "Service notice", level: 1 },
      { id: "callout-1", type: "callout", title: "What you need to know", text: "Add the key timing or service information here." },
      { id: "paragraph-1", type: "paragraph", text: "This update relates to {{site_name}}. If you need help, contact {{support_email}}." }
    ]
  },
  {
    id: "starter-welcome",
    name: "Welcome",
    subject: "Welcome to CircuitWash",
    preheader: "Everything you need to get started.",
    blocks: [
      { id: "heading-1", type: "heading", text: "Welcome to CircuitWash", level: 1 },
      { id: "paragraph-1", type: "paragraph", text: "Hello,\n\nWelcome to CircuitWash. Your laundry site is {{site_name}}." },
      { id: "list-1", type: "list", items: ["Buy an access code online", "Activate a machine", "Contact support when you need help"] },
      { id: "button-1", type: "button", text: "Open CircuitWash", url: "https://circuitwash.com" }
    ]
  }
];

async function ensureCustomEmailSchema(pool) {
  await pool.query(`
    create table if not exists custom_email_templates (
      id bigserial primary key,
      name text not null,
      subject text not null default '',
      preheader text not null default '',
      blocks jsonb not null default '[]'::jsonb,
      include_unsubscribe boolean not null default true,
      status text not null default 'ACTIVE',
      created_by text not null default 'Administrator',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await pool.query(`
    create table if not exists custom_email_campaigns (
      id bigserial primary key,
      name text not null,
      subject text not null default '',
      preheader text not null default '',
      blocks jsonb not null default '[]'::jsonb,
      include_unsubscribe boolean not null default true,
      status text not null default 'DRAFT',
      recipient_mode text not null default 'SELECTED',
      recipient_filter jsonb not null default '{}'::jsonb,
      recipient_snapshot jsonb not null default '[]'::jsonb,
      recipient_count integer not null default 0,
      sent_count integer not null default 0,
      failed_count integer not null default 0,
      scheduled_for timestamptz,
      sent_at timestamptz,
      idempotency_token text not null default md5(random()::text || clock_timestamp()::text),
      created_by text not null default 'Administrator',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await pool.query(`alter table custom_email_templates add column if not exists include_unsubscribe boolean not null default true`);
  await pool.query(`alter table custom_email_campaigns add column if not exists include_unsubscribe boolean not null default true`);
  await pool.query(`alter table custom_email_templates add column if not exists theme jsonb not null default '{}'::jsonb`);
  await pool.query(`alter table custom_email_campaigns add column if not exists theme jsonb not null default '{}'::jsonb`);
  await pool.query(`
    create table if not exists custom_email_deliveries (
      id bigserial primary key,
      campaign_id bigint not null references custom_email_campaigns(id) on delete cascade,
      recipient_email text not null,
      status text not null default 'PENDING',
      resend_email_id text,
      send_error text,
      scheduled_for timestamptz,
      sent_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (campaign_id, recipient_email)
    )
  `);
  await pool.query(`
    create table if not exists customer_email_suppressions (
      email text primary key,
      reason text not null default 'Customer unsubscribed',
      source text not null default 'UNSUBSCRIBE',
      created_at timestamptz not null default now()
    )
  `);
  await pool.query(`
    create table if not exists custom_email_contacts (
      email text primary key,
      created_by text not null default 'Administrator',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await pool.query(`create index if not exists custom_email_campaigns_status_idx on custom_email_campaigns(status, created_at desc)`);
  await pool.query(`create index if not exists custom_email_deliveries_campaign_idx on custom_email_deliveries(campaign_id, created_at desc)`);
  await pool.query(`create index if not exists custom_email_templates_status_idx on custom_email_templates(status, updated_at desc)`);
  await pool.query(`create index if not exists custom_email_contacts_created_idx on custom_email_contacts(created_at desc)`);
}

async function getEmailData(pool) {
  const [templatesResult, campaignsResult, customers, suppressionsResult, contactsResult] = await Promise.all([
    pool.query(`select * from custom_email_templates where status <> 'DELETED' order by updated_at desc limit 100`),
    pool.query(`select * from custom_email_campaigns order by created_at desc limit 100`),
    getEligibleCustomers(pool, { includeSuppressed: true }),
    pool.query(`select email, reason, source, created_at from customer_email_suppressions order by created_at desc limit 500`),
    pool.query(`select c.email, c.created_at, s.email is not null as suppressed from custom_email_contacts c left join customer_email_suppressions s on s.email=c.email order by c.created_at desc limit 2000`)
  ]);
  const campaigns = campaignsResult.rows.map(mapCampaign);
  const summary = {
    drafts: campaigns.filter((item) => item.status === "DRAFT").length,
    scheduled: campaigns.filter((item) => item.status === "SCHEDULED").length,
    sentThirtyDays: campaigns.filter((item) => item.status === "SENT" && item.sentAt && Date.now() - new Date(item.sentAt).getTime() <= 30 * 86400000).length,
    contacts: contactsResult.rowCount || 0,
    suppressed: suppressionsResult.rowCount || 0
  };
  return {
    summary,
    sender: process.env.CUSTOM_EMAIL_FROM || process.env.SUPPORT_EMAIL_FROM || process.env.ACCESS_CODE_EMAIL_FROM || "CircuitWash <support@circuitwash.com>",
    timezone: "Europe/London",
    limits: { immediate: MAX_IMMEDIATE_RECIPIENTS, scheduled: MAX_SCHEDULED_RECIPIENTS, scheduleDays: 30 },
    variables: [
      { key: "email", label: "Customer email", fallback: "customer@example.com" },
      { key: "site_name", label: "Laundry site", fallback: "your laundry site" },
      { key: "order_id", label: "Latest order ID", fallback: "your recent order" },
      { key: "company_name", label: "Company name", fallback: "CircuitWash" },
      { key: "support_email", label: "Support email", fallback: "support@circuitwash.com" }
    ],
    starters: STARTER_TEMPLATES,
    templates: templatesResult.rows.map(mapTemplate),
    campaigns,
    customers,
    contacts: contactsResult.rows.map((row) => ({ email: row.email, createdAt: row.created_at, suppressed: Boolean(row.suppressed) })),
    suppressions: suppressionsResult.rows.map((row) => ({ email: row.email, reason: row.reason, source: row.source, createdAt: row.created_at }))
  };
}

async function saveCampaign(pool, body = {}) {
  const campaignId = optionalId(body.campaignId);
  const name = requiredText(body.name, "Email name", 160);
  const subject = cleanText(body.subject, 240);
  const preheader = cleanText(body.preheader, 300);
  const blocks = normalizeBlocks(body.blocks);
  const theme = normalizeTheme(body.theme);
  const includeUnsubscribe = body.includeUnsubscribe !== false;
  if (campaignId) {
    const existing = await getCampaignRow(pool, campaignId);
    if (!["DRAFT", "FAILED", "CANCELLED"].includes(existing.status)) throw adminError("Cancel the scheduled email before editing it.", 409, "campaign_locked");
    const { rows } = await pool.query(`
      update custom_email_campaigns
      set name=$2, subject=$3, preheader=$4, blocks=$5::jsonb, include_unsubscribe=$6, theme=$7::jsonb, status='DRAFT', scheduled_for=null,
          idempotency_token=md5(random()::text || clock_timestamp()::text), updated_at=now()
      where id=$1 returning *
    `, [campaignId, name, subject, preheader, JSON.stringify(blocks), includeUnsubscribe, JSON.stringify(theme)]);
    return { campaign: mapCampaign(rows[0]) };
  }
  const { rows } = await pool.query(`
    insert into custom_email_campaigns (name, subject, preheader, blocks, include_unsubscribe, theme)
    values ($1,$2,$3,$4::jsonb,$5,$6::jsonb) returning *
  `, [name, subject, preheader, JSON.stringify(blocks), includeUnsubscribe, JSON.stringify(theme)]);
  return { campaign: mapCampaign(rows[0]) };
}

async function deleteCampaign(pool, body = {}) {
  const campaignId = optionalId(body.campaignId);
  if (!campaignId) throw adminError("Invalid campaign.", 400, "invalid_campaign");
  const existing = await getCampaignRow(pool, campaignId);
  if (!new Set(["DRAFT", "FAILED", "CANCELLED"]).has(existing.status)) throw adminError("Only drafts, failed, or cancelled emails can be deleted.", 409, "campaign_locked");
  await pool.query(`delete from custom_email_campaigns where id=$1`, [campaignId]);
  return { deleted: true };
}

async function saveTemplate(pool, body = {}) {
  const templateId = optionalId(body.templateId);
  const name = requiredText(body.name, "Template name", 160);
  const subject = cleanText(body.subject, 240);
  const preheader = cleanText(body.preheader, 300);
  const blocks = normalizeBlocks(body.blocks);
  const theme = normalizeTheme(body.theme);
  const includeUnsubscribe = body.includeUnsubscribe !== false;
  if (templateId) {
    const { rows } = await pool.query(`
      update custom_email_templates set name=$2, subject=$3, preheader=$4, blocks=$5::jsonb, include_unsubscribe=$6, theme=$7::jsonb, status='ACTIVE', updated_at=now()
      where id=$1 and status <> 'DELETED' returning *
    `, [templateId, name, subject, preheader, JSON.stringify(blocks), includeUnsubscribe, JSON.stringify(theme)]);
    if (!rows[0]) throw adminError("Template not found.", 404, "template_not_found");
    return { template: mapTemplate(rows[0]) };
  }
  const { rows } = await pool.query(`insert into custom_email_templates (name,subject,preheader,blocks,include_unsubscribe,theme) values ($1,$2,$3,$4::jsonb,$5,$6::jsonb) returning *`, [name, subject, preheader, JSON.stringify(blocks), includeUnsubscribe, JSON.stringify(theme)]);
  return { template: mapTemplate(rows[0]) };
}

async function duplicateTemplate(pool, body = {}) {
  const templateId = optionalId(body.templateId);
  const source = await pool.query(`select * from custom_email_templates where id=$1 and status <> 'DELETED'`, [templateId]);
  if (!source.rows[0]) throw adminError("Template not found.", 404, "template_not_found");
  const row = source.rows[0];
  const { rows } = await pool.query(`insert into custom_email_templates (name,subject,preheader,blocks,include_unsubscribe,theme) values ($1,$2,$3,$4::jsonb,$5,$6::jsonb) returning *`, [`${row.name} copy`, row.subject, row.preheader, JSON.stringify(row.blocks), row.include_unsubscribe !== false, JSON.stringify(normalizeTheme(row.theme))]);
  return { template: mapTemplate(rows[0]) };
}

async function setTemplateStatus(pool, body = {}) {
  const templateId = optionalId(body.templateId);
  const status = body.delete ? "DELETED" : (body.archived ? "ARCHIVED" : "ACTIVE");
  const { rows } = await pool.query(`update custom_email_templates set status=$2, updated_at=now() where id=$1 returning *`, [templateId, status]);
  if (!rows[0]) throw adminError("Template not found.", 404, "template_not_found");
  return { template: mapTemplate(rows[0]) };
}

async function previewRecipients(pool, body = {}) {
  const targeting = normalizeTargeting(body);
  const recipients = await resolveRecipients(pool, targeting);
  return {
    targeting,
    count: recipients.length,
    recipients,
    suppressedExcluded: targeting.suppressedExcluded
  };
}

async function renderPreview(pool, body = {}, config = {}) {
  const sampleEmail = cleanText(body.sampleEmail, 320).toLowerCase();
  const customers = await getEligibleCustomers(pool, { includeSuppressed: true });
  const customer = customers.find((item) => item.email.toLowerCase() === sampleEmail) || customers[0] || { email: "customer@example.com", siteName: "your laundry site", orderId: "your recent order" };
  const content = normalizeEmailContent(body);
  return renderEmail(content, customer, config);
}

async function sendTest(pool, body = {}, config = {}) {
  assertProvider(config);
  const email = cleanText(body.email, 320).toLowerCase();
  if (!isValidEmail(email)) throw adminError("Enter a valid test email address.", 400, "invalid_email");
  const rendered = await renderPreview(pool, body, config);
  const response = await resendRequest(config, "/emails", {
    method: "POST",
    idempotencyKey: `custom-test-${crypto.randomUUID()}`,
    body: {
      from: config.from,
      to: [email],
      reply_to: [config.supportEmail],
      subject: `[TEST] ${rendered.subject}`,
      html: rendered.html,
      text: rendered.text
    }
  });
  return { sent: true, email, emailId: response.id };
}

async function sendCampaign(pool, body = {}, config = {}) {
  assertProvider(config);
  const campaignId = optionalId(body.campaignId);
  if (!campaignId) throw adminError("Save the email before sending.", 400, "campaign_required");
  const campaign = await getCampaignRow(pool, campaignId);
  if (!["DRAFT", "FAILED", "CANCELLED"].includes(campaign.status)) throw adminError("This email has already been submitted.", 409, "duplicate_send");
  const content = normalizeEmailContent(campaign);
  validateReadyContent(content);
  const targeting = normalizeTargeting(body);
  const recipients = await resolveRecipients(pool, targeting);
  if (!recipients.length) throw adminError("No eligible recipients match this selection.", 400, "missing_recipients");
  const scheduledFor = normalizeSchedule(body.scheduledFor);
  const limit = scheduledFor ? MAX_SCHEDULED_RECIPIENTS : MAX_IMMEDIATE_RECIPIENTS;
  if (recipients.length > limit) throw adminError(`${scheduledFor ? "Scheduled" : "Immediate"} sends support up to ${limit} recipients.`, 400, "too_many_recipients");

  const claim = await pool.query(`
    update custom_email_campaigns
    set status='SENDING', recipient_mode=$2, recipient_filter=$3::jsonb, recipient_snapshot=$4::jsonb,
        recipient_count=$5, sent_count=0, failed_count=0, scheduled_for=$6, updated_at=now()
    where id=$1 and status = any($7::text[]) returning *
  `, [campaignId, targeting.mode, JSON.stringify(targeting), JSON.stringify(recipients), recipients.length, scheduledFor, ["DRAFT", "FAILED", "CANCELLED"]]);
  if (!claim.rows[0]) throw adminError("This email is already being sent.", 409, "duplicate_send");
  await pool.query(`delete from custom_email_deliveries where campaign_id=$1`, [campaignId]);
  for (const recipient of recipients) {
    await pool.query(`insert into custom_email_deliveries (campaign_id,recipient_email,status,scheduled_for) values ($1,$2,$3,$4)`, [campaignId, recipient.email, scheduledFor ? "SCHEDULING" : "QUEUED", scheduledFor]);
  }

  try {
    const results = scheduledFor
      ? await scheduleRecipients(pool, campaign, content, recipients, scheduledFor, config)
      : await sendImmediateBatch(pool, campaign, content, recipients, config);
    const failed = results.filter((item) => item.status === "FAILED").length;
    const accepted = results.length - failed;
    const status = scheduledFor ? (accepted ? "SCHEDULED" : "FAILED") : (failed ? "FAILED" : "SENT");
    await pool.query(`
      update custom_email_campaigns
      set status=$2, sent_count=$3, failed_count=$4, sent_at=case when $2='SENT' then now() else null end, updated_at=now()
      where id=$1
    `, [campaignId, status, accepted, failed]);
    return { campaignId, status, recipientCount: recipients.length, accepted, failed, scheduledFor, results };
  } catch (error) {
    await pool.query(`update custom_email_campaigns set status='FAILED', failed_count=recipient_count, updated_at=now() where id=$1`, [campaignId]);
    throw error;
  }
}

async function sendImmediateBatch(pool, campaign, content, recipients, config) {
  const emails = recipients.map((recipient) => {
    const rendered = renderEmail(content, recipient, config);
    const email = {
      from: config.from,
      to: [recipient.email],
      reply_to: [config.supportEmail],
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text
    };
    if (content.includeUnsubscribe) email.headers = { "List-Unsubscribe": `<${rendered.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
    return email;
  });
  const response = await resendRequest(config, "/emails/batch", { method: "POST", idempotencyKey: `custom-campaign-${campaign.id}-${campaign.idempotency_token}`, body: emails });
  const ids = Array.isArray(response.data) ? response.data : [];
  const results = [];
  for (let index = 0; index < recipients.length; index += 1) {
    const recipient = recipients[index];
    const emailId = String(ids[index]?.id || "");
    const status = emailId ? "SENT" : "FAILED";
    await pool.query(`update custom_email_deliveries set status=$3,resend_email_id=$4,sent_at=case when $3='SENT' then now() else null end,send_error=$5,updated_at=now() where campaign_id=$1 and recipient_email=$2`, [campaign.id, recipient.email, status, emailId || null, emailId ? null : "Provider did not return an email ID"]);
    results.push({ email: recipient.email, status, emailId });
  }
  return results;
}

async function scheduleRecipients(pool, campaign, content, recipients, scheduledFor, config) {
  const results = [];
  for (let index = 0; index < recipients.length; index += 4) {
    const batch = recipients.slice(index, index + 4);
    const batchResults = await Promise.all(batch.map(async (recipient) => {
      const rendered = renderEmail(content, recipient, config);
      try {
        const emailBody = {
          from: config.from,
          to: [recipient.email],
          reply_to: [config.supportEmail],
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          scheduled_at: scheduledFor
        };
        if (content.includeUnsubscribe) emailBody.headers = { "List-Unsubscribe": `<${rendered.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
        const response = await resendRequest(config, "/emails", {
          method: "POST",
          idempotencyKey: `custom-scheduled-${campaign.id}-${hashText(recipient.email)}`,
          body: emailBody
        });
        await pool.query(`update custom_email_deliveries set status='SCHEDULED',resend_email_id=$3,updated_at=now() where campaign_id=$1 and recipient_email=$2`, [campaign.id, recipient.email, response.id]);
        return { email: recipient.email, status: "SCHEDULED", emailId: response.id };
      } catch (error) {
        const message = String(error?.message || error).slice(0, 1000);
        await pool.query(`update custom_email_deliveries set status='FAILED',send_error=$3,updated_at=now() where campaign_id=$1 and recipient_email=$2`, [campaign.id, recipient.email, message]);
        return { email: recipient.email, status: "FAILED", error: message };
      }
    }));
    results.push(...batchResults);
  }
  return results;
}

async function cancelScheduledCampaign(pool, body = {}, config = {}) {
  assertProvider(config);
  const campaignId = optionalId(body.campaignId);
  const campaign = await getCampaignRow(pool, campaignId);
  if (campaign.status !== "SCHEDULED") throw adminError("Only scheduled emails can be cancelled.", 409, "not_scheduled");
  const { rows } = await pool.query(`select id,resend_email_id from custom_email_deliveries where campaign_id=$1 and status='SCHEDULED' and resend_email_id is not null`, [campaignId]);
  let failed = 0;
  for (let index = 0; index < rows.length; index += 4) {
    const batch = rows.slice(index, index + 4);
    await Promise.all(batch.map(async (delivery) => {
      try {
        await resendRequest(config, `/emails/${encodeURIComponent(delivery.resend_email_id)}/cancel`, { method: "POST" });
        await pool.query(`update custom_email_deliveries set status='CANCELLED',updated_at=now() where id=$1`, [delivery.id]);
      } catch (error) {
        failed += 1;
        await pool.query(`update custom_email_deliveries set send_error=$2,updated_at=now() where id=$1`, [delivery.id, String(error?.message || error).slice(0, 1000)]);
      }
    }));
  }
  if (failed) throw adminError(`${failed} scheduled deliveries could not be cancelled.`, 502, "cancel_failed");
  await pool.query(`update custom_email_campaigns set status='CANCELLED',scheduled_for=null,updated_at=now() where id=$1`, [campaignId]);
  return { cancelled: true, campaignId };
}

async function restoreSuppression(pool, body = {}) {
  const email = cleanText(body.email, 320).toLowerCase();
  if (!isValidEmail(email)) throw adminError("Invalid email address.", 400, "invalid_email");
  const result = await pool.query(`delete from customer_email_suppressions where email=$1`, [email]);
  return { restored: Boolean(result.rowCount), email };
}

async function addContacts(pool, body = {}) {
  const rawValues = Array.isArray(body.emails) ? body.emails : String(body.emails || "").split(/[\s,;]+/);
  const entered = rawValues.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
  if (!entered.length) throw adminError("Enter at least one email address.", 400, "missing_email");
  if (entered.length > 500) throw adminError("Add no more than 500 addresses at once.", 400, "too_many_contacts");
  const invalid = entered.filter((email) => !isValidEmail(email));
  if (invalid.length) throw adminError(`Check the email address: ${invalid[0]}`, 400, "invalid_email");
  const emails = [...new Set(entered)];
  for (const email of emails) {
    await pool.query(`insert into custom_email_contacts (email) values ($1) on conflict (email) do update set updated_at=now()`, [email]);
  }
  return { added: emails.length, emails };
}

async function removeContact(pool, body = {}) {
  const email = cleanText(body.email, 320).toLowerCase();
  if (!isValidEmail(email)) throw adminError("Invalid email address.", 400, "invalid_email");
  const result = await pool.query(`delete from custom_email_contacts where email=$1`, [email]);
  return { removed: Boolean(result.rowCount), email };
}

async function resolveRecipients(pool, targeting) {
  const customers = await getEligibleCustomers(pool, { includeSuppressed: true });
  const suppressionSet = new Set(customers.filter((item) => item.suppressed).map((item) => item.email.toLowerCase()));
  let selected = [];
  if (targeting.mode === "ALL") selected = customers;
  else if (targeting.mode === "SITE") selected = customers.filter((item) => item.siteId === targeting.siteId);
  else {
    const wanted = new Set(targeting.emails.map((email) => email.toLowerCase()));
    selected = customers.filter((item) => wanted.has(item.email.toLowerCase()));
  }
  const beforeSuppression = selected.length;
  selected = selected.filter((item) => !suppressionSet.has(item.email.toLowerCase()));
  targeting.suppressedExcluded = beforeSuppression - selected.length;
  return selected.map(({ suppressed, ...item }) => item);
}

async function getEligibleCustomers(pool, { includeSuppressed = false } = {}) {
  const exists = await pool.query(`select to_regclass('public.paypal_access_orders') as table_name`);
  const rows = exists.rows[0]?.table_name ? (await pool.query(`
      with ranked as (
        select lower(trim(o.customer_email)) as email_key, trim(o.customer_email) as customer_email,
               o.site_id, o.order_id, coalesce(o.completed_at,o.created_at) as purchased_at,
               count(*) over (partition by lower(trim(o.customer_email)))::int as purchase_count,
               row_number() over (partition by lower(trim(o.customer_email)) order by coalesce(o.completed_at,o.created_at) desc,o.order_id desc) as row_number
        from paypal_access_orders o
        where o.status='COMPLETED' and o.customer_email is not null and trim(o.customer_email)<>''
      )
      select r.*, s.email is not null as suppressed
      from ranked r left join customer_email_suppressions s on s.email=r.email_key
      where r.row_number=1
      order by r.purchased_at desc limit 2000
    `)).rows : [];
  const sites = new Map(getPublicSites().map((site) => [site.id, site]));
  const customers = rows.map((row) => ({
    email: row.customer_email,
    siteId: row.site_id || "",
    siteName: sites.get(row.site_id)?.name || row.site_id || "your laundry site",
    orderId: row.order_id || "",
    purchasedAt: row.purchased_at || null,
    purchaseCount: Number(row.purchase_count) || 0,
    suppressed: Boolean(row.suppressed),
    source: "PAID_CUSTOMER"
  }));
  const existingEmails = new Set(customers.map((item) => item.email.toLowerCase()));
  const contacts = (await pool.query(`
    select c.email, c.created_at, s.email is not null as suppressed
    from custom_email_contacts c
    left join customer_email_suppressions s on s.email=c.email
    order by c.created_at desc limit 2000
  `)).rows.filter((row) => !existingEmails.has(row.email.toLowerCase())).map((row) => ({
    email: row.email,
    siteId: "",
    siteName: "your laundry site",
    orderId: "",
    purchasedAt: null,
    createdAt: row.created_at,
    purchaseCount: 0,
    suppressed: Boolean(row.suppressed),
    source: "EMAIL_LIST"
  }));
  return [...customers, ...contacts].filter((item) => includeSuppressed || !item.suppressed);
}

function normalizeTargeting(body = {}) {
  const mode = ["ALL", "SITE", "SELECTED"].includes(String(body.recipientMode || "").toUpperCase()) ? String(body.recipientMode).toUpperCase() : "SELECTED";
  const emails = uniqueEmails(body.emails);
  const siteId = cleanText(body.siteId, 200);
  if (mode === "SELECTED" && !emails.length) throw adminError("Select at least one customer.", 400, "missing_recipients");
  if (mode === "SITE" && !siteId) throw adminError("Choose a site segment.", 400, "missing_site");
  return { mode, emails, siteId, suppressedExcluded: 0 };
}

function normalizeEmailContent(body = {}) {
  return { name: cleanText(body.name, 160), subject: cleanText(body.subject, 240), preheader: cleanText(body.preheader, 300), includeUnsubscribe: body.includeUnsubscribe !== false && body.include_unsubscribe !== false, theme: normalizeTheme(body.theme), blocks: normalizeBlocks(body.blocks) };
}

function normalizeTheme(rawTheme) {
  const theme = rawTheme && typeof rawTheme === "object" && !Array.isArray(rawTheme) ? rawTheme : {};
  const colour = (key) => /^#[0-9a-f]{6}$/i.test(String(theme[key] || "")) ? String(theme[key]).toLowerCase() : DEFAULT_THEME[key];
  const preset = /^[a-z0-9_-]{1,24}$/i.test(String(theme.preset || "")) ? String(theme.preset).toLowerCase() : "circuit";
  return { preset, primary: colour("primary"), accent: colour("accent"), page: colour("page"), card: colour("card"), heading: colour("heading"), body: colour("body") };
}

function normalizeBlocks(rawBlocks) {
  const blocks = Array.isArray(rawBlocks) ? rawBlocks.slice(0, 40) : [];
  return blocks.map((raw, index) => {
    const type = BLOCK_TYPES.has(String(raw?.type || "")) ? String(raw.type) : "paragraph";
    const block = { id: cleanText(raw?.id, 80) || `${type}-${index + 1}`, type };
    if (type === "heading") return { ...block, text: cleanText(raw.text, 500), level: Number(raw.level) === 2 ? 2 : 1 };
    if (type === "paragraph") return { ...block, text: cleanText(raw.text, 5000) };
    if (type === "image") return { ...block, url: safeUrl(raw.url, true), alt: cleanText(raw.alt, 300), link: safeUrl(raw.link, true) };
    if (type === "button" || type === "link") return { ...block, text: cleanText(raw.text, 120) || (type === "link" ? "Read more" : "Learn more"), url: safeUrl(raw.url, false) };
    if (type === "divider") return block;
    if (type === "spacer") return { ...block, size: Math.min(64, Math.max(8, Number(raw.size) || 24)) };
    if (type === "list") return { ...block, items: (Array.isArray(raw.items) ? raw.items : String(raw.items || "").split("\n")).slice(0, 20).map((item) => cleanText(item, 500)).filter(Boolean) };
    if (type === "callout") return { ...block, title: cleanText(raw.title, 300), text: cleanText(raw.text, 2000) };
    return { ...block, text: cleanText(raw.text, 1500) };
  });
}

function renderEmail(content, customer = {}, config = {}) {
  const theme = normalizeTheme(content.theme);
  const unsubscribeUrl = makeUnsubscribeUrl(customer.email || "customer@example.com", config);
  const variables = {
    email: customer.email || "customer@example.com",
    site_name: customer.siteName || "your laundry site",
    order_id: customer.orderId || "your recent order",
    company_name: "CircuitWash",
    support_email: config.supportEmail || "support@circuitwash.com",
    unsubscribe_url: unsubscribeUrl
  };
  const subject = applyVariables(content.subject || "A message from CircuitWash", variables);
  const preheader = applyVariables(content.preheader || "", variables);
  const blocksHtml = content.blocks.map((block) => renderBlock(block, variables, theme)).join("");
  const blocksText = content.blocks.map((block) => renderBlockText(block, variables)).filter(Boolean).join("\n\n");
  const supportEmail = escapeHtml(config.supportEmail || "support@circuitwash.com");
  const unsubscribeHtml = content.includeUnsubscribe ? `<br><strong><a href="${escapeHtml(unsubscribeUrl)}" style="color:${theme.primary}">Unsubscribe</a></strong> from these emails` : "";
  const unsubscribeText = content.includeUnsubscribe ? `\nUnsubscribe from these emails: ${unsubscribeUrl}` : "";
  const wordmark = `<span style="color:${theme.heading}">Circuit</span><span style="color:${BRAND_CYAN}">Wash</span>`;
  const brandHeader = `<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding-right:11px"><span style="display:inline-block;width:30px;height:30px;line-height:27px;text-align:center;border:1px solid #285069;border-radius:9px;background:${theme.accent};color:${BRAND_CYAN};font:700 22px Arial,sans-serif">&#9711;</span></td><td><div style="font:800 18px Arial,sans-serif;letter-spacing:-.5px">${wordmark}</div><div style="margin-top:2px;color:${theme.body};font:10px Arial,sans-serif;letter-spacing:.8px;text-transform:uppercase">Laundry access</div></td></tr></table>`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:${theme.page}"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${theme.page}"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:${theme.card};border:1px solid ${theme.accent}"><tr><td style="padding:20px 28px;border-bottom:1px solid ${theme.accent}">${brandHeader}</td></tr><tr><td style="padding:30px 28px;font-family:Arial,sans-serif;color:${theme.body};line-height:1.55">${blocksHtml || `<p style="margin:0;color:${theme.body}">Start adding content blocks.</p>`}</td></tr><tr><td style="padding:20px 28px;background:${theme.accent};border-top:1px solid ${theme.accent};font:12px Arial,sans-serif;line-height:1.6;color:${theme.body}">&copy; ${wordmark} &middot; Customer communications${unsubscribeHtml}</td></tr></table></td></tr></table></body></html>`;
  const text = `${blocksText || "A message from CircuitWash"}\n\n© CircuitWash · Customer communications${unsubscribeText}`;
  return { subject, preheader, html, text, unsubscribeUrl, variables };
}

function renderBlock(block, variables, theme = DEFAULT_THEME) {
  if (block.type === "heading") {
    const size = block.level === 2 ? 21 : 28;
    return `<h${block.level} style="margin:0 0 14px;font:bold ${size}px Arial,sans-serif;line-height:1.2;color:${theme.heading}">${escapeHtml(applyVariables(block.text, variables))}</h${block.level}>`;
  }
  if (block.type === "paragraph") return `<p style="margin:0 0 18px;font:15px Arial,sans-serif;line-height:1.65;color:${theme.body}">${escapeHtml(applyVariables(block.text, variables)).replace(/\n/g, "<br>")}</p>`;
  if (block.type === "image" && block.url) {
    const image = `<img src="${escapeHtml(block.url)}" alt="${escapeHtml(applyVariables(block.alt, variables))}" width="544" style="display:block;width:100%;max-width:544px;height:auto;border:0">`;
    return `<div style="margin:0 0 20px">${block.link ? `<a href="${escapeHtml(block.link)}">${image}</a>` : image}</div>`;
  }
  if (block.type === "button") return `<div style="margin:4px 0 22px"><a href="${escapeHtml(applyVariables(block.url, variables))}" style="display:inline-block;padding:12px 18px;border-radius:5px;background:${theme.primary};color:${readableTextColour(theme.primary)};text-decoration:none;font:bold 14px Arial,sans-serif">${escapeHtml(applyVariables(block.text, variables))}</a></div>`;
  if (block.type === "link") return `<p style="margin:0 0 18px;font:15px Arial,sans-serif"><a href="${escapeHtml(applyVariables(block.url, variables))}" style="color:${theme.primary};text-decoration:underline">${escapeHtml(applyVariables(block.text, variables))}</a></p>`;
  if (block.type === "divider") return `<div style="height:1px;margin:22px 0;background:${theme.accent}"></div>`;
  if (block.type === "spacer") return `<div style="height:${block.size}px;line-height:${block.size}px">&nbsp;</div>`;
  if (block.type === "list") return `<ul style="margin:0 0 20px;padding-left:22px;font:15px Arial,sans-serif;line-height:1.6;color:${theme.body}">${block.items.map((item) => `<li style="margin-bottom:6px">${escapeHtml(applyVariables(item, variables))}</li>`).join("")}</ul>`;
  if (block.type === "callout") return `<div style="margin:0 0 20px;padding:16px;border-left:4px solid ${theme.primary};background:${theme.accent}"><strong style="display:block;margin-bottom:5px;font:700 15px Arial,sans-serif;color:${theme.heading}">${escapeHtml(applyVariables(block.title, variables))}</strong><div style="font:14px Arial,sans-serif;line-height:1.6;color:${theme.body}">${escapeHtml(applyVariables(block.text, variables)).replace(/\n/g, "<br>")}</div></div>`;
  if (block.type === "footer") return `<p style="margin:22px 0 0;font:12px Arial,sans-serif;line-height:1.55;color:${theme.body}">${escapeHtml(applyVariables(block.text, variables)).replace(/\n/g, "<br>")}</p>`;
  return "";
}

function renderBlockText(block, variables) {
  if (["heading", "paragraph", "footer"].includes(block.type)) return applyVariables(block.text, variables);
  if (block.type === "button" || block.type === "link") return `${applyVariables(block.text, variables)}: ${applyVariables(block.url, variables)}`;
  if (block.type === "image") return block.alt ? `[Image: ${applyVariables(block.alt, variables)}]` : "";
  if (block.type === "list") return block.items.map((item) => `- ${applyVariables(item, variables)}`).join("\n");
  if (block.type === "callout") return `${applyVariables(block.title, variables)}\n${applyVariables(block.text, variables)}`;
  return "";
}

function applyVariables(value, variables) {
  return String(value || "").replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, rawKey) => {
    const key = String(rawKey).toLowerCase();
    return VARIABLE_KEYS.has(key) ? String(variables[key] || "") : "";
  });
}

function makeUnsubscribeUrl(email, config) {
  const normalized = String(email || "").trim().toLowerCase();
  const encoded = Buffer.from(normalized).toString("base64url");
  const signature = crypto.createHmac("sha256", config.unsubscribeSecret || config.adminCode || "zaftwash").update(encoded).digest("base64url");
  return `${String(config.publicUrl || "https://circuitwash.com").replace(/\/$/, "")}/.netlify/functions/custom-email-unsubscribe?email=${encodeURIComponent(encoded)}&signature=${encodeURIComponent(signature)}`;
}

async function resendRequest(config, path, options = {}) {
  const headers = { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" };
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey.slice(0, 256);
  const response = await fetch(`https://api.resend.com${path}`, { method: options.method || "GET", headers, body: options.body ? JSON.stringify(options.body) : undefined });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw adminError(data?.message || `Email provider returned ${response.status}.`, 502, "provider_error");
  return data;
}

function normalizeSchedule(value) {
  const text = cleanText(value, 100);
  if (!text) return null;
  const date = new Date(text);
  const timestamp = date.getTime();
  if (!Number.isFinite(timestamp)) throw adminError("Choose a valid scheduled date and time.", 400, "invalid_schedule");
  if (timestamp < Date.now() + 5 * 60000) throw adminError("Schedule at least 5 minutes in the future.", 400, "invalid_schedule");
  if (timestamp > Date.now() + 30 * 86400000) throw adminError("Schedule no more than 30 days in advance.", 400, "invalid_schedule");
  return date.toISOString();
}

function validateReadyContent(content) {
  if (!content.subject.trim()) throw adminError("Add a subject line before sending.", 400, "missing_subject");
  if (!content.blocks.length) throw adminError("Add at least one content block before sending.", 400, "missing_content");
}

async function getCampaignRow(pool, id) {
  const { rows } = await pool.query(`select * from custom_email_campaigns where id=$1`, [id]);
  if (!rows[0]) throw adminError("Email not found.", 404, "campaign_not_found");
  return rows[0];
}

function mapCampaign(row) {
  return {
    id: Number(row.id), name: row.name, subject: row.subject, preheader: row.preheader, includeUnsubscribe: row.include_unsubscribe !== false, theme: normalizeTheme(row.theme), blocks: row.blocks || [], status: CAMPAIGN_STATUSES.has(row.status) ? row.status : "DRAFT",
    recipientMode: row.recipient_mode, recipientFilter: row.recipient_filter || {}, recipientSnapshot: row.recipient_snapshot || [], recipientCount: Number(row.recipient_count) || 0,
    sentCount: Number(row.sent_count) || 0, failedCount: Number(row.failed_count) || 0, scheduledFor: row.scheduled_for || null, sentAt: row.sent_at || null,
    creator: row.created_by || "Administrator", createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function mapTemplate(row) {
  return { id: Number(row.id), name: row.name, subject: row.subject, preheader: row.preheader, includeUnsubscribe: row.include_unsubscribe !== false, theme: normalizeTheme(row.theme), blocks: row.blocks || [], status: row.status, creator: row.created_by || "Administrator", createdAt: row.created_at, updatedAt: row.updated_at };
}

function uniqueEmails(values) {
  const source = Array.isArray(values) ? values : String(values || "").split(/[\s,;]+/);
  return [...new Set(source.map((value) => String(value || "").trim().toLowerCase()).filter(isValidEmail))];
}

function safeUrl(value, imageOnly) {
  const text = cleanText(value, 2000);
  if (!text) return "";
  if (!imageOnly && text === "{{unsubscribe_url}}") return text;
  if (/^https?:\/\//i.test(text)) return text;
  if (!imageOnly && /^mailto:[^\s@]+@[^\s@]+$/i.test(text)) return text;
  return "";
}

function requiredText(value, label, max) {
  const text = cleanText(value, max);
  if (!text) throw adminError(`${label} is required.`, 400, "missing_field");
  return text;
}

function cleanText(value, max) { return String(value || "").trim().slice(0, max); }
function optionalId(value) { const parsed = Number.parseInt(String(value || ""), 10); return Number.isInteger(parsed) && parsed > 0 ? parsed : null; }
function isValidEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "")); }
function readableTextColour(hex) { const value = String(hex || "").replace("#", ""); const red = Number.parseInt(value.slice(0, 2), 16) || 0; const green = Number.parseInt(value.slice(2, 4), 16) || 0; const blue = Number.parseInt(value.slice(4, 6), 16) || 0; return (red * 299 + green * 587 + blue * 114) / 1000 > 150 ? "#001319" : "#ffffff"; }
function hashText(value) { return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 24); }
function escapeHtml(value) { return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]); }
function assertProvider(config) { if (!config.apiKey || !config.from) throw adminError("Custom email sending is not configured.", 500, "email_not_configured"); }
function adminError(message, statusCode = 400, code = "bad_request") { const error = new Error(message); error.statusCode = statusCode; error.code = code; error.isAdminError = true; return error; }

module.exports = {
  addContacts,
  cancelScheduledCampaign,
  deleteCampaign,
  duplicateTemplate,
  ensureCustomEmailSchema,
  getEmailData,
  previewRecipients,
  removeContact,
  renderPreview,
  restoreSuppression,
  saveCampaign,
  saveTemplate,
  sendCampaign,
  sendTest,
  setTemplateStatus,
  _test: { applyVariables, normalizeBlocks, normalizeTheme, renderEmail }
};
