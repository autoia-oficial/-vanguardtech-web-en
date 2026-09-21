# Vanguard CRM

A sales system for Vanguard Tech: it finds local businesses, audits their
websites against 13 concrete checks, scores them by how much work they need and
how reachable they are, and runs email outreach with hard limits so a bug
cannot turn into a thousand emails.

Next.js 15 · TypeScript · PostgreSQL · Drizzle ORM · Tailwind · deployed on Vercel.

---

## The rule this codebase is built around

**Nothing is recorded that did not happen.**

- An email reaches `SENT` only after the provider returns a message id. Every
  other outcome leaves it `PENDING` (retryable) or `FAILED`/`CANCELLED` with
  the reason stored.
- A website that cannot be fetched produces 13 `NOT_VERIFIED` checks with the
  fetch error as evidence — never a failing grade.
- A discovery source with no credentials is skipped and reported, not faked.
- Every integration that is not wired up says `NOT CONFIGURED` in the interface
  and names the exact environment variable that is missing.

---

## Architecture

```
src/
  app/
    (app)/            CRM pages, all behind the auth check in its layout
    login/            sign-in and first-run setup
    api/              REST endpoints; withAuth / withCronAuth wrap every one
  components/         shell, theme, shared presentational primitives
  db/
    schema.ts         21 tables, relations, indexes, cascade rules
    client.ts         pooled pg connection
  lib/
    audit/            fetcher, the 13 checks, scoring of a single site
    discovery/        LeadSourceProvider + adapters (OSM, Google Places)
    email/            EmailProvider + adapters, and the queue
    campaigns/        sequence definition and advancement
    automation/       job runner, the seven jobs, dispatcher
    auth.ts           scrypt hashing, database sessions
    locks.ts          cooperative job locks with expiry
    dedupe.ts         duplicate detection and normalisation
    scoring.ts        the lead score, formula documented in the module
    config.ts         which integrations are configured
migrations/           generated SQL, reproducible
scripts/              audit-url, seed, ui-check
```

### Database

21 tables. The interesting parts:

| Table | Holds |
|---|---|
| `leads` | The business. `dedupe_key` makes discovery idempotent across runs. |
| `audits` / `audit_checks` | One row per audit, 13 per audit with status, evidence, problem, impact, priority. |
| `emails` | The queue. Carries `idempotency_key` (unique), `attempts`, `next_retry_at`, `last_error`, `blocked_reason`, `provider_message_id`, `sequence_step`. |
| `email_events` | `SENT` / `DELIVERED` / `BOUNCED` / `OPENED` / `CLICKED` / `REPLIED`, only when a provider reports them. |
| `campaigns` / `campaign_leads` | Sequence definition, and each lead's position in it. |
| `follow_ups` | One row per scheduled step, unique on (lead, campaign, step). |
| `activities` | The permanent history. Only deleting the lead removes it. |
| `automations` / `automation_runs` | Job registry and every execution with counts. |
| `errors` | Per-item failures with `retry_count` and `next_retry_at`. |
| `job_locks` | Advisory locks with a dead-man expiry. |
| `suppression_list` | Addresses that are never emailed. |
| `users` / `sessions` | Authentication. |
| `login_attempts` | Failed sign-in counters, so the login endpoint can be throttled. |

### Pipeline

`NEW → QUALIFIED → AUDIT_READY → AUDITED → DEMO_READY → CONTACTED → REPLIED →
DEMO_SENT → INTERESTED → MEETING → ACCEPTED → PAID → PROJECT → LIVE`,
plus `LOST` and `DO_NOT_CONTACT`.

Every stage change is written to `activities` with the transition and reason.
`DO_NOT_CONTACT`, `LOST`, `PAID`, `PROJECT` and `LIVE` stop outbound sales email.

---

## Lead discovery

Provider-based. The CRM depends only on the `LeadSourceProvider` interface, so a
new source is an adapter, not a change to the CRM.

