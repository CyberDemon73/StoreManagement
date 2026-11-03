-- Rollback: DROP TABLE notifications, known_devices; DROP TYPE notification_kind; ALTER TABLE settings DROP COLUMN date_format, DROP COLUMN require_phone_on_transfer, DROP COLUMN receipt_show_logo, DROP COLUMN large_refund_alert; (enum value INVITED cannot be removed without recreating user_status). DELETE the 0008 row from drizzle.__drizzle_migrations.
CREATE TYPE "public"."notification_kind" AS ENUM('LOW_STOCK', 'LARGE_REFUND', 'NEW_DEVICE_LOGIN', 'COUNT_APPLIED');--> statement-breakpoint
ALTER TYPE "public"."user_status" ADD VALUE 'INVITED';--> statement-breakpoint
CREATE TABLE "known_devices" (
	"user_id" uuid NOT NULL,
	"device_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "known_devices_user_id_device_hash_pk" PRIMARY KEY("user_id","device_hash")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"href" text,
	"action_label" text,
	"dedupe_key" text,
	"payload" jsonb,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "date_format" text DEFAULT 'DD/MM/YYYY' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "require_phone_on_transfer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "receipt_show_logo" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "large_refund_alert" integer DEFAULT 100000 NOT NULL;--> statement-breakpoint
ALTER TABLE "known_devices" ADD CONSTRAINT "known_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_user_read_created_idx" ON "notifications" USING btree ("user_id","read_at","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_unread_dedupe_unique" ON "notifications" USING btree ("user_id","dedupe_key") WHERE "notifications"."read_at" is null and "notifications"."dedupe_key" is not null;