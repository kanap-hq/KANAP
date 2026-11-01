import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import { DataSource } from 'typeorm';
import dataSource from '../../data-source';
import {
  ActivatedTenant,
  addAiSettings,
  addRealUser,
  buildServices,
  cleanupTenants,
  createActivatedTenant,
  inTenant,
  loadDemoSet,
  runSpecs,
  Services,
} from '../../admin/tenants/__tests__/tenant-reset-test-helpers';
import { buildAccessTokenPayload } from '../../auth/auth.service';
import { accessTokenVerifyKey } from '../../auth/jwt-key';
import { waitForBackgroundWork } from '../../common/background-work';
import { ListContextsService } from '../../common/list-context/list-contexts.service';
import { useRequestPipeline } from '../../common/request-pipeline';
import { createRequestTenancyMiddleware } from '../../common/tenancy/request-tenancy.middleware';
import { Features } from '../../config/features';
import { DemoDataService, readDemoState } from '../../demo-data/demo-data.service';
import { OnboardingController } from '../onboarding.controller';
import { ONBOARDING_PATHS } from '../onboarding-paths';
import { OnboardingService } from '../onboarding.service';
import { buildDemoData, DemoDataDouble, FakeChild } from './onboarding-test-helpers';

// The effect of the onboarding mode on the sample data (`PUT /onboarding/choice`), over HTTP: the
// real controller, tenancy middleware and request pipeline, the real OnboardingService,
// DemoDataService and tenant reset on the spec database; the loader process and the reset
// e-mail are doubles. On a trial tenant activated from a sign-up:
// - `own_data` on loaded sample data resets the workspace (no e-mail) and keeps the workspace
//   name, the starting company of the sign-up, the AI settings, the administrator and their
//   name, the language and the onboarding rows; the answer already says `reset_in_progress`;
// - `own_data` during the load stops the loader, then resets, and ends `idle` (no error code):
//   the stop is seen at once by the API process that runs the loader, at its next heartbeat
//   when another process asked, and when the loader ends before seeing it; a load whose API
//   process stopped with a stop asked for ends `idle` as well;
// - a non-administrator never empties the workspace (403, nothing written), and their choice on
//   an idle workspace leaves the banner and the load at activation alone;
// - `own_data` on loaded sample data with objects created since the load answers 409
//   `sample_data_modified` (their number, nothing changed) unless `confirm_reset: true`;
// - `own_data` on a failed load already reset goes back to `idle` with no reset; after a failed
//   reset it resets; on a load whose API process stopped it ends `idle`;
// - `example` loads into an idle or failed workspace for an administrator only, and a refused
//   load still writes the choice; `own_data` on an idle workspace resets nothing; on-premise
//   neither acts; `example` then `own_data` resets;
// - a load at activation still waiting for a free slot gives up once `own_data` is chosen, also
//   when it read the state before the choice (the claim checks the banner).
// @database-spec: opens the data-source and boots Nest, so run-ci-tests.js runs it on a database lane.

type Served = { app: INestApplication; port: number; demo: DemoDataDouble; close: () => Promise<void> };

async function serve(svc: Services): Promise<Served> {
  const demo = buildDemoData(svc);
  @Module({
    controllers: [OnboardingController],
    providers: [
      ListContextsService,
      OnboardingService,
      { provide: DataSource, useValue: dataSource },
      { provide: DemoDataService, useValue: demo.service },
    ],
  })
  class OnboardingOwnDataProbeModule {}

  const app = await NestFactory.create(OnboardingOwnDataProbeModule, { logger: false });
  app.use(createRequestTenancyMiddleware({
    query: (sql, params) => dataSource.query(sql, params),
    singleTenant: false,
    defaultTenantSlug: 'default',
    platformAdminHost: 'platform.onboarding-own-data-spec.test',
    marketingRedirectUrl: 'https://www.kanap.test',
  }));
  useRequestPipeline(app, dataSource);
  await app.listen(0, '127.0.0.1');
  const port = (app.getHttpServer().address() as AddressInfo).port;
  const close = async () => {
    for (const { child } of demo.children) child.finish(0);
    assert.equal(await waitForBackgroundWork(Date.now() + 60_000), 0, 'the background work ended');
    await app.close();
  };
  return { app, port, demo, close };
}

