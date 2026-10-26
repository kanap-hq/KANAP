// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import appDataSource from '../../data-source';
import { applyDataAccess } from '../data-access';
import { DataAccessHiddenLinesException } from '../hidden-links';
import { readRelatedBudgetLines, type RelationLinkTable } from '../../common/relations/related-objects';
import { setOwnedLink } from '../../common/relations/owned-link';
import { listContractBudgetLines, replaceContractRelations } from '../../contracts/contract-relations';
import { ContractsService } from '../../contracts/contracts.service';
import { Contract } from '../../contracts/contract.entity';
import { ContractSpendItem } from '../../contracts/contract-spend-item.entity';
import { FxRateService } from '../../currency/fx-rate.service';
import { CurrencySettingsService } from '../../currency/currency-settings.service';
import { AuditService } from '../../audit/audit.service';
import { AuditLog } from '../../audit/audit.entity';
import { Application } from '../../applications/application.entity';
import { ApplicationsDeleteService } from '../../applications/applications-delete.service';
import { ApplicationsInstancesService } from '../../applications/services/applications-instances.service';
import { ApplicationsCrudService } from '../../applications/services/applications-crud.service';
import { Asset } from '../../assets/asset.entity';
import { AssetRelation } from '../../assets/asset-relation.entity';
import { AssetSpendItemLink } from '../../assets/asset-spend-item.entity';
import { AssetContractLink } from '../../assets/asset-contract.entity';
import { AssetsDeleteService } from '../../assets/assets-delete.service';
import { AssetsRelationsService } from '../../assets/services/assets-relations.service';
import { TechnologiesDeleteService } from '../../technologies/technologies-delete.service';
import { PortfolioProject } from '../../portfolio/portfolio-project.entity';
import { PortfolioRequest } from '../../portfolio/portfolio-request.entity';
import { PortfolioRelationsService } from '../../portfolio/portfolio-relations.service';
import { PortfolioRequestsService } from '../../portfolio/portfolio-requests.service';
import { PortfolioProjectsCrudService } from '../../portfolio/services/portfolio-projects-crud.service';
import { LIMITED_ROLE, PgClient, roleExists } from './data-access-test-helpers';
import { Seed, seed } from './data-access-line-seed';

/**
 * Data-scoped access, lot 4 run 4B (planning/data-scoped-access/spec.md §5.4, §6.6, §10.5): the
 * links to budget lines seen from the other object, on the reference example of lot 2
 * (`data-access-line-seed.ts`), in one rolled-back transaction, each person in a savepoint after
 * `applyDataAccess`.
 *
 * Every object type (application, asset, technology, project, request, contract) is linked to L1
 * and L5; a twin of each is linked to L1 only. Rita (INF-FR edit, INF read) reads L1, not L5.
 * Ulla has access to all data.
 *
 * - Panels: Rita sees L1 and "1 line outside your access"; Ulla sees both and none hidden; a person
 *   without the budget right (limited or not) gets no names and the count of every linked line.
 * - Deletes: refused to Rita (403 `DATA_ACCESS_LIMITED`, "This application is linked to 1 line
 *   outside your access.") when the object carries a hidden link, announced by the delete check
 *   with the refusal code and the count; allowed for the twin, and for Ulla.
 * - Replacements from the object's side keep the hidden link (the contract's by
 *   `contract_spend_items` too); a hidden link cannot be removed (400, as a missing line).
 * - The audit row of Rita's replacement records the ids she replaced and `hidden_kept`, never the
 *   hidden ids; Ulla's audit row keeps its former shape.
 *
 * Needs the role kanap_data_limited (CI installs it); skipped without it, failed in CI.
 */

const dataSource = new DataSource({ ...(appDataSource.options as any), poolSize: 2 });

type Owner = 'application' | 'asset' | 'technology' | 'project' | 'request' | 'contract';
const OWNERS: Owner[] = ['application', 'asset', 'technology', 'project', 'request', 'contract'];

