import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { googleClientId, googleClientSecret, googleConfigurationError, googleRedirectUri, isProduction } from './config.js';
import { pool } from './db.js';

export const googleStateCookieName = 'letstockin_google_state';
export const googleVerifierCookieName = 'letstockin_google_verifier';

const oauthCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax',
  path: '/api/auth/google',
  maxAge: 10 * 60 * 1000
};

export class GoogleOAuthError extends Error {
  constructor(code) {
    super('Google sign-in could not be completed.');
    this.name = 'GoogleOAuthError';
    this.code = code;
  }
}

export function createGoogleAuthorizationRequest() {
  const state = randomBytes(32).toString('hex');
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: googleClientId,
    redirect_uri: googleRedirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account'
  }).toString();
  return { state, codeVerifier, url: url.toString() };
}

export function setGoogleOAuthCookies(res, state, codeVerifier) {
  res.cookie(googleStateCookieName, state, oauthCookieOptions);
  res.cookie(googleVerifierCookieName, codeVerifier, oauthCookieOptions);
}

export function clearGoogleOAuthCookies(res) {
  const options = { ...oauthCookieOptions };
  delete options.maxAge;
  res.clearCookie(googleStateCookieName, options);
  res.clearCookie(googleVerifierCookieName, options);
}

function readCookie(header, name) {
  const value = String(header || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1) || '';
  try { return decodeURIComponent(value); } catch { return ''; }
}

export function googleOAuthCookies(req) {
  return {
    state: readCookie(req.headers.cookie, googleStateCookieName),
    codeVerifier: readCookie(req.headers.cookie, googleVerifierCookieName)
  };
}

export function matchesGoogleState(expected, actual) {
  if (!/^[a-f0-9]{64}$/.test(expected) || !/^[a-f0-9]{64}$/.test(actual)) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

async function googleRequest(url, options) {
  let response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(5000) });
  } catch {
    throw new GoogleOAuthError('provider');
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new GoogleOAuthError('provider');
  return body;
}

export function normalizeGoogleIdentity(profile) {
  const sub = typeof profile?.sub === 'string' ? profile.sub.trim() : '';
  const email = typeof profile?.email === 'string' ? profile.email.trim().toLowerCase() : '';
  if (!sub || sub.length > 255 || profile?.email_verified !== true || !/^\S+@\S+\.\S+$/.test(email) || email.length > 320) throw new GoogleOAuthError('provider');
  const name = typeof profile.name === 'string' ? profile.name.trim().slice(0, 120) : '';
  return { sub, email, name: name || email.split('@')[0] };
}

export async function exchangeGoogleCode(code, codeVerifier) {
  if (googleConfigurationError || !code || !/^[A-Za-z0-9_-]{43}$/.test(codeVerifier)) throw new GoogleOAuthError('provider');
  const token = await googleRequest('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: googleClientId,
      client_secret: googleClientSecret,
      code,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: googleRedirectUri
    })
  });
  if (typeof token?.access_token !== 'string' || !token.access_token) throw new GoogleOAuthError('provider');
  return normalizeGoogleIdentity(await googleRequest('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { authorization: `Bearer ${token.access_token}` }
  }));
}

export async function findOrLinkGoogleUser(identity) {
  const { rows } = await pool.query(`SELECT id, name, email, role, google_sub AS "googleSub"
    FROM users WHERE active AND (google_sub=$1 OR lower(email)=$2)`, [identity.sub, identity.email]);
  if (rows.length > 1) throw new GoogleOAuthError('account-conflict');
  const user = rows[0];
  if (!user) throw new GoogleOAuthError('not-registered');
  if (user.googleSub && user.googleSub !== identity.sub) throw new GoogleOAuthError('account-conflict');
  if (!user.googleSub) {
    try {
      const { rows: linked } = await pool.query(`UPDATE users SET google_sub=$1 WHERE id=$2 AND google_sub IS NULL
        RETURNING id, name, email, role`, [identity.sub, user.id]);
      if (linked[0]) return linked[0];
      const { rows: current } = await pool.query('SELECT id, name, email, role, google_sub AS "googleSub" FROM users WHERE id=$1', [user.id]);
      if (!current[0] || current[0].googleSub !== identity.sub) throw new GoogleOAuthError('account-conflict');
      return { id: current[0].id, name: current[0].name, email: current[0].email, role: current[0].role };
    } catch (error) {
      if (error instanceof GoogleOAuthError) throw error;
      if (error.code === '23505') throw new GoogleOAuthError('account-conflict');
      throw error;
    }
  }
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}
