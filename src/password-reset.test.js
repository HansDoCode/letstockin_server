import test from 'node:test';
import assert from 'node:assert/strict';

const envKeys = ['NODE_ENV', 'CLIENT_ORIGIN', 'PASSWORD_RESET_DELIVERY_PROVIDER', 'RESEND_API_KEY', 'PASSWORD_RESET_FROM_EMAIL'];
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
process.env.NODE_ENV = 'development';
process.env.CLIENT_ORIGIN = 'https://pos.example.test';
process.env.PASSWORD_RESET_DELIVERY_PROVIDER = 'resend';
process.env.RESEND_API_KEY = 'unit-test-key';
process.env.PASSWORD_RESET_FROM_EMAIL = 'Letstockin <no-reply@example.test>';

const { deliverPasswordReset, PasswordResetDeliveryError } = await import('./password-reset.js');
const originalFetch = globalThis.fetch;

test.after(() => {
  globalThis.fetch = originalFetch;
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

test('Resend delivery sends a reset email payload without following redirects', async () => {
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ id: 'message-id' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  await deliverPasswordReset({ email: 'staff@example.test', name: 'A <B>', url: 'https://pos.example.test/reset-password#token=unit-value', idempotencyKey: 'unit-idempotency-key' });

  assert.equal(request.url, 'https://api.resend.com/emails');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.authorization, 'Bearer unit-test-key');
  assert.equal(request.options.headers['idempotency-key'], 'unit-idempotency-key');
  assert.equal(request.options.redirect, 'error');
  const payload = JSON.parse(request.options.body);
  assert.deepEqual(payload.to, ['staff@example.test']);
  assert.equal(payload.from, 'Letstockin <no-reply@example.test>');
  assert.equal(payload.subject, 'Reset your Letstockin password');
  assert.match(payload.html, /A &lt;B&gt;/);
  assert.match(payload.text, /token=unit-value/);
});

test('Resend delivery exposes only a generic error on provider failure', async () => {
  globalThis.fetch = async () => new Response(null, { status: 500 });

  await assert.rejects(
    deliverPasswordReset({ email: 'staff@example.test', name: 'Staff', url: 'https://pos.example.test/reset-password#token=unit-value' }),
    error => error instanceof PasswordResetDeliveryError && error.message === 'Password reset delivery is unavailable.'
  );
});
