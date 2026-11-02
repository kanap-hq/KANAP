import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Request, Response } from 'express';
import * as jwt from 'jsonwebtoken';
import { DataSource } from 'typeorm';
import dataSource from '../../data-source';
import {
  ActivatedTenant,
  buildServices,
  cleanupTenants,
  createActivatedTenant,
  inTenant,
  refusal,
  runSpecs,
} from '../../admin/tenants/__tests__/tenant-reset-test-helpers';
import { buildAccessTokenPayload } from '../../auth/auth.service';
import { accessTokenVerifyKey } from '../../auth/jwt-key';
import { createBodyParsers } from '../../common/body-parsers';
import { ListContextsService } from '../../common/list-context/list-contexts.service';
import { useRequestPipeline } from '../../common/request-pipeline';
import { createRequestTenancyMiddleware } from '../../common/tenancy/request-tenancy.middleware';
import { discoveryCallConfig } from '../discovery-call.config';
import { DiscoveryCallController } from '../discovery-call.controller';
import { DiscoveryCallService, discoveryCallTiming } from '../discovery-call.service';

// The discovery call (`doc/discovery-call.md`) over HTTP: the real controller and service on the
// spec database, behind the tenancy middleware, the body parsers that keep the raw body and the
// request pipeline main.ts installs.
// - the Cal.com webhook: 404 without a secret, 401 on a bad signature; a booking made with the
//   address of a trial sign-up becomes that workspace's call, a reschedule moves it, a
//   cancellation of another booking changes nothing, the cancellation of this one marks it
//   cancelled; an unknown address or event is answered 200 and ignored;
// - the button clicks: an audit entry per click, a placement outside the list is a 400;
// - the call set by hand, its validation, its removal; another workspace sees nothing;
// - the configuration reads its three variables and drops what is not a URL or an address.
// @database-spec: opens the data-source and boots Nest, so run-ci-tests.js runs it on a database lane.

const SECRET = 'discovery-call-spec-secret';

type Served = { port: number; close: () => Promise<void> };

async function serve(): Promise<Served> {
  @Module({
    controllers: [DiscoveryCallController],
    providers: [ListContextsService, DiscoveryCallService, { provide: DataSource, useValue: dataSource }],
  })
  class DiscoveryCallProbeModule {}

  const app: INestApplication = await NestFactory.create(DiscoveryCallProbeModule, { logger: false, bodyParser: false });
  app.use(...createBodyParsers((req: Request, _res: Response, buffer: Buffer) => {
    if (buffer?.length) (req as any).rawBody = buffer;
  }));
  app.use(createRequestTenancyMiddleware({
    query: (sql, params) => dataSource.query(sql, params),
    singleTenant: false,
    defaultTenantSlug: 'default',
    platformAdminHost: 'platform.discovery-spec.test',
    marketingRedirectUrl: 'https://www.kanap.test',
  }));
  useRequestPipeline(app, dataSource);
  await app.listen(0, '127.0.0.1');
  return { port: (app.getHttpServer().address() as AddressInfo).port, close: () => app.close() };
}

