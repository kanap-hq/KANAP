import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, HttpStatus, NotFoundException } from '@nestjs/common';
import { DeepPartial, EntityManager, In } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { CapexAllocation } from '../capex/capex-allocation.entity';
import { CapexVersion } from '../capex/capex-version.entity';
import { Company } from '../companies/company.entity';
import { EDIT_CONFLICT_CODE, EditConflictAuthor, authorAt, userNames } from '../common/edit-conflicts';
import { Department } from '../departments/department.entity';
import { DepartmentMetric } from '../departments/department-metric.entity';
import { AmountScope } from './amounts-write.util';
import { AllocationDriver, computeCompanyShares, normalizeWeights } from './allocation-distribution';
import { sameAllocationRows, storedAllocationPct } from './budget-allocation-operations';
import { lockVersionWithLine } from './budget-locks';
import { SpendAllocation } from './spend-allocation.entity';
import { SpendVersion } from './spend-version.entity';

/**
 * Saving a version's allocation, for OPEX and CAPEX alike (plan
 * planning/perf-scale, lot 3E; scenarios 10 and 11 of Annexe A).
 *
 * Two entry points share the rows logic:
 * - `bulkUpsertAllocations`, the rows save (`POST …/allocations/bulk-upsert`,
 *   the AI): the rows are read with the method and driver stored on the
 *   version, as before;
 * - `putVersionAllocations` (`PUT …/versions/:id/allocations`), the
 *   Allocations tab: the method, the driver and the rows in one request,
 *   under the line's then the version's lock (`budget-locks.ts`), so a method
 *   is never stored by one request and its rows by another, read with the
 *   method of someone else (scenario 10). With `base_signature` (the
 *   signature of the allocation the user's screen read, `listForVersion`),
 *   an allocation someone else changed meanwhile refuses the request: 409
 *   `edit_conflict` with the current allocation, who and when, and its
 *   signature (what « Overwrite » sends again as the base). Without it
 *   nothing is compared.
 *
 * The signature covers what the PUT replaces and nothing else (D2): the
 * method, the driver and the stored rows (companies, departments,
 * percentages as stored, origin). Not `budget_rev`, which also counts the
 * amounts: an amount typed in the Budget tab must not make the allocation
 * conflict. A request that would leave the allocation as it is now (the same
 * change made twice) is no conflict.
 */

// Table and entity names come only from here: never from the caller.
const SCOPES = {
  opex: { versions: 'spend_versions', allocations: 'spend_allocations', versionEntity: SpendVersion, allocationEntity: SpendAllocation },
  capex: { versions: 'capex_versions', allocations: 'capex_allocations', versionEntity: CapexVersion, allocationEntity: CapexAllocation },
} as const;

export const ALLOCATION_METHODS = ['default', 'headcount', 'it_users', 'turnover', 'manual_company', 'manual_department', 'manual_pct'] as const;
export const ALLOCATION_DRIVERS = ['headcount', 'it_users', 'turnover'] as const;
const MANUAL_METHODS = new Set<string>(['manual_company', 'manual_department', 'manual_pct']);

/** The signature of an allocation nobody touched (the default method and driver, no row): known to the screen before a version exists. */
export const UNTOUCHED_ALLOCATION_SIGNATURE = 'default';

export type AllocationInput = {
  company_id: string;
  department_id: string | null;
  allocation_pct?: number;
  driver_type?: string | null;
  driver_note?: string | null;
};

type AllocationVersion = SpendVersion | CapexVersion;
type AllocationRow = SpendAllocation | CapexAllocation;

export type AllocationSaveDeps = {
  manager: EntityManager;
  audit: Pick<AuditService, 'log'>;
  /** The scope's calculator: the shares of an automatic method. */
  calculator: {
    computeForVersions(versions: any[], opts: { manager: EntityManager; tenantId: string }): Promise<Map<string, { shares: Array<{ allocation_pct: number | string }> }>>;
  };
};

/** The driver a method takes when none is given. */
export function defaultAllocationDriver(method: string): string {
  return method === 'it_users' ? 'it_users' : method === 'turnover' ? 'turnover' : 'headcount';
}

