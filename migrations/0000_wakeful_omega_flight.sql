CREATE TABLE "activities" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"activity_type" varchar(100) NOT NULL,
	"description" text,
	"metadata" json,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"audit_id" integer NOT NULL,
	"check_number" integer NOT NULL,
	"check_name" varchar(255) NOT NULL,
	"status" varchar(50) DEFAULT 'NOT_VERIFIED' NOT NULL,
	"evidence" text,
	"problem" text,
	"impact" text,
	"priority" varchar(20),
	"checked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audits" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"url" varchar(500),
	"overall_status" varchar(50) DEFAULT 'NOT_VERIFIED' NOT NULL,
	"overall_score" integer DEFAULT 0 NOT NULL,
	"fetch_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"automation_id" integer NOT NULL,
	"processed" integer DEFAULT 0 NOT NULL,
	"success" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"status" varchar(50) DEFAULT 'RUNNING' NOT NULL,
	"detail" json
);
--> statement-breakpoint
CREATE TABLE "automations" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"config" json,
	"status" varchar(50) DEFAULT 'ACTIVE' NOT NULL,
	"last_run" timestamp,
	"next_run" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"lead_id" integer NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"status" varchar(50) DEFAULT 'ACTIVE' NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"target_filter" json,
	"sequence" json,
	"email_account_id" integer,
	"daily_limit" integer DEFAULT 50 NOT NULL,
	"status" varchar(50) DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"contact_name" varchar(255),
	"contact_email" varchar(255) NOT NULL,
	"contact_phone" varchar(40),
	"contact_role" varchar(100),
	"is_primary" boolean DEFAULT true NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demos" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"scheduled_at" timestamp,
	"completed_at" timestamp,
	"notes" text,
	"interested" boolean DEFAULT false NOT NULL,
	"status" varchar(50) DEFAULT 'SCHEDULED' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255),
	"provider" varchar(50) DEFAULT 'smtp' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"daily_limit" integer DEFAULT 100 NOT NULL,
	"hourly_limit" integer DEFAULT 20 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"email_id" integer NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"event_data" json,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emails" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer,
	"lead_id" integer NOT NULL,
	"contact_id" integer,
	"from_email" varchar(255) NOT NULL,
	"to_email" varchar(255) NOT NULL,
	"subject" varchar(500) NOT NULL,
	"body" text NOT NULL,
	"status" varchar(50) DEFAULT 'PENDING' NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"scheduled_at" timestamp DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"next_retry_at" timestamp,
	"last_error" text,
	"blocked_reason" varchar(100),
	"provider_message_id" varchar(255),
	"locked_at" timestamp,
	"locked_by" varchar(64),
	"sent_at" timestamp,
	"delivered_at" timestamp,
	"bounced_at" timestamp,
	"opened_at" timestamp,
	"clicked_at" timestamp,
	"replied_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "errors" (
	"id" serial PRIMARY KEY NOT NULL,
	"automation_id" integer,
	"lead_id" integer,
	"error_type" varchar(100) NOT NULL,
	"message" text NOT NULL,
	"context" json,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp,
	"resolved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follow_ups" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"campaign_id" integer,
	"sequence_number" integer DEFAULT 1 NOT NULL,
	"scheduled_at" timestamp NOT NULL,
	"sent_at" timestamp,
	"status" varchar(50) DEFAULT 'PENDING' NOT NULL,
	"cancel_reason" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_locks" (
	"key" varchar(100) PRIMARY KEY NOT NULL,
	"owner" varchar(64) NOT NULL,
	"acquired_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_name" varchar(255) NOT NULL,
	"category" varchar(100),
	"subcategory" varchar(100),
	"city" varchar(100),
	"province" varchar(100),
	"country" varchar(100),
	"address" text,
	"phone" varchar(40),
	"email" varchar(255),
	"website" varchar(500),
	"google_url" varchar(500),
	"instagram_url" varchar(500),
	"facebook_url" varchar(500),
	"linkedin_url" varchar(500),
	"source" varchar(100),
	"source_url" text,
	"dedupe_key" varchar(255),
	"status" varchar(50) DEFAULT 'NEW' NOT NULL,
	"priority" varchar(20) DEFAULT 'medium' NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_contact_at" timestamp,
	"next_follow_up_at" timestamp,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(255) NOT NULL,
	"value" text,
	"type" varchar(50),
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppression_list" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"reason" varchar(255),
	"added_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"full_name" varchar(255),
	"role" varchar(50) DEFAULT 'admin' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_checks" ADD CONSTRAINT "audit_checks_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audits" ADD CONSTRAINT "audits_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_email_account_id_email_accounts_id_fk" FOREIGN KEY ("email_account_id") REFERENCES "public"."email_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demos" ADD CONSTRAINT "demos_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_email_id_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."emails"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "errors" ADD CONSTRAINT "errors_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "errors" ADD CONSTRAINT "errors_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_lead_idx" ON "activities" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "activities_type_idx" ON "activities" USING btree ("activity_type");--> statement-breakpoint
