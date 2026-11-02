import type { Db } from '@/db/client';
import { settings, type SettingsRow } from '@/db/schema';

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
