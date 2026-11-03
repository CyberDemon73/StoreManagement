# Frontend — Implementation Plan

> Source: the Claude Design canvas "Avenue Stock Frontend" (42 artboards) and `starter-kit/01-FRONTEND-PROMPT-CLAUDE-DESIGN.md`. This plan builds the React + TypeScript + Tailwind frontend **inside this Next.js app** (not in a separate `frontend-handoff/` folder) so it typechecks and builds with the backend from day one. All data comes from a typed mock client until the API routes exist; see `FRONTEND-HANDOFF.md` for the swap.

**Goal:** every screen in the brief (§6, 29 areas) reachable from the App Router, role-aware, responsive at mobile / tablet / desktop, with loading / empty / error / offline states, PWA manifest and print styles.

**Architecture:**
- `src/app/(auth)/*` public pages (login, forgot, reset, set-password, setup).
- `src/app/(app)/*` authenticated pages, wrapped by `AppShell` (sidebar ≥1280, icon rail 768–1279, bottom tab bar <768). Each page is a thin file that renders a screen from `src/screens/<area>/`.
- `src/components/ui/*` primitives; `src/components/app/*` app-level composites (shell, variant matrix, receipt, charts, search, notifications).
- `src/lib/api.ts` typed client. `USE_MOCK = true` routes every call to `src/mock/store.ts` (in-memory, mutable, seeded from `src/mock/data.ts`); `false` uses `fetch` against `/api/v1`. Response shapes follow `docs/API-SPEC.md`.
- `src/lib/auth-context.tsx` holds the session, acting role, `viewAsSeller`, `can(permission)` (reuses `src/lib/permissions.ts`).
- Tokens live in `src/app/globals.css` as CSS variables mapped to Tailwind v4 `@theme` colors; dark mode swaps the variables (class `.dark` or `prefers-color-scheme`).

**Tech:** Next.js 15 App Router, React 19, TypeScript strict, Tailwind v4, lucide-react, recharts.

## Tasks

- [x] 1. Tokens + Tailwind theme (`globals.css`), root layout with Inter, manifest, theme bootstrap. Verify: `pnpm typecheck`.
- [x] 2. `src/types.ts`, `src/lib/format.ts`, `src/lib/cn.ts`. Verify: typecheck.
- [x] 3. Mock data (`src/mock/data.ts`, seeded PRNG: 3 brands, 6 categories, 40 products, ~250 variants, 120 sales / 60 days, movements, users, settings, notifications, audit) + mutable store + `src/lib/api.ts` + `useApi` hook. Verify: typecheck; `node` smoke of invariants (Σ movements = qty).
- [x] 4. UI primitives (`src/components/ui`) and app composites (`src/components/app`), `AuthProvider`, `ToastProvider`, `ThemeProvider`, route guards.
- [x] 5. Screens: auth (login + states, forgot, reset, set-password, setup), dashboard, products list/detail/edit, POS (+ success), stock (receive, adjust, movements, low, count), sales (+ detail drawer, return), analytics, catalog, users, settings, audit, labels, notifications, global search, seller home / products / my-sales / profile, 404 / 403 / expired / offline, components gallery.
- [x] 6. PWA: `public/manifest.json`, icons, install prompt, update toast, offline page; print stylesheet for receipt and labels.
- [x] 7. `pnpm typecheck`, `pnpm lint`, `pnpm build` green. `FRONTEND-HANDOFF.md` written.

## Verification
```
pnpm typecheck && pnpm lint && pnpm build
pnpm dev  →  /login (omar@avenue.eg / any 10+ char password) → /dashboard, View as seller, /sell
```
