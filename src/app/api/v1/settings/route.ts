import { withAuth } from '@/lib/auth';
import { json } from '@/lib/http';
import { can } from '@/lib/permissions';
import { parse } from '@/lib/validate';
import { settingsPatchBody } from '@/schemas/settings';
import { toPublicSettings } from '@/serializers/settings';
import { actorOf, requireUser } from '@/services/products';
import { getFullSettings, getSettings, patchSettings } from '@/services/settings';

export const runtime = 'nodejs';

export const GET = withAuth({ auth: true }, async (_req, { db, user }) => {
  if (user && can(user, 'settings.read.full')) return json(await getFullSettings(db));
  return json(toPublicSettings(await getSettings(db)));
});

export const PATCH = withAuth({ permission: 'settings.write' }, async (req, { db, user, req: ctx }) => {
  const body = await parse(settingsPatchBody, req);
  return json(await patchSettings(db, actorOf(requireUser(user), ctx), body));
});
