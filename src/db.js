import pg from 'pg';

const { Pool } = pg;

function encodePwd(password) {
  return encodeURIComponent(password ?? '');
}

/**
 * Prefer DATABASE_URL. Else build from discrete TrueNAS-friendly vars:
 *   POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB
 */
export function resolveDatabaseUrl() {
  const direct = process.env.DATABASE_URL?.trim();
  if (direct) return { url: direct, source: 'DATABASE_URL' };

  const host = process.env.POSTGRES_HOST?.trim();
  const user = process.env.POSTGRES_USER?.trim();
  const password = process.env.POSTGRES_PASSWORD ?? '';
  const database = process.env.POSTGRES_DB?.trim() || 'recipes';
  const port = process.env.POSTGRES_PORT?.trim() || '5432';

  if (host && user) {
    return {
      url: `postgres://${encodeURIComponent(user)}:${encodePwd(password)}@${host}:${port}/${database}`,
      source: 'POSTGRES_*',
    };
  }

  return {
    url: 'postgres://freshlens:freshlens@127.0.0.1:5432/recipes',
    source: 'default-localhost',
  };
}

const resolved = resolveDatabaseUrl();
if (resolved.source === 'default-localhost') {
  console.warn(
    '[db] No DATABASE_URL or POSTGRES_HOST set — using 127.0.0.1 (will fail on TrueNAS).',
  );
} else {
  console.log(`[db] Using connection from ${resolved.source}`);
}

export const pool = new Pool({
  connectionString: resolved.url,
});

export async function query(text, params) {
  return pool.query(text, params);
}
