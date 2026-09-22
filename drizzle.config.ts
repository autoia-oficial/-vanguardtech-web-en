/**
 * drizzle-kit reads .env, but not .env.local — which is the file this project
 * actually keeps the connection string in. Without this import, `db:migrate`
 * resolved DATABASE_URL to undefined and fell through to a hardcoded default,
 * so it cheerfully reported "migrations applied successfully" against a
 * database nobody asked for while the real one stayed empty. The app then
 * failed with a missing-table error that pointed straight back at a migration
 * that had supposedly just succeeded.
 *
 * There is deliberately no fallback now: a misconfigured environment must
 * fail loudly rather than write somewhere plausible.
 */
import './scripts/load-env';
import { defineConfig } from 'drizzle-kit';

const url = process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    'DATABASE_URL is not set. Put it in .env.local (or pass it inline) before running drizzle-kit.\n' +
      'Run `npm run db:check` for a full diagnosis.',
  );
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
