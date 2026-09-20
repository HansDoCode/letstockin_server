import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { isProduction } from './config.js';
import { pool } from './db.js';

const scrypt = promisify(scryptCallback);
export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw new Error('Password must be 12–256 characters.');
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${hash.toString('hex')}`;
}
export async function verifyPassword(password, stored) {
  const [method, salt, hex] = String(stored).split(':');
  if (method !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{128}$/.test(hex || '')) return false;
  const actual = await scrypt(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(hex, 'hex'));
}
const digest = token => createHash('sha256').update(token).digest('hex');
export async function createSession(userId) {
  const token = randomBytes(32).toString('hex');
  await pool.query("DELETE FROM sessions WHERE expires_at <= NOW()");
  await pool.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1,$2,NOW() + INTERVAL '7 days')", [digest(token), userId]);
  return token;
}
export const cookieName = 'letstockin_session';
// Production normally reaches Render through the Vercel /api rewrite, making
// the cookie first-party. Partitioned is also enabled as a safe fallback for
// browsers that call the Render origin directly while blocking third-party
// cookies. Exact Origin validation still protects mutating API requests.
export function sessionCookieOptions(production = isProduction) {
  return {
    httpOnly: true,
    secure: production,
    sameSite: production ? 'none' : 'lax',
    ...(production ? { partitioned: true } : {}),
    path: '/'
  };
}
const cookieOptions = sessionCookieOptions();
export function setSessionCookie(res, token) { res.cookie(cookieName, token, { ...cookieOptions, maxAge: 7 * 86400000 }); }
export function clearSessionCookie(res) { res.clearCookie(cookieName, cookieOptions); }
export async function authenticate(req, res, next) {
  try {
    const token = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return res.status(401).json({ error: 'Sign in required.' });
    const { rows } = await pool.query('SELECT u.id, u.name, u.email, u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at > NOW()', [digest(token)]);
    if (!rows[0]) return res.status(401).json({ error: 'Session expired. Sign in again.' });
    req.user = rows[0]; req.sessionHash = digest(token); next();
  } catch (error) { next(error); }
}
export function requireRole(...roles) { return [authenticate, (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Insufficient permissions.' })]; }
