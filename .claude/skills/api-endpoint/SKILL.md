---
name: api-endpoint
description: Scaffold a new Avenue Stock API route the standard way (Zod strict schema, withAuth permission, service function, role-aware serializer, tests first). Use whenever adding or changing a route under src/app/api/v1, or when the user says /api-endpoint METHOD /path.
---

# /api-endpoint <METHOD> <path>

Produce these, in this order (TDD: tests before implementation):

1. **Spec check** — find the row in `docs/API-SPEC.md`; if missing, add it and note in `docs/DECISIONS.md`. Pick the permission key from `docs/ACCESS-MATRIX.md`.
2. **Tests** `tests/<area>/<name>.test.ts` (Vitest):
   - happy path with a MANAGER session
   - 401 without session
   - 403 for a role without the permission (SELLER usually)
   - 400 for an invalid/extra field (strict schema)
   - for seller-readable routes: deep-scan response for forbidden keys (`costPrice`, `defaultCost`, `unitCost`, `margin`, `profit`)
   Run them → they must fail (red).
3. **Schema** `src/schemas/<area>.ts`: `export const <name>Body = z.object({...}).strict()`; query schemas use `z.coerce` for numbers and whitelist `sort` values.
4. **Service** `src/services/<area>.ts`: `export async function <verb><Entity>(ctx: { db, user }, input)`. Transaction boundary lives here. Stock changes only via `applyMovement`. Throw `AppError(code, message, fields?)`.
5. **Serializer** `src/serializers/<area>.ts`: `toPublic(entity, role)`; sellers go through `stripCostFields`.
6. **Route** `src/app/api/v1/<path>/route.ts`:
   ```ts
   export const POST = withAuth({ permission: 'sales.create' }, async (req, { user, params }) => {
     const body = await parse(saleCreateBody, req);
     const sale = await createSale({ db, user }, body);
     await audit(user, 'sale.create', 'sale', sale.id, null, sale);
     return json(toPublic(sale, user.role), 201);
   });
   ```
   Rate limit decorators where the spec says so. Add `Idempotency-Key` handling if listed.
7. **Register** the route in `src/lib/route-manifest.ts` (used by the authz matrix test).
8. Run `pnpm test -t <name>` → green. Run `pnpm typecheck && pnpm lint`.
9. Update `docs/API-SPEC.md` if the shape changed. Commit `feat(<area>): <METHOD> <path>`.

## Conventions
- Pagination helper `paginate(query)`; max pageSize 100.
- Money fields are integers; validate `.int().nonnegative()`.
- Never accept `quantity` in variant PATCH bodies.
- Ownership: `where(eq(sales.sellerId, user.id))` inside the service when `user.role === 'SELLER'`.
