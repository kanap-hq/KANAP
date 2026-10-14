import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { PortfolioPhasesService } from '../services/portfolio-phases.service';
import { PHASE_REORDER_MAX_IDS, ReorderPhasesDto } from '../dto/reorder-phases.dto';

// Reordering a project's phases: the body is a bounded list of distinct UUIDs,
// ids outside the project are ignored, and the new order is written in a single
// UPDATE scoped by tenant and project.

async function dtoErrors(body: unknown): Promise<string[]> {
  const errors = await validate(plainToInstance(ReorderPhasesDto, body as object));
  return errors.map((e) => e.property);
}

async function testBodyIsABoundedListOfUuids() {
  assert.deepEqual(await dtoErrors({ phase_ids: [randomUUID(), randomUUID()] }), []);
  assert.deepEqual(await dtoErrors({ phase_ids: [] }), []);
  assert.deepEqual(await dtoErrors({}), ['phase_ids'], 'phase_ids is required');
  assert.deepEqual(await dtoErrors({ phase_ids: { length: 3 } }), ['phase_ids'], 'an object is not a list');
  assert.deepEqual(await dtoErrors({ phase_ids: 'abc' }), ['phase_ids'], 'a string is not a list');
  assert.deepEqual(await dtoErrors({ phase_ids: ['not-a-uuid'] }), ['phase_ids'], 'every entry is a UUID');
  const tooMany = Array.from({ length: PHASE_REORDER_MAX_IDS + 1 }, () => randomUUID());
  assert.deepEqual(await dtoErrors({ phase_ids: tooMany }), ['phase_ids'], 'the list is bounded');
  const atLimit = tooMany.slice(0, PHASE_REORDER_MAX_IDS);
  assert.deepEqual(await dtoErrors({ phase_ids: atLimit }), [], 'the bound itself is accepted');
}

async function setCurrentTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

async function seedTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Phase reorder test', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `phase-reorder-${tenantId.slice(0, 8)}`],
  );
}

async function seedProject(runner: QueryRunner, tenantId: string, name: string): Promise<string> {
  const id = randomUUID();
  await setCurrentTenant(runner, tenantId);
  await runner.query(
    `INSERT INTO portfolio_projects (id, tenant_id, name, item_number)
     VALUES ($1, $2, $3, COALESCE((SELECT MAX(item_number) FROM portfolio_projects WHERE tenant_id = $2), 0) + 1)`,
    [id, tenantId, name],
  );
  return id;
}

async function seedPhases(runner: QueryRunner, tenantId: string, projectId: string, names: string[]) {
  await setCurrentTenant(runner, tenantId);
  const ids: string[] = [];
  for (let i = 0; i < names.length; i++) {
    const id = randomUUID();
    await runner.query(
      `INSERT INTO portfolio_project_phases (id, tenant_id, project_id, name, sequence) VALUES ($1, $2, $3, $4, $5)`,
      [id, tenantId, projectId, names[i], i],
    );
    ids.push(id);
  }
  return ids;
}

async function sequences(runner: QueryRunner, projectId: string): Promise<Record<string, number>> {
  const rows: Array<{ id: string; sequence: number }> = await runner.query(
    `SELECT id, sequence FROM portfolio_project_phases WHERE project_id = $1`,
    [projectId],
  );
  return Object.fromEntries(rows.map((r) => [r.id, Number(r.sequence)]));
}

/** The service on the test transaction, counting the UPDATE statements it sends. */
function phasesService(runner: QueryRunner) {
  const manager = runner.manager;
  const query = manager.query.bind(manager);
  const counter = { updates: 0 };
  (manager as any).query = (sql: string, params?: unknown[]) => {
    if (/^\s*UPDATE\b/i.test(sql)) counter.updates += 1;
    return query(sql, params);
  };
  const svc = new PortfolioPhasesService({} as any, { log: async () => undefined } as any);
  return { svc, manager, counter };
}

