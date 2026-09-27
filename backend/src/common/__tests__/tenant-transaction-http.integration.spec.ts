import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { BadRequestException, Controller, INestApplication, Module, Post, Req } from '@nestjs/common';
import { HttpAdapterHost, NestFactory, Reflector } from '@nestjs/core';
import dataSource from '../../data-source';
import { TenantInitGuard } from '../tenant-init.guard';
import { TenantInterceptor } from '../tenant.interceptor';
import { ReleaseTenantRunnerFilter } from '../filters/release-tenant-runner.filter';

// The request transaction, end to end over HTTP against the database, with the
// production wiring from main.ts: TenantInitGuard opens the tenant transaction,
// TenantInterceptor finishes it, ReleaseTenantRunnerFilter handles errors.
// A handler that writes and then fails must leave nothing persisted.

const PROBE_PREFIX = 'tx-probe';
// A value belongs to a dimension: the probe writes into the tenant's default one.
const DEFAULT_AXIS = `(SELECT id FROM analytics_axes WHERE tenant_id = app_current_tenant() AND is_default)`;

@Controller('tx-probe')
class TransactionProbeController {
  @Post('write-then-throw')
  async writeThenThrow(@Req() req: any) {
    await req.queryRunner.manager.query(
      `INSERT INTO analytics_categories (tenant_id, axis_id, name) VALUES (app_current_tenant(), ${DEFAULT_AXIS}, $1)`,
      [`${PROBE_PREFIX}-throw`],
    );
    throw new BadRequestException('Failure after a successful write');
  }

  @Post('write-then-crash')
  async writeThenCrash(@Req() req: any) {
    await req.queryRunner.manager.query(
      `INSERT INTO analytics_categories (tenant_id, axis_id, name) VALUES (app_current_tenant(), ${DEFAULT_AXIS}, $1)`,
      [`${PROBE_PREFIX}-crash`],
    );
    throw new Error('Unexpected failure after a successful write');
  }

  @Post('write-ok')
  async writeOk(@Req() req: any) {
    await req.queryRunner.manager.query(
      `INSERT INTO analytics_categories (tenant_id, axis_id, name) VALUES (app_current_tenant(), ${DEFAULT_AXIS}, $1)`,
      [`${PROBE_PREFIX}-ok`],
    );
    return { ok: true };
  }
}

@Module({ controllers: [TransactionProbeController] })
class TransactionProbeModule {}

async function createApp(tenantId: string): Promise<INestApplication> {
  const app = await NestFactory.create(TransactionProbeModule, { logger: false });
  const reflector = app.get(Reflector);
  app.use((req: any, _res: any, next: () => void) => {
    req.tenant = { id: tenantId, slug: 'tx-probe', name: 'Transaction probe' };
    next();
  });
  app.useGlobalGuards(new TenantInitGuard(dataSource, reflector));
  app.useGlobalInterceptors(new TenantInterceptor(dataSource, reflector));
  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new ReleaseTenantRunnerFilter(httpAdapter));
  await app.listen(0, '127.0.0.1');
  return app;
}

/** Wait until every pooled connection is back, i.e. the request transaction is finished. */
async function waitForIdlePool() {
  const pool: any = (dataSource.driver as any).master;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (pool.totalCount === pool.idleCount && pool.waitingCount === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('request transaction did not finish within 5 s');
}

async function probeRows(tenantId: string, name: string): Promise<number> {
  return dataSource.transaction(async (manager) => {
    await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const rows = await manager.query(`SELECT count(*)::int AS n FROM analytics_categories WHERE name = $1`, [name]);
    return rows[0].n as number;
  });
}

async function post(app: INestApplication, path: string) {
  const { port } = app.getHttpServer().address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/tx-probe/${path}`, { method: 'POST' });
  await res.text();
  await waitForIdlePool();
  return res.status;
}

async function main() {
  await dataSource.initialize();
  const tenantId = randomUUID();
  await dataSource.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Transaction probe', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `tx-probe-${tenantId.slice(0, 8)}`],
  );
  await dataSource.transaction(async (manager) => {
    await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    await manager.query(`INSERT INTO analytics_axes (tenant_id, code, is_default) VALUES ($1, 'default', true)`, [tenantId]);
  });
  const app = await createApp(tenantId);
  const failures: string[] = [];
  try {
    const okStatus = await post(app, 'write-ok');
    assert.equal(okStatus, 201, 'successful handler answers 201');
    assert.equal(await probeRows(tenantId, `${PROBE_PREFIX}-ok`), 1, 'successful handler commits its write');

    for (const [path, expectedStatus] of [['write-then-throw', 400], ['write-then-crash', 500]] as const) {
      const status = await post(app, path);
      if (status !== expectedStatus) failures.push(`${path}: HTTP ${status}, expected ${expectedStatus}`);
      const persisted = await probeRows(tenantId, `${PROBE_PREFIX}-${path.replace('write-then-', '')}`);
      if (persisted !== 0) failures.push(`${path}: the write before the error was committed (${persisted} row)`);
    }
  } finally {
    await app.close();
    await dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
      await manager.query(`DELETE FROM analytics_categories WHERE tenant_id = $1`, [tenantId]);
      await manager.query(`DELETE FROM analytics_axes WHERE tenant_id = $1`, [tenantId]);
    });
    await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    await dataSource.destroy();
  }
  if (failures.length) {
    throw new Error(`tenant-transaction-http.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('tenant-transaction-http.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