function call(served: Served, opts: { method: 'GET' | 'PUT'; path: string; host: string; token: string; body?: unknown }) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const payload = opts.body === undefined ? undefined : Buffer.from(JSON.stringify(opts.body));
    const req = http.request({
      host: '127.0.0.1',
      port: served.port,
      method: opts.method,
      path: opts.path,
      headers: {
        Host: opts.host,
        Authorization: `Bearer ${opts.token}`,
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

async function memberToken(svc: Services, t: ActivatedTenant): Promise<string> {
  const id = await addRealUser(svc, t.tenantId);
  const [row] = await inTenant(t.tenantId, (m) => m.query(`SELECT email FROM users WHERE tenant_id = $1 AND id = $2`, [t.tenantId, id]));
  return tokenFor({ id, email: row.email, tenant_id: t.tenantId });
}

function client(served: Served, t: ActivatedTenant, token = ownerToken(t)) {
  const host = hostOf(t);
  return {
    get: () => call(served, { method: 'GET', path: '/onboarding', host, token }),
    choose: (body: unknown) => call(served, { method: 'PUT', path: '/onboarding/choice', host, token, body }),
  };
}

function ok(res: { status: number; body: any }, label: string) {
  assert.equal(res.status, 200, `${label}: ${JSON.stringify(res.body)}`);
  return res.body;
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

/** A stop of the load written as another API process's `cancelLoad` writes it. */
async function askStopFromElsewhere(tenantId: string, by: string) {
  await dataSource.query(
    `UPDATE tenants SET metadata = jsonb_set(metadata, '{demo}',
        metadata->'demo' || jsonb_build_object('cancel_requested_at', $2::text, 'cancel_requested_by', $3::text))
      WHERE id = $1`,
    [tenantId, new Date().toISOString(), by],
  );
}

async function waitFor<T>(label: string, read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 30_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > until) assert.fail(`${label}: still ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const waitIdle = (t: ActivatedTenant) => waitFor('idle', () => demoOf(t.tenantId), (state) => state.status === 'idle');

async function exampleUsers(tenantId: string): Promise<number> {
  const [row] = await inTenant(tenantId, (m) => m.query(
    `SELECT count(*)::int AS n FROM users WHERE tenant_id = $1 AND lower(email) LIKE '%.example'`, [tenantId]));
  return row.n;
}

async function companies(tenantId: string): Promise<Array<{ name: string; country_iso: string }>> {
  return inTenant(tenantId, (m) => m.query(
    `SELECT name, country_iso FROM companies WHERE tenant_id = $1 ORDER BY name`, [tenantId]));
}

async function modeEvents(tenantId: string): Promise<any[]> {
  return inTenant(tenantId, (m) => m.query(
    `SELECT after_json AS after FROM audit_log
      WHERE tenant_id = $1 AND table_name = 'onboarding' AND action = 'onboarding.mode_chosen'`,
    [tenantId],
  ));
}

async function choiceRow(tenantId: string) {
  const [row] = await inTenant(tenantId, (m) => m.query(
    `SELECT angle, mode FROM tenant_onboarding WHERE tenant_id = $1`, [tenantId]));
  return row ?? null;
}

/** The loader writes the sample data set in SQL; `finish` ends it with success once written. */
function loaderWriting(served: Served, t: ActivatedTenant, opts: { finish: boolean }): { written: Promise<void> } {
  let resolveWritten!: () => void;
  const written = new Promise<void>((resolve) => { resolveWritten = resolve; });
  served.demo.onSpawn = (child: FakeChild) => {
    void (async () => {
      await loadDemoSet(t.tenantId);
      resolveWritten();
      if (opts.finish) child.finish(0);
    })();
  };
  return { written };
}

/** The load at trial activation (`provisionTrialSampleData` calls `loadDemoData` so). */
async function loadAsAtActivation(served: Served, t: ActivatedTenant) {
  await served.demo.service.loadDemoData(t.tenantId, { language: 'fr', actorId: t.ownerId, host: hostOf(t) });
}

// 1. Sample data loaded: `own_data` by the administrator resets the workspace, keeps what a
//    reset keeps, sends no e-mail, and the answer already says the reset runs.
async function testOwnDataAfterLoad() {
  const svc = buildServices();
  const served = await serve(svc);
  let t: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'onb-own', orgName: 'Own Data Org', signup: true, countryIso: 'BE', language: 'fr' });
    await inTenant(t.tenantId, (m) => m.query(`UPDATE users SET first_name = 'Ada', last_name = 'Admin' WHERE id = $1`, [t!.ownerId]));
    await addAiSettings(t.tenantId, t.ownerId);
    const doneStep = ONBOARDING_PATHS.budget.own_data[0];
    await inTenant(t.tenantId, (m) => m.query(
      `INSERT INTO onboarding_steps (tenant_id, user_id, angle, mode, step_key) VALUES ($1, $2, 'budget', 'own_data', $3)`,
      [t!.tenantId, t!.ownerId, doneStep],
    ));

    const { written } = loaderWriting(served, t, { finish: true });
    await loadAsAtActivation(served, t);
    await written;
    await waitFor('loaded', () => demoOf(t!.tenantId), (state) => state.status === 'loaded');
    assert.equal(await exampleUsers(t.tenantId), 3, 'sample data users loaded');
    assert.ok((await companies(t.tenantId)).some((c) => c.name === 'Fromage Paris'), 'a sample company loaded');

    const answer = ok(await client(served, t).choose({ angle: 'budget', mode: 'own_data' }), 'own_data by the administrator');
    assert.equal(answer.mode, 'own_data');
    assert.equal(answer.angle, 'budget');
    assert.equal(answer.reset_in_progress, true, 'the answer says the reset runs');

    const after = await waitIdle(t);
    assert.equal(await waitForBackgroundWork(Date.now() + 30_000), 0);
    assert.equal(after.error_code, null);
    assert.ok(after.dismissed_at, 'the sample data banner is hidden');
    assert.equal(await exampleUsers(t.tenantId), 0, 'sample data users gone');
    assert.deepEqual(await companies(t.tenantId), [{ name: t.companyName, country_iso: 'BE' }], 'the starting company of the sign-up, only');

    const [tenant] = await dataSource.query(`SELECT name, metadata->>'language' AS language FROM tenants WHERE id = $1`, [t.tenantId]);
    assert.equal(tenant.name, 'Own Data Org', 'the workspace name kept');
    assert.equal(tenant.language, 'fr', 'the language kept');
    const ai = await inTenant(t.tenantId, (m) => m.query(`SELECT chat_enabled FROM ai_settings WHERE tenant_id = $1`, [t!.tenantId]));
    assert.deepEqual(ai, [{ chat_enabled: true }], 'the AI settings kept');
    const [owner] = await inTenant(t.tenantId, (m) => m.query(
      `SELECT first_name, last_name, status FROM users WHERE tenant_id = $1 AND id = $2`, [t!.tenantId, t!.ownerId]));
    assert.deepEqual(owner, { first_name: 'Ada', last_name: 'Admin', status: 'enabled' }, 'the administrator and their name kept');
    assert.deepEqual(await choiceRow(t.tenantId), { angle: 'budget', mode: 'own_data' }, 'the choice kept');
    const steps = await inTenant(t.tenantId, (m) => m.query(
      `SELECT step_key FROM onboarding_steps WHERE tenant_id = $1 AND user_id = $2`, [t!.tenantId, t!.ownerId]));
    assert.deepEqual(steps, [{ step_key: doneStep }], 'the steps already done kept');
    assert.deepEqual((await modeEvents(t.tenantId)).map((e) => e.after), [{ mode: 'own_data', previous: null }]);
    assert.deepEqual(served.demo.emails, [], 'no reset e-mail');

    const state = ok(await client(served, t).get(), 'GET after the reset');
    assert.equal(state.reset_in_progress, false);
    assert.deepEqual(state.sample_data, { status: 'idle', step: null, error_code: null });
  } finally {
    await served.close();
    await cleanupTenants([t?.tenantId]);
  }
}

// 2. `own_data` while the sample data loads: the loader is killed, the workspace reset, and the
//    status ends `idle`, not `failed`.
async function testOwnDataDuringLoad() {
  const svc = buildServices();
  const served = await serve(svc);
  let t: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'onb-stop', orgName: 'Stop Org', signup: true });
    const { written } = loaderWriting(served, t, { finish: false });
    await loadAsAtActivation(served, t);
    await written;
    assert.equal((await demoOf(t.tenantId)).status, 'loading');
    const child = served.demo.children[0].child;

    const answer = ok(await client(served, t).choose({ angle: 'cartography', mode: 'own_data' }), 'own_data during the load');
    assert.equal(answer.reset_in_progress, true, 'the answer says the workspace is being emptied');
    assert.equal(child.killedWith, 'SIGKILL', 'the loader is killed');

    const after = await waitIdle(t);
    assert.equal(await waitForBackgroundWork(Date.now() + 30_000), 0);
    assert.equal(after.error_code, null, 'no error code');
    assert.equal(after.failed_at, null);
    assert.equal(after.ever_loaded_at, null, 'never counted as loaded');
    assert.ok(after.dismissed_at, 'the banner is hidden');
    assert.equal(await exampleUsers(t.tenantId), 0, 'what the loader wrote is gone');
    assert.deepEqual(await companies(t.tenantId), [{ name: t.companyName, country_iso: 'FR' }]);
    assert.deepEqual(await choiceRow(t.tenantId), { angle: 'cartography', mode: 'own_data' });
    assert.deepEqual(served.demo.emails, [], 'no e-mail');
    assert.equal(served.demo.children.length, 1, 'no other loader');
  } finally {
    await served.close();
    await cleanupTenants([t?.tenantId]);
  }
}

// 2b. The stop asked for from another API process: this process's heartbeat sees it and kills
//     the loader. Meanwhile the onboarding says the workspace is being emptied.
async function testStopSeenByHeartbeat() {
  const svc = buildServices();
  const served = await serve(svc);
  let t: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'onb-beat', orgName: 'Beat Org', signup: true });
    served.demo.service.config.heartbeatMs = 400;
    await loadAsAtActivation(served, t);
    const child = served.demo.children[0].child;
    await askStopFromElsewhere(t.tenantId, t.ownerId);
    const state = ok(await client(served, t).get(), 'GET while the stop is pending');
    assert.deepEqual(state.sample_data, { status: 'loading', step: null, error_code: null });
    assert.equal(state.reset_in_progress, true, 'a load with a stop asked for counts as emptying');

    await waitFor('loader killed', async () => child.killedWith, (signal) => signal === 'SIGKILL');
    const after = await waitIdle(t);
    assert.equal(await waitForBackgroundWork(Date.now() + 30_000), 0);
    assert.equal(after.error_code, null);
    assert.equal(after.cancel_requested_at, null, 'the request is cleared');
    assert.deepEqual(served.demo.emails, []);
  } finally {
    await served.close();
    await cleanupTenants([t?.tenantId]);
  }
}

// 2c. The loader ends with success after the stop was asked for, before any heartbeat saw it:
//     the load is not marked loaded, the workspace is reset, `idle`.
async function testLoaderEndsAfterStop() {
  const svc = buildServices();
  const served = await serve(svc);
  let t: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'onb-late', orgName: 'Late Org', signup: true });
    const { written } = loaderWriting(served, t, { finish: false });
    await loadAsAtActivation(served, t);
    await written;
    await askStopFromElsewhere(t.tenantId, t.ownerId);
    served.demo.children[0].child.finish(0);
    const after = await waitIdle(t);
    assert.equal(await waitForBackgroundWork(Date.now() + 30_000), 0);
    assert.equal(after.error_code, null);
    assert.equal(after.loaded_at, null);
    assert.equal(after.ever_loaded_at, null, 'not marked loaded');
    assert.equal(await exampleUsers(t.tenantId), 0, 'what the loader wrote is gone');
    assert.deepEqual(served.demo.emails, []);
  } finally {
    await served.close();
    await cleanupTenants([t?.tenantId]);
  }
}

// 2d. A load left by a stopped API process with a stop asked for: taken over, reset, `idle`.
async function testAbandonedStoppedLoad() {
  const svc = buildServices();
  const served = await serve(svc);
  let t: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'onb-gone', orgName: 'Gone Org', signup: true });
    await loadDemoSet(t.tenantId);
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    await setDemo(t.tenantId, {
      status: 'loading', run_id: 'gone-run', started_at: old, heartbeat_at: old, loaded_by: t.ownerId,
      cancel_requested_at: old, cancel_requested_by: t.ownerId,
    });
    const taken = await served.demo.service.getStatus(t.tenantId);
    assert.equal(taken.status, 'resetting', 'taken over');
    const after = await waitIdle(t);
    assert.equal(await waitForBackgroundWork(Date.now() + 30_000), 0);
    assert.equal(after.error_code, null, 'not load_interrupted');
    assert.equal(after.failed_at, null);
    assert.equal(await exampleUsers(t.tenantId), 0);
    assert.deepEqual(served.demo.emails, [], 'no e-mail');
  } finally {
    await served.close();
    await cleanupTenants([t?.tenantId]);
  }
}

// 3. A non-administrator never empties the workspace, even with its first choice: 403, nothing
//    written, the sample data as it was.
async function testMemberCannotEmpty() {
  const svc = buildServices();
  const served = await serve(svc);
  let t: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'onb-mbr', orgName: 'Member Org', signup: true });
    await loadDemoSet(t.tenantId);
    const now = new Date().toISOString();
    await setDemo(t.tenantId, { status: 'loaded', loaded_at: now, ever_loaded_at: now, loaded_by: t.ownerId });
    const asMember = client(served, t, await memberToken(svc, t));

    const res = await asMember.choose({ angle: 'budget', mode: 'own_data' });
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.equal(res.body?.code, 'administrator_required');
    assert.equal(await choiceRow(t.tenantId), null, 'no choice written');
    assert.deepEqual(await modeEvents(t.tenantId), [], 'no event');
    const state = await demoOf(t.tenantId);
    assert.equal(state.status, 'loaded');
    assert.equal(state.dismissed_at, null, 'the banner left as it was');
    assert.equal(await exampleUsers(t.tenantId), 3, 'the sample data intact');

    // During a load as well: no stop asked for.
    await setDemo(t.tenantId, { status: 'loading', run_id: 'elsewhere', started_at: now, heartbeat_at: now, loaded_by: t.ownerId });
    const during = await asMember.choose({ angle: 'budget', mode: 'own_data' });
    assert.equal(during.status, 403, JSON.stringify(during.body));
    assert.equal((await demoOf(t.tenantId)).cancel_requested_at, null, 'no stop asked for');
    assert.equal(await choiceRow(t.tenantId), null);
    assert.equal(await exampleUsers(t.tenantId), 3);
    assert.deepEqual(served.demo.emails, []);
  } finally {
    await served.close();
    await cleanupTenants([t?.tenantId]);
  }
}

// 4. `example` on an idle workspace: an administrator's choice starts the load (the request's
//    host passed on); a member's choice is written and loads nothing; a refused load (workspace
//    not empty) still writes the choice.
async function testExample() {
  const svc = buildServices();
  const served = await serve(svc);
  const ids: Array<string | undefined> = [];
  try {
    const t = await createActivatedTenant(svc, { tag: 'onb-ex', orgName: 'Example Org', signup: true, language: 'fr' });
    ids.push(t.tenantId);
    const answer = ok(await client(served, t).choose({ angle: 'portfolio', mode: 'example' }), 'example by the administrator');
    assert.equal(answer.mode, 'example');
    assert.equal(answer.reset_in_progress, false);
    assert.equal(answer.sample_data.status, 'loading', 'the answer shows the load');
    assert.equal(served.demo.children.length, 1, 'one loader started');
    assert.equal(served.demo.children[0].env.KANAP_DEMO_HOST, hostOf(t), 'the request host passed on');
    const loading = await demoOf(t.tenantId);
    assert.equal(loading.status, 'loading');
    assert.equal(loading.loaded_by, t.ownerId);
    assert.equal(loading.language, 'en', 'the tenant language, resolved to a sample data language');

    const m = await createActivatedTenant(svc, { tag: 'onb-ex2', orgName: 'Example Member Org', signup: true });
    ids.push(m.tenantId);
    const byMember = ok(await client(served, m, await memberToken(svc, m)).choose({ angle: 'budget', mode: 'example' }), 'example by a member');
    assert.equal(byMember.mode, 'example');
    assert.equal(served.demo.children.length, 1, 'no loader for a member');
    assert.equal((await demoOf(m.tenantId)).status, 'idle');
    assert.deepEqual(await choiceRow(m.tenantId), { angle: 'budget', mode: 'example' });

    const full = await createActivatedTenant(svc, { tag: 'onb-ex3', orgName: 'Example Full Org', signup: true });
    ids.push(full.tenantId);
    await inTenant(full.tenantId, (q) => q.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Real supplier')`, [full.tenantId]));
    const refusedLoad = ok(await client(served, full).choose({ angle: 'budget', mode: 'example' }), 'example on a workspace with data');
    assert.equal(refusedLoad.mode, 'example', 'the choice is written');
    assert.deepEqual(refusedLoad.sample_data, { status: 'idle', step: null, error_code: null }, 'the state says nothing loads');
    assert.equal(served.demo.children.length, 1, 'no loader');
    assert.deepEqual(await modeEvents(full.tenantId), [{ after: { mode: 'example', previous: null } }]);
  } finally {
    await served.close();
    await cleanupTenants(ids);
  }
}

// 5. `own_data` on an idle workspace resets nothing and hides the banner; on-premise the mode
//    has no effect on sample data, the choice is written.
async function testOwnDataIdleAndOnPremise() {
  const svc = buildServices();
  const served = await serve(svc);
  const ids: Array<string | undefined> = [];
  try {
    const t = await createActivatedTenant(svc, { tag: 'onb-idle', orgName: 'Idle Org', signup: true });
    ids.push(t.tenantId);
    await inTenant(t.tenantId, (q) => q.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Kept supplier')`, [t.tenantId]));
    const answer = ok(await client(served, t).choose({ angle: 'budget', mode: 'own_data' }), 'own_data on an idle workspace');
    assert.equal(answer.mode, 'own_data');
    assert.equal(answer.reset_in_progress, false);
    assert.equal(await waitForBackgroundWork(Date.now() + 30_000), 0);
    const state = await demoOf(t.tenantId);
    assert.equal(state.status, 'idle');
    assert.ok(state.dismissed_at, 'the banner is hidden');
    const suppliers = await inTenant(t.tenantId, (q) => q.query(`SELECT name FROM suppliers WHERE tenant_id = $1`, [t.tenantId]));
    assert.deepEqual(suppliers, [{ name: 'Kept supplier' }], 'nothing reset');
    assert.deepEqual(await choiceRow(t.tenantId), { angle: 'budget', mode: 'own_data' });

    const onPremise = await createActivatedTenant(svc, { tag: 'onb-onprem', orgName: 'On Premise Org', signup: true });
    ids.push(onPremise.tenantId);
    await loadDemoSet(onPremise.tenantId);
    const now = new Date().toISOString();
    await setDemo(onPremise.tenantId, { status: 'loaded', loaded_at: now, ever_loaded_at: now, loaded_by: onPremise.ownerId });
    const saved = Features.SINGLE_TENANT;
    (Features as any).SINGLE_TENANT = true;
    try {
      const chosen = ok(await client(served, onPremise).choose({ angle: 'budget', mode: 'own_data' }), 'own_data on-premise');
      assert.equal(chosen.mode, 'own_data', 'the choice is written');
      const example = ok(await client(served, onPremise).choose({ mode: 'example' }), 'example on-premise');
      assert.equal(example.mode, 'example');
    } finally {
      (Features as any).SINGLE_TENANT = saved;
    }
    assert.equal((await demoOf(onPremise.tenantId)).status, 'loaded', 'no reset on-premise');
    assert.equal(await exampleUsers(onPremise.tenantId), 3);
    assert.equal(served.demo.children.length, 0, 'no loader on-premise');
    assert.deepEqual(served.demo.emails, []);
  } finally {
    await served.close();
    await cleanupTenants(ids);
  }
}

// 6. The load at activation waits for a free slot (every slot taken), and the administrator
//    chooses `own_data` meanwhile: the next tries stop, nothing is loaded.
async function testProvisioningStopsAfterOwnData() {
  const svc = buildServices();
  const served = await serve(svc);
  let t: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'onb-wait', orgName: 'Waiting Org', signup: true });
    const config = served.demo.service.config;
    config.maxConcurrent = 0;
    config.provisionRetryMs = 100;
    config.provisionRetryMaxMs = 20_000;
    const provisioning = served.demo.service.provisionTrialSampleData({
      tenantId: t.tenantId, actorId: t.ownerId, tenantUrl: `http://${hostOf(t)}`, language: 'en',
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    const answer = ok(await client(served, t).choose({ angle: 'budget', mode: 'own_data' }), 'own_data while the load waits');
    assert.equal(answer.reset_in_progress, false);
    config.maxConcurrent = 2;
    await provisioning;
    assert.equal(served.demo.children.length, 0, 'no loader started');
    const state = await demoOf(t.tenantId);
    assert.equal(state.status, 'idle');
    assert.ok(state.dismissed_at);
  } finally {
    await served.close();
    await cleanupTenants([t?.tenantId]);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function supplierNames(tenantId: string): Promise<string[]> {
  const rows = await inTenant(tenantId, (q) => q.query(`SELECT name FROM suppliers WHERE tenant_id = $1 ORDER BY name`, [tenantId]));
  return rows.map((row: { name: string }) => row.name);
}

/** Sample data loaded (the set written in SQL), `loaded_at` just after it. */
async function loadedSampleData(t: ActivatedTenant) {
  await loadDemoSet(t.tenantId);
  await sleep(20);
  const now = new Date().toISOString();
  await setDemo(t.tenantId, { status: 'loaded', run_id: 'loaded-run', loaded_at: now, ever_loaded_at: now, loaded_by: t.ownerId });
  await sleep(20);
}

// 7. The load at activation read the state before the choice (its own check saw the banner
//    shown), then waits for a slot; `own_data` on the idle workspace; once a slot is free, the
//    claim itself refuses: no load, `idle`.
async function testProvisionRaceWithOwnData() {
  const svc = buildServices();
  const served = await serve(svc);
  let t: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'onb-race', orgName: 'Race Org', signup: true });
    const service = served.demo.service as any;
    const readState = service.readState.bind(service);
    // The provision's own check (one argument) reads the state as it was before the choice.
    service.readState = async (id: string, ...rest: unknown[]) => {
      const state = await readState(id, ...rest);
      return rest.length === 0 ? { ...state, dismissed_at: null } : state;
    };
    const config = served.demo.service.config;
    config.maxConcurrent = 0;
    config.provisionRetryMs = 100;
    config.provisionRetryMaxMs = 20_000;
    const provisioning = served.demo.service.provisionTrialSampleData({
      tenantId: t.tenantId, actorId: t.ownerId, tenantUrl: `http://${hostOf(t)}`, language: 'en',
    });
    await sleep(250);
    const answer = ok(await client(served, t).choose({ angle: 'budget', mode: 'own_data' }), 'own_data while the load waits');
    assert.equal(answer.reset_in_progress, false);
    assert.ok((await demoOf(t.tenantId)).dismissed_at, 'the banner hidden and committed at once');
    config.maxConcurrent = 2;
    await provisioning;
    assert.equal(served.demo.children.length, 0, 'no loader started');
    const state = await demoOf(t.tenantId);
    assert.equal(state.status, 'idle');
    assert.ok(state.dismissed_at);
  } finally {
    await served.close();
    await cleanupTenants([t?.tenantId]);
  }
}

