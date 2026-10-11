import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { AuditLog } from '../../audit/audit.entity';
import { ItemNumberService } from '../../common/item-number.service';
import { BudgetLineTypeChangeService } from '../budget-line-type-change.service';
import { itemService, seedCompany, seedCostCenter, seedUser } from './cost-center.fixtures';
import { captureAudit, period } from './round-inputs.fixtures';

// Shared fixtures of the type change specs (lot M; not a spec itself): a budget line with every
// child a change of type moves, keeps or copies, seeded by SQL in the caller's transaction (its
// tenant already set), and the service built without Nest.

export type Nature = 'opex' | 'capex';

export type TypeChangeWorld = {
  tenantId: string;
  companyId: string;
  /** Accounts of the company's chart: for OPEX lines, for CAPEX lines, for both; a second OPEX one. */
  accounts: { opex: string; opex2: string; capex: string; any: string };
  supplierId: string;
  costCenterId: string;
  ownerId: string;
  /** Required for CAPEX lines only, two values for both types. */
  requiredAxis: { id: string; first: string; second: string };
  /** For both types: values for OPEX lines only (two), for both, for CAPEX lines only. */
  sharedAxis: { id: string; opexOnly: string; opexOnly2: string; both: string; capexOnly: string };
  /** For OPEX lines only, two values. */
  opexAxis: { id: string; first: string; second: string };
  applicationId: string;
  assetId: string;
  contractId: string;
  projectId: string;
  requestId: string;
  contactId: string;
};

export type SeededLine = {
  id: string;
  itemNumber: number;
  versions: Record<number, string>;
  roundInputId: string;
  linkId: string;
  attachmentId: string;
  contactLinkId: string;
  taskId: string;
};

const one = async (runner: QueryRunner, sql: string, params: unknown[]) => (await runner.query(sql, params))[0].id as string;

/** A user with a role giving `permissions`. */
export async function seedRoleUser(runner: QueryRunner, tenantId: string, label: string, permissions: Record<string, string>): Promise<string> {
  const roleId = await one(runner, `INSERT INTO roles (tenant_id, role_name) VALUES ($1, $2) RETURNING id`, [tenantId, `Type change ${label} ${randomUUID().slice(0, 6)}`]);
  for (const [resource, level] of Object.entries(permissions)) {
    await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`, [tenantId, roleId, resource, level]);
  }
  return one(
    runner,
    `INSERT INTO users (tenant_id, role_id, first_name, last_name, email, status) VALUES ($1, $2, 'Type', $3, $4, 'enabled') RETURNING id`,
    [tenantId, roleId, label, `${label}-${randomUUID()}@example.invalid`],
  );
}

/** The master data of a tenant whose lines change type (the tenant exists and is the current one). */
export async function seedTypeChangeWorld(runner: QueryRunner, tenantId: string): Promise<TypeChangeWorld> {
  const { companyId, chartId, accountId: any } = await seedCompany(runner, tenantId, 'Type change company', 6000);
  const account = (number: number, nature: Nature) => one(
    runner,
    `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name, nature) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenantId, chartId, number, `Account ${number}`, nature],
  );
  const accounts = { any, opex: await account(6100, 'opex'), opex2: await account(6200, 'opex'), capex: await account(2100, 'capex') };
  const supplierId = await one(runner, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Type change supplier') RETURNING id`, [tenantId]);
  const costCenterId = await seedCostCenter(runner, tenantId, { code: `TC${randomUUID().slice(0, 4)}`, name: 'Type change center', companyId });
  const ownerId = await seedUser(runner, tenantId, `owner-${randomUUID()}@example.invalid`);
  const axis = (code: string, name: string, appliesTo: Nature | null, required: boolean, sort: number) => one(
    runner,
    `INSERT INTO analytics_axes (tenant_id, code, name, applies_to, required, sort_order) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [tenantId, code, name, appliesTo, required, sort],
  );
  const value = (axisId: string, name: string, appliesTo: Nature | null) => one(
    runner,
    `INSERT INTO analytics_categories (tenant_id, axis_id, name, applies_to) VALUES ($1, $2, $3, $4) RETURNING id`,
    [tenantId, axisId, name, appliesTo],
  );
  const requiredId = await axis('tc_required', 'Investment kind', 'capex', true, 1);
  const sharedId = await axis('tc_shared', 'Cost pool', null, false, 2);
  const opexAxisId = await axis('tc_opex', 'Recurrence', 'opex', false, 3);
  const requiredAxis = { id: requiredId, first: await value(requiredId, 'Growth', null), second: await value(requiredId, 'Replacement', null) };
  const sharedAxis = {
    id: sharedId,
    opexOnly: await value(sharedId, 'Subscriptions', 'opex'),
    opexOnly2: await value(sharedId, 'Support', 'opex'),
    both: await value(sharedId, 'Network', null),
    capexOnly: await value(sharedId, 'Hardware', 'capex'),
  };
  const opexAxis = { id: opexAxisId, first: await value(opexAxisId, 'Monthly', null), second: await value(opexAxisId, 'Yearly', null) };
  const applicationId = await one(runner, `INSERT INTO applications (tenant_id, name) VALUES ($1, 'Type change app') RETURNING id`, [tenantId]);
  const assetId = await one(runner, `INSERT INTO assets (tenant_id, name, kind, environment) VALUES ($1, 'Type change asset', 'server', 'prod') RETURNING id`, [tenantId]);
  const contractId = await one(
    runner,
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, duration_months, notice_period_months)
     VALUES ($1, 'Type change contract', $2, $3, '2026-01-01', 12, 1) RETURNING id`,
    [tenantId, companyId, supplierId],
  );
  const projectId = await one(runner, `INSERT INTO portfolio_projects (tenant_id, name, item_number) VALUES ($1, 'Type change project', 990301) RETURNING id`, [tenantId]);
  const requestId = await one(runner, `INSERT INTO portfolio_requests (tenant_id, name, item_number) VALUES ($1, 'Type change request', 990301) RETURNING id`, [tenantId]);
  const contactId = await one(runner, `INSERT INTO contacts (tenant_id, email, first_name, last_name) VALUES ($1, $2, 'Con', 'Tact') RETURNING id`, [tenantId, `contact-${randomUUID()}@example.invalid`]);
  return {
    tenantId, companyId, accounts, supplierId, costCenterId, ownerId, requiredAxis, sharedAxis, opexAxis,
    applicationId, assetId, contractId, projectId, requestId, contactId,
  };
}

