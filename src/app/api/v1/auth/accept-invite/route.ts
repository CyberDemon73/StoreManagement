import { sessionCookieHeader, withAuth } from '@/lib/auth';
import { json } from '@/lib/http';
import { parse } from '@/lib/validate';
import { acceptInviteBody } from '@/schemas/users';
import { acceptInvite } from '@/services/users';

export const runtime = 'nodejs';

export const POST = withAuth({ public: true }, async (req, { db, req: ctx }) => {
  const body = await parse(acceptInviteBody, req);
  const { user, session } = await acceptInvite(db, body, ctx);
  return json({ user }, 200, { 'Set-Cookie': sessionCookieHeader(session.raw, session) });
});
