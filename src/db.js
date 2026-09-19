import pg from 'pg';
import './config.js';

const databaseUrl = String(process.env.DATABASE_URL || '').trim();
let databaseConfigError = '';
if (!databaseUrl) databaseConfigError = 'missing';
else {
  try {
    const protocol = new URL(databaseUrl).protocol;
    if (!['postgres:', 'postgresql:'].includes(protocol)) databaseConfigError = 'protocol';
  } catch { databaseConfigError = 'format'; }
}
const schema = process.env.DATABASE_SCHEMA;
if (schema && !/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error('Invalid database schema name.');
export { databaseConfigError };
export const pool = new pg.Pool({ connectionString: databaseUrl || undefined, connectionTimeoutMillis: 5000, ...(schema ? { options: `-c search_path=${schema}` } : {}) });

export async function inTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
