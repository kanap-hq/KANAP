import { EntityManager } from 'typeorm';
import { CapexVersion } from '../capex/capex-version.entity';
import { AmountScope } from './amounts-write.util';
import { SpendVersion } from './spend-version.entity';

/**
 * Get-or-create of the budget version of an item's year, for OPEX and CAPEX
 * alike: the budget tab's create, the column copy, the allocation copy and
 * both CSV imports (plan planning/perf-scale, lot 3A, Annexe A #13).
 *
 * A version is unique per (item, year) and per (item, name). Two callers that
 * both find no version used to both insert: the second hit the unique index
 * (a 500, or a whole import rolled back). Here the insert is
 * `ON CONFLICT DO NOTHING` (no target: both indexes are arbiters), then the
 * version of (item, year) is read: a caller that lost the race waits for the
 * winner's commit inside the insert, then reads its version. Every caller
 * ends with the same version, without error.
 *
 * Returns null when the name is already taken by another year of the item:
 * the caller decides how to refuse.
 */
export type BudgetVersionEntity = SpendVersion | CapexVersion;

export type EnsureBudgetVersionParams = {
  tenantId: string;
  itemId: string;
  year: number;
  versionName: string;
  inputGrain: 'annual' | 'quarterly' | 'monthly';
  asOfDate: string;
  allocationMethod: string;
  /** Omitted: the column default (headcount). */
  allocationDriver?: string;
  notes?: string | null;
  /** Omitted: the column default. */
  reportingCurrency?: string;
};

export type EnsuredBudgetVersion<V extends BudgetVersionEntity = BudgetVersionEntity> = { version: V; created: boolean };

// Table and column names come only from here: never from the caller.
const SCOPES = {
  opex: { versions: 'spend_versions', itemFk: 'spend_item_id', entity: SpendVersion },
  capex: { versions: 'capex_versions', itemFk: 'capex_item_id', entity: CapexVersion },
} as const;

export async function ensureBudgetVersion(
  manager: EntityManager,
  scope: 'opex',
  params: EnsureBudgetVersionParams,
): Promise<EnsuredBudgetVersion<SpendVersion> | null>;
export async function ensureBudgetVersion(
  manager: EntityManager,
  scope: 'capex',
  params: EnsureBudgetVersionParams,
): Promise<EnsuredBudgetVersion<CapexVersion> | null>;
export async function ensureBudgetVersion(
  manager: EntityManager,
  scope: AmountScope,
  params: EnsureBudgetVersionParams,
): Promise<EnsuredBudgetVersion | null>;
export async function ensureBudgetVersion(
  manager: EntityManager,
  scope: AmountScope,
  params: EnsureBudgetVersionParams,
): Promise<EnsuredBudgetVersion | null> {
  const t = SCOPES[scope];
  const columns = ['tenant_id', t.itemFk, 'budget_year', 'version_name', 'input_grain', 'is_approved', 'as_of_date', 'allocation_method', 'notes'];
  const values: unknown[] = [
    params.tenantId, params.itemId, params.year, params.versionName, params.inputGrain, false, params.asOfDate,
    params.allocationMethod, params.notes ?? null,
  ];
  const casts = ['', '::uuid', '::int', '', '::input_grain', '', '::date', '', ''];
  if (params.allocationDriver !== undefined) {
    columns.push('allocation_driver');
    values.push(params.allocationDriver);
    casts.push('');
  }
  if (params.reportingCurrency !== undefined) {
    columns.push('reporting_currency');
    values.push(params.reportingCurrency);
    casts.push('');
  }
  const inserted: Array<{ id: string }> = await manager.query(
    `INSERT INTO ${t.versions} (${columns.join(', ')})
     VALUES (${values.map((_, i) => `$${i + 1}${casts[i]}`).join(', ')})
     ON CONFLICT DO NOTHING
     RETURNING id`,
    values,
  );
  let id = inserted[0]?.id;
  const created = !!id;
  if (!id) {
    const [existing] = await manager.query(
      `SELECT id FROM ${t.versions} WHERE tenant_id = $1 AND ${t.itemFk} = $2 AND budget_year = $3`,
      [params.tenantId, params.itemId, params.year],
    );
    id = existing?.id;
  }
  if (!id) return null;
  const version = await manager.getRepository<BudgetVersionEntity>(t.entity).findOne({ where: { id, tenant_id: params.tenantId } as any });
  return version ? { version, created } : null;
}
