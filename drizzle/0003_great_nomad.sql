-- Rollback: ALTER TABLE "suppliers" DROP CONSTRAINT "suppliers_name_unique"; DROP INDEX "categories_root_name_unique";
CREATE UNIQUE INDEX "categories_root_name_unique" ON "categories" USING btree ("name") WHERE "categories"."parent_id" is null;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_name_unique" UNIQUE("name");