// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import {
  BadRequestException,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  INestApplication,
  Injectable,
  Module,
  Post,
  Req,
} from '@nestjs/common';
import { HttpAdapterHost, NestFactory, Reflector } from '@nestjs/core';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import appDataSource from '../../data-source';
import { TenantInitGuard } from '../../common/tenant-init.guard';
import { TenantInterceptor } from '../../common/tenant.interceptor';
import { ReleaseTenantRunnerFilter } from '../../common/filters/release-tenant-runner.filter';
import { createRequestReleaseConnection } from '../../common/import-connection';
import { AiTenantExecutionService } from '../../ai/execution/ai-tenant-execution.service';
import { AiExecutionContext } from '../../ai/ai.types';
import { KnowledgeService } from '../../knowledge/knowledge.service';
import { PortfolioAttachmentsService } from '../../portfolio/services/portfolio-attachments.service';
import { DataAccessTransactionRequiredError } from '../data-access';
import {
  APP_URL,
  LIMITED_ROLE,
  PgClient,
  appRoleName,
  connect,
  roleExists,
  seedNodes,
  seedPerson,
  seedRole,
  seedTree,
} from './data-access-test-helpers';

/**
 * Data-scoped access, lot 1 run B (planning/data-scoped-access/spec.md §6.3, §10.5): every call
 * point of `data_access_apply` applies the person's access to the transaction that serves them,
 * and to nothing else. Asserted from inside the served code path: `current_user` and
 * `app.da_mode` (limited person → kanap_data_limited / limited; unscoped person and Administrator
 * → the application role / nothing).
 *
 * - TenantInterceptor, on its own runner and on the one TenantInitGuard opened;
 * - the reconnection of a request (createRequestReleaseConnection);
 * - AiTenantExecutionService.runWithContext, with and without a person, and the refusal of
 *   `transaction: false` for a limited person;
 * - a public inline-attachment route (the session cookie names the person);
 * - the refusals: KDA01 → 503 DATA_ACCESS_UNAVAILABLE without the database's text, KDA02 → 401
 *   INVALID_TOKEN;
 * - after a request (commit and rollback), the pooled connection carries neither the role nor the
 *   settings: the API under test has a pool of one connection, reused by the next query.
 *
 * Without the role (a dev database before the script) a limited person is refused with 503; the
 * scenarios that need the role are skipped. In CI a missing role fails.
 */

const APP_ROLE = appRoleName();
const REFRESH_TOKEN = `da-call-points-${randomUUID()}`;

type Who = { user: string; mode: string; pid: number };
type Seed = { tenantId: string; unscoped: string; admin: string; limited: string };

const WHO_SQL = `SELECT current_user AS "user", coalesce(current_setting('app.da_mode', true), '') AS mode, pg_backend_pid() AS pid`;

async function who(target: EntityManager | QueryRunner | DataSource): Promise<Who> {
  const rows = await target.query(WHO_SQL);
  return { user: rows[0].user, mode: rows[0].mode, pid: Number(rows[0].pid) };
}

// One connection for the whole API under test: the next query reuses the connection a request
// gave back.
const dataSource = new DataSource({ ...(appDataSource.options as any), poolSize: 1 });
let seed: Seed;
let hasRole = false;

@Controller('da-probe')
class ProbeController {
  @Get('who')
  async who(@Req() req: any) {
    return who(req.queryRunner);
  }

  @Get('who-foreign')
  async whoForeign(@Req() req: any) {
    return { seen: await who(req.queryRunner), dataAccessUserId: req.dataAccessUserId ?? null };
  }

  @Post('fail')
  async fail(@Req() req: any) {
    const seen = await who(req.queryRunner);
    throw new BadRequestException({ message: 'probe failure', seen });
  }

  @Post('reconnect')
  async reconnect(@Req() req: any) {
    const before = await who(req.queryRunner);
    const release = createRequestReleaseConnection(req, dataSource, req.tenant.id);
    const { manager } = await release(async () => undefined);
    const after = await who(manager);
    return { before, after };
  }
}

