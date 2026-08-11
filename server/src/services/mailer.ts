import { env, isProduction, isTest } from '../config/env.js';
import { logger } from '../utils/logger.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Outbound email. One interface, two adapters:
 *
 *   - `none` (default, dev/test): the message is logged to the console with
 *     the full text so flows are click-through-able in a terminal with zero
 *     setup and no network. Tests stay hermetic.
 *   - `resend` (production): POSTs to Resend's REST API with the configured
 *     API key. Free tier is 3,000 emails/month, 100/day — plenty for
 *     verification + password-reset traffic at hobby scale.
 *
 * A delivery failure never fails the caller's own request (registration /
 * forgot-password still succeed); the error is logged and the user can
 * resend from the dashboard or try again. The one exception: misconfigured
 * production (provider=resend with no API key) is thrown so it surfaces in
 * server logs immediately.
 */
export async function sendMail(message: MailMessage): Promise<void> {
  if (isTest || env.EMAIL_PROVIDER === 'none') {
    // Dev/test: log the full message as a stand-in for a real mailbox so
    // the flow is click-through-able locally with zero setup.
    //
    // The body carries one-time tokens, so it is never logged outside dev:
    // if production ever runs without a provider, warn loudly but do NOT
    // dump the link into the logs.
    if (isProduction) {
      logger.error('mail_not_configured', {
        to: message.to,
        subject: message.subject,
        hint: 'EMAIL_PROVIDER=none in production: no email was sent and the verification link is unavailable. Set EMAIL_PROVIDER=resend and RESEND_API_KEY.',
      });
      return;
    }
    logger.info('mail_dev_send', {
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
    return;
  }

  if (env.EMAIL_PROVIDER === 'resend') {
    await sendViaResend(message);
    // Success is logged explicitly so the server logs tell the full story:
    // mail_dev_send = dev mode (no real send), mail_sent = Resend accepted
    // it, mail_send_failed = the API rejected it (bad key / unverified
    // Resend account / daily cap). Without this a silent success looked
    // identical to a no-op.
    logger.info('mail_sent', { to: message.to, subject: message.subject });
    return;
  }

  throw new Error(`Unknown EMAIL_PROVIDER: ${env.EMAIL_PROVIDER}`);
}

async function sendViaResend(message: MailMessage): Promise<void> {
  if (!env.RESEND_API_KEY) {
    throw new Error(
      'EMAIL_PROVIDER=resend requires RESEND_API_KEY (get one at https://resend.com/api-keys)',
    );
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend API error ${res.status}: ${body.slice(0, 500)}`);
  }
}
