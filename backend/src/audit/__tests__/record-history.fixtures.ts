import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import { writeAuditLog, type AuditEntry } from '../audit.service';

/**
 * The fixtures of the record history specs (lot 1B): one tenant with a budget line of each nature,
 * the master data its references name, and the audit rows a line's history reads. The caller opens
 * the transaction and sets `app.current_tenant`; everything here runs in it.
 */

export type Level = 'reader' | 'contributor' | 'member' | 'admin';

export type Person = { id: string; email: string; tenant_id: string };

export type HistorySeed = {
  tenantId: string;
  companyA: string;
  companyB: string;
  costCenterA: string;
  supplier: string;
  contractA: string;
  contractB: string;
  project: string;
  request: string;
  application: string;
  technology: string;
  asset: string;
  contact: string;
  account: string;
  task: string;
  axis: string;
  categoryA: string;
  categoryB: string;
  opexLine: string;
  capexLine: string;
  hiddenLine: string;
  typeLine: string;
  pageLine: string;
  emptyPageLine: string;
  opexVersion: string;
  capexVersion: string;
  /** The line's reference owner, a user of the tenant (the user family). */
  owner: string;
};

export async function seedRole(
  runner: QueryRunner,
  tenantId: string,
  name: string,
  permissions: Record<string, Level>,
): Promise<string> {
  const [role] = await runner.query(
    `INSERT INTO roles (tenant_id, role_name) VALUES ($1, $2) RETURNING id`,
    [tenantId, `${name} ${randomUUID().slice(0, 8)}`],
  );
  for (const [resource, level] of Object.entries(permissions)) {
    await runner.query(
      `INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`,
      [tenantId, role.id, resource, level],
    );
  }
  return role.id as string;
}

export async function seedPerson(
  runner: QueryRunner,
  tenantId: string,
  names: { first: string; last: string },
  permissions: Record<string, Level>,
  options: { mode?: 'all' | 'limited'; nodeCompanyId?: string; exactRoleName?: string } = {},
): Promise<Person> {
  const roleId = options.exactRoleName
    ? await one(
      runner,
      `INSERT INTO roles (tenant_id, role_name) VALUES ($1, $2) RETURNING id`,
      [tenantId, options.exactRoleName],
    )
    : await seedRole(runner, tenantId, `${names.first} role`, permissions);
  if (options.exactRoleName) {
    for (const [resource, level] of Object.entries(permissions)) {
      await runner.query(
        `INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`,
        [tenantId, roleId, resource, level],
      );
    }
  }
  const email = `history-${randomUUID()}@example.invalid`;
  const [user] = await runner.query(
    `INSERT INTO users (tenant_id, role_id, first_name, last_name, email, status, data_access_mode)
     VALUES ($1, $2, $3, $4, $5, 'enabled', $6) RETURNING id`,
    [tenantId, roleId, names.first, names.last, email, options.mode ?? 'all'],
  );
  if (options.mode === 'limited' && options.nodeCompanyId) {
    await runner.query(
      `INSERT INTO user_data_access_nodes (tenant_id, user_id, node_type, company_id, access)
       VALUES ($1, $2, 'company', $3, 'edit')`,
      [tenantId, user.id, options.nodeCompanyId],
    );
  }
  return { id: user.id as string, email, tenant_id: tenantId };
}

async function one(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  const [row] = await runner.query(sql, params);
  return row.id as string;
}

async function seedLine(
  runner: QueryRunner,
  tenantId: string,
  input: { itemNumber: number; nature: 'opex' | 'capex'; name: string; companyId: string; centerId: string; supplierId: string; accountId: string; ownerId: string; projectId: string; contractId: string },
): Promise<string> {
  return one(
    runner,
    `INSERT INTO spend_items (tenant_id, item_number, nature, product_name, description, currency, effective_start,
                              paying_company_id, cost_center_id, supplier_id, account_id, owner_it_id, owner_business_id,
                              project_id, contract_id, status)
     VALUES ($1, $2, $3::text, $4, $5, 'EUR', '2026-01-01', $6, $7, $8, $9, $10, $10, $11, $12, 'enabled')
     RETURNING id`,
    [
      tenantId, input.itemNumber, input.nature, input.name, `${input.name} description`, input.companyId,
      input.centerId, input.supplierId, input.accountId, input.ownerId, input.projectId,
      input.nature === 'opex' ? input.contractId : null,
    ],
  );
}

