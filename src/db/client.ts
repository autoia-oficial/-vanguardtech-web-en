import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

if (!process.env.DATABASE_URL) {
  // Failing here is deliberate: a silent fallback to a local database would
  // let a misconfigured deployment look healthy while writing nowhere useful.
  throw new Error(
    'DATABASE_URL is not set. Point it at a PostgreSQL instance (Neon works as-is).',
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Serverless invocations are short-lived; a small pool avoids exhausting
  // the database's connection slots across concurrent functions.
  max: Number(process.env.DATABASE_POOL_MAX ?? 5),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

export const db = drizzle(pool, { schema });

export type DB = typeof db;
