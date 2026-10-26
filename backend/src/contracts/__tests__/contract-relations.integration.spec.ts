import 'dotenv/config';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { ContractsController } from '../contracts.controller';
import { ContractsService } from '../contracts.service';
import { assert, captureAudit, CAPEX_NUMBER_OFFSET, inRolledBackTransaction, runSpecs, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';

// The contract's relations from its own page (`contract-relations.ts`), against a real database:
// - budget lines of both natures in one set: listed with their reference number, nature and
//   company; replaced as a whole (OPEX and CAPEX together);
// - applications and assets, listed and replaced as a whole;
// - an id of another tenant (a line, an application, an asset) or a malformed id is a 400 and
//   nothing is written; a contract of another tenant is a 404 on every route;
// - one audit row per changed set, none when nothing changes; the tab counts follow;
// - technologies, listed with their reference and counted for a reader of the infrastructure only:
//   without that right the list is null, a replacement is a 403 and the count is null.

type Seed = {
  tenantId: string;
  contractId: string;
  opexId: string;
  capexId: string;
  appId: string;
  app2Id: string;
  assetId: string;
  techId: string;
};

async function seed(runner: QueryRunner, tag: string): Promise<Seed> {
  const tenantId = await seedTenant(runner, tag);
  await setTenant(runner, tenantId);
  const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0].id as string;
  const companyId = await one(
    `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, $2, 'FR', 'Lyon') RETURNING id`,
    [tenantId, `Relations company ${tag}`],
  );
  const supplierId = await one(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenantId, `Relations supplier ${tag}`]);
  const contractId = await one(
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, $2, $3, $4, DATE '2026-01-01') RETURNING id`,
    [tenantId, `Relations contract ${tag}`, companyId, supplierId],
  );
  const opexId = await one(
    `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, paying_company_id)
     VALUES ($1, $2, 'EUR', '2026-01-01', 7, $3) RETURNING id`,
    [tenantId, `Relations OPEX ${tag}`, companyId],
  );
  const capexId = await one(
    `INSERT INTO spend_items (tenant_id, nature, product_name, ppe_type, investment_type, priority, currency, effective_start, item_number, legacy_number)
     VALUES ($1, 'capex', $2, 'hardware', 'replacement', 'medium', 'EUR', '2026-01-01', $3, 'CPX-1') RETURNING id`,
    [tenantId, `Relations CAPEX ${tag}`, CAPEX_NUMBER_OFFSET + 1],
  );
  const app = (name: string) => one(`INSERT INTO applications (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenantId, name]);
  const assetId = await one(
    `INSERT INTO assets (tenant_id, name, kind, provider, environment, status, created_at, updated_at)
     VALUES ($1, $2, 'physical_server', 'on_premise', 'prod', 'active', now(), now()) RETURNING id`,
    [tenantId, `relations-srv-${tag}`],
  );
  const techId = await one(`INSERT INTO technologies (tenant_id, item_number, name, family) VALUES ($1, 3, $2, 'database') RETURNING id`, [tenantId, `Relations tech ${tag}`]);
  return { tenantId, contractId, opexId, capexId, appId: await app(`B relations app ${tag}`), app2Id: await app(`A relations app ${tag}`), assetId, techId };
}

function contracts(audit = captureAudit()): ContractsService {
  const args: any[] = Array.from({ length: 9 }, () => undefined);
  args[4] = audit;
  return new (ContractsService as any)(...args);
}

async function rejection(fn: () => Promise<unknown>): Promise<Error> {
  try {
    await fn();
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected a refusal');
}

async function testBudgetLinesOfBothNatures() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seed(runner, 'ctrel-lines');
    const audit = captureAudit();
    const svc = contracts(audit);
    const opts = { manager: runner.manager };

    assert.deepEqual(await svc.listBudgetLines(a.contractId, opts), { items: [], hidden: 0 });
    assert.deepEqual(await svc.replaceRelations(a.contractId, 'budget_lines', [a.capexId, a.opexId.toUpperCase()], 'user', opts), { ok: true, added: 2, removed: 0 });
    const { items } = await svc.listBudgetLines(a.contractId, opts);
    assert.deepEqual(items.map((line) => [line.id, line.nature, line.item_number]), [
      [a.opexId, 'opex', 7],
      [a.capexId, 'capex', CAPEX_NUMBER_OFFSET + 1],
    ]);
    assert.equal(items[0].company_name, 'Relations company ctrel-lines');
    assert.equal(items[1].company_name, null);
    assert.equal(audit.entries.length, 1, 'one audit row for the change');
    assert.equal(audit.entries[0].table, 'contract_spend_items');

    // The same set again writes nothing and logs nothing.
    assert.deepEqual(await svc.replaceRelations(a.contractId, 'budget_lines', [a.opexId, a.capexId], 'user', opts), { ok: true, added: 0, removed: 0 });
    assert.equal(audit.entries.length, 1);

    // Removing the OPEX line keeps the CAPEX one; the old per-nature routes read the same rows.
    await svc.replaceRelations(a.contractId, 'budget_lines', [a.capexId], 'user', opts);
    assert.deepEqual((await svc.listLinkedSpendItems(a.contractId, opts)).items, []);
    assert.deepEqual((await svc.listLinkedCapexItems(a.contractId, opts)).items.map((row) => row.id), [a.capexId]);
    assert.equal((await svc.relationCounts(a.contractId, opts)).budget_lines, 1);
  });
}

