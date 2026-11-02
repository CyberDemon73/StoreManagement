import { sessionCookieHeader, withAuth } from '@/lib/auth';
import { json } from '@/lib/http';
import { parse } from '@/lib/validate';
import { setupBody } from '@/schemas/auth';
import { setup } from '@/services/auth';

export const runtime = 'nodejs';

export const POST = withAuth({ public: true }, async (req, { db, req: ctx }) => {
  const body = await parse(setupBody, req);
  const { user, session } = await setup(db, body, ctx);
  return json({ user }, 201, { 'Set-Cookie': sessionCookieHeader(session.raw, session) });
});
