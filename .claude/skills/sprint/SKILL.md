---
name: sprint
description: Run one Avenue Stock backend sprint end-to-end. Use when the user says /sprint N, "start sprint N", "do sprint N", or "continue the sprint". Loads the sprint checklist from docs/SPRINTS.md and drives it through the Superpowers workflow (brainstorm → write-plan → execute-plan → verification → security review).
---

# /sprint <N> [notes]

## Steps
1. **Load context.** Read `CLAUDE.md`, `docs/SPRINTS.md` (only Sprint N), and whichever of `docs/DATA-MODEL.md`, `docs/API-SPEC.md`, `docs/ACCESS-MATRIX.md`, `docs/SECURITY.md` the sprint touches. Read `docs/DECISIONS.md` and `docs/plans/` for prior context.
2. **Confirm Superpowers is active** (`/plugin list`). If not, stop and tell the user to install it per `docs/SUPERPOWERS.md`.
3. **Brainstorm** — invoke the Superpowers brainstorming skill with the sprint goal and checklist. Output: a short list of open questions. Answer from the docs where possible; ask the user only for product decisions.
4. **Write plan** — invoke the Superpowers write-plan skill. Save to `docs/plans/sprint-N.md`. Every step must list: files to create/modify, the **test written first**, the command that proves it (`pnpm test -t …`), and the permission key for any new route. Use `/api-endpoint`, `/db-migration`, `/analytics-query` conventions inside the plan.
5. **Execute plan** — invoke the Superpowers execute-plan skill. Batches of 2–4 steps; after each batch: run `pnpm typecheck && pnpm lint && pnpm test`, commit (`feat(scope): …`), tick the checkbox in `docs/SPRINTS.md`.
6. **Verify** — Superpowers verification-before-completion: paste the actual passing output for the sprint's "Done when" line. Run `pnpm build`.
7. **Security review** — run `/security-review` (full on sprints 0, 3 and 6).
8. **Report** — summary: done / deferred (with reason) / decisions added / env vars needed / how to test manually.

## Rules
- Do not start coding before `docs/plans/sprint-N.md` exists.
- A checkbox is ticked only after its test passes and the command output is shown.
- If a checkbox depends on a later sprint, stub minimally, note it in the plan under "Deferred", and leave the box unticked.