/** Replaces data_access_expected_policies() in the request's transaction: apply then refuses (KDA01). */
@Injectable()
class BreakAccessGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req: any = context.switchToHttp().getRequest();
    if (req.headers['x-da-break'] && req.queryRunner) {
      // The live function has a fourth column (fingerprint, lot 5): replace it by a DROP then a
      // CREATE, so the return type can change. The request's transaction is rolled back.
      await req.queryRunner.query(`DROP FUNCTION IF EXISTS data_access_expected_policies()`);
      await req.queryRunner.query(`
        CREATE FUNCTION data_access_expected_policies()
        RETURNS TABLE (policy_name text, table_name text, command text)
        LANGUAGE sql STABLE SET search_path = public, pg_temp
        AS $fn$ SELECT 'da_spec_missing_policy'::text, 'companies'::text, 'SELECT'::text $fn$`);
    }
    return true;
  }
}

/** Runners a ForeignRunnerGuard opened: the spec finishes them (the interceptor does not own them). */
const foreignRunners: QueryRunner[] = [];

/**
 * Puts on the request a runner the interceptor does not own (no _tenantRunnerOwner), as
 * import-connection.ts could: `x-da-foreign: tx` opens it in a tenant transaction, `none` without.
 */
@Injectable()
class ForeignRunnerGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req: any = context.switchToHttp().getRequest();
    const mode = req.headers['x-da-foreign'];
    if (mode === 'tx' || mode === 'none') {
      const runner = dataSource.createQueryRunner();
      await runner.connect();
      foreignRunners.push(runner);
      if (mode === 'tx') {
        await runner.startTransaction();
        await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [req.tenant.id]);
      }
      req.queryRunner = runner;
    }
    return true;
  }
}

