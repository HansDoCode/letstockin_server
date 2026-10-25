import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleOAuthError, matchesGoogleState, normalizeGoogleIdentity } from './google-auth.js';

test('Google OAuth state requires the exact one-time value', () => {
  const state = 'a'.repeat(64);
  assert.equal(matchesGoogleState(state, state), true);
  assert.equal(matchesGoogleState(state, `${'a'.repeat(63)}b`), false);
  assert.equal(matchesGoogleState(state, 'short'), false);
});

test('Google identities require a verified, valid email', () => {
  assert.deepEqual(normalizeGoogleIdentity({ sub: 'google-user', email: 'Staff@Example.com', email_verified: true, name: 'Staff' }), {
    sub: 'google-user', email: 'staff@example.com', name: 'Staff'
  });
  assert.throws(() => normalizeGoogleIdentity({ sub: 'google-user', email: 'staff@example.com', email_verified: false }), GoogleOAuthError);
});
