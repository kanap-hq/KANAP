import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { validate as isUuid } from 'uuid';
import { deriveStatusFromDisabledAt, isActiveAt, StatusState } from '../common/status';
import { ItemAnalyticsChange, resolveItemAnalyticsChanges } from './item-analytics.util';

/**
 * The one gate of every OPEX and CAPEX line write (API create and update, the
 * AI mutations and the budget file, all through the item services).
 *
 * Item bodies reach the services unvalidated, and foreign key checks bypass
 * row level security: without this gate any column could be sent and another
 * tenant's supplier, category or user could be attached to a line. So:
 * - only the writable columns of the type are kept, anything else is dropped;
 * - every id supplied is resolved in the current tenant with an explicit
 *   `tenant_id` predicate (unknown or other tenant: "<Field> not found.");
 * - a new cost center is read `FOR SHARE` (a concurrent conversion into a
 *   group waits, or makes this read see the group) and must be an enabled
 *   cost center; keeping the stored one is always allowed;
 * - a line with a cost center and no paying company takes the cost center's;
 * - the resulting account must belong to the resulting company's chart,
 *   checked on create and when the company or the account changes (an older
 *   mismatched line still takes unrelated edits);
 * - analytics values (`analytics_values`, and the legacy
 *   `analytics_category_id` of the default dimension) are resolved into link
 *   changes, which the caller writes after the line (`item-analytics.util.ts`).
 */

export type ItemWriteScope = 'opex' | 'capex';

export const RUN_BUILD_VALUES = ['run', 'build'] as const;
export type RunBuild = (typeof RUN_BUILD_VALUES)[number];

const WRITABLE_COLUMNS: Record<ItemWriteScope, readonly string[]> = {
  opex: [
    'product_name', 'description', 'supplier_id', 'paying_company_id', 'account_id', 'currency', 'effective_start',
    'owner_it_id', 'owner_business_id', 'project_id', 'contract_id', 'cost_center_id', 'run_build', 'notes',
  ],
  capex: [
    'description', 'ppe_type', 'investment_type', 'priority', 'supplier_id', 'paying_company_id', 'account_id', 'currency',
    'effective_start', 'owner_it_id', 'owner_business_id', 'project_id', 'cost_center_id', 'run_build', 'notes',
  ],
};

/** The columns a line update writes as given (after the id and enum checks below). */
export function itemWritableColumns(scope: ItemWriteScope): readonly string[] {
  return WRITABLE_COLUMNS[scope];
}

/** Lifecycle inputs, resolved by the caller (`resolveLifecycleState`), never written as given. */
const LIFECYCLE_INPUTS = ['status', 'disabled_at', 'effective_end'] as const;

/** Id columns resolved here, with the table they name. `cost_center_id` has its own path. */
const REFERENCES: Record<string, { table: string; label: string }> = {
  paying_company_id: { table: 'companies', label: 'Paying company' },
  account_id: { table: 'accounts', label: 'Account' },
  supplier_id: { table: 'suppliers', label: 'Supplier' },
  owner_it_id: { table: 'users', label: 'IT owner' },
  owner_business_id: { table: 'users', label: 'Business owner' },
  project_id: { table: 'portfolio_projects', label: 'Project' },
  contract_id: { table: 'contracts', label: 'Contract' },
};

const COST_CENTER_LABEL = 'Cost center';

export interface ItemWrite {
  /** The columns to set, only those the body supplied (plus a filled paying company). */
  values: Record<string, unknown>;
  lifecycle: { status?: unknown; disabled_at?: any; effective_end?: unknown };
  /** Analytics values to set or clear per dimension, written after the line is saved (`writeItemAnalyticsValues`). */
  analytics: ItemAnalyticsChange[];
}

type ExistingItem = { tenant_id?: string | null } & Record<string, any>;

type CostCenterRow = { id: string; kind: string; company_id: string | null; disabled_at: Date | string | null };

async function currentTenantId(manager: EntityManager): Promise<string> {
  const [row] = await manager.query(`SELECT current_setting('app.current_tenant', true) AS tenant_id`);
  const tenantId = row?.tenant_id as string | null | undefined;
  if (!tenantId) throw new BadRequestException('Tenant context is required');
  return tenantId;
}

