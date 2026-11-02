-- Rollback: DROP EXTENSION pg_trgm; DROP EXTENSION citext; (only when no column uses them)
CREATE EXTENSION IF NOT EXISTS citext;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