async function withTransaction(fn: (runner: QueryRunner) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await fn(runner);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function testOrderIsWrittenInOneStatement() {
  await withTransaction(async (runner) => {
    const tenantId = randomUUID();
    await seedTenant(runner, tenantId);
    const projectId = await seedProject(runner, tenantId, 'Reorder project');
    const [a, b, c, d] = await seedPhases(runner, tenantId, projectId, ['A', 'B', 'C', 'D']);

    const { svc, manager, counter } = phasesService(runner);
    await svc.reorderPhases(projectId, [d, b, a, c], tenantId, { manager });

    assert.deepEqual(await sequences(runner, projectId), { [d]: 0, [b]: 1, [a]: 2, [c]: 3 });
    assert.equal(counter.updates, 1, 'the new order is written by a single UPDATE');

    counter.updates = 0;
    await svc.reorderPhases(projectId, [], tenantId, { manager });
    assert.equal(counter.updates, 0, 'an empty list changes nothing');
    assert.deepEqual(await sequences(runner, projectId), { [d]: 0, [b]: 1, [a]: 2, [c]: 3 });
  });
}

async function testIdsOutsideTheProjectAreIgnored() {
  await withTransaction(async (runner) => {
    const tenantId = randomUUID();
    const otherTenantId = randomUUID();
    await seedTenant(runner, tenantId);
    await seedTenant(runner, otherTenantId);
    const projectId = await seedProject(runner, tenantId, 'Reorder project');
    const otherProjectId = await seedProject(runner, tenantId, 'Other project');
    const [a, b, c] = await seedPhases(runner, tenantId, projectId, ['A', 'B', 'C']);
    const [otherPhase] = await seedPhases(runner, tenantId, otherProjectId, ['X']);
    const otherTenantProjectId = await seedProject(runner, otherTenantId, 'Other tenant project');
    const [otherTenantPhase] = await seedPhases(runner, otherTenantId, otherTenantProjectId, ['Y']);

    await setCurrentTenant(runner, tenantId);
    const { svc, manager } = phasesService(runner);

    await svc.reorderPhases(projectId, [c, otherPhase, b, a], tenantId, { manager });
    assert.deepEqual(
      await sequences(runner, projectId),
      { [c]: 0, [b]: 2, [a]: 3 },
      'a phase of another project is skipped and the project phases are reordered',
    );
    assert.deepEqual(await sequences(runner, otherProjectId), { [otherPhase]: 0 }, 'the phase of the other project keeps its sequence');

    await svc.reorderPhases(projectId, [a, otherTenantPhase, c, b], tenantId, { manager });
    assert.deepEqual(
      await sequences(runner, projectId),
      { [a]: 0, [c]: 2, [b]: 3 },
      'a phase of another tenant is skipped and the project phases are reordered',
    );

    await svc.reorderPhases(projectId, [b, randomUUID(), a, c], tenantId, { manager });
    assert.deepEqual(
      await sequences(runner, projectId),
      { [b]: 0, [a]: 2, [c]: 3 },
      'an id that matches no phase is skipped',
    );

    await setCurrentTenant(runner, otherTenantId);
    assert.deepEqual(
      await sequences(runner, otherTenantProjectId),
      { [otherTenantPhase]: 0 },
      'the phase of the other tenant keeps its sequence',
    );
  });
}

async function testListIsValidated() {
  await withTransaction(async (runner) => {
    const tenantId = randomUUID();
    await seedTenant(runner, tenantId);
    const projectId = await seedProject(runner, tenantId, 'Reorder project');
    const [a, b] = await seedPhases(runner, tenantId, projectId, ['A', 'B']);

    await setCurrentTenant(runner, tenantId);
    const { svc, manager, counter } = phasesService(runner);
    const before = await sequences(runner, projectId);

    for (const [label, list] of [
      ['the same phase twice', [b, a, b]],
      ['the same phase twice in another case', [b, a, a.toUpperCase()]],
    ] as const) {
      await assert.rejects(
        () => svc.reorderPhases(projectId, [...list], tenantId, { manager }),
        (err: unknown) => err instanceof BadRequestException,
        `a list with ${label} is refused`,
      );
    }
    await assert.rejects(
      () => svc.reorderPhases(projectId, { length: 3 } as any, tenantId, { manager }),
      (err: unknown) => err instanceof BadRequestException,
      'a value that is not a list is refused',
    );
    const tooMany = Array.from({ length: PHASE_REORDER_MAX_IDS + 1 }, () => randomUUID());
    await assert.rejects(
      () => svc.reorderPhases(projectId, tooMany, tenantId, { manager }),
      (err: unknown) => err instanceof BadRequestException,
      'a list over the bound is refused',
    );
    assert.equal(counter.updates, 0, 'a refused list writes nothing');
    assert.deepEqual(await sequences(runner, projectId), before);
  });
}

async function run() {
  await testBodyIsABoundedListOfUuids();
  await dataSource.initialize();
  try {
    await testOrderIsWrittenInOneStatement();
    await testIdsOutsideTheProjectAreIgnored();
    await testListIsValidated();
  } finally {
    await dataSource.destroy();
  }
  console.log('phase-reorder.integration.spec: ok');
}

void run();