/** An id cell: null for null or blank, the uuid otherwise; anything else names nothing. */
function idValue(value: unknown, label: string): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !isUuid(value)) throw new BadRequestException(`${label} not found.`);
  return value.toLowerCase();
}

export function parseRunBuild(value: unknown): RunBuild | null | undefined {
  if (value == null) return null;
  const text = String(value).trim().toLowerCase();
  if (text === '') return null;
  return (RUN_BUILD_VALUES as readonly string[]).includes(text) ? (text as RunBuild) : undefined;
}

/** The node of a cost center id in this tenant, locked against a concurrent change of its kind. */
async function readCostCenter(manager: EntityManager, tenantId: string, id: string): Promise<CostCenterRow | null> {
  const [row] = await manager.query(
    `SELECT id, kind, company_id, disabled_at FROM cost_centers WHERE tenant_id = $1 AND id = $2 FOR SHARE`,
    [tenantId, id],
  );
  return (row as CostCenterRow | undefined) ?? null;
}

/**
 * The columns a create (`existing` null) or an update of one line writes,
 * checked as described above. Throws a 400 on the first problem.
 */
export async function resolveItemWrite(
  manager: EntityManager,
  scope: ItemWriteScope,
  body: unknown,
  existing: ExistingItem | null,
): Promise<ItemWrite> {
  const tenantId = await currentTenantId(manager);
  // The line was read under RLS; a mismatch would mean a caller passed a row of another tenant.
  if (existing && existing.tenant_id && existing.tenant_id !== tenantId) throw new BadRequestException('Item not found.');
  const input: Record<string, unknown> = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const supplied = (key: string) => Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined;

  const values: Record<string, unknown> = {};
  for (const column of WRITABLE_COLUMNS[scope]) {
    if (supplied(column)) values[column] = input[column];
  }
  // CAPEX legacy alias of the paying company.
  if (scope === 'capex' && input.company_id != null && input.paying_company_id == null) {
    values.paying_company_id = input.company_id;
  }
  const lifecycle: ItemWrite['lifecycle'] = {};
  for (const key of LIFECYCLE_INPUTS) {
    if (supplied(key)) (lifecycle as any)[key] = input[key];
  }

  for (const [column, ref] of Object.entries(REFERENCES)) {
    if (column in values) values[column] = idValue(values[column], ref.label);
  }
  if ('cost_center_id' in values) values.cost_center_id = idValue(values.cost_center_id, COST_CENTER_LABEL);
  if ('run_build' in values) {
    const runBuild = parseRunBuild(values.run_build);
    if (runBuild === undefined) throw new BadRequestException('Run or build must be run, build or empty.');
    values.run_build = runBuild;
  }

  const next = (column: string): string | null => (column in values ? (values[column] as string | null) : ((existing?.[column] as string | null | undefined) ?? null));

  const costCenterId = next('cost_center_id');
  const isNewAssignment = !!costCenterId && costCenterId !== ((existing?.cost_center_id as string | null | undefined) ?? null);
  // The node is read only to assign it or to fill the company from it.
  if (costCenterId && (isNewAssignment || !next('paying_company_id'))) {
    const node = await readCostCenter(manager, tenantId, costCenterId);
    if (isNewAssignment) {
      if (!node) throw new BadRequestException(`${COST_CENTER_LABEL} not found.`);
      if (node.kind !== 'cost_center') throw new BadRequestException('Choose a cost center, not a group.');
      if (!isActiveAt(node.disabled_at)) throw new BadRequestException('This cost center is disabled.');
    }
    if (!next('paying_company_id') && node?.company_id) values.paying_company_id = node.company_id;
  }
  const companyId = next('paying_company_id');
  if (!companyId) throw new BadRequestException('Paying company is required.');
  const accountId = next('account_id');
  const storedOf = (column: string) => ((existing?.[column] as string | null | undefined) ?? null);
  const checkChart = !!accountId && (!existing || companyId !== storedOf('paying_company_id') || accountId !== storedOf('account_id'));

  // Every supplied id, plus the resulting company and account for the chart check, in one query.
  const idsByTable = new Map<string, Set<string>>();
  const want = (table: string, id: string | null) => {
    if (!id) return;
    const ids = idsByTable.get(table) ?? new Set<string>();
    ids.add(id);
    idsByTable.set(table, ids);
  };
  for (const [column, ref] of Object.entries(REFERENCES)) {
    if (column in values) want(ref.table, values[column] as string | null);
  }
  if (checkChart) {
    want('companies', companyId);
    want('accounts', accountId);
  }

  const found = new Map<string, { coa_id: string | null }>();
  if (idsByTable.size > 0) {
    const params: unknown[] = [tenantId];
    const selects = Array.from(idsByTable.entries()).map(([table, ids]) => {
      params.push(Array.from(ids));
      const coa = table === 'companies' || table === 'accounts' ? 'coa_id::text' : 'NULL::text';
      // Table names come from REFERENCES only.
      return `SELECT '${table}' AS tbl, id::text AS id, ${coa} AS coa_id FROM ${table} WHERE tenant_id = $1 AND id = ANY($${params.length}::uuid[])`;
    });
    const rows: Array<{ tbl: string; id: string; coa_id: string | null }> = await manager.query(selects.join(' UNION ALL '), params);
    for (const row of rows) found.set(`${row.tbl}:${row.id}`, { coa_id: row.coa_id });
  }
  for (const [column, ref] of Object.entries(REFERENCES)) {
    const id = column in values ? (values[column] as string | null) : null;
    if (id && !found.has(`${ref.table}:${id}`)) throw new BadRequestException(`${ref.label} not found.`);
  }

  if (checkChart) {
    const account = found.get(`accounts:${accountId}`);
    const company = found.get(`companies:${companyId}`);
    if (account?.coa_id && company?.coa_id && account.coa_id !== company.coa_id) {
      throw new BadRequestException('Selected account does not belong to the paying company\'s Chart of Accounts');
    }
  }

  const analytics = await resolveItemAnalyticsChanges(manager, scope, tenantId, input, (existing?.id as string | undefined) ?? null);

  return { values, lifecycle, analytics };
}

