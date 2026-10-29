import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, isStrongPassword, verifyPassword, requireRole, sessionCookieOptions, setSessionCookie } from './auth.js';

test('passwords use salted hashes and reject wrong credentials', async () => {
  const password = 'Correct horse battery1!';
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword('wrong password', first), false);
  assert.equal(await verifyPassword('correct horse battery', 'pending-password-reset'), false);
});

test('password policy requires upper, lower, number, and symbol', () => {
  assert.equal(isStrongPassword('Correct horse battery1!'), true);
  assert.equal(isStrongPassword('Short1!'), false);
  assert.equal(isStrongPassword(`Aa1!${'x'.repeat(46)}`), true);
  assert.equal(isStrongPassword(`Aa1!${'x'.repeat(47)}`), false);
  for (const password of ['lowercasepassword1!', 'UPPERCASEPASSWORD1!', 'NoNumberPassword!', 'NoSymbolPassword1']) {
    assert.equal(isStrongPassword(password), false, password);
  }
});

test('role gate uses authenticated user, not request headers', () => {
  const [, gate] = requireRole('admin');
  let status;
  gate({ user: { role: 'staff' }, headers: { 'x-user-role': 'admin' } }, { status(code) { status = code; return this; }, json() {} }, () => assert.fail('Should deny staff'));
  assert.equal(status, 403);
});

test('session cookies are secure and first-party in production', () => {
  assert.deepEqual(sessionCookieOptions(true), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/'
  });
  assert.deepEqual(sessionCookieOptions(false), {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    path: '/'
  });
});

test('remember me makes the HTTP-only session cookie persistent', () => {
  const cookies = [];
  const response = { cookie: (...args) => cookies.push(args) };
  setSessionCookie(response, 'a'.repeat(64));
  setSessionCookie(response, 'b'.repeat(64), true);
  assert.equal(cookies[0][2].maxAge, undefined);
  assert.equal(cookies[1][2].maxAge, 7 * 86400000);
});
