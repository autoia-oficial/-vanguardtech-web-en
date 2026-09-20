/**
 * Points the app's database client at the test database before any module
 * imports it, and supplies the env vars the app treats as "configured".
 *
 * Integration tests run against a real PostgreSQL instance — nothing here is
 * mocked — so that constraints, cascades and concurrent updates are exercised
 * as they will behave in production.
 */
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://vanguard:vanguard@127.0.0.1:5432/vanguard_crm_test';

process.env.AUTH_SECRET ??= 'test-auth-secret-value-at-least-32-chars';

// The auditor refuses private addresses to prevent SSRF. Tests serve their
// fixture pages on loopback, so they opt in explicitly.
process.env.AUDIT_ALLOW_PRIVATE_HOSTS = '1';
process.env.CRON_SECRET ??= 'test-cron-secret';

// SMTP is deliberately left unset: the default provider must report
// NOT_CONFIGURED unless a test injects one.
delete process.env.SMTP_HOST;
delete process.env.SMTP_PORT;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASSWORD;
