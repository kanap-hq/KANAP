// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import appDataSource from '../../data-source';
import { applyDataAccess } from '../data-access';
import { DataAccessHiddenLinesException, hiddenContractCount } from '../hidden-links';
import { TasksService } from '../../spend/tasks.service';
import { DashboardDataService } from '../../dashboard/dashboard-data.service';
import { SpendItemsService } from '../../spend/spend-items.service';
import { SpendItem } from '../../spend/spend-item.entity';
import { readBudgetLineRelations } from '../../spend/budget-line-relations';
import { budgetListSummary } from '../../spend/budget-list/budget-list.service';
import { SUMMARY_SCOPES } from '../../spend/spend-summary.builder';
import { realSummaryDeps } from '../../spend/__tests__/oracle/oracle-deps';
import { AssetsSupportService } from '../../assets/services/assets-support.service';
import { AssetSupportInfo } from '../../assets/asset-support-info.entity';
import { AssetSupportContact } from '../../assets/asset-support-contact.entity';
import { Application } from '../../applications/application.entity';
import { ApplicationsRelationsService } from '../../applications/services/applications-relations.service';
import { ApplicationsInstancesService } from '../../applications/services/applications-instances.service';
import { ApplicationsDeleteService } from '../../applications/applications-delete.service';
import { Asset as AssetEntity } from '../../assets/asset.entity';
import { AssetRelation } from '../../assets/asset-relation.entity';
import { AssetSpendItemLink } from '../../assets/asset-spend-item.entity';
import { AssetContractLink } from '../../assets/asset-contract.entity';
import { AssetsRelationsService } from '../../assets/services/assets-relations.service';
import { AssetRelationsTabService } from '../../assets/asset-relations-tab.service';
import { AssetsDeleteService } from '../../assets/assets-delete.service';
import { TechnologiesRelationsService } from '../../technologies/technologies-relations.service';
import { TechnologiesDeleteService } from '../../technologies/technologies-delete.service';
import { AuditService } from '../../audit/audit.service';
import { AuditLog } from '../../audit/audit.entity';
import { LIMITED_ROLE, PgClient, roleExists } from './data-access-test-helpers';
import { seedContracts, type ContractSeed } from './data-access-contract-seed';

/**
 * Data-scoped access, lot 5 run 5C (planning/data-scoped-access/spec.md §4.4, §4.7, §5.4, §5.6):
 * the mentions of a contract a limited person cannot read, the panels and the deletes that carry
 * its links, on the contract fixture of run 5A (`data-access-contract-seed.ts`).
 *
 * Marta (ES edit) reads CE, CX, not CF, CH; Paul (INF read) reads CF, not CE, CH. A task of CH is
 * assigned to Paul (visible by participation), and a stale one for the dashboard. L2 (ES, visible
 * to Marta) is linked, by inconsistent data of another tenant, to a contract neither `contracts`
 * nor `spend_items.contract_id` can read: the line detail and the budget list answer
 * `contract_hidden` with neither id nor name, and its Relations tab counts one hidden contract.
 * The application, asset and technology carry CF, CE and CH: a limited person gets "2 contracts
 * outside your access", the delete is refused with both counts (a hidden line on the application
 * too), and the bulk replacements/flows leave the hidden links in place.
 *
 * Needs the role kanap_data_limited (CI installs it); skipped without it, failed in CI.
 */

const dataSource = new DataSource({ ...(appDataSource.options as any), poolSize: 2 });
const deps = realSummaryDeps(SUMMARY_SCOPES.opex);
const dashboard = new DashboardDataService();

function clientOf(runner: QueryRunner): PgClient {
  return { query: async (sql: string, params?: unknown[]) => ({ rows: await runner.query(sql, params as any[]) }) } as unknown as PgClient;
}

/** A stand-in for any service: every member is a function resolving to undefined. Not a thenable. */
function stub(): any {
  const fn = () => Promise.resolve(undefined);
  return new Proxy({}, { get: (_target, prop) => (prop === 'then' || typeof prop === 'symbol' ? undefined : fn) });
}

async function as<T>(runner: QueryRunner, person: string, fn: (m: EntityManager) => Promise<T>): Promise<T> {
  await runner.query('SAVEPOINT person');
  try {
    await applyDataAccess(runner, person);
    return await fn(runner.manager);
  } finally {
    await runner.query('ROLLBACK TO SAVEPOINT person');
  }
}

type Extra = {
  application: string;
  asset: string;
  technology: string;
  hiddenLineContract: string;
};

