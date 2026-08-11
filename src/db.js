import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL || 'postgres://freshlens:freshlens@127.0.0.1:5432/recipes',
});

export async function query(text, params) {
  return pool.query(text, params);
}
