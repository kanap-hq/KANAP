/* eslint-disable no-console */
import 'dotenv/config';
import 'reflect-metadata';
import { AddressInfo } from 'node:net';
import { Controller, Get, INestApplication, Module, Param, Req } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import dataSource from '../../src/data-source';
import { ListContextsService } from '../../src/common/list-context/list-contexts.service';
import { useRequestPipeline } from '../../src/common/request-pipeline';
import { readBudgetLineMeta } from '../../src/spend/item-meta';

/**
 * Cost of the workspace's meta poll (plan planning/perf-scale, lot 3G): `GET /spend-items/:id/meta`
 * on a large tenant. Not a spec: run it by hand on a dedicated database holding such a tenant.
 *
 *   DATABASE_URL=postgres://app:app@localhost:5432/<db> npx ts-node scripts/perf/meta-cost.ts <tenant slug> [samples]
 *
 * 1. The statement alone, each call in its own transaction with the tenant set (as a request):
 *    p50, p95, p99 over random lines, then the plan of one call.
 * 2. Through the request pipeline main.ts installs (tenant transaction, interceptor, filter) over
 *    HTTP on 127.0.0.1, one request at a time, then 50 at once (50 open workspaces whose polls fall
 *    together). JWT and permission checks are not in this path (a few cached reads per request).
 * 3. Saturation: as many requests as 8 parallel clients sustain for 10 seconds.
 */

const quantile = (values: number[], q: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};
const summary = (label: string, values: number[]) => console.log(
  `${label}: n=${values.length} p50=${quantile(values, 0.5).toFixed(2)} ms p95=${quantile(values, 0.95).toFixed(2)} ms p99=${quantile(values, 0.99).toFixed(2)} ms max=${Math.max(...values).toFixed(2)} ms`,
);

async function main() {
  const slug = process.argv[2];
  const samples = Number(process.argv[3] ?? 1000);
  if (!slug) throw new Error('usage: meta-cost.ts <tenant slug> [samples]');
  await dataSource.initialize();
  const [tenant] = await dataSource.query(`SELECT id FROM tenants WHERE slug = $1`, [slug]);
  if (!tenant) throw new Error(`no tenant ${slug}`);
  const tenantId: string = tenant.id;
  const inTenant = async <T>(fn: (manager: any) => Promise<T>): Promise<T> => dataSource.transaction(async (manager) => {
    await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    return fn(manager);
  });
  const ids: string[] = (await inTenant<Array<{ id: string }>>((m) => m.query(`SELECT id FROM spend_items WHERE tenant_id = $1 ORDER BY random() LIMIT $2`, [tenantId, samples])))
    .map((row: { id: string }) => row.id);
  console.log(`tenant ${slug}: ${ids.length} lines sampled`);

  // 1. The statement.
  for (const id of ids.slice(0, 50)) await inTenant((m) => readBudgetLineMeta(m, 'opex', tenantId, id)); // warm
  const statement: number[] = [];
  const transaction: number[] = [];
  for (const id of ids) {
    const t0 = performance.now();
    await inTenant(async (m) => {
      const s0 = performance.now();
      await readBudgetLineMeta(m, 'opex', tenantId, id);
      statement.push(performance.now() - s0);
    });
    transaction.push(performance.now() - t0);
  }
  summary('statement', statement);
  summary('transaction (BEGIN, tenant, statement, COMMIT)', transaction);
  let captured = '';
  await inTenant(async (m) => {
    const spy = { query: async (sql: string, params: unknown[]) => { captured = sql; return m.query(sql, params); } };
    await readBudgetLineMeta(spy as any, 'opex', tenantId, ids[0]);
    const plan = await m.query(`EXPLAIN (ANALYZE, BUFFERS) ${captured}`, [tenantId, ids[0]]);
    console.log(plan.map((row: Record<string, string>) => row['QUERY PLAN']).join('\n'));
  });

  // 2. Through the request pipeline.
  @Controller('spend-items')
  class MetaProbeController {
    @Get(':id/meta')
    meta(@Param('id') id: string, @Req() req: any) {
      return readBudgetLineMeta(req.queryRunner.manager, 'opex', tenantId, id);
    }
  }
  @Module({ controllers: [MetaProbeController], providers: [ListContextsService] })
  class MetaProbeModule {}
  const app: INestApplication = await NestFactory.create(MetaProbeModule, { logger: false });
  app.use((req: any, _res: any, next: () => void) => { req.tenant = { id: tenantId, slug, name: slug }; next(); });
  useRequestPipeline(app, dataSource);
  await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  const get = async (id: string) => {
    const t0 = performance.now();
    const res = await fetch(`${base}/spend-items/${id}/meta`);
    await res.arrayBuffer();
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    return performance.now() - t0;
  };
  try {
    for (const id of ids.slice(0, 50)) await get(id); // warm
    const one: number[] = [];
    for (const id of ids) one.push(await get(id));
    summary('HTTP, one at a time', one);
    const burst: number[] = [];
    for (let round = 0; round < 10; round++) {
      burst.push(...await Promise.all(ids.slice(round * 50, round * 50 + 50).map(get)));
    }
    summary('HTTP, 50 at once (10 rounds)', burst);
    const until = performance.now() + 10_000;
    let done = 0;
    await Promise.all(Array.from({ length: 8 }, async (_, worker) => {
      for (let i = worker; performance.now() < until; i += 8) {
        await get(ids[i % ids.length]);
        done += 1;
      }
    }));
    console.log(`saturation, 8 parallel clients for 10 s: ${(done / 10).toFixed(0)} requests/s`);
    const res = await fetch(`${base}/spend-items/${ids[0]}/meta`);
    console.log(`answer size: ${(await res.text()).length} bytes`);
  } finally {
    await app.close();
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
