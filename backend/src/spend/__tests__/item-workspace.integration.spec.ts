import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { countItemRelations, loadItemReferences } from '../item-workspace.util';

// What the OPEX and CAPEX workspaces read besides the line (item-workspace.util.ts):
// the labels of the line's references (one statement, the pickers' option
// shapes, the email only for a nameless owner) and the Relations tab counts
// (one statement, the lists' own rules: links to rows that exist), each with
// the tenant predicate besides RLS.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file in its serial database lane.

async function insertTenant(runner: QueryRunner): Promise<string> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Item workspace test', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `item-ws-${tenantId.slice(0, 8)}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  return tenantId;
}

async function seed(runner: QueryRunner, tenantId: string) {
  const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0].id as string;
  const supplier = await one(`INSERT INTO suppliers (tenant_id, name, erp_supplier_id) VALUES ($1, 'Société Test', 'ERP-1') RETURNING id`, [tenantId]);
  const chart = await one(`INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso) VALUES ($1, 'IWS', 'Chart', 'FR') RETURNING id`, [tenantId]);
  const company = await one(`INSERT INTO companies (tenant_id, name, country_iso, city, coa_id) VALUES ($1, 'Company W', 'FR', 'Lyon', $2) RETURNING id`, [tenantId, chart]);
  const account = await one(`INSERT INTO accounts (tenant_id, coa_id, account_number, account_name) VALUES ($1, $2, 6110, 'Licences') RETURNING id`, [tenantId, chart]);
  const role = await one(`INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Workspace role') RETURNING id`, [tenantId]);
  const owner = await one(
    `INSERT INTO users (tenant_id, role_id, first_name, last_name, email) VALUES ($1, $2, 'Anne', 'Martin', 'anne@example.invalid') RETURNING id`,
    [tenantId, role],
  );
  const nameless = await one(`INSERT INTO users (tenant_id, role_id, email) VALUES ($1, $2, 'nameless@example.invalid') RETURNING id`, [tenantId, role]);
  const opex = await one(
    `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, supplier_id, paying_company_id, account_id, owner_it_id, owner_business_id)
     VALUES ($1, 'Workspace line', 'EUR', '2026-01-01', 990001, $2, $3, $4, $5, $6) RETURNING id`,
    [tenantId, supplier, company, account, owner, nameless],
  );
  const capex = await one(
    `INSERT INTO capex_items (tenant_id, description, ppe_type, investment_type, priority, currency, effective_start, item_number, supplier_id)
     VALUES ($1, 'Workspace capex', 'software', 'other', 'medium', 'EUR', '2026-01-01', 990001, $2) RETURNING id`,
    [tenantId, supplier],
  );
  const group = await one(`INSERT INTO cost_centers (tenant_id, code, kind, name) VALUES ($1, 'IWS-G', 'group', 'Group W') RETURNING id`, [tenantId]);
  const costCenter = await one(
    `INSERT INTO cost_centers (tenant_id, code, kind, name, parent_id, company_id, owner_user_id) VALUES ($1, 'IWS-1', 'cost_center', 'Centre W', $2, $3, $4) RETURNING id`,
    [tenantId, group, company, owner],
  );
  // Past its end of validity, its stored status still 'enabled' (the hourly sync has not run).
  const expired = await one(
    `INSERT INTO cost_centers (tenant_id, code, kind, name, company_id, owner_user_id, disabled_at) VALUES ($1, 'IWS-2', 'cost_center', 'Old W', $2, $3, now() - interval '1 day') RETURNING id`,
    [tenantId, company, nameless],
  );
  return { supplier, company, account, owner, nameless, opex, capex, costCenter, expired };
}

