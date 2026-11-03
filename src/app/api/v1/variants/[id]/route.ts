import { withAuth } from '@/lib/auth';
import { json, noContent } from '@/lib/http';
import { parse } from '@/lib/validate';
import { idParams } from '@/schemas/catalog';
import { variantPatchBody } from '@/schemas/products';
import { forRole } from '@/serializers/catalog';
import { requireUser } from '@/services/products';
import { deleteVariant, patchVariant } from '@/services/variants';

export const runtime = 'nodejs';

export const PATCH = withAuth({ permission: 'variants.write' }, async (req, { db, user, params, req: ctx }) => {
  const { id } = await parse(idParams, params);
  const body = await parse(variantPatchBody, req);
  const actor = requireUser(user);
  const out = await patchVariant(db, actor, id, body, ctx);
  return json(forRole(out, actor.role));
});

export const DELETE = withAuth({ permission: 'variants.write' }, async (_req, { db, user, params, req: ctx }) => {
  const { id } = await parse(idParams, params);
  await deleteVariant(db, requireUser(user), id, ctx);
  return noContent();
});
