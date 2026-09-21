CREATE TABLE "login_attempts" (
	"identifier" varchar(255) PRIMARY KEY NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"first_attempt_at" timestamp DEFAULT now() NOT NULL,
	"locked_until" timestamp
);
--> statement-breakpoint
CREATE INDEX "login_attempts_locked_idx" ON "login_attempts" USING btree ("locked_until");