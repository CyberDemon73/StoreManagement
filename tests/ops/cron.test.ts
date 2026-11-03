import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dynamic, GET as CRON } from '@/app/api/v1/cron/daily/route';
import { getDb } from '@/db/client';
import { auditLog } from '@/db/schema';
import { resetEnvForTests } from '@/lib/env';
import { setBackupWriterForTests } from '@/services/maintenance';
import { call } from '../helpers/http';

const SECRET = 'cron-secret-for-tests-0123456789';

function setSecret(value: string | undefined) {
  if (value === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = value;
  resetEnvForTests();
}

const run = (authorization?: string) =>
  call(CRON, { path: '/api/v1/cron/daily', headers: authorization === undefined ? {} : { authorization } });

beforeEach(() => {
  setSecret(SECRET);
  process.env.BLOB_READ_WRITE_TOKEN = '';
  resetEnvForTests();
});
afterEach(() => {
  setSecret(undefined);
  setBackupWriterForTests(null);
});

describe('GET /cron/daily', () => {
  it('is never statically cached', () => {
    expect(dynamic).toBe('force-dynamic');
  });

  it('401 without an Authorization header', async () => {
    const res = await run();
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHENTICATED');
  });

  it('401 with a wrong secret, a wrong scheme, or a secret of a different length', async () => {
    for (const h of [`Bearer ${SECRET}x`, `Bearer ${SECRET.slice(0, -1)}X`, SECRET, `Basic ${SECRET}`, 'Bearer ']) {
      const res = await run(h);
      expect(res.status, h).toBe(401);
    }
  });

  it('401 when CRON_SECRET is unset, whatever is sent', async () => {
    setSecret(undefined);
    expect((await run('Bearer ')).status).toBe(401);
    expect((await run('Bearer undefined')).status).toBe(401);
    expect((await run(`Bearer ${SECRET}`)).status).toBe(401);
  });

  it('200 with the right secret: runs maintenance and audits a cron.daily summary', async () => {
    const res = await run(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.purged).toMatchObject({ tokens: 0, sessions: 0, idempotencyKeys: 0, notifications: 0, failedLogins: 0 });
    expect(typeof body.weekly).toBe('boolean');
    const rows = await getDb().select().from(auditLog).where(eq(auditLog.action, 'cron.daily'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: null, entity: 'system' });
    expect((rows[0]!.after as { purged: unknown }).purged).toEqual(body.purged);
  });
});
