import { withAuth } from '@/lib/auth';
import { noContent } from '@/lib/http';
import { parse } from '@/lib/validate';
import { forgotBody } from '@/schemas/auth';
import { forgot } from '@/services/auth';

export const runtime = 'nodejs';

export const POST = withAuth({ public: true }, async (req, { db, req: ctx }) => {
  const body = await parse(forgotBody, req);
  await forgot(db, body, ctx);
  return noContent();
});
