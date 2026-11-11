import * as assert from 'node:assert/strict';
import { Logger } from '@nestjs/common';
import { EmailService } from '../email.service';
import type { SendEmailOptions } from '../email.types';
import { workspaceEmailSender } from '../email-config';
import { getDefaultEmailBranding, loadTenantEmailBranding, type EmailBranding } from '../email-branding';
import { buildWeeklyReviewEmail, buildWorkspaceResetEmail } from '../../notifications/notification-templates';
import { organisationName, PRODUCT_NAME, workspaceDisplayName } from '../../config/product';

/**
 * A workspace's e-mails name its organisation (Admin > Branding): the header when the tenant has no
 * logo, the subjects, the button that opens the workspace, and in the cloud the sender name
 * "<Organisation> via <product>" on the configured address. The footer says "Powered by" the
 * product once. Without an organisation name (or with the on-premise default) they name the product.
 */

process.env.EMAIL_QUEUE_MIN_INTERVAL_MS = '1';
delete process.env.RESEND_FROM_EMAIL;
delete process.env.DEPLOYMENT_MODE;

const TENANT = '11111111-1111-1111-1111-111111111111';

Logger.overrideLogger(false);

function withEnv<T>(name: string, value: string | undefined, fn: () => T): T {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

/** An EmailService whose tenant lookup answers `row`, and whose transport records every message. */
function createEmailService(row: { name: string | null; branding: unknown } | null) {
  const dataSource = { query: async () => (row ? [row] : []) };
  const storage = {
    getObjectStream: async () => ({ stream: [Buffer.from('tenant-logo')], contentType: 'image/png', contentLength: 11 }),
  };
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

const occurrences = (text: string, part: string) => text.split(part).length - 1;

function testOrganisationNameRule() {
  assert.equal(organisationName('  Acme  '), 'Acme');
  assert.equal(organisationName(''), null);
  assert.equal(organisationName(null), null);
  assert.equal(organisationName('My Organization'), null, 'the on-premise default names no organisation');
  assert.equal(workspaceDisplayName('My Organization'), PRODUCT_NAME);
  assert.equal(workspaceDisplayName('Acme'), 'Acme');
}

function testCloudSender() {
  assert.equal(workspaceEmailSender('Acme'), `"Acme via ${PRODUCT_NAME}" <no-reply@kadratis.com>`);
  assert.equal(workspaceEmailSender(null), undefined, 'no organisation name: the default sender');
  assert.equal(workspaceEmailSender('  '), undefined);
  withEnv('RESEND_FROM_EMAIL', 'Operations <ops@mail.example.test>', () => {
    assert.equal(workspaceEmailSender('Acme'), `"Acme via ${PRODUCT_NAME}" <ops@mail.example.test>`, 'the configured address stays');
  });
  withEnv('RESEND_FROM_EMAIL', 'ops@mail.example.test', () => {
    assert.equal(workspaceEmailSender('Acme'), `"Acme via ${PRODUCT_NAME}" <ops@mail.example.test>`);
  });
  // A tenant's name cannot add a header or another address.
  const forged = workspaceEmailSender('Evil"\r\nBcc: victim@example.test <x@y>');
  assert.ok(forged);
  assert.doesNotMatch(forged!, /[\r\n]/);
  assert.equal(forged, `"Evil\\" Bcc: victim@example.test <x@y> via ${PRODUCT_NAME}" <no-reply@kadratis.com>`);
  // On-premise the installer's SMTP_FROM stays as it is.
  withEnv('DEPLOYMENT_MODE', 'single-tenant', () => {
    assert.equal(workspaceEmailSender('Acme'), undefined);
  });
}

async function testTenantBrandingLookup() {
  const named = await loadTenantEmailBranding(async () => [{ name: 'Acme', branding: null }], {} as any, TENANT);
  assert.equal(named.organisationName, 'Acme');
  assert.equal(named.hasTenantLogo, false);
  const unnamed = await loadTenantEmailBranding(async () => [{ name: 'My Organization', branding: null }], {} as any, TENANT);
  assert.equal(unnamed.organisationName, null);
  const failed = await loadTenantEmailBranding(async () => { throw new Error('down'); }, {} as any, TENANT);
  assert.equal(failed.organisationName, null, 'a failed lookup falls back to the product');
}

async function testPasswordResetNamesTheOrganisation() {
  const { service, delivered } = createEmailService({ name: 'Acme', branding: null });
  await service.sendPasswordResetEmail({ to: 'alice@acme.test', resetUrl: 'https://acme.kanap.net/reset-password#token=x', tenantId: TENANT, locale: 'en' });
  await service.drain(Date.now() + 5_000);
  assert.equal(delivered.length, 1);
  const [mail] = delivered;
  assert.equal(mail.subject, 'Reset your password on Acme');
  assert.equal(mail.from, `"Acme via ${PRODUCT_NAME}" <no-reply@kadratis.com>`);
  // No tenant logo: the header names the organisation, and the product logo is not attached.
  assert.match(mail.html, /<span[^>]*>Acme<\/span>/);
  assert.equal(mail.attachments?.length ?? 0, 0);
  assert.equal(occurrences(mail.html, `Powered by ${PRODUCT_NAME}`), 1, '"Powered by" once, in the footer');
}

async function testInvitationWithTenantLogo() {
  const { service, delivered } = createEmailService({ name: 'Acme & Co', branding: { logo_storage_path: 'tenants/acme/logo.png' } });
  await service.sendUserInviteEmail({ to: 'bob@acme.test', inviteUrl: 'https://acme.kanap.net/accept-invite#token=x', tenantId: TENANT, locale: 'fr' });
  await service.drain(Date.now() + 5_000);
  const [mail] = delivered;
  assert.equal(mail.subject, 'Invitation à rejoindre Acme & Co');
  assert.match(mail.html, /rejoindre l(&#0?39;|')espace Acme &amp; Co sur/);
  assert.match(mail.text ?? '', /rejoindre l'espace Acme & Co sur/);
  assert.match(mail.html, /<img src="cid:[^"]+" alt="Acme &amp; Co"/);
  assert.equal(mail.attachments?.length, 1, 'the tenant logo is attached');
  assert.equal(occurrences(mail.html, `Propulsé par ${PRODUCT_NAME}`), 1);
}

async function testWithoutTenantTheProductStays() {
  const { service, delivered } = createEmailService(null);
  await service.sendPasswordResetEmail({ to: 'alice@acme.test', resetUrl: 'https://acme.kanap.net/reset-password#token=x', locale: 'en' });
  await service.drain(Date.now() + 5_000);
  const [mail] = delivered;
  assert.equal(mail.subject, `Reset your password on ${PRODUCT_NAME}`);
  assert.equal(mail.from, undefined, 'the default sender');
  if (getDefaultEmailBranding().logoBuffer.length > 0) {
    assert.match(mail.html, new RegExp(`<img src="cid:[^"]+" alt="${PRODUCT_NAME}"`));
  }
}

function testNotificationTemplates() {
  const branding: EmailBranding = { ...getDefaultEmailBranding(), organisationName: 'Acme' };
  const week = {
    firstName: 'Alice',
    weekStart: '2026-11-02',
    weekEnd: '2026-11-08',
    appUrl: 'https://acme.kanap.net',
    tasksClosed: [] as Array<{ id: string; title: string }>,
    projectsWithChanges: [],
    tasksClosedOnProjects: [],
    topTasks: [],
    topProjectsAsLead: [],
    topProjectsAsContributor: [],
    newRequests: [],
    branding,
    locale: 'en',
  };
  assert.equal(buildWeeklyReviewEmail(week), null, 'an empty week sends nothing');
  const weekly = buildWeeklyReviewEmail({ ...week, tasksClosed: [{ id: 't1', title: 'Renew the backup licence' }] });
  assert.ok(weekly);
  assert.equal(weekly.subject, 'Your week from 2 to 8 November on Acme');
  assert.match(weekly.html, />Open Acme</);
  assert.match(weekly.text, /Open Acme: https:\/\/acme\.kanap\.net/);

  const reset = buildWorkspaceResetEmail({
    actorName: 'Alice',
    workspaceName: 'Acme',
    resetAt: new Date('2026-11-07T10:00:00Z'),
    workspaceUrl: 'https://acme.kanap.net',
    branding,
    locale: 'de',
  });
  assert.equal(reset.subject, 'Ihr Arbeitsbereich Acme wurde zurückgesetzt');
  assert.equal(buildWorkspaceResetEmail({ actorName: 'Alice', workspaceName: 'Acme', resetAt: new Date('2026-11-07T10:00:00Z'), workspaceUrl: 'https://acme.kanap.net', branding, locale: 'en' }).subject, 'Your Acme workspace was reset');
  const unnamed = buildWorkspaceResetEmail({
    actorName: 'Alice',
    workspaceName: 'acme',
    resetAt: new Date('2026-11-07T10:00:00Z'),
    workspaceUrl: 'https://acme.kanap.net',
    locale: 'en',
  });
  assert.equal(unnamed.subject, `Your ${PRODUCT_NAME} workspace was reset`);
}

async function main() {
  testOrganisationNameRule();
  testCloudSender();
  await testTenantBrandingLookup();
  await testPasswordResetNamesTheOrganisation();
  await testInvitationWithTenantLogo();
  await testWithoutTenantTheProductStays();
  testNotificationTemplates();
  console.log('workspace-email-identity.spec: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
