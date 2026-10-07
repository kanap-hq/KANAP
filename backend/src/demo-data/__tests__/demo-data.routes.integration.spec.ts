import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import * as http from 'node:http';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { PassThrough } from 'node:stream';
import { INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import * as jwt from 'jsonwebtoken';
import { DataSource } from 'typeorm';
import dataSource from '../../data-source';
import {
  ActivatedTenant,
  addRealUser,
  buildServices,
  cleanupTenants,
  createActivatedTenant,
  inTenant,
  runSpecs,
  Services,
} from '../../admin/tenants/__tests__/tenant-reset-test-helpers';
import { buildAccessTokenPayload } from '../../auth/auth.service';
import { accessTokenVerifyKey } from '../../auth/jwt-key';
import { waitForBackgroundWork } from '../../common/background-work';
import { ListContextsService } from '../../common/list-context/list-contexts.service';
import { RATE_LIMITS } from '../../common/rate-limit';
import { useRequestPipeline } from '../../common/request-pipeline';
import { createRequestTenancyMiddleware } from '../../common/tenancy/request-tenancy.middleware';
import { Features } from '../../config/features';
import { NotificationsService } from '../../notifications/notifications.service';
import { DemoDataController } from '../demo-data.controller';
import { DEMO_CREATED_SINCE_TABLES, DemoDataService, readDemoState } from '../demo-data.service';

// The sample data routes (`/admin/sample-data`) over HTTP: the real controller and its guards
// (MultiTenantOnlyGuard, JwtAuthGuard on signed access tokens, the per-user rate limit), the
// tenancy middleware and the request pipeline main.ts installs, the real DemoDataService and
// tenant reset on the spec database; the loader process and the e-mails are doubles.
// - only an Administrator of the workspace gets an answer (403 `administrator_required`);
//   on-premise and on the platform host the routes do not exist (404);
// - `GET` gives the state, whether a load can start, the objects created since the load and
//   the workspace name; the load answers 202 `loading` with the request's Host passed on;
// - the reset needs the workspace name (400 `confirmation_mismatch` otherwise, spaces and case
//   ignored), answers 202 `resetting` before the reset has run, and e-mails the administrators
//   once it has committed (not when it fails);
// - a frozen subscription refuses the load and allows the reset;
// - the actions are rate limited per user; `dismiss` writes `metadata.demo.dismissed_at` only.
// And the reset e-mail goes to the enabled users with the Administrator role, nobody else.
// @database-spec: opens the data-source and boots Nest, so run-ci-tests.js runs it in the serial lane.

const PLATFORM_HOST = 'platform.sample-data-spec.test';

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid = 4343;
  done = false;
  kill() { this.finish(null, 'SIGKILL'); return true; }
  finish(code: number | null, signal: string | null = null) {
    if (this.done) return;
    this.done = true;
    this.stdout.end();
    this.stderr.end();
    setTimeout(() => this.emit('close', code, signal), 20);
  }
}

type Served = {
  app: INestApplication;
  port: number;
  service: DemoDataService;
  children: Array<{ env: Record<string, string>; child: FakeChild }>;
  emails: Array<{ tenantId: string; actorId: string }>;
  close: () => Promise<void>;
};

/** The routes on a local port, with the services under test. */
async function serve(svc: Services, opts: { stripeConfigured?: boolean; failReset?: boolean; holdResetMs?: number } = {}): Promise<Served> {
  const children: Served['children'] = [];
  const emails: Served['emails'] = [];
  const reset = {
    async reset(tenantId: string, actorId: string | null) {
      if (opts.holdResetMs) await new Promise((resolve) => setTimeout(resolve, opts.holdResetMs));
      if (opts.failReset) throw new Error('injected reset failure');
      return svc.reset.reset(tenantId, actorId);
    },
  };
  const notifications = {
    async notifyWorkspaceReset(params: { tenantId: string; actorId: string }) {
      emails.push({ tenantId: params.tenantId, actorId: params.actorId });
    },
  };
  const service = new DemoDataService(
    dataSource, reset as any, svc.baseline, svc.auth, { isConfigured: () => !!opts.stripeConfigured } as any, notifications as any,
  );
  service.config.scriptPath = __filename;
  service.config.spawn = ((_command: string, _args: string[], options: any) => {
    const child = new FakeChild();
    children.push({ env: options.env, child });
    return child;
  }) as any;
  (service as any).logger = { log: () => undefined, warn: () => undefined, error: () => undefined };

  @Module({
    imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }])],
    controllers: [DemoDataController],
    providers: [
      ListContextsService,
      { provide: DataSource, useValue: dataSource },
      { provide: DemoDataService, useValue: service },
    ],
  })
  class SampleDataProbeModule {}

  const app = await NestFactory.create(SampleDataProbeModule, { logger: false });
  app.use(createRequestTenancyMiddleware({
    query: (sql, params) => dataSource.query(sql, params),
    singleTenant: false,
    defaultTenantSlug: 'default',
    platformAdminHost: PLATFORM_HOST,
    marketingRedirectUrl: 'https://www.kanap.test',
  }));
  useRequestPipeline(app, dataSource);
  await app.listen(0, '127.0.0.1');
  const port = (app.getHttpServer().address() as AddressInfo).port;
  const close = async () => {
    for (const { child } of children) child.finish(0);
    assert.equal(await waitForBackgroundWork(Date.now() + 60_000), 0, 'the background work ended');
    await app.close();
  };
  return { app, port, service, children, emails, close };
}