// 8. Objects created since the load: `own_data` answers 409 `sample_data_modified` with their
//    number and changes nothing; `confirm_reset` must be a boolean; with `confirm_reset: true`
//    the workspace is reset.
async function testOwnDataAfterChangesNeedsConfirmation() {
  const svc = buildServices();
  const served = await serve(svc);
  let t: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'onb-conf', orgName: 'Confirm Org', signup: true });
    await loadedSampleData(t);
    await inTenant(t.tenantId, (q) => q.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Tester supplier')`, [t!.tenantId]));

    const refused = await client(served, t).choose({ angle: 'budget', mode: 'own_data' });
    assert.equal(refused.status, 409, JSON.stringify(refused.body));
    assert.equal(refused.body?.code, 'sample_data_modified');
    assert.equal(refused.body?.created_since_load, 1, 'the number of objects created since the load');
    assert.equal(await choiceRow(t.tenantId), null, 'no choice written');
    assert.deepEqual(await modeEvents(t.tenantId), [], 'no event');
    const kept = await demoOf(t.tenantId);
    assert.equal(kept.status, 'loaded');
    assert.equal(kept.dismissed_at, null, 'the banner left as it was');
    assert.ok((await supplierNames(t.tenantId)).includes('Tester supplier'));
    assert.equal(await exampleUsers(t.tenantId), 3);

    const invalid = await client(served, t).choose({ angle: 'budget', mode: 'own_data', confirm_reset: 'yes' });
    assert.equal(invalid.status, 400, JSON.stringify(invalid.body));
    assert.equal(invalid.body?.code, 'invalid_confirm_reset');

    const confirmed = ok(
      await client(served, t).choose({ angle: 'budget', mode: 'own_data', confirm_reset: true }),
      'own_data confirmed',
    );
    assert.equal(confirmed.reset_in_progress, true);
    const after = await waitIdle(t);
    assert.equal(await waitForBackgroundWork(Date.now() + 30_000), 0);
    assert.ok(after.dismissed_at);
    assert.ok(!(await supplierNames(t.tenantId)).includes('Tester supplier'), 'erased once confirmed');
    assert.equal(await exampleUsers(t.tenantId), 0);
    assert.deepEqual(await choiceRow(t.tenantId), { angle: 'budget', mode: 'own_data' });
    assert.deepEqual(served.demo.emails, [], 'no reset e-mail');
  } finally {
    await served.close();
    await cleanupTenants([t?.tenantId]);
  }
}

