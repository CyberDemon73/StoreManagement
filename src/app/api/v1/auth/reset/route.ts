import { withAuth } from '@/lib/auth';
import { noContent } from '@/lib/http';
import { parse } from '@/lib/validate';
import { resetBody } from '@/schemas/auth';
import { reset } from '@/services/auth';

export const runtime = 'nodejs';

export const POST = withAuth({ public: true }, async (req, { db, req: ctx }) => {
  const body = await parse(resetBody, req);
  await reset(db, body, ctx);
  return noContent();
});
