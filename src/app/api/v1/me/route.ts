import { withAuth } from '@/lib/auth';
import { json } from '@/lib/http';
import { parse } from '@/lib/validate';
import { requireUser } from '@/services/products';
import { meBody } from '@/schemas/profile';
import { updateProfile } from '@/services/profile';

export const runtime = 'nodejs';

export const PATCH = withAuth({ auth: true }, async (req, { db, user, req: ctx }) => {
  const body = await parse(meBody, req);
  return json({ user: await updateProfile(db, requireUser(user), ctx, body) });
});
