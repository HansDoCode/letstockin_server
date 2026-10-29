import test from 'node:test';
import assert from 'node:assert/strict';

const envKeys = ['NODE_ENV', 'CLIENT_ORIGIN', 'PASSWORD_RESET_DELIVERY_PROVIDER', 'BREVO_API_KEY', 'PASSWORD_RESET_FROM_EMAIL'];
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
process.env.NODE_ENV = 'development';
process.env.CLIENT_ORIGIN = 'https://pos.example.test';
process.env.PASSWORD_RESET_DELIVERY_PROVIDER = 'brevo';
process.env.BREVO_API_KEY = 'unit-test-key';
process.env.PASSWORD_RESET_FROM_EMAIL = "Let'StockIn <no-reply@example.test>";

const { deliverPasswordReset, PasswordResetDeliveryError } = await import('./password-reset.js');
const originalFetch = globalThis.fetch;

test.after(() => {
  globalThis.fetch = originalFetch;
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

test('Brevo delivery sends a reset email payload without following redirects', async () => {
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ id: 'message-id' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  await deliverPasswordReset({ email: 'staff@example.test', name: 'A <B>', url: 'https://pos.example.test/reset-password#token=unit-value', idempotencyKey: '123e4567-e89b-12d3-a456-426614174000' });

  assert.equal(request.url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers['api-key'], 'unit-test-key');
  assert.equal(request.options.headers.accept, 'application/json');
  assert.equal(request.options.redirect, 'error');
  const payload = JSON.parse(request.options.body);
  assert.deepEqual(payload.to, [{ email: 'staff@example.test', name: 'A <B>' }]);
  assert.deepEqual(payload.sender, { name: "Let'StockIn", email: 'no-reply@example.test' });
  assert.equal(payload.headers.idempotencyKey, '123e4567-e89b-12d3-a456-426614174000');
  assert.equal(payload.subject, "Reset your Let'StockIn password");
  assert.match(payload.htmlContent, /A &lt;B&gt;/);
  assert.match(payload.textContent, /token=unit-value/);
});

test('Brevo delivery exposes only a generic error on provider failure', async () => {
  globalThis.fetch = async () => new Response(null, { status: 500 });

  await assert.rejects(
    deliverPasswordReset({ email: 'staff@example.test', name: 'Staff', url: 'https://pos.example.test/reset-password#token=unit-value' }),
    error => error instanceof PasswordResetDeliveryError
      && error.message === 'Password reset delivery is unavailable.'
      && error.status === 500
      && error.code === null
  );
});

test('Brevo delivery keeps only a safe provider error code', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ code: 'invalid_parameter', message: 'recipient details omitted' }), { status: 400 });

  await assert.rejects(
    deliverPasswordReset({ email: 'staff@example.test', name: 'Staff', url: 'https://pos.example.test/reset-password#token=unit-value' }),
    error => error instanceof PasswordResetDeliveryError
      && error.status === 400
      && error.code === 'invalid_parameter'
      && error.message === 'Password reset delivery is unavailable.'
  );
});
