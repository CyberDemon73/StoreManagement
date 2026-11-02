# Avenue Stock — Claude Code Kickoff Prompt

> How to use:
> 1. Create an empty folder, copy everything from `repo/` into it (including the hidden `.claude/` folder), `git init`.
> 2. Open Claude Code in that folder and install **Superpowers** first (one-time):
>    ```
>    /plugin marketplace add obra/superpowers-marketplace
>    /plugin install superpowers@superpowers-marketplace
>    ```
>    Then **start a new session** and check `/plugin list` shows it. (Details: `repo/docs/SUPERPOWERS.md`.)
> 3. Paste the prompt below. For later sprints just type `/sprint 1`, `/sprint 2`, …

---

You are building the backend (and later wiring the frontend) of **Avenue Stock**, an inventory, sales and reporting app for a single retail store with sized/colored products. Read `CLAUDE.md` first, then `docs/DATA-MODEL.md`, `docs/API-SPEC.md`, `docs/ACCESS-MATRIX.md`, `docs/SECURITY.md`, `docs/SPRINTS.md` and `docs/SUPERPOWERS.md`. Those files are the source of truth; if something in this message conflicts with them, the docs win and you should tell me.

## Workflow (Superpowers)
Confirm the Superpowers plugin is active (`/plugin list`). If it isn't, stop and tell me. Then work **plan-first**:
1. Use the Superpowers **brainstorming** skill on Sprint 0 — list open questions, answer them from the docs, ask me only about product decisions.
2. Use **write-plan** to produce `docs/plans/sprint-0.md` (files, test-first for each step, verification command).
3. Use **execute-plan** in small batches; **test-driven-development** for every service and route; **systematic-debugging** on any failure; **verification-before-completion** before ticking any checkbox — show the real command output.
4. Finish with `/security-review full`.

## What to do now: Sprint 0
Execute every checkbox in **Sprint 0** of `docs/SPRINTS.md` through the workflow above:
1. Scaffold a Next.js 15 App Router project with TypeScript (strict), Tailwind, ESLint, `src/` directory, pnpm.
2. Set up Drizzle ORM with the Neon HTTP driver; create the Sprint 0 schema (`users`, `sessions`, `password_reset_tokens`, `settings`, `audit_log`) and migrations.
3. Implement auth exactly as `docs/SECURITY.md` describes (Argon2id, DB sessions, `__Host-` cookie, rotation, lockout, rate limits via Upstash).
4. Implement `withAuth` + permission map from `docs/ACCESS-MATRIX.md`, the Zod `parse()` helper with strict schemas, the uniform error envelope, the audit writer, CSRF origin check, and security headers.
5. Implement `POST /setup`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/forgot`, `POST /auth/reset`, `GET /health`.
6. Write Vitest tests for: setup only works once; login + lockout; seller gets 403 on a manager-only route; headers present.
7. Produce `.env.example`, update `README.md` with local + Vercel deployment steps, and leave the project building (`pnpm build`) and tests passing.

## Working rules (also in CLAUDE.md)
- Use the `/api-endpoint` skill whenever you add a route; `/db-migration` whenever you touch the schema; `/security-review` at the end of every sprint. Inside each, Superpowers TDD applies: the test exists and fails before the implementation.
- Do not write application code before `docs/plans/sprint-0.md` exists.
- Never edit `variants.quantity` directly anywhere — all stock changes go through `applyMovement()` (Sprint 2).
- Money is integer minor units. Dates are UTC in the DB.
- Compute totals and permissions on the server; never trust client numbers.
- Keep each route handler thin: validate → authorize → call service in `src/services/*` → serialize. Services are unit-testable without HTTP.
- Prefer small commits per checkbox with conventional commit messages.
- When you need a decision I haven't made (e.g. a library choice not in the docs), pick the simplest well-maintained option, note it in `docs/DECISIONS.md`, and continue.
- At the end, print a short summary: what's done, what's deferred, how to run it, and the exact env vars I must set in Vercel.

Start now with step 1.

---

## Follow-up prompts (copy when ready)

**Sprint N**
```
/sprint 2
```
(The skill loads the checklist and conventions. Add any notes after the command, e.g. `/sprint 2 — also add a CLI to reconcile stock`.)

**Wire the Claude Design frontend**
```
I've placed the Claude Design output in `frontend-handoff/`. Read `frontend-handoff/FRONTEND-HANDOFF.md`, then move screens into `src/app/(app)/...` routes and components into `src/components`, replace the mocked `lib/api.ts` with real fetch calls against our routes (same shapes as docs/API-SPEC.md), add role-aware navigation using `GET /auth/me`, and implement the PWA manifest/service worker from docs/SPRINTS.md Sprint 6. Keep the design tokens untouched. Do it screen by screen in this order: login, app shell, products list, product detail, POS, sales, dashboard, analytics, stock, users, settings. Run the build after each.
```

**Security sweep before going public**
```
/security-review full
```