async function testApplicationsAndAssets() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seed(runner, 'ctrel-apps');
    const audit = captureAudit();
    const svc = contracts(audit);
    const opts = { manager: runner.manager };

    await svc.replaceRelations(a.contractId, 'applications', [a.appId, a.app2Id], 'user', opts);
    assert.deepEqual((await svc.listApplications(a.contractId, opts)).items.map((row) => row.id), [a.app2Id, a.appId], 'sorted by name');
    await svc.replaceRelations(a.contractId, 'applications', [a.appId], 'user', opts);
    assert.deepEqual((await svc.listApplications(a.contractId, opts)).items.map((row) => row.id), [a.appId]);

    await svc.replaceRelations(a.contractId, 'assets', [a.assetId], 'user', opts);
    assert.deepEqual(await svc.listAssets(a.contractId, opts), { items: [{ id: a.assetId, name: 'relations-srv-ctrel-apps' }] });
    assert.deepEqual(audit.entries.map((entry) => entry.table), ['application_contracts', 'application_contracts', 'asset_contracts']);

    const counts = await svc.relationCounts(a.contractId, opts);
    assert.equal(counts.applications, 1);
    assert.equal(counts.assets, 1);
    assert.equal(counts.relations, 2);
  });
}

async function testTechnologies() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seed(runner, 'ctrel-tech');
    const audit = captureAudit();
    const svc = contracts(audit);
    const controller = new ContractsController(svc, undefined as any, undefined as any, undefined as any);
    const req = (permissions: Record<string, string>) => ({ queryRunner: { manager: runner.manager }, user: { sub: null }, isAdmin: false, permissions });
    const reader = req({ contracts: 'member', infrastructure: 'reader' });
    const contractsOnly = req({ contracts: 'admin' });

    await controller.bulkReplaceTechnologies(a.contractId, { technology_ids: [a.techId] }, reader);
    assert.deepEqual(await controller.listTechnologies(a.contractId, reader), { items: [{ id: a.techId, name: 'Relations tech ctrel-tech', reference: 'TEC-3' }] });
    assert.deepEqual(audit.entries.map((entry) => entry.table), ['technology_contracts']);
    await svc.replaceRelations(a.contractId, 'applications', [a.appId], 'user', { manager: runner.manager });

    const counts = await controller.relationCounts(a.contractId, reader);
    assert.equal(counts.technologies, 1);
    assert.equal(counts.relations, 2, 'applications and technologies');

    // Without the right to read the infrastructure: null list, no count, no replacement.
    assert.deepEqual(await controller.listTechnologies(a.contractId, contractsOnly), { items: null });
    const hidden = await controller.relationCounts(a.contractId, contractsOnly);
    assert.equal(hidden.technologies, null);
    assert.equal(hidden.relations, 1);
    assert.ok((await rejection(() => Promise.resolve().then(() => controller.bulkReplaceTechnologies(a.contractId, { technology_ids: [] }, contractsOnly)))) instanceof ForbiddenException);
    assert.equal((await svc.listTechnologies(a.contractId, { manager: runner.manager })).items.length, 1, 'nothing removed');
  });
}

async function testOtherTenantRefused() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seed(runner, 'ctrel-a');
    const b = await seed(runner, 'ctrel-b');
    await setTenant(runner, b.tenantId);
    const svc = contracts();
    const opts = { manager: runner.manager };

    // A contract of another tenant is not found, on every route.
    for (const call of [
      () => svc.listBudgetLines(a.contractId, opts),
      () => svc.listApplications(a.contractId, opts),
      () => svc.listAssets(a.contractId, opts),
      () => svc.relationCounts(a.contractId, opts),
      () => svc.replaceRelations(a.contractId, 'budget_lines', [], 'user', opts),
      () => svc.replaceRelations(a.contractId, 'applications', [b.appId], 'user', opts),
      () => svc.replaceRelations(a.contractId, 'assets', [], 'user', opts),
      () => svc.listTechnologies(a.contractId, opts),
      () => svc.replaceRelations(a.contractId, 'technologies', [], 'user', opts),
    ]) {
      assert.ok((await rejection(call)) instanceof NotFoundException);
    }

    // Rows of another tenant, or malformed ids, are refused and nothing is written.
    for (const [set, ids, message] of [
      ['budget_lines', [b.opexId, a.opexId], 'One or more budget lines not found.'],
      ['budget_lines', [a.capexId], 'One or more budget lines not found.'],
      ['budget_lines', ['not-a-uuid'], 'One or more budget lines not found.'],
      ['applications', [a.appId], 'One or more applications not found.'],
      ['assets', [a.assetId], 'One or more assets not found.'],
      ['technologies', [a.techId], 'One or more technologies not found.'],
    ] as const) {
      const err = await rejection(() => svc.replaceRelations(b.contractId, set, [...ids], 'user', opts));
      assert.ok(err instanceof BadRequestException, `${set} refused`);
      assert.equal(err.message, message);
    }
    const counts = await svc.relationCounts(b.contractId, { ...opts, technologies: true });
    assert.deepEqual([counts.budget_lines, counts.applications, counts.assets, counts.technologies], [0, 0, 0, 0], 'nothing written');
  });
}

void runSpecs('contract-relations.integration.spec', [
  ['testBudgetLinesOfBothNatures', testBudgetLinesOfBothNatures],
  ['testApplicationsAndAssets', testApplicationsAndAssets],
  ['testTechnologies', testTechnologies],
  ['testOtherTenantRefused', testOtherTenantRefused],
]);

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
