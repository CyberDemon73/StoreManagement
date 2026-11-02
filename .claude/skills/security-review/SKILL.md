---
name: security-review
description: Run the Avenue Stock security checklist (authz matrix, seller field stripping, headers, rate limits, input validation, uploads, secrets, dependencies). Use at the end of every sprint, before any public deploy, or when the user says /security-review; "full" runs every automated check and a manual pass.
---

# /security-review [full]

Report each item as PASS / FAIL / N/A with the command or file that proves it. Fix FAILs before finishing unless the user says otherwise. Use the Superpowers systematic-debugging skill for any FAIL you cannot explain.

## A. Authorisation
- [ ] `pnpm test -t authz-matrix` — every route in `route-manifest.ts` × every role returns the expected status.
- [ ] `pnpm test -t seller-stripping` — no cost/profit keys in any SELLER response.
- [ ] grep: no route file without `withAuth(` or `public: true`.
- [ ] Ownership filters present in `services/sales.ts` and `services/returns.ts` for SELLER.
- [ ] Last-admin guards tested.

## B. Authentication & sessions
- [ ] Argon2id params as per docs/SECURITY.md; dummy-hash on unknown email.
- [ ] Cookie flags: `__Host-`, HttpOnly, Secure, SameSite=Lax (check `curl -i` on login).
- [ ] Session hash stored, not raw token (`grep -n "sha256" src/lib/auth.ts`).
- [ ] Rotation on login and password change; revoke on disable/role change (tests).
- [ ] Lockout + rate limits tested (`pnpm test -t lockout`).
- [ ] `/setup` refuses when users exist and without `SETUP_TOKEN`.

## C. Input & output
- [ ] Every Zod schema is `.strict()` (`grep -L "strict()" src/schemas/*.ts` returns nothing).
- [ ] Query coercion and sort whitelists in place.
- [ ] Fuzz `GET /products?q=` with `' OR 1=1 --`, `%`, `_`, 10 KB string → 200 or 400, never 500.
- [ ] Uploads: magic-byte check, size cap, re-encode with sharp, random names.
- [ ] CSV export escapes formula-leading cells.
- [ ] Errors never include stack traces or SQL (`grep -rn "stack" src/lib/http.ts`).

## D. Transport & headers
- [ ] `curl -I https://<preview-url>` shows HSTS, CSP with nonce, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy.
- [ ] CSRF: mutation with foreign `Origin` → 403 (test).
- [ ] `X-Requested-With` enforced on API mutations.

## E. Data integrity
- [ ] All stock mutations go through `applyMovement` (`grep -rn "set({ quantity" src/` returns only services/stock.ts).
- [ ] `pnpm stock:verify` passes on seed DB.
- [ ] Concurrency test for last-unit race passes.
- [ ] Idempotency on `POST /sales` tested.

## F. Secrets & dependencies
- [ ] `git log -p | grep -iE "(api_key|secret|token)=" ` returns nothing suspicious; `.env` is git-ignored.
- [ ] `.env.example` lists every variable used (`grep -rhoE "process\.env\.[A-Z_]+" src | sort -u` vs file).
- [ ] `pnpm audit --audit-level=high` clean.
- [ ] Cron routes require `CRON_SECRET`.

## G. Full mode extras
- [ ] Manual walk-through as SELLER in the UI: try to reach every manager URL directly (expect 403 page).
- [ ] Review audit log coverage: every mutation route calls `audit(` (grep count equals mutation route count).
- [ ] Check Vercel env separation (Preview vs Production) and that preview deployments cannot reach production DB.
- [ ] Threat-model note added to `docs/SECURITY.md` for anything new this sprint.

End with a 5-line summary and the list of FAILs fixed.
