import express from 'express';
import cors from 'cors';
import './config.js';
import { clientOrigin, configurationError, isProduction, trustProxy } from './config.js';
import { pool, inTransaction, databaseConfigError } from './db.js';
import { authenticate, requireRole, verifyPassword, hashPassword, createSession, setSessionCookie, clearSessionCookie } from './auth.js';
import { loginAttemptKey, isLoginBlocked, recordLoginFailure, clearLoginFailures } from './login-rate-limit.js';
import { passwordResetAttemptKey, isPasswordResetBlocked, recordPasswordResetRequest } from './password-reset-rate-limit.js';
import { requestPasswordReset, completePasswordReset } from './password-reset.js';
import { validateSale, priceLine } from './sale-validation.js';
import { returnAmount } from './return-validation.js';
import { InputError, normalizeProductPayload, parseVariantId, wildcardSearchTerm, POSTGRES_INT_MAX } from './input-validation.js';

const app = express();
app.set('trust proxy', trustProxy);
app.use(cors({ origin: clientOrigin || false, credentials: true }));
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.set({
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY'
  });
  if (isProduction) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.headers.origin && req.headers.origin !== clientOrigin) return res.status(403).json({ error: 'Origin not allowed.' });
  next();
});
async function limitLogin(req, res, next) {
  const email = String(req.body?.email || '').trim().toLowerCase();
  req.loginKey = loginAttemptKey(req.ip, email);
  try {
    if (await isLoginBlocked(req.loginKey)) {
      res.set('Retry-After', '900');
      return res.status(429).json({ error: 'Too many sign-in attempts. Try again later.' });
    }
    next();
  } catch (error) { next(error); }
}

async function limitPasswordReset(req, res, next) {
  const email = String(req.body?.email || '').trim().toLowerCase();
  req.passwordResetKey = passwordResetAttemptKey(req.ip, email);
  try {
    if (await isPasswordResetBlocked(req.passwordResetKey)) {
      res.set('Retry-After', '900');
      return res.status(429).json({ error: 'Too many reset requests. Try again later.' });
    }
    await recordPasswordResetRequest(req.passwordResetKey);
    next();
  } catch (error) { next(error); }
}

app.post('/api/auth/login', limitLogin, async (req, res, next) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = req.body?.password;
  if (!email || typeof password !== 'string') return res.status(400).json({ error: 'Email and password are required.' });
  try {
    const { rows } = await pool.query('SELECT id, name, email, role, password_hash FROM users WHERE lower(email)=$1', [email]);
    const user = rows[0];
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      await recordLoginFailure(req.loginKey);
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    await clearLoginFailures(req.loginKey);
    setSessionCookie(res, await createSession(user.id));
    res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
  } catch (error) { next(error); }
});
app.post('/api/auth/password-reset/request', limitPasswordReset, async (req, res, next) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 320) return res.status(400).json({ error: 'A valid email address is required.' });
  try {
    const result = await requestPasswordReset(email);
    if (result.deliveryFailed) console.error('Password reset delivery failed.');
    res.status(202).json({ message: 'If an account matches that email, a reset link will be sent shortly.' });
  } catch (error) { next(error); }
});
app.post('/api/auth/password-reset/complete', async (req, res, next) => {
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  const newPassword = req.body?.password;
  if (!/^[a-f0-9]{64}$/.test(token) || typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 256) return res.status(400).json({ error: 'A valid reset token and a 12–256 character password are required.' });
  try {
    if (!await completePasswordReset(token, newPassword)) return res.status(400).json({ error: 'This reset link is invalid or expired.' });
    clearSessionCookie(res);
    res.json({ ok: true, message: 'Password updated. Sign in with your new password.' });
  } catch (error) { next(error); }
});
app.get('/api/auth/me', authenticate, (req, res) => res.json(req.user));
app.post('/api/auth/logout', authenticate, async (req, res, next) => {
  try { await pool.query('DELETE FROM sessions WHERE token_hash=$1', [req.sessionHash]); clearSessionCookie(res); res.json({ ok: true }); } catch (error) { next(error); }
});

