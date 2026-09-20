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

// USERS
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: varchar('email', { length: 255 }).unique(),
  password_hash: varchar('password_hash', { length: 255 }),
  full_name: varchar('full_name', { length: 255 }),
  role: varchar('role', { length: 50 }).default('user'),
  created_at: timestamp('created_at').defaultNow(),
  updated_at: timestamp('updated_at').defaultNow(),
}, (table) => ({
  emailIdx: uniqueIndex().on(table.email),
}));

// BUSINESSES / LEADS
export const leads = pgTable('leads', {
  id: serial('id').primaryKey(),
  business_name: varchar('business_name', { length: 255 }).notNull(),
  category: varchar('category', { length: 100 }),
  subcategory: varchar('subcategory', { length: 100 }),
  city: varchar('city', { length: 100 }),
  province: varchar('province', { length: 100 }),
  country: varchar('country', { length: 100 }).default('Spain'),
  address: text('address'),
  phone: varchar('phone', { length: 20 }),
  email: varchar('email', { length: 255 }),
  website: varchar('website', { length: 255 }),
  google_url: varchar('google_url', { length: 255 }),
  instagram_url: varchar('instagram_url', { length: 255 }),
  facebook_url: varchar('facebook_url', { length: 255 }),
  linkedin_url: varchar('linkedin_url', { length: 255 }),
  source: varchar('source', { length: 100 }),
  source_url: text('source_url'),
  status: varchar('status', { length: 50 }).default('NEW'),
  priority: varchar('priority', { length: 20 }).default('medium'),
  score: integer('score').default(0),
  created_at: timestamp('created_at').defaultNow(),
  updated_at: timestamp('updated_at').defaultNow(),
  last_contact_at: timestamp('last_contact_at'),
  next_follow_up_at: timestamp('next_follow_up_at'),
  notes: text('notes'),
}, (table) => ({
  statusIdx: index().on(table.status),
  priorityIdx: index().on(table.priority),
  categoryIdx: index().on(table.category),
  cityIdx: index().on(table.city),
}));

// AUDITS
export const audits = pgTable('audits', {
  id: serial('id').primaryKey(),
  lead_id: integer('lead_id').notNull().references(() => leads.id),
  overall_status: varchar('overall_status', { length: 50 }).default('NOT_VERIFIED'),
  overall_score: integer('overall_score').default(0),
  created_at: timestamp('created_at').defaultNow(),
  updated_at: timestamp('updated_at').defaultNow(),
}, (table) => ({
  leadIdx: index().on(table.lead_id),
}));

// AUDIT CHECKS (13 detailed checks)
export const audit_checks = pgTable('audit_checks', {
  id: serial('id').primaryKey(),
  audit_id: integer('audit_id').notNull().references(() => audits.id),
  check_number: integer('check_number'),
  check_name: varchar('check_name', { length: 255 }),
  status: varchar('status', { length: 50 }).default('NOT_VERIFIED'),
  score: integer('score').default(0),
  evidence: text('evidence'),
  problem: text('problem'),
  impact: text('impact'),
  priority: varchar('priority', { length: 20 }),
  checked_at: timestamp('checked_at'),
  created_at: timestamp('created_at').defaultNow(),
}, (table) => ({
  auditIdx: index().on(table.audit_id),
}));

// CONTACTS / EMAIL ACCOUNTS
export const contacts = pgTable('contacts', {
  id: serial('id').primaryKey(),
  lead_id: integer('lead_id').notNull().references(() => leads.id),
  contact_name: varchar('contact_name', { length: 255 }),
  contact_email: varchar('contact_email', { length: 255 }).notNull(),
  contact_phone: varchar('contact_phone', { length: 20 }),
  contact_role: varchar('contact_role', { length: 100 }),
  is_primary: boolean('is_primary').default(true),
  verified: boolean('verified').default(false),
  created_at: timestamp('created_at').defaultNow(),
  updated_at: timestamp('updated_at').defaultNow(),
}, (table) => ({
  leadIdx: index().on(table.lead_id),
  emailIdx: index().on(table.contact_email),
}));

// EMAIL ACCOUNTS (configured sender accounts)
export const email_accounts = pgTable('email_accounts', {
  id: serial('id').primaryKey(),
  email: varchar('email', { length: 255 }).unique().notNull(),
  name: varchar('name', { length: 255 }),
  smtp_host: varchar('smtp_host', { length: 255 }),
  smtp_port: integer('smtp_port'),
  smtp_user: varchar('smtp_user', { length: 255 }),
  smtp_password: varchar('smtp_password', { length: 255 }),
  is_active: boolean('is_active').default(true),
  daily_limit: integer('daily_limit').default(100),
  created_at: timestamp('created_at').defaultNow(),
}, (table) => ({
  emailIdx: uniqueIndex().on(table.email),
}));

