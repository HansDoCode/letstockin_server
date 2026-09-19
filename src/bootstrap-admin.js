import './config.js';
import { pool } from './db.js';
import { hashPassword } from './auth.js';

function connectionErrorMessage(error) {
  const code = error?.code || error?.errors?.find(entry => entry?.code)?.code;
  if (code === 'ECONNREFUSED') return 'Could not connect to PostgreSQL (ECONNREFUSED). Start PostgreSQL or verify the DATABASE_URL host and port.';
  if (code === 'ENOTFOUND') return 'Could not resolve the DATABASE_URL hostname (ENOTFOUND). Check the database host or network/VPN connection.';
  if (code === '28P01') return 'PostgreSQL rejected the credentials. Check the username and password in DATABASE_URL.';
  return error?.message || 'Admin bootstrap could not be completed.';
}

try {
  const email = String(process.env.BOOTSTRAP_EMAIL || '').trim().toLowerCase();
  const name = String(process.env.BOOTSTRAP_NAME || '').trim();
  if (!/^\S+@\S+\.\S+$/.test(email) || !name) throw new Error('Set BOOTSTRAP_EMAIL and BOOTSTRAP_NAME.');
  const passwordHash = await hashPassword(process.env.BOOTSTRAP_PASSWORD);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE users IN EXCLUSIVE MODE');
    const { rows } = await client.query('SELECT COUNT(*)::int AS count FROM users');
    if (rows[0].count === 0) {
      await client.query('INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,\'admin\')', [name, email, passwordHash]);
    } else {
      const updated = await client.query("UPDATE users SET name=$1, email=$2, password_hash=$3 WHERE role='admin' AND password_hash='replace-with-argon2-hash' AND NOT EXISTS (SELECT 1 FROM users WHERE email=$2 AND password_hash <> 'replace-with-argon2-hash')", [name, email, passwordHash]);
      if (updated.rowCount !== 1) throw new Error('Bootstrap requires an empty users table or one legacy placeholder admin.');
    }
    await client.query('COMMIT');
    console.log(`Created admin ${email}`);
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
} catch (error) { console.error(connectionErrorMessage(error)); process.exitCode = 1; } finally { await pool.end(); }
