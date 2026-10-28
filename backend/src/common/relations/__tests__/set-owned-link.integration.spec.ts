// @database-spec
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import {
  assert, captureAudit, inRolledBackTransaction, runSpecs, seedItem, seedTenant, setTenant,
} from '../../../spend/__tests__/round-inputs.fixtures';
import { setOwnedLink, type OwnedRelationLink } from '../owned-link';

// `setOwnedLink` against a real database, on a technology's link tables (the same tables the
// Relations tab writes): one link, the same link again, a removal, a removal of nothing, a bad
// id, a missing target, a refused read, and a row of another tenant.

const OWNER = { table: 'technologies', idColumn: 'id' };
const CONTRACTS: OwnedRelationLink = {
  table: 'technology_contracts', ownerColumn: 'technology_id', targetColumn: 'contract_id', notFound: 'Contract not found.',
};
const LINES: OwnedRelationLink = {
  table: 'technology_spend_items', ownerColumn: 'technology_id', targetColumn: 'spend_item_id', notFound: 'Budget line not found.',
  auditTable: (nature) => (nature === 'capex' ? 'application_capex_items' : 'technology_spend_items'),
};
const PROJECTS: OwnedRelationLink = {
  table: 'technology_projects', ownerColumn: 'technology_id', targetColumn: 'project_id', notFound: 'One or more projects were not found.',
};

type World = {
  tenantId: string;
  userId: string;
  techId: string;
  contractId: string;
  contract2Id: string;
  opexId: string;
  capexId: string;
  projectId: string;
};

async function seed(runner: QueryRunner, tag: string): Promise<World> {
  const tenantId = await seedTenant(runner, tag);
  const userId = randomUUID();
  const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0].id as string;
  const techId = await one(
    `INSERT INTO technologies (tenant_id, item_number, name, family) VALUES ($1, 1, $2, 'database') RETURNING id`,
    [tenantId, `Owned ${tag}`],
  );
  const companyId = await one(
    `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, $2, 'FR', 'Lyon') RETURNING id`,
    [tenantId, `Owned company ${tag}`],
  );
  const supplierId = await one(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenantId, `Owned supplier ${tag}`]);
  const contractId = await one(
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, 'A', $2, $3, DATE '2026-01-01') RETURNING id`,
    [tenantId, companyId, supplierId],
  );
  const contract2Id = await one(
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, 'B', $2, $3, DATE '2026-01-01') RETURNING id`,
    [tenantId, companyId, supplierId],
  );
  const opexId = await seedItem(runner, 'opex', tenantId, 1, 'Opex line');
  const capexId = await seedItem(runner, 'capex', tenantId, 2, 'Capex line');
  const projectId = await one(
    `INSERT INTO portfolio_projects (tenant_id, name, item_number) VALUES ($1, $2, 1) RETURNING id`,
    [tenantId, `Owned project ${tag}`],
  );
  return { tenantId, userId, techId, contractId, contract2Id, opexId, capexId, projectId };
}

function call(
  runner: QueryRunner,
  world: World,
  audit: ReturnType<typeof captureAudit>,
  over: Partial<Parameters<typeof setOwnedLink>[0]> = {},
) {
  return setOwnedLink({
    manager: runner.manager,
    userId: world.userId,
    kind: 'contracts',
    targetId: world.contractId,
    add: true,
    allowed: true,
    loadOwner: async () => ({ id: world.techId, tenantId: world.tenantId }),
    owner: OWNER,
    ownerNotFound: 'Technology not found',
    link: CONTRACTS,
    audit,
    ...over,
  });
}

async function expectHttp(run: () => Promise<unknown>, type: new (...args: never[]) => Error, message: string) {
  await assert.rejects(run(), (err: unknown) => {
    assert.ok(err instanceof type, `expected ${type.name}, got ${(err as Error)?.constructor?.name}`);
    const response = (err as { getResponse?: () => unknown }).getResponse?.();
    assert.equal((err as Error).message, message, `response=${JSON.stringify(response)}`);
    return true;
  });
}

