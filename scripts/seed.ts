/**
 * Development seed. NOT for production.
 *
 * Creates an admin account and a handful of clearly-marked example leads so
 * the interface can be exercised locally. Every record it writes uses the
 * `.invalid` TLD (reserved by RFC 2606, so it can never resolve or be emailed)
 * and source "seed", which makes them trivial to find and remove:
 *
 *   npx tsx scripts/seed.ts          seed
 *   npx tsx scripts/seed.ts --clean  remove everything it created
 */
// Must come first: it puts .env.local into process.env before the database
// client is imported, and that module throws on a missing DATABASE_URL.
import './load-env';
import { eq } from 'drizzle-orm';
import { db, pool } from '../src/db/client';
import { leads, email_accounts, campaigns } from '../src/db/schema';
import { createUser, countUsers } from '../src/lib/auth';
import { ensureAutomations } from '../src/lib/automation/runner';
import { persistDiscovered } from '../src/lib/discovery/engine';

const SEED_SOURCE = 'seed';

const EXAMPLES = [
  { business_name: 'Example Gym', category: 'gyms', city: 'Madrid', email: 'owner@example-gym.invalid', phone: '+34910000001', website: null },
  { business_name: 'Example Dental', category: 'dentists', city: 'Madrid', email: 'hello@example-dental.invalid', phone: '+34910000002', website: 'https://example-dental.invalid' },
  { business_name: 'Example Barber', category: 'barbers', city: 'Valencia', email: null, phone: '+34910000003', website: null },
  { business_name: 'Example Bistro', category: 'restaurants', city: 'Sevilla', email: 'book@example-bistro.invalid', phone: null, website: 'https://example-bistro.invalid' },
  { business_name: 'Example Clinic', category: 'clinics', city: 'Bilbao', email: 'info@example-clinic.invalid', phone: '+34910000005', website: null },
];

async function clean() {
  const removed = await db.delete(leads).where(eq(leads.source, SEED_SOURCE)).returning();
  // The campaign references the account, so it has to go first.
  await db.delete(campaigns).where(eq(campaigns.name, 'Seed campaign'));
  await db.delete(email_accounts).where(eq(email_accounts.email, 'sales@vanguard.invalid'));
  console.log(`Removed ${removed.length} seeded lead(s) and their history.`);
}

async function seed() {
  await ensureAutomations();

  if ((await countUsers()) === 0) {
    const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@vanguard.invalid';
    const password = process.env.SEED_ADMIN_PASSWORD ?? 'change-this-password';
    await createUser(email, password, 'Seed Admin');
    console.log(`Created admin: ${email} / ${password}`);
    console.log('Change this password before exposing the app to anyone.');
  } else {
    console.log('A user already exists; not creating another.');
  }

  const account = await db
    .insert(email_accounts)
    .values({ email: 'sales@vanguard.invalid', name: 'Vanguard Sales (seed)', daily_limit: 50, hourly_limit: 10 })
    .onConflictDoNothing({ target: email_accounts.email })
    .returning();

  let created = 0;
  for (const [i, example] of EXAMPLES.entries()) {
    const id = await persistDiscovered({ ...example, source: SEED_SOURCE, external_id: `seed-${i}` });
    if (id !== null) created++;
  }
  console.log(`Created ${created} example lead(s) (source="${SEED_SOURCE}", .invalid addresses).`);

  if (account.length > 0) {
    await db.insert(campaigns).values({
      name: 'Seed campaign',
      description: 'Example sequence for local development.',
      status: 'DRAFT',
      email_account_id: account[0].id,
      daily_limit: 10,
      sequence: [
        { step: 1, wait_days: 0, subject: 'Your website, {{business_name}}', body: 'Hi {{business_name}} in {{city}} — a few notes on your site.' },
        { step: 2, wait_days: 4, subject: 'Following up', body: 'Just checking you saw the notes.' },
      ],
    });
    console.log('Created "Seed campaign" as DRAFT.');
  }
}

async function main() {
  if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_SEED_IN_PRODUCTION) {
    console.error('Refusing to seed with NODE_ENV=production. Set ALLOW_SEED_IN_PRODUCTION=1 to override.');
    process.exit(1);
  }
  if (process.argv.includes('--clean')) await clean();
  else await seed();
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
