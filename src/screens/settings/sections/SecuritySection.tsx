'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Field, Select, Toggle } from '@/components/ui/Field';
import { ConfirmDialog } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Toast';
import type { SectionProps } from './shared';

export function SecuritySection({ draft, patch }: SectionProps) {
  const auth = useAuth();
  const { toast } = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const signEveryoneOut = async () => {
    setBusy(true);
    try {
      const users = await api.users.list();
      await Promise.all(users.filter((u) => u.id !== auth.user?.id && (u.sessions ?? 0) > 0).map((u) => api.users.revokeSessions(u.id)));
      toast({ kind: 'success', title: 'Everyone else is signed out', body: 'Your own session is kept.' });
      setConfirm(false);
    } catch (e) {
      toast({ kind: 'error', title: "Couldn't sign everyone out", body: (e as Error).message });
    } finally { setBusy(false); }
  };

  return (
    <Card as="section" id="s-sec" className="flex flex-col gap-3" aria-labelledby="s-sec-h">
      <CardHeader id="s-sec-h" title="Security" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Session length" htmlFor="sc-sess">
          <Select id="sc-sess" value={String(draft.sessionIdleHours)} onChange={(e) => patch({ sessionIdleHours: parseInt(e.target.value, 10) })}>
            <option value="12">12 hours</option><option value="24">24 hours</option><option value="168">7 days (remembered devices)</option>
          </Select>
        </Field>
        <Field label="Require password change every" htmlFor="sc-pw">
          <Select id="sc-pw" value={draft.passwordRotationDays === null ? 'never' : String(draft.passwordRotationDays)} onChange={(e) => patch({ passwordRotationDays: e.target.value === 'never' ? null : parseInt(e.target.value, 10) })}>
            <option value="90">90 days</option><option value="180">180 days</option><option value="never">Never</option>
          </Select>
        </Field>
      </div>
      <Toggle checked={draft.lockoutEnabled} onChange={(v) => patch({ lockoutEnabled: v })} label="Lock account for 15 min after 5 failed sign-ins" />
      <Button size="sm" variant="dangerSoft" className="self-start" onClick={() => setConfirm(true)}>Sign everyone out</Button>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={() => void signEveryoneOut()} pending={busy} danger title="Sign everyone out?" description="Every device except yours is signed out now. Staff sign in again with their usual password. Recorded in the audit log." confirmLabel="Sign everyone out" />
    </Card>
  );
}
