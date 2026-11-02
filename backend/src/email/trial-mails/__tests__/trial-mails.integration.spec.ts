import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Request, Response } from 'express';
import { DataSource } from 'typeorm';
import dataSource from '../../../data-source';
import {
  ActivatedTenant,
  buildServices,
  cleanupTenants,
  createActivatedTenant,
  inTenant,
  runSpecs,
} from '../../../admin/tenants/__tests__/tenant-reset-test-helpers';
import { createBodyParsers } from '../../../common/body-parsers';
import { ListContextsService } from '../../../common/list-context/list-contexts.service';
import { useRequestPipeline } from '../../../common/request-pipeline';
import { createRequestTenancyMiddleware } from '../../../common/tenancy/request-tenancy.middleware';
import { DiscoveryCallService } from '../../../discovery-call/discovery-call.service';
import type { SendEmailOptions } from '../../email.types';
import { signTrialMailLink } from '../trial-mail-links';
import { TrialMailsController } from '../trial-mails.controller';
import { TrialMailsService } from '../trial-mails.service';

// The trial e-mails (`doc/trial-mails.md`) on the spec database, with a recording e-mail service:
// - J0 after the choice of a path, once, and not again from a new process (a restart);
// - J0 an hour after the first sign-in seen without a choice, with the three paths;
// - J+5 from Friedrich, by the discovery call; J+12 and the end-of-trial notice at their time;
// - the thank-you once at the first Stripe subscription, never for a workspace never seen in
//   trial; nothing more of the trial sequence after it;
// - a failed send lifts its stamp; nothing at all while e-mail sending is off;
// - over HTTP: the unsubscribe page, its confirmation (and the audit entry) that stops the
//   sequence, the counted redirect to the discovery call, 404 on a bad token.
// @database-spec: opens the data-source and boots Nest, so run-ci-tests.js runs it on a database lane.

const DAY = 24 * 60 * 60 * 1000;
const BOOKING_URL = 'https://cal.com/kanap/decouverte';

class RecordingEmail {
  transportName = 'resend';
  sent: SendEmailOptions[] = [];
  fail = false;
  async send(options: SendEmailOptions) {
    if (this.fail) throw new Error('relay down');
    this.sent.push(options);
  }
  to(address: string) {
    return this.sent.filter((mail) => mail.to === address);
  }
}

function service(email = new RecordingEmail()) {
  const scheduledTasks = { register: () => undefined };
  return { email, trialMails: new TrialMailsService(dataSource, email as any, scheduledTasks as any, new DiscoveryCallService(dataSource)) };
}

