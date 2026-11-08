import * as assert from 'node:assert/strict';
import { Logger } from '@nestjs/common';
import { EmailService } from '../email.service';
import type { SendEmailOptions } from '../email.types';
import { PRODUCT_NAME } from '../../config/product';

/**
 * The invitation of a person who signs in with Microsoft: greeted by first name, told who invites
 * them to which workspace, asked to sign in with Microsoft, with a button to the workspace
 * address. No password link, no expiry, no notification preferences link (no account yet).
 */

process.env.EMAIL_QUEUE_MIN_INTERVAL_MS = '1';
delete process.env.RESEND_FROM_EMAIL;
delete process.env.DEPLOYMENT_MODE;
Logger.overrideLogger(false);

const TENANT = '11111111-1111-1111-1111-111111111111';

function createEmailService(row: { name: string | null; branding: unknown } | null) {
  const dataSource = { query: async () => (row ? [row] : []) };
  const storage = { getObjectStream: async () => { throw new Error('no logo'); } };
  const service = new EmailService(dataSource as any, storage as any);
  const delivered: SendEmailOptions[] = [];
  (service as any).transport = {
    name: 'double',
    defaultMinIntervalMs: 1,
    send: async (options: SendEmailOptions) => { delivered.push(options); },
    getRetryDelayMs: () => null,
  };
  return { service, delivered };
}

async function send(row: { name: string | null; branding: unknown } | null, params: Record<string, unknown>) {
  const { service, delivered } = createEmailService(row);
  await service.sendUserMicrosoftInviteEmail({
    to: 'julie.martin@acme.test',
    signInUrl: 'https://acme.kanap.net',
    tenantId: TENANT,
    ...params,
  });
  await service.drain(Date.now() + 5_000);
  assert.equal(delivered.length, 1);
  return delivered[0];
}

async function testFrenchInvitation() {
  const mail = await send({ name: 'Acme & Co', branding: null }, { firstName: 'Julie', inviterName: 'Claire Dubois', locale: 'fr' });
  assert.equal(mail.to, 'julie.martin@acme.test');
  assert.equal(mail.subject, 'Invitation à rejoindre Acme & Co');
  assert.match(mail.html, /Bonjour Julie,/);
  assert.ok(mail.html.includes(`Claire Dubois vous invite à rejoindre l'espace Acme &amp; Co sur ${PRODUCT_NAME}.`), mail.html);
  assert.ok(mail.html.includes('Connectez-vous avec votre compte Microsoft :'));
  assert.ok(mail.html.includes('« Se connecter avec Microsoft »'));
  assert.match(mail.html, /<a href="https:\/\/acme\.kanap\.net"[^>]*>Ouvrir Acme &amp; Co<\/a>/);
  assert.ok(!mail.html.includes('/settings/notifications'), 'no notification preferences link');
  assert.ok(!/accept-invite|mot de passe|expire/i.test(mail.html), 'no password link, no expiry');

  const text = mail.text ?? '';
  assert.ok(text.startsWith('Bonjour Julie,'));
  assert.ok(text.includes(`Claire Dubois vous invite à rejoindre l'espace Acme & Co sur ${PRODUCT_NAME}.`));
  assert.ok(text.includes('Ouvrir Acme & Co : https://acme.kanap.net'));
  assert.ok(!text.includes('/settings/notifications'));
}

async function testWithoutNamesOrOrganisation() {
  // No first name, no inviter name, the on-premise default organisation name.
  const mail = await send({ name: 'My Organization', branding: null }, { firstName: '  ', inviterName: null, locale: 'en' });
  assert.equal(mail.subject, `Invitation to join ${PRODUCT_NAME}`);
  assert.match(mail.html, /<p style="margin:0 0 10px 0;">Hello,<\/p>/);
  assert.ok(mail.html.includes(`You are invited to join ${PRODUCT_NAME}.`), 'the product, never "the KANAP workspace on KANAP"');
  assert.ok(!mail.html.includes(`workspace on ${PRODUCT_NAME}`));
}

async function testEveryLanguage() {
  for (const locale of ['en', 'fr', 'de', 'es']) {
    const mail = await send({ name: 'Acme', branding: null }, { firstName: 'Julie', inviterName: 'Claire Dubois', locale });
    assert.ok(mail.text?.includes('Claire Dubois'), locale);
    assert.ok(mail.text?.includes('Acme'), locale);
    assert.ok(mail.text?.includes('https://acme.kanap.net'), locale);
    assert.ok(!/\{\{|\}\}/.test(`${mail.subject}${mail.html}${mail.text}`), `${locale}: every placeholder is filled`);
  }
}

async function main() {
  await testFrenchInvitation();
  await testWithoutNamesOrOrganisation();
  await testEveryLanguage();
  console.log('user-invite-microsoft-email.spec: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