/** The link table of each type, as its Relations tab reads it. */
const LINKS: Record<Exclude<Owner, 'contract'>, RelationLinkTable> = {
  application: { links: 'application_spend_items', owner: 'application_id' },
  asset: { links: 'asset_spend_items', owner: 'asset_id' },
  technology: { links: 'technology_spend_items', owner: 'technology_id' },
  project: { links: 'portfolio_project_opex', owner: 'project_id', target: 'opex_id' },
  request: { links: 'portfolio_request_opex', owner: 'request_id', target: 'opex_id' },
};
const CONTRACT_LINKS: RelationLinkTable = { links: 'contract_spend_items', owner: 'contract_id' };
const linksOf = (owner: Owner): RelationLinkTable => (owner === 'contract' ? CONTRACT_LINKS : LINKS[owner]);

/** Per type: the object linked to L1 and L5 (`both`), and its twin linked to L1 only (`one`). */
type Objects = Record<Owner, { both: string; one: string }>;

function clientOf(runner: QueryRunner): PgClient {
  return { query: async (sql: string, params?: unknown[]) => ({ rows: await runner.query(sql, params as any[]) }) } as unknown as PgClient;
}

/** A stand-in for any service: every member is a function resolving to undefined. Not a thenable. */
function stub(): any {
  const fn = () => Promise.resolve(undefined);
  return new Proxy({}, { get: (_target, prop) => (prop === 'then' || typeof prop === 'symbol' ? undefined : fn) });
}

/** Runs `fn` as `person` in a savepoint, rolled back after. */
async function as(runner: QueryRunner, person: string, fn: (m: EntityManager) => Promise<void>): Promise<void> {
  await runner.query('SAVEPOINT person');
  try {
    await applyDataAccess(runner, person);
    await fn(runner.manager);
  } finally {
    await runner.query('ROLLBACK TO SAVEPOINT person');
  }
}

