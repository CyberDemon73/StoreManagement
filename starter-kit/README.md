# Avenue Stock — Starter Kit

Everything needed to build Avenue Stock with Claude Design (frontend, one shot) and Claude Code (backend, in sprints, with Superpowers).

## What's inside
| File | Use it for |
|---|---|
| `00-PRODUCT-SPEC.md` | Your requirements organized, data model, role/access matrix, analytics list, every screen (required + recommended), security baseline, phasing. Read first. |
| `01-FRONTEND-PROMPT-CLAUDE-DESIGN.md` | Paste into **Claude Design** in one message. Produces the full responsive PWA frontend (React + Tailwind) with mock data and a handoff doc. |
| `02-BACKEND-SPRINTS.md` | The 7 backend sprints (0–6) with checkboxes. Same file lives at `repo/docs/SPRINTS.md`. |
| `03-BACKEND-KICKOFF-PROMPT-CLAUDE-CODE.md` | Install Superpowers, then paste into **Claude Code** to run Sprint 0. Includes follow-up prompts for later sprints, frontend wiring and the final security sweep. |
| `repo/` | Copy this into your new project folder before opening Claude Code: `CLAUDE.md`, `README.md`, `.env.example`, `.gitignore`, `docs/` (data model, API spec, access matrix, security, deployment, Superpowers, decisions), `.claude/skills/` (`sprint`, `api-endpoint`, `db-migration`, `analytics-query`, `security-review`). |

## Order of operations
1. Read `00-PRODUCT-SPEC.md`; change anything you disagree with (e.g. seller discount cap, currency) in the spec **and** in `repo/docs/*` so the prompts stay consistent.
2. Run the frontend prompt in Claude Design. Save its output as `frontend-handoff/` for later.
3. Create the project folder, copy `repo/*` (including `.claude/`), `git init`.
4. In Claude Code: install Superpowers (commands in the kickoff prompt), new session, paste the kickoff prompt → Sprint 0.
5. `/sprint 1` … `/sprint 4` → MVP backend. Set up Vercel/Neon/Upstash per `repo/docs/DEPLOYMENT.md` along the way.
6. Run the "Wire the Claude Design frontend" prompt. Deploy. Run `/security-review full`.
7. `/sprint 5`, `/sprint 6` → users/settings/notifications, hardening, PWA, import/export.

## Keeping things consistent
`repo/docs/API-SPEC.md` and the types in section 9–10 of the frontend prompt describe the same contract. If you change one, change the other.
