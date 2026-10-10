import { EntityManager } from 'typeorm';
import { AnalyticsAxisInfo, analyticsAxisSubject, axisAppliesTo, loadAnalyticsAxes } from '../../analytics/analytics-axes.util';
import { toCents } from '../../common/amount';
import { budgetColumnName, readBudgetColumns } from '../../budget-columns/budget-columns.util';
import { loadItemAnalyticsValues } from '../item-analytics.util';
import { assertScopeNatures, natureAnd, type BudgetNature } from '../budget-nature';
import { AMOUNT_MEASURES } from '../amounts-write.util';
import { columnOfMeasure } from './columns';
import {
  BudgetCatalog,
  BudgetFileScope,
  CatalogDimension,
  LineHint,
  StoredLine,
  emptyMonths,
} from './types';

/**
 * Table and column names come only from here. A request never chooses them.
 * Both item types share the shape the file uses. CAPEX stores its title in
 * `description`. OPEX stores it in `product_name`. `nature`: every read of
 * the line table names the scope's lines (`budget-nature.ts`); the versions
 * and values are read through those lines.
 */
const SCOPE = {
  opex: {
    items: 'spend_items',
    nature: 'opex' as BudgetNature | undefined,
    versions: 'spend_versions',
    amounts: 'spend_amounts',
    itemFk: 'spend_item_id',
    name: 'i.product_name',
    nameColumn: 'product_name',
    description: 'i.description',
    ppe: 'NULL::text',
    investment: 'NULL::text',
    priority: 'NULL::text',
    analytics: 'opex' as const,
  },
  capex: {
    items: 'capex_items',
    nature: undefined as BudgetNature | undefined,
    versions: 'capex_versions',
    amounts: 'capex_amounts',
    itemFk: 'capex_item_id',
    name: 'i.description',
    nameColumn: 'description',
    description: 'NULL::text',
    ppe: 'i.ppe_type::text',
    investment: 'i.investment_type::text',
    priority: 'i.priority::text',
    analytics: 'capex' as const,
  },
} as const;
assertScopeNatures('budget-file load', SCOPE, (t) => t.items);

const ITEM_COLUMNS = (scope: BudgetFileScope) => {
  const t = SCOPE[scope];
  return `i.id::text AS id, i.item_number::int AS item_number, i.row_version::int AS row_version,
    ${t.name} AS name, ${t.description} AS description,
    ${t.ppe} AS ppe_type, ${t.investment} AS investment_type, ${t.priority} AS priority,
    i.paying_company_id::text AS company_id, i.supplier_id::text AS supplier_id,
    i.account_id::text AS account_id, i.cost_center_id::text AS cost_center_id,
    i.run_build::text AS run_build,
    i.owner_it_id::text AS owner_it_id, i.owner_business_id::text AS owner_business_id,
    i.project_id::text AS project_id, btrim(i.currency::text) AS currency,
    to_char(i.effective_start, 'YYYY-MM-DD') AS effective_start, i.disabled_at, i.notes`;
};

export interface LoadedPreflight {
  catalog: BudgetCatalog;
  stored: StoredLine[];
  names: LineHint[];
  labels: Record<string, string>;
  dimensionCodes: string[];
}

/**
 * The dimension columns of a file of `scope`: `codes`, the enabled dimensions that apply to its
 * lines (read and exported); `refused`, the enabled ones of the other line type, each with the
 * header error its column gets (the whole file is refused). Unknown and disabled codes keep the
 * reader's unknown dimension error.
 */
export async function loadFileDimensions(
  manager: EntityManager,
  tenantId: string,
  scope: BudgetFileScope,
): Promise<{ codes: string[]; refused: Record<string, string> }> {
  const enabled = (await loadAnalyticsAxes(manager, tenantId)).filter((axis) => axis.status === 'enabled');
  const refused: Record<string, string> = {};
  for (const axis of enabled) {
    if (!axisAppliesTo(axis, scope)) refused[axis.code] = otherTypeColumnMessage(axis, scope);
  }
  return { codes: enabled.filter((axis) => axisAppliesTo(axis, scope)).map((axis) => axis.code), refused };
}