app.get('/api/health', async (_req, res, next) => {
  if (databaseConfigError || configurationError) return res.status(503).json({ error: 'Server configuration is invalid.' });
  try { await pool.query('SELECT 1'); res.json({ ok: true }); } catch (_error) { res.status(503).json({ error: 'Database is unavailable.' }); }
});

app.get('/api/products', requireRole('staff', 'admin'), async (req, res, next) => {
  let term;
  try { term = wildcardSearchTerm(req.query.q); } catch (error) { return res.status(400).json({ error: error.message }); }
  const requestedStatus = req.query.status === undefined ? 'active' : req.query.status;
  if (typeof requestedStatus !== 'string' || !['active', 'archived', 'all'].includes(requestedStatus)) return res.status(400).json({ error: 'Status must be active, archived, or all.' });
  if (requestedStatus !== 'active' && req.user.role !== 'admin') return res.status(403).json({ error: 'Insufficient permissions.' });
  const statusClause = requestedStatus === 'all' ? '' : 'p.status=$2::product_status';
  const params = requestedStatus === 'all' ? [term] : [term, requestedStatus];
  try {
    const { rows } = await pool.query(`
      SELECT p.id, p.name, p.status, p.created_at,
        COALESCE(SUM(i.quantity), 0)::int AS stock,
        json_agg(json_build_object('id', v.id, 'size', v.size, 'sku', v.sku,
          'barcode', v.barcode, 'qrCode', v.qr_code, 'priceCents', v.price_cents,
          'stock', COALESCE(i.quantity, 0), 'reorderPoint', i.reorder_point)
          ORDER BY v.size) FILTER (WHERE v.id IS NOT NULL) AS variants
      FROM products p
      LEFT JOIN product_variants v ON v.product_id = p.id
      LEFT JOIN inventory_levels i ON i.variant_id = v.id
      WHERE ${statusClause ? `${statusClause} AND ` : ''}(p.name ILIKE $1 ESCAPE '\\' OR p.created_at::date::text ILIKE $1 ESCAPE '\\' OR EXISTS (
        SELECT 1 FROM product_variants matched WHERE matched.product_id=p.id
          AND (matched.barcode ILIKE $1 ESCAPE '\\' OR matched.qr_code ILIKE $1 ESCAPE '\\' OR matched.size ILIKE $1 ESCAPE '\\' OR matched.sku ILIKE $1 ESCAPE '\\')))
      GROUP BY p.id
      ORDER BY (COALESCE(SUM(i.quantity), 0) > 0) DESC, p.name ASC`, params);
    res.json(rows);
  } catch (error) { next(error); }
});

app.get('/api/products/lookup/:code', requireRole('staff', 'admin'), async (req, res, next) => {
  const code = typeof req.params.code === 'string' ? req.params.code.trim() : '';
  if (!code || code.length > 200) return res.status(400).json({ error: 'A barcode or QR code is required.' });
  try {
    const { rows } = await pool.query(`SELECT p.id AS product_id, p.name, v.id AS variant_id, v.size, v.price_cents,
      i.quantity FROM product_variants v JOIN products p ON p.id=v.product_id
      JOIN inventory_levels i ON i.variant_id=v.id WHERE p.status='active' AND (v.barcode=$1 OR v.qr_code=$1)`, [code]);
    if (!rows[0]) return res.status(404).json({ error: 'No product matches this barcode or QR code.' });
    res.json(rows[0]);
  } catch (error) { next(error); }
});

