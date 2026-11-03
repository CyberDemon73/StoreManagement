-- rollback: DROP INDEX IF EXISTS "variants_sku_trgm_idx"; DROP INDEX IF EXISTS "variants_low_stock_idx";
CREATE INDEX "variants_sku_trgm_idx" ON "variants" USING gin ("sku" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "variants_low_stock_idx" ON "variants" USING btree ("product_id") WHERE "variants"."is_active" and "variants"."quantity" <= "variants"."low_stock_threshold";