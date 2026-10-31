import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import * as jwt from 'jsonwebtoken';
import dataSource from '../../data-source';
import {
  ActivatedTenant,
  buildServices,
  cleanupTenants,
  createActivatedTenant,
  inTenant,
  runSpecs,
  Services,
} from '../../admin/tenants/__tests__/tenant-reset-test-helpers';
import { accessTokenVerifyKey } from '../../auth/jwt-key';
import { waitForBackgroundWork } from '../../common/background-work';
import { allocateItemNumbers } from '../../common/item-number.service';
import { Features } from '../../config/features';
import { DEMO_DATA_LANGUAGES, DemoDataService, readDemoState, resolveDemoDataLanguage } from '../../demo-data/demo-data.service';
import { PublicController } from '../public.controller';
import { TrialSignup } from '../trial-signup.entity';

// Sample data at trial activation (DemoDataService.provisionTrialSampleData): the activation
// answers as before, then the sample data loads in the background, with every check of a manual
// load (empty workspace included). Real activation, real DemoDataService and tenant reset on the
// spec database; the loader process and the e-mails are doubles.
// - the loader gets the tenant's host, its starting company and a token of the new administrator;
// - the sample data language is recorded (`en` whatever the browser, for now);
// - with every load slot taken, the load is tried again until a slot frees, or gives up `idle`;
// - a missing loader leaves `idle` (as a manual load), a loader that fails leaves `failed`;
// - a workspace holding a numbered record, before or during the wait, is refused with its counters intact;
// - a server stopping, or a manual load, during the wait ends the provision without a second loader;
// - a non-administrator is refused, and nothing starts.
// @database-spec: opens the data-source, so run-ci-tests.js runs it on a database lane.

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid = 4545;
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

type Harness = {
  service: DemoDataService;
  children: Array<{ env: Record<string, string>; child: FakeChild }>;
  logs: string[];
  finishAll: () => Promise<void>;
};

function harness(svc: Services): Harness {
  const children: Harness['children'] = [];
  const logs: string[] = [];
  const service = new DemoDataService(
    dataSource, svc.reset, svc.baseline, svc.auth, { isConfigured: () => false } as any,
    { notifyWorkspaceReset: async () => undefined } as any,
  );
  service.config.scriptPath = __filename;
  service.config.apiUrl = 'http://127.0.0.1:65530';
  service.config.spawn = ((_command: string, _args: string[], options: any) => {
    const child = new FakeChild();
    children.push({ env: options.env, child });
    return child;
  }) as any;
  const record = (level: string) => (message: unknown) => { logs.push(`${level} ${String(message)}`); };
  (service as any).logger = { log: record('log'), warn: record('warn'), error: record('error') };
  // A load started in the background after a failed check still gets its loader ended.
  const finishAll = async () => {
    const until = Date.now() + 60_000;
    for (;;) {
      for (const { child } of children) child.finish(0);
      if (await waitForBackgroundWork(Date.now() + 200) === 0) return;
      if (Date.now() > until) assert.fail(`the background work did not end; log:\n${logs.join('\n')}`);
    }
  };
  return { service, children, logs, finishAll };
}

const unhandled: unknown[] = [];
process.on('unhandledRejection', (reason) => { unhandled.push(reason); });