| Source | Credentials | Notes |
|---|---|---|
| OpenStreetMap (Overpass) | none | Always available. A business with no `website` tag genuinely has no website on record — exactly the signal worth selling to. |
| Google Places | `GOOGLE_PLACES_API_KEY` | Skipped with a reason when absent. Places does not expose email addresses, so `email` stays null. |

Search by country, province, city and category. Supported categories are listed
by `GET /api/discovery`. A business found again is matched on its source
identity first, then email, phone, website, `google_url`, and name + city.

**Adding a source:** implement `LeadSourceProvider` in
`src/lib/discovery/providers/`, give it a stable `key`, have `availability()`
report what it needs, and register it in `src/lib/discovery/engine.ts`.

---

## The auditor

`auditWebsite(url, leadContext)` fetches the page (15s timeout, 3MB cap,
redirects followed) and runs 13 checks against the real document.

| # | Check | What it actually looks at |
|---|---|---|
| 01 | Mobile / Responsive | `<meta name="viewport">`, device-width, whether zoom is disabled |
| 02 | HTTPS | Whether the final URL is TLS, and whether plain http redirects to it |
| 03 | Performance | Measured document fetch time and size, render-blocking scripts, stylesheets |
| 04 | Visual structure | `<h1>` count, heading total, semantic landmarks |
| 05 | CTA | Action-labelled links/buttons, form presence |
| 06 | Click to call | `href^="tel:"`; a printed-but-unlinked number warns rather than fails |
| 07 | Opening hours | JSON-LD `openingHours`, else day/time text as a weaker signal |
| 08 | Services | Headings and nav links naming the offer |
| 09 | Location | JSON-LD address/geo, map embed, map link, `<address>` |
| 10 | Contactability | How many of phone / email / WhatsApp / form exist |
| 11 | Basic SEO | title, meta description, canonical, lang, Open Graph |
| 12 | Images / content | Image count, alt coverage, visible word count |
| 13 | Local consistency | Name, phone and city on record vs. what the page shows |

Each check stores `status`, `evidence`, `problem`, `impact`, `priority` and
`checked_at`. Status is `PASS`, `WARNING`, `FAIL` or `NOT_VERIFIED`.

A check that cannot determine something returns `NOT_VERIFIED` with the reason.
If the page cannot be fetched at all, all 13 come back `NOT_VERIFIED` and the
audit stores `fetch_error`.

Run one from the command line without touching the database:

```bash
npm run audit:url -- https://example.com "Business Name" "City"
```

---

## Lead scoring

0–100, in `src/lib/scoring.ts`. The score answers: how much is this lead worth
contacting next? Vanguard sells websites, so the best lead visibly needs that
work **and** can be reached.

| Component | Max | How |
|---|---|---|
| Opportunity | 45 | No website at all = 45. With a website, `45 × (1 − auditScore/100)`, so a site scoring 20/100 yields 36. Un-audited = 20 (unknown, not zero). |
| Reachability | 30 | email 18, phone 8, any social 4. Email dominates because outbound runs on email. |
| Data quality | 15 | category, city, address, country — 3.75 each. |
| Evidence | 10 | Proportional to how many of the 13 checks actually ran. |

**A lead with no contact route is capped at 40** however broken its site is —
an unreachable business is not actionable.

Priority bands: ≥80 `critical`, ≥60 `high`, ≥35 `medium`, else `low`.

`scoreLead()` returns the total plus each component and a `reasons` array, so
any score in the interface can be explained.

---

## Email

### Providers

`EmailProvider` with an SMTP adapter (nodemailer). When SMTP is not configured,
`UnconfiguredEmailProvider` is selected: it never sends and never claims to.

A send returns `{ ok: true, provider_message_id }` only when the server accepted
the message. A 5xx is a permanent rejection and is not retried; a 4xx or a
transport error is retried with backoff.

### Queue states

`PENDING → QUEUED → SENDING → SENT`, or `FAILED` / `CANCELLED`.

### Every gate, checked at enqueue *and* again immediately before sending

