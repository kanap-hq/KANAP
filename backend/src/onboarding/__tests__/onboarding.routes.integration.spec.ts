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
import { useRequestPipeline } from '../../common/request-pipeline';
import { createRequestTenancyMiddleware } from '../../common/tenancy/request-tenancy.middleware';
import { DemoDataService } from '../../demo-data/demo-data.service';
import { buildDemoData } from './onboarding-test-helpers';
import { OnboardingController } from '../onboarding.controller';
import { ONBOARDING_PATHS } from '../onboarding-paths';
import { OnboardingService } from '../onboarding.service';

// The onboarding routes (`/onboarding`) over HTTP: the real controller behind JwtAuthGuard on
// signed access tokens, the tenancy middleware and the request pipeline main.ts installs (the
// request transaction carries the tenant), the real OnboardingService on the spec database
// (the effects of the mode on the sample data: `onboarding-own-data.integration.spec.ts`; here
// the loader is a double that never ends by itself).
// - a new workspace has no choice, no steps, sample data `idle`, and anybody may choose;
// - any user sets the angle or the mode while it is empty; changing a value already set takes
//   an administrator (403 `administrator_required`); invalid input is a 400;
// - the steps belong to each user and to the current path; the audit log gets `angle_chosen`,
//   `mode_chosen`, `step_done` and one `completed` per user, angle and mode;
// - `sample_data` mirrors `tenants.metadata.demo`; hiding the list is per user;
// - a member may set a field still missing; the Administrator role counts as an additional role;
// - another workspace sees nothing; eight first choices at once give one event each; two last
//   steps at once give one `completed`; a deleted user's rows go with them.
// @database-spec: opens the data-source and boots Nest, so run-ci-tests.js runs it on a database lane.

type Served = { app: INestApplication; port: number; close: () => Promise<void> };

async function serve(): Promise<Served> {
  const demo = buildDemoData(buildServices());
  @Module({
    controllers: [OnboardingController],
    providers: [
      ListContextsService,
      OnboardingService,
      { provide: DataSource, useValue: dataSource },
      { provide: DemoDataService, useValue: demo.service },
    ],
  })
  class OnboardingProbeModule {}

  const app = await NestFactory.create(OnboardingProbeModule, { logger: false });
  app.use(createRequestTenancyMiddleware({
    query: (sql, params) => dataSource.query(sql, params),
    singleTenant: false,
    defaultTenantSlug: 'default',
    platformAdminHost: 'platform.onboarding-spec.test',
    marketingRedirectUrl: 'https://www.kanap.test',
  }));
  useRequestPipeline(app, dataSource);
  await app.listen(0, '127.0.0.1');
  const port = (app.getHttpServer().address() as AddressInfo).port;
  const close = async () => {
    // A load an administrator's `example` started: ended, and its state written, before cleanup.
    for (const { child } of demo.children) child.finish(0);
    assert.equal(await waitForBackgroundWork(Date.now() + 60_000), 0, 'the background work ended');
    await app.close();
  };
  return { app, port, close };
}

type Method = 'GET' | 'PUT' | 'POST' | 'DELETE';