function call(served: Served, opts: { method: 'GET' | 'POST'; path: string; host: string; token?: string; body?: unknown }) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const payload = opts.body === undefined ? undefined : Buffer.from(JSON.stringify(opts.body));
    const req = http.request({
      host: '127.0.0.1',
      port: served.port,
      method: opts.method,
      path: opts.path,
      headers: {
        Host: opts.host,
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(payload.length) } : {}),
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
    if (payload) req.write(payload);
    req.end();
  });
}

function tokenFor(user: { id: string; email: string; tenant_id: string }): string {
  return jwt.sign(buildAccessTokenPayload(user), accessTokenVerifyKey(), { expiresIn: '10m' });
}

const hostOf = (t: ActivatedTenant) => `${t.slug}.lvh.me`;
const ownerToken = (t: ActivatedTenant) => tokenFor({ id: t.ownerId, email: t.ownerEmail, tenant_id: t.tenantId });

/** The routes of one workspace, as one user. */
function client(served: Served, t: ActivatedTenant, token = ownerToken(t)) {
  const host = hostOf(t);
  return {
    get: () => call(served, { method: 'GET', path: '/admin/sample-data', host, token }),
    banner: () => call(served, { method: 'GET', path: '/admin/sample-data?view=banner', host, token }),
    load: () => call(served, { method: 'POST', path: '/admin/sample-data/load', host, token }),
    reset: (body?: unknown) => call(served, { method: 'POST', path: '/admin/sample-data/reset', host, token, body }),
    dismiss: () => call(served, { method: 'POST', path: '/admin/sample-data/dismiss', host, token }),
  };
}

async function demoOf(tenantId: string) {
  const [row] = await dataSource.query(`SELECT metadata->'demo' AS demo FROM tenants WHERE id = $1`, [tenantId]);
  return readDemoState(row?.demo);
}

async function setDemo(tenantId: string, demo: Record<string, unknown>) {
  await dataSource.query(
    `UPDATE tenants SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('demo', $2::jsonb) WHERE id = $1`,
    [tenantId, JSON.stringify(demo)],
  );
}

