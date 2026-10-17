import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { inTransaction, pool } from './db.js';

const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_SKEW_STEPS = 1;
const MAX_CHALLENGE_ATTEMPTS = 5;
const MAX_SETUP_ATTEMPTS = 5;
const RECOVERY_CODE_COUNT = 10;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export class MfaConfigurationError extends Error {
  constructor() { super('MFA is not configured.'); this.name = 'MfaConfigurationError'; }
}

export class MfaAlreadyEnabledError extends Error {
  constructor() { super('MFA is already enabled.'); this.name = 'MfaAlreadyEnabledError'; }
}

function encryptionKey() {
  const configured = String(process.env.MFA_ENCRYPTION_KEY || '').trim();
  if (configured.length < 32) throw new MfaConfigurationError();
  return createHash('sha256').update(configured).digest();
}

function digest(value) { return createHash('sha256').update(value).digest('hex'); }

function encodeBase32(bytes) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function decodeBase32(value) {
  const normalized = String(value || '').replace(/\s|=+/g, '').toUpperCase();
  if (!normalized || /[^A-Z2-7]/.test(normalized)) return null;
  let bits = 0;
  let buffer = 0;
  const bytes = [];
  for (const character of normalized) {
    buffer = (buffer << 5) | BASE32.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret() { return encodeBase32(randomBytes(20)); }

export function createOtpAuthUrl(email, secret) {
  const label = encodeURIComponent(`Letstockin:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent('Letstockin')}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}

export function totpCode(secret, timestamp = Date.now()) {
  const key = decodeBase32(secret);
  if (!key) throw new Error('Invalid TOTP secret.');
  const counter = BigInt(Math.floor(timestamp / 1000 / TOTP_STEP_SECONDS));
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digestValue = createHmac('sha1', key).update(message).digest();
  const offset = digestValue[digestValue.length - 1] & 15;
  const binary = ((digestValue[offset] & 127) << 24)
    | (digestValue[offset + 1] << 16)
    | (digestValue[offset + 2] << 8)
    | digestValue[offset + 3];
  return String(binary % (10 ** TOTP_DIGITS)).padStart(TOTP_DIGITS, '0');
}

export function verifyTotp(secret, code, timestamp = Date.now()) {
  const provided = String(code || '').trim();
  if (!/^\d{6}$/.test(provided)) return false;
  const providedBytes = Buffer.from(provided);
  let valid = false;
  for (let step = -TOTP_SKEW_STEPS; step <= TOTP_SKEW_STEPS; step += 1) {
    const expectedBytes = Buffer.from(totpCode(secret, timestamp + step * TOTP_STEP_SECONDS * 1000));
    valid ||= timingSafeEqual(expectedBytes, providedBytes);
  }
  return valid;
}

export function encryptMfaSecret(secret) {
  const key = encryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(value => value.toString('base64')).join('.');
}

export function decryptMfaSecret(value) {
  const key = encryptionKey();
  try {
    const [ivValue, tagValue, ciphertextValue] = String(value || '').split('.');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivValue, 'base64'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Stored MFA secret cannot be decrypted.');
  }
}

export function normalizeRecoveryCode(code) { return String(code || '').trim().toUpperCase().replace(/[\s-]/g, ''); }

export function hashRecoveryCode(code) {
  const normalized = normalizeRecoveryCode(code);
  return /^[A-F0-9]{20}$/.test(normalized) ? digest(normalized) : '';
}

function formatRecoveryCode(code) { return code.match(/.{1,4}/g).join('-'); }

export function generateRecoveryCodes() {
  const codes = new Set();
  while (codes.size < RECOVERY_CODE_COUNT) codes.add(formatRecoveryCode(randomBytes(10).toString('hex').toUpperCase()));
  return [...codes];
}

export async function beginMfaSetup(userId, email) {
  encryptionKey();
  const { rows: enabled } = await pool.query('SELECT 1 FROM user_mfa WHERE user_id=$1', [userId]);
  if (enabled[0]) throw new MfaAlreadyEnabledError();
  const secret = generateTotpSecret();
  await pool.query(`INSERT INTO mfa_setup (user_id, secret_ciphertext, attempt_count, expires_at)
    VALUES ($1,$2,0,NOW() + INTERVAL '10 minutes')
    ON CONFLICT (user_id) DO UPDATE SET secret_ciphertext=EXCLUDED.secret_ciphertext, attempt_count=0, expires_at=EXCLUDED.expires_at, created_at=NOW()`, [userId, encryptMfaSecret(secret)]);
  return { secret, otpauthUrl: createOtpAuthUrl(email, secret), expiresInMinutes: 10 };
}

export async function confirmMfaSetup(userId, code) {
  return inTransaction(async client => {
    const { rows: setups } = await client.query(`SELECT secret_ciphertext, attempt_count FROM mfa_setup
      WHERE user_id=$1 AND expires_at > NOW() FOR UPDATE`, [userId]);
    if (!setups[0]) return { status: 'expired' };
    if (setups[0].attempt_count >= MAX_SETUP_ATTEMPTS) return { status: 'locked' };
    const { rows: enabled } = await client.query('SELECT 1 FROM user_mfa WHERE user_id=$1 FOR UPDATE', [userId]);
    if (enabled[0]) return { status: 'already-enabled' };
    const secret = decryptMfaSecret(setups[0].secret_ciphertext);
    if (!verifyTotp(secret, code)) {
      const nextAttempt = setups[0].attempt_count + 1;
      await client.query(`UPDATE mfa_setup SET attempt_count=$2, expires_at=CASE WHEN $2 >= ${MAX_SETUP_ATTEMPTS} THEN NOW() ELSE expires_at END WHERE user_id=$1`, [userId, nextAttempt]);
      return { status: nextAttempt >= MAX_SETUP_ATTEMPTS ? 'locked' : 'invalid' };
    }
    const recoveryCodes = generateRecoveryCodes();
    await client.query('INSERT INTO user_mfa (user_id, secret_ciphertext) VALUES ($1,$2)', [userId, setups[0].secret_ciphertext]);
    await client.query('DELETE FROM mfa_recovery_codes WHERE user_id=$1', [userId]);
    for (const recoveryCode of recoveryCodes) await client.query('INSERT INTO mfa_recovery_codes (code_hash, user_id) VALUES ($1,$2)', [hashRecoveryCode(recoveryCode), userId]);
    await client.query('DELETE FROM mfa_setup WHERE user_id=$1', [userId]);
    return { status: 'ok', recoveryCodes };
  });
}

export async function createMfaChallenge(userId, loginKey) {
  const token = randomBytes(32).toString('hex');
  await pool.query('DELETE FROM mfa_challenges WHERE user_id=$1', [userId]);
  await pool.query(`INSERT INTO mfa_challenges (token_hash, user_id, login_key, expires_at)
    VALUES ($1,$2,$3,NOW() + INTERVAL '5 minutes')`, [digest(token), userId, loginKey]);
  return token;
}

export async function verifyMfaChallenge(token, code) {
  if (!/^[a-f0-9]{64}$/.test(String(token || ''))) return { status: 'invalid' };
  return inTransaction(async client => {
    const { rows: challenges } = await client.query(`SELECT user_id, login_key, attempt_count
      FROM mfa_challenges WHERE token_hash=$1 AND used_at IS NULL AND expires_at > NOW() FOR UPDATE`, [digest(token)]);
    const challenge = challenges[0];
    if (!challenge) return { status: 'invalid' };
    if (challenge.attempt_count >= MAX_CHALLENGE_ATTEMPTS) {
      await client.query('UPDATE mfa_challenges SET used_at=NOW() WHERE token_hash=$1', [digest(token)]);
      return { status: 'invalid', loginKey: challenge.login_key, locked: true };
    }
    const { rows: secrets } = await client.query('SELECT secret_ciphertext FROM user_mfa WHERE user_id=$1', [challenge.user_id]);
    let valid = secrets[0] ? verifyTotp(decryptMfaSecret(secrets[0].secret_ciphertext), code) : false;
    if (!valid) {
      const recoveryHash = hashRecoveryCode(code);
      if (recoveryHash) {
        const { rowCount } = await client.query(`UPDATE mfa_recovery_codes SET used_at=NOW()
          WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL`, [challenge.user_id, recoveryHash]);
        valid = rowCount === 1;
      }
    }
    if (valid) {
      await client.query('UPDATE mfa_challenges SET used_at=NOW() WHERE token_hash=$1', [digest(token)]);
      return { status: 'ok', userId: challenge.user_id, loginKey: challenge.login_key };
    }
    const nextAttempt = challenge.attempt_count + 1;
    await client.query(`UPDATE mfa_challenges SET attempt_count=$2, used_at=CASE WHEN $2 >= ${MAX_CHALLENGE_ATTEMPTS} THEN NOW() ELSE used_at END WHERE token_hash=$1`, [digest(token), nextAttempt]);
    return { status: 'invalid', loginKey: challenge.login_key, locked: nextAttempt >= MAX_CHALLENGE_ATTEMPTS };
  });
}

export async function getMfaStatus(userId) {
  const { rows } = await pool.query(`SELECT EXISTS(SELECT 1 FROM user_mfa WHERE user_id=$1) AS enabled,
    (SELECT COUNT(*)::int FROM mfa_recovery_codes WHERE user_id=$1 AND used_at IS NULL) AS "recoveryCodesRemaining"`, [userId]);
  return rows[0];
}

async function verifyMfaCode(client, userId, code) {
  const { rows: secrets } = await client.query('SELECT secret_ciphertext FROM user_mfa WHERE user_id=$1 FOR UPDATE', [userId]);
  if (!secrets[0]) return false;
  if (verifyTotp(decryptMfaSecret(secrets[0].secret_ciphertext), code)) return true;
  const recoveryHash = hashRecoveryCode(code);
  if (!recoveryHash) return false;
  const { rowCount } = await client.query(`UPDATE mfa_recovery_codes SET used_at=NOW()
    WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL`, [userId, recoveryHash]);
  return rowCount === 1;
}

export async function rotateRecoveryCodes(userId, code) {
  return inTransaction(async client => {
    if (!await verifyMfaCode(client, userId, code)) return null;
    const recoveryCodes = generateRecoveryCodes();
    await client.query('DELETE FROM mfa_recovery_codes WHERE user_id=$1', [userId]);
    for (const recoveryCode of recoveryCodes) await client.query('INSERT INTO mfa_recovery_codes (code_hash, user_id) VALUES ($1,$2)', [hashRecoveryCode(recoveryCode), userId]);
    return recoveryCodes;
  });
}

export async function disableMfa(userId, code) {
  return inTransaction(async client => {
    if (!await verifyMfaCode(client, userId, code)) return false;
    await client.query('DELETE FROM mfa_challenges WHERE user_id=$1', [userId]);
    await client.query('DELETE FROM mfa_setup WHERE user_id=$1', [userId]);
    await client.query('DELETE FROM user_mfa WHERE user_id=$1', [userId]);
    await client.query('DELETE FROM mfa_recovery_codes WHERE user_id=$1', [userId]);
    return true;
  });
}