function call(served: Served, opts: { method: Method; path: string; host: string; token?: string; body?: unknown }) {
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

/** A Portfolio Member of the workspace (not an administrator), with a token. */
async function member(svc: Services, t: ActivatedTenant): Promise<{ id: string; token: string }> {
  const id = await addRealUser(svc, t.tenantId);
  const [row] = await inTenant(t.tenantId, (m) => m.query(`SELECT email FROM users WHERE tenant_id = $1 AND id = $2`, [t.tenantId, id]));
  return { id, token: tokenFor({ id, email: row.email, tenant_id: t.tenantId }) };
}

/** The routes of one workspace, as one user. */
function client(served: Served, t: ActivatedTenant, token = ownerToken(t)) {
  const host = hostOf(t);
  const run = (method: Method, path: string, body?: unknown) => call(served, { method, path: `/onboarding${path}`, host, token, body });
  return {
    get: () => run('GET', ''),
    choose: (body: unknown) => run('PUT', '/choice', body),
    done: (key: string) => run('POST', `/steps/${encodeURIComponent(key)}/done`),
    undo: (key: string) => run('DELETE', `/steps/${encodeURIComponent(key)}/done`),
    dismiss: () => run('POST', '/dismiss'),
    undismiss: () => run('DELETE', '/dismiss'),
  };
}

function ok(res: { status: number; body: any }, label: string) {
  assert.equal(res.status, 200, `${label}: ${JSON.stringify(res.body)}`);
  return res.body;
}

function refused(res: { status: number; body: any }, status: number, code: string, label: string) {
  assert.equal(res.status, status, `${label}: ${JSON.stringify(res.body)}`);
  assert.equal(res.body?.code, code, label);
}

type Event = { action: string; after: any; user_id: string; record_id: string; source: string; parent_table: string | null; parent_id: string | null };

async function events(tenantId: string, action?: string): Promise<Event[]> {
  return inTenant(tenantId, (m) => m.query(
    `SELECT action, after_json AS after, user_id, record_id, source, parent_table, parent_id
       FROM audit_log
      WHERE tenant_id = $1 AND table_name = 'onboarding' AND ($2::text IS NULL OR action = $2)
      ORDER BY created_at, id`,
    [tenantId, action ?? null],
  ));
}

async function choiceRow(tenantId: string) {
  const [row] = await inTenant(tenantId, (m) => m.query(
    `SELECT angle, mode, chosen_at, chosen_by FROM tenant_onboarding WHERE tenant_id = $1`, [tenantId]));
  return row ?? null;
}

async function setDemo(tenantId: string, demo: unknown) {
  await dataSource.query(
    `UPDATE tenants SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('demo', $2::jsonb) WHERE id = $1`,
    [tenantId, JSON.stringify(demo)],
  );
}

// 1. A new workspace: nothing chosen, nothing done, anybody may choose; no token, no answer.
async function testFreshWorkspace() {
  const svc = buildServices();
  const served = await serve();
  let t: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'onb-new', orgName: 'Onboarding New' });
    const asMember = await member(svc, t);
    for (const [label, token] of [['owner', ownerToken(t)], ['member', asMember.token]] as const) {
      const state = ok(await client(served, t, token).get(), `GET as ${label}`);
      assert.deepEqual(state, {
        angle: null,
        mode: null,
        chosen_at: null,
        can_choose: true,
        steps: [],
        next_step: null,
        completed: false,
        dismissed_at: null,
        sample_data: { status: 'idle', step: null, error_code: null },
        reset_in_progress: false,
      }, label);
    }
    const anonymous = await call(served, { method: 'GET', path: '/onboarding', host: hostOf(t) });
    assert.equal(anonymous.status, 401, 'no token');
    assert.equal(await choiceRow(t.tenantId), null, 'a read writes nothing');
  } finally {
    await served.close();
    await cleanupTenants([t?.tenantId]);
  }
}

