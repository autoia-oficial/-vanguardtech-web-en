import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  varchar,
  serial,
  json,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// AUTH
// ---------------------------------------------------------------------------

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull(),
  password_hash: varchar('password_hash', { length: 255 }).notNull(),
  full_name: varchar('full_name', { length: 255 }),
  role: varchar('role', { length: 50 }).notNull().default('admin'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  emailIdx: uniqueIndex('users_email_uniq').on(t.email),
}));

export const sessions = pgTable('sessions', {
  id: varchar('id', { length: 64 }).primaryKey(),
  user_id: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expires_at: timestamp('expires_at').notNull(),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  userIdx: index('sessions_user_idx').on(t.user_id),
  expiresIdx: index('sessions_expires_idx').on(t.expires_at),
}));

// ---------------------------------------------------------------------------
// LEADS
// ---------------------------------------------------------------------------

export const leads = pgTable('leads', {
  id: serial('id').primaryKey(),
  business_name: varchar('business_name', { length: 255 }).notNull(),
  category: varchar('category', { length: 100 }),
  subcategory: varchar('subcategory', { length: 100 }),
  city: varchar('city', { length: 100 }),
  province: varchar('province', { length: 100 }),
  country: varchar('country', { length: 100 }),
  address: text('address'),
  phone: varchar('phone', { length: 40 }),
  email: varchar('email', { length: 255 }),
  website: varchar('website', { length: 500 }),
  google_url: varchar('google_url', { length: 500 }),
  instagram_url: varchar('instagram_url', { length: 500 }),
  facebook_url: varchar('facebook_url', { length: 500 }),
  linkedin_url: varchar('linkedin_url', { length: 500 }),
  source: varchar('source', { length: 100 }),
  source_url: text('source_url'),
  // Stable identity used to make discovery idempotent across runs.
  dedupe_key: varchar('dedupe_key', { length: 255 }),
  status: varchar('status', { length: 50 }).notNull().default('NEW'),
  priority: varchar('priority', { length: 20 }).notNull().default('medium'),
  score: integer('score').notNull().default(0),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
  last_contact_at: timestamp('last_contact_at'),
  next_follow_up_at: timestamp('next_follow_up_at'),
  notes: text('notes'),
}, (t) => ({
  statusIdx: index('leads_status_idx').on(t.status),
  priorityIdx: index('leads_priority_idx').on(t.priority),
  categoryIdx: index('leads_category_idx').on(t.category),
  cityIdx: index('leads_city_idx').on(t.city),
  emailIdx: index('leads_email_idx').on(t.email),
  phoneIdx: index('leads_phone_idx').on(t.phone),
  websiteIdx: index('leads_website_idx').on(t.website),
  dedupeIdx: uniqueIndex('leads_dedupe_key_uniq').on(t.dedupe_key),
  createdIdx: index('leads_created_idx').on(t.created_at),
}));

// ---------------------------------------------------------------------------
// AUDITS
// ---------------------------------------------------------------------------

export const audits = pgTable('audits', {
  id: serial('id').primaryKey(),
  lead_id: integer('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  url: varchar('url', { length: 500 }),
  overall_status: varchar('overall_status', { length: 50 }).notNull().default('NOT_VERIFIED'),
  overall_score: integer('overall_score').notNull().default(0),
  fetch_error: text('fetch_error'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  leadIdx: index('audits_lead_idx').on(t.lead_id),
}));

export const audit_checks = pgTable('audit_checks', {
  id: serial('id').primaryKey(),
  audit_id: integer('audit_id').notNull().references(() => audits.id, { onDelete: 'cascade' }),
  check_number: integer('check_number').notNull(),
  check_name: varchar('check_name', { length: 255 }).notNull(),
  status: varchar('status', { length: 50 }).notNull().default('NOT_VERIFIED'),
  evidence: text('evidence'),
  problem: text('problem'),
  impact: text('impact'),
  priority: varchar('priority', { length: 20 }),
  checked_at: timestamp('checked_at'),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  auditIdx: index('audit_checks_audit_idx').on(t.audit_id),
  uniqPerAudit: uniqueIndex('audit_checks_audit_number_uniq').on(t.audit_id, t.check_number),
}));

// ---------------------------------------------------------------------------
// CONTACTS + EMAIL ACCOUNTS
// ---------------------------------------------------------------------------