type ComparableRow = {
  company_id: string;
  department_id: string | null;
  allocation_pct: number | string;
  is_system_generated?: boolean | null;
  rule_id?: string | null;
  materialized_from?: string | null;
};

/** A version's allocation as stored: what the signature covers. */
export type AllocationState = {
  method: string;
  driver: string;
  rows: ComparableRow[];
  /** The last write of the version or of one of its rows: the time of a change no audit row explains. */
  updatedAt: Date | null;
  budgetRev: number | null;
};

/** The signature of an allocation (see the file header); `UNTOUCHED_ALLOCATION_SIGNATURE` for the untouched one. */
export function allocationSignature(state: Pick<AllocationState, 'method' | 'driver' | 'rows'>): string {
  const method = state.method || 'default';
  const driver = state.driver || defaultAllocationDriver(method);
  if (method === 'default' && driver === 'headcount' && state.rows.length === 0) return UNTOUCHED_ALLOCATION_SIGNATURE;
  const rows = state.rows.map((row) => [
    String(row.company_id).toLowerCase(),
    row.department_id ? String(row.department_id).toLowerCase() : '',
    storedAllocationPct(row.allocation_pct || 0),
    row.is_system_generated ? 'system' : 'manual',
    row.rule_id ?? '',
    row.materialized_from ?? '',
  ].join('|')).sort();
  return createHash('sha256').update(JSON.stringify({ method, driver, rows })).digest('hex').slice(0, 32);
}

/** The version's method, driver and rows in one statement (one snapshot); null when the version is gone. */
export async function readAllocationState(manager: EntityManager, scope: AmountScope, tenantId: string, versionId: string): Promise<AllocationState | null> {
  const t = SCOPES[scope];
  const [row]: Array<{ allocation_method: string | null; allocation_driver: string | null; budget_rev: number | string | null; updated_at: Date | null; rows: ComparableRow[] | null; rows_updated_at: Date | null }> = await manager.query(
    `SELECT v.allocation_method, v.allocation_driver, v.budget_rev, v.updated_at,
            (SELECT json_agg(json_build_object(
                      'company_id', a.company_id, 'department_id', a.department_id, 'allocation_pct', a.allocation_pct::text,
                      'is_system_generated', a.is_system_generated, 'rule_id', a.rule_id, 'materialized_from', a.materialized_from)
                    ORDER BY a.company_id, a.department_id)
               FROM ${t.allocations} a WHERE a.tenant_id = v.tenant_id AND a.version_id = v.id) AS rows,
            (SELECT max(a.updated_at) FROM ${t.allocations} a WHERE a.tenant_id = v.tenant_id AND a.version_id = v.id) AS rows_updated_at
       FROM ${t.versions} v
      WHERE v.tenant_id = $1 AND v.id = $2`,
    [tenantId, versionId],
  );
  if (!row) return null;
  const method = row.allocation_method || 'default';
  const times = [row.updated_at, row.rows_updated_at].filter((d): d is Date => !!d).map((d) => new Date(d).getTime());
  return {
    method,
    driver: row.allocation_driver || defaultAllocationDriver(method),
    rows: row.rows ?? [],
    updatedAt: times.length > 0 ? new Date(Math.max(...times)) : null,
    budgetRev: row.budget_rev == null ? null : Number(row.budget_rev),
  };
}

/** What a save stores: the rows of a manual method, none for an automatic one, or the stored rows kept. */
type RowsPlan = { kind: 'auto' } | { kind: 'keep' } | { kind: 'manual'; rows: AllocationRow[] };

/**
 * The rows a save stores for `method` (validated, computed from the metrics
 * for the by-company and by-department methods). A manual method without a
 * row is refused (`emptyManual: 'refuse'`, the rows save) or keeps the rows
 * stored (`'keep'`, the Allocations tab while the user is still picking).
 */
