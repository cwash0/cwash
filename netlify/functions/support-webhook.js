const crypto = require("crypto");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const RESEND_API_KEY = String(process.env.RESEND_API_KEY || "").trim();
const RESEND_WEBHOOK_SECRET = String(process.env.RESEND_WEBHOOK_SECRET || "").trim();
const SUPPORT_INBOUND_ADDRESSES = String(
  process.env.SUPPORT_INBOUND_ADDRESSES ||
  process.env.SUPPORT_INBOUND_ADDRESS ||
  "support@circuitwash.com"
)
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return json({ ok: false }, 405);
    if (!RESEND_API_KEY || !RESEND_WEBHOOK_SECRET) {
      console.error("[support-webhook] Missing RESEND_API_KEY or RESEND_WEBHOOK_SECRET");
      return json({ ok: false, error: "not_configured" }, 500);
    }

    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64").toString("utf8")
      : (event.body || "");
    if (!verifySvixWebhook(rawBody, event.headers || {}, RESEND_WEBHOOK_SECRET)) {
      return json({ ok: false, error: "invalid_signature" }, 400);
    }

    const payload = JSON.parse(rawBody);
    if (payload?.type !== "email.received") return json({ ok: true, ignored: true });

    const metadata = payload.data || {};
    const recipients = [
      ...(Array.isArray(metadata.to) ? metadata.to : []),
      ...(Array.isArray(metadata.received_for) ? metadata.received_for : [])
    ].map(normalizeAddress);

    const matchesSupport = SUPPORT_INBOUND_ADDRESSES.length === 0 ||
      SUPPORT_INBOUND_ADDRESSES.some((address) => recipients.includes(address));
    if (!matchesSupport) return json({ ok: true, ignored: true });

    const received = await fetchReceivedEmail(String(metadata.email_id || ""));
    const sender = parseMailbox(received.from || metadata.from || "");
    const subject = String(received.subject || metadata.subject || "No subject").slice(0, 500);
    const bodyText = normaliseBody(received.text, received.html);
    const receivedAt = safeIsoDate(received.created_at || metadata.created_at || payload.created_at);
    const messageId = String(received.message_id || metadata.message_id || "").slice(0, 1000);
    const inReplyTo = String(getEmailHeader(received.headers, "in-reply-to") || "").slice(0, 1000);
    const references = String(getEmailHeader(received.headers, "references") || "").slice(0, 4000);
    const receivedEmailId = String(received.id || metadata.email_id || "");

    await ensureSupportTables();

    const parentTicketId = await findParentTicket({
      senderEmail: sender.email,
      subject,
      inReplyTo,
      references
    });

    if (parentTicketId) {
      await pool.query(
        `
          insert into support_replies (
            ticket_id, direction, from_email, received_email_id,
            message_id, message_id_normalized, body_text, sent_at
          )
          values ($1, 'INBOUND', $2, $3, $4, $5, $6, $7::timestamptz)
          on conflict (received_email_id) do nothing
        `,
        [
          parentTicketId,
          sender.email,
          receivedEmailId,
          messageId || null,
          normalizeMessageId(messageId) || null,
          bodyText,
          receivedAt
        ]
      );
      await pool.query(
        `
          update support_tickets
          set status = 'OPEN', is_read = false,
              last_activity_at = greatest(last_activity_at, $2::timestamptz),
              updated_at = now()
          where id = $1
        `,
        [parentTicketId, receivedAt]
      );
      return json({ ok: true, ticketId: Number(parentTicketId), threaded: true });
    }

    const result = await pool.query(
      `
        insert into support_tickets (
          resend_email_id, message_id, message_id_normalized,
          in_reply_to, references_header,
          from_name, from_email, to_addresses, subject, body_text,
          attachments, status, received_at, last_activity_at
        )
        values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11::jsonb,'OPEN',$12::timestamptz,$12::timestamptz)
        on conflict (resend_email_id) do update set
          subject = excluded.subject,
          body_text = excluded.body_text,
          attachments = excluded.attachments,
          message_id = coalesce(excluded.message_id, support_tickets.message_id),
          message_id_normalized = coalesce(excluded.message_id_normalized, support_tickets.message_id_normalized),
          last_activity_at = greatest(support_tickets.last_activity_at, excluded.last_activity_at)
        returning id
      `,
      [
        receivedEmailId,
        messageId || null,
        normalizeMessageId(messageId) || null,
        inReplyTo || null,
        references || null,
        sender.name || null,
        sender.email,
        JSON.stringify(received.to || metadata.to || []),
        subject,
        bodyText,
        JSON.stringify(Array.isArray(received.attachments) ? received.attachments : []),
        receivedAt
      ]
    );

    return json({ ok: true, ticketId: result.rows[0]?.id || null, threaded: false });
  } catch (error) {
    console.error("[support-webhook] fatal:", error?.stack || error);
    return json({ ok: false, error: "server_error" }, 500);
  }
};

async function findParentTicket({ senderEmail, subject, inReplyTo, references }) {
  const ids = [...new Set(extractMessageIds(`${inReplyTo} ${references}`))];
  if (ids.length) {
    const match = await pool.query(
      `
        select ticket_id
        from (
          select id as ticket_id, last_activity_at as activity
          from support_tickets
          where message_id_normalized = any($1::text[])
          union all
          select r.ticket_id, r.sent_at as activity
          from support_replies r
          where r.message_id_normalized = any($1::text[])
        ) matched
        order by activity desc
        limit 1
      `,
      [ids]
    );
    if (match.rows[0]?.ticket_id) return match.rows[0].ticket_id;
  }

  const tokenId = extractTicketId(subject);
  if (tokenId) {
    const tokenMatch = await pool.query(
      `select id from support_tickets where id = $1 and lower(from_email) = lower($2) limit 1`,
      [tokenId, senderEmail]
    );
    if (tokenMatch.rows[0]?.id) return tokenMatch.rows[0].id;
  }

  return null;
}