async function finishForeignRunners(): Promise<void> {
  for (const runner of foreignRunners.splice(0)) {
    if (runner.isReleased) continue;
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

async function createApp(withGuard: boolean, foreignRunner = false): Promise<INestApplication> {
  const app = await NestFactory.create(ProbeModule, { logger: false });
  const reflector = app.get(Reflector);
  app.use((req: any, _res: any, next: () => void) => {
    req.tenant = { id: seed.tenantId, slug: 'da-probe', name: 'Data access probe' };
    const user = req.headers['x-da-user'];
    if (typeof user === 'string' && user) req.user = { sub: user };
    next();
  });
  if (withGuard) app.useGlobalGuards(new TenantInitGuard(dataSource, reflector), new BreakAccessGuard());
  if (foreignRunner) app.useGlobalGuards(new ForeignRunnerGuard());
  app.useGlobalInterceptors(new TenantInterceptor(dataSource, reflector));
  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new ReleaseTenantRunnerFilter(httpAdapter));
  await app.listen(0, '127.0.0.1');
  return app;
}

async function call(app: INestApplication, method: 'GET' | 'POST', path: string, headers: Record<string, string>) {
  const { port } = app.getHttpServer().address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/da-probe/${path}`, { method, headers });
  const text = await res.text();
  return { status: res.status, text, body: text ? JSON.parse(text) : null };
}

function assertLimited(seen: Who, label: string) {
  assert.equal(seen.user, LIMITED_ROLE, `${label}: runs as the limited role`);
  assert.equal(seen.mode, 'limited', `${label}: app.da_mode`);
}

function assertUnscoped(seen: Who, label: string) {
  assert.equal(seen.user, APP_ROLE, `${label}: runs as the application role`);
  assert.equal(seen.mode, '', `${label}: no app.da_mode`);
}

/** The pooled connection, reused: no role, no setting, the same backend as the request. */
async function assertPoolClean(pid: number, label: string) {
  const seen = await who(dataSource);
  assert.equal(seen.pid, pid, `${label}: the next query reuses the request's connection`);
  assertUnscoped(seen, `${label}: pooled connection after the request`);
}

async function testInterceptor(app: INestApplication, label: string) {
  for (const [name, id] of [['unscoped', seed.unscoped], ['administrator', seed.admin]] as const) {
    const res = await call(app, 'GET', 'who', { 'x-da-user': id });
    assert.equal(res.status, 200, `${label} ${name}: ${res.text}`);
    assertUnscoped(res.body, `${label} ${name}`);
  }
  const noUser = await call(app, 'GET', 'who', {});
  assert.equal(noUser.status, 200, `${label} no person: ${noUser.text}`);
  assertUnscoped(noUser.body, `${label} no person`);

  if (!hasRole) {
    const res = await call(app, 'GET', 'who', { 'x-da-user': seed.limited });
    assert.equal(res.status, 503, `${label} limited without the role: ${res.text}`);
    assert.equal(res.body.code, 'DATA_ACCESS_UNAVAILABLE');
    return;
  }

  // Commit path.
  const ok = await call(app, 'GET', 'who', { 'x-da-user': seed.limited });
  assert.equal(ok.status, 200, `${label} limited: ${ok.text}`);
  assertLimited(ok.body, `${label} limited`);
  await assertPoolClean(ok.body.pid, `${label} commit`);

  // Rollback path.
  const failed = await call(app, 'POST', 'fail', { 'x-da-user': seed.limited });
  assert.equal(failed.status, 400, `${label} limited failure: ${failed.text}`);
  assertLimited(failed.body.seen, `${label} limited failure`);
  await assertPoolClean(failed.body.seen.pid, `${label} rollback`);
  console.log(`  ${label}: limited, unscoped, Administrator, no person; pool clean after commit and rollback: OK`);
}

async function testRefusals(app: INestApplication) {
  // KDA02: the session's person is not in the tenant.
  const stranger = await call(app, 'GET', 'who', { 'x-da-user': randomUUID() });
  assert.equal(stranger.status, 401, `unknown person: ${stranger.text}`);
  assert.equal(stranger.body.code, 'INVALID_TOKEN');

  if (!hasRole) return;
  const expectedBefore = (await dataSource.query(`SELECT count(*)::int AS n FROM data_access_expected_policies()`))[0].n;
  // KDA01: an expected policy is missing. The request rolls back, which restores the function.
  const broken = await call(app, 'GET', 'who', { 'x-da-user': seed.limited, 'x-da-break': '1' });
  assert.equal(broken.status, 503, `access unavailable: ${broken.text}`);
  assert.equal(broken.body.code, 'DATA_ACCESS_UNAVAILABLE');
  assert.equal(broken.body.message, 'Data access is temporarily unavailable. Contact the person who runs KANAP.');
  assert.ok(!/KDA01|data access unavailable/.test(broken.text), `no database text in the answer: ${broken.text}`);
  const expected = await dataSource.query(`SELECT count(*)::int AS n FROM data_access_expected_policies()`);
  assert.equal(expected[0].n, expectedBefore, 'the rollback restored data_access_expected_policies()');
  // The pool's connection is clean and the next limited request works again.
  const again = await call(app, 'GET', 'who', { 'x-da-user': seed.limited });
  assert.equal(again.status, 200, again.text);
  await assertPoolClean(again.body.pid, 'after a refusal');
  console.log('  refusals: KDA02 → 401 INVALID_TOKEN, KDA01 → 503 DATA_ACCESS_UNAVAILABLE (rolled back): OK');
}

/**
 * A runner the interceptor does not own: applied when it is in a transaction, refused (500)
 * otherwise; a person is never served without the access.
 */
async function testForeignRunner(app: INestApplication) {
  try {
    const unscoped = await call(app, 'GET', 'who-foreign', { 'x-da-user': seed.unscoped, 'x-da-foreign': 'tx' });
    assert.equal(unscoped.status, 200, unscoped.text);
    assertUnscoped(unscoped.body.seen, 'foreign runner unscoped');
    assert.equal(unscoped.body.dataAccessUserId, seed.unscoped, 'kept on the request for a reconnection');
    await finishForeignRunners();

    const noTx = await call(app, 'GET', 'who-foreign', { 'x-da-user': seed.unscoped, 'x-da-foreign': 'none' });
    assert.equal(noTx.status, 500, `foreign runner without a transaction: ${noTx.text}`);
    await finishForeignRunners();

    const noPerson = await call(app, 'GET', 'who-foreign', { 'x-da-foreign': 'none' });
    assert.equal(noPerson.status, 200, `no person, nothing to apply: ${noPerson.text}`);
    await finishForeignRunners();

    if (!hasRole) return;
    const limited = await call(app, 'GET', 'who-foreign', { 'x-da-user': seed.limited, 'x-da-foreign': 'tx' });
    assert.equal(limited.status, 200, limited.text);
    assertLimited(limited.body.seen, 'foreign runner limited');
    await finishForeignRunners();
    await assertPoolClean(limited.body.seen.pid, 'foreign runner');
    console.log('  interceptor, runner it does not own: applied in a transaction, 500 without: OK');
  } finally {
    await finishForeignRunners();
  }
}

async function testReconnection(app: INestApplication) {
  const unscoped = await call(app, 'POST', 'reconnect', { 'x-da-user': seed.unscoped });
  assert.equal(unscoped.status, 201, unscoped.text);
  assertUnscoped(unscoped.body.before, 'reconnection unscoped, before');
  assertUnscoped(unscoped.body.after, 'reconnection unscoped, after');
  if (!hasRole) return;
  const limited = await call(app, 'POST', 'reconnect', { 'x-da-user': seed.limited });
  assert.equal(limited.status, 201, limited.text);
  assertLimited(limited.body.before, 'reconnection limited, before');
  assertLimited(limited.body.after, 'reconnection limited, after');
  await assertPoolClean(limited.body.after.pid, 'reconnection');
  console.log('  reconnection: the new transaction is limited again for a limited person: OK');
}

function context(userId: string): AiExecutionContext {
  return { tenantId: seed.tenantId, userId, isPlatformHost: false, surface: 'mcp', authMethod: 'api_key' } as AiExecutionContext;
}

async function testRunWithContext() {
  const executor = new AiTenantExecutionService(dataSource);
  const run = (userId: string, opts?: { transaction?: boolean }) =>
    executor.runWithContext(context(userId), (ctx) => who(ctx.manager), opts);

  assertUnscoped(await run(seed.unscoped), 'runWithContext unscoped');
  assertUnscoped(await run(seed.admin), 'runWithContext Administrator');
  assertUnscoped(await run(''), 'runWithContext without a person');
  const unscopedNoTx = await run(seed.unscoped, { transaction: false });
  assertUnscoped(unscopedNoTx, 'runWithContext unscoped, transaction: false');
  assertUnscoped(await run('', { transaction: false }), 'runWithContext without a person, transaction: false');
  await assertPoolClean(unscopedNoTx.pid, 'runWithContext transaction: false');

  if (!hasRole) return;
  const limited = await run(seed.limited);
  assertLimited(limited, 'runWithContext limited');
  await assertPoolClean(limited.pid, 'runWithContext');
  await assert.rejects(
    run(seed.limited, { transaction: false }),
    (error: unknown) => error instanceof DataAccessTransactionRequiredError,
    'transaction: false with a limited person is refused',
  );
  await assertPoolClean(limited.pid, 'runWithContext refused');
  console.log('  runWithContext: applied in its transaction, transaction: false refused for a limited person: OK');
}

/**
 * The projects inline route's service, on the real database: the session cookie names the person,
 * and the SELECT of the attachment runs under that person's access. The probe wraps the runner to
 * read `current_user` just before that SELECT, in the same transaction.
 */
async function testInlineAttachment() {
  const seenAtRead: Who[] = [];
  const probeDataSource = {
    createQueryRunner: () => {
      const runner = dataSource.createQueryRunner();
      const query = runner.query.bind(runner);
      (runner as any).query = async (sql: string, ...rest: any[]) => {
        if (/FROM portfolio_project_attachments/.test(sql)) seenAtRead.push(await who({ query } as any));
        return (query as any)(sql, ...rest);
      };
      return runner;
    },
  };
  const knowledge: any = Object.create(KnowledgeService.prototype);
  knowledge.users = {
    findById: async (id: string) => ({ id, status: 'enabled', role_id: null, role: { role_name: 'Reader' } }),
  };
  knowledge.permissions = { listForRoles: async () => new Map([['portfolio_projects', 'reader']]) };
  const service: any = Object.create(PortfolioAttachmentsService.prototype);
  service.projectRepo = { manager: { connection: probeDataSource } };
  service.knowledge = knowledge;
  const slug = (await dataSource.query(`SELECT slug FROM tenants WHERE id = $1`, [seed.tenantId]))[0].slug;

  // Unknown session: refused as before, the attachment is not read.
  assert.equal(await service.getInlineAttachmentMeta(slug, randomUUID(), 'no-such-session'), null);
  assert.equal(seenAtRead.length, 0, 'no session: the attachment is not read');

  await setSession(seed.unscoped);
  assert.equal(await service.getInlineAttachmentMeta(slug, randomUUID(), REFRESH_TOKEN), null);
  assertUnscoped(seenAtRead.pop()!, 'inline attachment, unscoped session');
  if (!hasRole) return;
  await setSession(seed.limited);
  assert.equal(await service.getInlineAttachmentMeta(slug, randomUUID(), REFRESH_TOKEN), null);
  const limited = seenAtRead.pop()!;
  assertLimited(limited, 'inline attachment, limited session');
  await assertPoolClean(limited.pid, 'inline attachment');
  console.log('  inline attachment: read under the session person\'s access: OK');
}

async function setSession(userId: string) {
  const hash = createHash('sha256').update(REFRESH_TOKEN).digest('hex');
  await inTenant(async (client) => {
    await client.query(`DELETE FROM refresh_tokens WHERE tenant_id = $1 AND token_hash = $2`, [seed.tenantId, hash]);
    await client.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, tenant_id) VALUES ($1, $2, now() + interval '1 hour', $3)`,
      [userId, hash, seed.tenantId],
    );
  });
}

let client: PgClient;

async function inTenant(fn: (client: PgClient) => Promise<void>) {
  await client.query('BEGIN');
  try {
    await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [seed.tenantId]);
    await fn(client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function seedTenant(): Promise<Seed> {
  await client.query('BEGIN');
  try {
    const tree = await seedTree(client);
    const reader = await seedRole(client, tree.tenantId, 'Reader');
    const administrator = await seedRole(client, tree.tenantId, 'Administrator');
    const unscoped = await seedPerson(client, tree.tenantId, 'all', reader);
    // Limited mode on paper: an Administrator keeps everything.
    const admin = await seedPerson(client, tree.tenantId, 'limited', administrator);
    const limited = await seedPerson(client, tree.tenantId, 'limited', reader);
    await seedNodes(client, tree.tenantId, limited, [{ type: 'company', id: tree.companies.c1, access: 'read' }]);
    await client.query('COMMIT');
    return { tenantId: tree.tenantId, unscoped, admin, limited };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function cleanup() {
  if (!seed) return;
  await inTenant(async (c) => {
    for (const table of ['refresh_tokens', 'user_data_access_nodes', 'users', 'roles', 'cost_centers', 'companies']) {
      if (table === 'cost_centers') {
        // Children first: the tree's parent key.
        await c.query(`UPDATE cost_centers SET parent_id = NULL WHERE tenant_id = $1`, [seed.tenantId]);
      }
      await c.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [seed.tenantId]);
    }
  });
  await client.query(`DELETE FROM tenants WHERE id = $1`, [seed.tenantId]);
}

async function run() {
  client = await connect(APP_URL);
  await dataSource.initialize();
  const apps: INestApplication[] = [];
  try {
    hasRole = await roleExists(client);
    console.log(`data access call points (role ${hasRole ? 'installed' : 'absent'})`);
    if (!hasRole && process.env.CI) {
      assert.fail(`CI installs ${LIMITED_ROLE} before the migrations (infra/scripts/data-access-role.sql)`);
    }
    // The grants the API gives the role at its start; the specs do not wait for it.
    if (hasRole) await client.query(`SELECT data_access_sync_policies()`);
    seed = await seedTenant();

    const guarded = await createApp(true);
    apps.push(guarded);
    await testInterceptor(guarded, 'interceptor, runner of TenantInitGuard');
    const own = await createApp(false);
    apps.push(own);
    await testInterceptor(own, 'interceptor, own runner');
    const foreign = await createApp(false, true);
    apps.push(foreign);
    await testForeignRunner(foreign);
    await testRefusals(guarded);
    await testReconnection(guarded);
    await testRunWithContext();
    await testInlineAttachment();
    console.log(hasRole ? 'data access call points: all scenarios passed' : 'data access call points: role absent, scenarios that need it skipped');
  } finally {
    for (const app of apps) await app.close();
    try {
      await cleanup();
    } finally {
      await dataSource.destroy();
      await client.end();
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
