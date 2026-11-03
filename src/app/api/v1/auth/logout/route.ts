import { clearSessionCookieHeader, withAuth } from '@/lib/auth';
import { noContent } from '@/lib/http';
import { logout } from '@/services/auth';

export const runtime = 'nodejs';

export const POST = withAuth({ auth: true }, async (_req, { db, user, req: ctx }) => {
  if (user) await logout(db, user, ctx);
  return noContent({ 'Set-Cookie': clearSessionCookieHeader() });
});
