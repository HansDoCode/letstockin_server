import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, requireRole, sessionCookieOptions } from './auth.js';

test('passwords use salted hashes and reject wrong credentials', async () => {
  const first = await hashPassword('correct horse battery');
  const second = await hashPassword('correct horse battery');
  assert.notEqual(first, second);
  assert.equal(await verifyPassword('correct horse battery', first), true);
  assert.equal(await verifyPassword('wrong password', first), false);
  assert.equal(await verifyPassword('correct horse battery', 'pending-password-reset'), false);
});

test('role gate uses authenticated user, not request headers', () => {
  const [, gate] = requireRole('admin');
  let status;
  gate({ user: { role: 'staff' }, headers: { 'x-user-role': 'admin' } }, { status(code) { status = code; return this; }, json() {} }, () => assert.fail('Should deny staff'));
  assert.equal(status, 403);
});

test('production session cookies support secure partitioned deployments', () => {
  assert.deepEqual(sessionCookieOptions(true), {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    partitioned: true,
    path: '/'
  });
  assert.deepEqual(sessionCookieOptions(false), {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    path: '/'
  });
});
