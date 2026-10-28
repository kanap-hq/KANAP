// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import * as jwt from 'jsonwebtoken';
import { DataSource } from 'typeorm';
import dataSource from '../../data-source';
import { buildAccessTokenPayload } from '../../auth/auth.service';
import { StripeConfigService } from '../../billing/stripe/stripe.config';
import { ListContextsService } from '../../common/list-context/list-contexts.service';
import { useRequestPipeline } from '../../common/request-pipeline';
import { PermissionsService } from '../../permissions/permissions.service';
import { RolePermission } from '../../permissions/role-permission.entity';
import { UserPageRole } from '../../permissions/user-page-role.entity';
import { User } from '../../users/user.entity';
import { UsersService } from '../../users/users.service';
import { createRaceTenant, dropRaceTenant, seed } from '../../spend/__tests__/race-harness';
import { RecordHistoryController } from '../record-history.controller';
import { RecordHistoryService } from '../record-history.service';
import {
  audit,
  linePayload,
  seedHistoryData,
  seedPerson,
  type HistorySeed,
  type Person,
} from './record-history.fixtures';

// `GET /records/:table/:id/history` over HTTP, with the real controller, its real guards (the JWT
// access token, the permission guard reading the stored roles) and the request pipeline main.ts
// installs (tenant transaction, data access, commit). A person who opens the line reads its
// history; a reader without `budget:reader` gets 403; an unknown table, a malformed id, a missing
// line and a line outside a limited person's access get 404; cursor pages do not repeat a row.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

process.env.JWT_SECRET = process.env.JWT_SECRET || `record-history-${randomUUID()}`;
process.env.RATE_LIMIT_ENABLED = 'false';

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])],
  controllers: [RecordHistoryController],
  providers: [
    RecordHistoryService,
    ListContextsService,
    { provide: UsersService, useFactory: () => new (UsersService as any)(dataSource.getRepository(User)) },
    {
      provide: PermissionsService,
      useFactory: () => new PermissionsService(dataSource.getRepository(UserPageRole), dataSource.getRepository(RolePermission)),
    },
    { provide: DataSource, useValue: dataSource },
    { provide: StripeConfigService, useValue: { isConfigured: () => false } },
  ],
})
class RecordHistoryProbeModule {}

type Answer = { status: number; body: any; text: string };

function token(person: Person): string {
  return jwt.sign(buildAccessTokenPayload(person), process.env.JWT_SECRET as string, { expiresIn: '10m' });
}

async function waitForIdlePool() {
  const pool: any = (dataSource.driver as any).master;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (pool.totalCount === pool.idleCount && pool.waitingCount === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`a request left a connection out of the pool (total ${pool.totalCount}, idle ${pool.idleCount})`);
}

