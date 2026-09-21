/**
 * Audits a single URL from the command line and prints the 13 checks.
 * Does not touch the database.
 *
 *   npx tsx scripts/audit-url.ts https://example.com
 */
import './load-env';
import { auditWebsite } from '../src/lib/audit/auditor';

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: npx tsx scripts/audit-url.ts <url>');
    process.exit(1);
  }

  const res = await auditWebsite(url, {
    business_name: process.argv[3] ?? null,
    city: process.argv[4] ?? null,
  });

  console.log(`\nURL:     ${res.url}`);
  console.log(`Status:  ${res.overall_status}   Score: ${res.overall_score}/100`);
  if (res.fetch_error) console.log(`Fetch error: ${res.fetch_error}`);
  console.log('');

  for (const c of res.checks) {
    const n = String(c.check_number).padStart(2, '0');
    console.log(`${n}  ${c.check_name.padEnd(20)} ${c.status.padEnd(13)}`);
    if (c.evidence) console.log(`    evidence: ${c.evidence}`);
    if (c.problem) console.log(`    problem:  ${c.problem}`);
  }
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