async function seedExtra(runner: QueryRunner, s: ContractSeed): Promise<Extra> {
  const q = (sql: string, params: unknown[] = []) => runner.query(sql, params);
  const application = { id: s.application };
  const asset = { id: s.asset };
  // A contract of another tenant, named by a visible line and a link: only inconsistent data can
  // do this (the policies make a linked contract readable), so the defensive fields are tested.
  const otherTenant = randomUUID();
  await q(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding) VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{}'::jsonb)`,
    [otherTenant, `da-mentions-${otherTenant.slice(0, 8)}`, 'DA mentions other tenant'],
  );
  // The tenant policies apply to the app role: its rows are written under its own tenant.
  await q(`SELECT set_config('app.current_tenant', $1, true)`, [otherTenant]);
  const [otherCompany] = await q(
    `INSERT INTO companies (tenant_id, name, country_iso, city, status) VALUES ($1, 'Other', 'FR', 'Lyon', 'enabled') RETURNING id`,
    [otherTenant],
  );
  const [otherSupplier] = await q(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Other supplier') RETURNING id`, [otherTenant]);
  const [hiddenLineContract] = await q(
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, 'Other tenant contract', $2, $3, '2026-01-01') RETURNING id`,
    [otherTenant, otherCompany.id, otherSupplier.id],
  );
  await q(`SELECT set_config('app.current_tenant', $1, true)`, [s.tenantId]);
  await q(`UPDATE spend_items SET contract_id = $2 WHERE tenant_id = $1 AND id = $3`, [s.tenantId, hiddenLineContract.id, s.lines.L2]);
  await q(
    `INSERT INTO contract_spend_items (tenant_id, contract_id, spend_item_id) VALUES ($1, $2, $3)`,
    [s.tenantId, hiddenLineContract.id, s.lines.L2],
  );
  // The support contract of the asset: CH, hidden from Marta.
  await q(
    `INSERT INTO asset_support_info (tenant_id, asset_id, support_contract_id) VALUES ($1, $2, $3)`,
    [s.tenantId, asset.id, s.contracts.CH],
  );
  // A hidden line on the application, so the delete refusal carries both nouns.
  await q(
    `INSERT INTO application_spend_items (tenant_id, application_id, spend_item_id) VALUES ($1, $2, $3)`,
    [s.tenantId, application.id, s.lines.L1],
  );
  // The dashboard reads open tasks older than its threshold.
  await q(`UPDATE tasks SET updated_at = now() - interval '10 days' WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.tasks.hiddenParticipant]);
  return {
    application: application.id,
    asset: asset.id,
    technology: s.technology,
    hiddenLineContract: hiddenLineContract.id,
  };
}

function auditOf(): AuditService {
  return new AuditService(dataSource.getRepository(AuditLog));
}

async function testTasks(runner: QueryRunner, s: ContractSeed): Promise<void> {
  const tasks = new TasksService(dataSource);
  await as(runner, s.persons.paul, async (m) => {
    const listed = await tasks.list({}, { manager: m, tenantId: s.tenantId });
    const row = (listed.items as any[]).find((item) => item.id === s.tasks.hiddenParticipant);
    assert.ok(row, 'Paul sees his task of the hidden contract');
    assert.equal(row.related_object_hidden, true);
    assert.equal(row.related_object_hidden_kind, 'contract');
    assert.equal(row.related_object_id, null, 'no contract id');
    assert.equal(row.related_object_name, null, 'no contract name');
    assert.equal(JSON.stringify(listed).includes(s.contracts.CH), false, 'no hidden contract id anywhere in the list');

    const one = await tasks.getOne(s.tasks.hiddenParticipant, { manager: m, tenantId: s.tenantId });
    assert.equal(one?.related_object_hidden_kind, 'contract');
    assert.equal(one?.related_object_id, null);
    assert.equal(one?.related_object_name, null);

    // The hidden task is not listed without being a participant: it names CH, which Paul cannot
    // read, and the task list's policy hides it from someone who is not named on it.
    const stale = await dashboard.getStaleTasks(s.persons.paul, 'all', 0, 10, { manager: m });
    const staleRow = (stale as any[]).find((item) => item.id === s.tasks.hiddenParticipant);
    assert.ok(staleRow, 'the stale tile reads the visible task');
    assert.equal(staleRow.relatedObjectHiddenKind, 'contract');
    assert.equal(staleRow.relatedObjectId, null);
    assert.equal(staleRow.relatedObjectName, null);
  });
  console.log('  tasks of a hidden contract: kind, no id, no name; dashboard tile too: OK');
}