/* ---- CSV helpers (master-data files and the budget file) ---- */

/**
 * The status and end of validity an item CSV row writes (`status` null when
 * the cell is blank); a blank date cell is left out. A new line is enabled
 * unless the row says disabled. On an update a blank cell keeps the stored
 * value: both blank keep both; enabled with a blank date clears the date.
 * Disabled with a blank date keeps a date already passed, otherwise the end
 * of validity is now, on a new line too. A date given always wins
 * (`resolveLifecycleState`).
 */
export function csvItemLifecycle<D>(
  status: StatusState | null,
  disabledAt: D | null,
  isUpdate: boolean,
): { status?: StatusState; disabled_at?: D } {
  const date = disabledAt != null ? { disabled_at: disabledAt } : {};
  if (!isUpdate) return { status: status ?? StatusState.ENABLED, ...date };
  return { ...(status ? { status } : {}), ...date };
}

/**
 * The row error of an item CSV row whose status cell contradicts its end of
 * validity, or null. The exports write the status read from the date, so a
 * fresh export never contradicts itself. A disabled line dated today is not a
 * contradiction: the CAPEX export writes the day only, read back at noon.
 */
export function csvLifecycleConflict(status: StatusState | null, disabledAt: Date | string | null, now = new Date()): string | null {
  if (!status || disabledAt == null) return null;
  if (deriveStatusFromDisabledAt(disabledAt, now) === status) return null;
  const day = (date: Date) => date.toISOString().slice(0, 10);
  if (status === StatusState.DISABLED && day(new Date(disabledAt)) === day(now)) return null;
  return status === StatusState.ENABLED
    // An older export may carry a status written before the date passed: say how to get a fresh one.
    ? 'Status is enabled but the end of validity has passed. Clear the date or set the status to disabled. If the file comes from an older export, export the data again.'
    : 'Status is disabled but the end of validity is still to come. Set the status to enabled or set a date that has passed.';
}

/**
 * Locks every cost center a file newly assigns, once and in id order, before
 * the write loop: the per-row `FOR SHARE` of the gate then never waits on a
 * node in file order, so an import cannot deadlock with a tree write that
 * locks nodes in id order.
 */
export async function lockCsvCostCenters(manager: EntityManager, tenantId: string, ids: Array<string | null | undefined>): Promise<void> {
  const wanted = Array.from(new Set(ids.filter((id): id is string => !!id)));
  if (wanted.length === 0) return;
  await manager.query(
    `SELECT id FROM cost_centers WHERE tenant_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR SHARE`,
    [tenantId, wanted],
  );
}
