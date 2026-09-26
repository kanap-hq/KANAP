import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { toCents } from '../common/amount';
import {
  AmountMeasure,
  AmountScope,
  AmountsPayloadResult,
  AmountsWriteContext,
  AmountVersion,
  FLAT_PROFILE,
  PayloadSpread,
  replaceAmounts,
  spreadAnnualRows,
} from './amounts-write.util';

/**
 * Round inputs: for each planning column of a version (Budget, Revision,
 * Forecast, Landing), the period its last spread used and how the column was
 * produced. Shared by OPEX (`spend_round_inputs`) and CAPEX
 * (`capex_round_inputs`); written in the caller's transaction, next to the
 * amounts, with one audit row per record change.
 *
 * Actuals never get a record: every function refuses `actual` before any SQL
 * (the table's check constraint refuses it too).
 */

export type PlanningMeasure = 'planned' | 'committed' | 'forecast' | 'expected_landing';
export const PLANNING_MEASURES: readonly PlanningMeasure[] = ['planned', 'committed', 'forecast', 'expected_landing'];

export type RoundMethod = 'spread' | 'copied' | 'manual';

export type LastCalculation =
  | { kind: 'annual'; total: string; profile: string; active_months: number[]; weights: string[]; source?: 'item_csv' }
  | { kind: 'quarterly'; quarters: { Q1: string; Q2: string; Q3: string; Q4: string }; distribution: 'equal' | '445'; active_months: number[] }
  | {
    kind: 'copy';
    source_year: number;
    source_measure: 'planned' | 'committed' | 'actual' | 'expected_landing';
    uplift_pct: string;
    source_total: string;
    total: string;
    source_method: RoundMethod | null;
  };

/** A record as the API returns it. */
export type RoundInput = {
  measure: PlanningMeasure;
  period_start: string;
  period_end: string;
  method: RoundMethod;
  spread_profile_name: string | null;
  last_calculation: LastCalculation | null;
  updated_at: string;
  updated_by: string | null;
};

/** The fields a write sets. */
export type RoundInputFields = Pick<RoundInput, 'period_start' | 'period_end' | 'method' | 'spread_profile_name' | 'last_calculation'>;

type StoredRoundInput = Omit<RoundInput, 'updated_at'> & {
  id: string;
  tenant_id: string;
  version_id: string;
  created_at: Date;
  updated_at: Date;
};

// Table names come only from here: never from the caller.
const ROUND_TABLE: Record<AmountScope, 'spend_round_inputs' | 'capex_round_inputs'> = {
  opex: 'spend_round_inputs',
  capex: 'capex_round_inputs',
};

const COLUMNS = `id, tenant_id, version_id, measure,
  to_char(period_start, 'YYYY-MM-DD') AS period_start, to_char(period_end, 'YYYY-MM-DD') AS period_end,
  method, spread_profile_name, last_calculation, created_at, updated_at, updated_by`;

export type RoundInputsContext = {
  manager: EntityManager;
  scope: AmountScope;
  /** Loaded by the caller under the tenant's RLS; its tenant_id scopes every statement. */
  version: AmountVersion;
  userId: string | null;
  audit: Pick<AuditService, 'log'>;
};

export function isPlanningMeasure(value: unknown): value is PlanningMeasure {
  return typeof value === 'string' && (PLANNING_MEASURES as readonly string[]).includes(value);
}

function assertPlanningMeasure(measure: string): PlanningMeasure {
  if (measure === 'actual') {
    throw new InternalServerErrorException('Actuals never get a spread period: no round input may be written for them.');
  }
  if (!isPlanningMeasure(measure)) throw new InternalServerErrorException(`Unknown budget column '${measure}'.`);
  return measure;
}

function assertTenant(version: AmountVersion) {
  if (typeof version.tenant_id !== 'string' || version.tenant_id.trim() === '') {
    throw new InternalServerErrorException(`Round inputs refused: version ${version.id} carries no tenant_id.`);
  }
}

