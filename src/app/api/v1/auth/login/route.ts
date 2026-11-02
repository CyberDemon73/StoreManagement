import { sessionCookieHeader, withAuth } from '@/lib/auth';
import { json } from '@/lib/http';
import { parse } from '@/lib/validate';
import { loginBody } from '@/schemas/auth';
import { login } from '@/services/auth';

export const runtime = 'nodejs';

export const POST = withAuth({ public: true }, async (req, { db, user: current, req: ctx }) => {
  const body = await parse(loginBody, req);
  const { user, session } = await login(db, body, ctx, current?.sessionId);
  return json({ user }, 200, { 'Set-Cookie': sessionCookieHeader(session.raw, session) });
});
