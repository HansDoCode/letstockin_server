import test from 'node:test';
import assert from 'node:assert/strict';

process.env.MFA_ENCRYPTION_KEY = 'unit-test-mfa-key-that-is-not-production';

const { createOtpAuthUrl, decryptMfaSecret, encryptMfaSecret, generateRecoveryCodes, generateTotpSecret, hashRecoveryCode, totpCode, verifyTotp } = await import('./mfa.js');

test('TOTP matches RFC 6238 SHA-1 vectors and accepts small clock drift', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const vectors = [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037']];
  for (const [timestamp, expectedEightDigitCode] of vectors) assert.equal(totpCode(secret, timestamp * 1000).slice(-6), expectedEightDigitCode.slice(-6));
  const now = 1700000000000;
  assert.equal(verifyTotp(secret, totpCode(secret, now), now), true);
  assert.equal(verifyTotp(secret, totpCode(secret, now - 30000), now), true);
  assert.equal(verifyTotp(secret, '000000', now), false);
});

test('MFA secrets encrypt/decrypt and recovery codes are one-time-shaped', () => {
  const secret = generateTotpSecret();
  assert.equal(decryptMfaSecret(encryptMfaSecret(secret)), secret);
  const recoveryCodes = generateRecoveryCodes();
  assert.equal(recoveryCodes.length, 10);
  assert.equal(new Set(recoveryCodes).size, 10);
  assert.equal(hashRecoveryCode(recoveryCodes[0]), hashRecoveryCode(recoveryCodes[0].replaceAll('-', '')));
  assert.equal(hashRecoveryCode('not-a-recovery-code'), '');
  assert.match(createOtpAuthUrl('staff@example.test', secret), /^otpauth:\/\/totp\//);
});