/** "The Recurrence dimension is for CAPEX lines only. Remove the analytics:recurrence column from this OPEX file." */
function otherTypeColumnMessage(axis: AnalyticsAxisInfo, scope: BudgetFileScope): string {
  return `${analyticsAxisSubject(axis)} is for ${String(axis.applies_to).toUpperCase()} lines only. `
    + `Remove the analytics:${axis.code} column from this ${scope.toUpperCase()} file.`;
}

export async function loadColumnLabels(manager: EntityManager, tenantId: string): Promise<Record<string, string>> {
  const settings = await readBudgetColumns(manager, tenantId);
  const labels: Record<string, string> = {};
  for (const measure of AMOUNT_MEASURES) labels[columnOfMeasure(measure)] = budgetColumnName(settings, measure);
  return labels;
}

export async function loadPreflight(
  manager: EntityManager,
  scope: BudgetFileScope,
  tenantId: string,
  itemNumbers: number[],
  allowedCurrencies: string[] | null,
): Promise<LoadedPreflight> {
  // One connection: the request transaction cannot run these side by side.
  const catalog = await loadCatalog(manager, tenantId, allowedCurrencies, scope);
  const names = await loadNames(manager, scope, tenantId);
  const labels = await loadColumnLabels(manager, tenantId);
  const stored = await loadLinesByNumber(manager, scope, tenantId, itemNumbers);
  return { catalog, stored, names, labels, dimensionCodes: catalog.dimensions.map((dimension) => dimension.code) };
}

export async function loadExportLines(
  manager: EntityManager,
  scope: BudgetFileScope,
  tenantId: string,
  ids: readonly string[],
): Promise<{ lines: StoredLine[]; dimensionCodes: string[]; labels: Record<string, string> }> {
  const dimensionCodes = (await loadFileDimensions(manager, tenantId, scope)).codes;
  const labels = await loadColumnLabels(manager, tenantId);
  const lines = await loadLinesById(manager, scope, tenantId, ids);
  const byId = new Map(lines.map((line) => [line.id, line]));
  return {
    lines: ids.map((id) => byId.get(id)).filter((line): line is StoredLine => !!line),
    dimensionCodes,
    labels,
  };
}

async function loadNames(manager: EntityManager, scope: BudgetFileScope, tenantId: string): Promise<LineHint[]> {
  const t = SCOPE[scope];
  const rows: Array<{ item_number: number; name: string; supplier_id: string | null }> = await manager.query(
    `SELECT item_number::int AS item_number, ${t.nameColumn} AS name, supplier_id::text AS supplier_id
       FROM ${t.items} WHERE tenant_id = $1${natureAnd(null, t.nature)}`,
    [tenantId],
  );
  return rows.map((row) => ({ itemNumber: Number(row.item_number), name: row.name ?? '', supplierId: row.supplier_id }));
}

async function loadLinesByNumber(
  manager: EntityManager,
  scope: BudgetFileScope,
  tenantId: string,
  itemNumbers: number[],
): Promise<StoredLine[]> {
  if (itemNumbers.length === 0) return [];
  const t = SCOPE[scope];
  const rows: ItemSql[] = await manager.query(
    `SELECT ${ITEM_COLUMNS(scope)} FROM ${t.items} i WHERE i.tenant_id = $1${natureAnd('i', t.nature)} AND i.item_number = ANY($2::int[])`,
    [tenantId, itemNumbers],
  );
  return hydrate(manager, scope, tenantId, rows);
}

async function loadLinesById(
  manager: EntityManager,
  scope: BudgetFileScope,
  tenantId: string,
  ids: readonly string[],
): Promise<StoredLine[]> {
  if (ids.length === 0) return [];
  const t = SCOPE[scope];
  const rows: ItemSql[] = await manager.query(
    `SELECT ${ITEM_COLUMNS(scope)} FROM ${t.items} i WHERE i.tenant_id = $1${natureAnd('i', t.nature)} AND i.id = ANY($2::uuid[])`,
    [tenantId, ids],
  );
  return hydrate(manager, scope, tenantId, rows);
}

