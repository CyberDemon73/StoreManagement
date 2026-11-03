-- Rollback: DROP INDEX returns_created_at_idx, return_items_return_id_idx, return_items_sale_item_id_idx; DELETE the 0007 row from drizzle.__drizzle_migrations.
CREATE INDEX "return_items_return_id_idx" ON "return_items" USING btree ("return_id");--> statement-breakpoint
CREATE INDEX "return_items_sale_item_id_idx" ON "return_items" USING btree ("sale_item_id");--> statement-breakpoint
CREATE INDEX "returns_created_at_idx" ON "returns" USING btree ("created_at");