async function withEnv<T>(values: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  const apply = (entries: Record<string, string | undefined>) => {
    for (const [key, value] of Object.entries(entries)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  apply(values);
  try {
    return await fn();
  } finally {
    apply(previous);
  }
}

const ENV = { APP_BASE_URL: 'https://app.trial-mails-spec.test', DISCOVERY_CALL_URL: BOOKING_URL };

/** The trial's start (the sign-up's activation) and end, as stored. */
async function trialDates(t: ActivatedTenant): Promise<{ start: Date; end: Date }> {
  const [signup] = await dataSource.query(`SELECT activated_at FROM trial_signups WHERE slug = $1`, [t.slug]);
  const [sub] = await inTenant(t.tenantId, (m) => m.query(`SELECT trial_end FROM subscriptions WHERE tenant_id = $1`, [t.tenantId]));
  return { start: new Date(signup.activated_at), end: new Date(sub.trial_end) };
}

const readState = (tenantId: string) => inTenant(tenantId, async (m) => (await m.query(`SELECT * FROM trial_mails WHERE tenant_id = $1`, [tenantId]))[0] ?? null);

const choose = (tenantId: string, angle: string | null, mode: string | null) => inTenant(tenantId, (m) => m.query(
  `INSERT INTO tenant_onboarding (tenant_id, angle, mode, chosen_at) VALUES ($1, $2, $3, now())
   ON CONFLICT (tenant_id) DO UPDATE SET angle = EXCLUDED.angle, mode = EXCLUDED.mode`,
  [tenantId, angle, mode],
));

const stamp = (tenantId: string, columns: string[]) => inTenant(tenantId, async (m) => {
  await m.query(`INSERT INTO trial_mails (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`, [tenantId]);
  await m.query(`UPDATE trial_mails SET ${columns.map((c) => `${c} = now()`).join(', ')} WHERE tenant_id = $1`, [tenantId]);
});

async function testWelcomeOnceAfterTheChoice() {
  const svc = buildServices();
  let t: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'tm-j0', orgName: 'Trial Welcome', signup: true });
    await inTenant(t.tenantId, (m) => m.query(`UPDATE users SET first_name = 'Camille' WHERE id = $1`, [t!.ownerId]));
    const { start } = await trialDates(t);
    await withEnv(ENV, async () => {
      const { email, trialMails } = service();
      await trialMails.onSubscriptionChanged(t!.tenantId, new Date(start.getTime() + 60_000));
      assert.equal(email.to(t!.ownerEmail).length, 0, 'nothing before a choice or a sign-in');
      assert.ok(await readState(t!.tenantId), 'the trial is enrolled');

      await choose(t!.tenantId, 'budget', 'example');
      await trialMails.onSubscriptionChanged(t!.tenantId, new Date(start.getTime() + 120_000));
      const [mail] = email.to(t!.ownerEmail);
      assert.equal(mail?.subject, 'Welcome to your KANAP workspace');
      assert.ok(mail.html.includes('Hello Camille,') && mail.text!.includes('/first-steps/budget-example/'));
      assert.equal(mail.replyTo, 'Friedrich <fried@kanap.net>');
      assert.equal(mail.from, undefined, 'J0 leaves from the application address');
      assert.match(mail.headers?.['List-Unsubscribe'] ?? '', /^<https:\/\/rs-tm-j0-[^/]+\.trial-mails-spec\.test\/api\/trial-mails\/unsubscribe\?t=/);
      assert.equal(mail.headers?.['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
      assert.ok(mail.text!.includes('/api/trial-mails/call?t='), 'the call link counts its click');

      await trialMails.onSubscriptionChanged(t!.tenantId, new Date(start.getTime() + 180_000));
      const restarted = service();
      await restarted.trialMails.onSubscriptionChanged(t!.tenantId, new Date(start.getTime() + 240_000));
      assert.equal(email.to(t!.ownerEmail).length + restarted.email.to(t!.ownerEmail).length, 1, 'once per workspace, across processes');
      assert.ok((await readState(t!.tenantId)).j0_sent_at);
    });
  } finally {
    await cleanupTenants([t?.tenantId]);
  }
}

async function testWelcomeAnHourAfterTheFirstSignIn() {
  const svc = buildServices();
  let t: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'tm-login', orgName: 'Trial Login', signup: true, language: 'fr' });
    const { start } = await trialDates(t);
    const signIn = new Date(start.getTime() + 10 * 60_000);
    await inTenant(t.tenantId, (m) => m.query(`UPDATE users SET last_login_at = $2 WHERE id = $1`, [t!.ownerId, signIn]));
    await withEnv(ENV, async () => {
      const { email, trialMails } = service();
      await trialMails.onSubscriptionChanged(t!.tenantId, new Date(signIn.getTime() + 5 * 60_000));
      assert.equal(new Date((await readState(t!.tenantId)).first_login_at).getTime(), signIn.getTime(), 'the first sign-in is noted');
      // A later sign-in does not move it.
      await inTenant(t!.tenantId, (m) => m.query(`UPDATE users SET last_login_at = $2 WHERE id = $1`, [t!.ownerId, new Date(signIn.getTime() + 50 * 60_000)]));
      await trialMails.onSubscriptionChanged(t!.tenantId, new Date(signIn.getTime() + 59 * 60_000));
      assert.equal(email.to(t!.ownerEmail).length, 0, 'not before the hour');
      await trialMails.onSubscriptionChanged(t!.tenantId, new Date(signIn.getTime() + 61 * 60_000));
      const [mail] = email.to(t!.ownerEmail);
      assert.equal(mail?.subject, 'Bienvenue dans votre espace KANAP', 'the language of the workspace');
      assert.ok(mail.text!.includes('Je vous propose trois parcours') && mail.text!.includes('/fr/first-steps/portfolio-example/'));
      assert.ok(mail.text!.startsWith('Bonjour,'), 'no first name: no name in the greeting');
    });
  } finally {
    await cleanupTenants([t?.tenantId]);
  }
}

