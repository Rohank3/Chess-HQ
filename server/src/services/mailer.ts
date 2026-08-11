import { env, isProduction, isTest } from '../config/env.js';
import { logger } from '../utils/logger.js';
import nodemailer, { type Transporter } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}

/** Build a nodemailer transport for the SMTP provider. Extracted so tests
 *  can inject a non-network transport (e.g. nodemailer's jsonTransport) —
 *  production always builds from env. */
export function createSmtpTransport(config: SmtpConfig): Transporter {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    // Fail fast instead of nodemailer's 2-minute default connection timeout:
    // a healthy SMTP server (Gmail) answers in well under a second, so these
    // are generous for the happy path while turning a broken network / wrong
    // host into a ~15s failure in the logs instead of a 2m silent hang.
    connectionTimeout: 15_000,
    greetingTimeout: 20_000,
  });
}

/**
 * Outbound email. One interface, three adapters:
 *
 *   - `none` (default, dev/test): the message is logged to the console with
 *     the full text so flows are click-through-able in a terminal with zero
 *     setup and no network. Tests stay hermetic.
 *   - `resend` (production): POSTs to Resend's REST API with the configured
 *     API key. Free tier is 3,000 emails/month, 100/day. Note the shared
 *     onboarding@resend.dev sender can only deliver to the Resend account's
 *     own inbox — sending to arbitrary recipients needs a verified domain.
 *   - `smtp` (production): sends through any SMTP server (Gmail + an App
 *     Password is the zero-cost path; ~500 emails/day).
 *
 * A delivery failure never fails the caller's own request (registration /
 * forgot-password still succeed); the error is logged and the user can
 * resend from the dashboard or try again. Misconfigured production
 * (provider set but no credentials) is thrown so it surfaces in server logs
 * immediately.
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
        hint: 'EMAIL_PROVIDER=none in production: no email was sent and the verification link is unavailable. Set EMAIL_PROVIDER=resend + RESEND_API_KEY or EMAIL_PROVIDER=smtp + SMTP_* credentials.',
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
    logger.info('mail_sent', { to: message.to, subject: message.subject });
    return;
  }

  if (env.EMAIL_PROVIDER === 'smtp') {
    await sendViaSmtp(message);
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

function requireSmtpEnv(): SmtpConfig {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) {
    throw new Error(
      'EMAIL_PROVIDER=smtp requires SMTP_HOST, SMTP_USER and SMTP_PASS (Gmail: smtp.gmail.com, your address, and a 16-char App Password)',
    );
  }
  return {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
  };
}

/** Send via SMTP. `transport` is injectable for hermetic tests; production
 *  builds one from env (and rejects loudly when the SMTP_* credentials are
 *  missing, mirroring the Resend path). The same send-failure contract as
 *  Resend applies: nodemailer rejects on a failed handshake / rejected
 *  message, and the caller's request is never failed (sendMailSafe logs it). */
export async function sendViaSmtp(
  message: MailMessage,
  transport?: Transporter,
): Promise<unknown> {
  const t = transport ?? createSmtpTransport(requireSmtpEnv());
  return t.sendMail({
    from: env.EMAIL_FROM,
    to: message.to,
    subject: message.subject,
    text: message.text,
    ...(message.html ? { html: message.html } : {}),
  });
}
