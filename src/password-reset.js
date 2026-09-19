import { createHash, randomBytes } from 'node:crypto';
import { inTransaction, pool } from './db.js';
import { clientOrigin, isProduction, passwordResetDeliveryProvider, passwordResetFromEmail } from './config.js';
import { hashPassword } from './auth.js';

const TOKEN_TTL = '1 hour';
const TOKEN_TTL_MINUTES = 60;
const RESEND_ENDPOINT = 'https://api.resend.com/emails';
let testDelivery = null;

const tokenDigest = token => createHash('sha256').update(String(token)).digest('hex');

export class PasswordResetDeliveryError extends Error {
  constructor() {
    super('Password reset delivery is unavailable.');
    this.name = 'PasswordResetDeliveryError';
  }
}

function resetUrl(token) {
  if (!clientOrigin) throw new PasswordResetDeliveryError();
  return `${clientOrigin}/reset-password#token=${encodeURIComponent(token)}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

export function createPasswordResetEmail({ email, name, url }) {
  const recipientName = String(name || '').trim().replace(/\s+/g, ' ') || 'there';
  const safeName = escapeHtml(recipientName);
  const safeUrl = escapeHtml(url);
  return {
    from: passwordResetFromEmail,
    to: [email],
    subject: 'Reset your Letstockin password',
    html: `<p>Hello ${safeName},</p><p>We received a request to reset your Letstockin password.</p><p><a href="${safeUrl}">Reset your password</a></p><p>This link expires in ${TOKEN_TTL_MINUTES} minutes and can only be used once. If you did not request this, you can ignore this email.</p>`,
    text: `Hello ${recipientName},\n\nWe received a request to reset your Letstockin password.\n\nReset your password: ${url}\n\nThis link expires in ${TOKEN_TTL_MINUTES} minutes and can only be used once. If you did not request this, you can ignore this email.`
  };
}

async function deliverWithResend({ email, name, url, idempotencyKey }) {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  if (!apiKey || !passwordResetFromEmail) throw new PasswordResetDeliveryError();
  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}`, ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}) },
      body: JSON.stringify(createPasswordResetEmail({ email, name, url })),
      redirect: 'error',
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error('delivery status');
  } catch {
    throw new PasswordResetDeliveryError();
  }
}

async function deliverWithWebhook({ email, name, url }) {
  const rawEndpoint = String(process.env.PASSWORD_RESET_DELIVERY_URL || '').trim();
  const bearer = String(process.env.PASSWORD_RESET_DELIVERY_TOKEN || '').trim();
  let endpoint;
  try { endpoint = new URL(rawEndpoint); } catch { throw new PasswordResetDeliveryError(); }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || (isProduction && endpoint.protocol !== 'https:')) throw new PasswordResetDeliveryError();
  if (isProduction && !bearer) throw new PasswordResetDeliveryError();
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
      body: JSON.stringify({ event: 'password_reset', recipient: { email, name }, resetUrl: url, expiresInMinutes: TOKEN_TTL_MINUTES }),
      redirect: 'error',
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error('delivery status');
  } catch {
    throw new PasswordResetDeliveryError();
  }
}

export async function deliverPasswordReset({ email, name, url, idempotencyKey }) {
  if (process.env.NODE_ENV === 'test') {
    testDelivery = { email, name, resetUrl: url, expiresInMinutes: TOKEN_TTL_MINUTES };
    return;
  }
  if (passwordResetDeliveryProvider === 'resend') return deliverWithResend({ email, name, url, idempotencyKey });
  return deliverWithWebhook({ email, name, url });
}

export function getTestPasswordResetDelivery() {
  return process.env.NODE_ENV === 'test' ? testDelivery : null;
}

export async function requestPasswordReset(email) {
  const { rows } = await pool.query('SELECT id, name, email FROM users WHERE lower(email)=$1', [email]);
  const user = rows[0];
  if (!user) return { deliveryFailed: false };

  const token = randomBytes(32).toString('hex');
  const tokenHash = tokenDigest(token);
  await inTransaction(async client => {
    await client.query("DELETE FROM password_reset_tokens WHERE created_at <= NOW() - INTERVAL '1 day'");
    await client.query(`INSERT INTO password_reset_tokens (token_hash, user_id, expires_at) VALUES ($1,$2,NOW() + INTERVAL '${TOKEN_TTL}')`, [tokenHash, user.id]);
  });

  try {
    await deliverPasswordReset({ email: user.email, name: user.name, url: resetUrl(token), idempotencyKey: tokenHash });
    await inTransaction(async client => {
      await client.query('UPDATE password_reset_tokens SET used_at=NOW() WHERE user_id=$1 AND token_hash <> $2 AND used_at IS NULL', [user.id, tokenHash]);
    });
    return { deliveryFailed: false };
  } catch {
    await pool.query('DELETE FROM password_reset_tokens WHERE token_hash=$1', [tokenHash]).catch(() => {});
    return { deliveryFailed: true };
  }
}

export async function completePasswordReset(token, newPassword) {
  const tokenHash = tokenDigest(token);
  const { rows: candidates } = await pool.query('SELECT user_id FROM password_reset_tokens WHERE token_hash=$1 AND used_at IS NULL AND expires_at > NOW()', [tokenHash]);
  if (!candidates[0]) return false;
  const passwordHash = await hashPassword(newPassword);

  return inTransaction(async client => {
    const { rows } = await client.query('SELECT user_id FROM password_reset_tokens WHERE token_hash=$1 AND used_at IS NULL AND expires_at > NOW() FOR UPDATE', [tokenHash]);
    if (!rows[0]) return false;
    const userId = rows[0].user_id;
    await client.query('UPDATE users SET password_hash=$1 WHERE id=$2', [passwordHash, userId]);
    await client.query('UPDATE password_reset_tokens SET used_at=NOW() WHERE user_id=$1 AND used_at IS NULL', [userId]);
    await client.query('DELETE FROM sessions WHERE user_id=$1', [userId]);
    return true;
  });
}
