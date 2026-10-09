import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { Controller, Get, INestApplication, Module, Query, Req } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { IsOptional, IsString } from 'class-validator';
import dataSource from '../../data-source';
import { ExportEventsInterceptor } from '../../audit/export-events.interceptor';
import { Public } from '../../auth/public.decorator';
import { createRaceTenant, dropRaceTenant } from '../../spend/__tests__/race-harness';
import { ListContextInterceptor } from '../list-context/list-context.interceptor';
import { ListContextsService } from '../list-context/list-contexts.service';
import { useRequestPipeline } from '../request-pipeline';
import { TenantInterceptor } from '../tenant.interceptor';

// Saved list filters (`ctx=<id>`, lot 2B PR B2) end to end over HTTP, with the
// request pipeline main.ts installs (`useRequestPipeline`): the context is read
// inside the request's tenant transaction (after TenantInterceptor), and merged
// before the pipes, so a DTO validated with whitelist + transform receives the
// saved filters as if they had been sent inline. An unknown id answers 400 and
// leaves no transaction behind; a route without a tenant transaction answers
// 400 to `ctx` instead of ignoring it.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file in its serial database lane.

class ProbeQuery {
  @IsOptional()
  @IsString()
  filters?: string;

  @IsOptional()
  @IsString()
  sort?: string;
}

@Controller('ctx-probe')
class ListContextProbeController {
  @Get('dto')
  dto(@Query() query: ProbeQuery, @Req() req: any) {
    return {
      query: { ...query },
      validated: query instanceof ProbeQuery,
      inTransaction: !!req.queryRunner?.isTransactionActive,
    };
  }

  @Public()
  @Get('public')
  open() {
    return { ok: true };
  }
}

@Module({ controllers: [ListContextProbeController], providers: [ListContextsService] })
class ListContextProbeModule {}

const FILTERS = { supplier_name: { filterType: 'set', mode: 'exclude', values: ['Acme', 'Globex'] } };

async function createApp(tenantId: string): Promise<INestApplication> {
  const app = await NestFactory.create(ListContextProbeModule, { logger: false });
  app.use((req: any, _res: any, next: () => void) => {
    req.tenant = { id: tenantId, slug: 'ctx-probe', name: 'List context probe' };
    next();
  });
  useRequestPipeline(app, dataSource);
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
  assert.fail(`a request left a connection out of the pool (total ${pool.totalCount}, idle ${pool.idleCount})`);
}

async function main() {
  await dataSource.initialize();
  const tenantId = await createRaceTenant('ctx-pipeline');
  let app: INestApplication | undefined;
  try {
    const svc = new ListContextsService();
    const { id } = await dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
      return svc.save(manager, tenantId, 'ctx-probe', { filters: FILTERS });
    });
    app = await createApp(tenantId);
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    const get = async (path: string) => {
      const res = await fetch(`${base}${path}`);
      return { status: res.status, body: await res.json() as any };
    };

    // The registration order main.ts gets: the context interceptor right after TenantInterceptor,
    // then the export events (audit/export-events.interceptor.ts), inside the same transaction.
    const interceptors = (app as any).config.getGlobalInterceptors().map((i: object) => i.constructor);
    assert.deepEqual(interceptors, [TenantInterceptor, ListContextInterceptor, ExportEventsInterceptor]);
    console.log('ok - registered right after TenantInterceptor');

    // Before the pipes: the DTO, validated with whitelist + transform, holds the saved filters.
    const merged = await get(`/ctx-probe/dto?ctx=${id}&sort=supplier_name:ASC&page=2`);
    assert.equal(merged.status, 200, JSON.stringify(merged.body));
    assert.deepEqual(Object.keys(merged.body.query).sort(), ['filters', 'sort'], 'page: not in the DTO, stripped');
    assert.deepEqual(JSON.parse(merged.body.query.filters), FILTERS);
    assert.equal(merged.body.query.sort, 'supplier_name:ASC');
    assert.equal(merged.body.validated, true);
    assert.equal(merged.body.inTransaction, true);
    console.log('ok - merged before the pipes, inside the tenant transaction');
    // Inline filters override the context's.
    const inline = await get(`/ctx-probe/dto?ctx=${id}&filters=${encodeURIComponent('{"a":{"filterType":"text","filter":"x"}}')}`);
    assert.deepEqual(inline.body.query, { filters: '{"a":{"filterType":"text","filter":"x"}}' });
    await waitForIdlePool();

    // Unknown id: 400 with its code, and the transaction is released.
    const unknown = await get(`/ctx-probe/dto?ctx=${'A'.repeat(22)}`);
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.code, 'list_context_not_found');
    const malformed = await get('/ctx-probe/dto?ctx=short');
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.code, 'list_context_invalid');
    await waitForIdlePool();
    console.log('ok - unknown or malformed id: 400, no transaction left');

    // No tenant transaction on the route: ctx is refused, not ignored.
    const open = await get(`/ctx-probe/public?ctx=${id}`);
    assert.equal(open.status, 400, JSON.stringify(open.body));
    assert.equal(open.body.code, 'list_context_unavailable');
    assert.deepEqual((await get('/ctx-probe/public')).body, { ok: true });
    console.log('ok - a route without a tenant transaction answers 400 to ctx');
    await waitForIdlePool();
  } finally {
    if (app) await app.close();
    await dropRaceTenant(tenantId);
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