let taskNumber = 990400;

/**
 * A line of `nature` (raw insert, item number `itemNumber`, `CPX-<cpx>` for a CAPEX line given
 * one), with a version per year (twelve months of `monthly` planned and actual, a manual company
 * allocation; a round input on the first one), the analytics values given, a web link, a
 * contact, an attachment, links to the world's application, asset, contract, project and request,
 * and a task of its type.
 */
export async function seedTypeChangeLine(
  runner: QueryRunner,
  w: TypeChangeWorld,
  opts: {
    nature?: Nature;
    itemNumber: number;
    cpx?: number;
    years?: number[];
    monthly?: number;
    effectiveStart?: string;
    disabledAt?: string | null;
    accountId?: string | null;
    description?: string | null;
    values?: Record<string, string>;
  },
): Promise<SeededLine> {
  const nature = opts.nature ?? 'opex';
  const id = await one(
    runner,
    `INSERT INTO spend_items (tenant_id, nature, item_number, legacy_number, product_name, description, currency, effective_start, disabled_at,
                              status, paying_company_id, supplier_id, account_id, cost_center_id, owner_it_id, project_id, run_build, notes)
     VALUES ($1, $2, $3, $4, $5, $6, 'EUR', $7, $8::timestamptz,
             CASE WHEN $8::timestamptz IS NOT NULL AND $8::timestamptz <= now() THEN 'disabled'::status_state ELSE 'enabled'::status_state END,
             $9, $10, $11, $12, $13, $14, 'run', 'Seeded notes') RETURNING id`,
    [
      w.tenantId, nature, opts.itemNumber, nature === 'capex' && opts.cpx ? `CPX-${opts.cpx}` : null, `Line ${opts.itemNumber}`,
      opts.description === undefined ? `Description of ${opts.itemNumber}` : opts.description,
      opts.effectiveStart ?? '2024-01-01', opts.disabledAt ?? null, w.companyId, w.supplierId,
      opts.accountId === undefined ? w.accounts.opex : opts.accountId, w.costCenterId, w.ownerId, w.projectId,
    ],
  );
  const versions: Record<number, string> = {};
  let roundInputId = '';
  for (const year of opts.years ?? [2025, 2026, 2027]) {
    const versionId = await one(
      runner,
      `INSERT INTO spend_versions (tenant_id, spend_item_id, version_name, input_grain, as_of_date, budget_year, allocation_method)
       VALUES ($1, $2, $3, 'monthly', $4, $5, 'manual_company') RETURNING id`,
      [w.tenantId, id, `Y${year}`, `${year}-01-01`, year],
    );
    versions[year] = versionId;
    for (let month = 1; month <= 12; month++) {
      await runner.query(
        `INSERT INTO spend_amounts (tenant_id, version_id, period, planned, actual) VALUES ($1, $2, $3, $4, $4)`,
        [w.tenantId, versionId, period(month, year), String(opts.monthly ?? 100)],
      );
    }
    await runner.query(
      `INSERT INTO spend_allocations (tenant_id, version_id, company_id, allocation_pct) VALUES ($1, $2, $3, 100)`,
      [w.tenantId, versionId, w.companyId],
    );
    if (!roundInputId) {
      roundInputId = await one(
        runner,
        `INSERT INTO spend_round_inputs (tenant_id, version_id, measure, period_start, period_end, method)
         VALUES ($1, $2, 'planned', $3, $4, 'manual') RETURNING id`,
        [w.tenantId, versionId, `${year}-01-01`, `${year}-12-31`],
      );
    }
  }
  for (const [axisId, valueId] of Object.entries(opts.values ?? {})) {
    await runner.query(
      `INSERT INTO spend_item_analytics_values (tenant_id, item_id, axis_id, category_id) VALUES ($1, $2, $3, $4)`,
      [w.tenantId, id, axisId, valueId],
    );
  }
  for (const [table, column, owner] of [
    ['application_spend_items', 'application_id', w.applicationId],
    ['asset_spend_items', 'asset_id', w.assetId],
    ['contract_spend_items', 'contract_id', w.contractId],
  ] as const) {
    await runner.query(`INSERT INTO ${table} (tenant_id, ${column}, spend_item_id) VALUES ($1, $2, $3)`, [w.tenantId, owner, id]);
  }
  await runner.query(`INSERT INTO portfolio_project_opex (tenant_id, project_id, opex_id) VALUES ($1, $2, $3)`, [w.tenantId, w.projectId, id]);
  await runner.query(`INSERT INTO portfolio_request_opex (tenant_id, request_id, opex_id) VALUES ($1, $2, $3)`, [w.tenantId, w.requestId, id]);
  const linkId = await one(runner, `INSERT INTO spend_links (tenant_id, spend_item_id, url) VALUES ($1, $2, 'https://example.invalid/tc') RETURNING id`, [w.tenantId, id]);
  const contactLinkId = await one(
    runner,
    `INSERT INTO spend_item_contacts (tenant_id, spend_item_id, contact_id, role, origin) VALUES ($1, $2, $3, 'commercial', 'supplier') RETURNING id`,
    [w.tenantId, id, w.contactId],
  );
  const attachmentId = await one(
    runner,
    `INSERT INTO spend_attachments (tenant_id, spend_item_id, original_filename, stored_filename, storage_path)
     VALUES ($1, $2, 'tc.pdf', 'tc.pdf', $3) RETURNING id`,
    [w.tenantId, id, `files/${w.tenantId}/${nature}/${id}/tc.pdf`],
  );
  const taskId = await one(
    runner,
    `INSERT INTO tasks (tenant_id, item_number, title, related_object_type, related_object_id) VALUES ($1, $2, 'Type change task', $3, $4) RETURNING id`,
    [w.tenantId, ++taskNumber, nature === 'opex' ? 'spend_item' : 'capex_item', id],
  );
  return { id, itemNumber: opts.itemNumber, versions, roundInputId, linkId, attachmentId, contactLinkId, taskId };
}

