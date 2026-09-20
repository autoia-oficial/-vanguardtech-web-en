import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://vanguard:vanguard@127.0.0.1:5432/vanguard_crm',
  },
  strict: true,
  verbose: true,
});