async function seedObjects(runner: QueryRunner, s: Seed): Promise<Objects> {
  const q = (sql: string, params?: unknown[]) => runner.query(sql, params as any[]);
  let n = 9000;
  const insert = async (sql: string, name: string, numbered = false) =>
    (await q(sql, numbered ? [name, n++] : [name]))[0].id as string;
  const supplier = (await q(`INSERT INTO suppliers (tenant_id, name) VALUES (app_current_tenant(), 'DA 4B supplier') RETURNING id`))[0].id;
  const make: Record<Owner, (name: string) => Promise<string>> = {
    application: (name) => insert(`INSERT INTO applications (tenant_id, name) VALUES (app_current_tenant(), $1) RETURNING id`, name),
    asset: (name) => insert(`INSERT INTO assets (tenant_id, name, kind, environment) VALUES (app_current_tenant(), $1, 'server', 'prod') RETURNING id`, name),
    technology: (name) => insert(`INSERT INTO technologies (tenant_id, name, item_number) VALUES (app_current_tenant(), $1, $2) RETURNING id`, name, true),
    project: (name) => insert(`INSERT INTO portfolio_projects (tenant_id, name, item_number) VALUES (app_current_tenant(), $1, $2) RETURNING id`, name, true),
    request: (name) => insert(`INSERT INTO portfolio_requests (tenant_id, name, item_number) VALUES (app_current_tenant(), $1, $2) RETURNING id`, name, true),
    // The contract is placed at INF-FR, Rita's edit centre (lot 5 scopes contracts: a contract on
    // FR without a place is outside her access and answers as missing).
    contract: async (name) => (await q(
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, cost_center_id)
       VALUES (app_current_tenant(), $1, $2, $3, '2026-01-01', $4) RETURNING id`,
      [name, s.fr, supplier, s.infFr],
    ))[0].id as string,
  };
  const objects = {} as Objects;
  for (const owner of OWNERS) {
    const both = await make[owner](`DA 4B ${owner} both`);
    const one = await make[owner](`DA 4B ${owner} one`);
    const t = linksOf(owner);
    const line = t.target ?? 'spend_item_id';
    for (const [id, lines] of [[both, [s.lines.L1, s.lines.L5]], [one, [s.lines.L1]]] as const) {
      for (const lineId of lines) {
        await q(`INSERT INTO ${t.links} (tenant_id, ${t.owner}, ${line}) VALUES (app_current_tenant(), $1, $2)`, [id, lineId]);
      }
    }
    objects[owner] = { both, one };
  }
  return objects;
}

/**
 * The lines linked to an object, read under the application role (every link): in a savepoint
 * that leaves the person's role, rolled back after, which takes the role back.
 */
async function storedLines(runner: QueryRunner, owner: Owner, id: string): Promise<string[]> {
  const t = linksOf(owner);
  await runner.query('SAVEPOINT peek');
  try {
    await runner.query('RESET ROLE');
    const rows: Array<{ id: string }> = await runner.query(
      `SELECT ${t.target ?? 'spend_item_id'} AS id FROM ${t.links} WHERE tenant_id = app_current_tenant() AND ${t.owner} = $1 ORDER BY 1`,
      [id],
    );
    return rows.map((row) => row.id);
  } finally {
    await runner.query('ROLLBACK TO SAVEPOINT peek');
  }
}

const fxRates = new FxRateService(undefined as any, new CurrencySettingsService(undefined as any, undefined as any));

/** The panel of `owner` as its screen reads it: the listed line ids, or null, and the hidden count. */
async function panel(m: EntityManager, s: Seed, owner: Owner, id: string, readsBudget: boolean): Promise<{ ids: string[] | null; hidden: number }> {
  if (owner === 'contract') {
    const { items, hidden } = await listContractBudgetLines(m, { id, tenant_id: s.tenantId }, readsBudget);
    return { ids: readsBudget ? items.map((item) => item.id).sort() : null, hidden };
  }
  if (owner === 'project' || owner === 'request') {
    // The real Relations tab of a project and of a request.
    const service = new PortfolioRelationsService(stub(), stub(), fxRates as any, stub());
    const access = { budget_lines: readsBudget, applications: false, assets: false, technologies: false, source_requests: false, processes: false, resulting_projects: false };
    const ctx = { manager: m, tenantId: s.tenantId, userId: null, access } as any;
    const tab = owner === 'project' ? await service.getProjectRelations(id, ctx) : await service.getRequestRelations(id, ctx);
    return { ids: tab.budget_lines ? tab.budget_lines.map((line) => line.id).sort() : null, hidden: tab.budget_lines_hidden };
  }
  const section = await readRelatedBudgetLines(m, fxRates, LINKS[owner], owner, s.tenantId, id, 2026, 'planned', readsBudget);
  return { ids: section.budget_lines ? section.budget_lines.map((line) => line.id).sort() : null, hidden: section.budget_lines_hidden };
}

async function testPanels(runner: QueryRunner, s: Seed, o: Objects): Promise<void> {
  const { L1, L5 } = s.lines;
  const both = [L1, L5].sort();
  await as(runner, s.persons.rita, async (m) => {
    for (const owner of OWNERS) {
      assert.deepEqual(await panel(m, s, owner, o[owner].both, true), { ids: [L1], hidden: 1 }, `rita, ${owner}: L1 listed, L5 counted`);
      assert.deepEqual(await panel(m, s, owner, o[owner].one, true), { ids: [L1], hidden: 0 }, `rita, ${owner} twin: nothing hidden`);
      assert.deepEqual(await panel(m, s, owner, o[owner].both, false), { ids: null, hidden: 2 }, `rita without the budget right, ${owner}: count only`);
    }
  });
  await as(runner, s.persons.ulla, async (m) => {
    for (const owner of OWNERS) {
      assert.deepEqual(await panel(m, s, owner, o[owner].both, true), { ids: both, hidden: 0 }, `ulla, ${owner}: both listed`);
      assert.deepEqual(await panel(m, s, owner, o[owner].both, false), { ids: null, hidden: 2 }, `ulla without the budget right, ${owner}: count only, no names`);
    }
  });
  console.log('  panels: visible lines then the hidden count (limited), all lines (unscoped), count only without the budget right: OK');
}

/** The Relations badge of an application counts the budget lines its tab shows: listed and counted. */
async function testApplicationBadge(runner: QueryRunner, s: Seed, o: Objects): Promise<void> {
  const crud = new ApplicationsCrudService(undefined as any, undefined as any, undefined as any, undefined as any, undefined as any);
  const budget = (m: EntityManager, readsBudget: boolean) => crud.relationCounts(o.application.both, { manager: m, tenantId: s.tenantId, readsBudget })
    .then((c) => ({ listed: c.opex + c.capex, hidden: c.budget_lines_hidden, rest: c.total - c.opex - c.capex - c.budget_lines_hidden }));
  await as(runner, s.persons.rita, async (m) => {
    assert.deepEqual(await budget(m, true), { listed: 1, hidden: 1, rest: 0 }, 'rita: L1 listed, L5 counted, both in the badge');
    assert.deepEqual(await budget(m, false), { listed: 0, hidden: 2, rest: 0 }, 'rita without the budget right: the two lines counted');
  });
  await as(runner, s.persons.ulla, async (m) => {
    assert.deepEqual(await budget(m, true), { listed: 2, hidden: 0, rest: 0 }, 'ulla: both listed');
  });
  console.log('  application badge: the listed lines plus the counted ones: OK');
}

function refusedForHiddenLines(owner: string, count: number) {
  return (err: any) => {
    assert.ok(err instanceof DataAccessHiddenLinesException, `${owner}: ${err?.message}`);
    assert.equal(err.getStatus(), 403);
    const body = err.getResponse() as any;
    assert.equal(body.code, 'DATA_ACCESS_LIMITED');
    assert.equal(body.message, `This ${owner} is linked to ${count} ${count === 1 ? 'line' : 'lines'} outside your access.`);
    return true;
  };
}

async function testDeletes(runner: QueryRunner, s: Seed, o: Objects): Promise<void> {
  const audit = new AuditService(dataSource.getRepository(AuditLog));
  const applications = new ApplicationsDeleteService(dataSource.getRepository(Application), audit, stub(), stub());
  const assets = new AssetsDeleteService(dataSource.getRepository(Asset), audit);
  const technologies = new TechnologiesDeleteService(audit, stub());
  const requests = new PortfolioRequestsService(dataSource.getRepository(PortfolioRequest), audit, stub(), stub(), stub(), stub(), stub(), stub(), stub());
  const deleteOf: Record<'application' | 'asset' | 'technology' | 'request', (m: EntityManager, id: string, user: string) => Promise<unknown>> = {
    application: (m, id, user) => applications.delete(id, { manager: m, userId: user }),
    asset: (m, id, user) => assets.deleteAsset(id, s.tenantId, user, { manager: m }),
    technology: (m, id, user) => technologies.delete(id, { manager: m, tenantId: s.tenantId, userId: user }),
    request: (m, id, user) => requests.delete(id, user, { manager: m }),
  };
  const checkOf: Record<'application' | 'asset' | 'technology', (m: EntityManager, ids: string[]) => Promise<{ refused: any[]; removes?: any[] }>> = {
    application: (m, ids) => applications.deleteCheck(ids, { manager: m }),
    asset: (m, ids) => assets.deleteCheck(ids, s.tenantId, { manager: m }),
    technology: (m, ids) => technologies.deleteCheck(ids, { manager: m, tenantId: s.tenantId }),
  };
  const codes = { application: 'APPLICATION_HIDDEN_LINES', asset: 'ASSET_HIDDEN_LINES', technology: 'TECHNOLOGY_HIDDEN_LINES' } as const;

  for (const owner of ['application', 'asset', 'technology', 'request'] as const) {
    await as(runner, s.persons.rita, async (m) => {
      if (owner !== 'request') {
        const check = await checkOf[owner](m, [o[owner].both, o[owner].one]);
        assert.deepEqual(
          check.refused.map((r) => ({ id: r.id, code: r.code, params: r.params, usages: r.usages })),
          [{ id: o[owner].both, code: codes[owner], params: { count: 1 }, usages: [] }],
          `rita, ${owner}: the delete check announces the refusal, with the count`,
        );
      }
      await assert.rejects(() => deleteOf[owner](m, o[owner].both, s.persons.rita), refusedForHiddenLines(owner, 1));
      assert.deepEqual(await storedLines(runner, owner, o[owner].both), [s.lines.L1, s.lines.L5].sort(), `rita, ${owner}: nothing deleted`);
      await deleteOf[owner](m, o[owner].one, s.persons.rita);
    });
    await as(runner, s.persons.ulla, async (m) => {
      if (owner !== 'request') assert.deepEqual((await checkOf[owner](m, [o[owner].both])).refused, [], `ulla, ${owner}: nothing refused`);
      await deleteOf[owner](m, o[owner].both, s.persons.ulla);
    });
  }
  // A bulk delete lists the refused item with its code and count.
  await as(runner, s.persons.rita, async (m) => {
    const result = await applications.bulkDelete([o.application.both], s.persons.rita, { manager: m });
    assert.deepEqual(result.deleted, []);
    assert.equal(result.failed[0]?.code, 'APPLICATION_HIDDEN_LINES');
    assert.deepEqual(result.failed[0]?.params, { count: 1 });
    const technologyResult = await technologies.bulkDelete([o.technology.both], { manager: m, tenantId: s.tenantId, userId: s.persons.rita });
    assert.equal((technologyResult.failed[0] as any)?.code, 'TECHNOLOGY_HIDDEN_LINES');
  });
  console.log('  deletes: refused with hidden lines (403, announced by the check, bulk failure coded), allowed without, unscoped unchanged: OK');
}

/** The newest audit row of the record, as the application role reads it. */
async function lastAudit(runner: QueryRunner, recordId: string): Promise<{ table_name: string; before_json: any; after_json: any }> {
  const [row] = await runner.query(
    `SELECT table_name, before_json, after_json FROM audit_log WHERE tenant_id = app_current_tenant() AND record_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
    [recordId],
  );
  return row;
}

async function testReplacements(runner: QueryRunner, s: Seed, o: Objects): Promise<void> {
  const { L1, L5 } = s.lines;
  const audit = new AuditService(dataSource.getRepository(AuditLog));
  const appLinks = new ApplicationsInstancesService(dataSource.getRepository(Application), dataSource.getRepository(PortfolioProject), audit);
  const assetLinks = new AssetsRelationsService(
    dataSource.getRepository(Asset), dataSource.getRepository(AssetRelation), dataSource.getRepository(AssetSpendItemLink),
    dataSource.getRepository(AssetContractLink), audit,
  );
  const projects = new PortfolioProjectsCrudService(dataSource.getRepository(PortfolioProject), dataSource.getRepository(PortfolioRequest), audit, stub(), stub(), stub(), stub());
  const requests = new PortfolioRequestsService(dataSource.getRepository(PortfolioRequest), audit, stub(), stub(), stub(), stub(), stub(), stub(), stub());
  const contracts = new ContractsService(
    dataSource.getRepository(Contract), dataSource.getRepository(ContractSpendItem), stub(), stub(), audit, stub(), stub(), stub(), stub(), fxRates,
  );
  const rita = s.persons.rita;
  const replaceAll: Record<Exclude<Owner, 'technology'>, (m: EntityManager, id: string) => Promise<unknown>> = {
    application: (m, id) => appLinks.bulkReplaceLinkedSpendItems(id, [], rita, { manager: m }),
    asset: (m, id) => assetLinks.bulkReplaceLinkedSpendItems(id, [], s.tenantId, rita, { manager: m, tenantId: s.tenantId }),
    project: (m, id) => projects.bulkReplaceOpex(id, [], { manager: m, userId: rita }),
    request: (m, id) => requests.bulkReplaceOpex(id, [], { manager: m, userId: rita }),
    contract: (m, id) => contracts.bulkReplaceLinkedSpendItems(id, [], { manager: m }),
  };
  for (const owner of Object.keys(replaceAll) as Array<keyof typeof replaceAll>) {
    await as(runner, rita, async (m) => {
      await replaceAll[owner](m, o[owner].both);
      assert.deepEqual(await storedLines(runner, owner, o[owner].both), [L5], `rita, ${owner}: L1 removed, the hidden L5 kept`);
    });
  }
  await as(runner, rita, async (m) => {
    // The contract's Budget tab replacement (both natures), with its audit row.
    await replaceContractRelations({ manager: m, audit }, 'budget_lines', { id: o.contract.both, tenant_id: s.tenantId }, [], rita);
    assert.deepEqual(await storedLines(runner, 'contract', o.contract.both), [L5], 'rita, contract Budget tab: the hidden L5 kept');
    assert.deepEqual((await lastAudit(runner, o.contract.both)).after_json, { ids: [], hidden_kept: 1 }, 'contract audit: hidden lines counted');
    // The application's replacement and its audit row: the ids replaced, and the hidden count.
    await appLinks.bulkReplaceLinkedSpendItems(o.application.both, [], rita, { manager: m });
    const row = await lastAudit(runner, o.application.both);
    assert.equal(row.table_name, 'application_spend_items');
    assert.deepEqual(row.before_json, { ids: [L1], hidden_kept: 1 }, 'application audit before: L1, one hidden line');
    assert.deepEqual(row.after_json, { ids: [], hidden_kept: 1 }, 'application audit after: no visible line, the hidden one kept');
    assert.ok(!JSON.stringify(row).includes(L5), 'the audit row never names the hidden line');
    await assetLinks.bulkReplaceLinkedSpendItems(o.asset.both, [L1], s.tenantId, rita, { manager: m, tenantId: s.tenantId });
    assert.deepEqual((await lastAudit(runner, o.asset.both)).after_json, { ids: [L1], hidden_kept: 1 }, 'asset audit after');
    // A hidden link is not addressable: removing it answers as a missing line.
    await assert.rejects(
      () => setOwnedLink({
        manager: m, userId: rita, kind: 'budget_lines', targetId: L5, add: false, allowed: true,
        loadOwner: async () => ({ id: o.application.both, tenantId: s.tenantId }),
        owner: { table: 'applications', idColumn: 'id' }, ownerNotFound: 'Application not found',
        link: { table: 'application_spend_items', ownerColumn: 'application_id', targetColumn: 'spend_item_id', notFound: 'Budget line not found.' },
        audit,
      }),
      (err: any) => err?.getStatus?.() === 400 && err.message === 'Budget line not found.',
    );
    const portfolio = new PortfolioRelationsService(stub(), stub(), fxRates as any, audit);
    await assert.rejects(
      () => portfolio.setProjectLink(
        'budget_lines', L5, false,
        { manager: m, tenantId: s.tenantId, userId: rita, access: { budget_lines: true } } as any,
        async () => ({ id: o.project.both, tenantId: s.tenantId }),
      ),
      (err: any) => err?.getStatus?.() === 400,
    );
    // One link added from the Relations tab: its audit row counts the hidden line too.
    await setOwnedLink({
      manager: m, userId: rita, kind: 'budget_lines', targetId: L1, add: true, allowed: true,
      loadOwner: async () => ({ id: o.application.both, tenantId: s.tenantId }),
      owner: { table: 'applications', idColumn: 'id' }, ownerNotFound: 'Application not found',
      link: { table: 'application_spend_items', ownerColumn: 'application_id', targetColumn: 'spend_item_id', notFound: 'Budget line not found.' },
      audit,
    });
    assert.deepEqual((await lastAudit(runner, o.application.both)).after_json, { ids: [L1], hidden_kept: 1 }, 'single link audit after');
  });
  await as(runner, s.persons.ulla, async (m) => {
    await appLinks.bulkReplaceLinkedSpendItems(o.application.both, [L1], s.persons.ulla, { manager: m });
    assert.deepEqual(await storedLines(runner, 'application', o.application.both), [L1], 'ulla replaces every link');
    assert.deepEqual((await lastAudit(runner, o.application.both)).after_json, [L1], 'ulla: the former audit shape');
  });
  console.log('  replacements: hidden links kept (application, asset, project, request, contract both forms), not removable, audits count them: OK');
}

async function run() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  try {
    if (!(await roleExists(clientOf(runner)))) {
      if (process.env.CI) assert.fail(`CI installs ${LIMITED_ROLE} before the migrations (infra/scripts/data-access-role.sql)`);
      console.log(`data access link panels: ${LIMITED_ROLE} not installed, skipped`);
      return;
    }
    console.log('data access link panels, deletes and replacements (lot 4, run 4B)');
    await runner.startTransaction();
    try {
      const s = await seed(clientOf(runner));
      const objects = await seedObjects(runner, s);
      await testPanels(runner, s, objects);
      await testApplicationBadge(runner, s, objects);
      await testDeletes(runner, s, objects);
      await testReplacements(runner, s, objects);
    } finally {
      await runner.rollbackTransaction();
    }
  } finally {
    await runner.release();
    await dataSource.destroy();
  }
  console.log('data-access-link-panels.spec: all passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