async function testLineMentions(runner: QueryRunner, s: ContractSeed, extra: Extra): Promise<void> {
  const items = new SpendItemsService(
    dataSource.getRepository(SpendItem), stub(), stub(), auditOf(), stub(), stub(), stub(), stub(), stub(), stub(), stub(),
  );
  await as(runner, s.persons.marta, async (m) => {
    const detail: any = await items.getDetail(s.lines.L2, { manager: m });
    assert.equal(detail.contract_hidden, true, 'the line names a contract outside the window');
    assert.equal(detail.contract_id, null, 'no contract id');
    assert.equal(JSON.stringify(detail).includes(extra.hiddenLineContract), false, 'no hidden contract id');

    const page = await budgetListSummary(SUMMARY_SCOPES.opex, deps, { years: '2026', includeDisabled: 'true', limit: '100' }, m);
    const line = (page.items as any[]).find((row) => row.id === s.lines.L2);
    assert.ok(line);
    assert.equal(line.contract_hidden, true, 'the budget list flags the hidden contract');
    assert.equal(line.contract_id, null);
    assert.equal(line.latest_contract_id, null);
    assert.equal(line.latest_contract_name, '');
    assert.equal(JSON.stringify(page).includes(extra.hiddenLineContract), false, 'no hidden contract id in the list');

    const relations = await readBudgetLineRelations(m, s.lines.L2, {
      access: { projects: false, applications: false, technologies: false, contracts: true, assets: false },
      applicationScope: undefined,
      projectScope: undefined,
    });
    assert.deepEqual(relations.contracts, [], 'the hidden contract is not named');
    assert.equal(relations.contracts_hidden, 1, 'and counted');
    assert.equal(JSON.stringify(relations).includes(extra.hiddenLineContract), false);
  });
  // An unscoped person: no flags, the same line.
  await applyDataAccess(runner, s.persons.ulla);
  const unscoped = await budgetListSummary(SUMMARY_SCOPES.opex, deps, { years: '2026', includeDisabled: 'true', limit: '100' }, runner.manager);
  const unscopedLine = (unscoped.items as any[]).find((row) => row.id === s.lines.L2);
  assert.equal('contract_hidden' in unscopedLine, false, 'no flag without limited access');
  console.log('  line detail and budget list: contract_hidden, no id, no name; Relations tab counts: OK');
}

async function testSupportContract(runner: QueryRunner, s: ContractSeed): Promise<void> {
  const service = new AssetsSupportService(
    dataSource.getRepository(AssetEntity),
    dataSource.getRepository(AssetSupportInfo),
    dataSource.getRepository(AssetSupportContact),
    auditOf(),
  );
  const refusal = async (fn: () => Promise<unknown>): Promise<any> => {
    try {
      await fn();
    } catch (error) {
      return error;
    }
    assert.fail('expected a refusal');
  };
  await as(runner, s.persons.marta, async (m) => {
    const info: any = await service.getSupportInfo(s.asset, { manager: m, tenantId: s.tenantId });
    assert.equal(info?.support_contract_hidden, true);
    assert.equal(info?.support_contract_id, null);

    // Keeping the stored hidden contract while editing another field stays allowed; the write
    // answer hides it exactly as the GET does.
    const kept: any = await service.upsertSupportInfo(
      s.asset, { notes: 'kept hidden' }, s.tenantId, s.persons.marta, { manager: m },
    );
    assert.equal(kept.notes, 'kept hidden', 'the other field is written');
    assert.equal(kept.support_contract_id, null);
    assert.equal(kept.support_contract_hidden, true);
    const stored: any = await m.query(
      `SELECT support_contract_id, notes FROM asset_support_info WHERE tenant_id = $1 AND asset_id = $2`,
      [s.tenantId, s.asset],
    );
    assert.equal(stored[0].support_contract_id, s.contracts.CH, 'the hidden link is kept');
    assert.equal(stored[0].notes, 'kept hidden');

    // A contract the person reads is set and named in the answer.
    const visible: any = await service.upsertSupportInfo(
      s.asset, { support_contract_id: s.contracts.CE }, s.tenantId, s.persons.marta, { manager: m },
    );
    assert.equal(visible.support_contract_id, s.contracts.CE);
    assert.equal('support_contract_hidden' in visible, false, 'a visible contract is named, not flagged');

    // Changing it to the hidden contract is refused like an unknown id: the same 404, never the
    // foreign key's 409.
    const hidden = await refusal(() => service.upsertSupportInfo(
      s.asset, { support_contract_id: s.contracts.CH }, s.tenantId, s.persons.marta, { manager: m },
    ));
    const unknown = await refusal(() => service.upsertSupportInfo(
      s.asset, { support_contract_id: randomUUID() }, s.tenantId, s.persons.marta, { manager: m },
    ));
    assert.ok(hidden instanceof NotFoundException, `hidden contract: ${hidden?.stack ?? hidden}`);
    assert.ok(unknown instanceof NotFoundException, `unknown contract: ${unknown?.stack ?? unknown}`);
    assert.equal(hidden.getStatus(), 404);
    assert.equal(unknown.getStatus(), 404);
    assert.equal(hidden.message, unknown.message, 'a hidden contract answers as a missing one');
    const refusedRow: any = await m.query(
      `SELECT support_contract_id FROM asset_support_info WHERE tenant_id = $1 AND asset_id = $2`,
      [s.tenantId, s.asset],
    );
    assert.equal(refusedRow[0].support_contract_id, s.contracts.CE, 'the refusals wrote nothing');
  });
  await applyDataAccess(runner, s.persons.ulla);
  const unscoped = await service.getSupportInfo(s.asset, { manager: runner.manager, tenantId: s.tenantId });
  assert.equal(unscoped?.support_contract_id, s.contracts.CH, 'unscoped: unchanged');
  console.log('  asset support contract: hidden and unknown ids the same 404, write answer hides it, keeping it on another edit allowed: OK');
}

