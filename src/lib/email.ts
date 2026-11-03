import { Resend } from 'resend';
import { getEnv } from './env';
import { logger } from './logger';

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  /** Optional HTML body; `text` is always sent as the plain-text alternative. */
  html?: string;
}

type Transport = (mail: OutgoingEmail) => Promise<void>;

let testTransport: Transport | null = null;
let resend: Resend | null = null;

/** Test seam: capture outgoing mail instead of sending it. Pass null to restore. */
export function setEmailTransportForTests(fn: Transport | null): void {
  testTransport = fn;
}

/** Resend when configured; otherwise log (never the body, it may carry a token). */
export async function sendEmail(mail: OutgoingEmail): Promise<void> {
  if (testTransport) return testTransport(mail);
  const { RESEND_API_KEY, EMAIL_FROM } = getEnv();
  if (!RESEND_API_KEY) {
    logger.info({ subject: mail.subject }, 'email not sent: RESEND_API_KEY unset');
    return;
  }
  resend ??= new Resend(RESEND_API_KEY);
  const { error } = await resend.emails.send({ from: EMAIL_FROM, to: mail.to, subject: mail.subject, text: mail.text, ...(mail.html ? { html: mail.html } : {}) });
  if (error) {
    logger.error({ subject: mail.subject, error: error.message }, 'email send failed');
    throw new Error('email send failed');
  }
}