interface ItemSql {
  id: string;
  item_number: number;
  row_version: number;
  name: string | null;
  description: string | null;
  ppe_type: string | null;
  investment_type: string | null;
  priority: string | null;
  company_id: string | null;
  supplier_id: string | null;
  account_id: string | null;
  cost_center_id: string | null;
  run_build: string | null;
  owner_it_id: string | null;
  owner_business_id: string | null;
  project_id: string | null;
  currency: string | null;
  effective_start: string | null;
  disabled_at: Date | string | null;
  notes: string | null;
}

async function hydrate(manager: EntityManager, scope: BudgetFileScope, tenantId: string, rows: ItemSql[]): Promise<StoredLine[]> {
  if (rows.length === 0) return [];
  const t = SCOPE[scope];
  const ids = rows.map((row) => row.id);
  const versions = await loadVersions(manager, t, tenantId, ids);
  const analytics = await loadItemAnalyticsValues(manager, t.analytics, tenantId, ids);
  const companies: Array<{ id: string; name: string }> = await manager.query(
    `SELECT id::text AS id, name FROM companies WHERE tenant_id = $1`, [tenantId],
  );
  const suppliers: Array<{ id: string; name: string; erp_supplier_id: string | null }> = await manager.query(
    `SELECT id::text AS id, name, erp_supplier_id FROM suppliers WHERE tenant_id = $1`, [tenantId],
  );
  const accounts: Array<{ id: string; account_number: string }> = await manager.query(
    `SELECT id::text AS id, account_number::text AS account_number FROM accounts WHERE tenant_id = $1`, [tenantId],
  );
  const centers: Array<{ id: string; code: string }> = await manager.query(
    `SELECT id::text AS id, code FROM cost_centers WHERE tenant_id = $1`, [tenantId],
  );
  const users: Array<{ id: string; email: string }> = await manager.query(
    `SELECT id::text AS id, email FROM users WHERE tenant_id = $1`, [tenantId],
  );
  const projects: Array<{ id: string; item_number: number }> = await manager.query(
    `SELECT id::text AS id, item_number::int AS item_number FROM portfolio_projects WHERE tenant_id = $1`, [tenantId],
  );
  const companyName = new Map(companies.map((row) => [row.id, row.name]));
  const supplierById = new Map(suppliers.map((row) => [row.id, row]));
  const accountNumber = new Map(accounts.map((row) => [row.id, row.account_number]));
  const centerCode = new Map(centers.map((row) => [row.id, row.code]));
  const email = new Map(users.map((row) => [row.id, row.email]));
  const projectNumber = new Map(projects.map((row) => [row.id, Number(row.item_number)]));
  return rows.map((row) => {
    const supplier = row.supplier_id ? supplierById.get(row.supplier_id) : undefined;
    const values = analytics.get(row.id) ?? [];
    const byCode: Record<string, string> = {};
    for (const value of values) byCode[value.axis_code] = value.category_name;
    const run = row.run_build === 'run' || row.run_build === 'build' ? row.run_build : null;
    return {
      id: row.id,
      itemNumber: Number(row.item_number),
      rowVersion: Number(row.row_version),
      name: row.name ?? '',
      description: row.description,
      ppeType: row.ppe_type,
      investmentType: row.investment_type,
      priority: row.priority,
      companyId: row.company_id,
      companyName: row.company_id ? companyName.get(row.company_id) ?? null : null,
      supplierId: row.supplier_id,
      supplierName: supplier?.name ?? null,
      supplierErpId: supplier?.erp_supplier_id ?? null,
      accountId: row.account_id,
      accountNumber: row.account_id ? accountNumber.get(row.account_id) ?? null : null,
      costCenterId: row.cost_center_id,
      costCenterCode: row.cost_center_id ? centerCode.get(row.cost_center_id) ?? null : null,
      runBuild: run,
      analytics: byCode,
      ownerItEmail: row.owner_it_id ? email.get(row.owner_it_id) ?? null : null,
      ownerBusinessEmail: row.owner_business_id ? email.get(row.owner_business_id) ?? null : null,
      projectNumber: row.project_id ? projectNumber.get(row.project_id) ?? null : null,
      currency: (row.currency ?? '').trim(),
      effectiveStart: row.effective_start ?? '',
      endOfValidity: row.disabled_at ? new Date(row.disabled_at).toISOString() : null,
      notes: row.notes,
      versions: versions.get(row.id) ?? [],
    };
  });
}

