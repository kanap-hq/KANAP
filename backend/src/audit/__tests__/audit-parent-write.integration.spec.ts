// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditService } from '../audit.service';
import { AuditLog } from '../audit.entity';
import { ItemNumberService } from '../../common/item-number.service';
import { ExternalContact } from '../../contacts/external-contact.entity';
import { SupplierContactRole } from '../../contacts/supplier-contact.entity';
import { CapexItemsService, SpendItemsService } from '../../spend/spend-items.service';
import { CapexItemContactsService, SpendItemContactsService } from '../../spend/spend-item-contacts.service';
import { CapexAmountsService, SpendAmountsService } from '../../spend/spend-amounts.service';
import { CapexAllocationsService, SpendAllocationsService } from '../../spend/spend-allocations.service';
import { SpendAllocation } from '../../spend/spend-allocation.entity';
import { SpendAmount } from '../../spend/spend-amount.entity';
import { SpendItem } from '../../spend/spend-item.entity';
import { SpendItemContactLink } from '../../spend/spend-item-contact.entity';
import { SpendVersion } from '../../spend/spend-version.entity';
import { assert, inRolledBackTransaction, noFreeze, runSpecs, seedTenant, setTenant, type Kind } from '../../spend/__tests__/round-inputs.fixtures';
import { seedCompany } from '../../spend/__tests__/cost-center.fixtures';
import { replaceItemApplications } from '../../spend/item-applications';
import { replaceItemTechnologies } from '../../spend/item-technologies';
import { setBudgetLineRelation } from '../../spend/budget-line-relations';
import { replaceContractRelations } from '../../contracts/contract-relations';
import { Application } from '../../applications/application.entity';
import { PortfolioProject } from '../../portfolio/portfolio-project.entity';
import { ApplicationsInstancesService } from '../../applications/services/applications-instances.service';
import { TechnologiesRelationsService } from '../../technologies/technologies-relations.service';
import { Asset } from '../../assets/asset.entity';
import { AssetRelation } from '../../assets/asset-relation.entity';
import { AssetSpendItemLink } from '../../assets/asset-spend-item.entity';
import { AssetContractLink } from '../../assets/asset-contract.entity';
import { AssetsRelationsService } from '../../assets/services/assets-relations.service';
import { AssetRelationsTabService } from '../../assets/asset-relations-tab.service';

// The write path of the audit parent (plan record-history, lot 1A): the real services create an
// OPEX line and a CAPEX line, write an amount, a link, an attachment (then remove it), a contact
// and an allocation method. Every child audit row carries `parent_table = 'spend_items'` and the
// line's id; the line's own rows keep both NULL, and its history is read by record_id.
// The application, technology and asset links share one label per side pair: written from the
// line they name the line; written from the application or technology they name no parent (never
// the application itself); written from the asset they name the line only when one line changed.
// @database-spec: the data source of the migrated test database.

const YEAR = 2026;

/** The audit labels of the two natures, written out (the code under test uses `auditTableOf`). */
const LABELS: Record<Kind, Record<'items' | 'versions' | 'amounts' | 'allocations' | 'links' | 'attachments' | 'contacts', string>> = {
  opex: {
    items: 'spend_items', versions: 'spend_versions', amounts: 'spend_amounts', allocations: 'spend_allocations',
    links: 'spend_links', attachments: 'spend_attachments', contacts: 'spend_item_contacts',
  },
  capex: {
    items: 'capex_items', versions: 'capex_versions', amounts: 'capex_amounts', allocations: 'capex_allocations',
    links: 'capex_links', attachments: 'capex_attachments', contacts: 'capex_item_contacts',
  },
};

const realAudit = (runner: QueryRunner) => new AuditService(runner.manager.getRepository(AuditLog));

function itemsService(kind: Kind, runner: QueryRunner, audit: AuditService, storage?: unknown): SpendItemsService {
  const args: any[] = Array.from({ length: 11 }, () => undefined);
  args[0] = runner.manager.getRepository(SpendItem);
  args[3] = audit;
  args[7] = storage;
  args[10] = new ItemNumberService();
  return kind === 'opex' ? new (SpendItemsService as any)(...args) : new (CapexItemsService as any)(...args);
}