async function waitFor<T>(label: string, read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 20_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > until) assert.fail(`${label}: still ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Loads through the route and ends the loader double with success: the status is `loaded`. */
async function loadThroughRoute(served: Served, t: ActivatedTenant) {
  const started = await client(served, t).load();
  assert.equal(started.status, 202, JSON.stringify(started.body));
  served.children.at(-1)!.child.finish(0);
  await waitFor('loaded', () => demoOf(t.tenantId), (state) => state.status === 'loaded');
}

// Who gets an answer: an Administrator of the workspace only; nobody without a token or with a
// token of another workspace; nothing on the platform host or on-premise.
async function testAccess() {
  const svc = buildServices();
  const served = await serve(svc);
  let t: ActivatedTenant | undefined;
  let other: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'sdr-acc', orgName: 'Access Org' });
    other = await createActivatedTenant(svc, { tag: 'sdr-acc2', orgName: 'Other Org' });
    const memberId = await addRealUser(svc, t.tenantId);
    const [member] = await inTenant(t.tenantId, (m) => m.query(`SELECT email FROM users WHERE id = $1`, [memberId]));
    const asMember = client(served, t, tokenFor({ id: memberId, email: member.email, tenant_id: t.tenantId }));
    for (const [label, run] of [['GET', asMember.get], ['load', asMember.load], ['reset', () => asMember.reset({ confirm_name: 'Access Org' })], ['dismiss', asMember.dismiss]] as const) {
      const res = await run();
      assert.equal(res.status, 403, `${label} as a member: ${JSON.stringify(res.body)}`);
      assert.equal(res.body?.code, 'administrator_required', label);
    }
    assert.equal(served.children.length, 0, 'no loader started');
    assert.equal((await demoOf(t.tenantId)).status, 'idle');
    // Who asks is checked first: a member learns nothing of the workspace's state.
    await dataSource.query(`UPDATE tenants SET status = 'frozen' WHERE id = $1`, [t.tenantId]);
    try {
      const res = await asMember.load();
      assert.equal(res.body?.code, 'administrator_required', `member load on a frozen tenant: ${JSON.stringify(res.body)}`);
    } finally {
      await dataSource.query(`UPDATE tenants SET status = 'active' WHERE id = $1`, [t.tenantId]);
    }

    // Administering users is not enough, and a disabled Administrator is refused too.
    const people = await inTenant(t.tenantId, async (m) => {
      const [role] = await m.query(`INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Sample spec user admins') RETURNING id`, [t!.tenantId]);
      await m.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, 'users', 'admin')`, [t!.tenantId, role.id]);
      const userAdmin = await svc.users.createUser({ email: `useradmin-${randomUUID().slice(0, 8)}@reset-spec.test`, role_name: 'Sample spec user admins', tenant_id: t!.tenantId }, { manager: m });
      const disabled = await svc.users.createUser({ email: `disabled-${randomUUID().slice(0, 8)}@reset-spec.test`, role_name: 'Administrator', tenant_id: t!.tenantId }, { manager: m });
      await m.query(`UPDATE users SET status = 'disabled' WHERE id = $1`, [disabled.id]);
      return { userAdmin, disabled };
    });
    for (const [label, person] of [['users:admin', people.userAdmin], ['disabled Administrator', people.disabled]] as const) {
      const as = client(served, t, tokenFor({ id: person.id, email: person.email, tenant_id: t.tenantId }));
      for (const [route, run] of [['GET', as.get], ['load', as.load], ['reset', () => as.reset({ confirm_name: 'Access Org' })], ['dismiss', as.dismiss]] as const) {
        const res = await run();
        assert.equal(res.status, 403, `${route} as ${label}: ${JSON.stringify(res.body)}`);
        assert.equal(res.body?.code, 'administrator_required', `${route} as ${label}`);
      }
    }
    assert.equal(served.children.length, 0);

    const anonymous = await call(served, { method: 'GET', path: '/admin/sample-data', host: hostOf(t) });
    assert.equal(anonymous.status, 401);
    const foreign = await call(served, { method: 'GET', path: '/admin/sample-data', host: hostOf(t), token: ownerToken(other) });
    assert.equal(foreign.status, 401, 'a token of another workspace');

    // The platform host: its own tenant's token, still nothing.
    const [platform] = await dataSource.query(`SELECT id FROM tenants WHERE slug = 'platform-admin'`);
    assert.ok(platform, 'the platform tenant exists in the spec database');
    const platformToken = tokenFor({ id: randomUUID(), email: 'admin@platform.test', tenant_id: platform.id });
    for (const path of ['/admin/sample-data', '/admin/sample-data/load']) {
      const res = await call(served, { method: path.endsWith('load') ? 'POST' : 'GET', path, host: PLATFORM_HOST, token: platformToken });
      assert.equal(res.status, 404, `platform host ${path}: ${JSON.stringify(res.body)}`);
    }

    // A system tenant on its own address: nothing either.
    await dataSource.query(`UPDATE tenants SET is_system_tenant = true WHERE id = $1`, [other.tenantId]);
    try {
      const res = await client(served, other).get();
      assert.equal(res.status, 404, `system tenant: ${JSON.stringify(res.body)}`);
    } finally {
      await dataSource.query(`UPDATE tenants SET is_system_tenant = false WHERE id = $1`, [other.tenantId]);
    }

    // On-premise: no route at all.
    const saved = Features.SINGLE_TENANT;
    (Features as any).SINGLE_TENANT = true;
    try {
      const owner = client(served, t);
      assert.equal((await owner.get()).status, 404, 'single-tenant GET');
      assert.equal((await owner.load()).status, 404, 'single-tenant load');
    } finally {
      (Features as any).SINGLE_TENANT = saved;
    }
    assert.equal(served.children.length, 0);

    // A workspace that holds data: no load offered, and why.
    await inTenant(t.tenantId, (m) => m.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Real supplier')`, [t!.tenantId]));
    const full = await client(served, t).get();
    assert.equal(full.body.can_load, false);
    assert.equal(full.body.load_refusal, 'tenant_not_empty');
  } finally {
    await served.close();
    await cleanupTenants([t?.tenantId, other?.tenantId]);
  }
}