// 2 and 3. The first answer, by anybody; a change, by an administrator only; the same value,
// nothing at all.
async function testChoice() {
  const svc = buildServices();
  const served = await serve();
  let t: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'onb-choice', orgName: 'Onboarding Choice' });
    const a = await member(svc, t);
    const asMember = client(served, t, a.token);
    const asOwner = client(served, t);

    const first = ok(await asMember.choose({ angle: 'budget', mode: 'example' }), 'first choice by a member');
    assert.equal(first.angle, 'budget');
    assert.equal(first.mode, 'example');
    assert.ok(first.chosen_at, 'chosen_at set');
    assert.equal(first.can_choose, false, 'the member may no longer choose');
    assert.deepEqual(first.steps.map((s: any) => s.key), ONBOARDING_PATHS.budget.example);
    assert.ok(first.steps.every((s: any) => s.done_at === null));
    assert.equal(first.next_step, 'budget_overview');
    const row = await choiceRow(t.tenantId);
    assert.equal(row.angle, 'budget');
    assert.equal(row.mode, 'example');
    assert.equal(row.chosen_by, a.id);
    let logged = await events(t.tenantId);
    assert.deepEqual(logged.map((e) => [e.action, e.after]), [
      ['onboarding.angle_chosen', { angle: 'budget', previous: null }],
      ['onboarding.mode_chosen', { mode: 'example', previous: null }],
    ]);
    for (const e of logged) {
      assert.equal(e.user_id, a.id);
      assert.equal(e.record_id, t.tenantId);
      assert.equal(e.source, 'user');
      assert.equal(e.parent_table, null, 'no parent rule for the onboarding label');
      assert.equal(e.parent_id, null);
    }
    assert.equal(ok(await asOwner.get(), 'owner GET').can_choose, true, 'an administrator may always choose');

    // A change by the member: refused, nothing written.
    refused(await asMember.choose({ angle: 'portfolio' }), 403, 'administrator_required', 'member changes the angle');
    refused(await asMember.choose({ mode: 'own_data' }), 403, 'administrator_required', 'member changes the mode');
    refused(await asMember.choose({ angle: 'budget', mode: 'own_data' }), 403, 'administrator_required', 'member: same angle, other mode');
    assert.deepEqual(await choiceRow(t.tenantId), row, 'nothing written');
    // The same values: no write, no event, for anybody.
    ok(await asMember.choose({ angle: 'budget', mode: 'example' }), 'member repeats the choice');
    ok(await asOwner.choose({ angle: 'budget' }), 'owner repeats the angle');
    assert.deepEqual(await choiceRow(t.tenantId), row, 'nothing written for the same values');
    assert.equal((await events(t.tenantId)).length, 2, 'no event for the same values');

    // A change by the administrator: one event, with the previous value.
    const changed = ok(await asOwner.choose({ angle: 'portfolio' }), 'owner changes the angle');
    assert.equal(changed.angle, 'portfolio');
    assert.equal(changed.mode, 'example', 'a field left out keeps its value');
    assert.equal(changed.can_choose, true);
    assert.deepEqual(changed.steps.map((s: any) => s.key), ONBOARDING_PATHS.portfolio.example);
    logged = await events(t.tenantId);
    assert.equal(logged.length, 3);
    assert.deepEqual([logged[2].action, logged[2].after, logged[2].user_id], ['onboarding.angle_chosen', { angle: 'portfolio', previous: 'budget' }, t.ownerId]);
    assert.equal((await choiceRow(t.tenantId)).chosen_by, t.ownerId);
    ok(await asOwner.choose({ angle: 'portfolio' }), 'owner repeats the new angle');
    assert.equal((await events(t.tenantId)).length, 3, 'no event for the same value');

    // Field by field: the first who answers the mode sets it, even after another set the angle.
    const other = await createActivatedTenant(svc, { tag: 'onb-choice2', orgName: 'Onboarding Choice Two' });
    try {
      const b = await member(svc, other);
      const c = await member(svc, other);
      ok(await client(served, other, b.token).choose({ angle: 'cartography' }), 'member B sets the angle');
      const later = ok(await client(served, other, c.token).choose({ mode: 'own_data' }), 'member C sets the mode');
      assert.equal(later.angle, 'cartography');
      assert.equal(later.mode, 'own_data');
      assert.deepEqual(later.steps.map((s: any) => s.key), ONBOARDING_PATHS.cartography.own_data);
      refused(await client(served, other, c.token).choose({ angle: 'budget' }), 403, 'administrator_required', 'member C changes the angle');
      assert.deepEqual((await events(other.tenantId)).map((e) => [e.action, e.after, e.user_id]), [
        ['onboarding.angle_chosen', { angle: 'cartography', previous: null }, b.id],
        ['onboarding.mode_chosen', { mode: 'own_data', previous: null }, c.id],
      ]);
    } finally {
      await cleanupTenants([other.tenantId]);
    }
  } finally {
    await served.close();
    await cleanupTenants([t?.tenantId]);
  }
}