function contactsService(kind: Kind, runner: QueryRunner, audit: AuditService): SpendItemContactsService {
  const linkRepo = runner.manager.getRepository(SpendItemContactLink);
  const contactRepo = runner.manager.getRepository(ExternalContact);
  const itemRepo = runner.manager.getRepository(SpendItem);
  return kind === 'opex'
    ? new SpendItemContactsService(linkRepo, contactRepo, itemRepo, audit)
    : new CapexItemContactsService(linkRepo, contactRepo, itemRepo, audit);
}

function amountsService(kind: Kind, runner: QueryRunner, audit: AuditService): SpendAmountsService {
  return kind === 'opex'
    ? new SpendAmountsService(runner.manager.getRepository(SpendAmount), undefined as any, runner.manager.getRepository(SpendVersion), audit, noFreeze as any)
    : new CapexAmountsService(runner.manager.getRepository(SpendAmount), undefined as any, runner.manager.getRepository(SpendVersion), audit, noFreeze as any);
}

function allocationsService(kind: Kind, runner: QueryRunner, audit: AuditService): SpendAllocationsService {
  // A manual split needs no computation; the read-back asks the calculator for a distribution.
  const calculator = { computeForVersions: async () => new Map(), fxRates: undefined };
  return kind === 'opex'
    ? new SpendAllocationsService(runner.manager.getRepository(SpendAllocation), runner.manager.getRepository(SpendVersion), calculator as any, audit)
    : new CapexAllocationsService(runner.manager.getRepository(SpendAllocation), runner.manager.getRepository(SpendVersion), calculator as any, audit);
}

async function createLine(kind: Kind, runner: QueryRunner, audit: AuditService, companyId: string): Promise<string> {
  const body = kind === 'opex'
    ? { product_name: 'History OPEX', currency: 'EUR', effective_start: `${YEAR}-01-01`, paying_company_id: companyId }
    : { description: 'History CAPEX', currency: 'EUR', effective_start: `${YEAR}-01-01`, paying_company_id: companyId };
  const created = await itemsService(kind, runner, audit).create(body, undefined, { manager: runner.manager });
  return String(created.id);
}

async function seedVersion(runner: QueryRunner, tenantId: string, itemId: string): Promise<string> {
  const [row] = await runner.query(
    `INSERT INTO spend_versions (tenant_id, spend_item_id, version_name, input_grain, as_of_date, budget_year)
     VALUES ($1, $2, 'Y2026', 'monthly', '2026-01-01', $3) RETURNING id`,
    [tenantId, itemId, YEAR],
  );
  return row.id;
}

async function seedContact(runner: QueryRunner, tenantId: string): Promise<string> {
  const [row] = await runner.query(
    `INSERT INTO contacts (tenant_id, first_name, last_name, email) VALUES ($1, 'History', 'Contact', $2) RETURNING id`,
    [tenantId, `${randomUUID()}@history.example`],
  );
  return row.id;
}

type AuditRow = {
  table_name: string;
  record_id: string;
  action: string;
  parent_table: string | null;
  parent_id: string | null;
  after_json: any;
};

async function auditRows(runner: QueryRunner, tenantId: string, lineId: string, versionId: string): Promise<AuditRow[]> {
  return runner.query(
    `SELECT table_name, record_id, action, parent_table, parent_id, after_json
       FROM audit_log
      WHERE tenant_id = $1 AND (record_id = $2 OR parent_id = $2 OR record_id = $3)
      ORDER BY created_at, id`,
    [tenantId, lineId, versionId],
  );
}

