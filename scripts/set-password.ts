/**
 * Creates a user, or changes an existing user's password.
 *
 *   npx tsx scripts/set-password.ts <email> <password>
 *
 * This is an operator tool, not a public endpoint. Running it already requires
 * DATABASE_URL, and anyone holding that can do anything to the data anyway, so
 * it does not enforce the 12-character minimum that /api/auth/setup does — it
 * warns instead. The HTTP endpoints keep their validation.
 */
import { eq } from 'drizzle-orm';
import { db, pool } from '../src/db/client';
import { users } from '../src/db/schema';
import { hashPassword } from '../src/lib/auth';

const MIN_SAFE_LENGTH = 12;

function usage(): never {
  console.error('Usage: npx tsx scripts/set-password.ts <email> <password>');
  console.error('Example: npx tsx scripts/set-password.ts admin@local my-password');
  process.exit(1);
}

async function main() {
  const [rawEmail, password] = process.argv.slice(2);
  if (!rawEmail || !password) usage();

  const email = rawEmail.toLowerCase().trim();
  if (!email.includes('@')) {
    console.error(`"${rawEmail}" is not an email address.`);
    console.error('Sign-in uses an email, so give it one — "name@local" works fine locally.');
    process.exit(1);
  }

  const password_hash = await hashPassword(password);
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });

  if (existing) {
    await db
      .update(users)
      .set({ password_hash, updated_at: new Date() })
      .where(eq(users.id, existing.id));
    console.log(`Password changed for ${email}.`);
  } else {
    await db.insert(users).values({ email, password_hash, full_name: null, role: 'admin' });
    console.log(`Created ${email}.`);
  }

  if (password.length < MIN_SAFE_LENGTH) {
    console.log('');
    console.log(`WARNING: that password is ${password.length} characters.`);
    console.log('Fine on a laptop nobody else reaches. Change it before this is');
    console.log('reachable from the internet — the login lockout slows an attacker');
    console.log('down, it does not save a password this short.');
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