// 4. Invalid input: a 400, nothing written.
async function testInvalidChoice() {
  const svc = buildServices();
  const served = await serve();
  let t: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'onb-invalid', orgName: 'Onboarding Invalid' });
    const asOwner = client(served, t);
    const cases: Array<[unknown, string]> = [
      [{}, 'choice_required'],
      [[], 'choice_required'],
      [{ other: 'budget' }, 'choice_required'],
      [{ angle: 'finance' }, 'invalid_angle'],
      [{ angle: null }, 'invalid_angle'],
      [{ angle: 3 }, 'invalid_angle'],
      [{ mode: 'demo' }, 'invalid_mode'],
      [{ mode: null }, 'invalid_mode'],
      [{ angle: 'budget', mode: 'nope' }, 'invalid_mode'],
      [{ angle: 'Budget', mode: 'example' }, 'invalid_angle'],
    ];
    for (const [body, code] of cases) {
      refused(await asOwner.choose(body), 400, code, `PUT ${JSON.stringify(body)}`);
    }
    const noBody = await call(served, { method: 'PUT', path: '/onboarding/choice', host: hostOf(t), token: ownerToken(t) });
    refused(noBody, 400, 'choice_required', 'PUT without a body');
    assert.equal(await choiceRow(t.tenantId), null, 'nothing written');
    assert.equal((await events(t.tenantId)).length, 0, 'no event');
  } finally {
    await served.close();
    await cleanupTenants([t?.tenantId]);
  }
}