async function testFollowUpEndingAndNotice() {
  const svc = buildServices();
  let t: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'tm-seq', orgName: 'Trial Sequence', signup: true, language: 'fr' });
    const { start, end } = await trialDates(t);
    await stamp(t.tenantId, ['j0_sent_at']);
    await inTenant(t.tenantId, (m) => new DiscoveryCallService(dataSource).save(m, t!.tenantId, {
      scheduled_at: new Date(start.getTime() + 7 * DAY), status: 'booked', source: 'manual',
    }));
    await withEnv(ENV, async () => {
      const { email, trialMails } = service();
      await trialMails.onSubscriptionChanged(t!.tenantId, new Date(start.getTime() + 5 * DAY + 60_000));
      const [followUp] = email.to(t!.ownerEmail);
      assert.equal(followUp?.subject, 'Comment se passent vos tests ?', 'a call to come');
      assert.equal(followUp.from, 'Friedrich <fried@kanap.net>', 'J+5 leaves from Friedrich');
      assert.equal(followUp.replyTo, undefined);
      assert.ok(!followUp.text!.includes('/api/trial-mails/call'), 'no call link when one is booked');

      await trialMails.onSubscriptionChanged(t!.tenantId, new Date(end.getTime() - DAY));
      assert.equal(email.to(t!.ownerEmail)[1]?.subject, 'Votre essai se termine dans deux jours');

      await trialMails.onSubscriptionChanged(t!.tenantId, new Date(end.getTime() + 60_000));
      const notice = email.to(t!.ownerEmail)[2];
      assert.equal(notice?.subject, 'Votre essai KANAP est arrivé à son terme');
      const deletion = new Intl.DateTimeFormat('fr', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' })
        .format(new Date(end.getTime() + 30 * DAY));
      assert.ok(notice.text!.includes(`supprimé définitivement le ${deletion}`), 'the deletion date');

      await trialMails.onSubscriptionChanged(t!.tenantId, new Date(end.getTime() + 2 * DAY));
      assert.equal(email.to(t!.ownerEmail).length, 3, 'nothing after the notice');
    });
  } finally {
    await cleanupTenants([t?.tenantId]);
  }
}

async function testThanksAtTheFirstSubscriptionOnly() {
  const svc = buildServices();
  let t: ActivatedTenant | undefined;
  let before: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'tm-paid', orgName: 'Trial Paid', signup: true });
    before = await createActivatedTenant(svc, { tag: 'tm-old', orgName: 'Paid Before', signup: true });
    const { start } = await trialDates(t);
    const subscribe = (tenantId: string) => inTenant(tenantId, (m) => m.query(
      `UPDATE subscriptions SET status = 'active', stripe_subscription_id = 'sub_' || substr(md5(random()::text), 1, 12), trial_end = NULL WHERE tenant_id = $1`,
      [tenantId],
    ));
    await subscribe(before.tenantId);
    await withEnv(ENV, async () => {
      const { email, trialMails } = service();
      await trialMails.onSubscriptionChanged(t!.tenantId, new Date(start.getTime() + 60_000));
      await subscribe(t!.tenantId);
      await trialMails.onSubscriptionChanged(t!.tenantId, new Date(start.getTime() + 6 * DAY));
      const [thanks] = email.to(t!.ownerEmail);
      assert.equal(thanks?.subject, 'Thank you for your trust');
      assert.equal(thanks.headers, undefined, 'a service e-mail: no unsubscribe header');
      assert.ok(!thanks.html.includes('/api/trial-mails/unsubscribe'));
      await trialMails.onSubscriptionChanged(t!.tenantId, new Date(start.getTime() + 13 * DAY));
      assert.equal(email.to(t!.ownerEmail).length, 1, 'once, and the trial sequence stops');

      await trialMails.onSubscriptionChanged(before!.tenantId, new Date(start.getTime() + 6 * DAY));
      assert.equal(email.to(before!.ownerEmail).length, 0, 'never seen in trial: no thank-you');
      assert.equal(await readState(before!.tenantId), null);
    });
  } finally {
    await cleanupTenants([t?.tenantId, before?.tenantId]);
  }
}

async function testFailedSendAndEmailOff() {
  const svc = buildServices();
  let t: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'tm-fail', orgName: 'Trial Failure', signup: true });
    await choose(t.tenantId, 'portfolio', 'own_data');
    const { start } = await trialDates(t);
    const now = new Date(start.getTime() + 60_000);
    await withEnv(ENV, async () => {
      const off = service();
      off.email.transportName = 'disabled';
      assert.equal((await off.trialMails.run(now)).skipped_reason, 'e-mail sending is off');
      assert.equal(await readState(t!.tenantId), null, 'nothing written while sending is off');

      const { email, trialMails } = service();
      email.fail = true;
      await trialMails.onSubscriptionChanged(t!.tenantId, now);
      assert.equal((await readState(t!.tenantId)).j0_sent_at, null, 'a failed send lifts its stamp');
      email.fail = false;
      const summary = await trialMails.run(now);
      assert.ok((summary.sent.j0 ?? 0) >= 1);
      assert.equal(email.to(t!.ownerEmail).length, 1, 'sent at the next run');
    });
  } finally {
    await cleanupTenants([t?.tenantId]);
  }
}

type Served = { port: number; close: () => Promise<void> };

