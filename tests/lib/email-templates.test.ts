import { describe, expect, it } from 'vitest';
import { inviteEmail, resetLinkEmail, resetNoticeEmail } from '@/lib/email-templates';

const link = 'https://avenue-stock.vercel.app/set-password?token=abc123';

describe('email templates', () => {
  it('invitation: subject, inviter, link in text and as the HTML button, 48 h validity', () => {
    const m = inviteEmail({ name: 'Sara', actorName: 'Mona', link });
    expect(m.subject).toBe('You have been invited to Avenue Brand');
    expect(m.text).toContain(link);
    expect(m.text).toContain('Mona invited you');
    expect(m.html).toContain(`href="${link.replace(/&/g, '&amp;')}"`);
    expect(m.html).toContain('Set your password');
    expect(m.html).toContain('48 hours');
    expect(m.html.startsWith('<!doctype html>')).toBe(true);
  });

  it('reset link: self-service and admin-triggered variants, 30 min validity', () => {
    const self = resetLinkEmail({ name: 'Sara', link });
    expect(self.subject).toBe('Reset your Avenue Brand password');
    expect(self.text).toContain(link);
    expect(self.html).toContain('30 minutes');
    expect(self.text).toContain('If you did not ask for this');
    const byAdmin = resetLinkEmail({ name: 'Sara', link, actorName: 'Mona' });
    expect(byAdmin.text).toContain('reset by Mona');
    expect(byAdmin.html).toContain('reset by <strong>Mona</strong>');
  });

  it('reset notice never contains a password and names who reset it', () => {
    const m = resetNoticeEmail({ name: 'Sara', actorName: 'Mona' });
    expect(m.subject).toBe('Your Avenue Brand password was reset');
    expect(m.text).toContain('reset by Mona');
    expect(m.html).not.toMatch(/href=/);
  });

  it('escapes names so they cannot inject HTML', () => {
    const m = inviteEmail({ name: '<img src=x onerror=alert(1)>', actorName: 'A & B', link });
    expect(m.html).not.toContain('<img src=x');
    expect(m.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(m.html).toContain('A &amp; B');
  });
});
