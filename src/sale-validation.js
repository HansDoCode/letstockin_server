export function validateSale(items, paymentMethod) {
  if (paymentMethod !== 'cash') throw new Error('Only cash payments are supported.');
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) throw new Error('Sale requires 1–100 items.');
  const ids = new Set();
  for (const item of items) {
    const rawId = item?.variantId;
    const validId = typeof rawId === 'number'
      ? Number.isSafeInteger(rawId) && rawId >= 1
      : typeof rawId === 'string' && /^[1-9]\d*$/.test(rawId) && Number.isSafeInteger(Number(rawId));
    if (!validId) throw new Error('Invalid product variant.');
    const id = String(Number(rawId));
    if (ids.has(id)) throw new Error('Duplicate product variants in sale.');
    ids.add(id);
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) throw new Error('Invalid quantity.');
    if (!Number.isSafeInteger(item.discountCents ?? 0) || item.discountCents < 0) throw new Error('Invalid item discount.');
    if (item.discountCents && (typeof item.discountReason !== 'string' || !item.discountReason.trim() || item.discountReason.length > 500)) throw new Error('A discount reason is required.');
  }
}

export function priceLine(priceCents, quantity, discountCents = 0) {
  const gross = priceCents * quantity;
  if (!Number.isSafeInteger(gross) || gross > 2147483647 || discountCents > gross) throw new Error('Invalid sale amount.');
  return { gross, discount: discountCents, net: gross - discountCents };
}