async function serve(): Promise<Served> {
  @Module({
    controllers: [TrialMailsController],
    providers: [ListContextsService, { provide: TrialMailsService, useFactory: () => service().trialMails }, { provide: DataSource, useValue: dataSource }],
  })
  class TrialMailsProbeModule {}

  const app: INestApplication = await NestFactory.create(TrialMailsProbeModule, { logger: false, bodyParser: false });
  app.use(...createBodyParsers((req: Request, _res: Response, buffer: Buffer) => {
    if (buffer?.length) (req as any).rawBody = buffer;
  }));
  app.use(createRequestTenancyMiddleware({
    query: (sql, params) => dataSource.query(sql, params),
    singleTenant: false,
    defaultTenantSlug: 'default',
    platformAdminHost: 'platform.trial-mails-spec.test',
    marketingRedirectUrl: 'https://www.kanap.test',
  }));
  useRequestPipeline(app, dataSource);
  await app.listen(0, '127.0.0.1');
  return { port: (app.getHttpServer().address() as AddressInfo).port, close: () => app.close() };
}

function request(served: Served, method: 'GET' | 'POST', path: string, body?: string) {
  return new Promise<{ status: number; body: string; location?: string }>((resolve, reject) => {
    const payload = Buffer.from(body ?? '');
    const req = http.request({
      host: '127.0.0.1',
      port: served.port,
      method,
      path,
      headers: { Host: 'localhost', 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': String(payload.length) },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), location: res.headers.location }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

const trialAudit = (tenantId: string) => inTenant(tenantId, (m) => m.query(
  `SELECT action, after_json, source FROM audit_log WHERE tenant_id = $1 AND table_name = 'trial' ORDER BY created_at, id`,
  [tenantId],
));

async function testLinksOverHttp() {
  const svc = buildServices();
  const served = await serve();
  let t: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'tm-http', orgName: 'Trial Links', signup: true, language: 'de' });
    await choose(t.tenantId, 'budget', 'example');
    const unsubscribe = `/trial-mails/unsubscribe?t=${encodeURIComponent(signTrialMailLink(t.tenantId, 'unsubscribe'))}`;
    await withEnv(ENV, async () => {
      const page = await request(served, 'GET', unsubscribe);
      assert.equal(page.status, 200);
      assert.ok(page.body.includes('Trial Links') && page.body.includes('<form method="post"'), 'a page that asks to confirm');
      assert.equal(await readState(t!.tenantId), null, 'opening the page unsubscribes nobody');

      // The one-click unsubscribe of mail clients posts the same address.
      const done = await request(served, 'POST', unsubscribe, 'List-Unsubscribe=One-Click');
      assert.equal(done.status, 200);
      assert.ok(done.body.includes('Erledigt'), 'in the language of the workspace');
      assert.ok((await readState(t!.tenantId)).unsubscribed_at);
      await request(served, 'POST', unsubscribe);
      assert.deepEqual((await trialAudit(t!.tenantId)).map((entry: any) => [entry.action, entry.source]), [['trial.mails_unsubscribed', 'system']], 'one entry');

      const { start } = await trialDates(t!);
      const { email, trialMails } = service();
      await trialMails.onSubscriptionChanged(t!.tenantId, new Date(start.getTime() + 60_000));
      assert.equal(email.to(t!.ownerEmail).length, 0, 'unsubscribed: no trial e-mail');

      const callToken = encodeURIComponent(signTrialMailLink(t!.tenantId, 'mail_j0'));
      const redirect = await request(served, 'GET', `/trial-mails/call?t=${callToken}`);
      assert.deepEqual([redirect.status, redirect.location], [302, BOOKING_URL]);
      const clicks = (await trialAudit(t!.tenantId)).filter((entry: any) => entry.action === 'trial.discovery_call_clicked');
      assert.deepEqual(clicks.map((entry: any) => [entry.after_json?.placement, entry.source]), [['mail_j0', 'system']]);

      for (const path of [
        '/trial-mails/unsubscribe?t=bad',
        `/trial-mails/unsubscribe?t=${callToken}`,
        `/trial-mails/call?t=${encodeURIComponent(signTrialMailLink(t!.tenantId, 'unsubscribe'))}`,
      ]) {
        assert.equal((await request(served, 'GET', path)).status, 404, path);
      }
    });
    await withEnv({ ...ENV, DISCOVERY_CALL_URL: undefined, DISCOVERY_CALL_FALLBACK_EMAIL: undefined }, async () => {
      const token = encodeURIComponent(signTrialMailLink(t!.tenantId, 'mail_j5'));
      assert.equal((await request(served, 'GET', `/trial-mails/call?t=${token}`)).status, 404, 'no booking page');
    });
  } finally {
    await served.close();
    await cleanupTenants([t?.tenantId]);
  }
}

runSpecs('trial-mails.integration.spec', [
  testWelcomeOnceAfterTheChoice,
  testWelcomeAnHourAfterTheFirstSignIn,
  testFollowUpEndingAndNotice,
  testThanksAtTheFirstSubscriptionOnly,
  testFailedSendAndEmailOff,
  testLinksOverHttp,
]).catch((error) => {
  console.error(error);
  process.exit(1);
});
