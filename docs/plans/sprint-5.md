# Sprint 5 — Users, settings, audit, notifications — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store administration: user lifecycle with safe guards, invites and forced password change, validated settings, a searchable audit log, per-user notifications from real events, and a self-service profile.

**Architecture:** Same layering. Task 1 lays the schema (migration 0008) and two cross-cutting rules in `withAuth` (forced password change) and the user serializer (`roles`). Then three parallel streams on disjoint files: users + invites (Task 2), settings + profile + audit (Task 3), notifications + producers (Task 4). Shapes mirror `src/types.ts` (`User`, `Settings`, `AuditEntry`, `Notification`).

**Spec:** `docs/SPRINTS.md` (Sprint 5), `docs/API-SPEC.md` (Users, settings, audit, notifications), `docs/ACCESS-MATRIX.md` (`users.manage`, `settings.read.full`, `settings.write`, `audit.read`), `docs/SECURITY.md` (sessions, tokens 48 h invite / 30 min reset, revoke on disable/role change), `docs/DECISIONS.md` (2026-11-05 prefix + timezone contracts), `src/types.ts` + `src/mock/store.ts` (users/settings/audit/notifications sections).

## Global Constraints

- Roles today: ADMIN ≈ MANAGER. **Only an ADMIN may create an ADMIN, change any user's role to/from ADMIN, or modify/disable/reset an ADMIN account** (prevents a manager self-promoting). Last active ADMIN cannot be disabled or demoted. Nobody may disable themselves or change their own role.
- Disable, role change, reset-password, revoke-sessions → `revokeAllSessions(userId)`.
- Invite token: 32 random bytes, SHA-256 stored in `password_reset_tokens` with `purpose INVITE`, 48 h, single use. Invited user: `status INVITED`, `passwordHash` = hash of 32 random bytes (unusable), login → 403 `Invitation not accepted`.
- Temporary password: 16 chars from an unambiguous alphabet, returned once in the response as `temporaryPassword`, `mustChangePassword = true`.
- `mustChangePassword` users: every authenticated route except `GET /auth/me`, `POST /auth/logout`, `POST /me/password` returns 403 `FORBIDDEN` with `fields: { password: 'Password change required' }`.
- Settings validation: `timezone` ∈ `pg_timezone_names`; `currency` `/^[A-Z]{3}$/`; `saleNumberPrefix` `/^[A-Z]{1,6}$/` and not `PO`/`SC`; `sellerDiscountCapPct` 0–100 (2 dp); `lowStockDefault` 0–1000; `largeRefundAlert` money; `sessionIdleHours` 1–72; `sessionAbsoluteDays` 1–90; text fields ≤ 500; `logoUrl` https; `sizePresets` ≤ 20 × `{ name ≤ 30, sizes 1..30 × ≤ 20 }`; `colorPresets` ≤ 60 × `{ name ≤ 30, hex #rrggbb }`; `dateFormat` `DD/MM/YYYY|YYYY-MM-DD`. Unknown keys → 400 (so `lockoutEnabled`, `passwordRotationDays`, `nextSaleNumber` are rejected; documented for the frontend).
- Every route in the manifest; every mutation audited; schemas strict; Conventional commits, explicit paths.

## Review Focus

1. A MANAGER promoting themselves (or anyone) to ADMIN, or disabling/resetting an ADMIN → 403. (Task 2.)
2. Disabling or demoting the last active ADMIN → 409; an ADMIN disabling themselves → 409. (Task 2.)
3. A user flagged `mustChangePassword` cannot call any business route until `POST /me/password` succeeds; after it, other sessions are revoked and the current one keeps working. (Tasks 1 and 3.)
4. `PATCH /settings { timezone: 'Mars/Olympus' }` or `{ saleNumberPrefix: 'as-' }` → 400; a valid change is audited with before/after and visible on `GET /auth/me` `settingsPublic`. (Task 3.)
5. A sale that takes a variant to its threshold creates exactly one LOW_STOCK notification per manager, and a second sale while it is unread creates none. (Task 4.)

---

### Task 1: Schema 0008 + forced password change + user shape

