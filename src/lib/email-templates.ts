/**
 * Branded transactional emails (invitation, password reset link, password reset notice).
 * Each returns a subject, a plain-text body and an HTML body. The HTML is table-based with inline
 * styles so it renders in Gmail, Outlook and Apple Mail, and every interpolated value is escaped.
 */
const APP = 'Avenue Brand';
const ACCENT = '#3F6B5C';
const SAND = '#C8B89A';
const INK = '#1F2421';
const INK_2 = '#5B625D';
const BG = '#F7F6F3';

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

function esc(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function layout(opts: { preheader: string; heading: string; paragraphs: string[]; button?: { label: string; href: string }; footnote: string }): string {
  const { preheader, heading, paragraphs, button, footnote } = opts;
  const p = (html: string) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${INK};">${html}</p>`;
  const btn = button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td style="border-radius:10px;background:${ACCENT};">
<a href="${esc(button.href)}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:10px;">${esc(button.label)}</a>
</td></tr></table>
<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:${INK_2};">If the button does not work, copy this link into your browser:<br><a href="${esc(button.href)}" style="color:${ACCENT};word-break:break-all;">${esc(button.href)}</a></p>`
    : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(heading)}</title></head>
<body style="margin:0;padding:0;background:${BG};font-family:Inter,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:32px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
<tr><td style="padding:0 4px 18px;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="width:36px;height:36px;border-radius:9px;background:${ACCENT};color:#FFFFFF;font-weight:700;font-size:18px;text-align:center;vertical-align:middle;">A</td>
<td style="padding-left:10px;font-size:17px;font-weight:600;color:${INK};letter-spacing:-0.02em;">Avenue<span style="font-weight:400;color:${INK_2};"> Brand</span></td>
</tr></table></td></tr>
<tr><td style="background:#FFFFFF;border:1px solid #E4E2DC;border-radius:14px;padding:30px 28px;">
<div style="width:40px;height:3px;background:${SAND};border-radius:2px;margin:0 0 18px;"></div>
<h1 style="margin:0 0 18px;font-size:21px;line-height:1.3;font-weight:600;color:${INK};letter-spacing:-0.01em;">${esc(heading)}</h1>
${paragraphs.map(p).join('\n')}
${btn}
<p style="margin:0;font-size:13px;line-height:1.5;color:${INK_2};">${footnote}</p>
</td></tr>
<tr><td style="padding:18px 4px 0;font-size:12px;line-height:1.5;color:${INK_2};text-align:center;">${APP} · inventory and sales for the shop floor<br>This is an automatic message; replies are not read.</td></tr>
</table></td></tr></table>
</body></html>`;
}

export function inviteEmail(o: { name: string; actorName: string; link: string }): RenderedEmail {
  const subject = `You have been invited to ${APP}`;
  const text = `Hello ${o.name},\n\n${o.actorName} invited you to ${APP}. Use this link within 48 hours to set your password:\n${o.link}\n\nIf you were not expecting this, you can ignore this email.\n`;
  const html = layout({
    preheader: `${o.actorName} invited you to ${APP}. Set your password within 48 hours.`,
    heading: `Welcome to ${APP}`,
    paragraphs: [`Hello ${esc(o.name)},`, `<strong>${esc(o.actorName)}</strong> invited you to join the store team on ${APP}. Choose a password to activate your account.`],
    button: { label: 'Set your password', href: o.link },
    footnote: 'This link works once and expires in 48 hours. If you were not expecting this invitation, you can ignore this email.',
  });
  return { subject, text, html };
}

export function resetLinkEmail(o: { name: string; link: string; actorName?: string }): RenderedEmail {
  const subject = `Reset your ${APP} password`;
  const byWhom = o.actorName ? `Your password was reset by ${o.actorName}. ` : '';
  const text = o.actorName
    ? `Hello ${o.name},\n\n${byWhom}Use this link within 30 minutes to choose a new password:\n${o.link}\n\nIf you did not expect this, contact your store administrator.\n`
    : `Hello ${o.name},\n\nUse this link within 30 minutes to choose a new password:\n${o.link}\n\nIf you did not ask for this, ignore this email. Your password stays the same.\n`;
  const html = layout({
    preheader: 'Choose a new password within 30 minutes.',
    heading: 'Reset your password',
    paragraphs: [
      `Hello ${esc(o.name)},`,
      o.actorName
        ? `Your password was reset by <strong>${esc(o.actorName)}</strong>. Choose a new one to sign in again.`
        : `We received a request to reset the password for your ${APP} account.`,
    ],
    button: { label: 'Choose a new password', href: o.link },
    footnote: o.actorName
      ? 'This link works once and expires in 30 minutes. If you did not expect this, contact your store administrator.'
      : 'This link works once and expires in 30 minutes. If you did not ask for this, ignore this email; your password stays the same.',
  });
  return { subject, text, html };
}

export function resetNoticeEmail(o: { name: string; actorName: string }): RenderedEmail {
  const subject = `Your ${APP} password was reset`;
  const text = `Hello ${o.name},\n\nYour password was reset by ${o.actorName}. You have been signed out everywhere; ${o.actorName} will give you a temporary password, and you will choose a new one when you next sign in.\n\nIf you did not expect this, contact your store administrator.\n`;
  const html = layout({
    preheader: `Your password was reset by ${o.actorName}.`,
    heading: 'Your password was reset',
    paragraphs: [
      `Hello ${esc(o.name)},`,
      `Your password was reset by <strong>${esc(o.actorName)}</strong> and you have been signed out on every device.`,
      `${esc(o.actorName)} will give you a temporary password in person. You will choose your own password the next time you sign in.`,
    ],
    footnote: 'If you did not expect this, contact your store administrator.',
  });
  return { subject, text, html };
}