// 5. Steps: per user and per path, logged once each time one becomes done, `completed` once.
async function testSteps() {
  const svc = buildServices();
  const served = await serve();
  let t: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'onb-steps', orgName: 'Onboarding Steps' });
    const a = await member(svc, t);
    const asOwner = client(served, t);
    const asMember = client(served, t, a.token);
    const path = ONBOARDING_PATHS.budget.example;

    refused(await asOwner.done('budget_overview'), 409, 'no_choice', 'done without a choice');
    refused(await asOwner.undo('budget_overview'), 409, 'no_choice', 'undo without a choice');
    ok(await asOwner.choose({ angle: 'budget' }), 'angle only');
    refused(await asOwner.done('budget_overview'), 409, 'no_choice', 'done without a mode');
    ok(await asOwner.choose({ mode: 'example' }), 'mode');
    refused(await asOwner.done('map_overview'), 400, 'unknown_step', 'a step of another path');
    refused(await asOwner.done('nothing'), 400, 'unknown_step', 'an unknown step');
    refused(await asOwner.undo('own_company'), 400, 'unknown_step', 'undo a step of another path');

    const once = ok(await asOwner.done('budget_overview'), 'first step');
    assert.ok(once.steps[0].done_at, 'done_at set');
    assert.equal(once.next_step, 'budget_line');
    assert.equal(once.completed, false);
    const twice = ok(await asOwner.done('budget_overview'), 'first step again');
    assert.equal(twice.steps[0].done_at, once.steps[0].done_at, 'kept as it was');
    const [count] = await inTenant(t.tenantId, (m) => m.query(
      `SELECT count(*)::int AS n FROM onboarding_steps WHERE tenant_id = $1 AND user_id = $2`, [t!.tenantId, t!.ownerId]));
    assert.equal(count.n, 1, 'one row');
    let done = await events(t.tenantId, 'onboarding.step_done');
    assert.deepEqual(done.map((e) => [e.after, e.user_id]), [[{ angle: 'budget', mode: 'example', step_key: 'budget_overview' }, t.ownerId]]);

    // The member has done nothing.
    const theirs = ok(await asMember.get(), 'member GET');
    assert.ok(theirs.steps.every((s: any) => s.done_at === null), 'steps are per user');
    assert.equal(theirs.next_step, 'budget_overview');

    // Undo: the row goes, no event; undoing again changes nothing.
    const undone = ok(await asOwner.undo('budget_overview'), 'undo');
    assert.equal(undone.steps[0].done_at, null);
    assert.equal(undone.next_step, 'budget_overview');
    ok(await asOwner.undo('budget_overview'), 'undo again');
    assert.equal((await events(t.tenantId, 'onboarding.step_done')).length, 1, 'nothing logged for an undo');

    // All five: completed, once.
    let state: any;
    for (const key of path) state = ok(await asOwner.done(key), `done ${key}`);
    assert.equal(state.completed, true);
    assert.equal(state.next_step, null);
    assert.ok(state.steps.every((s: any) => s.done_at));
    done = await events(t.tenantId, 'onboarding.step_done');
    assert.equal(done.length, 6, 'budget_overview counted again: it became done again');
    let completed = await events(t.tenantId, 'onboarding.completed');
    assert.deepEqual(completed.map((e) => [e.after, e.user_id]), [[{ angle: 'budget', mode: 'example' }, t.ownerId]]);

    // Undo and redo the last step: no second `completed`.
    assert.equal(ok(await asOwner.undo('budget_import'), 'undo the last').completed, false);
    assert.equal(ok(await asOwner.done('budget_import'), 'redo the last').completed, true);
    completed = await events(t.tenantId, 'onboarding.completed');
    assert.equal(completed.length, 1, 'one completed per user, angle and mode');

    // Another path starts empty; the steps of the first are kept for it.
    const ownData = ok(await asOwner.choose({ mode: 'own_data' }), 'owner switches to own data');
    assert.deepEqual(ownData.steps.map((s: any) => s.key), ONBOARDING_PATHS.budget.own_data);
    assert.equal(ownData.completed, false);
    assert.equal(ownData.next_step, 'own_company');
    assert.equal(ok(await asOwner.choose({ mode: 'example' }), 'back to example').completed, true);

    // The member completes too: their own `completed`.
    for (const key of path) state = ok(await asMember.done(key), `member done ${key}`);
    assert.equal(state.completed, true);
    completed = await events(t.tenantId, 'onboarding.completed');
    assert.deepEqual(completed.map((e) => e.user_id), [t.ownerId, a.id]);
  } finally {
    await served.close();
    await cleanupTenants([t?.tenantId]);
  }
}

// 6. `sample_data` mirrors `tenants.metadata.demo` (status, step, and the error code of a failure), for any user.
async function testSampleData() {
  const svc = buildServices();
  const served = await serve();
  let t: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'onb-demo', orgName: 'Onboarding Demo' });
    const a = await member(svc, t);
    const asMember = client(served, t, a.token);
    await setDemo(t.tenantId, { status: 'loading', step: 'budget-lines', run_id: 'r1' });
    let state = ok(await asMember.get(), 'loading');
    assert.deepEqual(state.sample_data, { status: 'loading', step: 'budget-lines', error_code: null });
    assert.equal(state.reset_in_progress, false);
    await setDemo(t.tenantId, { status: 'resetting' });
    state = ok(await asMember.get(), 'resetting');
    assert.deepEqual(state.sample_data, { status: 'resetting', step: null, error_code: null });
    assert.equal(state.reset_in_progress, true);
    await setDemo(t.tenantId, { status: 'loaded' });
    assert.deepEqual(ok(await asMember.get(), 'loaded').sample_data, { status: 'loaded', step: null, error_code: null });
    await setDemo(t.tenantId, { status: 'failed', error_code: 'reset_failed' });
    assert.deepEqual(ok(await asMember.get(), 'failed').sample_data, { status: 'failed', step: null, error_code: 'reset_failed' });
    await setDemo(t.tenantId, { status: 'idle', error_code: 'reset_failed' });
    assert.deepEqual(ok(await asMember.get(), 'idle with a stale code').sample_data, { status: 'idle', step: null, error_code: null });
    await setDemo(t.tenantId, { status: 'whatever', step: 4 });
    assert.deepEqual(ok(await asMember.get(), 'malformed').sample_data, { status: 'idle', step: null, error_code: null });
    await setDemo(t.tenantId, 'not an object');
    assert.deepEqual(ok(await asMember.get(), 'not an object').sample_data, { status: 'idle', step: null, error_code: null });
  } finally {
    await served.close();
    await cleanupTenants([t?.tenantId]);
  }
}