/** The service on the item services of the fixtures; `audit`: the real one (rows in audit_log) unless given. */
export function typeChangeService(runner: QueryRunner, audit?: unknown, itemAudit: unknown = captureAudit()): BudgetLineTypeChangeService {
  return new BudgetLineTypeChangeService(
    itemService('opex', itemAudit),
    itemService('capex', itemAudit),
    (audit ?? new AuditService(runner.manager.getRepository(AuditLog))) as AuditService,
    new ItemNumberService(),
  );
}

/** Everything that hangs off a line, by table, as sorted ids (or keys): what a change keeps, moves or copies. */
export async function lineChildren(runner: QueryRunner, tenantId: string, itemId: string) {
  const ids = async (sql: string) => (await runner.query(sql, [tenantId, itemId])).map((row: { id: string }) => row.id).sort();
  return {
    versions: await ids(`SELECT id FROM spend_versions WHERE tenant_id = $1 AND spend_item_id = $2`),
    amounts: await ids(`SELECT a.id FROM spend_amounts a JOIN spend_versions v ON v.id = a.version_id WHERE v.tenant_id = $1 AND v.spend_item_id = $2`),
    allocations: await ids(`SELECT a.id FROM spend_allocations a JOIN spend_versions v ON v.id = a.version_id WHERE v.tenant_id = $1 AND v.spend_item_id = $2`),
    rounds: await ids(`SELECT r.id FROM spend_round_inputs r JOIN spend_versions v ON v.id = r.version_id WHERE v.tenant_id = $1 AND v.spend_item_id = $2`),
    values: await ids(`SELECT axis_id || ':' || category_id AS id FROM spend_item_analytics_values WHERE tenant_id = $1 AND item_id = $2`),
    links: await ids(`SELECT id FROM spend_links WHERE tenant_id = $1 AND spend_item_id = $2`),
    attachments: await ids(`SELECT id FROM spend_attachments WHERE tenant_id = $1 AND spend_item_id = $2`),
    contacts: await ids(`SELECT contact_id || ':' || role || ':' || origin AS id FROM spend_item_contacts WHERE tenant_id = $1 AND spend_item_id = $2`),
    applications: await ids(`SELECT application_id AS id FROM application_spend_items WHERE tenant_id = $1 AND spend_item_id = $2`),
    assets: await ids(`SELECT asset_id AS id FROM asset_spend_items WHERE tenant_id = $1 AND spend_item_id = $2`),
    contracts: await ids(`SELECT contract_id AS id FROM contract_spend_items WHERE tenant_id = $1 AND spend_item_id = $2`),
    projects: await ids(`SELECT project_id AS id FROM portfolio_project_opex WHERE tenant_id = $1 AND opex_id = $2`),
    requests: await ids(`SELECT request_id AS id FROM portfolio_request_opex WHERE tenant_id = $1 AND opex_id = $2`),
    tasks: await ids(`SELECT id || ':' || related_object_type AS id FROM tasks WHERE tenant_id = $1 AND related_object_id = $2`),
  };
}

