/**
 * Loads .env.local the way the app does.
 *
 * Next.js reads .env.local itself, but a standalone `tsx scripts/…` run does
 * not — so a script that imports the database client would throw "DATABASE_URL
 * is not set" even with the file sitting right there. Importing this module
 * first fixes that.
 *
 * It uses Next's own loader rather than a separate dotenv call, so the scripts
 * and the dev server resolve the same files in the same order. Variables
 * already present in the environment win, so
 * `DATABASE_URL=… npm run set-password` still overrides the file.
 */
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production', {
  info: () => {},
  error: (...args: unknown[]) => console.error(...args),
});
