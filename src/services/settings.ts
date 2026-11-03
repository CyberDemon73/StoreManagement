import { eq, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { saleCounters, settings, type SettingsRow } from '@/db/schema';
import { audit, type AuditActor } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import type { SettingsPatchInput } from '@/schemas/settings';
import { toFullSettings, toPublicSettings, type FullSettings } from '@/serializers/settings';

type SettingsPatch = Partial<Omit<SettingsRow, 'id' | 'updatedAt'>>;

/** The single settings row, created with defaults on first read. */
export async function getSettings(db: Db): Promise<SettingsRow> {
  const [row] = await db.select().from(settings).limit(1);
  if (row) return row;
  return ensureSettings(db, {});
}

/** Insert-or-update the single settings row. */
export async function ensureSettings(db: Db, patch: SettingsPatch): Promise<SettingsRow> {
  const [row] = await db
    .insert(settings)
    .values({ id: 1, ...patch })
    .onConflictDoUpdate({ target: settings.id, set: { ...patch, updatedAt: new Date() } })
    .returning();
  if (!row) throw new Error('settings upsert returned no row');
  return row;
}

async function nextSaleNumberFor(db: Db, prefix: string): Promise<number> {
  const [row] = await db.select({ next: saleCounters.next }).from(saleCounters).where(eq(saleCounters.prefix, prefix)).limit(1);
  return row?.next ?? 1;
}

export async function getFullSettings(db: Db): Promise<FullSettings> {
  const row = await getSettings(db);
  return toFullSettings(row, await nextSaleNumberFor(db, row.saleNumberPrefix));
}

/** Key-order-insensitive comparison: jsonb does not keep the key order we wrote. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

/**
 * Validate the timezone against Postgres (the zone every report converts with), then update
 * only keys whose value actually changes, auditing exactly those keys.
 */
export async function patchSettings(db: Db, actor: AuditActor, input: SettingsPatchInput): Promise<FullSettings> {
  if (input.timezone !== undefined) {
    const found = (await db.execute(sql`select 1 from pg_timezone_names where name = ${input.timezone}`)) as { rows: unknown[] };
    if (found.rows.length === 0) throw new AppError('VALIDATION', 'Invalid input', { fields: { timezone: 'Unknown timezone' } });
  }

  const row = await db.transaction(async (tx) => {
    await getSettings(tx);
    await tx.execute(sql`select id from settings where id = 1 for update`);
    const current = await getSettings(tx);
    // Checked against the merged values so a patch of either key alone cannot invert the pair.
    const idle = input.sessionIdleHours ?? current.sessionIdleHours;
    const absoluteDays = input.sessionAbsoluteDays ?? current.sessionAbsoluteDays;
    if (idle > absoluteDays * 24) {
      throw new AppError('VALIDATION', 'Invalid input', { fields: { sessionIdleHours: 'Idle timeout cannot exceed the absolute session length' } });
    }
    const view = { ...toPublicSettings(current), ...toFullSettings(current, 0) } as Record<string, unknown>;
    // Nullable text fields read as undefined from the full view; audit them as null.
    for (const k of ['logoUrl', 'phone', 'address', 'receiptHeader', 'receiptFooter']) view[k] = view[k] ?? null;

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const set: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input) as [string, unknown][]) {
      if (value === undefined || stable(view[key]) === stable(value)) continue;
      before[key] = view[key];
      after[key] = value;
      set[key] = key === 'sellerDiscountCapPct' ? String(value) : value;
    }
    if (Object.keys(set).length === 0) return current;

    const [updated] = await tx
      .update(settings)
      .set({ ...(set as SettingsPatch), updatedAt: new Date() })
      .where(eq(settings.id, 1))
      .returning();
    if (!updated) throw new Error('settings update returned no row');
    await audit(tx, actor, 'settings.update', 'settings', null, before, after);
    return updated;
  });

  return toFullSettings(row, await nextSaleNumberFor(db, row.saleNumberPrefix));
}
