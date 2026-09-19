import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import './config.js';

const testUrl = process.env.TEST_DATABASE_URL;
let databaseName = '';
try { databaseName = testUrl ? new URL(testUrl).pathname.slice(1) : ''; } catch { /* The test is skipped below when the URL is not usable. */ }
const schemaIsolation = process.env.TEST_DATABASE_SCHEMA_ISOLATION === 'true';
const safeDatabase = /test/i.test(databaseName) || schemaIsolation;

test('API/database sales, adjustments, returns, permissions, and lookup', { skip: !testUrl || !safeDatabase ? 'Set TEST_DATABASE_URL to a dedicated test database, or explicitly enable TEST_DATABASE_SCHEMA_ISOLATION=true for an isolated test database/project.' : false }, async () => {
  const schema = `letstockin_test_${process.pid}_${Date.now()}`;
  const owner = new pg.Client({ connectionString: testUrl, connectionTimeoutMillis: 5000 });
  await owner.connect();
  let server;
  let pool;
  try {
    await owner.query(`CREATE SCHEMA "${schema}"`);
    await owner.query(`SET search_path TO "${schema}"`);
    await owner.query(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
    for (const migration of ['001_sessions.sql', '002_payments.sql', '003_returns.sql', '004_product_status.sql', '005_login_attempts.sql', '006_password_resets.sql']) {
      await owner.query(await readFile(new URL(`../db/migrations/${migration}`, import.meta.url), 'utf8'));
    }
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = testUrl;
    process.env.DATABASE_SCHEMA = schema;
    const [{ default: app }, { pool: appPool }, { hashPassword }, { getTestPasswordResetDelivery }] = await Promise.all([
      import('./index.js'), import('./db.js'), import('./auth.js'), import('./password-reset.js')
    ]);
    pool = appPool;
    const password = 'integration-test-password';
    const passwordHash = await hashPassword(password);
    const admin = (await pool.query("INSERT INTO users (name,email,password_hash,role) VALUES ('Admin','admin@integration.test',$1,'admin') RETURNING id", [passwordHash])).rows[0];
    await pool.query("INSERT INTO users (name,email,password_hash,role) VALUES ('Staff','staff@integration.test',$1,'staff')", [passwordHash]);
    server = app.listen(0);
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    async function call(path, method = 'GET', body, cookie, headers = {}) {
      const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers, ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0], retryAfter: response.headers.get('retry-after') };
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert.equal((await call('/auth/login', 'POST', { email: 'rate-limit@integration.test', password: 'wrong-password' })).status, 401);
    }
    const blockedLogin = await call('/auth/login', 'POST', { email: 'rate-limit@integration.test', password: 'wrong-password' });
    assert.equal(blockedLogin.status, 429);
    assert.equal(blockedLogin.retryAfter, '900');
    const adminLogin = await call('/auth/login', 'POST', { email: 'admin@integration.test', password });
    const staffLogin = await call('/auth/login', 'POST', { email: 'staff@integration.test', password });
    assert.equal(adminLogin.status, 200);
    assert.equal(staffLogin.status, 200);
    const adminCookie = adminLogin.cookie;
    const staffCookie = staffLogin.cookie;
    assert.equal((await call('/api-does-not-exist')).status, 404);
    assert.equal((await call('/inventory')).status, 401);
    assert.equal((await call('/inventory/1/adjustments', 'POST', { quantityDelta: 1, reason: 'count' }, staffCookie)).status, 403);
    assert.equal((await call('/sales/1/returns', 'POST', { saleItemId: 1, quantity: 1, reason: 'return' }, staffCookie)).status, 403);
    assert.equal((await call('/reports/overview', 'GET', undefined, staffCookie)).status, 403);
    assert.equal((await call('/products', 'POST', { name: 'Broken product', variants: [{ size: 'M', sku: 'BAD', priceCents: -1 }] }, adminCookie)).status, 400);
    assert.equal((await call('/users', 'POST', { name: 'No role', email: 'norole@integration.test', password }, adminCookie)).status, 400);

    const created = await call('/products', 'POST', { name: 'Integration Shirt', variants: [
      { size: 'S', sku: `S-${schema}`, barcode: `BAR-${schema}`, qrCode: `QR-${schema}`, priceCents: 1001, quantity: 3, reorderPoint: 1 },
      { size: 'M', sku: `M-${schema}`, barcode: `BAR-M-${schema}`, qrCode: `QR-M-${schema}`, priceCents: 1200, quantity: 2, reorderPoint: 1 }
    ] }, adminCookie);
    assert.equal(created.status, 201);
    const inventory = await call(`/inventory?q=${encodeURIComponent(`QR-${schema}`)}`, 'GET', undefined, staffCookie);
    assert.equal(inventory.status, 200);
    assert.equal(inventory.body.length, 2);
    const productSearch = await call(`/products?q=${encodeURIComponent(`BAR-${schema}`)}`, 'GET', undefined, staffCookie);
    assert.equal(productSearch.body[0].variants.length, 2);
    const small = inventory.body.find(row => row.size === 'S');
    const lookup = await call(`/products/lookup/${encodeURIComponent(`BAR-${schema}`)}`, 'GET', undefined, staffCookie);
    assert.equal(lookup.body.variant_id, small.variant_id);
    assert.equal((await call('/products/lookup/absent', 'GET', undefined, staffCookie)).status, 404);

    const sale = await call('/sales', 'POST', { items: [{ variantId: small.variant_id, quantity: 3, discountCents: 2, discountReason: 'promotion' }], paymentMethod: 'cash' }, staffCookie);
    assert.equal(sale.status, 201);
    assert.equal(sale.body.total_cents, 3001);
    assert.equal((await call('/sales', 'POST', { items: [{ variantId: small.variant_id, quantity: 1 }] }, staffCookie)).status, 409);
    assert.equal((await call('/inventory/1/adjustments', 'POST', { quantityDelta: -1, reason: 'count' }, staffCookie, { 'x-user-role': 'admin' })).status, 403);
    const receipt = await call(`/sales/${sale.body.id}/receipt`, 'GET', undefined, staffCookie);
    assert.equal(receipt.body.items[0].totalCents, 3001);
    const itemId = receipt.body.items[0].id;
    const firstReturn = await call(`/sales/${sale.body.id}/returns`, 'POST', { saleItemId: Number(itemId), quantity: 1, reason: 'size issue' }, adminCookie);
    assert.equal(firstReturn.status, 201);
    assert.equal(firstReturn.body.refundCents, 1000);
    const finalReturn = await call(`/sales/${sale.body.id}/returns`, 'POST', { saleItemId: Number(itemId), quantity: 2, reason: 'size issue' }, adminCookie);
    assert.equal(finalReturn.status, 201);
    assert.equal(finalReturn.body.refundCents, 2001);
    assert.equal((await call(`/sales/${sale.body.id}/returns`, 'POST', { saleItemId: Number(itemId), quantity: 1, reason: 'extra' }, adminCookie)).status, 409);
    const archived = await call(`/products/${created.body.id}/status`, 'PATCH', { status: 'archived' }, adminCookie);
    assert.equal(archived.status, 200);
    assert.equal(archived.body.status, 'archived');
    assert.equal((await call(`/products?q=${encodeURIComponent(`BAR-${schema}`)}`, 'GET', undefined, staffCookie)).body.length, 0);
    assert.equal((await call(`/products/lookup/${encodeURIComponent(`BAR-${schema}`)}`, 'GET', undefined, staffCookie)).status, 404);
    assert.equal((await call('/sales', 'POST', { items: [{ variantId: small.variant_id, quantity: 1 }] }, staffCookie)).status, 409);
    const archivedList = await call('/products?status=archived', 'GET', undefined, adminCookie);
    assert.equal(archivedList.body[0].status, 'archived');
    assert.equal((await call('/products?status=archived', 'GET', undefined, staffCookie)).status, 403);
    const restored = await call(`/products/${created.body.id}/status`, 'PATCH', { status: 'active' }, adminCookie);
    assert.equal(restored.body.status, 'active');
    const adjustment = await call(`/inventory/${small.variant_id}/adjustments`, 'POST', { quantityDelta: -2, reason: 'stock count' }, adminCookie);
    assert.equal(adjustment.status, 200);
    assert.equal(adjustment.body.quantity, 1);
    assert.equal((await call(`/inventory/${small.variant_id}/adjustments`, 'POST', { quantityDelta: -2, reason: 'stock count' }, adminCookie)).status, 409);
    const audit = await pool.query('SELECT quantity_delta, reference_type FROM inventory_movements WHERE variant_id=$1 ORDER BY id', [small.variant_id]);
    assert.deepEqual(audit.rows.map(row => [row.quantity_delta, row.reference_type]), [[3, 'product'], [-3, 'sale'], [1, 'return'], [2, 'return'], [-2, 'adjustment']]);
    const payments = await pool.query('SELECT amount_cents, method FROM payments WHERE sale_id=$1', [sale.body.id]);
    assert.deepEqual(payments.rows[0], { amount_cents: 3001, method: 'cash' });
    const overview = await call('/reports/overview', 'GET', undefined, adminCookie);
    assert.equal(overview.body.todaySalesCents, 0);
    assert.equal((await pool.query('SELECT quantity FROM inventory_levels WHERE variant_id=$1', [small.variant_id])).rows[0].quantity, 1);
    assert.equal((await pool.query('SELECT id FROM users WHERE id=$1', [admin.id])).rowCount, 1);

    const resetRequest = await call('/auth/password-reset/request', 'POST', { email: 'staff@integration.test' });
    assert.equal(resetRequest.status, 202);
    const delivery = getTestPasswordResetDelivery();
    assert.equal(delivery.email, 'staff@integration.test');
    const resetToken = new URL(delivery.resetUrl).hash.slice(1).replace(/^token=/, '');
    assert.match(resetToken, /^[a-f0-9]{64}$/);
    const resetComplete = await call('/auth/password-reset/complete', 'POST', { token: resetToken, password: 'replacement-test-password' });
    assert.equal(resetComplete.status, 200);
    assert.equal((await call('/inventory', 'GET', undefined, staffCookie)).status, 401);
    assert.equal((await call('/auth/login', 'POST', { email: 'staff@integration.test', password })).status, 401);
    assert.equal((await call('/auth/login', 'POST', { email: 'staff@integration.test', password: 'replacement-test-password' })).status, 200);
    assert.equal((await call('/auth/password-reset/complete', 'POST', { token: resetToken, password: 'another-test-password' })).status, 400);
    for (let attempt = 0; attempt < 5; attempt += 1) assert.equal((await call('/auth/password-reset/request', 'POST', { email: 'unknown-reset@integration.test' })).status, 202);
    const blockedReset = await call('/auth/password-reset/request', 'POST', { email: 'unknown-reset@integration.test' });
    assert.equal(blockedReset.status, 429);
    assert.equal(blockedReset.retryAfter, '900');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (pool) await pool.end();
    await owner.query('SET search_path TO public');
    await owner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await owner.end();
  }
});
