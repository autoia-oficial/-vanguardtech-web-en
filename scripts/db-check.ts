/**
 * Reports the state of the database the app is actually pointed at.
 *
 *   npm run db:check
 *
 * Written because "Request failed (500)" on the login screen turned out to
 * mean "a table is missing", and finding that out took several round trips.
 * This answers, in one command: can it connect, which database is it, and is
 * the schema current. It needs no psql — it uses the same driver the app does.
 */
import './load-env';

/** Every table the code expects. Compared against what is really there. */
const EXPECTED = [
  'users', 'sessions', 'login_attempts',
  'leads', 'audits', 'audit_checks', 'contacts',
  'email_accounts', 'campaigns', 'campaign_leads',
  'emails', 'email_events', 'follow_ups', 'demos',
  'activities', 'automations', 'automation_runs',
  'job_locks', 'errors', 'suppression_list', 'settings',
];

function redact(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '<unparseable DATABASE_URL>';
  }
}

/** The useful message is usually on the innermost cause, not the wrapper. */
function rootMessage(err: unknown): string {
  let node: unknown = err;
  let message = '';
  for (let depth = 0; node && depth < 8; depth++) {
    const o = node as { message?: unknown; cause?: unknown };
    if (typeof o.message === 'string') message = o.message;
    if (o.cause === node) break;
    node = o.cause;
  }
  return message || String(err);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set.');
    console.error('');
    console.error('Copy .env.example to .env.local and put your connection string in it:');
    console.error('');
    console.error('    cp .env.example .env.local');
    console.error('');
    process.exitCode = 1;
    return;
  }

  console.log(`Connection : ${redact(url)}`);

  // Imported here, not at the top: the client throws on a missing
  // DATABASE_URL at module load, which would pre-empt the message above.
  const { sql } = await import('drizzle-orm');
  const { db, pool } = await import('../src/db/client');

  try {
    const who = await db.execute(
      sql`select current_database() as db, current_user as usr, version() as ver`,
    );
    const row = (who.rows?.[0] ?? {}) as Record<string, string>;
    console.log(`Database   : ${row.db}`);
    console.log(`User       : ${row.usr}`);
    console.log(`Server     : ${String(row.ver ?? '').split(' ').slice(0, 2).join(' ')}`);

    const found = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    const present = new Set(
      (found.rows ?? []).map((r) => String((r as Record<string, unknown>).tablename)),
    );
    const missing = EXPECTED.filter((t) => !present.has(t));

    console.log('');
    console.log(`Tables     : ${EXPECTED.length - missing.length} of ${EXPECTED.length} present`);

    if (missing.length === 0) {
      console.log('');
      console.log('Schema is up to date. Nothing to do.');
      return;
    }

    console.log('');
    console.log(`MISSING: ${missing.join(', ')}`);
    console.log('');
    console.log('The database is behind the code. Fix it with:');
    console.log('');
    console.log('    npm run db:migrate');
    console.log('');
    process.exitCode = 1;
  } catch (err) {
    const message = rootMessage(err);
    console.error('');
    console.error('Could not reach the database.');
    console.error(`  ${message}`);
    console.error('');

    if (/ECONNREFUSED/i.test(message)) {
      console.error('Nothing is listening there. Is PostgreSQL running?');
    } else if (/does not exist/i.test(message) && /database/i.test(message)) {
      console.error('The server is up but that database does not exist. Create it:');
      console.error('');
      console.error('    createdb vanguard_crm');
    } else if (/password|authentication/i.test(message)) {
      console.error('The server rejected those credentials. Check the user and password');
      console.error('in DATABASE_URL.');
    } else if (/ENOTFOUND|EAI_AGAIN/i.test(message)) {
      console.error('That host could not be resolved. Check the hostname in DATABASE_URL.');
    } else {
      console.error('Check that the server is running and that DATABASE_URL is right.');
    }
    console.error('');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