// 7. Hiding the list: per user, idempotent both ways.
async function testDismiss() {
  const svc = buildServices();
  const served = await serve();
  let t: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'onb-hide', orgName: 'Onboarding Hide' });
    const a = await member(svc, t);
    const asOwner = client(served, t);
    const hidden = ok(await asOwner.dismiss(), 'dismiss');
    assert.ok(hidden.dismissed_at, 'dismissed_at set');
    assert.equal(ok(await asOwner.dismiss(), 'dismiss again').dismissed_at, hidden.dismissed_at, 'kept as it was');
    assert.equal(ok(await client(served, t, a.token).get(), 'member GET').dismissed_at, null, 'per user');
    assert.equal(ok(await asOwner.undismiss(), 'show again').dismissed_at, null);
    assert.equal(ok(await asOwner.undismiss(), 'show again twice').dismissed_at, null);
    assert.equal((await events(t.tenantId)).length, 0, 'nothing logged');
  } finally {
    await served.close();
    await cleanupTenants([t?.tenantId]);
  }
}

// 8. Another workspace sees nothing of the first, over HTTP and under its own tenant in SQL.
async function testIsolation() {
  const svc = buildServices();
  const served = await serve();
  let t: ActivatedTenant | undefined;
  let other: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'onb-iso', orgName: 'Onboarding Iso' });
    other = await createActivatedTenant(svc, { tag: 'onb-iso2', orgName: 'Onboarding Iso Two' });
    const asOwner = client(served, t);
    ok(await asOwner.choose({ angle: 'budget', mode: 'example' }), 'choice');
    ok(await asOwner.done('budget_overview'), 'step');
    ok(await asOwner.dismiss(), 'dismiss');

    const theirs = ok(await client(served, other).get(), 'other workspace GET');
    assert.equal(theirs.angle, null);
    assert.equal(theirs.mode, null);
    assert.deepEqual(theirs.steps, []);
    assert.equal(theirs.dismissed_at, null);
    const foreign = await call(served, { method: 'GET', path: '/onboarding', host: hostOf(t), token: ownerToken(other) });
    assert.equal(foreign.status, 401, 'a token of another workspace');

    const counts = (tenantId: string) => inTenant(tenantId, async (m) => {
      const [row] = await m.query(
        `SELECT (SELECT count(*)::int FROM tenant_onboarding) AS choices,
                (SELECT count(*)::int FROM onboarding_steps) AS steps,
                (SELECT count(*)::int FROM onboarding_dismissals) AS dismissals`,
      );
      return row;
    });
    assert.deepEqual(await counts(t.tenantId), { choices: 1, steps: 1, dismissals: 1 });
    assert.deepEqual(await counts(other.tenantId), { choices: 0, steps: 0, dismissals: 0 }, 'RLS hides the first workspace');
    // A write naming the other tenant is refused by the policy.
    await assert.rejects(
      inTenant(other.tenantId, (m) => m.query(`INSERT INTO onboarding_dismissals (tenant_id, user_id) VALUES ($1, $2)`, [t!.tenantId, t!.ownerId])),
      /row-level security/,
    );
  } finally {
    await served.close();
    await cleanupTenants([t?.tenantId, other?.tenantId]);
  }
}

