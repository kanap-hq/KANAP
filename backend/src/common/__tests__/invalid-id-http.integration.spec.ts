import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { Controller, Get, INestApplication, Module, Param, Req } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import dataSource from '../../data-source';
import { INVALID_ID_CODE, INVALID_ID_MESSAGE } from '../filters/invalid-id-error.mapping';
import { ListContextsService } from '../list-context/list-contexts.service';
import { useRequestPipeline } from '../request-pipeline';

// GET /assets/not-a-uuid (the public GET /api/assets/not-a-uuid, once nginx
// strips the /api prefix) through the request pipeline main.ts installs.
// The handler passes :id to a uuid cast, which is what a route does when it
// does not check the shape first (companies, contracts). PostgreSQL answers
// 22P02 and the global filter turns that into 400 INVALID_ID. A 22P02 on
// another type and another SQL error stay 500. A well-formed uuid is unchanged.
// The assets service itself returns 404 before any cast (resolveAssetId): this
// probe is the path that still reaches PostgreSQL.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

@Controller('assets')
class InvalidIdProbeController {
  // Declared before :id (Nest matches in declaration order).
  @Get('integer/:value')
  async integer(@Param('value') value: string, @Req() req: any) {
    await req.queryRunner.manager.query('SELECT $1::int AS n', [value]);
    return { ok: true };
  }

  // Division by zero (22012): an SQL error that is not a uuid 22P02.
  @Get('other')
  async other(@Req() req: any) {
    await req.queryRunner.manager.query('SELECT 1/0');
    return { ok: true };
  }

  @Get(':id')
  async get(@Param('id') id: string, @Req() req: any) {
    await req.queryRunner.manager.query('SELECT $1::uuid AS id', [id]);
    return { ok: true };
  }
}

@Module({ controllers: [InvalidIdProbeController], providers: [ListContextsService] })
class InvalidIdProbeModule {}

function assertDedicatedDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required (a dedicated database, for example appdb_1075).');
  const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  if (name === 'appdb') throw new Error('This spec does not run against appdb. Use a dedicated database (appdb_1075).');
}

async function createApp(tenantId: string): Promise<INestApplication> {
  const app = await NestFactory.create(InvalidIdProbeModule, { logger: false });
  app.use((req: any, _res: any, next: () => void) => {
    req.tenant = { id: tenantId, slug: 'invalid-id-probe', name: 'Invalid id probe' };
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

async function call(app: INestApplication, path: string) {
  const { port } = app.getHttpServer().address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/assets/${path}`);
  const text = await res.text();
  await waitForIdlePool();
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

async function main() {
  assertDedicatedDatabase();
  await dataSource.initialize();
  const tenantId = randomUUID();
  let app: INestApplication | undefined;
  try {
    app = await createApp(tenantId);

    const invalid = await call(app, 'not-a-uuid');
    assert.equal(invalid.status, 400, JSON.stringify(invalid.body));
    assert.equal(invalid.body?.code, INVALID_ID_CODE);
    assert.equal(invalid.body?.message, INVALID_ID_MESSAGE);
    console.log('ok - GET /assets/not-a-uuid answers 400 INVALID_ID');

    const valid = await call(app, '00000000-0000-4000-8000-000000000001');
    assert.equal(valid.status, 200, JSON.stringify(valid.body));
    assert.deepEqual(valid.body, { ok: true });
    console.log('ok - a well-formed uuid is unchanged');

    const integer = await call(app, 'integer/nope');
    assert.equal(integer.status, 500, JSON.stringify(integer.body));
    assert.notEqual(integer.body?.code, INVALID_ID_CODE, 'a 22P02 on integer is not INVALID_ID');
    console.log('ok - a 22P02 on integer stays 500');

    const other = await call(app, 'other');
    assert.equal(other.status, 500, JSON.stringify(other.body));
    assert.notEqual(other.body?.code, INVALID_ID_CODE);
    console.log('ok - another SQL error stays 500');
  } finally {
    if (app) await app.close();
    await dataSource.destroy();
  }
}

main()
  .then(() => console.log('invalid-id-http.integration.spec: ok'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
