CREATE TABLE IF NOT EXISTS payments (id BIGSERIAL PRIMARY KEY, sale_id BIGINT NOT NULL UNIQUE REFERENCES sales(id), amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0), method TEXT NOT NULL CHECK (method = 'cash'), status TEXT NOT NULL CHECK (status = 'recorded'), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
INSERT INTO payments (sale_id, amount_cents, method, status)
SELECT s.id, s.total_cents, 'cash', 'recorded' FROM sales s
WHERE s.payment_method = 'cash' AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.sale_id = s.id);
