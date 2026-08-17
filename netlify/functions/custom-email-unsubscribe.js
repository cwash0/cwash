const crypto = require("crypto");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const encoded = String(params.email || "");
  const signature = String(params.signature || "");
  if (!isValidToken(encoded, signature)) return page("This unsubscribe link is invalid or incomplete.", false, 400);
  let email = "";
  try { email = Buffer.from(encoded, "base64url").toString("utf8").trim().toLowerCase(); } catch (_) {}
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return page("This unsubscribe link is invalid or incomplete.", false, 400);

  if (event.httpMethod === "GET") {
    return page(`Unsubscribe ${escapeHtml(email)} from CircuitWash customer updates?`, true, 200, encoded, signature);
  }
  if (event.httpMethod !== "POST") return page("Method not allowed.", false, 405);
  await pool.query(`create table if not exists customer_email_suppressions (email text primary key, reason text not null default 'Customer unsubscribed', source text not null default 'UNSUBSCRIBE', created_at timestamptz not null default now())`);
  await pool.query(`insert into customer_email_suppressions (email,reason,source) values ($1,'Customer unsubscribed','UNSUBSCRIBE') on conflict (email) do nothing`, [email]);
  return page(`${escapeHtml(email)} has been unsubscribed from CircuitWash customer updates. We may still send essential service or account emails when required.`, false, 200);
};

function isValidToken(encoded, signature) {
  if (!encoded || !signature) return false;
  const secret = String(process.env.EMAIL_UNSUBSCRIBE_SECRET || process.env.ADMIN_ACCESS_CODE || process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL || "");
  if (!secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  const left = Buffer.from(signature); const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function page(message, confirm, statusCode, email = "", signature = "") {
  const action = `/.netlify/functions/custom-email-unsubscribe?email=${encodeURIComponent(email)}&signature=${encodeURIComponent(signature)}`;
  return { statusCode, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }, body: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email preferences · CircuitWash</title></head><body style="margin:0;background:#f3f5f7;font:15px Arial,sans-serif;color:#17212b"><main style="max-width:520px;margin:12vh auto;padding:28px;background:#fff;border:1px solid #dce2e8"><div style="font-weight:800;color:#176b63">CircuitWash</div><h1 style="font-size:24px">Email preferences</h1><p style="line-height:1.6;color:#4e5d6b">${message}</p>${confirm ? `<form action="${action}" method="post"><button style="padding:12px 16px;border:0;border-radius:5px;background:#a33434;color:#fff;font-weight:700;cursor:pointer">Confirm unsubscribe</button></form>` : ""}</main></body></html>` };
}

function escapeHtml(value) { return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]); }
