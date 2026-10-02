import type { EntityManager } from 'typeorm';
import type { SummaryDeps, SummaryScopeConfig } from '../spend-summary.builder';
import { loadCostCenterTree } from '../../cost-centers/cost-center-tree.util';
import { buildDefaultByYear, STANDARD_DEFAULT } from '../allocation-rule-resolver';
import { formatAllocationMethodLabel } from '../allocation-utils';
import { buildFxTable, FxTable } from './budget-fx-table';

/**
 * What a budget list statement reads besides the request: small, per-request
 * pre-reads, each loaded only when a field of the request needs it.
 */
export interface BudgetListRuntime {
  scope: SummaryScopeConfig;
  tenantId: string;
  currentYear: number;
  fx?: FxTable;
  /** The tenant's analytics dimensions; the default one (at most one per tenant). */
  axes?: { ids: string[]; defaultAxisId: string | null };
  /** Every cost centre of the tenant with the builder's code, name, path and budget holder. */
  costCenters?: Array<{ id: string; code: string; name: string; path: string; holder_id: string | null; holder_name: string | null }>;
  /** Per year, the label a version on the default method shows (the year's allocation rule). */
  ruleLabels?: Map<number, string>;
}

export interface RuntimeNeeds {
  /** Years whose amounts a statement converts. */
  fxYears?: number[];
  axes?: boolean;
  costCenters?: boolean;
  /** Years whose allocation label a statement reads. */
  ruleYears?: number[];
}

export function mergeNeeds(...all: RuntimeNeeds[]): RuntimeNeeds {
  const fxYears = new Set<number>();
  const ruleYears = new Set<number>();
  let axes = false;
  let costCenters = false;
  for (const needs of all) {
    needs.fxYears?.forEach((year) => fxYears.add(year));
    needs.ruleYears?.forEach((year) => ruleYears.add(year));
    axes = axes || !!needs.axes;
    costCenters = costCenters || !!needs.costCenters;
  }
  return {
    ...(fxYears.size ? { fxYears: Array.from(fxYears) } : {}),
    ...(ruleYears.size ? { ruleYears: Array.from(ruleYears) } : {}),
    axes,
    costCenters,
  };
}

/** The label the allocation calculator resolves for a version on the default method of `year`. */
function ruleLabel(resolution: { kind: string; method: string } | undefined): string {
  const resolved = resolution ?? STANDARD_DEFAULT;
  return formatAllocationMethodLabel(resolved.kind === 'manual_company' ? 'manual_company' : resolved.method);
}

export async function loadBudgetRuntime(
  scope: SummaryScopeConfig,
  deps: Pick<SummaryDeps, 'fxRates'>,
  manager: EntityManager,
  tenantId: string,
  currentYear: number,
  needs: RuntimeNeeds,
): Promise<BudgetListRuntime> {
  const runtime: BudgetListRuntime = { scope, tenantId, currentYear };
  const tasks: Array<Promise<void>> = [];
  if (needs.fxYears?.length) {
    tasks.push(buildFxTable(scope, deps.fxRates, manager, tenantId, needs.fxYears).then((fx) => { runtime.fx = fx; }));
  }
  if (needs.axes) {
    tasks.push(
      manager.query(`SELECT ax.id, ax.is_default FROM analytics_axes ax WHERE ax.tenant_id = $1`, [tenantId]).then((rows: Array<{ id: string; is_default: boolean }>) => {
        let defaultAxisId: string | null = null;
        for (const row of rows) if (row.is_default) defaultAxisId = row.id;
        runtime.axes = { ids: rows.map((row) => row.id), defaultAxisId };
      }),
    );
  }
  if (needs.costCenters) {
    tasks.push(
      loadCostCenterTree(manager, tenantId).then((nodes) => {
        runtime.costCenters = nodes.map((node) => ({
          id: node.id,
          code: node.code,
          name: node.name,
          path: node.path,
          holder_id: node.owner_user_id ?? null,
          holder_name: node.owner_user_id ? node.owner_name || null : null,
        }));
      }),
    );
  }
  if (needs.ruleYears?.length) {
    const years = Array.from(new Set(needs.ruleYears));
    tasks.push(
      manager.query(
        `SELECT r.tenant_id, r.fiscal_year, r.method, r.mode, r.company_ids
         FROM allocation_rules r
         WHERE r.fiscal_year = ANY($2::int[]) AND (r.tenant_id IS NULL OR r.tenant_id = $1)`,
        [tenantId, years],
      ).then((rows: any[]) => {
        const byYear = buildDefaultByYear(rows, tenantId);
        runtime.ruleLabels = new Map(years.map((year) => [year, ruleLabel(byYear.get(year))]));
      }),
    );
  }
  // The request transaction has one connection: the client queues these reads back to back.
  await Promise.all(tasks);
  return runtime;
}
