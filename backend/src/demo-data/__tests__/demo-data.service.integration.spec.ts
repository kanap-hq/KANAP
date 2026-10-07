import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import dataSource from '../../data-source';
import { accessTokenVerifyKey } from '../../auth/jwt-key';
import { waitForBackgroundWork } from '../../common/background-work';
import { TENANT_SCOPED_TABLES } from '../../common/tenant-isolation.inventory';
import { Features } from '../../config/features';
import {
  ActivatedTenant,
  addRealUser,
  buildServices,
  cleanupTenants,
  countDifferences,
  countTenantRows,
  createActivatedTenant,
  inTenant,
  loadDemoSet,
  refusal,
  runSpecs,
  Services,
} from '../../admin/tenants/__tests__/tenant-reset-test-helpers';
import { DEMO_LOAD_EMPTY_TABLES, DemoDataService, findTenantContent, readDemoState } from '../demo-data.service';

// DemoDataService against a real database (non-superuser role, RLS), with the real tenant reset
// and a double of the loader process: the state machine in tenants.metadata.demo (claims, double
// click, global cap, run ownership), the loader's process (arguments, minimal environment, the
// token only there and never logged), the automatic reset after a failure once the process has
// ended, the time limit, the stop of the API, the reconciliation of a load or a reset left by a
// stopped API process (and a live one left alone), the refusals, and the manual reset.

/** A loader process double, driven by the spec. */
class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid = 4242;
  readonly signals: string[] = [];
  done = false;
  /** Set when `close` is emitted: the process has exited and its output streams are closed. */
  closed = false;

  kill(signal: string) {
    this.signals.push(signal);
    this.finish(null, signal);
    return true;
  }

  finish(code: number | null, signal: string | null = null) {
    if (this.done) return;
    this.done = true;
    this.stdout.end();
    this.stderr.end();
    // As a real process: `exit` first, `close` once its output streams have closed.
    setTimeout(() => this.emit('exit', code, signal), 20);
    setTimeout(() => {
      this.closed = true;
      this.emit('close', code, signal);
    }, 250);
  }
}

type SpawnCall = { command: string; args: string[]; options: any; child: FakeChild };

type Harness = {
  service: DemoDataService;
  /** Ends every loader double still running and waits for the runs (a failed check leaves none behind). */
  finishAll: () => Promise<void>;
  spawns: SpawnCall[];
  logs: string[];
  /** Each reset: the status stored at that moment, and whether the last loader had closed. */
  resetCalls: Array<{ tenantId: string; actorId: string | null; status: string; childClosed: boolean | null }>;
};

/** The service on the spec database, its loader spawned as a double, its log recorded. */
function harness(svc: Services, opts: { stripeConfigured?: boolean; failReset?: boolean } = {}): Harness {
  const spawns: SpawnCall[] = [];
  const logs: string[] = [];
  const resetCalls: Harness['resetCalls'] = [];
  const realReset = svc.reset;
  const reset = {
    async reset(tenantId: string, actorId: string | null) {
      const [row] = await dataSource.query(`SELECT metadata->'demo'->>'status' AS status FROM tenants WHERE id = $1`, [tenantId]);
      const last = spawns.filter((call) => call.child).at(-1);
      resetCalls.push({ tenantId, actorId, status: row?.status, childClosed: last ? last.child.closed : null });
      if (opts.failReset) throw new Error('injected reset failure');
      return realReset.reset(tenantId, actorId);
    },
  };
  const service = new DemoDataService(
    dataSource,
    reset as any,
    svc.baseline,
    svc.auth,
    { isConfigured: () => !!opts.stripeConfigured } as any,
  );
  service.config.scriptPath = __filename;
  service.config.apiUrl = 'http://127.0.0.1:65530';
  service.config.spawn = ((command: string, args: string[], options: any) => {
    const child = new FakeChild();
    spawns.push({ command, args, options, child });
    return child;
  }) as any;
  const record = (level: string) => (message: unknown) => { logs.push(`${level} ${String(message)}`); };
  (service as any).logger = { log: record('log'), warn: record('warn'), error: record('error') };
  const finishAll = async () => {
    for (const call of spawns) call.child.finish(0);
    await waitForBackgroundWork(Date.now() + 60_000);
  };
  return { service, spawns, logs, resetCalls, finishAll };
}

const hostOf = (tenant: ActivatedTenant) => `${tenant.slug}.lvh.me`;

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

