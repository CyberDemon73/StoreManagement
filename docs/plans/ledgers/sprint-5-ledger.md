# SDD ledger — plan: docs/plans/sprint-5.md

Pre-flight:
- T1 schema + forced-change ↔ T2/T3/T4: shared columns/tables fixed in plan — clean
- T2 modifies services/auth.ts login (INVITED); T4 modifies login (new device) — Ruling: T4 adds the device hook via an exported function call placed by T2? No: T4 owns the login hook, T2 owns only the INVITED check; both edit services/auth.ts login — sequence: T2 first edit is one line; T4 told to re-read and Edit narrowly — cost: possible Edit retry
- Ruling: product call — only ADMIN may grant/remove ADMIN or touch ADMIN accounts (managers have users.manage too) — cost if wrong: a manager cannot promote a peer to admin without an admin
Task 1: complete (commits d9d2b6b..d899e64, tests: pnpm -s vitest run tests/db/admin-schema tests/auth/must-change → [2m   Duration [22m 2.47s[2m (transform 224ms, setup 981ms, collect 449ms, tests 2.45s, environment 0ms, prepare 360ms)[22m)
Task 4: complete (content in 9397e9f — orchestrator's commit swept the shared index, so it also carries Task 4 + part of Task 2 under the message 'fix(db): size presets…'; tests/notifications 18; full suite 890) — Ruling: no history rewrite while agents run; future orchestrator commits use 'git commit -- <paths>' — cost: misleading commit message only
Task 4: Ruling: marking notifications read is not audited (per-user read state, noise) — cost: no audit trail of who read what
Task 2: complete (9397e9f + 40e8f07; tests/users + accept-invite) — subagent; Ruling: admin-removing changes serialise on pg_advisory_xact_lock(avenue:admins); enable/reset on INVITED → 409 — cost: none
Task 3: complete (3adea8b; settings 27, profile 7, audit 5) — subagent; Ruling: blank filter = no filter; no-op PATCH writes nothing
Integration: suite 890/890, typecheck/lint/audit green, build green in temp worktree
Review: general "ready with fixes"; adversarial no Critical, 2 Important (reset links survive disable/admin reset/password change; silent peer TEMP reset)
Fix pass: ea37f79 (reset-token invalidation + ACTIVE check, ACCOUNT_RESET to admins + target email, invite resend, enable keeps INVITED, /me/password throttle, deviceLabel, PATCH non-empty, must-change flow test; migration 0009), 0564cfc (blank text → null, largeRefundAlert ≥ 1, idle ≤ absolute×24, absolute ≤ 30, LOW_STOCK only on decreases), b79ae9d + 6fbc7dc (API-SPEC rows, DECISIONS, email logs without recipient)
Deferred to Sprint 6: notification/known-device retention cron; shortening live sessions when sessionAbsoluteDays drops; audit action naming (user.password_reset vs admin reset)
Final: suite 925/925, typecheck/lint clean, audit 0 high (6 moderate), build green in temp worktree. Sprint 5 closed.