async function run() {
  await dataSource.initialize();
  const tenantId = await createRaceTenant('record-history-http');
  let app: INestApplication | undefined;
  try {
    const seeded = await seed(tenantId, async (runner) => {
      const data = await seedHistoryData(runner, tenantId);
      const reader = await seedPerson(runner, tenantId, { first: 'Hana', last: 'Reader' }, { budget: 'reader' });
      const noBudget = await seedPerson(runner, tenantId, { first: 'Nino', last: 'Reader' }, { tasks: 'reader' });
      const limited = await seedPerson(
        runner,
        tenantId,
        { first: 'Lina', last: 'Limited' },
        { budget: 'reader' },
        { mode: 'limited', nodeCompanyId: data.companyA },
      );
      await audit(runner, {
        table: 'spend_items', recordId: data.opexLine, action: 'create', userId: reader.id,
        after: linePayload(data, data.opexLine),
      });
      await audit(runner, {
        table: 'spend_items', recordId: data.opexLine, action: 'update', userId: reader.id,
        before: { notes: 'old' }, after: { notes: 'new' },
      });
      await audit(runner, {
        table: 'spend_items', recordId: data.hiddenLine, action: 'create', userId: reader.id,
        after: linePayload(data, data.hiddenLine, { paying_company_id: data.companyB, cost_center_id: null }),
      });
      for (let index = 0; index < 5; index += 1) {
        await audit(runner, {
          table: 'spend_items', recordId: data.pageLine, action: 'update', userId: reader.id,
          before: { notes: `before ${index}` }, after: { notes: `after ${index}` },
        });
      }
      return { data, reader, noBudget, limited };
    });

    app = await NestFactory.create(RecordHistoryProbeModule, { logger: false });
    // The tenant middleware's job, from a header: the token must name the same tenant.
    app.use((req: any, _res: any, next: () => void) => {
      const header = req.headers['x-probe-tenant'];
      if (header) req.tenant = { id: header, slug: 'record-history-probe', name: 'Record history probe' };
      next();
    });
    useRequestPipeline(app, dataSource);
    await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;

    const get = async (path: string, person?: Person, tenant = person?.tenant_id ?? seeded.data.tenantId): Promise<Answer> => {
      const headers: Record<string, string> = { 'x-probe-tenant': tenant };
      if (person) headers.authorization = `Bearer ${token(person)}`;
      const res = await fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(10_000) });
      const text = await res.text();
      await waitForIdlePool();
      let body: any = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
      return { status: res.status, body, text };
    };

    const linePath = (id: string, query = '') => `/records/spend_items/${id}/history${query}`;

    // The real guards: a signed token, the stored budget:reader role.
    const ok = await get(linePath(seeded.data.opexLine), seeded.reader);
    assert.equal(ok.status, 200, ok.text);
    assert.ok(Array.isArray(ok.body?.items) && ok.body.items.length >= 2, 'the reader gets the history');
    assert.equal(typeof ok.body.items[0].at, 'string');
    assert.equal(ok.body.items[0].action, 'update');

    const anonymous = await get(linePath(seeded.data.opexLine));
    assert.equal(anonymous.status, 401, anonymous.text);

    const refused = await get(linePath(seeded.data.opexLine), seeded.noBudget);
    assert.equal(refused.status, 403, refused.text);

    const unknown = await get(linePath(seeded.data.opexLine).replace('/spend_items/', '/unknown_table/'), seeded.reader);
    assert.equal(unknown.status, 404, unknown.text);

    // A prototype key is not a record family: it names no inventory entry, so it is not found.
    const prototypeKey = await get(linePath(seeded.data.opexLine).replace('/spend_items/', '/__proto__/'), seeded.reader);
    assert.equal(prototypeKey.status, 404, prototypeKey.text);

    const malformed = await get(linePath('not-a-uuid'), seeded.reader);
    assert.equal(malformed.status, 404, malformed.text);

    const missing = await get(linePath(randomUUID()), seeded.reader);
    assert.equal(missing.status, 404, missing.text);

    // A limited person: the line outside their access is not found, the one inside is served.
    const hidden = await get(linePath(seeded.data.hiddenLine), seeded.limited);
    assert.equal(hidden.status, 404, hidden.text);
    const visible = await get(linePath(seeded.data.opexLine), seeded.limited);
    assert.equal(visible.status, 200, visible.text);

    // The cursor through the real route: two pages of two, then one, with no repeated row.
    const first = await get(linePath(seeded.data.pageLine, '?limit=2'), seeded.reader);
    assert.equal(first.status, 200, first.text);
    assert.equal(first.body.items.length, 2);
    assert.ok(first.body.nextCursor, 'a next cursor');
    const second = await get(linePath(seeded.data.pageLine, `?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`), seeded.reader);
    assert.equal(second.status, 200, second.text);
    assert.equal(second.body.items.length, 2);
    assert.ok(second.body.nextCursor, 'a next cursor');
    const third = await get(linePath(seeded.data.pageLine, `?limit=2&cursor=${encodeURIComponent(second.body.nextCursor)}`), seeded.reader);
    assert.equal(third.status, 200, third.text);
    assert.equal(third.body.items.length, 1);
    assert.equal(third.body.nextCursor, null);
    const ids = [...first.body.items, ...second.body.items, ...third.body.items].map((item: any) => item.id);
    assert.equal(new Set(ids).size, 5, 'no repeated row across the cursor pages');

    console.log('record-history-http.integration.spec: ok');
  } finally {
    if (app) await app.close();
    await dropRaceTenant(tenantId);
    await dataSource.destroy();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
