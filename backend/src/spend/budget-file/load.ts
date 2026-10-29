import { EntityManager } from 'typeorm';
import { loadAnalyticsAxes } from '../../analytics/analytics-axes.util';
import { toCents } from '../../common/amount';
import { budgetColumnName, readBudgetColumns } from '../../budget-columns/budget-columns.util';
import { ItemAnalyticsValue, loadItemAnalyticsValues } from '../item-analytics.util';
import { BUDGET_NATURES, natureAnd, naturesAnd, type BudgetNature } from '../budget-nature';
import { AMOUNT_MEASURES, type AmountMeasure } from '../amounts-write.util';
import { buildCostCenterTree, CostCenterTreeRow } from '../../cost-centers/cost-center-tree.util';
import { columnOfMeasure } from './columns';
import { ItemNumberCell } from './interpret';
import { loadFileAccess } from './access';
import type { BudgetFileAccess } from './preflight';
import {
  BudgetCatalog,
  BudgetFileExportScope,
  CatalogDimension,
  LineHint,
  StoredLine,
  StoredRound,
  emptyMonths,
} from './types';

/**
 * Table and column names come only from here. A request never chooses them.
 * Both natures share the tables (lot Z1) and the shape the file uses (lot C1b): the title is
 * `product_name`, the description `description`, the number the line's own (`BL-n`).
 * `nature`: every read of the line table names the natures it reads (`budget-nature.ts`): the
 * route's for an export, the ones the caller may import for a preflight or a load; the versions
 * and values are read through those lines.
 */
const LINES = { items: 'spend_items', versions: 'spend_versions', amounts: 'spend_amounts', itemFk: 'spend_item_id' } as const;

const ITEM_COLUMNS = `i.id::text AS id, i.nature, i.item_number::int AS item_number, i.legacy_number,
    i.row_version::int AS row_version, i.product_name AS name, i.description AS description,
    i.paying_company_id::text AS company_id, i.supplier_id::text AS supplier_id,
    i.account_id::text AS account_id, i.cost_center_id::text AS cost_center_id,
    i.run_build::text AS run_build,
    i.owner_it_id::text AS owner_it_id, i.owner_business_id::text AS owner_business_id,
    i.project_id::text AS project_id, btrim(i.currency::text) AS currency,
    to_char(i.effective_start, 'YYYY-MM-DD') AS effective_start, i.disabled_at, i.notes`;

export interface LoadedPreflight {
  catalog: BudgetCatalog;
  stored: StoredLine[];
  names: LineHint[];
  labels: Record<string, string>;
  dimensionCodes: string[];
  /** A limited person's access to the stored lines (`access.ts`); undefined for an unscoped person. */
  access?: BudgetFileAccess;
}

/** A file's dimension column: its code and the lines it is for. */
export interface FileDimension {
  code: string;
  appliesTo: BudgetNature | null;
}

/**
 * The dimension columns of a file: every enabled dimension, whatever the lines it is for (a file
 * holds lines of both natures since lot C1b; a line's own nature decides whether it may hold a
 * value, `resolveAnalytics`). Unknown and disabled codes keep the reader's unknown dimension error.
 */
export async function loadFileDimensions(manager: EntityManager, tenantId: string): Promise<FileDimension[]> {
  const enabled = (await loadAnalyticsAxes(manager, tenantId)).filter((axis) => axis.status === 'enabled');
  return enabled.map((axis) => ({ code: axis.code, appliesTo: axis.applies_to ?? null }));
}

export async function loadColumnLabels(manager: EntityManager, tenantId: string): Promise<Record<string, string>> {
  const settings = await readBudgetColumns(manager, tenantId);
  const labels: Record<string, string> = {};
  for (const measure of AMOUNT_MEASURES) labels[columnOfMeasure(measure)] = budgetColumnName(settings, measure);
  return labels;
}

/**
 * What a preflight compares against: the catalog, and the lines of both natures that the file's
 * numbers name (one right covers every budget line, lot R).
 */
