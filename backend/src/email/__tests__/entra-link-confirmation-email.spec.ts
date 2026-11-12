import * as assert from 'node:assert/strict';
import { Logger } from '@nestjs/common';
import { EmailService } from '../email.service';
import type { SendEmailOptions } from '../email.types';

/**
 * The link that confirms the link of an existing account to a Microsoft account: greeted by first
 * name, a button and the address of the link, how long it stays valid, and what to do when the
 * person did not sign in with Microsoft. No notification preferences link.
 */

process.env.EMAIL_QUEUE_MIN_INTERVAL_MS = '1';
delete process.env.RESEND_FROM_EMAIL;
delete process.env.DEPLOYMENT_MODE;
Logger.overrideLogger(false);

const URL = 'https://acme.kanap.net/login/link-microsoft#token=abc';

async function send(locale: string) {
  const dataSource = { query: async () => [{ name: 'Acme & Co', branding: null }] };
  const storage = { getObjectStream: async () => { throw new Error('no logo'); } };
  const service = new EmailService(dataSource as any, storage as any);
  const delivered: SendEmailOptions[] = [];
  (service as any).transport = {
    name: 'double',
    defaultMinIntervalMs: 1,
    send: async (options: SendEmailOptions) => { delivered.push(options); },
    getRetryDelayMs: () => null,
  };
  await service.sendEntraLinkConfirmationEmail({
    to: 'julie.martin@acme.test',
    confirmUrl: URL,
    expiresInMinutes: 60,
    firstName: 'Julie',
    tenantId: '11111111-1111-1111-1111-111111111111',
    locale,
  });
  await service.drain(Date.now() + 5_000);
  assert.equal(delivered.length, 1);
  return delivered[0];
}

async function testFrenchMail() {
  const mail = await send('fr');
  assert.equal(mail.to, 'julie.martin@acme.test');
  assert.equal(mail.subject, 'Confirmer votre connexion Microsoft sur Acme & Co');
  assert.match(mail.html, /Bonjour Julie,/);
  assert.ok(mail.html.includes('>Relier mon compte Microsoft</a>'), mail.html);
  assert.ok(mail.html.includes('https://acme.kanap.net/login/link-microsoft#token=abc'));
  assert.ok(mail.html.includes('rien ne change sur votre compte'));
  assert.ok(!mail.html.includes('/settings/notifications'), 'no notification preferences link');
  assert.ok(mail.text?.includes(URL));
}

async function testEveryLanguage() {
  for (const locale of ['en', 'fr', 'de', 'es']) {
    const mail = await send(locale);
    assert.ok(mail.text?.includes(URL), locale);
    assert.ok(mail.subject.includes('Acme & Co'), locale);
    assert.ok(mail.subject.includes('Microsoft'), locale);
    assert.ok(!/\{\{|\}\}/.test(`${mail.subject}${mail.html}${mail.text}`), `${locale}: every placeholder is filled`);
  }
}

async function main() {
  await testFrenchMail();
  await testEveryLanguage();
  console.log('entra-link-confirmation-email.spec: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