async function fetchReceivedEmail(emailId) {
  if (!emailId) throw new Error("Missing received email ID");
  const response = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
    headers: { Authorization: `Bearer ${RESEND_API_KEY}` }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.message || `Resend retrieve failed (${response.status})`);
  return body;
}

async function ensureSupportTables() {
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
}

function getEmailHeader(headers, name) {
  const target = String(name || "").toLowerCase();
  if (Array.isArray(headers)) {
    const entry = headers.find((item) => String(item?.name || item?.key || "").toLowerCase() === target);
    return entry?.value || "";
  }
  if (headers && typeof headers === "object") {
    const key = Object.keys(headers).find((item) => item.toLowerCase() === target);
    const value = key ? headers[key] : "";
    return Array.isArray(value) ? value.join(" ") : value;
  }
  return "";
}

function normalizeMessageId(value) {
  return String(value || "").trim().replace(/[<>\s]/g, "").toLowerCase();
}

function extractMessageIds(value) {
  const text = String(value || "");
  const angleIds = [...text.matchAll(/<([^<>]+)>/g)].map((match) => normalizeMessageId(match[1]));
  const looseIds = text
    .split(/[\s,]+/)
    .map(normalizeMessageId)
    .filter((entry) => entry.includes("@"));
  return [...angleIds, ...looseIds].filter(Boolean);
}

function extractTicketId(subject) {
  const match = String(subject || "").match(/\[LS-(\d+)\]/i);
  const id = match ? Number.parseInt(match[1], 10) : 0;
  return Number.isInteger(id) && id > 0 ? id : 0;
}

function verifySvixWebhook(payload, headers, secret) {
  try {
    const id = headerValue(headers, "svix-id");
    const timestamp = headerValue(headers, "svix-timestamp");
    const signatureHeader = headerValue(headers, "svix-signature");
    if (!id || !timestamp || !signatureHeader) return false;

    const timestampNumber = Number(timestamp);
    if (!Number.isFinite(timestampNumber)) return false;
    if (Math.abs(Math.floor(Date.now() / 1000) - timestampNumber) > 300) return false;

    const secretValue = secret.startsWith("whsec_") ? secret.slice(6) : secret;
    const key = Buffer.from(secretValue, "base64");
    const expected = crypto
      .createHmac("sha256", key)
      .update(`${id}.${timestamp}.${payload}`)
      .digest("base64");

    return signatureHeader
      .split(/\s+/)
      .map((part) => part.split(","))
      .filter(([version, signature]) => version === "v1" && signature)
      .some(([, signature]) => timingSafeEqual(signature, expected));
  } catch (_) {
    return false;
  }
}

function headerValue(headers, name) {
  const target = name.toLowerCase();
  const key = Object.keys(headers).find((entry) => entry.toLowerCase() === target);
  return key ? String(headers[key] || "") : "";
}

function timingSafeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseMailbox(value) {
  const text = String(value || "").trim();
  const angle = text.match(/^(.*?)<([^<>]+)>$/);
  if (angle) {
    return {
      name: angle[1].trim().replace(/^"|"$/g, ""),
      email: normalizeAddress(angle[2])
    };
  }
  return { name: "", email: normalizeAddress(text) };
}

function normalizeAddress(value) {
  const text = String(value || "").trim().toLowerCase();
  const angle = text.match(/<([^<>]+)>/);
  return (angle ? angle[1] : text).trim();
}

function normaliseBody(text, html) {
  const plain = String(text || "").trim();
  const body = plain || htmlToText(String(html || ""));
  return stripQuotedReply(body).slice(0, 100000);
}

function stripQuotedReply(value) {
  const original = String(value || "").replace(/\r\n?/g, "\n").trim();
  if (!original) return "";

  let lines = original.split("\n");
  while (lines.length && /^>/.test(lines[lines.length - 1].trim())) lines.pop();
  const withoutTrailingQuotes = lines.join("\n").trim();

  const splitIndex = findReplyContextStart(withoutTrailingQuotes.split("\n"));
  const cleaned = (splitIndex >= 0
    ? withoutTrailingQuotes.split("\n").slice(0, splitIndex).join("\n")
    : withoutTrailingQuotes
  )
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return cleaned || original;
}

function findReplyContextStart(lines) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = String(lines[index] || "").trim();
    const nextBlock = lines.slice(index, index + 6).join("\n");

    if (/^_{5,}$/.test(line)) return index;
    if (/^-{2,}\s*original message\s*-{2,}$/i.test(line)) return index;
    if (/^on .+wrote:$/i.test(line)) return index;
    if (/^on .+/i.test(line) && /\bwrote:\s*$/i.test(nextBlock)) return index;
    if (/^sent from (outlook for ios|my iphone|my ipad|my android)/i.test(line)) return index;
    if (/^from:\s.+/i.test(line) && /\n(sent|to|subject):\s/i.test(nextBlock)) return index;
  }
  return -1;
}

function htmlToText(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function safeIsoDate(value) {
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function json(value, statusCode = 200) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    body: JSON.stringify(value)
  };
}