async function withActivationConfig<T>(fn: () => Promise<T>): Promise<T> {
  const savedUrl = process.env.APP_BASE_URL;
  const savedSingleTenant = Features.SINGLE_TENANT;
  // Tenant addresses `<slug>.lvh.me:8080`, a host the tenancy recognises (port dropped).
  process.env.APP_BASE_URL = 'http://lvh.me:8080';
  (Features as any).SINGLE_TENANT = false;
  try {
    return await fn();
  } finally {
    if (savedUrl === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = savedUrl;
    (Features as any).SINGLE_TENANT = savedSingleTenant;
  }
}

type Activated = { slug: string; tenantId: string; ownerId: string; result: { tenant_url: string; reset_token: string } };

/** Activates a trial sign-up through the real controller, with `demo` as its DemoDataService. */
async function activate(svc: Services, demo: DemoDataService, opts: { acceptLanguage?: string } = {}): Promise<Activated> {
  const controller = new PublicController(
    svc.tenants, svc.users, svc.baseline, dataSource,
    { send: async () => undefined } as any,
    svc.auth, dataSource.getRepository(TrialSignup), {} as any, {} as any, {} as any,
    demo,
  );
  const token = randomBytes(32).toString('hex');
  const slug = `rs-tp-${randomUUID().slice(0, 8)}`;
  await dataSource.query(
    `INSERT INTO trial_signups (org_name, slug, email, country_iso, token_hash, expires_at)
     VALUES ('Provision Org', $1, $2, 'FR', $3, now() + interval '1 hour')`,
    [slug, `owner-${slug}@reset-spec.test`, createHash('sha256').update(token, 'utf8').digest('hex')],
  );
  const headers: Record<string, string> = { host: 'kanap.example.test' };
  if (opts.acceptLanguage) headers['accept-language'] = opts.acceptLanguage;
  const result = await withActivationConfig(() => controller.activateTrial({ token }, { protocol: 'https', headers }));
  const [tenant] = await dataSource.query(`SELECT id FROM tenants WHERE slug = $1 AND deleted_at IS NULL`, [slug]);
  const [owner] = await inTenant(tenant.id, (m) =>
    m.query(`SELECT id FROM users WHERE tenant_id = $1 AND email = $2`, [tenant.id, `owner-${slug}@reset-spec.test`]));
  return { slug, tenantId: tenant.id, ownerId: owner.id, result };
}

async function cleanupActivated(activated: Array<Activated | undefined>) {
  const slugs = activated.filter((a): a is Activated => !!a).map((a) => a.slug);
  if (slugs.length === 0) return;
  const rows = await dataSource.query(`SELECT id FROM tenants WHERE slug = ANY($1)`, [slugs]);
  await cleanupTenants(rows.map((row: { id: string }) => row.id));
  await dataSource.query(`DELETE FROM trial_signups WHERE slug = ANY($1)`, [slugs]);
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

async function waitFor<T>(label: string, read: () => Promise<T> | T, done: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > until) assert.fail(`${label}: still ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** A task, numbered through `item_sequences` as the task screen does. */
async function createTask(tenantId: string, ownerId: string): Promise<number> {
  return inTenant(tenantId, async (m) => {
    const number = await allocateItemNumbers('task', tenantId, 1, m);
    await m.query(
      `INSERT INTO tasks (tenant_id, item_number, title, status, assignee_user_id, labels, owner_ids, viewer_ids, created_at, updated_at)
       VALUES ($1, $2, 'Real task', 'open', $3, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, now(), now())`,
      [tenantId, number, ownerId]);
    return number;
  });
}

/** The tenant's reference counters, by entity type. */
async function sequencesOf(tenantId: string): Promise<Record<string, number>> {
  const rows: Array<{ entity_type: string; next_val: number }> = await inTenant(tenantId, (m) =>
    m.query(`SELECT entity_type, next_val FROM item_sequences WHERE tenant_id = $1 ORDER BY entity_type`, [tenantId]));
  return Object.fromEntries(rows.map((row) => [row.entity_type, Number(row.next_val)]));
}

const tenantUrlOf = (slug: string) => `http://${slug}.lvh.me:8080`;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function settle() {
  assert.equal(await waitForBackgroundWork(Date.now() + 60_000), 0, 'the background work ended');
}

// The activation answers as before; the load then runs for the new administrator, on the
// tenant's host, with its starting company, and ends `loaded` when the loader exits 0.
async function testActivationLoadsSampleData() {
  const svc = buildServices();
  const h = harness(svc);
  let a: Activated | undefined;
  try {
    a = await activate(svc, h.service);
    assert.deepEqual(Object.keys(a.result).sort(), ['reset_token', 'tenant_url']);
    assert.equal(a.result.tenant_url, `http://${a.slug}.lvh.me:8080`);
    assert.ok(a.result.reset_token);

    await waitFor('loader started', () => h.children.length, (n) => n === 1);
    const demo = await demoOf(a.tenantId);
    assert.equal(demo.status, 'loading');
    assert.equal(demo.loaded_by, a.ownerId);
    const { env, child } = h.children[0];
    assert.equal(env.KANAP_DEMO_HOST, `${a.slug}.lvh.me`, 'the tenant host, port dropped');
    const [company] = await inTenant(a.tenantId, (m) => m.query(`SELECT name FROM companies WHERE tenant_id = $1`, [a!.tenantId]));
    assert.equal(env.KANAP_DEMO_STARTING_COMPANY, company.name);
    const payload = jwt.verify(env.KANAP_DEMO_TOKEN, accessTokenVerifyKey()) as Record<string, any>;
    assert.equal(payload.sub, a.ownerId, 'a token of the administrator just created');
    assert.equal(payload.tenant_id, a.tenantId);

    child.finish(0);
    await settle();
    assert.equal((await demoOf(a.tenantId)).status, 'loaded');
    assert.ok(h.logs.every((line) => !line.includes(env.KANAP_DEMO_TOKEN)), 'the token is never logged');
  } finally {
    await h.finishAll();
    await cleanupActivated([a]);
  }
}

// The sample data language: recorded in the state, `en` for any browser language for now.
async function testLanguageIsRecorded() {
  assert.deepEqual([...DEMO_DATA_LANGUAGES], ['en']);
  assert.equal(resolveDemoDataLanguage('en'), 'en');
  assert.equal(resolveDemoDataLanguage(' EN '), 'en');
  assert.equal(resolveDemoDataLanguage('fr'), 'en');
  assert.equal(resolveDemoDataLanguage(undefined), 'en');
  assert.equal(resolveDemoDataLanguage(42), 'en');

  const svc = buildServices();
  const h = harness(svc);
  let a: Activated | undefined;
  try {
    a = await activate(svc, h.service, { acceptLanguage: 'fr-FR,fr;q=0.9,en;q=0.8' });
    const [tenant] = await dataSource.query(`SELECT metadata->>'language' AS language FROM tenants WHERE id = $1`, [a.tenantId]);
    assert.equal(tenant.language, 'fr', 'the tenant keeps the browser language');
    await waitFor('loader started', () => h.children.length, (n) => n === 1);
    const demo = await demoOf(a.tenantId);
    assert.equal(demo.language, 'en');
    assert.equal((await h.service.getStatus(a.tenantId)).language, 'en', 'the state shows the language');
  } finally {
    await h.finishAll();
    await cleanupActivated([a]);
  }
}

// Every load slot taken: no loader starts; once a slot frees, the next try starts the load.
// Slots taken until the end: the workspace stays `idle`, one warning, no unhandled rejection.
async function testCapacityRetries() {
  const svc = buildServices();
  const h = harness(svc);
  h.service.config.maxConcurrent = 2;
  h.service.config.provisionRetryMs = 150;
  h.service.config.provisionRetryMaxMs = 5_000;
  const busy: ActivatedTenant[] = [];
  let a: Activated | undefined;
  let b: Activated | undefined;
  const occupy = async (tenant: ActivatedTenant) => setDemo(tenant.tenantId, {
    status: 'loading', run_id: randomUUID(), heartbeat_at: new Date().toISOString(), started_at: new Date().toISOString(),
  });
  try {
    busy.push(await createActivatedTenant(svc, { tag: 'tp-busy1', orgName: 'Busy One' }));
    busy.push(await createActivatedTenant(svc, { tag: 'tp-busy2', orgName: 'Busy Two' }));
    for (const tenant of busy) await occupy(tenant);

    a = await activate(svc, h.service);
    await pause(600);
    assert.equal(h.children.length, 0, 'no loader while every slot is taken');
    assert.equal((await demoOf(a.tenantId)).status, 'idle');

    await setDemo(busy[0].tenantId, { status: 'loaded', run_id: null, heartbeat_at: null });
    await waitFor('loader started on a later try', () => h.children.length, (n) => n === 1);
    assert.equal((await demoOf(a.tenantId)).status, 'loading');
    h.children[0].child.finish(0);
    await settle();
    assert.equal((await demoOf(a.tenantId)).status, 'loaded');

    // Slots taken to the end (the first busy tenant again, and the tenant just loaded is done).
    await occupy(busy[0]);
    h.service.config.provisionRetryMs = 100;
    h.service.config.provisionRetryMaxMs = 500;
    const before = h.logs.length;
    b = await activate(svc, h.service);
    await settle();
    assert.equal(h.children.length, 1, 'no second loader');
    const demo = await demoOf(b.tenantId);
    assert.equal(demo.status, 'idle', 'the administrator can still load the sample data');
    const warnings = h.logs.slice(before).filter((line) => line.startsWith('warn') && line.includes(b!.tenantId));
    assert.equal(warnings.length, 1, `one warning: ${JSON.stringify(warnings)}`);
    assert.match(warnings[0], /other loads kept running/);
    assert.deepEqual(unhandled, [], 'no unhandled rejection');
  } finally {
    await h.finishAll();
    await cleanupActivated([a, b]);
    await cleanupTenants(busy.map((tenant) => tenant.tenantId));
  }
}

// No loader script: the activation answers; the workspace stays `idle`, as a manual load refused
// with 503. A loader that cannot start or that fails: `failed`, as a manual load (runLoad).
async function testMissingOrFailingLoader() {
  const svc = buildServices();
  const h = harness(svc);
  const activated: Activated[] = [];
  try {
    h.service.config.scriptPath = null;
    const missing = await activate(svc, h.service);
    activated.push(missing);
    assert.ok(missing.result.reset_token);
    await settle();
    assert.equal(h.children.length, 0);
    assert.equal((await demoOf(missing.tenantId)).status, 'idle');
    assert.ok(h.logs.some((line) => line.startsWith('warn') && line.includes(missing.tenantId) && line.includes('demo_data_unavailable')));

    h.service.config.scriptPath = __filename;
    const failing = await activate(svc, h.service);
    activated.push(failing);
    assert.ok(failing.result.reset_token);
    await waitFor('loader started', () => h.children.length, (n) => n === 1);
    h.children[0].child.finish(1);
    await settle();
    const failed = await demoOf(failing.tenantId);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error_code, 'load_failed');

    const spawn = h.service.config.spawn;
    h.service.config.spawn = (() => { throw new Error('spawn refused'); }) as any;
    const unstarted = await activate(svc, h.service);
    activated.push(unstarted);
    await settle();
    h.service.config.spawn = spawn;
    const notStarted = await demoOf(unstarted.tenantId);
    assert.equal(notStarted.status, 'failed');
    assert.equal(notStarted.error_code, 'load_not_started');
  } finally {
    await h.finishAll();
    await cleanupActivated(activated);
  }
}

// A numbered record (a task) created before the provision: refused (`tenant_not_empty`), no
// loader, `idle`, and the `task` counter left as it was.
async function testNumberedRecordBeforeProvision() {
  const svc = buildServices();
  const h = harness(svc);
  let t: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'tp-full', orgName: 'Full Org', signup: true });
    assert.equal(await createTask(t.tenantId, t.ownerId), 1);
    const before = await sequencesOf(t.tenantId);
    assert.equal(before.task, 2);
    await assert.rejects(h.service.loadDemoData(t.tenantId, { language: 'en', actorId: t.ownerId, host: `${t.slug}.lvh.me` }), (error: any) => {
      assert.equal(error?.getResponse?.()?.code, 'tenant_not_empty');
      return true;
    });

    const logged = h.logs.length;
    await h.service.provisionTrialSampleData({ tenantId: t.tenantId, actorId: t.ownerId, tenantUrl: tenantUrlOf(t.slug), language: 'en' });
    const warnings = h.logs.slice(logged).filter((line) => line.startsWith('warn'));
    assert.equal(warnings.length, 1, JSON.stringify(warnings));
    assert.match(warnings[0], /tenant_not_empty$/);
    assert.equal(h.children.length, 0, 'no loader');
    assert.equal((await demoOf(t.tenantId)).status, 'idle');
    assert.deepEqual(await sequencesOf(t.tenantId), before, 'the counters are intact');
  } finally {
    await h.finishAll();
    await cleanupTenants([t?.tenantId]);
  }
}