async function planRows(
  manager: EntityManager,
  scope: AmountScope,
  tenantId: string,
  version: AllocationVersion,
  method: string,
  driver: string,
  items: AllocationInput[],
  emptyManual: 'refuse' | 'keep',
): Promise<RowsPlan> {
  const repo = manager.getRepository<AllocationRow>(SCOPES[scope].allocationEntity);
  const isManual = MANUAL_METHODS.has(method);
  if (!isManual) {
    if (items.length > 0) {
      throw new BadRequestException('Automatic allocation methods do not accept manual rows. Save without overrides.');
    }
    return { kind: 'auto' };
  }
  if (items.length === 0) {
    if (emptyManual === 'keep') return { kind: 'keep' };
    throw new BadRequestException('No allocations provided for manual method');
  }
  const row = (fields: { company_id: string; department_id: string | null; allocation_pct: number }) => repo.create({
    version_id: version.id,
    company_id: fields.company_id,
    department_id: fields.department_id,
    allocation_pct: fields.allocation_pct,
    is_system_generated: false,
    rule_id: null,
    materialized_from: null,
    tenant_id: tenantId,
  } as DeepPartial<AllocationRow>);

  if (method === 'manual_pct') {
    // True manual percentages: persist exactly what the user entered (validated to 100%).
    const rows = items
      .filter((item) => item.company_id)
      .map((item) => ({ company_id: item.company_id, allocation_pct: Number(item.allocation_pct ?? 0) }));
    if (rows.length === 0) {
      throw new BadRequestException('Select at least one company for manual allocation.');
    }
    if (rows.some((item) => !Number.isFinite(item.allocation_pct) || item.allocation_pct < 0)) {
      throw new BadRequestException('Allocation percentages must be zero or positive numbers.');
    }
    const sum = rows.reduce((acc, item) => acc + item.allocation_pct, 0);
    if (sum < 99.99 || sum > 100.01) {
      throw new BadRequestException(`Manual percentages must sum to 100% (currently ${Math.round(sum * 100) / 100}%).`);
    }
    // Every company is resolved in the tenant: a foreign key does not check it.
    const companyIds = Array.from(new Set(rows.map((item) => item.company_id)));
    const found = await manager.getRepository(Company).count({ where: { tenant_id: tenantId, id: In(companyIds) } as any });
    if (found !== companyIds.length) {
      throw new BadRequestException('One or more companies were not found.');
    }
    // One row per company (unique key on version, company, department): a company picked
    // on two lines gets their percentages added, the split it had before.
    const byCompany = new Map<string, number>();
    for (const item of rows) byCompany.set(item.company_id, (byCompany.get(item.company_id) ?? 0) + item.allocation_pct);
    return {
      kind: 'manual',
      rows: Array.from(byCompany, ([company_id, pct]) => row({ company_id, department_id: null, allocation_pct: Math.round(pct * 10000) / 10000 })),
    };
  }

  if (method === 'manual_company') {
    const companyIds = Array.from(new Set(items.map((item) => item.company_id).filter((id): id is string => !!id)));
    if (companyIds.length === 0) {
      throw new BadRequestException('Select at least one company for manual allocation.');
    }
    const distribution = await computeCompanyShares({
      manager,
      tenantId,
      fiscalYear: (version as any).budget_year,
      companyIds,
      driver: driver as AllocationDriver,
    });
    return { kind: 'manual', rows: companyIds.map((companyId) => row({ company_id: companyId, department_id: null, allocation_pct: distribution.get(companyId) ?? 0 })) };
  }

  const selections = items
    .filter((item) => item.company_id && item.department_id)
    .map((item) => ({ company_id: item.company_id, department_id: item.department_id as string }));
  if (selections.length === 0) {
    throw new BadRequestException('Select at least one department for manual allocation.');
  }
  const computed = await manualDepartmentDistribution(manager, tenantId, (version as any).budget_year, selections);
  return { kind: 'manual', rows: computed.map((share) => row(share)) };
}