/** A version row, read by the parent rule of its amounts and allocations. */
export async function seedVersion(runner: QueryRunner, tenantId: string, lineId: string, year: number, name: string): Promise<string> {
  return one(
    runner,
    `INSERT INTO spend_versions (tenant_id, spend_item_id, version_name, input_grain, as_of_date, budget_year, allocation_method)
     VALUES ($1, $2, $3, 'monthly', $4, $5, 'manual_pct') RETURNING id`,
    [tenantId, lineId, name, `${year}-01-01`, year],
  );
}

/** The tenant's lines, their master data and the rows their reference resolution reads. */
export async function seedHistoryData(runner: QueryRunner, tenantId: string): Promise<HistorySeed> {
  const companyA = await one(runner, `INSERT INTO companies (tenant_id, name, country_iso, city, status) VALUES ($1, 'Alpha Co', 'FR', 'Lyon', 'enabled') RETURNING id`, [tenantId]);
  const companyB = await one(runner, `INSERT INTO companies (tenant_id, name, country_iso, city, status) VALUES ($1, 'Beta Co', 'FR', 'Lyon', 'enabled') RETURNING id`, [tenantId]);
  const costCenterA = await one(
    runner,
    `INSERT INTO cost_centers (tenant_id, code, kind, name, company_id, status) VALUES ($1, 'CC-A', 'cost_center', 'Centre A', $2, 'enabled') RETURNING id`,
    [tenantId, companyA],
  );
  const costCenterB = await one(
    runner,
    `INSERT INTO cost_centers (tenant_id, code, kind, name, company_id, status) VALUES ($1, 'CC-B', 'cost_center', 'Centre B', $2, 'enabled') RETURNING id`,
    [tenantId, companyB],
  );
  const supplier = await one(runner, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Acme Supplies') RETURNING id`, [tenantId]);
  const contractA = await one(
    runner,
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, status) VALUES ($1, 'Support Contract', $2, $3, '2026-01-01', 'enabled') RETURNING id`,
    [tenantId, companyA, supplier],
  );
  const contractB = await one(
    runner,
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, status) VALUES ($1, 'Beta Contract', $2, $3, '2026-01-01', 'enabled') RETURNING id`,
    [tenantId, companyB, supplier],
  );
  const project = await one(
    runner,
    `INSERT INTO portfolio_projects (tenant_id, item_number, name) VALUES ($1, 7, 'Project Alpha') RETURNING id`,
    [tenantId],
  );
  const request = await one(
    runner,
    `INSERT INTO portfolio_requests (tenant_id, item_number, name) VALUES ($1, 11, 'Request Alpha') RETURNING id`,
    [tenantId],
  );
  const application = await one(
    runner,
    `INSERT INTO applications (tenant_id, name, sequential_id) VALUES ($1, 'Ledger App', 'APP-42') RETURNING id`,
    [tenantId],
  );
  const technology = await one(
    runner,
    `INSERT INTO technologies (tenant_id, item_number, name, family) VALUES ($1, 9, 'Postgres', 'database') RETURNING id`,
    [tenantId],
  );
  const asset = await one(
    runner,
    `INSERT INTO assets (tenant_id, name, asset_reference, kind, environment) VALUES ($1, 'Server One', 'AST-1', 'server', 'prod') RETURNING id`,
    [tenantId],
  );
  const contact = await one(
    runner,
    `INSERT INTO contacts (tenant_id, first_name, last_name, email) VALUES ($1, 'Cora', 'Contact', $2) RETURNING id`,
    [tenantId, `cora-${randomUUID()}@example.invalid`],
  );
  const coa = await one(
    runner,
    `INSERT INTO chart_of_accounts (tenant_id, code, name, scope, country_iso, is_default) VALUES ($1, 'FR', 'Local chart', 'COUNTRY', 'FR', true) RETURNING id`,
    [tenantId],
  );
  const account = await one(
    runner,
    `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name, status) VALUES ($1, $2, 4010, 'Software', 'enabled') RETURNING id`,
    [tenantId, coa],
  );
  const task = await one(
    runner,
    `INSERT INTO tasks (tenant_id, item_number, title, related_object_type, related_object_id) VALUES ($1, 5, 'Follow up', 'spend_item', $2) RETURNING id`,
    [tenantId, randomUUID()],
  );
  const axis = await one(
    runner,
    `INSERT INTO analytics_axes (tenant_id, code, name) VALUES ($1, 'cost_pool', 'Cost pool') RETURNING id`,
    [tenantId],
  );
  const categoryA = await one(
    runner,
    `INSERT INTO analytics_categories (tenant_id, axis_id, name) VALUES ($1, $2, 'Cloud') RETURNING id`,
    [tenantId, axis],
  );
  const categoryB = await one(
    runner,
    `INSERT INTO analytics_categories (tenant_id, axis_id, name) VALUES ($1, $2, 'On premise') RETURNING id`,
    [tenantId, axis],
  );
  const owner = await seedPerson(runner, tenantId, { first: 'Ava', last: 'Reader' }, { budget: 'reader' });

  const shared = { companyId: companyA, centerId: costCenterA, supplierId: supplier, accountId: account, ownerId: owner.id, projectId: project, contractId: contractA };
  const opexLine = await seedLine(runner, tenantId, { itemNumber: 1, nature: 'opex', name: 'Main line', ...shared });
  const capexLine = await seedLine(runner, tenantId, { itemNumber: 2, nature: 'capex', name: 'Capital line', ...shared });
  const hiddenLine = await seedLine(runner, tenantId, { itemNumber: 3, nature: 'opex', name: 'Beta line', companyId: companyB, centerId: costCenterB, supplierId: supplier, accountId: account, ownerId: owner.id, projectId: project, contractId: contractB });
  const typeLine = await seedLine(runner, tenantId, { itemNumber: 4, nature: 'opex', name: 'Type line', ...shared });
  const pageLine = await seedLine(runner, tenantId, { itemNumber: 5, nature: 'opex', name: 'Page line', ...shared });
  const emptyPageLine = await seedLine(runner, tenantId, { itemNumber: 6, nature: 'opex', name: 'Empty page line', ...shared });

  const opexVersion = await seedVersion(runner, tenantId, opexLine, 2026, 'Y2026');
  const capexVersion = await seedVersion(runner, tenantId, capexLine, 2026, 'Y2026');
  await seedVersion(runner, tenantId, typeLine, 2026, 'Y2026');

  // The task's relation is its line; its own row lets the history name it.
  await runner.query(
    `UPDATE tasks SET related_object_id = $3 WHERE tenant_id = $1 AND id = $2`,
    [tenantId, task, opexLine],
  );

  return {
    tenantId, companyA, companyB, costCenterA, supplier, contractA, contractB, project, request, application,
    technology, asset, contact, account, task, axis, categoryA, categoryB, opexLine, capexLine,
    hiddenLine, typeLine, pageLine, emptyPageLine, opexVersion, capexVersion, owner: owner.id,
  };
}

/** One audit row through the real writer (parent resolution included); returns its id. */
export async function audit(runner: QueryRunner, entry: AuditEntry): Promise<string> {
  const id = await writeAuditLog(runner.manager, entry);
  if (!id) throw new Error('the audit writer returned no id');
  return id;
}

/** The line's own snapshot, with the fields its page shows and neighbouring labels a payload may carry. */
export function linePayload(seed: HistorySeed, lineId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: lineId,
    tenant_id: seed.tenantId,
    item_number: 1,
    nature: 'opex',
    product_name: 'Main line',
    description: 'Main line description',
    currency: 'EUR',
    effective_start: '2026-01-01',
    status: 'enabled',
    paying_company_id: seed.companyA,
    supplier_id: seed.supplier,
    account_id: seed.account,
    owner_it_id: null,
    owner_business_id: null,
    project_id: seed.project,
    contract_id: seed.contractA,
    cost_center_id: seed.costCenterA,
    run_build: 'run',
    notes: null,
    analytics_values: { [seed.axis]: seed.categoryA },
    ...overrides,
  };
}
