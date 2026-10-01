import test from 'node:test';
import assert from 'node:assert/strict';
import { InputError, normalizeProductPayload, normalizeProductVariantUpdatePayload, parseVariantId, wildcardSearchTerm } from './input-validation.js';

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
  assert.throws(() => normalizeProductPayload({ name: 'Shirt', variants: [{ size: 'M', color: 'Unspecified', sku: 'A', priceCents: 1 }] }), /color must be specified/);
});

test('search and variant identifiers are bounded at the API boundary', () => {
  assert.equal(wildcardSearchTerm(' shirt '), '%shirt%');
  assert.equal(wildcardSearchTerm('%_'), '%\\%\\_%');
  assert.throws(() => wildcardSearchTerm('x'.repeat(201)), InputError);
  assert.equal(parseVariantId('42'), '42');
  assert.throws(() => parseVariantId('0'), InputError);
  assert.throws(() => parseVariantId('4.2'), InputError);
});

test('product variant updates require a reason and absolute stock values', () => {
  assert.deepEqual(normalizeProductVariantUpdatePayload({ reason: 'Counted stock', variants: [{ id: 41, color: 'Black', priceCents: 85000, quantity: 9, expectedQuantity: 4 }] }), {
    reason: 'Counted stock',
    variants: [{ id: '41', color: 'Black', priceCents: 85000, quantity: 9, expectedQuantity: 4 }]
  });
  assert.throws(() => normalizeProductVariantUpdatePayload({ reason: 'Counted stock', variants: [{ id: '41', color: 'Unspecified', priceCents: 85000, quantity: 9, expectedQuantity: 4 }] }), /color must be specified/);
  assert.throws(() => normalizeProductVariantUpdatePayload({ variants: [{ id: '41', color: 'Black', priceCents: 85000, quantity: 9, expectedQuantity: 4 }] }), /reason/);
  assert.throws(() => normalizeProductVariantUpdatePayload({ reason: 'Counted stock', variants: [{ id: '41', color: 'Black', priceCents: 85000, quantity: -1, expectedQuantity: 4 }] }), /whole number/);
});