/** Departments weighted by their headcount of the year. */
async function manualDepartmentDistribution(
  manager: EntityManager,
  tenantId: string,
  fiscalYear: number,
  selections: Array<{ company_id: string; department_id: string }>,
): Promise<Array<{ company_id: string; department_id: string; allocation_pct: number }>> {
  const uniqueDeptIds = Array.from(new Set(selections.map((s) => s.department_id)));
  const departments = await manager.getRepository(Department).find({ where: { tenant_id: tenantId, id: In(uniqueDeptIds) as any } as any });
  if (departments.length !== uniqueDeptIds.length) {
    throw new BadRequestException('Some departments could not be found for manual allocation.');
  }
  const metrics = await manager.getRepository(DepartmentMetric).find({
    where: { tenant_id: tenantId, fiscal_year: fiscalYear, department_id: In(uniqueDeptIds) as any } as any,
  });
  const weights = uniqueDeptIds.map((deptId) => {
    const metric = metrics.find((m) => m.department_id === deptId);
    return { id: deptId, weight: Number(metric?.headcount ?? 0) };
  });
  if (weights.some((entry) => !Number.isFinite(entry.weight) || entry.weight <= 0)) {
    throw new BadRequestException('Provide headcount values for the selected departments.');
  }
  return normalizeWeights(weights).map(({ id, pct }) => {
    const department = departments.find((d) => d.id === id)!;
    const provided = selections.find((s) => s.department_id === id);
    if (provided?.company_id && provided.company_id !== department.company_id) {
      throw new BadRequestException('Department does not belong to the selected company.');
    }
    return { company_id: department.company_id, department_id: id, allocation_pct: pct };
  });
}

/**
 * Stores the planned rows, with one audit row keyed by the version: an
 * automatic method drops the stored rows (its shares are computed from the
 * metrics), a manual one replaces them unless the split is already stored
 * (no write, no audit row, no `budget_rev` bump). The caller holds the line
 * and the version.
 */
async function storeRows(
  deps: AllocationSaveDeps,
  scope: AmountScope,
  tenantId: string,
  version: AllocationVersion,
  plan: RowsPlan,
  userId: string | null | undefined,
): Promise<{ updated: number; total_pct: number }> {
  const { manager } = deps;
  const t = SCOPES[scope];
  const repo = manager.getRepository<AllocationRow>(t.allocationEntity);
  const before = await repo.find({ where: { tenant_id: tenantId, version_id: version.id } as any });
  const round = (total: number) => Math.round(total * 10000) / 10000;

  if (plan.kind === 'auto') {
    if (before.length > 0) await repo.delete({ tenant_id: tenantId, version_id: version.id } as any);
    const computation = await deps.calculator.computeForVersions([version], { manager, tenantId });
    const total = computation.get(version.id)?.shares.reduce((acc, share) => acc + Number(share.allocation_pct || 0), 0) ?? 0;
    // Keyed by the version: the Allocations tab's conflicts read who changed the allocation from here.
    await deps.audit.log({ table: t.allocations, recordId: version.id, action: 'update', before, after: [], userId }, { manager });
    return { updated: 0, total_pct: round(total) };
  }

  let after: AllocationRow[] = before;
  if (plan.kind === 'manual' && !sameAllocationRows(before, plan.rows)) {
    await repo.delete({ tenant_id: tenantId, version_id: version.id } as any);
    after = await repo.save(plan.rows);
    await deps.audit.log({ table: t.allocations, recordId: version.id, action: 'update', before, after, userId }, { manager });
  }
  return { updated: after.length, total_pct: round(after.reduce((acc, row) => acc + Number(row.allocation_pct || 0), 0)) };
}

/**
 * The rows save: the rows are read with the method and driver stored on the
 * version. Locks the line, then the version, before the rows are read or
 * replaced: two saves of one version take turns and the version ends with
 * one split, never both (scenario 11).
 */
export async function bulkUpsertAllocations(
  deps: AllocationSaveDeps,
  scope: AmountScope,
  tenantId: string,
  versionId: string,
  items: AllocationInput[],
  userId: string | null | undefined,
): Promise<{ updated: number; total_pct: number }> {
  const { manager } = deps;
  if (!Array.isArray(items)) throw new BadRequestException('Invalid payload');
  if (!(await lockVersionWithLine(manager, scope, tenantId, versionId))) throw new BadRequestException('Invalid version');
  const version = await manager.getRepository<AllocationVersion>(SCOPES[scope].versionEntity).findOne({ where: { id: versionId, tenant_id: tenantId } as any });
  if (!version) throw new BadRequestException('Invalid version');
  const method = (version.allocation_method as string | null) ?? 'default';
  const driver = (version.allocation_driver as string | null) ?? 'headcount';
  const plan = await planRows(manager, scope, tenantId, version, method, driver, items, 'refuse');
  return storeRows(deps, scope, tenantId, version, plan, userId);
}

