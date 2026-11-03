import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { knownDevices, notifications, products, users, variants, type NotificationRow } from '@/db/schema';
import type { AuthUser } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import { toNotification, type NotificationOut } from '@/serializers/notifications';

export const LIST_LIMIT = 50;

export interface NotifyInput {
  kind: NotificationRow['kind'];
  title: string;
  body: string;
  href?: string;
  actionLabel?: string;
  dedupeKey?: string;
  payload?: unknown;
}

// No conflict target: the only unique index besides the pk is the partial (userId, dedupeKey)
// where unread, so a duplicate while unread is silently skipped.
async function insertFor(tx: Db, userIds: string[], n: NotifyInput): Promise<void> {
  if (userIds.length === 0) return;
  await tx
    .insert(notifications)
    .values(
      userIds.map((userId) => ({
        userId,
        kind: n.kind,
        title: n.title,
        body: n.body,
        href: n.href ?? null,
        actionLabel: n.actionLabel ?? null,
        dedupeKey: n.dedupeKey ?? null,
        payload: n.payload ?? null,
      })),
    )
    .onConflictDoNothing();
}

/** One row per ACTIVE ADMIN/MANAGER. Run inside the caller's transaction. */
export async function notifyManagers(tx: Db, n: NotifyInput): Promise<void> {
  const recipients = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.status, 'ACTIVE'), inArray(users.role, ['ADMIN', 'MANAGER'])));
  await insertFor(
    tx,
    recipients.map((r) => r.id),
    n,
  );
}

/** One row per ACTIVE ADMIN except `excludeId` (the actor needs no alert about their own action). */
export async function notifyAdmins(tx: Db, n: NotifyInput, excludeId?: string): Promise<void> {
  const recipients = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.status, 'ACTIVE'), eq(users.role, 'ADMIN')));
  await insertFor(
    tx,
    recipients.map((r) => r.id).filter((id) => id !== excludeId),
    n,
  );
}

export async function notifyUser(tx: Db, userId: string, n: NotifyInput): Promise<void> {
  await insertFor(tx, [userId], n);
}

/**
 * LOW_STOCK for each touched variant now at or below its threshold (same eligibility as
 * GET /stock/low). dedupeKey `low:<variantId>` keeps one unread alert per variant per manager.
 */
export async function notifyLowStock(tx: Db, variantIds: string[]): Promise<void> {
  const ids = [...new Set(variantIds)];
  if (ids.length === 0) return;
  const rows = await tx
    .select({
      id: variants.id,
      size: variants.size,
      colorName: variants.colorName,
      quantity: variants.quantity,
      threshold: variants.lowStockThreshold,
      productName: products.name,
    })
    .from(variants)
    .innerJoin(products, eq(products.id, variants.productId))
    .where(and(inArray(variants.id, ids), eq(variants.isActive, true), eq(products.status, 'ACTIVE'), lte(variants.quantity, variants.lowStockThreshold)))
    .orderBy(asc(variants.sku));
  for (const v of rows) {
    const label = `${v.productName} ${v.size}/${v.colorName}`;
    const out = v.quantity <= 0;
    await notifyManagers(tx, {
      kind: 'LOW_STOCK',
      title: `${out ? 'Out of stock' : 'Low stock'}: ${label}`,
      body: out ? `${label} is out of stock (${v.quantity} left).` : `${label} has ${v.quantity} left (threshold ${v.threshold}).`,
      href: '/stock/low',
      actionLabel: 'Receive',
      dedupeKey: `low:${v.id}`,
      payload: { variantId: v.id, quantity: v.quantity, threshold: v.threshold },
    });
  }
}

// Order matters: Edge/Opera/Samsung UAs also say "Chrome", Chrome UAs also say "Safari".
const BROWSERS: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\b(?:OPR|Opera)\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\b(?:Firefox|FxiOS)\//, 'Firefox'],
  [/\b(?:Chrome|CriOS|Chromium)\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari'],
];
const SYSTEMS: [RegExp, string][] = [
  [/\biPhone\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\bAndroid\b/, 'Android'],
  [/\bWindows\b/, 'Windows'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bLinux\b/, 'Linux'],
];

/**
 * Short fixed label such as "Chrome on Windows". The raw user agent is attacker-controlled,
 * so only strings from the tables above ever reach a notification.
 */
export function deviceLabel(userAgent: string | null): string {
  const ua = userAgent ?? '';
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1];
  const os = SYSTEMS.find(([re]) => re.test(ua))?.[1];
  if (browser && os) return `${browser} on ${os}`;
  if (browser) return browser;
  if (os) return `a browser on ${os}`;
  return 'a new browser';
}

/**
 * Record the device for this login. The first device a user ever signs in from is recorded
 * silently; a later unknown one notifies the user themself.
 */
export async function recordLoginDevice(db: Db, userId: string, userAgent: string | null): Promise<void> {
  const ua = userAgent ?? 'unknown';
  const deviceHash = createHash('sha256').update(ua).digest('hex');
  await db.transaction(async (tx) => {
    const known = await tx.select({ deviceHash: knownDevices.deviceHash }).from(knownDevices).where(eq(knownDevices.userId, userId));
    if (known.some((k) => k.deviceHash === deviceHash)) return;
    const inserted = await tx.insert(knownDevices).values({ userId, deviceHash }).onConflictDoNothing().returning({ userId: knownDevices.userId });
    // Concurrent login from the same new device: the other request owns the notification.
    if (known.length === 0 || inserted.length === 0) return;
    await notifyUser(tx, userId, {
      kind: 'NEW_DEVICE_LOGIN',
      title: 'New sign-in',
      body: `Your account signed in from a new device (${deviceLabel(userAgent)}). If this was not you, change your password.`,
      href: '/profile',
      payload: { deviceHash },
    });
  });
}

const ordered = [sql`${notifications.readAt} is not null`, desc(notifications.createdAt), desc(notifications.id)];

export async function listNotifications(db: Db, user: AuthUser): Promise<NotificationOut[]> {
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, user.id))
    .orderBy(...ordered)
    .limit(LIST_LIMIT);
  return rows.map(toNotification);
}

/** Mark one (id) or all of the caller's unread notifications read. A foreign or unknown id is 404. */
export async function markRead(db: Db, user: AuthUser, id?: string): Promise<NotificationOut[]> {
  if (id) {
    const [row] = await db
      .select({ readAt: notifications.readAt })
      .from(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.userId, user.id)))
      .limit(1);
    if (!row) throw new AppError('NOT_FOUND', 'Notification not found');
    if (!row.readAt) await db.update(notifications).set({ readAt: new Date() }).where(eq(notifications.id, id));
  } else {
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
  }
  return listNotifications(db, user);
}
