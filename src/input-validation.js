export const POSTGRES_INT_MAX = 2147483647;

export class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InputError';
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredText(value, label, maxLength) {
  if (typeof value !== 'string') throw new InputError(`${label} is required.`);
  const text = value.trim();
  if (!text || text.length > maxLength) throw new InputError(`${label} is required and must be at most ${maxLength} characters.`);
  return text;
}

function optionalText(value, label, maxLength) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new InputError(`${label} must be text.`);
  const text = value.trim();
  if (text.length > maxLength) throw new InputError(`${label} must be at most ${maxLength} characters.`);
  return text || null;
}

function integer(value, label, { defaultValue, min = 0, max = POSTGRES_INT_MAX } = {}) {
  const candidate = value === undefined && defaultValue !== undefined ? defaultValue : value;
  if (!Number.isSafeInteger(candidate) || candidate < min || candidate > max) {
    throw new InputError(`${label} must be a whole number from ${min} to ${max}.`);
  }
  return candidate;
}

export function wildcardSearchTerm(value) {
  if (value === undefined) return '%%';
  if (typeof value !== 'string' || value.length > 200) throw new InputError('Search query must be at most 200 characters.');
  const escaped = value.trim().replace(/[\\%_]/g, character => `\\${character}`);
  return `%${escaped}%`;
}

export function normalizeProductPayload(body) {
  if (!isObject(body)) throw new InputError('A product name and at least one size variant are required.');
  const name = requiredText(body.name, 'Product name', 200);
  if (!Array.isArray(body.variants) || body.variants.length < 1 || body.variants.length > 100) {
    throw new InputError('A product must contain 1–100 size variants.');
  }
  const sizes = new Set();
  const variants = body.variants.map((entry, index) => {
    if (!isObject(entry)) throw new InputError(`Variant ${index + 1} is invalid.`);
    const size = requiredText(entry.size, `Variant ${index + 1} size`, 50);
    const sizeKey = size.toLocaleLowerCase('en-US');
    if (sizes.has(sizeKey)) throw new InputError(`Variant sizes must be unique (${size}).`);
    sizes.add(sizeKey);
    return {
      size,
      sku: requiredText(entry.sku, `Variant ${index + 1} SKU`, 100),
      barcode: optionalText(entry.barcode, `Variant ${index + 1} barcode`, 200),
      qrCode: optionalText(entry.qrCode, `Variant ${index + 1} QR code`, 200),
      priceCents: integer(entry.priceCents, `Variant ${index + 1} price`, { min: 0 }),
      quantity: integer(entry.quantity, `Variant ${index + 1} quantity`, { defaultValue: 0 }),
      reorderPoint: integer(entry.reorderPoint, `Variant ${index + 1} reorder point`, { defaultValue: 0 })
    };
  });
  return { name, variants };
}

export function parseVariantId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new InputError('Invalid product variant ID.');
  }
  return value;
}