// GET as an administrator, then the load: 202 `loading` with the request's Host passed on to the
// loader; while it runs nothing more can be loaded; once loaded, the objects created since.
async function testOverviewAndLoad() {
  const svc = buildServices();
  const served = await serve(svc);
  let t: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'sdr-load', orgName: '  Load Org ' });
    await inTenant(t.tenantId, (m) => m.query(`UPDATE users SET first_name = 'Ada', last_name = 'Admin' WHERE id = $1`, [t!.ownerId]));
    const owner = client(served, t);

    const first = await owner.get();
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.status, 'idle');
    assert.equal(first.body.can_load, true);
    assert.equal(first.body.load_refusal, null);
    assert.equal(first.body.created_since_load, null);
    assert.equal(first.body.workspace_name, 'Load Org', 'the name to type, trimmed');
    assert.equal(first.body.loaded_by_name, null);
    assert.ok(!('run_id' in first.body));

    const started = await owner.load();
    assert.equal(started.status, 202, JSON.stringify(started.body));
    assert.equal(started.body.status, 'loading');
    assert.equal(served.children.length, 1);
    assert.equal(served.children[0].env.KANAP_DEMO_HOST, hostOf(t), 'the Host header of the request');

    const during = await owner.get();
    assert.equal(during.body.status, 'loading');
    assert.equal(during.body.can_load, false);
    assert.equal(during.body.loaded_by_name, 'Ada Admin');
    const again = await owner.load();
    assert.equal(again.status, 409);
    assert.equal(again.body.code, 'demo_status_conflict');

    served.children[0].child.finish(0);
    await waitFor('loaded', () => demoOf(t!.tenantId), (state) => state.status === 'loaded');
    const loaded = await owner.get();
    assert.equal(loaded.body.status, 'loaded');
    assert.equal(loaded.body.can_load, false);
    assert.equal(loaded.body.created_since_load, 0);

    // Created after the load: a company and a document of the templates library count (the reset
    // erases them); users do not (the reset keeps the real ones, the sample data ones are its own).
    await new Promise((resolve) => setTimeout(resolve, 20));
    await inTenant(t.tenantId, async (m) => {
      await m.query(`INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Created After', 'FR', 'Paris')`, [t!.tenantId]);
      let [library] = await m.query(`SELECT id FROM document_libraries WHERE tenant_id = $1 AND slug = 'templates'`, [t!.tenantId]);
      if (!library) {
        [library] = await m.query(`INSERT INTO document_libraries (tenant_id, name, slug) VALUES ($1, 'Templates', 'templates') RETURNING id`, [t!.tenantId]);
      }
      await m.query(
        `INSERT INTO documents (tenant_id, item_number, title, library_id)
         VALUES ($1, (SELECT COALESCE(max(item_number), 0) + 1 FROM documents WHERE tenant_id = $1), 'Template after load', $2)`,
        [t!.tenantId, library.id],
      );
      await svc.users.createUser({
        email: `demo-${randomUUID().slice(0, 8)}@fromage-co.example`,
        role_name: 'Portfolio Member',
        tenant_id: t!.tenantId,
      }, { manager: m });
    });
    await addRealUser(svc, t.tenantId);
    assert.equal((await owner.get()).body.created_since_load, 2);

    // The banner's light answer: no count, no name.
    const light = await owner.banner();
    assert.equal(light.status, 200);
    assert.equal(light.body.status, 'loaded');
    assert.equal(light.body.created_since_load, null);
    assert.equal(light.body.loaded_by_name, null);
    assert.ok(light.body.ever_loaded_at, 'a full load is recorded');
  } finally {
    await served.close();
    await cleanupTenants([t?.tenantId]);
  }
}