- recipient is syntactically valid
- recipient is not on the suppression list
- lead is not at a no-outreach stage
- campaign is still `ACTIVE`
- sending account exists and is active
- per-day cap for that account, counted **over today only**
- per-hour cap for that account, counted over the last hour
- campaign's own daily cap
- lead was not contacted inside the cool-off window (default 14 days)
- no other email is already outstanding for that lead

A limit is temporary, so the email is deferred with a `next_retry_at` rather
than cancelled. A permanent block is cancelled with `blocked_reason` recorded
and written to the lead's activity.

### Why it cannot double-send

- `idempotency_key` is unique in the database, derived from
  lead + campaign + step + subject.
- A worker claims a row with a conditional `UPDATE ... WHERE status IN
  ('PENDING','QUEUED')`, so overlapping runs cannot both take it.
- Rows stranded in `SENDING` by a killed worker are reclaimed after 10 minutes.
- Each job holds a lock, so two cron invocations never process the same queue.

There is a test that runs three workers concurrently against five queued emails
and asserts exactly five sends.

---

## Campaigns and follow-ups

A campaign carries ordered steps:

```json
[
  { "step": 1, "wait_days": 0, "subject": "About {{business_name}}", "body": "Hi {{business_name}} in {{city}}" },
  { "step": 2, "wait_days": 4, "subject": "Following up",           "body": "Checking in" }
]
```

`{{field}}` placeholders are filled from the lead; an unknown or null field
renders empty rather than leaving the placeholder visible.

Step 1 queues immediately. A later step is booked **only once the previous one
was actually sent**, waiting `wait_days` from that send. Emails record their
`sequence_step`, so the wait is always measured from the right send.

A sequence stops immediately when the lead replies, becomes a customer, or is
marked `DO_NOT_CONTACT` — cancelling pending follow-ups and any queued mail.

---

## Automations

Seven jobs, each separate, idempotent and lock-protected.

| Job | Schedule | Does |
|---|---|---|
| `lead-discovery` | `0 */6 * * *` | Runs the saved discovery queries. |
| `website-audit` | `15 * * * *` | Audits leads with a website and no audit, then rescores. |
| `email-queue` | `*/5 * * * *` | Sends due mail through every gate above. |
| `follow-up` | `0 9 * * *` | Advances sequences, queues due steps. |
| `crm-maintenance` | `30 * * * *` | Stops sequences for converted leads, reclaims stuck sends, prunes sessions and locks. |
| `duplicate-detection` | `0 2 * * 0` | Reports groups that look like the same business. |
| `error-retry` | `*/30 * * * *` | Re-attempts recorded failures whose backoff elapsed. |

Every run writes an `automation_runs` row with processed/success/failed/skipped,
whether it succeeded or threw. A per-item failure is recorded in `errors` and
never aborts the batch — one broken lead cannot stop the queue.

The Automations page can pause, resume, or run each job now. "Run now" takes the
same lock a cron run does, so pressing it twice is refused rather than
duplicating work.

---

## Authentication

scrypt with a per-password random salt, database-backed sessions, httpOnly
cookie, 7-day expiry. Timing-safe comparison, and sign-in spends the hashing
time even for an unknown account so the endpoint cannot enumerate users.

Repeated failures are throttled: 8 failures within 15 minutes locks that email
address for 15 minutes, and the correct password is refused while the lockout
holds. Counters live in the database, not in memory — a serverless instance
does not share process state, so an in-memory counter would reset on every cold
start and protect nothing. Other accounts are unaffected, and a successful
sign-in clears the counter.

Every CRM page sits under a layout that checks the session server-side; every
private API route is wrapped in `withAuth`. With `AUTH_SECRET` unset, sign-in is
refused and the CRM stays locked.

The first account is created at `/login` on first run; that endpoint closes
itself permanently once a user exists.

**Cron routes never fall back to a default secret.** If `CRON_SECRET` is unset,
they return 503 `NOT_CONFIGURED` and run nothing.

---

## Local development

Requires Node 18+ and PostgreSQL 14+.