function panelContext(personId: string, manager: EntityManager, s: ContractSeed) {
  const access: Record<string, boolean> = {
    budget_lines: false, contracts: true, incidents: false, processes: false, projects: false, requests: false, tasks: false, technologies: false,
  };
  return {
    manager,
    tenantId: s.tenantId,
    userId: personId,
    access,
    writes: { technologies: false, processes: false, incidents: false },
    scopes: {},
    incidentViewer: { isAdmin: false, userId: personId },
  };
}

async function testPanels(runner: QueryRunner, s: ContractSeed, extra: Extra): Promise<void> {
  const applications = new ApplicationsRelationsService(
    dataSource.getRepository(Application), stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(),
  );
  const assets = new AssetRelationsTabService(stub(), deps.fxRates as any, stub(), stub(), auditOf());
  const technologies = new TechnologiesRelationsService(auditOf(), deps.fxRates as any, stub());

  await as(runner, s.persons.marta, async (m) => {
    const application = await applications.getRelations(extra.application, panelContext(s.persons.marta, m, s) as any);
    assert.deepEqual(application.contracts?.map((row) => row.id), [s.contracts.CE], 'Marta reads CE alone');
    assert.equal(application.contracts_hidden, 2, 'CF and CH are counted');

    const asset = await assets.read(extra.asset, panelContext(s.persons.marta, m, s) as any);
    assert.deepEqual(asset.contracts?.map((row) => row.id), [s.contracts.CE]);
    assert.equal(asset.contracts_hidden, 2);

    const technology = await technologies.getRelations(extra.technology, {
      ...panelContext(s.persons.marta, m, s), writeIncidents: false,
    } as any);
    assert.deepEqual(technology.contracts?.map((row) => row.id), [s.contracts.CE]);
    assert.equal(technology.contracts_hidden, 2);
  });

  await applyDataAccess(runner, s.persons.ulla);
  const application = await applications.getRelations(extra.application, panelContext(s.persons.ulla, runner.manager, s) as any);
  assert.equal(application.contracts?.length, 3, 'unscoped: every linked contract');
  assert.equal(application.contracts_hidden, 0);
  console.log('  application, asset and technology panels: visible contracts, hidden count: OK');
}