async function testReferences() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = await insertTenant(runner);
    const ids = await seed(runner, tenantId);
    const refs = await loadItemReferences(runner.manager, {
      tenant_id: tenantId,
      supplier_id: ids.supplier,
      paying_company_id: ids.company,
      account_id: ids.account,
      owner_it_id: ids.owner,
      owner_business_id: ids.nameless,
      cost_center_id: ids.costCenter,
    });
    assert.deepEqual(refs.supplier, { id: ids.supplier, name: 'Société Test', erp_supplier_id: 'ERP-1', status: 'enabled' });
    assert.deepEqual(refs.paying_company, { id: ids.company, name: 'Company W' });
    assert.equal(refs.account?.account_number, 6110);
    assert.equal(refs.account?.account_name, 'Licences');
    assert.deepEqual(refs.owner_it, { id: ids.owner, first_name: 'Anne', last_name: 'Martin', email: null }, 'no email for a person with a name');
    assert.equal(refs.owner_business?.email, 'nameless@example.invalid', 'the email of a nameless owner, the only label it has');
    assert.deepEqual(refs.cost_center, {
      id: ids.costCenter, code: 'IWS-1', name: 'Centre W', kind: 'cost_center', status: 'enabled',
      company_id: ids.company, company_name: 'Company W', owner_user_id: ids.owner, owner_name: 'Anne Martin',
    }, 'the cost center as the tree shows it: its company and budget holder');
    const expired = await loadItemReferences(runner.manager, { tenant_id: tenantId, cost_center_id: ids.expired });
    assert.equal(expired.cost_center?.status, 'disabled', 'the effective status: past its end of validity');
    assert.equal(expired.cost_center?.owner_name, 'nameless@example.invalid', 'a nameless budget holder reads as the email, as in the tree');

    const empty = await loadItemReferences(runner.manager, { tenant_id: tenantId });
    assert.deepEqual(empty, { supplier: null, paying_company: null, account: null, owner_it: null, owner_business: null, cost_center: null });

    // Another tenant's session cannot reach these rows through the predicate.
    const other = await loadItemReferences(runner.manager, { tenant_id: randomUUID(), supplier_id: ids.supplier, cost_center_id: ids.costCenter });
    assert.equal(other.supplier, null, "the line's tenant predicate keeps another tenant's ids out");
    assert.equal(other.cost_center, null, "nor another tenant's cost center");
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
  console.log('ok - references: picker shapes in one statement, email only for a nameless owner');
}

async function testRelationCounts() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = await insertTenant(runner);
    const ids = await seed(runner, tenantId);
    const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0].id as string;
    const contract = await one(
      `INSERT INTO contracts (tenant_id, name, start_date, supplier_id, company_id) VALUES ($1, 'Contract W', '2026-01-01', $2, $3) RETURNING id`,
      [tenantId, ids.supplier, ids.company],
    );
    const app = await one(`INSERT INTO applications (tenant_id, name) VALUES ($1, 'App W') RETURNING id`, [tenantId]);
    const project = await one(`INSERT INTO portfolio_projects (tenant_id, name, item_number) VALUES ($1, 'Project W', 990001) RETURNING id`, [tenantId]);

    assert.deepEqual(
      await countItemRelations(runner.manager, 'opex', { id: ids.opex, tenant_id: tenantId }),
      { contracts: 0, applications: 0, projects: 0, links: 0, attachments: 0, total: 0 },
    );

    await runner.query(`INSERT INTO contract_spend_items (tenant_id, contract_id, spend_item_id) VALUES ($1, $2, $3)`, [tenantId, contract, ids.opex]);
    await runner.query(`INSERT INTO application_spend_items (tenant_id, application_id, spend_item_id) VALUES ($1, $2, $3)`, [tenantId, app, ids.opex]);
    await runner.query(`INSERT INTO portfolio_project_opex (tenant_id, project_id, opex_id) VALUES ($1, $2, $3)`, [tenantId, project, ids.opex]);
    await runner.query(`INSERT INTO spend_links (tenant_id, spend_item_id, url) VALUES ($1, $2, 'https://a.invalid'), ($1, $2, 'https://b.invalid')`, [tenantId, ids.opex]);
    await runner.query(
      `INSERT INTO spend_attachments (tenant_id, spend_item_id, original_filename, stored_filename, mime_type, size, storage_path)
       VALUES ($1, $2, 'a.pdf', 'a.pdf', 'application/pdf', 1, 'x/a.pdf')`,
      [tenantId, ids.opex],
    );
    assert.deepEqual(
      await countItemRelations(runner.manager, 'opex', { id: ids.opex, tenant_id: tenantId }),
      { contracts: 1, applications: 1, projects: 1, links: 2, attachments: 1, total: 6 },
    );

    await runner.query(`INSERT INTO contract_capex_items (tenant_id, contract_id, capex_item_id) VALUES ($1, $2, $3)`, [tenantId, contract, ids.capex]);
    await runner.query(`INSERT INTO portfolio_project_capex (tenant_id, project_id, capex_id) VALUES ($1, $2, $3)`, [tenantId, project, ids.capex]);
    await runner.query(`INSERT INTO capex_links (tenant_id, capex_item_id, url) VALUES ($1, $2, 'https://c.invalid')`, [tenantId, ids.capex]);
    assert.deepEqual(
      await countItemRelations(runner.manager, 'capex', { id: ids.capex, tenant_id: tenantId }),
      { contracts: 1, applications: 0, projects: 1, links: 1, attachments: 0, total: 3 },
    );

    assert.equal(
      (await countItemRelations(runner.manager, 'opex', { id: ids.opex, tenant_id: randomUUID() })).total,
      0,
      'counted under the line tenant only',
    );
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
  console.log('ok - relation counts: one statement per line, OPEX and CAPEX tables');
}

async function main() {
  await dataSource.initialize();
  try {
    await testReferences();
    await testRelationCounts();
    console.log('item-workspace.integration.spec: ok');
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