// Every slot taken at activation; the administrator creates a task during the wait: the next
// try is refused (`tenant_not_empty`) even with a slot free, no loader, counters intact.
async function testTaskCreatedDuringWait() {
  const svc = buildServices();
  const h = harness(svc);
  h.service.config.maxConcurrent = 1;
  h.service.config.provisionRetryMs = 150;
  h.service.config.provisionRetryMaxMs = 5_000;
  let busy: ActivatedTenant | undefined;
  let a: Activated | undefined;
  try {
    busy = await createActivatedTenant(svc, { tag: 'tp-busy', orgName: 'Busy Org' });
    await setDemo(busy.tenantId, { status: 'loading', run_id: randomUUID(), heartbeat_at: new Date().toISOString(), started_at: new Date().toISOString() });
    const logged = h.logs.length;
    a = await activate(svc, h.service);
    await pause(400);
    assert.equal(h.children.length, 0, 'no loader while every slot is taken');
    await createTask(a.tenantId, a.ownerId);
    const before = await sequencesOf(a.tenantId);
    assert.equal(before.task, 2);
    await setDemo(busy.tenantId, { status: 'loaded', run_id: null, heartbeat_at: null });

    await settle();
    assert.equal(h.children.length, 0, 'nothing loaded over the records');
    assert.equal((await demoOf(a.tenantId)).status, 'idle');
    assert.deepEqual(await sequencesOf(a.tenantId), before, 'the counters are intact');
    const warnings = h.logs.slice(logged).filter((line) => line.startsWith('warn') && line.includes(a!.tenantId));
    assert.equal(warnings.length, 1, JSON.stringify(warnings));
    assert.match(warnings[0], /tenant_not_empty$/);
  } finally {
    await h.finishAll();
    await cleanupActivated([a]);
    await cleanupTenants([busy?.tenantId]);
  }
}