app.patch('/api/products/:id/status', requireRole('admin'), async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id) || !Number.isSafeInteger(Number(req.params.id)) || Number(req.params.id) < 1) return res.status(400).json({ error: 'Invalid product ID.' });
  const status = req.body && typeof req.body.status === 'string' ? req.body.status : '';
  if (!['active', 'archived'].includes(status)) return res.status(400).json({ error: 'Status must be active or archived.' });
  try {
    const { rows } = await pool.query('UPDATE products SET status=$1::product_status WHERE id=$2 RETURNING id, name, status, created_at', [status, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Product not found.' });
    res.json(rows[0]);
  } catch (error) { next(error); }
});

app.get('/api/alerts/low-stock', requireRole('admin'), async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT v.id AS "variantId", p.name, v.size, i.quantity, i.reorder_point FROM inventory_levels i
      JOIN product_variants v ON v.id=i.variant_id JOIN products p ON p.id=v.product_id
      WHERE p.status='active' AND i.quantity <= i.reorder_point ORDER BY i.quantity ASC, p.name`);
    res.json(rows);
  } catch (error) { next(error); }
});

app.get('/api/inventory', requireRole('staff', 'admin'), async (req, res, next) => {
  let term;
  try { term = wildcardSearchTerm(req.query.q); } catch (error) { return res.status(400).json({ error: error.message }); }
  try {
    const { rows } = await pool.query(`SELECT p.id AS product_id, p.name, v.id AS variant_id, v.size, v.sku,
      v.barcode, v.qr_code AS "qrCode", v.price_cents AS "priceCents", i.quantity, i.reorder_point AS "reorderPoint",
      i.updated_at AS "updatedAt" FROM products p JOIN product_variants v ON v.product_id=p.id
      JOIN inventory_levels i ON i.variant_id=v.id
      WHERE p.id IN (SELECT match_product.id FROM products match_product JOIN product_variants match_variant ON match_variant.product_id=match_product.id
        WHERE match_product.name ILIKE $1 ESCAPE '\\' OR match_variant.size ILIKE $1 ESCAPE '\\' OR match_variant.barcode ILIKE $1 ESCAPE '\\' OR match_variant.qr_code ILIKE $1 ESCAPE '\\')
      ORDER BY p.name, v.size`, [term]);
    res.json(rows);
  } catch (error) { next(error); }
});

app.post('/api/inventory/:variantId/adjustments', requireRole('admin'), async (req, res, next) => {
  let variantId;
  try { variantId = parseVariantId(req.params.variantId); } catch (error) { return res.status(400).json({ error: error.message }); }
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const delta = body.quantityDelta;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : 'manual_adjustment';
  if (!Number.isSafeInteger(delta) || delta === 0 || Math.abs(delta) > POSTGRES_INT_MAX || !reason || reason.length > 500) return res.status(400).json({ error: 'A non-zero whole quantity and reason of at most 500 characters are required.' });
  try {
    const result = await inTransaction(async (db) => {
      const { rows } = await db.query('SELECT quantity FROM inventory_levels WHERE variant_id=$1 FOR UPDATE', [variantId]);
      if (!rows[0]) throw new Error('Inventory record not found.');
      if (rows[0].quantity + delta < 0) throw new Error('Adjustment would make stock negative.');
      if (rows[0].quantity + delta > POSTGRES_INT_MAX) throw new Error('Adjustment exceeds supported stock limit.');
      const { rows: updated } = await db.query('UPDATE inventory_levels SET quantity=quantity+$1, updated_at=NOW() WHERE variant_id=$2 RETURNING quantity', [delta, variantId]);
      await db.query(`INSERT INTO inventory_movements (variant_id, quantity_delta, reason, reference_type, created_by)
        VALUES ($1,$2,$3,'adjustment',$4)`, [variantId, delta, reason, req.user.id]);
      return updated[0];
    });
    res.json(result);
  } catch (error) {
    if (/^(Inventory record not found|Adjustment would make stock negative|Adjustment exceeds supported stock limit)/.test(error.message)) return res.status(409).json({ error: error.message });
    next(error);
  }
});

app.get('/api/sales', requireRole('admin'), async (req, res, next) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
  try {
    const { rows } = await pool.query(`SELECT s.id, s.created_at AS "createdAt", s.total_cents AS "totalCents",
      s.discount_cents AS "discountCents", s.payment_method AS "paymentMethod", u.name AS "staffName",
      COALESCE(SUM(si.quantity), 0)::int AS "itemCount" FROM sales s LEFT JOIN users u ON u.id=s.staff_id
      LEFT JOIN sale_items si ON si.sale_id=s.id GROUP BY s.id, u.name ORDER BY s.created_at DESC LIMIT $1`, [limit]);
    res.json(rows);
  } catch (error) { next(error); }
});

app.get('/api/reports/overview', requireRole('admin'), async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT
      (COALESCE((SELECT SUM(total_cents) FROM sales WHERE created_at >= date_trunc('day', NOW())), 0)
       - COALESCE((SELECT SUM(refund_cents) FROM sale_returns WHERE created_at >= date_trunc('day', NOW())), 0))::int AS "todaySalesCents",
      COALESCE((SELECT COUNT(*) FROM sales WHERE created_at >= date_trunc('day', NOW())), 0)::int AS "todayOrders",
      COALESCE((SELECT COUNT(*) FROM inventory_levels i JOIN product_variants v ON v.id=i.variant_id JOIN products p ON p.id=v.product_id WHERE p.status='active' AND i.quantity <= i.reorder_point), 0)::int AS "lowStockCount",
      COALESCE((SELECT SUM(quantity) FROM inventory_levels), 0)::int AS "unitsInStock"`);
    res.json(rows[0]);
  } catch (error) { next(error); }
});