// 9. Eight first choices at the same time, by eight users, with the same value: all answer 200,
// one event per field, written by the first who answered.
async function testConcurrentFirstChoice() {
  const svc = buildServices();
  const served = await serve();
  let t: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'onb-race', orgName: 'Onboarding Race' });
    const tokens = [ownerToken(t)];
    for (let i = 0; i < 7; i += 1) tokens.push((await member(svc, t)).token);
    const body = { angle: 'cartography', mode: 'example' };
    const answers = await Promise.all(tokens.map((token) => client(served, t!, token).choose(body)));
    answers.forEach((res, i) => {
      const state = ok(res, `concurrent choice ${i}`);
      assert.equal(state.angle, 'cartography');
      assert.equal(state.mode, 'example');
    });
    const logged = await events(t.tenantId);
    assert.deepEqual(logged.map((e) => [e.action, e.after]), [
      ['onboarding.angle_chosen', { angle: 'cartography', previous: null }],
      ['onboarding.mode_chosen', { mode: 'example', previous: null }],
    ]);
    assert.equal(logged[0].user_id, logged[1].user_id, 'both by the first who answered');
    assert.equal((await choiceRow(t.tenantId)).chosen_by, logged[0].user_id);
  } finally {
    await served.close();
    await cleanupTenants([t?.tenantId]);
  }
}

// 10. The two last steps posted at the same time by one user: both 200, one `completed`.
async function testConcurrentLastSteps() {
  const svc = buildServices();
  const served = await serve();
  let t: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'onb-last', orgName: 'Onboarding Last' });
    const asOwner = client(served, t);
    const path = ONBOARDING_PATHS.budget.example;
    ok(await asOwner.choose({ angle: 'budget', mode: 'example' }), 'choice');
    for (const key of path.slice(0, 3)) ok(await asOwner.done(key), `done ${key}`);
    const answers = await Promise.all(path.slice(3).map((key) => asOwner.done(key)));
    answers.forEach((res, i) => ok(res, `last step ${i}`));
    const state = ok(await asOwner.get(), 'GET after');
    assert.equal(state.completed, true);
    assert.equal((await events(t.tenantId, 'onboarding.step_done')).length, 5);
    const completed = await events(t.tenantId, 'onboarding.completed');
    assert.deepEqual(completed.map((e) => [e.after, e.user_id]), [[{ angle: 'budget', mode: 'example' }, t.ownerId]]);
  } finally {
    await served.close();
    await cleanupTenants([t?.tenantId]);
  }
}

// 11. The angle set alone by the administrator: a member may set the missing mode, not change
// the angle.
async function testMemberCompletesTheChoice() {
  const svc = buildServices();
  const served = await serve();
  let t: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'onb-fill', orgName: 'Onboarding Fill' });
    const a = await member(svc, t);
    const asMember = client(served, t, a.token);
    ok(await client(served, t).choose({ angle: 'portfolio' }), 'owner sets the angle');
    assert.equal(ok(await asMember.get(), 'member GET').can_choose, true, 'the mode is missing');
    refused(await asMember.choose({ angle: 'budget' }), 403, 'administrator_required', 'member changes the angle, mode missing');
    refused(await asMember.choose({ angle: 'budget', mode: 'example' }), 403, 'administrator_required', 'member changes the angle with the mode');
    assert.equal((await choiceRow(t.tenantId)).mode, null, 'nothing written');
    const filled = ok(await asMember.choose({ mode: 'own_data' }), 'member sets the mode');
    assert.equal(filled.angle, 'portfolio');
    assert.equal(filled.mode, 'own_data');
    assert.equal(filled.can_choose, false, 'both set');
    refused(await asMember.choose({ angle: 'budget' }), 403, 'administrator_required', 'member changes the angle, both set');
    assert.deepEqual((await events(t.tenantId)).map((e) => [e.action, e.user_id]), [
      ['onboarding.angle_chosen', t.ownerId],
      ['onboarding.mode_chosen', a.id],
    ]);
  } finally {
    await served.close();
    await cleanupTenants([t?.tenantId]);
  }
}