// The API process stops during the wait: no further try, the provision resolves, one warning.
async function testStopDuringWait() {
  const svc = buildServices();
  const h = harness(svc);
  h.service.config.maxConcurrent = 1;
  h.service.config.provisionRetryMs = 60_000;
  h.service.config.provisionRetryMaxMs = 10 * 60_000;
  let busy: ActivatedTenant | undefined;
  let t: ActivatedTenant | undefined;
  try {
    busy = await createActivatedTenant(svc, { tag: 'tp-busy', orgName: 'Busy Org' });
    await setDemo(busy.tenantId, { status: 'loading', run_id: randomUUID(), heartbeat_at: new Date().toISOString(), started_at: new Date().toISOString() });
    t = await createActivatedTenant(svc, { tag: 'tp-stop', orgName: 'Stop Org', signup: true });
    const logged = h.logs.length;
    const run = h.service.provisionTrialSampleData({ tenantId: t.tenantId, actorId: t.ownerId, tenantUrl: tenantUrlOf(t.slug), language: 'en' });
    await pause(300);
    const tries = h.logs.length;
    h.service.stop();
    await setDemo(busy.tenantId, { status: 'loaded', run_id: null, heartbeat_at: null });
    const ended = await Promise.race([run.then(() => true), pause(5_000).then(() => false)]);
    assert.ok(ended, 'the provision resolves soon after the stop');
    assert.equal(h.children.length, 0, 'no loader');
    assert.equal((await demoOf(t.tenantId)).status, 'idle');
    const warnings = h.logs.slice(logged).filter((line) => line.startsWith('warn'));
    assert.equal(warnings.length, 1, JSON.stringify(warnings));
    assert.match(warnings[0], /the server is stopping/);
    assert.equal(h.logs.length, tries + 1, `no try after the stop: ${JSON.stringify(h.logs.slice(tries))}`);
  } finally {
    await h.finishAll();
    await cleanupTenants([t?.tenantId, busy?.tenantId]);
  }
}

