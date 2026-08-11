import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import { sendViaSmtp } from './mailer.js';

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
