import { sql } from 'drizzle-orm';
import { withAuth } from '@/lib/auth';
import { json } from '@/lib/http';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

export const GET = withAuth({ public: true }, async (_req, { db }) => {
  try {
    await db.execute(sql`select 1`);
    return json({ ok: true, db: 'up' });
  } catch (err) {
    logger.error({ err }, 'health: database unreachable');
    return json({ ok: false, db: 'down' }, 503);
  }
});