// An administrator loads the sample data by hand during the wait: the next try is refused
// (`demo_status_conflict`), the provision ends without a second loader.
async function testManualLoadDuringWait() {
  const svc = buildServices();
  const h = harness(svc);
  h.service.config.maxConcurrent = 1;
  h.service.config.provisionRetryMs = 2_000;
  h.service.config.provisionRetryMaxMs = 30_000;
  let busy: ActivatedTenant | undefined;
  let t: ActivatedTenant | undefined;
  try {
    busy = await createActivatedTenant(svc, { tag: 'tp-busy', orgName: 'Busy Org' });
    await setDemo(busy.tenantId, { status: 'loading', run_id: randomUUID(), heartbeat_at: new Date().toISOString(), started_at: new Date().toISOString() });
    t = await createActivatedTenant(svc, { tag: 'tp-manual', orgName: 'Manual Org', signup: true });
    const logged = h.logs.length;
    const run = h.service.provisionTrialSampleData({ tenantId: t.tenantId, actorId: t.ownerId, tenantUrl: tenantUrlOf(t.slug), language: 'en' });
    await pause(300);
    assert.equal(h.children.length, 0, 'no loader while every slot is taken');

    await setDemo(busy.tenantId, { status: 'loaded', run_id: null, heartbeat_at: null });
    const manual = await h.service.load({ tenantId: t.tenantId, actorId: t.ownerId, host: `${t.slug}.lvh.me` });
    assert.equal(manual.status, 'loading');
    assert.equal(h.children.length, 1);

    await run;
    assert.equal(h.children.length, 1, 'no second loader');
    const warnings = h.logs.slice(logged).filter((line) => line.startsWith('warn'));
    assert.equal(warnings.length, 1, JSON.stringify(warnings));
    assert.match(warnings[0], /demo_status_conflict$/);
    h.children[0].child.finish(0);
    await settle();
    assert.equal((await demoOf(t.tenantId)).status, 'loaded');
  } finally {
    await h.finishAll();
    await cleanupTenants([t?.tenantId, busy?.tenantId]);
  }
}