app.get('/api/users', requireRole('admin'), async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT id, name, email, role, created_at AS "createdAt" FROM users ORDER BY name`);
    res.json(rows);
  } catch (error) { next(error); }
});

app.post('/api/users', requireRole('admin'), async (req, res, next) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const role = body.role;
  if (!name || name.length > 120 || !/^\S+@\S+\.\S+$/.test(email) || email.length > 320 || !['admin', 'staff'].includes(role)) return res.status(400).json({ error: 'A name, valid email, and role are required.' });
  try {
    if (typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 256) return res.status(400).json({ error: 'Password must be 12–256 characters.' });
    const passwordHash = await hashPassword(body.password);
    const { rows } = await pool.query(`INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4)
      RETURNING id, name, email, role, created_at AS "createdAt"`, [name, email, passwordHash, role]);
    res.status(201).json(rows[0]);
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'An account with that email already exists.' });
    next(error);
  }
});

app.post('/api/products', requireRole('admin'), async (req, res, next) => {
  let payload;
  try { payload = normalizeProductPayload(req.body); } catch (error) {
    if (error instanceof InputError) return res.status(400).json({ error: error.message });
    return next(error);
  }
  try {
    const product = await inTransaction(async (db) => {
      const { rows: products } = await db.query('INSERT INTO products (name) VALUES ($1) RETURNING id, name, status', [payload.name]);
      const product = products[0];
      for (const entry of payload.variants) {
        const { size, sku, barcode, qrCode, priceCents, quantity, reorderPoint } = entry;
        const { rows: saved } = await db.query(`INSERT INTO product_variants (product_id, size, sku, barcode, qr_code, price_cents)
          VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [product.id, size, sku, barcode, qrCode, priceCents]);
        await db.query('INSERT INTO inventory_levels (variant_id, quantity, reorder_point) VALUES ($1,$2,$3)', [saved[0].id, quantity, reorderPoint]);
        if (quantity) await db.query(`INSERT INTO inventory_movements (variant_id, quantity_delta, reason, reference_type, created_by)
          VALUES ($1,$2,'opening_stock','product',$3)`, [saved[0].id, quantity, req.user.id]);
      }
      return product;
    });
    res.status(201).json(product);
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'SKU, barcode, or QR code already exists.' });
    next(error);
  }
});

