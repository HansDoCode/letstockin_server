import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSale, priceLine } from './sale-validation.js';

test('cash sale validation rejects duplicate variants and unsupported payment', () => {
  const item = { variantId: 11, quantity: 1, discountCents: 0 };
  assert.throws(() => validateSale([item, item], 'cash'), /Duplicate/);
  assert.throws(() => validateSale([{ ...item, variantId: '1e1' }], 'cash'), /Invalid product variant/);
  assert.throws(() => validateSale([{ ...item, variantId: 11 }, { ...item, variantId: '11' }], 'cash'), /Duplicate/);
  assert.throws(() => validateSale([item], 'card'), /Only cash/);
  assert.doesNotThrow(() => validateSale([item], 'cash'));
});
test('discounts cannot exceed a line or omit an audit reason', () => {
  assert.deepEqual(priceLine(4900, 2, 900), { gross: 9800, discount: 900, net: 8900 });
  assert.throws(() => priceLine(4900, 1, 5000), /Invalid sale amount/);
  assert.throws(() => validateSale([{ variantId: 11, quantity: 1, discountCents: 100 }], 'cash'), /reason/);
  assert.throws(() => validateSale([{ variantId: 11, quantity: 1, discountCents: 100, discountReason: {} }], 'cash'), /reason/);
});