export const contacts = pgTable('contacts', {
  id: serial('id').primaryKey(),
  lead_id: integer('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  contact_name: varchar('contact_name', { length: 255 }),
  contact_email: varchar('contact_email', { length: 255 }).notNull(),
  contact_phone: varchar('contact_phone', { length: 40 }),
  contact_role: varchar('contact_role', { length: 100 }),
  is_primary: boolean('is_primary').notNull().default(true),
  verified: boolean('verified').notNull().default(false),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  leadIdx: index('contacts_lead_idx').on(t.lead_id),
  emailIdx: index('contacts_email_idx').on(t.contact_email),
  uniqPerLead: uniqueIndex('contacts_lead_email_uniq').on(t.lead_id, t.contact_email),
}));

export const email_accounts = pgTable('email_accounts', {
  id: serial('id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }),
  provider: varchar('provider', { length: 50 }).notNull().default('smtp'),
  is_active: boolean('is_active').notNull().default(true),
  daily_limit: integer('daily_limit').notNull().default(100),
  hourly_limit: integer('hourly_limit').notNull().default(20),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  emailIdx: uniqueIndex('email_accounts_email_uniq').on(t.email),
}));

// ---------------------------------------------------------------------------
// CAMPAIGNS
// ---------------------------------------------------------------------------

export const campaigns = pgTable('campaigns', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  target_filter: json('target_filter'),
  // Ordered steps: [{ step, wait_days, subject, body }]
  sequence: json('sequence'),
  email_account_id: integer('email_account_id').references(() => email_accounts.id),
  daily_limit: integer('daily_limit').notNull().default(50),
  status: varchar('status', { length: 50 }).notNull().default('DRAFT'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  statusIdx: index('campaigns_status_idx').on(t.status),
}));