/** The stored totals of each version of the line, by year (`spend_version_totals`). */
export async function versionTotals(runner: QueryRunner, tenantId: string, itemId: string) {
  const rows: Array<{ budget_year: number; id: string; planned: string; actual: string }> = await runner.query(
    `SELECT v.budget_year, v.id, t.planned::text AS planned, t.actual::text AS actual
       FROM spend_versions v LEFT JOIN spend_version_totals t ON t.tenant_id = v.tenant_id AND t.version_id = v.id
      WHERE v.tenant_id = $1 AND v.spend_item_id = $2 ORDER BY v.budget_year`,
    [tenantId, itemId],
  );
  return rows.map((row) => `${row.budget_year} ${row.id} ${row.planned} ${row.actual}`);
}

/** The line's stored nature, numbers, dates and status. */
export async function storedLine(runner: QueryRunner, tenantId: string, itemId: string) {
  const [row] = await runner.query(
    `SELECT nature, item_number, legacy_number, predecessor_id, row_version, account_id, cost_center_id, description, product_name,
            to_char(effective_start, 'YYYY-MM-DD') AS effective_start, disabled_at, status::text AS status
       FROM spend_items WHERE tenant_id = $1 AND id = $2`,
    [tenantId, itemId],
  );
  return row as {
    nature: Nature; item_number: number; legacy_number: string | null; predecessor_id: string | null; row_version: number;
    account_id: string | null; cost_center_id: string | null; description: string | null; product_name: string;
    effective_start: string; disabled_at: Date | null; status: string;
  } | undefined;
}

/** The type change audit rows of a record, oldest first. */
export async function changeAuditRows(runner: QueryRunner, tenantId: string, recordId: string) {
  return runner.query(
    `SELECT table_name, action, user_id, before_json, after_json FROM audit_log
      WHERE tenant_id = $1 AND record_id = $2 AND after_json->>'operation' = 'change_type' ORDER BY created_at`,
    [tenantId, recordId],
  ) as Promise<Array<{ table_name: string; action: string; user_id: string | null; before_json: any; after_json: any }>>;
}
