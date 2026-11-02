---
name: db-migration
description: Change the Avenue Stock Postgres schema safely with Drizzle (schema file edit, generated migration review, data backfill, index check, docs update). Use whenever a task adds or changes tables, columns, enums or indexes, or when the user says /db-migration.
---

# /db-migration <description>

1. **Design first.** Update `docs/DATA-MODEL.md` with the intended change. Confirm money columns are `integer`, timestamps are `timestamptz`, enums are Postgres enums, FKs have indexes.
2. **Edit schema** in `src/db/schema/<domain>.ts` only. Export the table and relations. Keep one domain per file.
3. **Generate**: `pnpm db:generate` (drizzle-kit). Open the generated SQL in `drizzle/` and **read every line**:
   - no accidental `DROP COLUMN` / `DROP TABLE`
   - enum changes done as `ALTER TYPE … ADD VALUE` (never recreate an enum in use)
   - new NOT NULL columns have a default or a backfill step
   - `CREATE INDEX CONCURRENTLY` is not possible inside a transaction with drizzle-kit — for large tables add the index in a separate migration and document it
4. **Backfill** (if needed): write it as idempotent SQL in the same migration or a `scripts/backfill-<name>.ts`.
5. **Invariants**: if the change touches `variants.quantity` or `stock_movements`, run `pnpm stock:verify` after migrating the seed DB.
6. **Apply locally**: `pnpm db:migrate` against the Neon dev branch; `pnpm db:seed` if schema reset; `pnpm test`.
7. **Rollback note**: add a comment at the top of the migration explaining how to reverse it.
8. Commit `chore(db): <description>` including the migration file. Never edit a migration that has already been applied in production — write a new one.

## Forbidden
- Hand-editing `drizzle/meta/*`.
- Deleting rows referenced by `stock_movements`, `sale_items`, `audit_log`.
- Float/numeric money columns.
