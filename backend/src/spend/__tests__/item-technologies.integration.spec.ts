import 'dotenv/config';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { CapexItemsController } from '../capex-items.controller';
import { CapexItemsService, SpendItemsService } from '../spend-items.service';
import { SpendItemsController } from '../spend-items.controller';
import { assert, captureAudit, inRolledBackTransaction, runSpecs, seedItem, seedTenant, setTenant } from './round-inputs.fixtures';

// The technologies of a budget line, from the line's page (`item-technologies.ts`), through the
// routes of both natures (`/spend-items/:id/technologies`, `/capex-items/:id/technologies`):
// - listed by name with their `TEC-n` reference, replaced as a whole, one audit row per change;
// - a line of the other nature is not found on a nature's route;
// - without the right to read the infrastructure the list is null, a replacement is a 403 and
//   writes nothing, and the tab counts leave the technologies out;
// - a line of another tenant is a 404, a technology of another tenant or a malformed id a 400.

type Seed = { tenantId: string; opexId: string; capexId: string; techA: string; techB: string };

async function seed(runner: QueryRunner, tag: string): Promise<Seed> {
  const tenantId = await seedTenant(runner, tag);
  const tech = async (number: number, name: string) => (await runner.query(
    `INSERT INTO technologies (tenant_id, item_number, name, family) VALUES ($1, $2, $3, 'database') RETURNING id`,
    [tenantId, number, name],
  ))[0].id as string;
  return {
    tenantId,
    opexId: await seedItem(runner, 'opex', tenantId, 1, `Tech OPEX ${tag}`),
    capexId: await seedItem(runner, 'capex', tenantId, 2, `Tech CAPEX ${tag}`),
    techB: await tech(2, `B tech ${tag}`),
    techA: await tech(1, `A tech ${tag}`),
  };
}

function controllers(audit = captureAudit()) {
  const args: any[] = Array.from({ length: 11 }, () => undefined);
  args[3] = audit;
  return {
    opex: new (SpendItemsController as any)(new (SpendItemsService as any)(...args)) as SpendItemsController,
    capex: new (CapexItemsController as any)(new (CapexItemsService as any)(...args)) as CapexItemsController,
  };
}

function ctx(runner: QueryRunner, tenantId: string, permissions: Record<string, string>, isAdmin = false): any {
  return { manager: runner.manager, tenantId, userId: null, isAdmin, permissions };
}

const READER = { budget: 'member', infrastructure: 'reader' };

async function rejection(fn: () => Promise<unknown>): Promise<Error> {
  try {
    await fn();
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected a refusal');
}

async function linkCount(runner: QueryRunner, tenantId: string): Promise<number> {
  const [row] = await runner.query(`SELECT count(*)::int AS n FROM technology_spend_items WHERE tenant_id = $1`, [tenantId]);
  return row.n;
}

async function testBothNatures() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seed(runner, 'itech-natures');
    const audit = captureAudit();
    const { opex, capex } = controllers(audit);
    const c = ctx(runner, a.tenantId, READER);

    assert.deepEqual(await opex.listTechnologies(a.opexId, c), { items: [] });
    const saved = await opex.bulkReplaceTechnologies(a.opexId, { technology_ids: [a.techB, a.techA.toUpperCase()] }, c);
    assert.deepEqual(saved.items.map((row) => [row.id, row.reference]), [[a.techA, 'TEC-1'], [a.techB, 'TEC-2']], 'by name, with the reference');
    assert.equal(audit.entries.length, 1, 'one audit row for the change');
    assert.equal(audit.entries[0].table, 'technology_spend_items');

    // The same set again writes nothing and logs nothing.
    await opex.bulkReplaceTechnologies(a.opexId, { technology_ids: [a.techA, a.techB] }, c);
    assert.equal(audit.entries.length, 1);

    // The CAPEX line has its own set, through its own route.
    await capex.bulkReplaceTechnologies(a.capexId, { technology_ids: [a.techA] }, c);
    assert.deepEqual((await capex.listTechnologies(a.capexId, c)).items?.map((row) => row.id), [a.techA]);
    await opex.bulkReplaceTechnologies(a.opexId, { technology_ids: [a.techB] }, c);
    assert.deepEqual((await opex.listTechnologies(a.opexId, c)).items?.map((row) => row.id), [a.techB]);
    assert.deepEqual((await capex.listTechnologies(a.capexId, c)).items?.map((row) => row.id), [a.techA], 'the other line keeps its set');

    // A line of the other nature is not found on a nature's route.
    assert.ok((await rejection(() => opex.listTechnologies(a.capexId, c))) instanceof NotFoundException);
    assert.ok((await rejection(() => capex.bulkReplaceTechnologies(a.opexId, { technology_ids: [] }, c))) instanceof NotFoundException);

    // The tab counts take them in.
    const counts = await opex.relationCounts(a.opexId, c);
    assert.equal(counts.technologies, 1);
    assert.equal(counts.total, 1);
  });
}