function call(served: Served, opts: { path: string; host: string; token?: string; body?: unknown; headers?: Record<string, string> }) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(opts.body ?? {}));
    const req = http.request({
      host: '127.0.0.1',
      port: served.port,
      method: 'POST',
      path: opts.path,
      headers: {
        Host: opts.host,
        'Content-Type': 'application/json',
        'Content-Length': String(payload.length),
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
        ...(opts.headers ?? {}),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let body: any = text;
        try { body = text ? JSON.parse(text) : null; } catch { /* text */ }
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/** A Cal.com webhook post, signed with `secret` (HMAC-SHA256 of the raw body, hex). */
function webhook(served: Served, event: unknown, secret = SECRET) {
  const raw = JSON.stringify(event);
  const signature = createHmac('sha256', secret).update(raw).digest('hex');
  return call(served, { path: '/discovery-call/calcom', host: 'localhost', body: event, headers: { 'x-cal-signature-256': signature } });
}

function booking(trigger: string, uid: string, email: string, startTime: string, extra: Record<string, unknown> = {}) {
  return {
    triggerEvent: trigger,
    createdAt: new Date().toISOString(),
    payload: { uid, startTime, attendees: [{ email, name: 'Trial person' }], organizer: { email: 'fried@kanap.test' }, ...extra },
  };
}

const tokenFor = (t: ActivatedTenant) =>
  jwt.sign(buildAccessTokenPayload({ id: t.ownerId, email: t.ownerEmail, tenant_id: t.tenantId }), accessTokenVerifyKey(), { expiresIn: '10m' });

const readCall = (tenantId: string) => inTenant(tenantId, (m) => new DiscoveryCallService(dataSource).read(m, tenantId));

const auditActions = (tenantId: string) => inTenant(tenantId, (m) => m.query(
  `SELECT action, before_json, after_json, user_id, source FROM audit_log
    WHERE tenant_id = $1 AND table_name = 'trial' ORDER BY created_at, id`,
  [tenantId],
));

async function withSecret<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.DISCOVERY_CALL_WEBHOOK_SECRET;
  if (value === undefined) delete process.env.DISCOVERY_CALL_WEBHOOK_SECRET;
  else process.env.DISCOVERY_CALL_WEBHOOK_SECRET = value;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.DISCOVERY_CALL_WEBHOOK_SECRET;
    else process.env.DISCOVERY_CALL_WEBHOOK_SECRET = previous;
  }
}

async function testWebhookBookings() {
  const svc = buildServices();
  const served = await serve();
  let t: ActivatedTenant | undefined;
  let other: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'dc-book', orgName: 'Discovery Booking', signup: true });
    other = await createActivatedTenant(svc, { tag: 'dc-other', orgName: 'Discovery Other', signup: true });
    await withSecret(SECRET, async () => {
      const created = await webhook(served, booking('BOOKING_CREATED', 'uid-1', t!.ownerEmail.toUpperCase(), '2030-01-10T09:30:00Z'));
      assert.deepEqual([created.status, created.body.outcome], [200, 'applied']);
      let row = await readCall(t!.tenantId);
      assert.deepEqual(
        [row?.scheduled_at, row?.status, row?.source, row?.external_id],
        ['2030-01-10T09:30:00.000Z', 'booked', 'calcom', 'uid-1'],
        'the booking is the workspace call, matched case-insensitively',
      );
      assert.equal(discoveryCallTiming(row, new Date('2030-01-01')), 'upcoming');
      assert.equal(discoveryCallTiming(row, new Date('2030-02-01')), 'past');
      assert.equal(await readCall(other!.tenantId), null, 'the other workspace has no call');

      const moved = await webhook(served, booking('BOOKING_RESCHEDULED', 'uid-2', t!.ownerEmail, '2030-01-12T14:00:00Z', { rescheduleUid: 'uid-1' }));
      assert.equal(moved.body.outcome, 'applied');
      row = await readCall(t!.tenantId);
      assert.deepEqual([row?.scheduled_at, row?.external_id], ['2030-01-12T14:00:00.000Z', 'uid-2'], 'the reschedule moves the call');

      const stale = await webhook(served, booking('BOOKING_CANCELLED', 'uid-1', t!.ownerEmail, '2030-01-10T09:30:00Z'));
      assert.equal(stale.body.outcome, 'ignored', 'cancelling an older booking changes nothing');
      assert.equal((await readCall(t!.tenantId))?.status, 'booked');

      const cancelled = await webhook(served, booking('BOOKING_CANCELLED', 'uid-2', t!.ownerEmail, '2030-01-12T14:00:00Z'));
      assert.equal(cancelled.body.outcome, 'applied');
      row = await readCall(t!.tenantId);
      assert.deepEqual([row?.status, row?.scheduled_at], ['cancelled', '2030-01-12T14:00:00.000Z'], 'the cancellation keeps the date');
      assert.equal(discoveryCallTiming(row, new Date('2030-01-01')), 'none');

      const audit = await auditActions(t!.tenantId);
      assert.deepEqual(audit.map((entry: any) => [entry.action, entry.source, entry.user_id]), [
        ['trial.discovery_call_updated', 'webhook', null],
        ['trial.discovery_call_updated', 'webhook', null],
        ['trial.discovery_call_updated', 'webhook', null],
      ]);
      assert.equal(audit[0].before_json, null);
      assert.deepEqual(audit[2].after_json, { scheduled_at: '2030-01-12T14:00:00.000Z', status: 'cancelled', source: 'calcom', note: null });
    });
  } finally {
    await served.close();
    await cleanupTenants([t?.tenantId, other?.tenantId]);
  }
}

async function testWebhookRefusals() {
  const svc = buildServices();
  const served = await serve();
  let t: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'dc-refuse', orgName: 'Discovery Refusals', signup: true });
    const event = booking('BOOKING_CREATED', 'uid-r', t.ownerEmail, '2030-03-01T10:00:00Z');
    await withSecret(undefined, async () => {
      assert.equal((await webhook(served, event)).status, 404, 'no secret: no webhook');
    });
    await withSecret(SECRET, async () => {
      assert.equal((await webhook(served, event, 'another-secret')).status, 401, 'a bad signature is refused');
      const unsigned = await call(served, { path: '/discovery-call/calcom', host: 'localhost', body: event });
      assert.equal(unsigned.status, 401, 'an unsigned post is refused');
      const unknown = await webhook(served, booking('BOOKING_CREATED', 'uid-u', 'nobody@elsewhere.test', '2030-03-01T10:00:00Z'));
      assert.deepEqual([unknown.status, unknown.body.outcome], [200, 'ignored'], 'an address with no trial is ignored');
      const ping = await webhook(served, { triggerEvent: 'PING', payload: {} });
      assert.deepEqual([ping.status, ping.body.outcome], [200, 'ignored'], 'another event is ignored');
      const noDate = await webhook(served, booking('BOOKING_CREATED', 'uid-d', t!.ownerEmail, 'not a date'));
      assert.equal(noDate.body.outcome, 'ignored');
    });
    assert.equal(await readCall(t.tenantId), null, 'nothing was written');
  } finally {
    await served.close();
    await cleanupTenants([t?.tenantId]);
  }
}