/** A refused read is a coded 403 naming the module and its reader level. */
async function expectModuleRight(run: () => Promise<unknown>, resource: string, message: string) {
  await assert.rejects(run(), (err: unknown) => {
    assert.ok(err instanceof ForbiddenException, 'a ForbiddenException');
    assert.deepEqual((err as ForbiddenException).getResponse(), {
      statusCode: 403,
      error: 'Forbidden',
      code: 'MODULE_RIGHT_REQUIRED',
      message,
      params: { resource, level: 'reader' },
    });
    return true;
  });
}

async function contractIds(runner: QueryRunner, world: World): Promise<string[]> {
  const rows: Array<{ contract_id: string }> = await runner.query(
    `SELECT contract_id FROM technology_contracts WHERE tenant_id = $1 AND technology_id = $2 ORDER BY contract_id`,
    [world.tenantId, world.techId],
  );
  return rows.map((row) => row.contract_id);
}

async function testContractLink() {
  await inRolledBackTransaction(async (runner) => {
    const world = await seed(runner, 'own-contract');
    const audit = captureAudit();
    const [first, second] = [world.contractId, world.contract2Id].sort();

    assert.deepEqual(await call(runner, world, audit, { targetId: ` ${world.contractId.toUpperCase()} ` }), { ok: true, changed: true });
    assert.deepEqual(await contractIds(runner, world), [world.contractId]);
    assert.deepEqual(audit.entries, [{
      table: 'technology_contracts', recordId: world.techId, action: 'update', before: [], after: [world.contractId], userId: world.userId,
    }]);

    assert.deepEqual(await call(runner, world, audit, { targetId: world.contractId.toUpperCase() }), { ok: true, changed: false });
    assert.equal(audit.entries.length, 1, 'linking what is linked writes no audit row');

    assert.deepEqual(await call(runner, world, audit, { targetId: world.contract2Id }), { ok: true, changed: true });
    assert.deepEqual(audit.entries[1].before, [world.contractId]);
    assert.deepEqual(audit.entries[1].after, [first, second]);

    assert.deepEqual(await call(runner, world, audit, { targetId: ` ${world.contractId.toUpperCase()} `, add: false }), { ok: true, changed: true });
    assert.deepEqual(audit.entries[2].before, [first, second]);
    assert.deepEqual(audit.entries[2].after, [world.contract2Id]);
    assert.deepEqual(await contractIds(runner, world), [world.contract2Id]);

    assert.deepEqual(await call(runner, world, audit, { targetId: world.contract2Id, add: false }), { ok: true, changed: true });
    const kept = audit.entries.length;
    assert.deepEqual(await call(runner, world, audit, { targetId: world.contract2Id, add: false }), { ok: true, changed: false });
    assert.equal(audit.entries.length, kept, 'unlinking what is not linked writes no audit row');
    assert.deepEqual(await contractIds(runner, world), []);
  });
}

async function testRefusals() {
  await inRolledBackTransaction(async (runner) => {
    const world = await seed(runner, 'own-refuse');
    const audit = captureAudit();
    let loaded = 0;
    const owner = async () => {
      loaded += 1;
      return { id: world.techId, tenantId: world.tenantId };
    };

    await expectHttp(
      () => call(runner, world, audit, { targetId: 'nope', loadOwner: owner }),
      BadRequestException,
      'Invalid id.',
    );
    assert.equal(loaded, 0, 'a bad id is refused before the owner is read');

    await expectModuleRight(
      () => call(runner, world, audit, { allowed: false, loadOwner: owner }),
      'contracts',
      'You cannot read this module.',
    );
    assert.equal(loaded, 0, 'a refused read does not touch the owner');

    await expectHttp(
      () => call(runner, world, audit, { targetId: randomUUID() }),
      BadRequestException,
      'Contract not found.',
    );
    await expectHttp(
      () => call(runner, world, audit, { kind: 'budget_lines', link: LINES, targetId: randomUUID() }),
      BadRequestException,
      'Budget line not found.',
    );
    await expectHttp(
      () => call(runner, world, audit, { kind: 'projects', link: PROJECTS, targetId: randomUUID() }),
      BadRequestException,
      'One or more projects were not found.',
    );
    await expectHttp(
      () => call(runner, world, audit, { loadOwner: async () => ({ id: randomUUID(), tenantId: world.tenantId }) }),
      NotFoundException,
      'Technology not found',
    );
    assert.equal(audit.entries.length, 0);
    assert.deepEqual(await contractIds(runner, world), []);
  });
}