/** Cents as a decimal string with two decimals ('12000.00', '-0.05'). */
export function centsToDecimal(cents: bigint): string {
  const negative = cents < 0n;
  const digits = (negative ? -cents : cents).toString().padStart(3, '0');
  return `${negative ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

export function wholeYear(year: number): { period_start: string; period_end: string } {
  return { period_start: `${year}-01-01`, period_end: `${year}-12-31` };
}

function toApi(row: StoredRoundInput): RoundInput {
  return {
    measure: row.measure,
    period_start: row.period_start,
    period_end: row.period_end,
    method: row.method,
    spread_profile_name: row.spread_profile_name,
    last_calculation: row.last_calculation,
    updated_at: new Date(row.updated_at).toISOString(),
    updated_by: row.updated_by,
  };
}

const MEASURE_ORDER = new Map(PLANNING_MEASURES.map((m, i) => [m as string, i]));

/** The records of several versions in one query, keyed by version id, in column order. */
export async function listRoundInputs(
  manager: EntityManager,
  scope: AmountScope,
  tenantId: string,
  versionIds: string[],
): Promise<Map<string, RoundInput[]>> {
  const result = new Map<string, RoundInput[]>(versionIds.map((id) => [id, []]));
  if (versionIds.length === 0) return result;
  const rows: StoredRoundInput[] = await manager.query(
    `SELECT ${COLUMNS} FROM ${ROUND_TABLE[scope]} WHERE tenant_id = $1 AND version_id = ANY($2::uuid[])`,
    [tenantId, versionIds],
  );
  rows.sort((a, b) => (MEASURE_ORDER.get(a.measure) ?? 9) - (MEASURE_ORDER.get(b.measure) ?? 9));
  for (const row of rows) result.get(row.version_id)?.push(toApi(row));
  return result;
}

/** Every record of one version, in column order. */
export async function versionRoundInputs(manager: EntityManager, scope: AmountScope, version: AmountVersion): Promise<RoundInput[]> {
  assertTenant(version);
  return (await listRoundInputs(manager, scope, version.tenant_id, [version.id])).get(version.id) ?? [];
}

async function readRecord(ctx: RoundInputsContext, measure: PlanningMeasure): Promise<StoredRoundInput | null> {
  const rows: StoredRoundInput[] = await ctx.manager.query(
    `SELECT ${COLUMNS} FROM ${ROUND_TABLE[ctx.scope]}
     WHERE tenant_id = $1 AND version_id = $2 AND measure = $3
     FOR UPDATE`,
    [ctx.version.tenant_id, ctx.version.id, measure],
  );
  return rows[0] ?? null;
}

/** JSON with sorted keys, so a stored jsonb and a new value compare equal when they are. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as any)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function sameFields(stored: StoredRoundInput, next: RoundInputFields): boolean {
  return stored.period_start === next.period_start
    && stored.period_end === next.period_end
    && stored.method === next.method
    && (stored.spread_profile_name ?? null) === (next.spread_profile_name ?? null)
    && canonical(stored.last_calculation) === canonical(next.last_calculation);
}

function assertPeriodInVersionYear(version: AmountVersion, fields: RoundInputFields) {
  const year = String(Number(version.budget_year));
  const inYear = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && date.slice(0, 4) === year;
  if (!inYear(fields.period_start) || !inYear(fields.period_end) || fields.period_start > fields.period_end) {
    throw new BadRequestException(`The period ${fields.period_start} to ${fields.period_end} must lie within ${year}.`);
  }
}

/**
 * Create, change or leave one record. `next` receives the stored record (or
 * null) and returns the fields to store, or null to leave it as it is. An
 * identical result writes nothing, so a no-op keeps the provenance and its
 * author. Returns the record as stored afterwards.
 */
export async function saveRoundInput(
  ctx: RoundInputsContext,
  rawMeasure: string,
  next: (stored: RoundInput | null) => RoundInputFields | null,
): Promise<RoundInput | null> {
  const measure = assertPlanningMeasure(rawMeasure);
  assertTenant(ctx.version);
  const stored = await readRecord(ctx, measure);
  const fields = next(stored ? toApi(stored) : null);
  if (!fields) return stored ? toApi(stored) : null;
  if (stored && sameFields(stored, fields)) return toApi(stored);
  assertPeriodInVersionYear(ctx.version, fields);
  const [saved]: StoredRoundInput[] = await ctx.manager.query(
    `INSERT INTO ${ROUND_TABLE[ctx.scope]}
       (tenant_id, version_id, measure, period_start, period_end, method, spread_profile_name, last_calculation, updated_by)
     VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8::jsonb, $9::uuid)
     ON CONFLICT (tenant_id, version_id, measure) DO UPDATE
     SET period_start = EXCLUDED.period_start,
         period_end = EXCLUDED.period_end,
         method = EXCLUDED.method,
         spread_profile_name = EXCLUDED.spread_profile_name,
         last_calculation = EXCLUDED.last_calculation,
         updated_at = now(),
         updated_by = EXCLUDED.updated_by
     RETURNING ${COLUMNS}`,
    [
      ctx.version.tenant_id,
      ctx.version.id,
      measure,
      fields.period_start,
      fields.period_end,
      fields.method,
      fields.spread_profile_name ?? null,
      fields.last_calculation == null ? null : JSON.stringify(fields.last_calculation),
      ctx.userId || null,
    ],
  );
  await ctx.audit.log(
    {
      table: ROUND_TABLE[ctx.scope],
      recordId: saved.id,
      action: stored ? 'update' : 'create',
      before: stored,
      after: saved,
      userId: ctx.userId,
    },
    { manager: ctx.manager },
  );
  return toApi(saved);
}

/** Store `fields` as the record of `measure`, whatever was there. */
export function upsertRoundInput(ctx: RoundInputsContext, measure: string, fields: RoundInputFields) {
  return saveRoundInput(ctx, measure, () => fields);
}

/**
 * A hand edit of amounts: the record keeps its period, profile and last
 * calculation and becomes `manual`; a column without a record gets a
 * whole-year `manual` one. Already manual: nothing is written.
 */
export async function markRoundsManual(ctx: RoundInputsContext, measures: readonly string[]) {
  const year = Number(ctx.version.budget_year);
  for (const measure of measures) {
    await saveRoundInput(ctx, measure, (stored) => {
      if (stored?.method === 'manual') return null;
      return stored
        ? { ...stored, method: 'manual' }
        : { ...wholeYear(year), method: 'manual', spread_profile_name: null, last_calculation: null };
    });
  }
}

/** Delete the record of one column, if any. */
export async function deleteRoundInput(ctx: RoundInputsContext, rawMeasure: string) {
  const measure = assertPlanningMeasure(rawMeasure);
  assertTenant(ctx.version);
  // Read (and lock) first: the audit needs the row, and a DELETE … RETURNING
  // comes back from TypeORM as [rows, count] rather than rows.
  const stored = await readRecord(ctx, measure);
  if (!stored) return;
  await ctx.manager.query(
    `DELETE FROM ${ROUND_TABLE[ctx.scope]} WHERE tenant_id = $1 AND id = $2`,
    [ctx.version.tenant_id, stored.id],
  );
  await ctx.audit.log(
    { table: ROUND_TABLE[ctx.scope], recordId: stored.id, action: 'delete', before: stored, after: null, userId: ctx.userId },
    { manager: ctx.manager },
  );
}

/**
 * The records a spread writes: one `spread` record per planning measure it
 * replaced, with the period, the profile and what was computed. Actuals are
 * skipped.
 */
export async function recordSpread(ctx: RoundInputsContext, spread: PayloadSpread, source?: 'item_csv') {
  const { period_start, period_end, active_months } = spread.period;
  if (spread.kind === 'annual') {
    const activeWeights = active_months.map((m) => spread.profile.labels[m - 1]);
    for (const measure of PLANNING_MEASURES) {
      const total = spread.totals[measure];
      if (total === undefined) continue;
      await upsertRoundInput(ctx, measure, {
        period_start,
        period_end,
        method: 'spread',
        spread_profile_name: spread.profile.name,
        last_calculation: {
          kind: 'annual',
          total: centsToDecimal(total),
          profile: spread.profile.name,
          active_months,
          weights: activeWeights,
          ...(source ? { source } : {}),
        },
      });
    }
    return;
  }
  if (!isPlanningMeasure(spread.measure)) return;
  const q = spread.quarters;
  await upsertRoundInput(ctx, spread.measure, {
    period_start,
    period_end,
    method: 'spread',
    spread_profile_name: spread.distribution === '445' ? '4-4-5' : 'flat',
    last_calculation: {
      kind: 'quarterly',
      quarters: { Q1: centsToDecimal(q.Q1), Q2: centsToDecimal(q.Q2), Q3: centsToDecimal(q.Q3), Q4: centsToDecimal(q.Q4) },
      distribution: spread.distribution,
      active_months,
    },
  });
}

/**
 * Round inputs after an amounts payload: a spread records its period and
 * profile; a monthly patch marks `manual` each planning measure whose stored
 * cents actually changed (a month the patch created was zero before), so a
 * no-op resubmit leaves the provenance alone.
 */
export async function recordPayloadRoundInputs(ctx: RoundInputsContext, result: AmountsPayloadResult) {
  if (result.spread) {
    await recordSpread(ctx, result.spread);
    return;
  }
  const beforeByPeriod = new Map(result.before.map((row) => [row.period, row]));
  const changed = result.measures.filter((measure: AmountMeasure) => isPlanningMeasure(measure) && result.after.some((row) => {
    const before = beforeByPeriod.get(row.period);
    return toCents(before ? before[measure] : 0) !== toCents(row[measure]);
  }));
  if (changed.length > 0) await markRoundsManual(ctx, changed);
}

/**
 * Yearly totals of the legacy item CSV: each measure given is spread flat
 * over the whole year and replaces its twelve months; each planning measure
 * gets a whole-year `spread` record marked as coming from the item file.
 * A measure left out (blank cell) is not written and keeps its record.
 */
export async function writeItemCsvTotals(
  ctx: AmountsWriteContext,
  rounds: Pick<RoundInputsContext, 'userId' | 'audit'>,
  year: number,
  totals: Partial<Record<AmountMeasure, bigint>>,
) {
  if (Object.keys(totals).length === 0) return;
  await replaceAmounts(ctx, year, spreadAnnualRows(year, totals));
  await recordSpread(
    { manager: ctx.manager, scope: ctx.scope, version: ctx.version, ...rounds },
    {
      kind: 'annual',
      totals,
      profile: FLAT_PROFILE,
      period: { ...wholeYear(year), active_months: Array.from({ length: 12 }, (_, i) => i + 1) },
    },
    'item_csv',
  );
}
