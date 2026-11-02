# Avenue Stock

Inventory, sales and reporting for a single retail store with sized/colored products. Next.js + Drizzle + Neon Postgres, deployed on Vercel. Installable PWA for phone, iPad and desktop. Roles: Admin, Manager, Seller.

## Quick start
```bash
pnpm i
cp .env.example .env     # see docs/DEPLOYMENT.md for each value
pnpm db:migrate && pnpm db:seed
pnpm dev                 # http://localhost:3000/setup on first run
pnpm test
```

## Working with Claude Code
1. Install Superpowers once: see `docs/SUPERPOWERS.md`.
2. Open Claude Code in this folder. It reads `CLAUDE.md` automatically.
3. Run sprints: `/sprint 0`, `/sprint 1`, … (checklists in `docs/SPRINTS.md`).
4. Other skills: `/api-endpoint`, `/db-migration`, `/analytics-query`, `/security-review`.

## Docs
| File | Purpose |
|---|---|
| `CLAUDE.md` | Rules and workflow for Claude Code |
| `docs/DATA-MODEL.md` | Tables, invariants, derived rules |
| `docs/API-SPEC.md` | Every endpoint, body, response, permission |
| `docs/ACCESS-MATRIX.md` | Roles × permissions × pages |
| `docs/SECURITY.md` | Hardening requirements |
| `docs/SPRINTS.md` | Backend sprint checklists |
| `docs/DEPLOYMENT.md` | Free-tier setup on Vercel/Neon/Upstash/Resend |
| `docs/SUPERPOWERS.md` | Engineering workflow plugin |
| `docs/DECISIONS.md` | Running log of decisions |
| `docs/plans/` | Superpowers plans per sprint |

## Frontend
Designed in one shot with Claude Design (prompt in the kit's `01-FRONTEND-PROMPT-CLAUDE-DESIGN.md`). Drop the output in `frontend-handoff/` and run the "Wire the Claude Design frontend" prompt from `03-BACKEND-KICKOFF-PROMPT-CLAUDE-CODE.md`.

## Scripts
`dev` · `build` · `start` · `lint` · `typecheck` · `test` · `db:generate` · `db:migrate` · `db:seed` · `stock:verify`