async function loadVersions(
  manager: EntityManager,
  t: (typeof SCOPE)[BudgetFileScope],
  tenantId: string,
  itemIds: string[],
): Promise<Map<string, StoredLine['versions']>> {
  const versionRows: Array<{ id: string; item_id: string; budget_year: number; budget_rev: number }> = await manager.query(
    `SELECT id::text AS id, ${t.itemFk}::text AS item_id, budget_year::int AS budget_year, budget_rev::int AS budget_rev
       FROM ${t.versions} WHERE tenant_id = $1 AND ${t.itemFk} = ANY($2::uuid[])`,
    [tenantId, itemIds],
  );
  const months = new Map<string, StoredLine['versions'][number]['months']>();
  if (versionRows.length > 0) {
    const amountRows: Array<Record<string, string | null>> = await manager.query(
      `SELECT version_id::text AS version_id, to_char(period, 'YYYY-MM-DD') AS period,
              planned::text AS planned, committed::text AS committed, forecast::text AS forecast,
              actual::text AS actual, expected_landing::text AS expected_landing
         FROM ${t.amounts} WHERE tenant_id = $1 AND version_id = ANY($2::uuid[])`,
      [tenantId, versionRows.map((row) => row.id)],
    );
    const yearOf = new Map(versionRows.map((row) => [row.id, Number(row.budget_year)]));
    for (const row of amountRows) {
      const versionId = String(row.version_id);
      const period = String(row.period ?? '');
      if (Number(period.slice(0, 4)) !== yearOf.get(versionId)) continue;
      const index = Number(period.slice(5, 7)) - 1;
      if (index < 0 || index > 11) continue;
      const entry = months.get(versionId) ?? emptyMonths();
      for (const measure of AMOUNT_MEASURES) {
        const raw = row[measure];
        entry[measure][index] = { cents: raw == null || raw === '' ? null : toCents(raw) };
      }
      months.set(versionId, entry);
    }
  }
  const byItem = new Map<string, StoredLine['versions']>();
  for (const row of versionRows) {
    const list = byItem.get(row.item_id) ?? [];
    list.push({
      id: row.id,
      year: Number(row.budget_year),
      budgetRev: Number(row.budget_rev),
      months: months.get(row.id) ?? emptyMonths(),
    });
    byItem.set(row.item_id, list);
  }
  return byItem;
}