async function testInfrastructureRight() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seed(runner, 'itech-right');
    const { opex, capex } = controllers();
    await opex.bulkReplaceTechnologies(a.opexId, { technology_ids: [a.techA] }, ctx(runner, a.tenantId, READER));

    const budgetOnly = ctx(runner, a.tenantId, { budget: 'admin' });
    assert.deepEqual(await opex.listTechnologies(a.opexId, budgetOnly), { items: null });
    assert.deepEqual(await capex.listTechnologies(a.capexId, budgetOnly), { items: null });
    for (const call of [
      () => opex.bulkReplaceTechnologies(a.opexId, { technology_ids: [] }, budgetOnly),
      () => capex.bulkReplaceTechnologies(a.capexId, { technology_ids: [a.techB] }, budgetOnly),
    ]) {
      assert.ok((await rejection(call)) instanceof ForbiddenException);
    }
    assert.equal(await linkCount(runner, a.tenantId), 1, 'nothing written');
    const counts = await opex.relationCounts(a.opexId, budgetOnly);
    assert.equal(counts.technologies, null);
    assert.equal(counts.total, 0);

    // An administrator reads everything.
    const admin = ctx(runner, a.tenantId, {}, true);
    assert.deepEqual((await opex.listTechnologies(a.opexId, admin)).items?.map((row) => row.id), [a.techA]);
  });
}

async function testOtherTenant() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seed(runner, 'itech-a');
    const b = await seed(runner, 'itech-b');
    await setTenant(runner, b.tenantId);
    const { opex, capex } = controllers();
    const c = ctx(runner, b.tenantId, READER);

    // A line of another tenant is not found.
    for (const call of [
      () => opex.listTechnologies(a.opexId, c),
      () => capex.listTechnologies(a.capexId, c),
      () => opex.bulkReplaceTechnologies(a.opexId, { technology_ids: [] }, c),
      () => capex.bulkReplaceTechnologies(a.capexId, { technology_ids: [b.techA] }, c),
    ]) {
      assert.ok((await rejection(call)) instanceof NotFoundException);
    }

    // A technology of another tenant, or a malformed id, is refused and nothing is written.
    for (const ids of [[a.techA], [b.techA, a.techB], ['not-a-uuid']]) {
      const err = await rejection(() => opex.bulkReplaceTechnologies(b.opexId, { technology_ids: ids }, c));
      assert.ok(err instanceof BadRequestException);
      assert.equal(err.message, 'One or more technologies were not found.');
    }
    assert.equal(await linkCount(runner, b.tenantId), 0, 'nothing written');
  });
}

void runSpecs('item-technologies.integration.spec', [
  ['testBothNatures', testBothNatures],
  ['testInfrastructureRight', testInfrastructureRight],
  ['testOtherTenant', testOtherTenant],
]);

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
