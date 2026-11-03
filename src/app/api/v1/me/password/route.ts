import { sessionCookieHeader, withAuth } from '@/lib/auth';
import { noContent } from '@/lib/http';
import { parse } from '@/lib/validate';
import { requireUser } from '@/services/products';
import { passwordChangeBody } from '@/schemas/profile';
import { changePassword } from '@/services/profile';

export const runtime = 'nodejs';

export const POST = withAuth({ auth: true }, async (req, { db, user, req: ctx }) => {
  const body = await parse(passwordChangeBody, req);
  const session = await changePassword(db, requireUser(user), ctx, body);
  return noContent({ 'Set-Cookie': sessionCookieHeader(session.raw, session) });
});
