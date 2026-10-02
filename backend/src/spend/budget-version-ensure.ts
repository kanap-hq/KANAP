import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CapexVersion } from '../capex/capex-version.entity';
import { AmountScope } from './amounts-write.util';
import { lockBudgetLine, lockBudgetVersions } from './budget-locks';
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

/** Version columns a PATCH writes as given (when present); the allocation fields, the currency and the approval have their own rules. */
const VERSION_PLAIN_COLUMNS = ['version_name', 'input_grain', 'as_of_date', 'notes'] as const;

const defaultDriver = (method: string) => (method === 'it_users' ? 'it_users' : method === 'turnover' ? 'turnover' : 'headcount');

/**
 * The PATCH of a budget version (the budget tab's view, the allocations tab's
 * method, the AI), for OPEX and CAPEX alike (plan planning/perf-scale, lot 3B,
 * Annexe A #2 on versions). It used to merge the body into the version it
 * read and `save()` it, putting back a field another request committed in
 * between. Now the line, then the version are locked (`budget-locks.ts`), the
 * version is read again under the lock, and one UPDATE sets only the columns
 * the body supplies: `version_name`, `input_grain`, `as_of_date`, `notes`;
 * `allocation_method` (with its default driver unless one is given),
 * `allocation_driver`, `reporting_currency` when not empty; `is_approved:
 * false` clears the rate set. The budget year never changes. Returns the
 * version before (as locked) and after, for the caller's audit row.
 */
export async function updateBudgetVersionUnderLock(
  manager: EntityManager,
  scope: AmountScope,
  itemId: string,
  body: Record<string, unknown> & { id?: unknown },
  duplicateNameMessage: string,
): Promise<{ before: BudgetVersionEntity; after: BudgetVersionEntity }> {
  const versionId = typeof body?.id === 'string' ? body.id : null;
  if (!versionId) throw new BadRequestException('id is required');
  const t = SCOPES[scope];
  const [{ tenant_id: tenantId }] = await manager.query(`SELECT app_current_tenant() AS tenant_id`);
  if (!tenantId) throw new BadRequestException('Tenant context is required');
  const repo = manager.getRepository<BudgetVersionEntity>(t.entity);
  const read = () => repo.findOne({ where: { id: versionId, tenant_id: tenantId } as any });
  if (!(await lockBudgetLine(manager, scope, tenantId, itemId))) throw new NotFoundException('Version not found');
  const before = (await lockBudgetVersions(manager, scope, tenantId, [versionId])).has(versionId) ? await read() : null;
  if (!before) throw new NotFoundException('Version not found');
  if ((before as any)[t.itemFk] !== itemId) throw new BadRequestException('Version does not belong to item');
  if (body.budget_year != null && body.budget_year !== before.budget_year) {
    throw new BadRequestException('budget_year is immutable');
  }
  if (body.version_name && body.version_name !== before.version_name) {
    const duplicate = await repo.findOne({ where: { tenant_id: tenantId, [t.itemFk]: itemId, version_name: String(body.version_name) } as any });
    if (duplicate) throw new BadRequestException(duplicateNameMessage);
  }

  const set: Record<string, unknown> = {};
  for (const column of VERSION_PLAIN_COLUMNS) {
    if (body[column] !== undefined) set[column] = body[column];
  }
  if (body.allocation_method) {
    set.allocation_method = body.allocation_method;
    if (!body.allocation_driver) set.allocation_driver = defaultDriver(String(body.allocation_method));
  }
  if (body.allocation_driver) set.allocation_driver = body.allocation_driver;
  if (body.reporting_currency) set.reporting_currency = String(body.reporting_currency).trim().toUpperCase().slice(0, 3);
  if (body.is_approved === false) set.fx_rate_set_id = null;
  if (Object.keys(set).length > 0) {
    await manager.createQueryBuilder().update(t.entity).set(set as any).where('tenant_id = :tenantId AND id = :versionId', { tenantId, versionId }).execute();
  }
  return { before, after: (await read()) ?? before };
}