async function testClicks() {
  const svc = buildServices();
  const served = await serve();
  let t: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'dc-click', orgName: 'Discovery Clicks' });
    const host = `${t.slug}.lvh.me`;
    const token = tokenFor(t);
    for (const placement of ['last_step', 'about']) {
      const res = await call(served, { path: '/discovery-call/clicks', host, token, body: { placement } });
      assert.equal(res.status, 204, `${placement} is recorded`);
    }
    const bad = await call(served, { path: '/discovery-call/clicks', host, token, body: { placement: 'sidebar' } });
    assert.deepEqual([bad.status, bad.body.code], [400, 'discovery_call_placement_invalid']);
    const anonymous = await call(served, { path: '/discovery-call/clicks', host, body: { placement: 'about' } });
    assert.equal(anonymous.status, 401);
    const audit = await auditActions(t.tenantId);
    assert.deepEqual(audit.map((entry: any) => [entry.action, entry.after_json, entry.user_id, entry.source]), [
      ['trial.discovery_call_clicked', { placement: 'last_step' }, t.ownerId, 'user'],
      ['trial.discovery_call_clicked', { placement: 'about' }, t.ownerId, 'user'],
    ]);
  } finally {
    await served.close();
    await cleanupTenants([t?.tenantId]);
  }
}

async function testManual() {
  const svc = buildServices();
  const service = new DiscoveryCallService(dataSource);
  let t: ActivatedTenant | undefined;
  let other: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'dc-manual', orgName: 'Discovery Manual' });
    other = await createActivatedTenant(svc, { tag: 'dc-manual-o', orgName: 'Discovery Manual Other' });
    for (const body of [{}, { scheduled_at: 'tomorrow' }, { scheduled_at: '2030-04-01T10:00:00Z', status: 'held' }, { scheduled_at: '2030-04-01T10:00:00Z', note: 5 }]) {
      const error = await refusal(() => inTenant(t!.tenantId, (m) => service.saveManual(m, t!.tenantId, body)));
      assert.equal(error.getResponse().code, 'discovery_call_invalid', JSON.stringify(body));
    }
    const saved = await inTenant(t.tenantId, (m) => service.saveManual(m, t!.tenantId, { scheduled_at: '2030-04-01T10:00:00Z', note: '  Asked about budgets  ' }));
    assert.deepEqual(
      [saved.scheduled_at, saved.status, saved.source, saved.note, saved.external_id],
      ['2030-04-01T10:00:00.000Z', 'booked', 'manual', 'Asked about budgets', null],
    );
    // Another workspace reads nothing of it, even with this tenant's id in its query.
    const seen = await inTenant(other.tenantId, (m) => m.query(`SELECT 1 FROM trial_discovery_calls WHERE tenant_id = $1`, [t!.tenantId]));
    assert.equal(seen.length, 0, 'row level security hides the call');
    await inTenant(t.tenantId, (m) => service.remove(m, t!.tenantId));
    assert.equal(await readCall(t.tenantId), null);
    const audit = await auditActions(t.tenantId);
    assert.deepEqual(audit.map((entry: any) => [entry.action, entry.source]), [
      ['trial.discovery_call_updated', 'webhook'],
      ['trial.discovery_call_removed', 'webhook'],
    ]);
  } finally {
    await cleanupTenants([t?.tenantId, other?.tenantId]);
  }
}

async function testConfig() {
  assert.deepEqual(discoveryCallConfig({}), { url: '', fallbackEmail: '', webhookSecret: '' });
  assert.deepEqual(discoveryCallConfig({
    DISCOVERY_CALL_URL: ' https://cal.com/kanap/decouverte ',
    DISCOVERY_CALL_FALLBACK_EMAIL: 'fried@kanap.test',
    DISCOVERY_CALL_WEBHOOK_SECRET: ' s3cret ',
  }), { url: 'https://cal.com/kanap/decouverte', fallbackEmail: 'fried@kanap.test', webhookSecret: 's3cret' });
  assert.deepEqual(discoveryCallConfig({ DISCOVERY_CALL_URL: 'javascript:alert(1)', DISCOVERY_CALL_FALLBACK_EMAIL: 'not an address' }),
    { url: '', fallbackEmail: '', webhookSecret: '' }, 'neither a URL nor an address');
}

runSpecs('discovery-call.integration.spec', [
  testConfig,
  testWebhookBookings,
  testWebhookRefusals,
  testClicks,
  testManual,
]).catch((error) => {
  console.error(error);
  process.exit(1);
});