**Files:** `src/db/schema/auth.ts` (status enum + INVITED; `knownDevices` table: userId fk cascade, deviceHash text, createdAt, pk(userId, deviceHash)), `src/db/schema/system.ts` (settings + `dateFormat text default 'DD/MM/YYYY'`, `requirePhoneOnTransfer bool default false`, `receiptShowLogo bool default true`, `largeRefundAlert int default 100000`; `notificationKindEnum('notification_kind', ['LOW_STOCK','LARGE_REFUND','NEW_DEVICE_LOGIN','COUNT_APPLIED'])`; `notifications`: id, userId fk cascade not null, kind, title, body, href, actionLabel, dedupeKey text null, payload jsonb, readAt, createdAt; index (userId, readAt, createdAt desc), unique (userId, dedupeKey) where readAt is null — partial unique index), migration 0008 (enum value add via `ALTER TYPE … ADD VALUE` — drizzle emits it; verify not inside a transaction issue on PGlite), `src/serializers/user.ts` (`roles: [role]`, `lastDevice?`, `sessions` count when provided), `src/lib/auth.ts` (forced-change rule), `tests/helpers/db.ts` TABLES.
- [ ] Tests: schema (tables empty; INVITED insertable; notifications partial unique: two unread with same dedupeKey → 23505, after read_at set a new one allowed); forced change: user with mustChangePassword → `GET /stock/low` 403 with `fields.password`, `GET /auth/me` 200, `POST /auth/logout` 204; `toPublicUser` has `roles: ['SELLER']`.
- [ ] RED → GREEN → commit `chore(db): invites, notifications, known devices, settings fields (0008); forced password change`

### Task 2: Users admin + invites (agent)

Routes: `GET /users` (`users.manage`; list with `sessions` = active session count, `lastLoginAt`), `POST /users` `{ name, email, role, mode: 'INVITE'|'TEMP' }` → 201 `{ user, temporaryPassword? }`, `PATCH /users/:id` `{ name?, role? }`, `POST /users/:id/disable|enable`, `POST /users/:id/reset-password` `{ mode: 'EMAIL'|'TEMP' }` → `{ temporaryPassword? }` (EMAIL sends a 30-min reset link via the existing token helper), `POST /users/:id/revoke-sessions`, `POST /auth/accept-invite` `{ token, password }` (public; `publicIpLimiter`; sets password, ACTIVE, marks token used, creates session cookie). Service `src/services/users.ts`; login refuses INVITED with 403 `Invitation not accepted` (modify `services/auth.ts` login only for that check). Tests per Global Constraints + Review Focus 1–2, duplicate email → 409 `fields.email`, invite email captured via `setEmailTransportForTests`, accept-invite expired/reused → 400.

### Task 3: Settings, profile, audit (agent)

Routes: `GET /settings` (`auth`; `settings.read.full` → full `Settings` incl. `nextSaleNumber` from `sale_counters`; else `toPublicSettings`), `PATCH /settings` (`settings.write`; strict partial schema per Global Constraints; tz checked with `select 1 from pg_timezone_names where name = $1`; audit `settings.update` before/after of changed keys only), `PATCH /me` `{ name }`, `POST /me/password` `{ current, next }` (verify current, `passwordSchema` for next, set hash, clear mustChangePassword, revoke all sessions then create a new session and return its cookie; audit), `GET /audit` upgraded: `q` (action/entity ILIKE or entity_id text), `userId`, `entity`, `action`, `from`/`to` (store tz via `localDayBounds`), pagination; rows `AuditEntry` (`userName` join or 'System', `entityLabel` = after/before `number|name|sku|email` else short id, `summary` = action + changed keys). Tests per Review Focus 3–4.

### Task 4: Notifications + producers (agent)

`src/services/notifications.ts`: `notifyManagers(tx, { kind, title, body, href?, actionLabel?, dedupeKey?, payload })` inserts one row per ACTIVE ADMIN/MANAGER with `on conflict do nothing` on the partial unique; `listNotifications(db, user)` unread first then newest, limit 50; `markRead(db, user, id?)`. Routes `GET /notifications` (`auth`), `POST /notifications/:id/read`, `POST /notifications/read-all`. Producers (inside the mutation's transaction, after stock moves): createSale + createAdjustments + applyCount → for each touched variant whose new qty ≤ threshold: LOW_STOCK (dedupeKey `low:<variantId>`, href `/stock/low`); createReturn → LARGE_REFUND when refundAmount > settings.largeRefundAlert; applyCount → COUNT_APPLIED; login → NEW_DEVICE_LOGIN to the user themself when sha256(userAgent) not in known_devices (first ever login just records the device, no notification). Tests per Review Focus 5 + each producer.

### Task 5: Docs, checklist, review

API-SPEC user/settings/notification rows, DECISIONS, SPRINTS ticks; full gates; review; fix pass.