async function testNature(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `audit-parent-${kind}`);
    await setTenant(runner, tenantId);
    const audit = realAudit(runner);
    const { companyId } = await seedCompany(runner, tenantId, `Audit parent ${kind}`);
    const contactId = await seedContact(runner, tenantId);
    const storage = { putObject: async () => undefined, deleteObject: async () => undefined };
    const items = itemsService(kind, runner, audit, storage);

    const lineId = await createLine(kind, runner, audit, companyId);
    const versionId = await seedVersion(runner, tenantId, lineId);

    // An amount (its round input rides along on some writes).
    await amountsService(kind, runner, audit).bulkUpsert(
      versionId,
      { kind: 'monthly', year: YEAR, months: [{ period: `${YEAR}-01-01`, planned: 100 }] },
      undefined,
      { manager: runner.manager },
    );
    // A web link.
    await items.createLink(lineId, { url: 'https://history.example/link', description: 'History link' }, undefined, { manager: runner.manager });
    // An attachment, then its removal: the history keeps both rows.
    const attachment = await items.uploadAttachment(
      lineId,
      { originalname: 'history.txt', mimetype: 'text/plain', buffer: Buffer.from('history'), size: 7 } as any,
      undefined,
      { manager: runner.manager },
    );
    await items.deleteAttachment(String(attachment.id), undefined, { manager: runner.manager });
    // A contact link.
    await contactsService(kind, runner, audit).attachManual(
      lineId,
      { contactId, role: SupplierContactRole.COMMERCIAL },
      undefined,
      { manager: runner.manager, tenantId },
    );
    // An allocation method: the version row and its allocation rows.
    await allocationsService(kind, runner, audit).put(
      versionId,
      { method: 'manual_pct', driver: null, rows: [{ company_id: companyId, allocation_pct: 100 }] },
      undefined,
      { manager: runner.manager, tenantId },
    );

    const labels = LABELS[kind];
    const rows = await auditRows(runner, tenantId, lineId, versionId);
    const lineRows = rows.filter((row) => row.table_name === labels.items && row.record_id === lineId);
    assert.equal(lineRows.length, 1, `${kind}: the line's own create row`);
    assert.equal(lineRows[0].parent_table, null, `${kind}: the line keeps parent_table NULL`);
    assert.equal(lineRows[0].parent_id, null, `${kind}: the line keeps parent_id NULL`);

    const childRows = rows.filter((row) => row !== lineRows[0]);
    assert.ok(childRows.length >= 8, `${kind}: every child write is audited (${childRows.length} rows)`);
    for (const row of childRows) {
      assert.equal(row.parent_table, 'spend_items', `${kind} ${row.table_name}: physical line table`);
      assert.equal(row.parent_id, lineId, `${kind} ${row.table_name}: the line`);
    }

    for (const label of [labels.amounts, labels.links, labels.attachments, labels.contacts, labels.versions, labels.allocations]) {
      assert.ok(rows.some((row) => row.table_name === label), `${kind}: an audit row for ${label}`);
    }
    const attachments = rows.filter((row) => row.table_name === labels.attachments);
    assert.equal(attachments.length, 2, `${kind}: the attachment create and its removal`);
    assert.equal(attachments.filter((row) => row.after_json === null).length, 1, `${kind}: the removal keeps a row with after NULL`);
    assert.equal(rows.filter((row) => row.table_name === labels.contacts).length, 1, `${kind}: one contact row`);
    assert.ok(rows.some((row) => row.table_name === labels.versions && row.after_json?.allocation_method === 'manual_pct'), `${kind}: the allocation method row`);
    assert.ok(rows.some((row) => row.table_name === labels.allocations), `${kind}: the allocation rows`);
  });
}

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  const [row] = await runner.query(`${sql} RETURNING id`, params);
  return row.id;
}

async function linkRows(runner: QueryRunner, tenantId: string, since: number): Promise<AuditRow[]> {
  const rows: AuditRow[] = await runner.query(
    `SELECT table_name, record_id, action, parent_table, parent_id, after_json
       FROM audit_log
      WHERE tenant_id = $1 AND table_name = ANY($2::text[])
      ORDER BY created_at, id`,
    [tenantId, [
      'application_spend_items', 'application_capex_items', 'technology_spend_items',
      'asset_spend_items', 'asset_capex_items',
      'contract_spend_items', 'contract_capex_items',
      'portfolio_project_opex', 'portfolio_project_capex',
      'portfolio_request_opex', 'portfolio_request_capex',
    ]],
  );
  return rows.slice(since);
}

