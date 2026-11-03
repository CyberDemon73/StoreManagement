'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Bell, CircleAlert, ClipboardCheck, Receipt, Smartphone } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Popover } from '@/components/ui/Overlay';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import type { Notification } from '@/types';

const ICON: Record<Notification['kind'], { icon: typeof Bell; cls: string }> = {
  LOW_STOCK: { icon: CircleAlert, cls: 'bg-warn-soft text-warn-ink' },
  LARGE_REFUND: { icon: Receipt, cls: 'bg-danger-soft text-danger-ink' },
  NEW_DEVICE_LOGIN: { icon: Smartphone, cls: 'bg-info-soft text-info-ink' },
  COUNT_APPLIED: { icon: ClipboardCheck, cls: 'bg-ok-soft text-ok-ink' },
};

export function NotificationsPopover() {
  const [open, setOpen] = useState(false);
  const list = useApi(() => api.notifications.list(), [open]);
  const unread = list.data?.filter((n) => !n.readAt).length ?? 0;
  const markAll = async () => { list.setData(await api.notifications.markRead()); };
  return (
    <Popover open={open} onClose={() => setOpen(false)} className="w-[360px] max-w-[calc(100vw-24px)] p-0" anchor={
      <button type="button" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="relative flex size-10 items-center justify-center rounded-input text-ink hover:bg-surface-2">
        <Bell className="size-5" aria-hidden />
        {unread > 0 && <span aria-hidden className="absolute right-2 top-2 size-2 rounded-full border-2 border-surface bg-danger" />}
      </button>}>
      <div className="flex items-center gap-2 border-b border-line px-4 py-3"><h2 className="text-[15px] font-semibold">Notifications</h2>{unread > 0 && <Badge tone="accent">{unread} new</Badge>}<Button variant="ghost" size="sm" className="ml-auto" onClick={() => void markAll()} disabled={unread === 0}>Mark all read</Button></div>
      <ul className="max-h-[60vh] overflow-y-auto">
        {(list.data ?? []).map((n) => <NotificationRow key={n.id} n={n} onOpen={() => { void api.notifications.markRead(n.id); setOpen(false); }} />)}
        {list.data?.length === 0 && <li className="px-4 py-8 text-center text-sm text-ink-2">You&apos;re all caught up.</li>}
      </ul>
      <Link href="/audit" onClick={() => setOpen(false)} className="block border-t border-line px-4 py-2.5 text-center text-sm text-accent">See everything in the audit log</Link>
    </Popover>
  );
}

export function NotificationRow({ n, onOpen }: { n: Notification; onOpen: () => void }) {
  const { icon: Icon, cls } = ICON[n.kind];
  return (
    <li className={cn('flex items-start gap-3 border-b border-line px-4 py-3 last:border-0', !n.readAt && 'bg-accent-soft/50')}>
      <span className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full', cls)}><Icon className="size-4" aria-hidden /></span>
      <div className="min-w-0 flex-1">
        <p className="text-sm"><strong>{n.title}:</strong> {n.body}</p>
        <p className="mt-0.5 text-xs text-ink-2">{formatDateTime(n.createdAt)}</p>
        {n.href && n.actionLabel && <Link href={n.href} onClick={onOpen} className="mt-1.5 inline-flex min-h-8 items-center rounded-input border border-line bg-surface px-2.5 text-[13px] font-medium hover:bg-surface-2">{n.actionLabel}</Link>}
      </div>
      {!n.readAt && <span aria-label="Unread" className="mt-2 size-2 shrink-0 rounded-full bg-accent" />}
    </li>
  );
}