async function testBudgetNatures() {
  await inRolledBackTransaction(async (runner) => {
    const world = await seed(runner, 'own-lines');
    const audit = captureAudit();
    const link = (targetId: string, add: boolean) => call(runner, world, audit, { kind: 'budget_lines', link: LINES, targetId, add });

    assert.deepEqual(await link(` ${world.opexId.toUpperCase()} `, true), { ok: true, changed: true });
    assert.deepEqual(audit.entries[0], {
      table: 'technology_spend_items', recordId: world.techId, action: 'update', before: [], after: [world.opexId], userId: world.userId,
    });
    assert.deepEqual(await link(world.capexId, true), { ok: true, changed: true });
    assert.equal(audit.entries[1].table, 'application_capex_items');
    assert.deepEqual(audit.entries[1].before, []);
    assert.deepEqual(audit.entries[1].after, [world.capexId]);

    const kept = audit.entries.length;
    assert.deepEqual(await link(world.capexId, true), { ok: true, changed: false });
    assert.equal(audit.entries.length, kept);

    assert.deepEqual(await link(world.opexId, false), { ok: true, changed: true });
    assert.equal(audit.entries.at(-1)?.table, 'technology_spend_items');
    assert.deepEqual(audit.entries.at(-1)?.before, [world.opexId], 'the audit of one nature leaves the other out');
    assert.deepEqual(audit.entries.at(-1)?.after, []);
    const rows: Array<{ spend_item_id: string }> = await runner.query(
      `SELECT spend_item_id FROM technology_spend_items WHERE tenant_id = $1 AND technology_id = $2`,
      [world.tenantId, world.techId],
    );
    assert.deepEqual(rows.map((row) => row.spend_item_id), [world.capexId]);
  });
}

async function testProjectScope() {
  await inRolledBackTransaction(async (runner) => {
    const world = await seed(runner, 'own-project');
    const audit = captureAudit();
    const link = (over: Partial<Parameters<typeof setOwnedLink>[0]> = {}) => call(runner, world, audit, {
      kind: 'projects', link: PROJECTS, targetId: world.projectId, ...over,
    });

    assert.deepEqual(await link(), { ok: true, changed: true });
    assert.deepEqual(audit.entries[0], {
      table: 'technology_projects', recordId: world.techId, action: 'update', before: [], after: [world.projectId], userId: world.userId,
    });
    assert.deepEqual(await link(), { ok: true, changed: false });

    const kept = audit.entries.length;
    await expectHttp(
      () => link({ projectScope: { userId: randomUUID() } }),
      BadRequestException,
      'One or more projects were not found.',
    );
    assert.equal(audit.entries.length, kept, 'a project out of the scope is not rewritten');
    const rows: Array<{ project_id: string }> = await runner.query(
      `SELECT project_id FROM technology_projects WHERE tenant_id = $1 AND technology_id = $2`,
      [world.tenantId, world.techId],
    );
    assert.deepEqual(rows.map((row) => row.project_id), [world.projectId]);

    assert.deepEqual(await link({ add: false }), { ok: true, changed: true });
    assert.deepEqual(await link({ add: false }), { ok: true, changed: false });
  });
}

async function testTenantIsolation() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seed(runner, 'own-iso-a');
    const b = await seed(runner, 'own-iso-b');
    await setTenant(runner, a.tenantId);
    const audit = captureAudit();

    await expectHttp(
      () => call(runner, a, audit, { targetId: b.contractId }),
      BadRequestException,
      'Contract not found.',
    );
    assert.deepEqual(await contractIds(runner, a), []);

    await expectHttp(
      () => call(runner, a, audit, {
        targetId: b.contractId,
        loadOwner: async () => ({ id: b.techId, tenantId: b.tenantId }),
      }),
      NotFoundException,
      'Technology not found',
    );
    assert.equal(audit.entries.length, 0);

    await setTenant(runner, b.tenantId);
    assert.deepEqual(await contractIds(runner, b), []);
  });
}

runSpecs('set-owned-link.integration.spec', [
  ['links, repeats and removes one contract', testContractLink],
  ['refuses a bad id, a missing target and a refused read', testRefusals],
  ['audits each budget nature on its own', testBudgetNatures],
  ['keeps a project out of the caller scope', testProjectScope],
  ['does not cross tenants', testTenantIsolation],
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