async function testLinksFromBothSides() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'audit-parent-links');
    await setTenant(runner, tenantId);
    const audit = realAudit(runner);
    const manager = runner.manager;
    const { companyId } = await seedCompany(runner, tenantId, 'Audit parent links');
    const line = await createLine('opex', runner, audit, companyId);
    const second = await createLine('opex', runner, audit, companyId);
    const capexLine = await createLine('capex', runner, audit, companyId);
    const app = await insertId(runner, `INSERT INTO applications (tenant_id, name, sequential_id, status) VALUES ($1, 'History app', 'APP-1', 'enabled')`, [tenantId]);
    const tech = await insertId(runner, `INSERT INTO technologies (tenant_id, name, item_number) VALUES ($1, 'History tech', 1)`, [tenantId]);
    const asset = await insertId(runner, `INSERT INTO assets (tenant_id, name, kind, environment) VALUES ($1, 'srv-history', 'server', 'prod')`, [tenantId]);
    let seen = 0;
    const next = async (expected: number, what: string): Promise<AuditRow[]> => {
      const rows = await linkRows(runner, tenantId, seen);
      assert.equal(rows.length, expected, `${what}: ${expected} audit row(s)`);
      seen += rows.length;
      return rows;
    };
    const expectParent = (row: AuditRow, lineId: string | null, what: string) => {
      assert.equal(row.parent_id, lineId, `${what}: parent id`);
      assert.equal(row.parent_table, lineId ? 'spend_items' : null, `${what}: parent table`);
    };

    // From the line: the replacement of its applications and technologies, and one link.
    await replaceItemApplications({ manager, audit }, 'opex', { id: line, tenant_id: tenantId }, [app], null);
    await replaceItemApplications({ manager, audit }, 'capex', { id: capexLine, tenant_id: tenantId }, [app], null);
    await replaceItemTechnologies({ manager, audit }, 'opex', { id: line, tenant_id: tenantId }, [tech], null);
    const fromLine = await next(3, 'line-side replacements');
    expectParent(fromLine[0], line, 'application from the OPEX line');
    assert.equal(fromLine[1].table_name, 'application_capex_items');
    expectParent(fromLine[1], capexLine, 'application from the CAPEX line');
    expectParent(fromLine[2], line, 'technology from the line');
    const access = { applications: true, technologies: true, projects: true, contracts: true, assets: true } as any;
    await setBudgetLineRelation({ manager, audit }, 'applications', line, app, false, null, { access });
    await setBudgetLineRelation({ manager, audit }, 'technologies', second, tech, true, null, { access });
    const fromLineOne = await next(2, 'line-side single links');
    expectParent(fromLineOne[0], line, 'application unlinked from the line');
    expectParent(fromLineOne[1], second, 'technology linked from the second line');

    // From the application: one line or two, no parent, never the application.
    const instances = new ApplicationsInstancesService(manager.getRepository(Application), manager.getRepository(PortfolioProject), audit);
    await instances.bulkReplaceLinkedSpendItems(app, [line], null, { manager });
    await instances.bulkReplaceLinkedSpendItems(app, [line, second], null, { manager });
    for (const row of await next(2, 'application-side replacements')) {
      assert.equal(row.record_id, app, 'the application is the record');
      expectParent(row, null, 'application side');
    }

    // From the technology: one line unlinked, no parent.
    const technologies = new TechnologiesRelationsService(audit, undefined as any, undefined as any);
    await technologies.setLink('budget_lines', tech, line, false, { manager, tenantId, userId: null, access: { budget_lines: true } as any, writeIncidents: false } as any);
    const [fromTech] = await next(1, 'technology-side link');
    assert.equal(fromTech.record_id, tech);
    expectParent(fromTech, null, 'technology side');

    // From the asset: a replacement that changes one line names it, one that changes two names none.
    const assets = new AssetsRelationsService(
      manager.getRepository(Asset),
      manager.getRepository(AssetRelation),
      manager.getRepository(AssetSpendItemLink),
      manager.getRepository(AssetContractLink),
      audit,
    );
    await assets.bulkReplaceLinkedSpendItems(asset, [line], tenantId, null, { manager });
    await assets.bulkReplaceLinkedSpendItems(asset, [second], tenantId, null, { manager });
    const fromAsset = await next(2, 'asset-side replacements');
    expectParent(fromAsset[0], line, 'one line added from the asset');
    expectParent(fromAsset[1], null, 'one line swapped for another');
    const tab = new AssetRelationsTabService(assets, undefined as any, undefined as any, undefined as any, audit);
    const assetCtx = { manager, tenantId, userId: null, access: { budget_lines: true } as any, writes: { incidents: false }, scopes: {}, incidentViewer: undefined as any };
    await tab.setLink('budget_lines', asset, line, true, assetCtx as any);
    const [fromTab] = await next(1, 'asset-side link');
    assert.equal(fromTab.record_id, asset);
    expectParent(fromTab, line, 'one line linked from the asset tab');
  });
}

