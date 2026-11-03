-- Rollback: ALTER TABLE stock_movements DROP COLUMN seq; ALTER TABLE idempotency_keys DROP CONSTRAINT idempotency_keys_user_id_route_key_pk, DROP COLUMN route, ADD PRIMARY KEY (user_id, key); DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations);
DELETE FROM "idempotency_keys";--> statement-breakpoint
ALTER TABLE "idempotency_keys" DROP CONSTRAINT "idempotency_keys_user_id_key_pk";--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "route" text NOT NULL;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_route_key_pk" PRIMARY KEY("user_id","route","key");--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "seq" bigint NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "stock_movements_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);
