import { audit } from '@/lib/audit';
import { withAuth } from '@/lib/auth';
import { requireCronSecret } from '@/lib/cron';
import { json } from '@/lib/http';
import { runDailyMaintenance } from '@/services/maintenance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A Sunday backup zips every business table; give it more than the default budget.
export const maxDuration = 60;

/** GET /cron/daily — Vercel Cron (vercel.json, 02:00 UTC). Bearer CRON_SECRET, no session. */
export const GET = withAuth({ public: true }, async (req, { db }) => {
  requireCronSecret(req);
  const result = await runDailyMaintenance(db, new Date());
  await audit(db, { userId: null }, 'cron.daily', 'system', null, null, result);
  return json(result);
});