async function settle() {
  const left = await waitForBackgroundWork(Date.now() + 60_000);
  assert.equal(left, 0, 'the background work of the loads ended');
}

async function waitFor<T>(label: string, read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > until) assert.fail(`${label}: still ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

function codeOf(error: any): string | undefined {
  return error?.getResponse?.()?.code;
}

// The loader runs as `node <script> --server-mode` without a shell, with PATH, NODE_ENV and its
// five inputs only; the token is a valid access token of the administrator, never in the
// arguments, never in the log (not even when the loader prints it). Steps reach the state; exit
// 0 makes the status `loaded`.
async function testLoadRunsTheLoader() {
  const svc = buildServices();
  const h = harness(svc);
  let t: ActivatedTenant | undefined;
  const savedNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  process.env.KANAP_SPEC_SECRET = 'must-not-reach-the-loader';
  try {
    t = await createActivatedTenant(svc, { tag: 'dd-ok', orgName: 'Loader Org', signup: true });
    assert.deepEqual(await inTenant(t.tenantId, (m) => findTenantContent(m, t!.tenantId)), [], 'an activated tenant is in its starting state');

    const state = await h.service.load({ tenantId: t.tenantId, actorId: t.ownerId, host: `${hostOf(t).toUpperCase()}:8080` });
    assert.equal(state.status, 'loading');
    assert.equal(state.loaded_by, t.ownerId);
    assert.ok(!('run_id' in state), 'the run id stays internal');
    assert.equal(h.spawns.length, 1);
    const [call] = h.spawns;
    assert.equal(call.command, process.execPath);
    assert.deepEqual(call.args, [__filename, '--server-mode']);
    assert.equal(call.options.shell, false);
    assert.deepEqual(call.options.stdio, ['ignore', 'pipe', 'pipe']);
    const env = call.options.env as Record<string, string>;
    assert.deepEqual(Object.keys(env).sort(), [
      'KANAP_DEMO_API_URL', 'KANAP_DEMO_HOST', 'KANAP_DEMO_STARTING_COMPANY', 'KANAP_DEMO_TOKEN', 'KANAP_DEMO_YEAR', 'NODE_ENV', 'PATH',
    ]);
    assert.equal(env.PATH, process.env.PATH);
    assert.equal(env.NODE_ENV, 'production');
    assert.equal(env.KANAP_DEMO_API_URL, 'http://127.0.0.1:65530');
    assert.equal(env.KANAP_DEMO_HOST, hostOf(t), 'the host without port, lower case');
    assert.equal(env.KANAP_DEMO_STARTING_COMPANY, 'Loader Org');
    assert.equal(env.KANAP_DEMO_YEAR, String(new Date().getFullYear()));
    const token = env.KANAP_DEMO_TOKEN;
    const payload = jwt.verify(token, accessTokenVerifyKey()) as Record<string, any>;
    assert.equal(payload.sub, t.ownerId);
    assert.equal(payload.tenant_id, t.tenantId);
    assert.equal(payload.purpose, 'access');
    assert.ok(!call.args.some((arg) => arg.includes(token)), 'the token is not an argument');

    call.child.stdout.write('KANAP_DEMO_STEP settings\n');
    await waitFor('step', () => demoOf(t!.tenantId), (demo) => demo.step === 'settings');
    call.child.stdout.write('KANAP_DEMO_STEP companies\nnot a step line\n');
    call.child.stderr.write(`[INFO] Importing 01-companies.csv\n[INFO] Authorization: Bearer ${token}\n`);
    await waitFor('step', () => demoOf(t!.tenantId), (demo) => demo.step === 'companies');
    assert.equal((await h.service.getStatus(t.tenantId)).status, 'loading');

    call.child.finish(0);
    await settle();
    const loaded = await demoOf(t.tenantId);
    assert.equal(loaded.status, 'loaded');
    assert.ok(loaded.loaded_at);
    assert.equal(loaded.step, null);
    assert.equal(loaded.error_code, null);
    assert.equal(h.resetCalls.length, 0, 'no reset after a successful load');
    assert.ok(h.logs.some((line) => /Sample data loaded into tenant/.test(line)));
    assert.ok(h.logs.every((line) => !line.includes(token)), 'the token is never logged');
  } finally {
    await h.finishAll();
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedNodeEnv;
    delete process.env.KANAP_SPEC_SECRET;
    await cleanupTenants([t?.tenantId]);
  }
}

// A load that fails half-way: once the process has exited, the status is `resetting`, the
// tenant is reset (the rows the load wrote are gone), then `failed` with a readable code. The
// last output lines go to the server log, the token masked.
async function testFailedLoadIsReset() {
  const svc = buildServices();
  const h = harness(svc);
  let t: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'dd-fail', orgName: 'Failing Org', signup: true });
    const initial = await countTenantRows(t.tenantId);
    await h.service.load({ tenantId: t.tenantId, actorId: t.ownerId, host: hostOf(t) });
    const [call] = h.spawns;
    const token = call.options.env.KANAP_DEMO_TOKEN as string;

    // The rows the loader wrote before it failed.
    await loadDemoSet(t.tenantId);
    assert.ok(countDifferences(initial, await countTenantRows(t.tenantId)).length > 10);
    call.child.stdout.write('KANAP_DEMO_STEP contracts\n');
    call.child.stderr.write(`[ERR]  POST /contracts/import failed (500)\nleaked ${token}\n`);
    call.child.finish(1);
    await settle();

    assert.equal(h.resetCalls.length, 1);
    assert.deepEqual(h.resetCalls[0], { tenantId: t.tenantId, actorId: t.ownerId, status: 'resetting', childClosed: true });
    const failed = await demoOf(t.tenantId);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error_code, 'load_failed');
    assert.ok(failed.failed_at);
    assert.equal(failed.heartbeat_at, null);
    assert.deepEqual(countDifferences(initial, await countTenantRows(t.tenantId), ['audit_log']), [], 'back to the starting state');

    const report = h.logs.find((line) => /load of tenant .* failed \(load_failed, exit code 1\)/.test(line));
    assert.ok(report, 'the failure is logged');
    assert.match(report!, /POST \/contracts\/import failed \(500\)/);
    assert.match(report!, /leaked \[token\]/);
    assert.ok(h.logs.every((line) => !line.includes(token)), 'the token is never logged');

    // A failed load can be loaded again.
    await h.service.load({ tenantId: t.tenantId, actorId: t.ownerId, host: hostOf(t) });
    assert.equal(h.spawns.length, 2);
    h.spawns[1].child.finish(0);
    await settle();
    assert.equal((await demoOf(t.tenantId)).status, 'loaded');
  } finally {
    await h.finishAll();
    await cleanupTenants([t?.tenantId]);
  }
}

// Two clicks at once: one claim, one loader; the other click is refused. A load is refused while
// one runs and once loaded.
async function testDoubleClick() {
  const svc = buildServices();
  const h = harness(svc);
  let t: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'dd-dbl', orgName: 'Double Org' });
    const params = { tenantId: t.tenantId, actorId: t.ownerId, host: hostOf(t) };
    const outcomes = await Promise.allSettled([h.service.load(params), h.service.load(params), h.service.load(params)]);
    assert.equal(outcomes.filter((o) => o.status === 'fulfilled').length, 1, 'one claim');
    for (const outcome of outcomes.filter((o): o is PromiseRejectedResult => o.status === 'rejected')) {
      assert.ok(outcome.reason instanceof ConflictException, String(outcome.reason));
      assert.equal(codeOf(outcome.reason), 'demo_status_conflict');
    }
    assert.equal(h.spawns.length, 1, 'one loader');

    const running = await refusal(() => h.service.load(params));
    assert.equal(codeOf(running), 'demo_status_conflict');
    h.spawns[0].child.finish(0);
    await settle();
    const loaded = await refusal(() => h.service.load(params));
    assert.ok(loaded instanceof ConflictException);
    assert.equal((loaded.getResponse() as any).status, 'loaded');
    assert.equal(h.spawns.length, 1);
  } finally {
    await h.finishAll();
    await cleanupTenants([t?.tenantId]);
  }
}

// The global cap counts the live loads of every tenant: a third load waits for a free slot; a
// load whose heartbeat is stale does not count; two tenants racing for the last slot get one.
async function testGlobalCap() {
  const svc = buildServices();
  const h = harness(svc);
  const tenants: ActivatedTenant[] = [];
  try {
    for (const tag of ['cap-a', 'cap-b', 'cap-c', 'cap-d', 'cap-e']) {
      tenants.push(await createActivatedTenant(svc, { tag: `dd-${tag}`, orgName: `Cap ${tag}` }));
    }
    const [a, b, c, d, e] = tenants;
    const params = (t: ActivatedTenant) => ({ tenantId: t.tenantId, actorId: t.ownerId, host: hostOf(t) });
    assert.equal(h.service.config.maxConcurrent, 2, 'two loads at once by default');

    // A dead load elsewhere (stale heartbeat) does not hold a slot.
    await setDemo(d.tenantId, { status: 'loading', run_id: randomUUID(), heartbeat_at: minutesAgo(30) });
    await h.service.load(params(a));
    await h.service.load(params(b));
    const full = await refusal(() => h.service.load(params(c)));
    assert.ok(full instanceof ConflictException);
    assert.equal(codeOf(full), 'demo_load_capacity');
    assert.equal((await demoOf(c.tenantId)).status, 'idle', 'the refused tenant is left as it was');

    h.spawns[0].child.finish(0);
    await waitFor('a loaded', () => demoOf(a.tenantId), (demo) => demo.status === 'loaded');
    await h.service.load(params(c));
    assert.equal(h.spawns.length, 3);
    h.spawns[1].child.finish(0);
    h.spawns[2].child.finish(0);
    await settle();

    // One slot, two tenants claim it at once: one wins.
    h.service.config.maxConcurrent = 1;
    await setDemo(d.tenantId, { status: 'idle', run_id: null, heartbeat_at: null });
    const both = await Promise.allSettled([h.service.load(params(d)), h.service.load(params(e))]);
    assert.equal(both.filter((o) => o.status === 'fulfilled').length, 1, 'one of two claims for the last slot');
    const lost = both.find((o): o is PromiseRejectedResult => o.status === 'rejected')!;
    assert.equal(codeOf(lost.reason), 'demo_load_capacity');
    for (const call of h.spawns) call.child.finish(0);
    await settle();
  } finally {
    await h.finishAll();
    await cleanupTenants(tenants.map((t) => t.tenantId));
  }
}

// A load whose heartbeat is stale was left by a stopped API process: getStatus takes it over,
// resets the tenant, and ends `failed` / load_interrupted. A load with a fresh heartbeat (another
// API process runs it) is never touched. A reset left half-way is done again: `failed` after a
// failed load, `idle` after a reset an administrator asked for. The start-up pass does the same.
async function testReconciliation() {
  const svc = buildServices();
  const h = harness(svc);
  const tenants: ActivatedTenant[] = [];
  try {
    const dead = await createActivatedTenant(svc, { tag: 'dd-dead', orgName: 'Dead Org' });
    const live = await createActivatedTenant(svc, { tag: 'dd-live', orgName: 'Live Org' });
    const manual = await createActivatedTenant(svc, { tag: 'dd-man', orgName: 'Manual Org' });
    const auto = await createActivatedTenant(svc, { tag: 'dd-auto', orgName: 'Auto Org' });
    const boot = await createActivatedTenant(svc, { tag: 'dd-boot', orgName: 'Boot Org' });
    tenants.push(dead, live, manual, auto, boot);
    const initial = new Map<string, Record<string, number>>();
    for (const t of tenants) {
      initial.set(t.tenantId, await countTenantRows(t.tenantId));
      await loadDemoSet(t.tenantId);
    }

    await setDemo(dead.tenantId, { status: 'loading', run_id: randomUUID(), heartbeat_at: minutesAgo(3), loaded_by: dead.ownerId, dismissed_at: '2026-10-01T00:00:00.000Z' });
    await setDemo(live.tenantId, { status: 'loading', run_id: randomUUID(), heartbeat_at: new Date(Date.now() - 10_000).toISOString(), loaded_by: live.ownerId });
    await setDemo(manual.tenantId, { status: 'resetting', run_id: randomUUID(), heartbeat_at: minutesAgo(5), error_code: null });
    await setDemo(auto.tenantId, { status: 'resetting', run_id: randomUUID(), heartbeat_at: minutesAgo(5), error_code: 'load_timeout' });

    const taken = await h.service.getStatus(dead.tenantId);
    assert.equal(taken.status, 'resetting', 'getStatus takes the dead load over');
    assert.equal(taken.error_code, 'load_interrupted');
    const again = await h.service.getStatus(dead.tenantId);
    assert.equal(again.status, 'resetting');
    assert.equal((await h.service.getStatus(live.tenantId)).status, 'loading', 'a live load is left alone');
    await h.service.getStatus(manual.tenantId);
    await h.service.getStatus(auto.tenantId);
    await settle();

    assert.equal(h.resetCalls.filter((call) => call.tenantId === dead.tenantId).length, 1, 'one reset for two reads');
    const deadState = await demoOf(dead.tenantId);
    assert.equal(deadState.status, 'failed');
    assert.equal(deadState.error_code, 'load_interrupted');
    assert.equal(deadState.dismissed_at, '2026-10-01T00:00:00.000Z', 'the banner choice is kept');
    assert.equal(h.resetCalls.find((call) => call.tenantId === dead.tenantId)!.actorId, dead.ownerId);
    assert.equal((await demoOf(manual.tenantId)).status, 'idle');
    const autoState = await demoOf(auto.tenantId);
    assert.equal(autoState.status, 'failed');
    assert.equal(autoState.error_code, 'load_timeout');
    for (const t of [dead, manual, auto]) {
      assert.deepEqual(countDifferences(initial.get(t.tenantId)!, await countTenantRows(t.tenantId), ['audit_log']), [], `${t.slug} reset`);
    }
    const liveState = await demoOf(live.tenantId);
    assert.equal(liveState.status, 'loading');
    assert.ok(countDifferences(initial.get(live.tenantId)!, await countTenantRows(live.tenantId)).length > 10, 'the live load keeps its rows');
    assert.ok(!h.resetCalls.some((call) => call.tenantId === live.tenantId));

    // The start-up pass: the stale one is taken over, the live one is not.
    await setDemo(boot.tenantId, { status: 'loading', run_id: randomUUID(), heartbeat_at: minutesAgo(10) });
    await h.service.reconcileOnStartup();
    await settle();
    assert.equal((await demoOf(boot.tenantId)).status, 'failed');
    assert.deepEqual(countDifferences(initial.get(boot.tenantId)!, await countTenantRows(boot.tenantId), ['audit_log']), []);
    assert.equal((await demoOf(live.tenantId)).status, 'loading', 'still left alone at start-up');
  } finally {
    h.service.stop();
    await h.finishAll();
    await cleanupTenants(tenants.map((t) => t.tenantId));
  }
}

// The time limit: the loader is killed, then the tenant is reset and the load is `failed` /
// load_timeout. A stop of the API kills the loader and leaves `loading` for the next start.
async function testTimeoutAndStop() {
  const svc = buildServices();
  const h = harness(svc);
  let t: ActivatedTenant | undefined;
  let s: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'dd-slow', orgName: 'Slow Org' });
    const initial = await countTenantRows(t.tenantId);
    h.service.config.timeoutMs = 300;
    await h.service.load({ tenantId: t.tenantId, actorId: t.ownerId, host: hostOf(t) });
    await settle();
    assert.deepEqual(h.spawns[0].child.signals, ['SIGKILL']);
    const timedOut = await demoOf(t.tenantId);
    assert.equal(timedOut.status, 'failed');
    assert.equal(timedOut.error_code, 'load_timeout');
    assert.deepEqual(h.resetCalls.map((call) => [call.status, call.childClosed]), [['resetting', true]]);
    assert.deepEqual(countDifferences(initial, await countTenantRows(t.tenantId), ['audit_log']), []);

    h.service.config.timeoutMs = 60_000;
    s = await createActivatedTenant(svc, { tag: 'dd-stop', orgName: 'Stop Org' });
    await h.service.load({ tenantId: s.tenantId, actorId: s.ownerId, host: hostOf(s) });
    h.service.stop();
    await settle();
    assert.deepEqual(h.spawns[1].child.signals, ['SIGKILL']);
    assert.equal((await demoOf(s.tenantId)).status, 'loading', 'left for the next start');
    assert.equal(h.resetCalls.length, 1, 'no reset while the API stops');
    const stopped = await refusal(() => h.service.load({ tenantId: t!.tenantId, actorId: t!.ownerId, host: hostOf(t!) }));
    assert.equal(codeOf(stopped), 'demo_data_unavailable');
  } finally {
    await h.finishAll();
    await cleanupTenants([t?.tenantId, s?.tenantId]);
  }
}

// The refusals, each with nothing written and no loader started: single-tenant installation,
// system tenant, frozen subscription and expired trial (the reset stays allowed), a user who is
// not an administrator of the tenant, a host of another tenant, a workspace with data, a reset
// with nothing to reset.
async function testRefusals() {
  const svc = buildServices();
  const h = harness(svc, { stripeConfigured: true });
  const tenants: ActivatedTenant[] = [];
  try {
    const t = await createActivatedTenant(svc, { tag: 'dd-ref', orgName: 'Refusal Org' });
    const other = await createActivatedTenant(svc, { tag: 'dd-oth', orgName: 'Other Org' });
    tenants.push(t, other);
    const params = { tenantId: t.tenantId, actorId: t.ownerId, host: hostOf(t) };

    // Every main business table is in the list's reach, and the list is made of tenant tables.
    for (const table of DEMO_LOAD_EMPTY_TABLES) assert.ok((TENANT_SCOPED_TABLES as readonly string[]).includes(table), table);

    const saved = Features.SINGLE_TENANT;
    (Features as any).SINGLE_TENANT = true;
    try {
      for (const call of [() => h.service.load(params), () => h.service.getStatus(t.tenantId), () => h.service.reset(params)]) {
        assert.ok((await refusal(call)) instanceof NotFoundException);
      }
      await h.service.reconcileOnStartup();
    } finally {
      (Features as any).SINGLE_TENANT = saved;
    }

    const member = await addRealUser(svc, t.tenantId);
    for (const actorId of [member, other.ownerId, randomUUID(), 'not-a-uuid']) {
      const error = await refusal(() => h.service.load({ ...params, actorId }));
      assert.ok(error instanceof ForbiddenException, String(error));
      assert.equal(codeOf(error), 'administrator_required');
    }
    await inTenant(t.tenantId, (m) => m.query(`UPDATE users SET status = 'disabled' WHERE id = $1`, [t.ownerId]));
    assert.equal(codeOf(await refusal(() => h.service.load(params))), 'administrator_required', 'a disabled administrator');
    await inTenant(t.tenantId, (m) => m.query(`UPDATE users SET status = 'enabled' WHERE id = $1`, [t.ownerId]));

    for (const host of [hostOf(other), 'lvh.me', `${t.slug}.example.com`, '', 'a b.lvh.me', `${t.slug}.lvh.me/x`]) {
      const error = await refusal(() => h.service.load({ ...params, host }));
      assert.ok(error instanceof BadRequestException, `${host}: ${String(error)}`);
      assert.equal(codeOf(error), 'host_mismatch');
    }

    await inTenant(t.tenantId, (m) => m.query(`UPDATE subscriptions SET trial_end = now() - interval '1 day' WHERE tenant_id = $1`, [t.tenantId]));
    const expired = await refusal(() => h.service.load(params));
    assert.ok(expired instanceof ForbiddenException);
    assert.equal(codeOf(expired), 'TRIAL_EXPIRED');
    await inTenant(t.tenantId, (m) => m.query(
      `UPDATE subscriptions SET status = 'past_due', current_period_end = now() - interval '90 days' WHERE tenant_id = $1`, [t.tenantId]));
    const frozen = await refusal(() => h.service.load(params));
    assert.equal(codeOf(frozen), 'SUBSCRIPTION_FROZEN');

    // Frozen: the reset of a load stays allowed.
    await setDemo(t.tenantId, { status: 'failed', run_id: randomUUID(), error_code: 'load_failed' });
    assert.equal((await h.service.reset(params)).status, 'idle');
    await inTenant(t.tenantId, (m) => m.query(
      `UPDATE subscriptions SET status = 'trialing', trial_end = now() + interval '10 days' WHERE tenant_id = $1`, [t.tenantId]));

    // A workspace with data of its own: a supplier, a second company, a document, a sample user.
    for (const [table, sql] of [
      ['suppliers', `INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Real supplier')`],
      ['companies', `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Second company', 'FR', 'Lyon')`],
      ['documents', `INSERT INTO documents (tenant_id, item_number, title, content_markdown, library_id)
                     SELECT $1, 9001, 'Real document', '', id FROM document_libraries WHERE tenant_id = $1 AND slug = 'documents'`],
    ] as const) {
      await inTenant(t.tenantId, (m) => m.query(sql, [t.tenantId]));
      const error = await refusal(() => h.service.load(params));
      assert.ok(error instanceof ConflictException, `${table}: ${String(error)}`);
      assert.equal(codeOf(error), 'tenant_not_empty');
      assert.deepEqual((error.getResponse() as any).tables, [table]);
      await inTenant(t.tenantId, (m) => m.query(
        table === 'documents' ? `DELETE FROM documents WHERE tenant_id = $1 AND title = 'Real document'`
          : table === 'companies' ? `DELETE FROM companies WHERE tenant_id = $1 AND name = 'Second company'`
            : `DELETE FROM suppliers WHERE tenant_id = $1`,
        [t.tenantId]));
    }
    await loadDemoSet(t.tenantId);
    const full = await refusal(() => h.service.load(params));
    assert.deepEqual([...full.getResponse().tables].sort(), [
      'app_instances', 'applications', 'companies', 'connections', 'contracts', 'departments', 'documents', 'interfaces',
      'portfolio_projects', 'spend_items', 'suppliers', 'tasks', 'users',
    ]);

    // The system tenant; nothing to reset.
    await dataSource.query(`UPDATE tenants SET is_system_tenant = true WHERE id = $1`, [other.tenantId]);
    const system = await refusal(() => h.service.load({ tenantId: other.tenantId, actorId: other.ownerId, host: hostOf(other) }));
    assert.ok(system instanceof BadRequestException);
    assert.ok((await refusal(() => h.service.getStatus(other.tenantId))) instanceof BadRequestException);
    await dataSource.query(`UPDATE tenants SET is_system_tenant = false WHERE id = $1`, [other.tenantId]);
    const nothing = await refusal(() => h.service.reset({ tenantId: other.tenantId, actorId: other.ownerId }));
    assert.equal(codeOf(nothing), 'demo_status_conflict');
    assert.equal(nothing.getResponse().status, 'idle');
    assert.equal(codeOf(await refusal(() => h.service.reset({ tenantId: other.tenantId, actorId: randomUUID() }))), 'administrator_required');

    assert.equal(h.spawns.length, 0, 'no loader started');
    assert.equal((await demoOf(other.tenantId)).status, 'idle');
  } finally {
    await h.finishAll();
    await cleanupTenants(tenants.map((t) => t.tenantId));
  }
}

