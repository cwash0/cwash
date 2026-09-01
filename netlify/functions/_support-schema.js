let supportSchemaReady = false;

async function ensureSupportSchema(pool) {
  if (supportSchemaReady) return;

  await pool.query(`
    create table if not exists support_tickets (
      id bigserial primary key,
      resend_email_id text unique,
      submission_key_hash char(64) unique,
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
      status text not null default 'NEW',
      source text not null default 'WEB',
      source_route text,
      session_hash char(64),
      site_id text,
      site_name text,
      machine_id text,
      access_code_hash char(64),
      linked_access_code text,
      linked_order_id text,
      context_match text,
      user_agent text,
      is_read boolean not null default false,
      received_at timestamptz not null default now(),
      last_activity_at timestamptz not null default now(),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await pool.query(`alter table support_tickets alter column resend_email_id drop not null`);
  await pool.query(`
    alter table support_tickets
      add column if not exists submission_key_hash char(64),
      add column if not exists is_read boolean not null default false,
      add column if not exists message_id_normalized text,
      add column if not exists source text not null default 'EMAIL',
      add column if not exists source_route text,
      add column if not exists session_hash char(64),
      add column if not exists site_id text,
      add column if not exists site_name text,
      add column if not exists machine_id text,
      add column if not exists access_code_hash char(64),
      add column if not exists linked_access_code text,
      add column if not exists linked_order_id text,
      add column if not exists context_match text,
      add column if not exists user_agent text
  `);
  await pool.query(`
    update support_tickets
    set status = case
      when status = 'CLOSED' then 'RESOLVED'
      when status = 'PENDING' then 'OPEN'
      else status
    end
    where status in ('CLOSED', 'PENDING')
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

  await pool.query(`create unique index if not exists support_tickets_submission_key_idx on support_tickets(submission_key_hash) where submission_key_hash is not null`);
  await pool.query(`create unique index if not exists support_replies_received_email_idx on support_replies(received_email_id) where received_email_id is not null`);
  await pool.query(`create index if not exists support_tickets_status_activity_idx on support_tickets(status, last_activity_at desc)`);
  await pool.query(`create index if not exists support_tickets_email_idx on support_tickets(lower(from_email), last_activity_at desc)`);
  await pool.query(`create index if not exists support_tickets_linked_order_idx on support_tickets(linked_order_id) where linked_order_id is not null`);
  await pool.query(`create index if not exists support_tickets_linked_code_idx on support_tickets(linked_access_code) where linked_access_code is not null`);
  await pool.query(`create index if not exists support_replies_ticket_idx on support_replies(ticket_id, sent_at)`);
  await pool.query(`create index if not exists support_tickets_message_id_idx on support_tickets(message_id_normalized) where message_id_normalized is not null`);
  await pool.query(`create index if not exists support_replies_message_id_idx on support_replies(message_id_normalized) where message_id_normalized is not null`);

  supportSchemaReady = true;
}

function resetSupportSchemaForTests() {
  supportSchemaReady = false;
}

module.exports = { ensureSupportSchema, resetSupportSchemaForTests };