// 9. A failed load was reset when it failed: `own_data` goes back to `idle` with no reset (an
//    object created after the failure survives). After a failed reset, `own_data` resets.
async function testOwnDataAfterFailedLoad() {
  const svc = buildServices();
  const served = await serve(svc);
  const ids: Array<string | undefined> = [];
  try {
    const t = await createActivatedTenant(svc, { tag: 'onb-fail', orgName: 'Failed Org', signup: true });
    ids.push(t.tenantId);
    const failedAt = new Date().toISOString();
    await setDemo(t.tenantId, {
      status: 'failed', run_id: 'failed-run', started_at: failedAt, failed_at: failedAt, error_code: 'load_failed', loaded_by: t.ownerId,
    });
    await inTenant(t.tenantId, (q) => q.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'After failure')`, [t.tenantId]));
    const answer = ok(await client(served, t).choose({ angle: 'budget', mode: 'own_data' }), 'own_data after a failed load');
    assert.equal(answer.reset_in_progress, false);
    assert.deepEqual(answer.sample_data, { status: 'idle', step: null, error_code: null });
    assert.equal(await waitForBackgroundWork(Date.now() + 30_000), 0);
    const state = await demoOf(t.tenantId);
    assert.equal(state.status, 'idle');
    assert.equal(state.error_code, null);
    assert.equal(state.failed_at, null);
    assert.ok(state.dismissed_at, 'the banner is hidden');
    assert.deepEqual(await supplierNames(t.tenantId), ['After failure'], 'no reset');
    assert.deepEqual(await choiceRow(t.tenantId), { angle: 'budget', mode: 'own_data' });

    const r = await createActivatedTenant(svc, { tag: 'onb-rfail', orgName: 'Reset Failed Org', signup: true });
    ids.push(r.tenantId);
    await loadDemoSet(r.tenantId);
    await setDemo(r.tenantId, {
      status: 'failed', run_id: 'reset-failed-run', failed_at: failedAt, error_code: 'reset_failed', loaded_by: r.ownerId,
    });
    const reset = ok(await client(served, r).choose({ angle: 'budget', mode: 'own_data' }), 'own_data after a failed reset');
    assert.equal(reset.reset_in_progress, true);
    const after = await waitIdle(r);
    assert.equal(await waitForBackgroundWork(Date.now() + 30_000), 0);
    assert.equal(after.error_code, null);
    assert.equal(await exampleUsers(r.tenantId), 0, 'the sample data left by the failed reset is gone');
    assert.deepEqual(served.demo.emails, [], 'no reset e-mail');
  } finally {
    await served.close();
    await cleanupTenants(ids);
  }
}

// 10. A load whose API process stopped (stale heartbeat, no stop asked for): `own_data` writes
//     the stop first, the take-over then ends `idle`, not `failed` / `load_interrupted`.
async function testOwnDataOnAbandonedLoad() {
  const svc = buildServices();
  const served = await serve(svc);
  let t: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'onb-aband', orgName: 'Abandoned Org', signup: true });
    await loadDemoSet(t.tenantId);
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    await setDemo(t.tenantId, { status: 'loading', run_id: 'abandoned-run', started_at: old, heartbeat_at: old, loaded_by: t.ownerId });
    const answer = ok(await client(served, t).choose({ angle: 'budget', mode: 'own_data' }), 'own_data on an abandoned load');
    assert.equal(answer.reset_in_progress, true);
    const after = await waitIdle(t);
    assert.equal(await waitForBackgroundWork(Date.now() + 30_000), 0);
    assert.equal(after.error_code, null, 'not load_interrupted');
    assert.equal(after.failed_at, null);
    assert.ok(after.dismissed_at);
    assert.equal(await exampleUsers(t.tenantId), 0);
    assert.deepEqual(served.demo.emails, []);
  } finally {
    await served.close();
    await cleanupTenants([t?.tenantId]);
  }
}

// 11. `example` then `own_data` by the administrator (the onboarding row exists already, the
//     path of the "About" page): the second choice resets the loaded sample data.
async function testExampleThenOwnData() {
  const svc = buildServices();
  const served = await serve(svc);
  let t: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'onb-swap', orgName: 'Swap Org', signup: true });
    await loadedSampleData(t);
    const example = ok(await client(served, t).choose({ angle: 'budget', mode: 'example' }), 'example on loaded sample data');
    assert.equal(example.sample_data.status, 'loaded');
    assert.equal(served.demo.children.length, 0, 'nothing to load');
    const own = ok(await client(served, t).choose({ mode: 'own_data' }), 'then own_data');
    assert.equal(own.mode, 'own_data');
    assert.equal(own.reset_in_progress, true);
    await waitIdle(t);
    assert.equal(await waitForBackgroundWork(Date.now() + 30_000), 0);
    assert.equal(await exampleUsers(t.tenantId), 0);
    assert.deepEqual(await choiceRow(t.tenantId), { angle: 'budget', mode: 'own_data' });
    assert.deepEqual((await modeEvents(t.tenantId)).map((e) => e.after), [
      { mode: 'example', previous: null },
      { mode: 'own_data', previous: 'example' },
    ]);
    assert.deepEqual(served.demo.emails, []);
  } finally {
    await served.close();
    await cleanupTenants([t?.tenantId]);
  }
}

// 12. A member's `own_data` on an idle workspace while the load at activation waits for a slot:
//     the choice is written, the banner stays, and the load goes on once a slot is free.
async function testMemberOwnDataLeavesProvision() {
  const svc = buildServices();
  const served = await serve(svc);
  let t: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'onb-mprov', orgName: 'Member Provision Org', signup: true });
    const config = served.demo.service.config;
    config.maxConcurrent = 0;
    config.provisionRetryMs = 100;
    config.provisionRetryMaxMs = 20_000;
    const provisioning = served.demo.service.provisionTrialSampleData({
      tenantId: t.tenantId, actorId: t.ownerId, tenantUrl: `http://${hostOf(t)}`, language: 'en',
    });
    await sleep(250);
    const answer = ok(await client(served, t, await memberToken(svc, t)).choose({ angle: 'budget', mode: 'own_data' }), 'own_data by a member');
    assert.equal(answer.mode, 'own_data');
    assert.equal((await demoOf(t.tenantId)).dismissed_at, null, 'the banner stays');
    config.maxConcurrent = 2;
    await provisioning;
    assert.equal(served.demo.children.length, 1, 'the load at activation started');
    const state = await demoOf(t.tenantId);
    assert.equal(state.status, 'loading');
    assert.equal(state.dismissed_at, null);
  } finally {
    await served.close();
    await cleanupTenants([t?.tenantId]);
  }
}