// CAMPAIGNS
export const campaigns = pgTable('campaigns', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  target_filter: json('target_filter'),
  email_account_id: integer('email_account_id').references(() => email_accounts.id),
  daily_limit: integer('daily_limit').default(50),
  status: varchar('status', { length: 50 }).default('DRAFT'),
  created_at: timestamp('created_at').defaultNow(),
  updated_at: timestamp('updated_at').defaultNow(),
}, (table) => ({
  statusIdx: index().on(table.status),
}));

// CAMPAIGN LEADS (many-to-many)
export const campaign_leads = pgTable('campaign_leads', {
  id: serial('id').primaryKey(),
  campaign_id: integer('campaign_id').notNull().references(() => campaigns.id),
  lead_id: integer('lead_id').notNull().references(() => leads.id),
  added_at: timestamp('added_at').defaultNow(),
}, (table) => ({
  campaignIdx: index().on(table.campaign_id),
  leadIdx: index().on(table.lead_id),
}));

// EMAILS
export const emails = pgTable('emails', {
  id: serial('id').primaryKey(),
  campaign_id: integer('campaign_id').references(() => campaigns.id),
  lead_id: integer('lead_id').notNull().references(() => leads.id),
  contact_id: integer('contact_id').notNull().references(() => contacts.id),
  from_email: varchar('from_email', { length: 255 }).notNull(),
  to_email: varchar('to_email', { length: 255 }).notNull(),
  subject: varchar('subject', { length: 255 }).notNull(),
  body: text('body').notNull(),
  status: varchar('status', { length: 50 }).default('PENDING'),
  sent_at: timestamp('sent_at'),
  delivered_at: timestamp('delivered_at'),
  bounced_at: timestamp('bounced_at'),
  opened_at: timestamp('opened_at'),
  clicked_at: timestamp('clicked_at'),
  replied_at: timestamp('replied_at'),
  external_id: varchar('external_id', { length: 255 }),
  created_at: timestamp('created_at').defaultNow(),
}, (table) => ({
  leadIdx: index().on(table.lead_id),
  statusIdx: index().on(table.status),
  sentIdx: index().on(table.sent_at),
}));

// EMAIL EVENTS
export const email_events = pgTable('email_events', {
  id: serial('id').primaryKey(),
  email_id: integer('email_id').notNull().references(() => emails.id),
  event_type: varchar('event_type', { length: 50 }).notNull(),
  event_data: json('event_data'),
  created_at: timestamp('created_at').defaultNow(),
}, (table) => ({
  emailIdx: index().on(table.email_id),
  typeIdx: index().on(table.event_type),
}));

// FOLLOW-UPS / AUTOMATION SEQUENCES
export const follow_ups = pgTable('follow_ups', {
  id: serial('id').primaryKey(),
  lead_id: integer('lead_id').notNull().references(() => leads.id),
  campaign_id: integer('campaign_id').references(() => campaigns.id),
  sequence_number: integer('sequence_number').default(1),
  email_template: text('email_template'),
  scheduled_at: timestamp('scheduled_at'),
  sent_at: timestamp('sent_at'),
  status: varchar('status', { length: 50 }).default('PENDING'),
  created_at: timestamp('created_at').defaultNow(),
}, (table) => ({
  leadIdx: index().on(table.lead_id),
  statusIdx: index().on(table.status),
}));

// DEMOS / MEETINGS
export const demos = pgTable('demos', {
  id: serial('id').primaryKey(),
  lead_id: integer('lead_id').notNull().references(() => leads.id),
  scheduled_at: timestamp('scheduled_at'),
  completed_at: timestamp('completed_at'),
  notes: text('notes'),
  interested: boolean('interested').default(false),
  status: varchar('status', { length: 50 }).default('SCHEDULED'),
  created_at: timestamp('created_at').defaultNow(),
}, (table) => ({
  leadIdx: index().on(table.lead_id),
  statusIdx: index().on(table.status),
}));

// ACTIVITIES / TIMELINE
export const activities = pgTable('activities', {
  id: serial('id').primaryKey(),
  lead_id: integer('lead_id').notNull().references(() => leads.id),
  activity_type: varchar('activity_type', { length: 100 }).notNull(),
  description: text('description'),
  metadata: json('metadata'),
  created_at: timestamp('created_at').defaultNow(),
}, (table) => ({
  leadIdx: index().on(table.lead_id),
  typeIdx: index().on(table.activity_type),
}));

