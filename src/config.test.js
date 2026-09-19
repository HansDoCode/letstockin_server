import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClientOrigin, parseTrustProxy } from './config.js';

test('client origins are normalized and reject unsafe URL forms', () => {
  assert.equal(parseClientOrigin('https://pos.example.test/'), 'https://pos.example.test');
  assert.equal(parseClientOrigin('https://user:password@pos.example.test'), '');
  assert.equal(parseClientOrigin('https://pos.example.test/?next=elsewhere'), '');
  assert.equal(parseClientOrigin('*'), '');
});

test('trusted proxy configuration supports a hop count or explicit proxy list', () => {
  assert.equal(parseTrustProxy('1'), 1);
  assert.deepEqual(parseTrustProxy('loopback, 10.0.0.0/8'), ['loopback', '10.0.0.0/8']);
  assert.equal(parseTrustProxy(''), false);
  assert.equal(parseTrustProxy('false'), false);
});