// 13. `example` by the administrator on a failed load (reset when it failed): the load starts.
async function testExampleAfterFailedLoad() {
  const svc = buildServices();
  const served = await serve(svc);
  let t: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'onb-exfail', orgName: 'Example Failed Org', signup: true });
    const failedAt = new Date().toISOString();
    await setDemo(t.tenantId, {
      status: 'failed', run_id: 'failed-run', failed_at: failedAt, error_code: 'load_timeout', loaded_by: t.ownerId,
    });
    const answer = ok(await client(served, t).choose({ angle: 'portfolio', mode: 'example' }), 'example after a failed load');
    assert.equal(answer.sample_data.status, 'loading');
    assert.equal(served.demo.children.length, 1, 'one loader started');
    assert.equal((await demoOf(t.tenantId)).error_code, null);
  } finally {
    await served.close();
    await cleanupTenants([t?.tenantId]);
  }
}

runSpecs('onboarding-own-data.integration.spec', [
  testOwnDataAfterLoad,
  testOwnDataDuringLoad,
  testStopSeenByHeartbeat,
  testLoaderEndsAfterStop,
  testAbandonedStoppedLoad,
  testMemberCannotEmpty,
  testExample,
  testOwnDataIdleAndOnPremise,
  testProvisioningStopsAfterOwnData,
  testProvisionRaceWithOwnData,
  testOwnDataAfterChangesNeedsConfirmation,
  testOwnDataAfterFailedLoad,
  testOwnDataOnAbandonedLoad,
  testExampleThenOwnData,
  testMemberOwnDataLeavesProvision,
  testExampleAfterFailedLoad,
]).catch((error) => {
  console.error(error);
  process.exit(1);
});