async function loadCatalog(
  manager: EntityManager,
  tenantId: string,
  allowedCurrencies: string[] | null,
  scope: BudgetFileScope,
): Promise<BudgetCatalog> {
  const companies: Array<{ id: string; name: string; coa_id: string | null; disabled_at: Date | string | null }> = await manager.query(
    `SELECT id::text AS id, name, coa_id::text AS coa_id, disabled_at FROM companies WHERE tenant_id = $1`, [tenantId],
  );
  const suppliers: Array<{ id: string; name: string; erp_supplier_id: string | null; disabled_at: Date | string | null }> = await manager.query(
    `SELECT id::text AS id, name, erp_supplier_id, disabled_at FROM suppliers WHERE tenant_id = $1`, [tenantId],
  );
  const centers: Array<{ id: string; code: string; kind: string; company_id: string | null; disabled_at: Date | string | null }> = await manager.query(
    `SELECT id::text AS id, code, kind::text AS kind, company_id::text AS company_id, disabled_at FROM cost_centers WHERE tenant_id = $1`, [tenantId],
  );
  const accounts: Array<{ id: string; account_number: string; coa_id: string | null; disabled_at: Date | string | null; nature: 'opex' | 'capex' | null }> = await manager.query(
    `SELECT id::text AS id, account_number::text AS account_number, coa_id::text AS coa_id, disabled_at, nature FROM accounts WHERE tenant_id = $1`, [tenantId],
  );
  const users: Array<{ id: string; email: string; status: string }> = await manager.query(
    `SELECT id::text AS id, email, status::text AS status FROM users WHERE tenant_id = $1`, [tenantId],
  );
  const projects: Array<{ id: string; item_number: number }> = await manager.query(
    `SELECT id::text AS id, item_number::int AS item_number FROM portfolio_projects WHERE tenant_id = $1`, [tenantId],
  );
  const dimensions = await loadDimensions(manager, tenantId, scope);
  const chart: Array<{ id: string }> = await manager.query(
    `SELECT id::text AS id FROM chart_of_accounts WHERE tenant_id = $1 AND is_global_default = true LIMIT 1`, [tenantId],
  );
  const frozen: Array<{ budget_year: number; column_key: string }> = await manager.query(
    `SELECT budget_year::int AS budget_year, column_key FROM freeze_states
      WHERE tenant_id = $1 AND scope = $2 AND is_frozen = true`,
    [tenantId, scope],
  );
  const iso = (value: Date | string | null) => (value ? new Date(value).toISOString() : null);
  return {
    companies: companies.map((row) => ({ id: row.id, name: row.name, coaId: row.coa_id, disabledAt: iso(row.disabled_at) })),
    suppliers: suppliers.map((row) => ({ id: row.id, name: row.name, erpId: row.erp_supplier_id, disabledAt: iso(row.disabled_at) })),
    costCenters: centers.map((row) => ({ id: row.id, code: row.code, kind: row.kind, companyId: row.company_id, disabledAt: iso(row.disabled_at) })),
    accounts: accounts.map((row) => ({ id: row.id, number: row.account_number, coaId: row.coa_id, disabledAt: iso(row.disabled_at), nature: row.nature })),
    users: users.map((row) => ({ id: row.id, email: row.email, status: row.status })),
    projects: projects.map((row) => ({ id: row.id, itemNumber: Number(row.item_number) })),
    dimensions,
    allowedCurrencies,
    defaultCoaId: chart[0]?.id ?? null,
    frozen: frozen.map((row) => `${Number(row.budget_year)}:${row.column_key}`),
  };
}

/** The enabled dimensions that apply to the lines of `scope`, with their values. */
async function loadDimensions(manager: EntityManager, tenantId: string, scope: BudgetFileScope): Promise<CatalogDimension[]> {
  const axes = await loadAnalyticsAxes(manager, tenantId);
  const enabled = axes.filter((axis) => axis.status === 'enabled' && axisAppliesTo(axis, scope));
  if (enabled.length === 0) return [];
  const values: Array<{
    code: string;
    id: string;
    name: string;
    disabled_at: Date | string | null;
    applies_to: 'opex' | 'capex' | null;
  }> = await manager.query(
    `SELECT ax.code, c.id::text AS id, c.name, c.disabled_at, c.applies_to
       FROM analytics_categories c
       JOIN analytics_axes ax ON ax.tenant_id = c.tenant_id AND ax.id = c.axis_id
      WHERE c.tenant_id = $1 AND ax.code = ANY($2::text[])`,
    [tenantId, enabled.map((axis) => axis.code)],
  );
  return enabled.map((axis) => ({
    code: axis.code,
    name: axis.name ?? axis.code,
    required: axis.required,
    axisName: axis.name,
    values: values.filter((value) => value.code === axis.code).map((value) => ({
      id: value.id,
      name: value.name,
      disabledAt: value.disabled_at ? new Date(value.disabled_at).toISOString() : null,
      appliesTo: value.applies_to ?? null,
    })),
  }));
}

export function activeCurrency(allowed: string[] | null): string[] | null {
  return allowed && allowed.length > 0 ? allowed : null;
}
