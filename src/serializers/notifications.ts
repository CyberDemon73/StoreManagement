import type { NotificationRow } from '@/db/schema';

export interface NotificationOut {
  id: string;
  kind: NotificationRow['kind'];
  title: string;
  body: string;
  href?: string;
  actionLabel?: string;
  readAt?: string;
  createdAt: string;
}

/** Mirrors `Notification` in src/types.ts; dedupeKey and payload stay server-side. */
export function toNotification(row: NotificationRow): NotificationOut {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    ...(row.href ? { href: row.href } : {}),
    ...(row.actionLabel ? { actionLabel: row.actionLabel } : {}),
    ...(row.readAt ? { readAt: row.readAt.toISOString() } : {}),
    createdAt: row.createdAt.toISOString(),
  };
}
