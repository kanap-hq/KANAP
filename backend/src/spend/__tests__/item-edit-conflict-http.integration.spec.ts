import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { Body, Controller, Headers, INestApplication, Module, Param, Patch, Req } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import dataSource from '../../data-source';
import { AuditService } from '../../audit/audit.service';
import { EDIT_CONFLICT_CODE } from '../../common/edit-conflicts';
import { ListContextsService } from '../../common/list-context/list-contexts.service';
import { useRequestPipeline } from '../../common/request-pipeline';
import { itemService, lineBody, seedCompany } from './cost-center.fixtures';
import { createRaceTenant, dropRaceTenant, seed } from './race-harness';

// The 409 `edit_conflict` of a line update (plan planning/perf-scale, lot 3C)
// end to end over HTTP, through the request pipeline main.ts installs
// (`useRequestPipeline`: the tenant transaction, its interceptor, the global
// ReleaseTenantRunnerFilter). The workspace reads the answer's body field by
// field (`frontend/src/hooks/editConflicts.ts`): it must reach the client as
// the service built it, with its status, not mapped to another error, and the
// refused request leaves nothing written and no transaction behind.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file in its serial database lane.

const realAudit = () => new AuditService(undefined as any);

@Controller('spend-items')
class LineUpdateProbeController {
  // As SpendItemsController.update: the body as sent, the request's manager, the line service.
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: Record<string, unknown>, @Headers('x-probe-user') userId: string, @Req() req: any) {
    return itemService('opex', realAudit()).update(id, body, userId, { manager: req.queryRunner.manager });
  }
}

@Module({ controllers: [LineUpdateProbeController], providers: [ListContextsService] })
class LineUpdateProbeModule {}

async function createApp(tenantId: string): Promise<INestApplication> {
  const app = await NestFactory.create(LineUpdateProbeModule, { logger: false });
  app.use((req: any, _res: any, next: () => void) => {
    req.tenant = { id: tenantId, slug: 'edit-conflict-probe', name: 'Edit conflict probe' };
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

async function seedPerson(runner: any, tenantId: string, first: string, last: string): Promise<string> {
  const [role] = await runner.query(
    `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, $2, 'Edit conflict HTTP role', false, false, now(), now()) RETURNING id`,
    [tenantId, `Edit conflict HTTP ${first}`],
  );
  const [user] = await runner.query(
    `INSERT INTO users (tenant_id, role_id, email, first_name, last_name, status) VALUES ($1, $2, $3, $4, $5, 'enabled') RETURNING id`,
    [tenantId, role.id, `${first.toLowerCase()}.${last.toLowerCase()}@http.example`, first, last],
  );
  return user.id;
}

async function main() {
  await dataSource.initialize();
  const tenantId = await createRaceTenant('edit-conflict-http');
  let app: INestApplication | undefined;
  try {
    const s = await seed(tenantId, async (runner) => {
      const marie = await seedPerson(runner, tenantId, 'Marie', 'Dupont');
      const jean = await seedPerson(runner, tenantId, 'Jean', 'Martin');
      const { companyId } = await seedCompany(runner, tenantId, 'HTTP company');
      const line = await itemService('opex', realAudit()).create(
        lineBody('opex', 'HTTP line', { paying_company_id: companyId, notes: 'Start' }), marie, { manager: runner.manager },
      );
      return { marie, jean, itemId: line.id as string };
    });
    app = await createApp(tenantId);
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    const patch = async (userId: string, body: Record<string, unknown>) => {
      const res = await fetch(`${base}/spend-items/${s.itemId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-probe-user': userId },
        body: JSON.stringify(body),
      });
      const answer = { status: res.status, type: res.headers.get('content-type') ?? '', retryAfter: res.headers.get('retry-after'), body: await res.json() as any };
      await waitForIdlePool();
      return answer;
    };
    const stored = () => seed(tenantId, async (runner) => {
      const [row] = await runner.query(`SELECT notes, row_version FROM spend_items WHERE id = $1`, [s.itemId]);
      return row as { notes: string; row_version: number };
    });

    const saved = await patch(s.marie, { notes: 'Notes from Marie', base: { notes: 'Start' } });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    console.log('ok - a base that is still the stored value: saved');

    // Jean's notes started from 'Start'. What the service throws, outside HTTP (rolled back)...
    const jeanBody = { notes: 'Notes from Jean', base: { notes: 'Start' } };
    const thrown = await dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
      try {
        await itemService('opex', realAudit()).update(s.itemId, jeanBody, s.jean, { manager });
      } catch (error) {
        return (error as any).getResponse() as Record<string, unknown>;
      }
      return assert.fail('the service must refuse the stale notes');
    });
    // ...is the body the client reads, with its status.
    const refused = await patch(s.jean, jeanBody);
    assert.equal(refused.status, 409);
    assert.match(refused.type, /application\/json/);
    assert.equal(refused.retryAfter, null, 'not a busy answer: nothing to retry');
    assert.deepEqual(refused.body, thrown, 'the body passes through the global filter unchanged');
    console.log('ok - 409 body through the pipeline equals the service\'s answer');

    // The contract, field by field.
    const after = await stored();
    const marieAudit = await seed(tenantId, async (runner) => {
      const [row] = await runner.query(
        `SELECT created_at FROM audit_log WHERE tenant_id = $1 AND record_id = $2 AND user_id = $3 AND action = 'update' ORDER BY created_at DESC LIMIT 1`,
        [tenantId, s.itemId, s.marie],
      );
      return row as { created_at: Date };
    });
    assert.deepEqual(refused.body, {
      statusCode: 409,
      error: 'Conflict',
      code: EDIT_CONFLICT_CODE,
      message: 'Someone else changed this field while you were editing it. Choose which value to keep.',
      conflicts: [{
        field: 'notes',
        base: 'Start',
        current: 'Notes from Marie',
        mine: 'Notes from Jean',
        labels: { base: null, current: null, mine: null },
        changed_by: { id: s.marie, name: 'Marie Dupont' },
        changed_at: new Date(marieAudit.created_at).toISOString(),
      }],
      row_version: after.row_version,
    });
    assert.equal(after.notes, 'Notes from Marie', 'nothing of the refused request is written');
    console.log('ok - edit_conflict contract: who, when, values, row_version; nothing written, no transaction left');
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