CREATE INDEX "activities_created_idx" ON "activities" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_checks_audit_idx" ON "audit_checks" USING btree ("audit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_checks_audit_number_uniq" ON "audit_checks" USING btree ("audit_id","check_number");--> statement-breakpoint
CREATE INDEX "audits_lead_idx" ON "audits" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "automation_runs_automation_idx" ON "automation_runs" USING btree ("automation_id");--> statement-breakpoint
CREATE INDEX "automation_runs_started_idx" ON "automation_runs" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "automations_key_uniq" ON "automations" USING btree ("key");--> statement-breakpoint
CREATE INDEX "automations_status_idx" ON "automations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "campaign_leads_campaign_idx" ON "campaign_leads" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "campaign_leads_lead_idx" ON "campaign_leads" USING btree ("lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_leads_pair_uniq" ON "campaign_leads" USING btree ("campaign_id","lead_id");--> statement-breakpoint
CREATE INDEX "campaigns_status_idx" ON "campaigns" USING btree ("status");--> statement-breakpoint
CREATE INDEX "contacts_lead_idx" ON "contacts" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "contacts_email_idx" ON "contacts" USING btree ("contact_email");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_lead_email_uniq" ON "contacts" USING btree ("lead_id","contact_email");--> statement-breakpoint
CREATE INDEX "demos_lead_idx" ON "demos" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "demos_status_idx" ON "demos" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "email_accounts_email_uniq" ON "email_accounts" USING btree ("email");--> statement-breakpoint
CREATE INDEX "email_events_email_idx" ON "email_events" USING btree ("email_id");--> statement-breakpoint
CREATE INDEX "email_events_type_idx" ON "email_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "emails_lead_idx" ON "emails" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "emails_status_idx" ON "emails" USING btree ("status");--> statement-breakpoint
CREATE INDEX "emails_sent_at_idx" ON "emails" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "emails_from_sent_idx" ON "emails" USING btree ("from_email","sent_at");--> statement-breakpoint
CREATE INDEX "emails_scheduled_idx" ON "emails" USING btree ("scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "emails_idempotency_uniq" ON "emails" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "errors_automation_idx" ON "errors" USING btree ("automation_id");--> statement-breakpoint
CREATE INDEX "errors_lead_idx" ON "errors" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "errors_type_idx" ON "errors" USING btree ("error_type");--> statement-breakpoint
CREATE INDEX "errors_resolved_idx" ON "errors" USING btree ("resolved");--> statement-breakpoint
CREATE INDEX "follow_ups_lead_idx" ON "follow_ups" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "follow_ups_status_idx" ON "follow_ups" USING btree ("status");--> statement-breakpoint
CREATE INDEX "follow_ups_scheduled_idx" ON "follow_ups" USING btree ("scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "follow_ups_lead_campaign_step_uniq" ON "follow_ups" USING btree ("lead_id","campaign_id","sequence_number");--> statement-breakpoint
CREATE INDEX "job_locks_expires_idx" ON "job_locks" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "leads_priority_idx" ON "leads" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "leads_category_idx" ON "leads" USING btree ("category");--> statement-breakpoint
CREATE INDEX "leads_city_idx" ON "leads" USING btree ("city");--> statement-breakpoint
CREATE INDEX "leads_email_idx" ON "leads" USING btree ("email");--> statement-breakpoint
CREATE INDEX "leads_phone_idx" ON "leads" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "leads_website_idx" ON "leads" USING btree ("website");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_dedupe_key_uniq" ON "leads" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "leads_created_idx" ON "leads" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "settings_key_uniq" ON "settings" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "suppression_list_email_uniq" ON "suppression_list" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uniq" ON "users" USING btree ("email");