app.post('/api/sales', requireRole('staff', 'admin'), async (req, res, next) => {
  const { items, paymentMethod = 'cash' } = req.body || {};
  try { validateSale(items, paymentMethod); } catch (error) { return res.status(400).json({ error: error.message }); }
  try {
    const sale = await inTransaction(async (db) => {
      let subtotal = 0; let discountTotal = 0; const lines = [];
      for (const item of [...items].sort((a, b) => Number(a.variantId) - Number(b.variantId))) {
        const quantity = item.quantity;
        const { rows: variants } = await db.query(`SELECT v.id, v.price_cents, i.quantity FROM product_variants v
          JOIN products p ON p.id=v.product_id JOIN inventory_levels i ON i.variant_id=v.id
          WHERE v.id=$1 AND p.status='active' FOR SHARE OF p FOR UPDATE OF i`, [item.variantId]);
        const variant = variants[0];
        if (!variant) throw new Error('Product variant not found.');
        if (variant.quantity < quantity) throw new Error('Insufficient stock for an item.');
        const { gross, discount, net } = priceLine(variant.price_cents, quantity, item.discountCents ?? 0);
        subtotal += gross; discountTotal += discount;
        if (subtotal > 2147483647) throw new Error('Sale amount exceeds supported limit.');
        lines.push({ variant, quantity, gross, discount, net, reason: typeof item.discountReason === 'string' ? item.discountReason.trim() || null : null });
      }
      const { rows: sales } = await db.query(`INSERT INTO sales (staff_id, subtotal_cents, discount_cents, total_cents, payment_method)
        VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at, total_cents`, [req.user.id, subtotal, discountTotal, subtotal - discountTotal, paymentMethod]);
      for (const line of lines) {
        await db.query(`INSERT INTO sale_items (sale_id, variant_id, quantity, unit_price_cents, discount_cents, total_cents, discount_reason)
          VALUES ($1,$2,$3,$4,$5,$6,$7)`, [sales[0].id, line.variant.id, line.quantity, line.variant.price_cents, line.discount, line.net, line.reason]);
        await db.query('UPDATE inventory_levels SET quantity=quantity-$1, updated_at=NOW() WHERE variant_id=$2', [line.quantity, line.variant.id]);
        await db.query(`INSERT INTO inventory_movements (variant_id, quantity_delta, reason, reference_type, reference_id, created_by)
          VALUES ($1,$2,'sale','sale',$3,$4)`, [line.variant.id, -line.quantity, sales[0].id, req.user.id]);
      }
      await db.query("INSERT INTO payments (sale_id, amount_cents, method, status) VALUES ($1,$2,'cash','recorded')", [sales[0].id, subtotal - discountTotal]);
      return sales[0];
    });
    res.status(201).json(sale);
  } catch (error) {
    if (/^(Insufficient stock|Product variant not found|Invalid sale amount|Sale amount exceeds)/.test(error.message)) return res.status(409).json({ error: error.message });
    next(error);
  }
});