export const campaign_leads = pgTable('campaign_leads', {
  id: serial('id').primaryKey(),
  campaign_id: integer('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  lead_id: integer('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  current_step: integer('current_step').notNull().default(0),
  status: varchar('status', { length: 50 }).notNull().default('ACTIVE'),
  added_at: timestamp('added_at').notNull().defaultNow(),
}, (t) => ({
  campaignIdx: index('campaign_leads_campaign_idx').on(t.campaign_id),
  leadIdx: index('campaign_leads_lead_idx').on(t.lead_id),
  uniqPair: uniqueIndex('campaign_leads_pair_uniq').on(t.campaign_id, t.lead_id),
}));

// ---------------------------------------------------------------------------
// EMAIL QUEUE
// ---------------------------------------------------------------------------

export const emails = pgTable('emails', {
  id: serial('id').primaryKey(),
  campaign_id: integer('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
  lead_id: integer('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  contact_id: integer('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  from_email: varchar('from_email', { length: 255 }).notNull(),
  to_email: varchar('to_email', { length: 255 }).notNull(),
  subject: varchar('subject', { length: 500 }).notNull(),
  body: text('body').notNull(),
  // PENDING | QUEUED | SENDING | SENT | FAILED | CANCELLED
  status: varchar('status', { length: 50 }).notNull().default('PENDING'),
  // Guarantees a given (lead, campaign, step) is only ever queued once.
  idempotency_key: varchar('idempotency_key', { length: 255 }).notNull(),
  scheduled_at: timestamp('scheduled_at').notNull().defaultNow(),
  attempts: integer('attempts').notNull().default(0),
  max_attempts: integer('max_attempts').notNull().default(3),
  next_retry_at: timestamp('next_retry_at'),
  last_error: text('last_error'),
  blocked_reason: varchar('blocked_reason', { length: 100 }),
  provider_message_id: varchar('provider_message_id', { length: 255 }),
  locked_at: timestamp('locked_at'),
  locked_by: varchar('locked_by', { length: 64 }),
  sent_at: timestamp('sent_at'),
  delivered_at: timestamp('delivered_at'),
  bounced_at: timestamp('bounced_at'),
  opened_at: timestamp('opened_at'),
  clicked_at: timestamp('clicked_at'),
  replied_at: timestamp('replied_at'),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  leadIdx: index('emails_lead_idx').on(t.lead_id),
  statusIdx: index('emails_status_idx').on(t.status),
  sentIdx: index('emails_sent_at_idx').on(t.sent_at),
  fromSentIdx: index('emails_from_sent_idx').on(t.from_email, t.sent_at),
  scheduledIdx: index('emails_scheduled_idx').on(t.scheduled_at),
  idempotencyIdx: uniqueIndex('emails_idempotency_uniq').on(t.idempotency_key),
}));

export const email_events = pgTable('email_events', {
  id: serial('id').primaryKey(),
  email_id: integer('email_id').notNull().references(() => emails.id, { onDelete: 'cascade' }),
  // SENT | DELIVERED | BOUNCED | OPENED | CLICKED | REPLIED
  event_type: varchar('event_type', { length: 50 }).notNull(),
  event_data: json('event_data'),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  emailIdx: index('email_events_email_idx').on(t.email_id),
  typeIdx: index('email_events_type_idx').on(t.event_type),
}));

// ---------------------------------------------------------------------------
// FOLLOW-UPS / DEMOS / ACTIVITY
// ---------------------------------------------------------------------------

export const follow_ups = pgTable('follow_ups', {
  id: serial('id').primaryKey(),
  lead_id: integer('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  campaign_id: integer('campaign_id').references(() => campaigns.id, { onDelete: 'cascade' }),
  sequence_number: integer('sequence_number').notNull().default(1),
  scheduled_at: timestamp('scheduled_at').notNull(),
  sent_at: timestamp('sent_at'),
  // PENDING | QUEUED | SENT | CANCELLED
  status: varchar('status', { length: 50 }).notNull().default('PENDING'),
  cancel_reason: varchar('cancel_reason', { length: 100 }),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  leadIdx: index('follow_ups_lead_idx').on(t.lead_id),
  statusIdx: index('follow_ups_status_idx').on(t.status),
  scheduledIdx: index('follow_ups_scheduled_idx').on(t.scheduled_at),
  uniqStep: uniqueIndex('follow_ups_lead_campaign_step_uniq').on(t.lead_id, t.campaign_id, t.sequence_number),
}));

export const demos = pgTable('demos', {
  id: serial('id').primaryKey(),
  lead_id: integer('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  scheduled_at: timestamp('scheduled_at'),
  completed_at: timestamp('completed_at'),
  notes: text('notes'),
  interested: boolean('interested').notNull().default(false),
  status: varchar('status', { length: 50 }).notNull().default('SCHEDULED'),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  leadIdx: index('demos_lead_idx').on(t.lead_id),
  statusIdx: index('demos_status_idx').on(t.status),
}));

export const activities = pgTable('activities', {
  id: serial('id').primaryKey(),
  lead_id: integer('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  activity_type: varchar('activity_type', { length: 100 }).notNull(),
  description: text('description'),
  metadata: json('metadata'),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  leadIdx: index('activities_lead_idx').on(t.lead_id),
  typeIdx: index('activities_type_idx').on(t.activity_type),
  createdIdx: index('activities_created_idx').on(t.created_at),
}));

// ---------------------------------------------------------------------------
// AUTOMATIONS
// ---------------------------------------------------------------------------

export const automations = pgTable('automations', {
  id: serial('id').primaryKey(),
  key: varchar('key', { length: 100 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  config: json('config'),
  // ACTIVE | PAUSED
  status: varchar('status', { length: 50 }).notNull().default('ACTIVE'),
  last_run: timestamp('last_run'),
  next_run: timestamp('next_run'),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  keyIdx: uniqueIndex('automations_key_uniq').on(t.key),
  statusIdx: index('automations_status_idx').on(t.status),
}));

export const automation_runs = pgTable('automation_runs', {
  id: serial('id').primaryKey(),
  automation_id: integer('automation_id').notNull().references(() => automations.id, { onDelete: 'cascade' }),
  processed: integer('processed').notNull().default(0),
  success: integer('success').notNull().default(0),
  failed: integer('failed').notNull().default(0),
  skipped: integer('skipped').notNull().default(0),
  started_at: timestamp('started_at').notNull().defaultNow(),
  completed_at: timestamp('completed_at'),
  // RUNNING | COMPLETED | FAILED
  status: varchar('status', { length: 50 }).notNull().default('RUNNING'),
  detail: json('detail'),
}, (t) => ({
  automationIdx: index('automation_runs_automation_idx').on(t.automation_id),
  startedIdx: index('automation_runs_started_idx').on(t.started_at),
}));

// Cooperative advisory locks so two overlapping cron invocations never process
// the same work. Held rows are released by key with an expiry as a dead-man switch.
export const job_locks = pgTable('job_locks', {
  key: varchar('key', { length: 100 }).primaryKey(),
  owner: varchar('owner', { length: 64 }).notNull(),
  acquired_at: timestamp('acquired_at').notNull().defaultNow(),
  expires_at: timestamp('expires_at').notNull(),
}, (t) => ({
  expiresIdx: index('job_locks_expires_idx').on(t.expires_at),
}));

export const errors = pgTable('errors', {
  id: serial('id').primaryKey(),
  automation_id: integer('automation_id').references(() => automations.id, { onDelete: 'set null' }),
  lead_id: integer('lead_id').references(() => leads.id, { onDelete: 'cascade' }),
  error_type: varchar('error_type', { length: 100 }).notNull(),
  message: text('message').notNull(),
  context: json('context'),
  retry_count: integer('retry_count').notNull().default(0),
  next_retry_at: timestamp('next_retry_at'),
  resolved: boolean('resolved').notNull().default(false),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  automationIdx: index('errors_automation_idx').on(t.automation_id),
  leadIdx: index('errors_lead_idx').on(t.lead_id),
  typeIdx: index('errors_type_idx').on(t.error_type),
  resolvedIdx: index('errors_resolved_idx').on(t.resolved),
}));

export const suppression_list = pgTable('suppression_list', {
  id: serial('id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull(),
  reason: varchar('reason', { length: 255 }),
  added_at: timestamp('added_at').notNull().defaultNow(),
}, (t) => ({
  emailIdx: uniqueIndex('suppression_list_email_uniq').on(t.email),
}));

export const settings = pgTable('settings', {
  id: serial('id').primaryKey(),
  key: varchar('key', { length: 255 }).notNull(),
  value: text('value'),
  type: varchar('type', { length: 50 }),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  keyIdx: uniqueIndex('settings_key_uniq').on(t.key),
}));

// ---------------------------------------------------------------------------
// RELATIONS
// ---------------------------------------------------------------------------

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.user_id], references: [users.id] }),
}));