export async function loadPreflight(
  manager: EntityManager,
  tenantId: string,
  numbers: ItemNumberCell[],
  allowedCurrencies: string[] | null,
): Promise<LoadedPreflight> {
  // One connection: the request transaction cannot run these side by side.
  const catalog = await loadCatalog(manager, tenantId, allowedCurrencies);
  const names = await loadNames(manager, tenantId);
  const labels = await loadColumnLabels(manager, tenantId);
  // Read under the person's policies: a line out of their read access is not there at all.
  const stored = await loadLinesByNumber(manager, tenantId, numbers);
  const access = await loadFileAccess(manager, stored);
  return { catalog, stored, names, labels, dimensionCodes: catalog.dimensions.map((dimension) => dimension.code), access };
}

/** The export's lines in id order: one route's nature, or explicitly both for the unified list. */
export async function loadExportLines(
  manager: EntityManager,
  scope: BudgetFileExportScope,
  tenantId: string,
  ids: readonly string[],
): Promise<{ lines: StoredLine[]; dimensions: FileDimension[]; labels: Record<string, string> }> {
  const dimensions = await loadFileDimensions(manager, tenantId);
  const labels = await loadColumnLabels(manager, tenantId);
  const lines = await loadLinesById(manager, scope, tenantId, ids);
  const byId = new Map(lines.map((line) => [line.id, line]));
  return {
    lines: ids.map((id) => byId.get(id)).filter((line): line is StoredLine => !!line),
    dimensions,
    labels,
  };
}

async function loadNames(manager: EntityManager, tenantId: string): Promise<LineHint[]> {
  const rows: Array<{ nature: BudgetNature; item_number: number; name: string; supplier_id: string | null }> = await manager.query(
    `SELECT i.nature, i.item_number::int AS item_number, i.product_name AS name, i.supplier_id::text AS supplier_id
       FROM ${LINES.items} i WHERE i.tenant_id = $1${naturesAnd('i', BUDGET_NATURES)}`,
    [tenantId],
  );
  return rows.map((row) => ({ nature: row.nature, itemNumber: Number(row.item_number), name: row.name ?? '', supplierId: row.supplier_id }));
}

/**
 * The lines the file's numbers may name: by own number (`BL-n`, a bare number), by the number of
 * before lot C1b (`OPX-n`, `CPX-n`: `legacy_number`, or an OPEX line's own number, which its OPX
 * number always was; a CAPEX line without a CPX number was shown by its own one), among the lines
 * of both natures. `findStoredLine` (preflight) picks the line of each cell.
 */
async function loadLinesByNumber(
  manager: EntityManager,
  tenantId: string,
  numbers: ItemNumberCell[],
): Promise<StoredLine[]> {
  const own = new Set<number>();
  const legacy = new Set<string>();
  const opx = new Set<number>();
  const cpx = new Set<number>();
  for (const cell of numbers) {
    if (cell.kind !== 'number') continue;
    if (cell.prefix === 'BL') own.add(cell.n);
    else {
      legacy.add(cell.ref);
      (cell.prefix === 'OPX' ? opx : cpx).add(cell.n);
    }
  }
  if (own.size + legacy.size === 0) return [];
  const rows: ItemSql[] = await manager.query(
    `SELECT ${ITEM_COLUMNS} FROM ${LINES.items} i
      WHERE i.tenant_id = $1${naturesAnd('i', BUDGET_NATURES)}
        AND (i.item_number = ANY($2::int[]) OR i.legacy_number = ANY($3::text[])
             OR (i.nature = 'opex' AND i.item_number = ANY($4::int[]))
             OR (i.nature = 'capex' AND i.item_number = ANY($5::int[])))`,
    [tenantId, [...own], [...legacy], [...opx], [...cpx]],
  );
  return hydrate(manager, tenantId, rows, { withRounds: true });
}

