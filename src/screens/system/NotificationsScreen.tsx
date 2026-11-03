'use client';
/**
 * Screen: /notifications · Roles: all
 * Calls: GET /notifications · POST /notifications/:id/read · POST /notifications/read-all.
 */
import { Bell } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { Page, PageHeader } from '@/components/app/PageHeader';
import { NotificationRow } from '@/components/app/Notifications';
import { Badge } from '@/components/ui/Badge';
import { Button, LinkButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';

export function NotificationsScreen() {
  const list = useApi(() => api.notifications.list(), []);
  const { toast } = useToast();
  const unread = list.data?.filter((n) => !n.readAt).length ?? 0;
  const markAll = async () => {
    try { list.setData(await api.notifications.markRead()); toast({ kind: 'success', title: 'All notifications marked read' }); }
    catch (e) { toast({ kind: 'error', title: "Couldn't mark as read", body: (e as Error).message }); }
  };
  const markOne = (id: string) => { list.setData((prev) => prev?.map((n) => (n.id === id ? { ...n, readAt: n.readAt ?? new Date().toISOString() } : n))); void api.notifications.markRead(id); };

  return (
    <>
      <PageHeader title={<span className="flex items-center gap-2">Notifications{unread > 0 && <Badge tone="accent">{unread} new</Badge>}</span>} compactTitle="Notifications" actions={<Button variant="ghost" onClick={() => void markAll()} disabled={unread === 0}>Mark all read</Button>} />
      <Page className="max-w-3xl">
        <Card padded={false} className="overflow-hidden">
          {list.error && !list.data ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : !list.data ? <SkeletonRows rows={5} className="px-4" /> : list.data.length === 0 ? <EmptyState icon={<Bell aria-hidden />} title="You're all caught up" body="Low stock, large refunds and new device sign-ins show up here." /> : (
            <ul>{list.data.map((n) => <NotificationRow key={n.id} n={n} onOpen={() => markOne(n.id)} />)}</ul>
          )}
          <div className="border-t border-line px-4 py-2.5 text-center"><LinkButton variant="ghost" size="sm" href="/audit">See everything in the audit log</LinkButton></div>
        </Card>
      </Page>
    </>
  );
}