// AUTOMATIONS
export const automations = pgTable('automations', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  type: varchar('type', { length: 100 }).notNull(),
  config: json('config'),
  status: varchar('status', { length: 50 }).default('ACTIVE'),
  last_run: timestamp('last_run'),
  next_run: timestamp('next_run'),
  created_at: timestamp('created_at').defaultNow(),
}, (table) => ({
  statusIdx: index().on(table.status),
}));

// AUTOMATION RUNS
export const automation_runs = pgTable('automation_runs', {
  id: serial('id').primaryKey(),
  automation_id: integer('automation_id').notNull().references(() => automations.id),
  processed: integer('processed').default(0),
  success: integer('success').default(0),
  errors: integer('errors').default(0),
  started_at: timestamp('started_at'),
  completed_at: timestamp('completed_at'),
  status: varchar('status', { length: 50 }).default('RUNNING'),
}, (table) => ({
  automationIdx: index().on(table.automation_id),
}));

// ERRORS
export const errors = pgTable('errors', {
  id: serial('id').primaryKey(),
  automation_id: integer('automation_id').references(() => automations.id),
  lead_id: integer('lead_id').references(() => leads.id),
  error_type: varchar('error_type', { length: 100 }).notNull(),
  message: text('message').notNull(),
  context: json('context'),
  resolved: boolean('resolved').default(false),
  created_at: timestamp('created_at').defaultNow(),
}, (table) => ({
  automationIdx: index().on(table.automation_id),
  leadIdx: index().on(table.lead_id),
  typeIdx: index().on(table.error_type),
}));

// SUPPRESSION LIST
export const suppression_list = pgTable('suppression_list', {
  id: serial('id').primaryKey(),
  email: varchar('email', { length: 255 }).unique().notNull(),
  reason: varchar('reason', { length: 255 }),
  added_at: timestamp('added_at').defaultNow(),
}, (table) => ({
  emailIdx: uniqueIndex().on(table.email),
}));

// SETTINGS
export const settings = pgTable('settings', {
  id: serial('id').primaryKey(),
  key: varchar('key', { length: 255 }).unique().notNull(),
  value: text('value'),
  type: varchar('type', { length: 50 }),
  updated_at: timestamp('updated_at').defaultNow(),
}, (table) => ({
  keyIdx: uniqueIndex().on(table.key),
}));

// RELATIONS
export const leadsRelations = relations(leads, ({ many }) => ({
  audits: many(audits),
  contacts: many(contacts),
  emails: many(emails),
  activities: many(activities),
  follow_ups: many(follow_ups),
  demos: many(demos),
}));

export const auditsRelations = relations(audits, ({ one, many }) => ({
  lead: one(leads, { fields: [audits.lead_id], references: [leads.id] }),
  checks: many(audit_checks),
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

export const automationsRelations = relations(automations, ({ many }) => ({
  automation_runs: many(automation_runs),
}));

export const automationRunsRelations = relations(automation_runs, ({ one }) => ({
  automation: one(automations, {
    fields: [automation_runs.automation_id],
    references: [automations.id],
  }),
}));

export const auditChecksRelations = relations(audit_checks, ({ one }) => ({
  audit: one(audits, { fields: [audit_checks.audit_id], references: [audits.id] }),
}));

export const emailEventsRelations = relations(email_events, ({ one }) => ({
  email: one(emails, { fields: [email_events.email_id], references: [emails.id] }),
}));

export const activitiesRelations = relations(activities, ({ one }) => ({
  lead: one(leads, { fields: [activities.lead_id], references: [leads.id] }),
}));

export const followUpsRelations = relations(follow_ups, ({ one }) => ({
  lead: one(leads, { fields: [follow_ups.lead_id], references: [leads.id] }),
  campaign: one(campaigns, { fields: [follow_ups.campaign_id], references: [campaigns.id] }),
}));

export const demosRelations = relations(demos, ({ one }) => ({
  lead: one(leads, { fields: [demos.lead_id], references: [leads.id] }),
}));

export const campaignsRelations = relations(campaigns, ({ one, many }) => ({
  email_account: one(email_accounts, { fields: [campaigns.email_account_id], references: [email_accounts.id] }),
  campaign_leads: many(campaign_leads),
  emails: many(emails),
}));