app.get('/api/sales/:id/receipt', requireRole('staff', 'admin'), async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid sale ID.' });
  try {
    const { rows: sales } = await pool.query(`SELECT s.id, s.created_at AS "createdAt", s.staff_id AS "staffId", u.name AS "staffName", s.subtotal_cents AS "subtotalCents", s.discount_cents AS "discountCents", s.total_cents AS "totalCents", p.method AS "paymentMethod", p.status AS "paymentStatus" FROM sales s JOIN users u ON u.id=s.staff_id JOIN payments p ON p.sale_id=s.id WHERE s.id=$1`, [req.params.id]);
    const sale = sales[0];
    if (!sale || (req.user.role !== 'admin' && String(sale.staffId) !== String(req.user.id))) return res.status(404).json({ error: 'Sale not found.' });
    const { rows: items } = await pool.query(`SELECT si.id, pr.name, v.size, si.quantity, si.unit_price_cents AS "unitPriceCents", si.discount_cents AS "discountCents", si.total_cents AS "totalCents", si.discount_reason AS "discountReason", COALESCE(r.returned_quantity,0)::int AS "returnedQuantity", COALESCE(r.refunded_cents,0)::int AS "refundedCents" FROM sale_items si JOIN product_variants v ON v.id=si.variant_id JOIN products pr ON pr.id=v.product_id LEFT JOIN (SELECT sale_item_id, SUM(quantity) returned_quantity, SUM(refund_cents) refunded_cents FROM sale_returns GROUP BY sale_item_id) r ON r.sale_item_id=si.id WHERE si.sale_id=$1 ORDER BY si.id`, [req.params.id]);
    res.json({ ...sale, items });
  } catch (error) { next(error); }
});

app.post('/api/sales/:id/returns', requireRole('admin'), async (req, res, next) => {
  const saleId = req.params.id; const itemId = req.body?.saleItemId; const quantity = req.body?.quantity;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (!/^\d+$/.test(saleId) || !Number.isSafeInteger(itemId) || !Number.isSafeInteger(quantity) || quantity < 1 || !reason || reason.length > 500) return res.status(400).json({ error: 'Sale item, positive quantity, and reason are required.' });
  try {
    const result = await inTransaction(async (db) => {
      const { rows: lines } = await db.query('SELECT id, variant_id, quantity, total_cents FROM sale_items WHERE id=$1 AND sale_id=$2 FOR UPDATE', [itemId, saleId]);
      const line = lines[0];
      if (!line) throw new Error('Sale item not found.');
      const { rows: prior } = await db.query('SELECT COALESCE(SUM(quantity),0)::int AS quantity, COALESCE(SUM(refund_cents),0)::int AS refund_cents FROM sale_returns WHERE sale_item_id=$1', [itemId]);
      const refundCents = returnAmount(line.total_cents, line.quantity, quantity, prior[0].quantity, prior[0].refund_cents);
      const { rows: inventory } = await db.query('SELECT quantity FROM inventory_levels WHERE variant_id=$1 FOR UPDATE', [line.variant_id]);
      if (!inventory[0]) throw new Error('Inventory record not found.');
      if (inventory[0].quantity > POSTGRES_INT_MAX - quantity) throw new Error('Return exceeds supported stock limit.');
      const restored = await db.query('UPDATE inventory_levels SET quantity=quantity+$1, updated_at=NOW() WHERE variant_id=$2', [quantity, line.variant_id]);
      if (restored.rowCount !== 1) throw new Error('Inventory record not found.');
      const { rows: returned } = await db.query('INSERT INTO sale_returns (sale_id, sale_item_id, quantity, refund_cents, reason, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, quantity, refund_cents AS "refundCents", created_at AS "createdAt"', [saleId, itemId, quantity, refundCents, reason, req.user.id]);
      await db.query("INSERT INTO inventory_movements (variant_id, quantity_delta, reason, reference_type, reference_id, created_by) VALUES ($1,$2,$3,'return',$4,$5)", [line.variant_id, quantity, reason, returned[0].id, req.user.id]);
      return returned[0];
    });
    res.status(201).json(result);
  } catch (error) {
    if (/^(Sale item not found|Inventory record not found|Invalid return quantity|Return exceeds supported stock limit)/.test(error.message)) return res.status(409).json({ error: error.message });
    next(error);
  }
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
app.use((error, _req, res, _next) => {
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) return res.status(400).json({ error: 'Request body must be valid JSON.' });
  console.error(error);
  res.status(500).json({ error: 'Request could not be completed.' });
});
export default app;
if (process.env.NODE_ENV !== 'test') app.listen(process.env.PORT || 3001, () => console.log('API ready'));
