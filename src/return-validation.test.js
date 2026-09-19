import test from 'node:test';
import assert from 'node:assert/strict';
import { returnAmount } from './return-validation.js';

test('partial cash refunds reconcile the exact paid amount', () => {
  assert.equal(returnAmount(1000, 3, 1, 0, 0), 333);
  assert.equal(returnAmount(1000, 3, 1, 1, 333), 333);
  assert.equal(returnAmount(1000, 3, 1, 2, 666), 334);
});
test('returns cannot exceed units sold', () => {
  assert.throws(() => returnAmount(1000, 3, 2, 2, 666), /Invalid return/);
});