// The reset an administrator asks for: `resetting` while the reset runs, then `idle` with the
// tenant back to its starting state and the banner choice kept. A failed reset changes nothing
// and puts the status back.
async function testManualReset() {
  const svc = buildServices();
  const h = harness(svc);
  const failing = harness(svc, { failReset: true });
  let t: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'dd-reset', orgName: 'Reset Org' });
    const initial = await countTenantRows(t.tenantId);
    await loadDemoSet(t.tenantId);
    const loadedState = { status: 'loaded', run_id: randomUUID(), loaded_at: '2026-10-07T10:00:00.000Z', loaded_by: t.ownerId, dismissed_at: '2026-10-07T11:00:00.000Z' };
    await setDemo(t.tenantId, loadedState);

    const error = await refusal(() => failing.service.reset({ tenantId: t!.tenantId, actorId: t!.ownerId }));
    assert.match(String(error?.message), /injected reset failure/);
    assert.deepEqual(failing.resetCalls.map((call) => call.status), ['resetting']);
    const restored = await demoOf(t.tenantId);
    assert.equal(restored.status, 'loaded', 'the status is put back');
    assert.equal(restored.run_id, loadedState.run_id);
    assert.equal(restored.loaded_at, loadedState.loaded_at);

    const done = await h.service.reset({ tenantId: t.tenantId, actorId: t.ownerId });
    assert.equal(done.status, 'idle');
    assert.deepEqual(h.resetCalls.map((call) => call.status), ['resetting']);
    const idle = await demoOf(t.tenantId);
    assert.deepEqual({ ...idle }, {
      status: 'idle', step: null, started_at: null, heartbeat_at: null, loaded_at: null, loaded_by: null,
      failed_at: null, error_code: null, dismissed_at: '2026-10-07T11:00:00.000Z', run_id: null,
    });
    assert.deepEqual(countDifferences(initial, await countTenantRows(t.tenantId), ['audit_log']), []);
    // Ready for a new load.
    await h.service.load({ tenantId: t.tenantId, actorId: t.ownerId, host: hostOf(t) });
    h.spawns[0].child.finish(0);
    await settle();
    assert.equal((await demoOf(t.tenantId)).status, 'loaded');
  } finally {
    await h.finishAll();
    await failing.finishAll();
    await cleanupTenants([t?.tenantId]);
  }
}

runSpecs('demo-data.service.integration.spec', [
  testLoadRunsTheLoader,
  testFailedLoadIsReset,
  testDoubleClick,
  testGlobalCap,
  testReconciliation,
  testTimeoutAndStop,
  testRefusals,
  testManualReset,
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