// 12. The Administrator role as an additional role (`user_roles`) counts.
async function testAdditionalAdministrator() {
  const svc = buildServices();
  const served = await serve();
  let t: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'onb-extra', orgName: 'Onboarding Extra' });
    const a = await member(svc, t);
    const asMember = client(served, t, a.token);
    ok(await client(served, t).choose({ angle: 'budget', mode: 'example' }), 'owner chooses');
    refused(await asMember.choose({ angle: 'cartography' }), 403, 'administrator_required', 'before the extra role');
    await inTenant(t.tenantId, (m) => m.query(
      `INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary)
       SELECT $1, $2, r.id, false FROM roles r WHERE r.tenant_id = $1 AND lower(r.role_name) = 'administrator'`,
      [t!.tenantId, a.id],
    ));
    const [main] = await inTenant(t.tenantId, (m) => m.query(
      `SELECT r.role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.tenant_id = $1 AND u.id = $2`, [t!.tenantId, a.id]));
    assert.notEqual(main.role_name.toLowerCase(), 'administrator', 'the main role is not Administrator');
    assert.equal(ok(await asMember.get(), 'member GET').can_choose, true);
    const changed = ok(await asMember.choose({ angle: 'cartography' }), 'member with the extra role changes the angle');
    assert.equal(changed.angle, 'cartography');
    const last = (await events(t.tenantId)).pop()!;
    assert.deepEqual([last.action, last.after, last.user_id], ['onboarding.angle_chosen', { angle: 'cartography', previous: 'budget' }, a.id]);
  } finally {
    await served.close();
    await cleanupTenants([t?.tenantId]);
  }
}

// 13. A deleted user's steps and dismissal go with them; the others stay.
async function testUserDeleted() {
  const svc = buildServices();
  const served = await serve();
  let t: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'onb-gone', orgName: 'Onboarding Gone' });
    const a = await member(svc, t);
    const b = await member(svc, t);
    ok(await client(served, t).choose({ angle: 'budget', mode: 'example' }), 'choice');
    for (const user of [a, b]) {
      const asUser = client(served, t, user.token);
      ok(await asUser.done('budget_overview'), 'step one');
      ok(await asUser.done('budget_line'), 'step two');
      ok(await asUser.dismiss(), 'dismiss');
    }
    const counts = (userId: string) => inTenant(t!.tenantId, async (m) => {
      const [row] = await m.query(
        `SELECT (SELECT count(*)::int FROM onboarding_steps WHERE tenant_id = $1 AND user_id = $2) AS steps,
                (SELECT count(*)::int FROM onboarding_dismissals WHERE tenant_id = $1 AND user_id = $2) AS dismissals`,
        [t!.tenantId, userId],
      );
      return row;
    });
    assert.deepEqual(await counts(a.id), { steps: 2, dismissals: 1 });
    await inTenant(t.tenantId, (m) => m.query(`DELETE FROM users WHERE tenant_id = $1 AND id = $2`, [t!.tenantId, a.id]));
    assert.deepEqual(await counts(a.id), { steps: 0, dismissals: 0 }, 'the deleted user\'s rows are gone');
    assert.deepEqual(await counts(b.id), { steps: 2, dismissals: 1 }, 'the other user\'s rows stay');
    assert.ok(await choiceRow(t.tenantId), 'the workspace choice stays');
  } finally {
    await served.close();
    await cleanupTenants([t?.tenantId]);
  }
}

runSpecs('onboarding.routes.integration.spec', [
  testFreshWorkspace,
  testChoice,
  testInvalidChoice,
  testSteps,
  testSampleData,
  testDismiss,
  testIsolation,
  testConcurrentFirstChoice,
  testConcurrentLastSteps,
  testMemberCompletesTheChoice,
  testAdditionalAdministrator,
  testUserDeleted,
]).catch((error) => {
  console.error(error);
  process.exit(1);
});