/** The body of the PUT, validated. */
function parsePutBody(body: unknown): { method: string; driver: string | null; rows: AllocationInput[]; baseSignature: string | null } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('Send the allocation as an object: method, driver, rows and base_signature.');
  }
  const input = body as Record<string, unknown>;
  const method = input.method;
  if (typeof method !== 'string' || !(ALLOCATION_METHODS as readonly string[]).includes(method)) {
    throw new BadRequestException(`Unknown allocation method '${String(method ?? '')}'. Use ${ALLOCATION_METHODS.join(', ')}.`);
  }
  const driver = input.driver;
  if (driver !== undefined && driver !== null && (typeof driver !== 'string' || !(ALLOCATION_DRIVERS as readonly string[]).includes(driver))) {
    throw new BadRequestException(`Unknown allocation driver '${String(driver)}'. Use ${ALLOCATION_DRIVERS.join(', ')}.`);
  }
  const rows = input.rows ?? [];
  if (!Array.isArray(rows)) throw new BadRequestException('rows must be a list of allocation rows.');
  const base = input.base_signature;
  if (base !== undefined && base !== null && typeof base !== 'string') throw new BadRequestException('base_signature must be the signature the allocation was read with.');
  return { method, driver: (driver as string | null | undefined) ?? null, rows: rows as AllocationInput[], baseSignature: (base as string | null | undefined) ?? null };
}

/** The driver a PUT stores: a method's own, else the one sent for "by company", else head count. */
function driverFor(method: string, sent: string | null): string {
  if (method === 'it_users' || method === 'turnover') return method;
  if (method === 'manual_company') return sent ?? 'headcount';
  return 'headcount';
}

/** The allocation as the 409 shows it. */
type AllocationView = { method: string; driver: string; rows: Array<{ company_id: string; department_id: string | null; allocation_pct: number }> };

const viewOf = (method: string, driver: string, rows: ComparableRow[]): AllocationView => ({
  method,
  driver,
  rows: rows.map((row) => ({ company_id: row.company_id, department_id: row.department_id ?? null, allocation_pct: Number(storedAllocationPct(row.allocation_pct || 0)) })),
});

export type AllocationConflict = {
  field: 'allocations';
  base: null;
  current: AllocationView;
  mine: AllocationView;
  labels: { base: null; current: null; mine: null };
  changed_by: EditConflictAuthor | null;
  changed_at: string | null;
};

export const ALLOCATION_CONFLICT_MESSAGE = 'Someone else changed this allocation while you were editing it. Reload it, or overwrite it with yours.';

export class AllocationEditConflictException extends ConflictException {
  constructor(readonly conflict: AllocationConflict, readonly baseSignature: string, readonly budgetRev: number | null) {
    super({
      statusCode: HttpStatus.CONFLICT,
      error: 'Conflict',
      code: EDIT_CONFLICT_CODE,
      message: ALLOCATION_CONFLICT_MESSAGE,
      conflicts: [conflict],
      base_signature: baseSignature,
      budget_rev: budgetRev,
    });
  }
}

/**
 * Who wrote the current allocation, and when: the latest audit row of the
 * version that changed its rows, or its method or driver, when it explains the
 * current state; otherwise nobody, at the last write of the version or its rows.
 */
