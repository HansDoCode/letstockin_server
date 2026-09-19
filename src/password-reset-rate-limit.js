import { createHash } from 'node:crypto';
import { inTransaction, pool } from './db.js';

const WINDOW = '15 minutes';
const RETENTION = '1 day';
const MAX_REQUESTS = 5;

export function passwordResetAttemptKey(ip, email) {
  return createHash('sha256').update(`${String(ip)}\0${String(email)}`).digest('hex');
}

export async function isPasswordResetBlocked(attemptKey) {
  const { rows } = await pool.query(`
    SELECT 1 FROM password_reset_attempts
    WHERE attempt_key=$1
      AND (blocked_until > NOW() OR (window_started_at > NOW() - INTERVAL '${WINDOW}' AND request_count >= ${MAX_REQUESTS}))
    LIMIT 1`, [attemptKey]);
  return Boolean(rows[0]);
}

export async function recordPasswordResetRequest(attemptKey) {
  return inTransaction(async client => {
    await client.query(`DELETE FROM password_reset_attempts WHERE updated_at <= NOW() - INTERVAL '${RETENTION}'`);
    const { rows } = await client.query(`
      INSERT INTO password_reset_attempts (attempt_key, request_count, window_started_at, blocked_until, updated_at)
      VALUES ($1, 1, NOW(), NULL, NOW())
      ON CONFLICT (attempt_key) DO UPDATE SET
        request_count = CASE
          WHEN password_reset_attempts.window_started_at <= NOW() - INTERVAL '${WINDOW}' THEN 1
          ELSE password_reset_attempts.request_count + 1
        END,
        window_started_at = CASE
          WHEN password_reset_attempts.window_started_at <= NOW() - INTERVAL '${WINDOW}' THEN NOW()
          ELSE password_reset_attempts.window_started_at
        END,
        blocked_until = CASE
          WHEN password_reset_attempts.window_started_at <= NOW() - INTERVAL '${WINDOW}' THEN NULL
          WHEN password_reset_attempts.request_count + 1 >= ${MAX_REQUESTS} THEN NOW() + INTERVAL '${WINDOW}'
          ELSE password_reset_attempts.blocked_until
        END,
        updated_at = NOW()
      RETURNING request_count, blocked_until`, [attemptKey]);
    return rows[0];
  });
}