// The reset: the typed name must match (spaces and case ignored), the answer comes before the
// reset has run, the administrators are e-mailed once it has committed; a failed reset e-mails
// nobody and leaves the state as it was.
async function testReset() {
  const svc = buildServices();
  const served = await serve(svc, { holdResetMs: 400 });
  let t: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'sdr-reset', orgName: 'Fromage Spec' });
    await loadThroughRoute(served, t);
    const owner = client(served, t);
    assert.equal((await owner.get()).body.loaded_by_name, t.ownerEmail, 'no name: the email address');

    for (const body of [{ confirm_name: 'Fromage' }, { confirm_name: '' }, {}, { confirm_name: ['Fromage Spec'] }, undefined]) {
      const res = await owner.reset(body);
      assert.equal(res.status, 400, `${JSON.stringify(body)}: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.code, 'confirmation_mismatch');
    }
    assert.equal((await demoOf(t.tenantId)).status, 'loaded', 'a mismatch changes nothing');

    const started = await owner.reset({ confirm_name: '  fROMAGE   spec ' });
    assert.equal(started.status, 202, JSON.stringify(started.body));
    assert.equal(started.body.status, 'resetting');
    assert.equal((await demoOf(t.tenantId)).status, 'resetting', 'answered before the reset has run');
    assert.equal(served.emails.length, 0, 'no e-mail before the reset has committed');
    const blocked = await owner.dismiss();
    assert.equal(blocked.status, 409, 'writes wait for the reset');
    assert.equal(blocked.body.code, 'tenant_resetting');

    await waitFor('idle', () => demoOf(t!.tenantId), (state) => state.status === 'idle');
    await waitForBackgroundWork(Date.now() + 10_000);
    assert.deepEqual(served.emails, [{ tenantId: t.tenantId, actorId: t.ownerId }]);
    const after = await owner.get();
    assert.equal(after.body.can_load, true, 'back to its starting state');
    assert.ok(after.body.ever_loaded_at, 'the past load is kept');
    const light = await owner.banner();
    assert.equal(light.body.can_load, false, 'the banner never comes back after a load');

    const again = await owner.reset({ confirm_name: 'Fromage Spec' });
    assert.equal(again.status, 409, 'nothing loaded any more');
    assert.equal(again.body.code, 'demo_status_conflict');
  } finally {
    await served.close();
    await cleanupTenants([t?.tenantId]);
  }

  const failing = await serve(svc, { failReset: true });
  let f: ActivatedTenant | undefined;
  try {
    f = await createActivatedTenant(svc, { tag: 'sdr-rfail', orgName: 'Failing Org' });
    await loadThroughRoute(failing, f);
    const res = await client(failing, f).reset({ confirm_name: 'Failing Org' });
    assert.equal(res.status, 202);
    await waitForBackgroundWork(Date.now() + 10_000);
    assert.equal((await demoOf(f.tenantId)).status, 'loaded', 'the state is back');
    const failed = await client(failing, f).get();
    assert.ok(failed.body.reset_failed_at, 'the page is told the reset failed');
    assert.deepEqual(failing.emails, [], 'no e-mail after a failed reset');
  } finally {
    await failing.close();
    await cleanupTenants([f?.tenantId]);
  }
}

// A frozen subscription: the load is refused, the reset of loaded sample data goes through.
async function testFrozenWorkspace() {
  const svc = buildServices();
  const served = await serve(svc, { stripeConfigured: true });
  let t: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'sdr-frz', orgName: 'Frozen Org' });
    await inTenant(t.tenantId, (m) => m.query(
      `UPDATE subscriptions SET status = 'past_due', current_period_end = now() - interval '90 days' WHERE tenant_id = $1`, [t!.tenantId]));
    const owner = client(served, t);
    // Said in advance: no load offered, and why.
    const frozen = await owner.get();
    assert.equal(frozen.body.can_load, false);
    assert.equal(frozen.body.load_refusal, 'SUBSCRIPTION_FROZEN');
    const load = await owner.load();
    assert.equal(load.status, 403, JSON.stringify(load.body));
    assert.equal(load.body.code, 'SUBSCRIPTION_FROZEN');
    assert.equal(served.children.length, 0);

    await setDemo(t.tenantId, { status: 'loaded', loaded_at: new Date().toISOString(), loaded_by: t.ownerId });
    const reset = await owner.reset({ confirm_name: 'Frozen Org' });
    assert.equal(reset.status, 202, JSON.stringify(reset.body));
    await waitFor('idle', () => demoOf(t!.tenantId), (state) => state.status === 'idle');

    // While the API process stops, no reset starts (it would not be waited for).
    await setDemo(t.tenantId, { status: 'loaded', loaded_at: new Date().toISOString(), loaded_by: t.ownerId });
    served.service.stop();
    const stopping = await owner.reset({ confirm_name: 'Frozen Org' });
    assert.equal(stopping.status, 503, JSON.stringify(stopping.body));
    assert.equal(stopping.body.code, 'demo_data_unavailable');
    assert.equal((await demoOf(t.tenantId)).status, 'loaded');
  } finally {
    await served.close();
    await cleanupTenants([t?.tenantId]);
  }
}

// `dismiss` writes `metadata.demo.dismissed_at` and nothing else. The actions (load, reset,
// dismiss) are limited per user and per route: the 11th in ten minutes gets 429, reading is not
// limited, another administrator keeps a budget of their own.
async function testDismissAndRateLimit() {
  const saved = process.env.RATE_LIMIT_ENABLED;
  process.env.RATE_LIMIT_ENABLED = 'true';
  const svc = buildServices();
  const served = await serve(svc);
  let t: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'sdr-dis', orgName: 'Dismiss Org' });
    await dataSource.query(
      `UPDATE tenants SET metadata = metadata || '{"currency": {"reporting": "CHF"}}'::jsonb WHERE id = $1`, [t.tenantId]);
    const [before] = await dataSource.query(`SELECT metadata FROM tenants WHERE id = $1`, [t.tenantId]);
    const owner = client(served, t);

    const dismissed = await owner.dismiss();
    assert.equal(dismissed.status, 200, JSON.stringify(dismissed.body));
    assert.ok(dismissed.body.dismissed_at, 'the date is answered');
    const [after] = await dataSource.query(`SELECT metadata FROM tenants WHERE id = $1`, [t.tenantId]);
    assert.deepEqual(after.metadata.currency, { reporting: 'CHF' }, 'the other settings are untouched');
    assert.deepEqual(Object.keys(after.metadata).sort(), [...new Set([...Object.keys(before.metadata), 'demo'])].sort());
    assert.equal(after.metadata.demo.dismissed_at, dismissed.body.dismissed_at);
    assert.equal(after.metadata.demo.status ?? 'idle', 'idle', 'the status is untouched');
    assert.equal((await owner.get()).body.dismissed_at, dismissed.body.dismissed_at);

    const { limit } = RATE_LIMITS.sampleDataAction;
    assert.equal(limit, 10);
    assert.equal(RATE_LIMITS.sampleDataAction.ttl, 10 * 60_000);
    for (let i = 1; i < limit; i++) assert.equal((await owner.dismiss()).status, 200, `action ${i + 1}`);
    const limited = await owner.dismiss();
    assert.equal(limited.status, 429, 'one more: 429');
    assert.equal((await owner.get()).status, 200, 'reading is not limited');
    // The same on the reset (refused names) and the load (one start, then conflicts).
    for (let i = 0; i < limit; i++) assert.notEqual((await owner.reset({ confirm_name: 'wrong' })).status, 429, `reset ${i + 1}`);
    assert.equal((await owner.reset({ confirm_name: 'wrong' })).status, 429, 'reset: one more, 429');
    for (let i = 0; i < limit; i++) assert.notEqual((await owner.load()).status, 429, `load ${i + 1}`);
    assert.equal((await owner.load()).status, 429, 'load: one more, 429');

    // Another administrator of the workspace keeps a budget of their own.
    const second = await inTenant(t.tenantId, (m) => svc.users.createUser({
      email: `admin2-${randomUUID().slice(0, 8)}@reset-spec.test`,
      role_name: 'Administrator',
      tenant_id: t!.tenantId,
    }, { manager: m }));
    const asSecond = client(served, t, tokenFor({ id: second.id, email: second.email, tenant_id: t.tenantId }));
    assert.equal((await asSecond.dismiss()).status, 200);
  } finally {
    await served.close();
    await cleanupTenants([t?.tenantId]);
    if (saved === undefined) delete process.env.RATE_LIMIT_ENABLED;
    else process.env.RATE_LIMIT_ENABLED = saved;
  }
}

// The objects counted since the load: every table read has `created_at`.
async function testCreatedSinceTables() {
  const rows: Array<{ table_name: string }> = await dataSource.query(
    `SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'created_at' AND table_name = ANY($1::text[])`,
    [[...DEMO_CREATED_SINCE_TABLES, 'documents', 'users']],
  );
  const withCreatedAt = new Set(rows.map((row) => row.table_name));
  const missing = [...DEMO_CREATED_SINCE_TABLES, 'documents', 'users'].filter((table) => !withCreatedAt.has(table));
  assert.deepEqual(missing, [], 'tables without created_at');
}

// The reset e-mail: to the enabled users with the Administrator role (legacy role or multi-role),
// not to a user who only administers users, not to a disabled administrator; who, when, the link.
async function testResetEmailRecipients() {
  const svc = buildServices();
  let t: ActivatedTenant | undefined;
  const savedEmail = Features.EMAIL_ENABLED;
  const savedUrl = process.env.APP_BASE_URL;
  (Features as any).EMAIL_ENABLED = true;
  process.env.APP_BASE_URL = 'https://app.kanap.test';
  try {
    t = await createActivatedTenant(svc, { tag: 'sdr-mail', orgName: 'Mail Org' });
    const ids = await inTenant(t.tenantId, async (m) => {
      await m.query(`UPDATE users SET first_name = 'Ada', last_name = 'Admin', locale = 'fr' WHERE id = $1`, [t!.ownerId]);
      const make = async (label: string, roleName: string, status = 'enabled') => {
        const user = await svc.users.createUser({ email: `${label}-${randomUUID().slice(0, 8)}@reset-spec.test`, role_name: roleName, tenant_id: t!.tenantId }, { manager: m });
        if (status !== 'enabled') await m.query(`UPDATE users SET status = $2 WHERE id = $1`, [user.id, status]);
        return user;
      };
      const [usersAdminRole] = await m.query(
        `INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'User managers spec') RETURNING id`, [t!.tenantId]);
      await m.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, 'users', 'admin')`, [t!.tenantId, usersAdminRole.id]);
      const userManager = await make('usermanager', 'User managers spec');
      const disabledAdmin = await make('disabled', 'Administrator', 'disabled');
      // Administrator through the multi-role table, with a member role as the legacy one.
      const multiRole = await make('multirole', 'Portfolio Member');
      const [adminRole] = await m.query(`SELECT id FROM roles WHERE tenant_id = $1 AND lower(role_name) = 'administrator'`, [t!.tenantId]);
      await m.query(`INSERT INTO user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [t!.tenantId, multiRole.id, adminRole.id]);
      return { userManager, disabledAdmin, multiRole };
    });

    const sent: Array<{ to: string; subject: string; text: string; html: string }> = [];
    const emailService = { send: async (options: any) => { sent.push({ to: options.to, subject: options.subject, text: options.text, html: options.html }); } };
    const notifications = new NotificationsService(dataSource, emailService as any, {} as any, {} as any);
    await notifications.notifyWorkspaceReset({ tenantId: t.tenantId, actorId: t.ownerId, resetAt: new Date('2026-10-07T14:03:00Z') });
    await waitForBackgroundWork(Date.now() + 10_000);

    assert.deepEqual(sent.map((mail) => mail.to).sort(), [t.ownerEmail, ids.multiRole.email].sort(), 'the enabled Administrators only');
    const french = sent.find((mail) => mail.to === t!.ownerEmail)!;
    const english = sent.find((mail) => mail.to === ids.multiRole.email)!;
    assert.equal(french.subject, 'Votre espace de travail KANAP a été réinitialisé', 'in the reader’s language');
    assert.equal(english.subject, 'Your KANAP workspace was reset');
    assert.match(english.text, /Ada Admin erased all the content of the workspace Mail Org on 7 October 2026 at 14:03 UTC/);
    assert.match(english.text, new RegExp(`https://${t.slug}\\.kanap\\.test`), 'the link to the workspace');
    assert.match(french.text, /Ada Admin a effacé tout le contenu de l'espace de travail Mail Org le 7 octobre 2026/);
  } finally {
    (Features as any).EMAIL_ENABLED = savedEmail;
    if (savedUrl === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = savedUrl;
    await cleanupTenants([t?.tenantId]);
  }
}

runSpecs('demo-data.routes.integration.spec', [
  testAccess,
  testOverviewAndLoad,
  testReset,
  testFrozenWorkspace,
  testDismissAndRateLimit,
  testCreatedSinceTables,
  testResetEmailRecipients,
]).catch((error) => {
  console.error(error);
  process.exit(1);
});