async function testDeletes(runner: QueryRunner, s: ContractSeed, extra: Extra): Promise<void> {
  const applications = new ApplicationsDeleteService(dataSource.getRepository(Application), auditOf(), stub(), stub());
  const assets = new AssetsDeleteService(dataSource.getRepository(AssetEntity), auditOf());
  const technologies = new TechnologiesDeleteService(auditOf(), stub());

  await as(runner, s.persons.marta, async (m) => {
    const app = await applications.deleteCheck([extra.application], { manager: m });
    assert.equal(app.refused.length, 1);
    assert.equal(app.refused[0].code, 'APPLICATION_HIDDEN_LINES', 'lines and contracts together');
    assert.deepEqual(app.refused[0].params, { count: 1, contracts: 2 });
    await assert.rejects(applications.delete(extra.application, { manager: m }), (error: any) => {
      assert.ok(error instanceof DataAccessHiddenLinesException);
      assert.equal(error.message, 'This application is linked to 1 line and 2 contracts outside your access.');
      return true;
    });

    const asset = await assets.deleteCheck([extra.asset], s.tenantId, { manager: m });
    assert.equal(asset.refused.length, 1);
    assert.equal(asset.refused[0].code, 'ASSET_HIDDEN_CONTRACTS');
    assert.deepEqual(asset.refused[0].params, { count: 2, contracts: 2 });
    await assert.rejects(assets.deleteAsset(extra.asset, s.tenantId, s.persons.marta, { manager: m }), (error: any) => {
      assert.equal(error.message, 'This asset is linked to 2 contracts outside your access.');
      return true;
    });

    const technology = await technologies.deleteCheck([extra.technology], { manager: m, tenantId: s.tenantId, userId: s.persons.marta });
    assert.equal(technology.refused.length, 1);
    assert.equal(technology.refused[0].code, 'TECHNOLOGY_HIDDEN_CONTRACTS');
    assert.deepEqual(technology.refused[0].params, { count: 2, contracts: 2 });
    await assert.rejects(technologies.delete(extra.technology, { manager: m, tenantId: s.tenantId, userId: s.persons.marta }), (error: any) => {
      assert.equal(error.message, 'This technology is linked to 2 contracts outside your access.');
      return true;
    });

    assert.equal(await hiddenContractCount(m, 'application', extra.application), 2);
  });
  console.log('  deletes: refused for hidden contracts (and lines together), check announces them: OK');
}

async function testBulkReplacements(runner: QueryRunner, s: ContractSeed, extra: Extra): Promise<void> {
  const instances = new ApplicationsInstancesService(dataSource.getRepository(Application), stub(), auditOf());
  const assets = new AssetsRelationsService(
    dataSource.getRepository(AssetEntity),
    dataSource.getRepository(AssetRelation),
    dataSource.getRepository(AssetSpendItemLink),
    dataSource.getRepository(AssetContractLink),
    auditOf(),
  );
  const technologies = new TechnologiesRelationsService(auditOf(), deps.fxRates as any, stub());
  await as(runner, s.persons.marta, async (m) => {
    // Replacing the visible link with nothing deletes CE alone; CF and CH are outside the policy.
    await instances.bulkReplaceLinkedContracts(extra.application, [], s.persons.marta, { manager: m });
    await assets.bulkReplaceLinkedContracts(extra.asset, [], s.tenantId, s.persons.marta, { manager: m });
    const removed = await technologies.setLink('contracts', extra.technology, s.contracts.CE, false, {
      ...panelContext(s.persons.marta, m, s), writeIncidents: false,
    } as any);
    assert.equal(removed.changed, true, 'the visible link is removed');

    const visibleContracts = async (table: string, column: string, owner: string) => (await m.query(
      `SELECT contract_id FROM ${table} WHERE tenant_id = $1 AND ${column} = $2`, [s.tenantId, owner],
    )).map((row: any) => row.contract_id);
    assert.deepEqual(await visibleContracts('application_contracts', 'application_id', extra.application), [], 'application: the visible link is gone');
    assert.deepEqual(await visibleContracts('asset_contracts', 'asset_id', extra.asset), [], 'asset: the visible link is gone');
    assert.deepEqual(await visibleContracts('technology_contracts', 'technology_id', extra.technology), [], 'technology: the visible link is gone');
    assert.equal(await hiddenContractCount(m, 'application', extra.application), 2, 'application: CF and CH survive');
    assert.equal(await hiddenContractCount(m, 'asset', extra.asset), 2, 'asset: CF and CH survive');
    assert.equal(await hiddenContractCount(m, 'technology', extra.technology), 2, 'technology: CF and CH survive');
  });
  console.log('  bulk replacements: the visible link goes, hidden contract links survive: OK');
}

async function run() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  try {
    if (!(await roleExists(clientOf(runner)))) {
      if (process.env.CI) assert.fail(`CI installs ${LIMITED_ROLE} before the migrations (infra/scripts/data-access-role.sql)`);
      console.log(`data access contract mentions: ${LIMITED_ROLE} not installed, skipped`);
      return;
    }
    console.log('data access contract mentions, panels and deletes (lot 5, run 5C)');
    await runner.startTransaction();
    try {
      const s = await seedContracts(clientOf(runner));
      const extra = await seedExtra(runner, s);
      await testTasks(runner, s);
      await testLineMentions(runner, s, extra);
      await testSupportContract(runner, s);
      await testPanels(runner, s, extra);
      await testDeletes(runner, s, extra);
      await testBulkReplacements(runner, s, extra);
    } finally {
      await runner.rollbackTransaction();
    }
  } finally {
    await runner.release();
    await dataSource.destroy();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