```bash
npm install

# database
createdb vanguard_crm
createdb vanguard_crm_test

cp .env.example .env.local
# set DATABASE_URL, AUTH_SECRET, CRON_SECRET

npm run db:migrate      # apply migrations
npm run seed            # admin account + example leads (development only)
npm run dev             # http://localhost:3000
```

The seed writes leads using `.invalid` addresses (reserved by RFC 2606, so they
can never resolve or be emailed) and `source = "seed"`. Remove them with:

```bash
npx tsx scripts/seed.ts --clean
```

### Commands

| Command | Does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm start` | Serve the build |
| `npm test` | Full test suite |
| `npm run type-check` | TypeScript, no emit |
| `npm run lint` | ESLint |
| `npm run db:generate` | Generate a migration from schema changes |
| `npm run db:migrate` | Apply migrations |
| `npm run db:studio` | Drizzle Studio |
| `npm run seed` | Development seed |
| `npm run audit:url -- <url>` | Audit one URL from the terminal |
| `npm run ui-check` | Drive the running app in a browser across three viewports |

### Getting a campaign sending

1. **Settings → Sending accounts**: add the address that will send, with its
   daily and hourly limits.
2. **Campaigns → New campaign**, then open it.
3. Add sequence steps. Step 1 has no wait; later steps wait that many days
   after the previous step was *sent*.
4. Pick the sending account.
5. Enrol leads by pipeline stage.
6. Activate. Until SMTP is configured the queue fills and holds; nothing is
   marked sent.

---

## Testing

The suite runs against a **real PostgreSQL database** — nothing is mocked — so
unique constraints, cascades and concurrent updates behave as they will in
production. `TEST_DATABASE_URL` is truncated between tests.

```bash
createdb vanguard_crm_test
DATABASE_URL=postgresql://.../vanguard_crm_test npm run db:migrate
npm test
```

Covered: the 13 audit checks against fixture pages served over loopback,
unreachable and non-HTML sites, scoring in every band, duplicate detection and
normalisation, lock acquisition and contention, email validation, every queue
gate, daily and hourly limits, retry and backoff, concurrency, password hashing
and sessions, sequence advancement and every stop condition, and an end-to-end
run of one lead from discovery through audit, scoring, enrolment, send,
follow-up and cleanup.

`npm run ui-check` drives the running app in Chromium: signs in, visits all ten
pages at mobile, tablet and desktop widths, exercises both themes and the mobile
drawer, and fails on any console error, failed request, 5xx, or horizontal
overflow.

---

## Deployment

### 1. Database

Create a PostgreSQL database. Neon needs no code changes — use the **pooled**
connection string for serverless.

### 2. Vercel

Import the repository. Next.js is detected automatically; `vercel.json` already
declares the seven cron schedules.

Set these environment variables:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Pooled connection string |
| `AUTH_SECRET` | yes | `openssl rand -base64 32` |
| `CRON_SECRET` | yes | `openssl rand -hex 32` |
| `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASSWORD` | no | Until set, the queue holds mail and sends nothing |
| `GOOGLE_PLACES_API_KEY` | no | Enables that discovery source |

### 3. Migrate

```bash
DATABASE_URL="<production url>" npm run db:migrate
```

### 4. First run

Open the deployment, create the first account at `/login`, then configure
discovery queries and an email account under Settings.

Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically once the
variable is set on the project.

---

## What is not built

Stated plainly so nothing here is mistaken for working:

- **Open/click/reply tracking.** The `email_events` table and the statuses
  exist, but nothing writes `OPENED`, `CLICKED` or `REPLIED` — that needs
  provider webhooks or an IMAP poller. No event is invented in their absence.
- **Demos.** The `demos` table exists and lead detail reads it; nothing creates
  a demo yet.
- **Discovery from the interface.** `POST /api/discovery` runs a search and the
  `lead-discovery` job runs saved queries from Settings, but there is no
  search form in the UI yet.
- **Merging duplicates.** Duplicate groups are detected and reported under
  Errors; merging them is still manual.
