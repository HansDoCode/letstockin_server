import { createHash } from 'node:crypto';
import { inTransaction, pool } from './db.js';

const WINDOW = '15 minutes';
const RETENTION = '1 day';
const MAX_FAILURES = 5;

export function loginAttemptKey(ip, email) {
  return createHash('sha256').update(`${String(ip)}\0${String(email)}`).digest('hex');
}

export async function isLoginBlocked(attemptKey) {
  const { rows } = await pool.query(`
    SELECT 1 FROM login_attempts
    WHERE attempt_key=$1
      AND (blocked_until > NOW() OR (window_started_at > NOW() - INTERVAL '${WINDOW}' AND failed_count >= ${MAX_FAILURES}))
    LIMIT 1`, [attemptKey]);
  return Boolean(rows[0]);
}

export async function recordLoginFailure(attemptKey) {
  return inTransaction(async client => {
    await client.query(`DELETE FROM login_attempts WHERE updated_at <= NOW() - INTERVAL '${RETENTION}'`);
    const { rows } = await client.query(`
      INSERT INTO login_attempts (attempt_key, failed_count, window_started_at, blocked_until, updated_at)
      VALUES ($1, 1, NOW(), NULL, NOW())
      ON CONFLICT (attempt_key) DO UPDATE SET
        failed_count = CASE
          WHEN login_attempts.window_started_at <= NOW() - INTERVAL '${WINDOW}' THEN 1
          ELSE login_attempts.failed_count + 1
        END,
        window_started_at = CASE
          WHEN login_attempts.window_started_at <= NOW() - INTERVAL '${WINDOW}' THEN NOW()
          ELSE login_attempts.window_started_at
        END,
        blocked_until = CASE
          WHEN login_attempts.window_started_at <= NOW() - INTERVAL '${WINDOW}' THEN NULL
          WHEN login_attempts.failed_count + 1 >= ${MAX_FAILURES} THEN NOW() + INTERVAL '${WINDOW}'
          ELSE login_attempts.blocked_until
        END,
        updated_at = NOW()
      RETURNING failed_count, blocked_until`, [attemptKey]);
    return rows[0];
  });
}

export async function clearLoginFailures(attemptKey) {
  await pool.query('DELETE FROM login_attempts WHERE attempt_key=$1', [attemptKey]);
}
