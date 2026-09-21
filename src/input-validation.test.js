import test from 'node:test';
import assert from 'node:assert/strict';
import { InputError, normalizeProductPayload, parseVariantId, wildcardSearchTerm } from './input-validation.js';

test('product payload validation normalizes optional identifiers and defaults stock fields', () => {
  assert.deepEqual(normalizeProductPayload({ name: ' Linen shirt ', variants: [{ size: 'M', color: ' Sand ', sku: 'LS-M', priceCents: 4900 }] }), {
    name: 'Linen shirt',
    variants: [{ size: 'M', color: 'Sand', sku: 'LS-M', barcode: null, qrCode: null, priceCents: 4900, quantity: 0, reorderPoint: 5 }]
  });
});

test('product payload validation rejects malformed and duplicate variants', () => {
  assert.throws(() => normalizeProductPayload(null), InputError);
  assert.throws(() => normalizeProductPayload({ name: 'Shirt', variants: [{ size: 'M', color: 'Blue', sku: 'A', priceCents: 1 }, { size: 'm', color: 'blue', sku: 'B', priceCents: 1 }] }), /unique/);
  assert.throws(() => normalizeProductPayload({ name: 'Shirt', variants: [{ size: 'M', color: 'Blue', sku: 'A', priceCents: -1 }] }), /whole number/);
  assert.throws(() => normalizeProductPayload({ name: 'Shirt', variants: [{ size: 'M', color: 'Blue', sku: 'A', barcode: 'same', priceCents: 1 }, { size: 'L', color: 'Blue', sku: 'B', qrCode: 'same', priceCents: 1 }] }), /unique/);
  assert.throws(() => normalizeProductPayload({ name: 'Shirt', variants: [{ size: 'M', color: 'Blue', sku: 'A', priceCents: 1, reorderPoint: 4 }] }), /from 5/);
});

test('search and variant identifiers are bounded at the API boundary', () => {
  assert.equal(wildcardSearchTerm(' shirt '), '%shirt%');
  assert.equal(wildcardSearchTerm('%_'), '%\\%\\_%');
  assert.throws(() => wildcardSearchTerm('x'.repeat(201)), InputError);
  assert.equal(parseVariantId('42'), '42');
  assert.throws(() => parseVariantId('0'), InputError);
  assert.throws(() => parseVariantId('4.2'), InputError);
});