async function allocationAuthor(manager: EntityManager, scope: AmountScope, tenantId: string, versionId: string, state: AllocationState) {
  const t = SCOPES[scope];
  const [row]: Array<{ user_id: string | null; created_at: Date; table_name: string; after_json: unknown }> = await manager.query(
    `SELECT l.user_id::text AS user_id, l.created_at, l.table_name, l.after_json
       FROM audit_log l
      WHERE l.tenant_id = $1 AND l.record_id = $2
        AND (
          (l.table_name = $3 AND l.before_json IS DISTINCT FROM l.after_json)
          OR (l.table_name = $4 AND (
                (l.before_json->>'allocation_method') IS DISTINCT FROM (l.after_json->>'allocation_method')
             OR (l.before_json->>'allocation_driver') IS DISTINCT FROM (l.after_json->>'allocation_driver')))
        )
      ORDER BY l.created_at DESC
      LIMIT 1`,
    [tenantId, versionId, t.allocations, t.versions],
  );
  let explains = false;
  if (row) {
    const after = row.after_json as any;
    if (row.table_name === t.allocations) {
      // A save writes the rows; the yearly copy writes how many it copied.
      explains = Array.isArray(after)
        ? sameAllocationRows(after, state.rows)
        : !!after && typeof after === 'object' && Number(after.count) === state.rows.filter((r) => !r.is_system_generated).length;
    } else {
      explains = !!after && (after.allocation_method ?? 'default') === state.method
        && (after.allocation_driver === undefined || (after.allocation_driver ?? defaultAllocationDriver(state.method)) === state.driver);
    }
  }
  const pick = explains ? { userId: row.user_id, at: row.created_at } : { userId: null, at: state.updatedAt };
  const names = await userNames(manager, tenantId, [pick.userId]);
  return authorAt(names, pick.userId, pick.at);
}

/**
 * The PUT of a version's allocation: method, driver and rows in one request
 * (see the file header). Returns what is stored and its new signature.
 */
export async function putVersionAllocations(
  deps: AllocationSaveDeps,
  scope: AmountScope,
  tenantId: string,
  versionId: string,
  body: unknown,
  userId: string | null | undefined,
): Promise<{ updated: number; total_pct: number; method: string; driver: string; base_signature: string }> {
  const { manager } = deps;
  const t = SCOPES[scope];
  const request = parsePutBody(body);
  if (!(await lockVersionWithLine(manager, scope, tenantId, versionId))) throw new NotFoundException('Version not found');
  const versions = manager.getRepository<AllocationVersion>(t.versionEntity);
  const version = await versions.findOne({ where: { id: versionId, tenant_id: tenantId } as any });
  const state = await readAllocationState(manager, scope, tenantId, versionId);
  if (!version || !state) throw new NotFoundException('Version not found');

  const method = request.method;
  const driver = driverFor(method, request.driver);
  // Validated and computed before anything is compared or written: a refused row answers 400.
  const plan = await planRows(manager, scope, tenantId, version, method, driver, request.rows, 'keep');

  if (request.baseSignature !== null) {
    const current = allocationSignature(state);
    if (current !== request.baseSignature) {
      const mineRows: ComparableRow[] = plan.kind === 'auto' ? [] : plan.kind === 'keep' ? state.rows : (plan.rows as ComparableRow[]);
      // Someone else changed it, unless it already is what this request stores.
      if (allocationSignature({ method, driver, rows: mineRows }) !== current) {
        throw new AllocationEditConflictException(
          {
            field: 'allocations',
            base: null,
            current: viewOf(state.method, state.driver, state.rows),
            mine: viewOf(method, driver, mineRows),
            labels: { base: null, current: null, mine: null },
            ...(await allocationAuthor(manager, scope, tenantId, versionId, state)),
          },
          current,
          state.budgetRev,
        );
      }
    }
  }

  if (state.method !== method || state.driver !== driver) {
    await manager.createQueryBuilder().update(t.versionEntity)
      .set({ allocation_method: method, allocation_driver: driver } as any)
      .where('tenant_id = :tenantId AND id = :versionId', { tenantId, versionId })
      .execute();
    await deps.audit.log({
      table: t.versions,
      recordId: versionId,
      action: 'update',
      before: { allocation_method: state.method, allocation_driver: state.driver },
      after: { allocation_method: method, allocation_driver: driver },
      userId,
    }, { manager });
    (version as any).allocation_method = method;
    (version as any).allocation_driver = driver;
  }
  const stored = plan.kind === 'keep'
    ? { updated: state.rows.length, total_pct: Math.round(state.rows.reduce((acc, row) => acc + Number(row.allocation_pct || 0), 0) * 10000) / 10000 }
    : await storeRows(deps, scope, tenantId, version, plan, userId);
  const after = await readAllocationState(manager, scope, tenantId, versionId);
  return { ...stored, method, driver, base_signature: after ? allocationSignature(after) : allocationSignature({ method, driver, rows: [] }) };
}