// A non-administrator as `actorId`, or a host of another tenant: refused, no loader.
async function testRefusals() {
  const svc = buildServices();
  const h = harness(svc);
  let t: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'tp-refuse', orgName: 'Refuse Org' });
    const member = await inTenant(t.tenantId, (manager) => svc.users.createUser({
      email: `member-${randomUUID().slice(0, 8)}@reset-spec.test`,
      role_name: 'Portfolio Member',
      tenant_id: t!.tenantId,
    }, { manager }));
    const host = `${t.slug}.lvh.me`;
    await assert.rejects(h.service.loadDemoData(t.tenantId, { language: 'en', actorId: member.id, host }), (error: any) => {
      assert.equal(error?.getResponse?.()?.code, 'administrator_required');
      return true;
    });
    await assert.rejects(h.service.loadDemoData(t.tenantId, { language: 'en', actorId: t.ownerId, host: 'other.lvh.me' }), (error: any) => {
      assert.equal(error?.getResponse?.()?.code, 'host_mismatch');
      return true;
    });

    const before = h.logs.length;
    await h.service.provisionTrialSampleData({ tenantId: t.tenantId, actorId: member.id, tenantUrl: tenantUrlOf(t.slug), language: 'en' });
    const warnings = h.logs.slice(before).filter((line) => line.startsWith('warn'));
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /administrator_required/);
    assert.equal(h.children.length, 0, 'no loader');
    assert.equal((await demoOf(t.tenantId)).status, 'idle');
  } finally {
    await h.finishAll();
    await cleanupTenants([t?.tenantId]);
  }
}

runSpecs('trial-provision.integration.spec', [
  testActivationLoadsSampleData,
  testLanguageIsRecorded,
  testCapacityRetries,
  testMissingOrFailingLoader,
  testNumberedRecordBeforeProvision,
  testTaskCreatedDuringWait,
  testStopDuringWait,
  testManualLoadDuringWait,
  testRefusals,
]).catch((err) => {
  console.error(err);
  process.exit(1);
}).then(() => {
  if (unhandled.length) {
    console.error('unhandled rejections:', unhandled);
    process.exit(1);
  }
});
