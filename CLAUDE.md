# CLAUDE.md — Avenue Stock

Inventory, sales and reporting app for a single retail store with sized/colored products. Public web app, PWA, three roles. Free hosting: Vercel Hobby + Neon Postgres + Upstash Redis + Vercel Blob + Resend.

## Source of truth
Read in this order before any task: `docs/DATA-MODEL.md` → `docs/API-SPEC.md` → `docs/ACCESS-MATRIX.md` → `docs/SECURITY.md` → `docs/SPRINTS.md`. Record any new decision in `docs/DECISIONS.md`.

## Superpowers workflow (required)
This repo uses the **Superpowers** plugin (`obra/superpowers`). If `/plugin list` does not show it, install it first (see `docs/SUPERPOWERS.md`) and start a fresh session.

For every sprint or non-trivial feature, follow this order and do not skip steps:
1. `/superpowers:brainstorm` — clarify scope against the docs; surface open questions **before** any code.
2. `/superpowers:write-plan` — produce a step-by-step plan saved to `docs/plans/sprint-N.md` (or `docs/plans/<feature>.md`). Each step names the files, the test to write first, and the verification command.
3. `/superpowers:execute-plan` — execute in small batches with review checkpoints; commit after each batch.
4. During execution the **test-driven-development** skill is mandatory for services and route handlers (red → green → refactor); **systematic-debugging** for any failing test or bug; **verification-before-completion** before declaring any checkbox done (show the passing command output, not a claim).
5. Finish with `/security-review` (project skill) and a `requesting-code-review`-style self-review pass.

Project skills (`/api-endpoint`, `/db-migration`, `/analytics-query`, `/sprint`) are the *what*; Superpowers skills are the *how*. `/sprint N` already calls the Superpowers chain for you.

## Stack (do not swap without a note in DECISIONS.md)
- Next.js 15 App Router, TypeScript strict, pnpm, Tailwind.
- Drizzle ORM + `@neondatabase/serverless` (HTTP driver). Migrations with `drizzle-kit`.
- Zod for all input validation. Argon2id (`@node-rs/argon2`) for passwords.
- Upstash Redis + `@upstash/ratelimit`. Vercel Blob for images. Resend for email.
- Vitest for tests. pino for logs.

## Layout
```
src/
  app/api/v1/**/route.ts   # thin route handlers: parse → authorize → service → serialize
  app/(app)/**             # frontend pages (from Claude Design handoff)
  db/schema/*.ts           # one file per domain (auth, catalog, stock, sales, system)
  db/client.ts  db/migrate.ts  db/seed.ts
  services/*.ts            # business logic, transaction boundaries live here
  analytics/*.ts           # SQL-first report queries
  lib/auth.ts              # session, withAuth, permissions
  lib/validate.ts          # parse(schema, req), error envelope
  lib/money.ts             # integer minor units helpers
  lib/audit.ts  lib/ratelimit.ts  lib/http.ts
  serializers/*.ts         # role-aware output shaping (strip costPrice for SELLER)
tests/                     # vitest, one file per route group + services
docs/                      # specs (source of truth) + docs/plans/ (Superpowers plans)
.claude/skills/            # api-endpoint, db-migration, security-review, sprint, analytics-query
```

## Non-negotiable rules
1. **Stock changes only through `applyMovement()`** in `src/services/stock.ts`, inside a transaction with `SELECT … FOR UPDATE` on the variant row. Never `UPDATE variants SET quantity` elsewhere.
2. **Money = integer minor units.** Never float. `lib/money.ts` formats for display only.
3. **Server computes everything:** totals, discounts, sale numbers, permissions. Client values are hints at most.
4. **Every route** uses `withAuth()` with an explicit permission from `docs/ACCESS-MATRIX.md` and a strict Zod schema (`.strict()`). Unknown keys → 400.
5. **Sellers never receive** `costPrice`, `defaultCost`, margin or profit fields. Use `serializers/`.
6. **Audit every mutation** via `audit()` with before/after.
7. **Errors** always `{ error: { code, message, fields? } }` with correct HTTP status. No stack traces to clients.
8. **Dates** stored UTC `timestamptz`; reports take `tz` from settings.
9. **No secrets in code.** `.env.example` lists every variable with a comment.
10. **Tests before "done":** each endpoint gets at least a happy-path and an authz test, written first (TDD).

## Commands
```
pnpm dev · pnpm build · pnpm test · pnpm lint · pnpm typecheck
pnpm db:generate · pnpm db:migrate · pnpm db:seed · pnpm stock:verify
```

## Skills (invoke with /name)
- `/sprint <n>` — load sprint n from docs/SPRINTS.md and run it through brainstorm → write-plan → execute-plan.
- `/api-endpoint <METHOD> <path>` — scaffold route + schema + service + serializer + tests (test first).
- `/db-migration <description>` — change schema safely, generate + review migration.
- `/analytics-query <report>` — add a report query + endpoint + test using the analytics pattern.
- `/security-review [full]` — checklist pass; `full` runs the whole authz matrix.

## Style
- Small commits, conventional messages (`feat(sales): …`, `fix(auth): …`).
- Named exports, no default exports except Next.js pages/routes.
- Prefer early returns; no clever abstractions before the third use.
- Comments explain *why*, not *what*.

## When unsure
Pick the simplest well-maintained option, write one line in `docs/DECISIONS.md`, keep going. Ask the user only for product decisions (pricing rules, permissions), never for library trivia.