async function testBudgetLinkFamilies() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'audit-parent-budget-links');
    await setTenant(runner, tenantId);
    const audit = realAudit(runner);
    const manager = runner.manager;
    const { companyId } = await seedCompany(runner, tenantId, 'Audit parent budget links');
    const line = await createLine('opex', runner, audit, companyId);
    const second = await createLine('opex', runner, audit, companyId);
    const capexLine = await createLine('capex', runner, audit, companyId);
    const project = await insertId(
      runner,
      `INSERT INTO portfolio_projects (tenant_id, item_number, name) VALUES ($1, 41, 'History project')`,
      [tenantId],
    );
    const supplier = await insertId(runner, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'History supplier')`, [tenantId]);
    const contractOne = await insertId(
      runner,
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, status) VALUES ($1, 'History contract one', $2, $3, '2026-01-01', 'enabled')`,
      [tenantId, companyId, supplier],
    );
    const contractTwo = await insertId(
      runner,
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, status) VALUES ($1, 'History contract two', $2, $3, '2026-01-01', 'enabled')`,
      [tenantId, companyId, supplier],
    );
    const contractThree = await insertId(
      runner,
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, status) VALUES ($1, 'History contract three', $2, $3, '2026-01-01', 'enabled')`,
      [tenantId, companyId, supplier],
    );
    let seen = 0;
    const next = async (expected: number, what: string): Promise<AuditRow[]> => {
      const rows = await linkRows(runner, tenantId, seen);
      assert.equal(rows.length, expected, `${what}: ${expected} audit row(s)`);
      seen += rows.length;
      return rows;
    };
    const expectParent = (row: AuditRow, lineId: string | null, what: string) => {
      assert.equal(row.parent_id, lineId, `${what}: parent id`);
      assert.equal(row.parent_table, lineId ? 'spend_items' : null, `${what}: parent table`);
    };
    const access = { applications: true, technologies: true, projects: true, contracts: true, assets: true } as any;

    // From the line: a project and a contract name the line, whichever its nature.
    await setBudgetLineRelation({ manager, audit }, 'projects', line, project, true, null, { access });
    await setBudgetLineRelation({ manager, audit }, 'contracts', line, contractOne, true, null, { access });
    const fromLine = await next(2, 'line-side budget links');
    assert.equal(fromLine[0].table_name, 'portfolio_project_opex');
    expectParent(fromLine[0], line, 'project linked from the line');
    assert.equal(fromLine[1].table_name, 'contract_spend_items');
    expectParent(fromLine[1], line, 'contract linked from the line');

    await setBudgetLineRelation({ manager, audit }, 'contracts', capexLine, contractOne, true, null, { access });
    const [fromCapexLine] = await next(1, 'CAPEX contract link from the line');
    assert.equal(fromCapexLine.table_name, 'contract_capex_items');
    expectParent(fromCapexLine, capexLine, 'contract linked from the CAPEX line');

    // From the contract: one line changed names it, two changed name none.
    await replaceContractRelations({ manager, audit }, 'budget_lines', { id: contractTwo, tenant_id: tenantId }, [second], null);
    const [oneLine] = await next(1, 'contract-side replacement of one line');
    assert.equal(oneLine.table_name, 'contract_spend_items');
    assert.equal(oneLine.record_id, contractTwo);
    expectParent(oneLine, second, 'one line added from the contract');
    await replaceContractRelations({ manager, audit }, 'budget_lines', { id: contractThree, tenant_id: tenantId }, [line, second], null);
    const [twoLines] = await next(1, 'contract-side replacement of two lines');
    assert.equal(twoLines.record_id, contractThree);
    expectParent(twoLines, null, 'two lines added from the contract');
  });
}

async function run() {
  await testNature('opex');
  await testNature('capex');
}

runSpecs('audit-parent-write.integration.spec', [
  ['an OPEX line and a CAPEX line give their children a parent, the line stays NULL', run],
  ['a link written from the line names it; from the application or technology, no parent; from the asset, one changed line', testLinksFromBothSides],
  ['a contract or project link written from the line names it; from the contract, one line names it and two none', testBudgetLinkFamilies],
]);