export const leadsRelations = relations(leads, ({ many }) => ({
  audits: many(audits),
  contacts: many(contacts),
  emails: many(emails),
  activities: many(activities),
  follow_ups: many(follow_ups),
  demos: many(demos),
  campaign_leads: many(campaign_leads),
}));

export const auditsRelations = relations(audits, ({ one, many }) => ({
  lead: one(leads, { fields: [audits.lead_id], references: [leads.id] }),
  checks: many(audit_checks),
}));

export const auditChecksRelations = relations(audit_checks, ({ one }) => ({
  audit: one(audits, { fields: [audit_checks.audit_id], references: [audits.id] }),
}));

export const contactsRelations = relations(contacts, ({ one, many }) => ({
  lead: one(leads, { fields: [contacts.lead_id], references: [leads.id] }),
  emails: many(emails),
}));

export const emailsRelations = relations(emails, ({ one, many }) => ({
  lead: one(leads, { fields: [emails.lead_id], references: [leads.id] }),
  contact: one(contacts, { fields: [emails.contact_id], references: [contacts.id] }),
  campaign: one(campaigns, { fields: [emails.campaign_id], references: [campaigns.id] }),
  events: many(email_events),
}));

export const emailEventsRelations = relations(email_events, ({ one }) => ({
  email: one(emails, { fields: [email_events.email_id], references: [emails.id] }),
}));

export const campaignsRelations = relations(campaigns, ({ one, many }) => ({
  email_account: one(email_accounts, {
    fields: [campaigns.email_account_id],
    references: [email_accounts.id],
  }),
  campaign_leads: many(campaign_leads),
  emails: many(emails),
}));

export const campaignLeadsRelations = relations(campaign_leads, ({ one }) => ({
  campaign: one(campaigns, { fields: [campaign_leads.campaign_id], references: [campaigns.id] }),
  lead: one(leads, { fields: [campaign_leads.lead_id], references: [leads.id] }),
}));

export const followUpsRelations = relations(follow_ups, ({ one }) => ({
  lead: one(leads, { fields: [follow_ups.lead_id], references: [leads.id] }),
  campaign: one(campaigns, { fields: [follow_ups.campaign_id], references: [campaigns.id] }),
}));

export const demosRelations = relations(demos, ({ one }) => ({
  lead: one(leads, { fields: [demos.lead_id], references: [leads.id] }),
}));

export const activitiesRelations = relations(activities, ({ one }) => ({
  lead: one(leads, { fields: [activities.lead_id], references: [leads.id] }),
}));

export const automationsRelations = relations(automations, ({ many }) => ({
  runs: many(automation_runs),
}));

export const automationRunsRelations = relations(automation_runs, ({ one }) => ({
  automation: one(automations, {
    fields: [automation_runs.automation_id],
    references: [automations.id],
  }),
}));

export const errorsRelations = relations(errors, ({ one }) => ({
  automation: one(automations, { fields: [errors.automation_id], references: [automations.id] }),
  lead: one(leads, { fields: [errors.lead_id], references: [leads.id] }),
}));