async function loadLinesById(
  manager: EntityManager,
  scope: BudgetFileExportScope,
  tenantId: string,
  ids: readonly string[],
): Promise<StoredLine[]> {
  if (ids.length === 0) return [];
  const rows: ItemSql[] = await manager.query(
    `SELECT ${ITEM_COLUMNS} FROM ${LINES.items} i WHERE i.tenant_id = $1${scope === 'all' ? naturesAnd('i', BUDGET_NATURES) : natureAnd('i', scope)} AND i.id = ANY($2::uuid[])`,
    [tenantId, ids],
  );
  return hydrate(manager, tenantId, rows);
}

interface ItemSql {
  id: string;
  nature: BudgetNature;
  item_number: number;
  legacy_number: string | null;
  row_version: number;
  name: string | null;
  description: string | null;
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

/**
 * Each centre's names from its root group, joined with ` / ` (`DSI / Infrastructures / Réseau`).
 * A root centre has no path: the file's `cost_center_path` is there to group lines by their groups.
 */
function costCenterPaths(rows: CostCenterTreeRow[]): Map<string, string> {
  const nameById = new Map(rows.map((row) => [row.id, row.name]));
  const paths = new Map<string, string>();
  for (const node of buildCostCenterTree(rows)) {
    if (node.path_ids.length < 2) continue;
    paths.set(node.id, node.path_ids.map((id) => nameById.get(id) ?? '').join(' / '));
  }
  return paths;
}

/**
 * The rows' details, values and versions. The rows were read with their nature predicate.
 * `withRounds` also reads each column's calculation lines: the check needs them, the export does not.
 */
async function hydrate(
  manager: EntityManager,
  tenantId: string,
  rows: ItemSql[],
  options: { withRounds?: boolean } = {},
): Promise<StoredLine[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const versions = await loadVersions(manager, tenantId, ids, options.withRounds ?? false);
  const analytics = new Map<string, ItemAnalyticsValue[]>();
  for (const nature of BUDGET_NATURES) {
    const natureIds = rows.filter((row) => row.nature === nature).map((row) => row.id);
    if (natureIds.length === 0) continue;
    for (const [id, values] of await loadItemAnalyticsValues(manager, nature, tenantId, natureIds)) analytics.set(id, values);
  }
  const companies: Array<{ id: string; name: string }> = await manager.query(
    `SELECT id::text AS id, name FROM companies WHERE tenant_id = $1`, [tenantId],
  );
  const suppliers: Array<{ id: string; name: string; erp_supplier_id: string | null }> = await manager.query(
    `SELECT id::text AS id, name, erp_supplier_id FROM suppliers WHERE tenant_id = $1`, [tenantId],
  );
  const accounts: Array<{ id: string; account_number: string }> = await manager.query(
    `SELECT id::text AS id, account_number::text AS account_number FROM accounts WHERE tenant_id = $1`, [tenantId],
  );
  const centers: CostCenterTreeRow[] = await manager.query(
    `SELECT id::text AS id, code, name, kind::text AS kind, parent_id::text AS parent_id, company_id::text AS company_id,
            disabled_at, sort_order
       FROM cost_centers WHERE tenant_id = $1`, [tenantId],
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
  const centerPath = costCenterPaths(centers);
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
      nature: row.nature,
      itemNumber: Number(row.item_number),
      legacyNumber: row.legacy_number ?? null,
      rowVersion: Number(row.row_version),
      name: row.name ?? '',
      description: row.description,
      companyId: row.company_id,
      companyName: row.company_id ? companyName.get(row.company_id) ?? null : null,
      supplierId: row.supplier_id,
      supplierName: supplier?.name ?? null,
      supplierErpId: supplier?.erp_supplier_id ?? null,
      accountId: row.account_id,
      accountNumber: row.account_id ? accountNumber.get(row.account_id) ?? null : null,
      costCenterId: row.cost_center_id,
      costCenterCode: row.cost_center_id ? centerCode.get(row.cost_center_id) ?? null : null,
      costCenterPath: row.cost_center_id ? centerPath.get(row.cost_center_id) ?? null : null,
      runBuild: run,
      analytics: byCode,
      ownerItEmail: row.owner_it_id ? email.get(row.owner_it_id) ?? null : null,
      ownerBusinessEmail: row.owner_business_id ? email.get(row.owner_business_id) ?? null : null,
      ownerItId: row.owner_it_id,
      ownerBusinessId: row.owner_business_id,
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
  tenantId: string,
  itemIds: string[],
  withRounds: boolean,
): Promise<Map<string, StoredLine['versions']>> {
  const t = LINES;
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
  const rounds = withRounds ? await loadRounds(manager, tenantId, versionRows.map((row) => row.id)) : null;
  const byItem = new Map<string, StoredLine['versions']>();
  for (const row of versionRows) {
    const list = byItem.get(row.item_id) ?? [];
    list.push({
      id: row.id,
      year: Number(row.budget_year),
      budgetRev: Number(row.budget_rev),
      months: months.get(row.id) ?? emptyMonths(),
      ...(rounds ? { rounds: rounds.get(row.id) ?? {} } : {}),
    });
    byItem.set(row.item_id, list);
  }
  return byItem;
}

/**
 * Per version and column, the round-input record's method and its calculation lines: how many, and
 * the total they compute while the column follows them. One query for every version.
 */
async function loadRounds(
  manager: EntityManager,
  tenantId: string,
  versionIds: string[],
): Promise<Map<string, Partial<Record<AmountMeasure, StoredRound>>>> {
  const byVersion = new Map<string, Partial<Record<AmountMeasure, StoredRound>>>();
  if (versionIds.length === 0) return byVersion;
  const rows: Array<{ version_id: string; measure: string; method: StoredRound['method']; line_count: number; lines_total: string | null }> = await manager.query(
    `SELECT r.version_id::text AS version_id, r.measure, r.method,
            (SELECT count(*)::int FROM spend_round_input_lines l
              WHERE l.tenant_id = r.tenant_id AND l.round_input_id = r.id) AS line_count,
            CASE WHEN r.last_calculation->>'kind' = 'computed' THEN r.last_calculation->>'total' END AS lines_total
       FROM spend_round_inputs r
      WHERE r.tenant_id = $1 AND r.version_id = ANY($2::uuid[])`,
    [tenantId, versionIds],
  );
  for (const row of rows) {
    if (!(AMOUNT_MEASURES as readonly string[]).includes(row.measure)) continue;
    const lineCount = Number(row.line_count);
    const entry = byVersion.get(row.version_id) ?? {};
    entry[row.measure as AmountMeasure] = {
      method: row.method,
      lineCount,
      linesTotal: lineCount > 0 && row.lines_total != null ? toCents(row.lines_total) : null,
    };
    byVersion.set(row.version_id, entry);
  }
  return byVersion;
}

async function loadCatalog(
  manager: EntityManager,
  tenantId: string,
  allowedCurrencies: string[] | null,
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
  const dimensions = await loadDimensions(manager, tenantId);
  const chart: Array<{ id: string }> = await manager.query(
    `SELECT id::text AS id FROM chart_of_accounts WHERE tenant_id = $1 AND is_global_default = true LIMIT 1`, [tenantId],
  );
  // The frozen columns of both natures: a line is checked against those of its own (`resolveAmounts`).
  const frozen: Array<{ scope: string; budget_year: number; column_key: string }> = await manager.query(
    `SELECT scope, budget_year::int AS budget_year, column_key FROM freeze_states
      WHERE tenant_id = $1 AND scope IN ('opex', 'capex') AND is_frozen = true`,
    [tenantId],
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
    frozen: frozen.map((row) => `${row.scope}:${Number(row.budget_year)}:${row.column_key}`),
  };
}

/** The enabled dimensions, of both natures, with the lines each is for and their values. */
async function loadDimensions(manager: EntityManager, tenantId: string): Promise<CatalogDimension[]> {
  const axes = await loadAnalyticsAxes(manager, tenantId);
  const enabled = axes.filter((axis) => axis.status === 'enabled');
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
    appliesTo: axis.applies_to ?? null,
    required: axis.required,
    axisName: axis.name,
    openValues: axis.open_values,
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
