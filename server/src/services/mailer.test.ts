import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import { sendViaBrevo, sendViaSmtp } from './mailer.js';

nodeTest('smtp: delivers the message through an injected transport', async () => {
  // jsonTransport never touches the network — it serializes the mail so the
  // envelope/body can be asserted without SMTP credentials.
  const transport = nodemailer.createTransport({ jsonTransport: true });
  const info = await sendViaSmtp(
    {
      to: 'player@example.com',
      subject: 'Confirm your Chess-HQ email',
      text: 'Hi rk2,\n\nWelcome to Chess-HQ!',
    },
    transport,
  );
  assert.ok(info.messageId, 'transport must report a message id');
  assert.ok(
    (info.envelope?.to ?? []).includes('player@example.com'),
    'envelope must address the recipient',
  );
  const serialized = JSON.stringify(info.message ?? '');
  assert.ok(serialized.includes('Confirm your Chess-HQ email'), 'subject must be present');
  assert.ok(serialized.includes('Welcome to Chess-HQ!'), 'body must be present');
});

nodeTest('smtp: rejects loudly when SMTP_* credentials are missing', async () => {
  await assert.rejects(
    () =>
      sendViaSmtp({
        to: 'a@b.com',
        subject: 'x',
        text: 'y',
      }),
    /SMTP_HOST, SMTP_USER and SMTP_PASS/,
  );
});

nodeTest('brevo: posts the message to the API with a parsed From address', async () => {
  const originalFetch = globalThis.fetch;
  let captured: { url: string; body: string } | undefined;
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    captured = { url: String(url), body: String(init?.body ?? '') };
    return new Response(JSON.stringify({ messageId: 'brevo-1' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  try {
    await sendViaBrevo(
      {
        to: 'player@example.com',
        subject: 'Confirm your Chess-HQ email',
        text: 'Welcome to Chess-HQ!',
      },
      'xkeysib-test-key',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.ok(captured, 'fetch must have been called');
  assert.match(captured!.url, /api\.brevo\.com\/v3\/smtp\/email$/);
  const payload = JSON.parse(captured!.body) as {
    sender: { name?: string; email: string };
    to: Array<{ email: string }>;
    subject: string;
    textContent: string;
  };
  // Test env defaults EMAIL_FROM to the Resend placeholder; the adapter must
  // still split it into name + email for Brevo's sender object.
  assert.equal(payload.sender.name, 'Chess-HQ');
  assert.equal(payload.sender.email, 'onboarding@resend.dev');
  assert.deepEqual(payload.to, [{ email: 'player@example.com' }]);
  assert.equal(payload.subject, 'Confirm your Chess-HQ email');
  assert.equal(payload.textContent, 'Welcome to Chess-HQ!');
});

nodeTest('brevo: rejects loudly when BREVO_API_KEY is missing', async () => {
  await assert.rejects(
    () => sendViaBrevo({ to: 'a@b.com', subject: 'x', text: 'y' }),
    /BREVO_API_KEY/,
  );
});
