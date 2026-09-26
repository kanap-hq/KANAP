import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { DeepPartial, EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { FreezeService } from '../freeze/freeze.service';
import { formatCents } from '../common/amount';
import { Decimal, DECIMAL_SCALE_DIGITS, divRoundHalfAway } from '../common/decimal';
import { SpendVersion } from './spend-version.entity';
import { CapexVersion } from '../capex/capex-version.entity';
import {
  AmountMeasure,
  AmountScope,
  AmountVersion,
  BUDGET_COLUMN_MEASURE,
  BudgetColumn,
  MEASURE_FREEZE_COLUMN,
  readVersionMonths,
  replaceAmounts,
  yearPeriods,
} from './amounts-write.util';
import {
  centsToDecimal,
  deleteRoundInput,
  isPlanningMeasure,
  listRoundInputs,
  RoundInput,
  RoundInputsContext,
  upsertRoundInput,
  wholeYear,
} from './round-inputs.util';

/**
 * Budget column operations (copy a column to another year or column, clear a
 * column), for OPEX and CAPEX alike.
 *
 * Both run inside the request transaction and are all or nothing: an error on
 * any item fails the request, and the request transaction rolls every item
 * back. Items without a source, with an all-zero source, or with a
 * destination that already has amounts (without overwrite) are skipped.
 */

// Table and column names come only from here: never from the caller.
const SCOPES = {
  opex: { items: 'spend_items', itemFk: 'spend_item_id', versions: 'spend_versions', itemName: 'product_name' },
  capex: { items: 'capex_items', itemFk: 'capex_item_id', versions: 'capex_versions', itemName: 'description' },
} as const;

export type BudgetOperationDeps = {
  manager: EntityManager;
  audit: Pick<AuditService, 'log'>;
  freeze: Pick<FreezeService, 'assertNotFrozen'>;
};

type ItemRow = { id: string; tenant_id: string; name: string };
export type BudgetVersionRow = AmountVersion & { item_id: string; input_grain: 'annual' | 'quarterly' | 'monthly' };

export async function currentTenantId(manager: EntityManager): Promise<string> {
  const [row] = await manager.query(`SELECT app_current_tenant() AS tenant_id`);
  const tenantId = row?.tenant_id as string | null;
  if (!tenantId) throw new InternalServerErrorException('Budget operations need a tenant context.');
  return tenantId;
}

function budgetColumn(value: unknown, label: string): BudgetColumn {
  if (typeof value !== 'string' || !Object.prototype.hasOwnProperty.call(BUDGET_COLUMN_MEASURE, value)) {
    throw new BadRequestException(`${label} must be one of ${Object.keys(BUDGET_COLUMN_MEASURE).join(', ')}.`);
  }
  return value as BudgetColumn;
}

function budgetYear(value: unknown, label: string): number {
  const year = typeof value === 'string' && /^\d{4}$/.test(value.trim()) ? Number(value) : value;
  if (typeof year !== 'number' || !Number.isInteger(year) || year < 1000 || year > 9999) {
    throw new BadRequestException(`${label} must be a year.`);
  }
  return year;
}

/** The uplift percentage, parsed exactly (a number or a decimal string); blank is 0. */
function upliftPct(value: unknown): Decimal {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) return Decimal.ZERO;
  if (typeof value !== 'number' && typeof value !== 'string') throw new BadRequestException('percentageIncrease must be a number.');
  try {
    return Decimal.from(value);
  } catch {
    throw new BadRequestException('percentageIncrease must be a number.');
  }
}

const sum = (values: readonly bigint[]) => values.reduce((acc, v) => acc + v, 0n);
const toNumber = (cents: bigint) => Number(formatCents(cents));

/**
 * The twelve copied months. Without an uplift they are the source months to
 * the cent. With one, each month is rounded half away from zero to a whole
 * unit of the item's currency, the yearly total is the rounded uplifted
 * source total, and the difference lands on the last month whose source value
 * is not zero. Exact integer arithmetic throughout.
 */
export function copiedMonths(source: readonly bigint[], pct: Decimal): bigint[] {
  if (pct.units === 0n) return [...source];
  const scale = 10n ** BigInt(DECIMAL_SCALE_DIGITS);
  // cents × (100 + pct) / 100, then cents → whole units (÷ 100).
  const factor = 100n * scale + pct.units;
  const wholeUnits = (cents: bigint) => divRoundHalfAway(cents * factor, 100n * scale * 100n) * 100n;
  const months = source.map(wholeUnits);
  const last = source.reduce((found, value, index) => (value !== 0n ? index : found), -1);
  if (last >= 0) months[last] += wholeUnits(sum(source)) - sum(months);
  return months;
}

/** The same calendar dates `delta` years later; 29 February becomes 28 February outside leap years. */
export function shiftPeriod(record: Pick<RoundInput, 'period_start' | 'period_end'>, delta: number) {
  const shift = (date: string) => {
    const year = Number(date.slice(0, 4)) + delta;
    const monthDay = date.slice(5);
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return `${year}-${monthDay === '02-29' && !leap ? '02-28' : monthDay}`;
  };
  return { period_start: shift(record.period_start), period_end: shift(record.period_end) };
}

async function loadItems(manager: EntityManager, scope: AmountScope, tenantId: string): Promise<ItemRow[]> {
  const t = SCOPES[scope];
  return manager.query(
    `SELECT id, tenant_id, ${t.itemName} AS name
     FROM ${t.items}
     WHERE tenant_id = $1 AND (disabled_at IS NULL OR disabled_at > now())
     ORDER BY created_at DESC`,
    [tenantId],
  );
}

/** Versions of the items for the years given, one per item and year (the newest when several exist, as the budget tab shows). */
export async function loadVersions(
  manager: EntityManager,
  scope: AmountScope,
  tenantId: string,
  itemIds: string[],
  years?: number[],
): Promise<Map<string, BudgetVersionRow>> {
  const byItemYear = new Map<string, BudgetVersionRow>();
  if (itemIds.length === 0) return byItemYear;
  const t = SCOPES[scope];
  const rows: BudgetVersionRow[] = await manager.query(
    `SELECT id, tenant_id, ${t.itemFk} AS item_id, budget_year, input_grain
     FROM ${t.versions}
     WHERE tenant_id = $1 AND ${t.itemFk} = ANY($2::uuid[])${years ? ' AND budget_year = ANY($3::int[])' : ''}
     ORDER BY created_at DESC, id DESC`,
    years ? [tenantId, itemIds, years] : [tenantId, itemIds],
  );
  // capex_versions has no unique (item, year) index (spend_versions has one): keep the first, the newest.
  for (const row of rows) {
    const key = `${row.item_id}:${Number(row.budget_year)}`;
    if (!byItemYear.has(key)) byItemYear.set(key, { ...row, budget_year: Number(row.budget_year) });
  }
  return byItemYear;
}

/** Create the version of an item's year, with the item's tenant_id, and audit it. */
export async function createBudgetVersion(
  deps: Pick<BudgetOperationDeps, 'manager' | 'audit'>,
  scope: AmountScope,
  params: { itemId: string; tenantId: string; year: number; name: string; inputGrain: 'annual' | 'quarterly' | 'monthly' },
  userId: string | null,
): Promise<BudgetVersionRow> {
  const common = {
    budget_year: params.year,
    version_name: params.name,
    input_grain: params.inputGrain,
    is_approved: false,
    as_of_date: `${params.year}-01-01`,
    allocation_method: 'default' as const,
    tenant_id: params.tenantId,
  };
  const saved = scope === 'opex'
    ? await deps.manager.getRepository(SpendVersion).save(
      deps.manager.getRepository(SpendVersion).create({ ...common, spend_item_id: params.itemId } as DeepPartial<SpendVersion>),
    )
    : await deps.manager.getRepository(CapexVersion).save(
      deps.manager.getRepository(CapexVersion).create({ ...common, capex_item_id: params.itemId } as DeepPartial<CapexVersion>),
    );
  await deps.audit.log(
    { table: SCOPES[scope].versions, recordId: saved.id, action: 'create', before: null, after: saved, userId },
    { manager: deps.manager },
  );
  return { id: saved.id, tenant_id: params.tenantId, budget_year: params.year, item_id: params.itemId, input_grain: params.inputGrain };
}

export type CopyColumnOperation = {
  sourceYear: number;
  sourceColumn: BudgetColumn;
  destinationYear: number;
  destinationColumn: BudgetColumn;
  percentageIncrease: number | string;
  overwrite: boolean;
  dryRun: boolean;
};

/**
 * Copy one column of a year to a column of a year for every enabled item:
 * the twelve months keep their shape (see `copiedMonths`), the destination
 * column's record takes the source period shifted to the destination year
 * (whole year when the source has none or is Actuals) and says where the
 * column was copied from. Actuals as destination get no record.
 */
export async function copyBudgetColumn(
  deps: BudgetOperationDeps,
  scope: AmountScope,
  operation: CopyColumnOperation,
  userId: string | null,
) {
  const mg = deps.manager;
  const sourceYear = budgetYear(operation?.sourceYear, 'sourceYear');
  const destinationYear = budgetYear(operation?.destinationYear, 'destinationYear');
  const sourceColumn = budgetColumn(operation?.sourceColumn, 'sourceColumn');
  const destinationColumn = budgetColumn(operation?.destinationColumn, 'destinationColumn');
  const pct = upliftPct(operation?.percentageIncrease);
  const overwrite = Boolean(operation?.overwrite);
  const dryRun = Boolean(operation?.dryRun);
  if (sourceYear === destinationYear && sourceColumn === destinationColumn) {
    throw new BadRequestException('A column cannot be copied onto itself: choose another year or column.');
  }
  const sourceMeasure = BUDGET_COLUMN_MEASURE[sourceColumn];
  const destinationMeasure = BUDGET_COLUMN_MEASURE[destinationColumn];

  await deps.freeze.assertNotFrozen(
    { scope, column: MEASURE_FREEZE_COLUMN[destinationMeasure], year: destinationYear, action: 'Copy' },
    { manager: mg },
  );
  // Freeze is checked once for the whole operation, not once per item.
  const checkedFreeze = new Set<string>();

  const tenantId = await currentTenantId(mg);
  const items = await loadItems(mg, scope, tenantId);
  const versions = await loadVersions(mg, scope, tenantId, items.map((i) => i.id), [sourceYear, destinationYear]);
  const allVersions = Array.from(versions.values());
  const months = await readVersionMonths(mg, scope, tenantId, allVersions);
  const records = await listRoundInputs(mg, scope, tenantId, allVersions.map((v) => v.id));
  const pctText = pct.toString();

  const results = [];
  let processed = 0;
  let skipped = 0;

  for (const item of items) {
    const sourceVersion = versions.get(`${item.id}:${sourceYear}`);
    if (!sourceVersion) {
      skipped++;
      continue;
    }
    const source = months.get(sourceVersion.id)!.months[sourceMeasure];
    let destinationVersion = versions.get(`${item.id}:${destinationYear}`);
    const current = destinationVersion ? months.get(destinationVersion.id)!.months[destinationMeasure] : [];
    const sourceTotal = sum(source);
    const currentTotal = sum(current);
    const target = copiedMonths(source, pct);
    const targetTotal = sum(target);
    const skip = source.every((v) => v === 0n) || (!overwrite && current.some((v) => v !== 0n));

    results.push({
      itemId: item.id,
      itemName: item.name,
      sourceValue: toNumber(sourceTotal),
      currentDestinationValue: toNumber(currentTotal),
      newValue: toNumber(skip ? currentTotal : targetTotal),
      skipped: skip,
    });
    if (skip) {
      skipped++;
      continue;
    }
    if (dryRun) {
      processed++;
      continue;
    }

    if (!destinationVersion) {
      destinationVersion = await createBudgetVersion(
        deps,
        scope,
        { itemId: item.id, tenantId: item.tenant_id, year: destinationYear, name: `Budget ${destinationYear}`, inputGrain: sourceVersion.input_grain ?? 'annual' },
        userId,
      );
    }

    // Replace the destination measure only; the other measures keep their months.
    await replaceAmounts(
      { manager: mg, freeze: deps.freeze, scope, version: destinationVersion, checkedFreeze },
      destinationYear,
      yearPeriods(destinationYear).map((period, i) => ({ period, [destinationMeasure]: target[i] })),
    );

    if (isPlanningMeasure(destinationMeasure)) {
      const sourceRecord = isPlanningMeasure(sourceMeasure)
        ? records.get(sourceVersion.id)?.find((r) => r.measure === sourceMeasure)
        : undefined;
      const rctx: RoundInputsContext = { manager: mg, scope, version: destinationVersion, userId, audit: deps.audit };
      await upsertRoundInput(rctx, destinationMeasure, {
        ...(sourceRecord ? shiftPeriod(sourceRecord, destinationYear - sourceYear) : wholeYear(destinationYear)),
        method: 'copied',
        spread_profile_name: sourceRecord?.spread_profile_name ?? null,
        last_calculation: {
          kind: 'copy',
          source_year: sourceYear,
          source_measure: sourceMeasure as 'planned' | 'committed' | 'actual' | 'expected_landing',
          uplift_pct: pctText,
          source_total: centsToDecimal(sourceTotal),
          total: centsToDecimal(targetTotal),
          source_method: sourceRecord?.method ?? null,
        },
      });
    }

    await deps.audit.log(
      {
        table: SCOPES[scope].items,
        recordId: item.id,
        action: 'update',
        before: { [destinationColumn]: toNumber(currentTotal) },
        after: {
          [destinationColumn]: toNumber(targetTotal),
          operation: 'budget_column_copy',
          sourceYear,
          sourceColumn,
          destinationYear,
          destinationColumn,
          percentageIncrease: pctText,
        },
        userId,
      },
      { manager: mg },
    );
    processed++;
  }

  return {
    success: true,
    dryRun,
    summary: { totalItems: items.length, processed, skipped, errors: 0 },
    results: dryRun ? results : [],
  };
}

/**
 * Clear one column of a year for every enabled item: its twelve months become
 * zero and its record (period, provenance) is deleted. A version whose column
 * is already all zero is skipped, but its record is deleted too.
 */
export async function clearBudgetColumn(
  deps: BudgetOperationDeps,
  scope: AmountScope,
  operation: { year: number; column: BudgetColumn },
  userId: string | null,
) {
  const mg = deps.manager;
  const year = budgetYear(operation?.year, 'year');
  const column = budgetColumn(operation?.column, 'column');
  const measure: AmountMeasure = BUDGET_COLUMN_MEASURE[column];

  await deps.freeze.assertNotFrozen(
    { scope, column: MEASURE_FREEZE_COLUMN[measure], year, action: 'Clear' },
    { manager: mg },
  );
  // Freeze is checked once for the whole operation, not once per item.
  const checkedFreeze = new Set<string>();

  const tenantId = await currentTenantId(mg);
  const items = await loadItems(mg, scope, tenantId);
  const versions = await loadVersions(mg, scope, tenantId, items.map((i) => i.id), [year]);
  const allVersions = Array.from(versions.values());
  const months = await readVersionMonths(mg, scope, tenantId, allVersions);
  const records = isPlanningMeasure(measure)
    ? await listRoundInputs(mg, scope, tenantId, allVersions.map((v) => v.id))
    : new Map<string, RoundInput[]>();

  let cleared = 0;
  let skipped = 0;

  for (const item of items) {
    const version = versions.get(`${item.id}:${year}`);
    if (!version) {
      skipped++;
      continue;
    }
    const rctx: RoundInputsContext = { manager: mg, scope, version, userId, audit: deps.audit };
    const hasRecord = records.get(version.id)?.some((r) => r.measure === measure) ?? false;
    const current = months.get(version.id)!.months[measure];
    if (!current.some((v) => v !== 0n)) {
      if (hasRecord) await deleteRoundInput(rctx, measure);
      skipped++;
      continue;
    }

    // Zero, not NULL: the twelve months of this measure only.
    await replaceAmounts(
      { manager: mg, freeze: deps.freeze, scope, version, checkedFreeze },
      year,
      yearPeriods(year).map((period) => ({ period, [measure]: 0n })),
    );
    if (hasRecord) await deleteRoundInput(rctx, measure);

    await deps.audit.log(
      {
        table: SCOPES[scope].items,
        recordId: item.id,
        action: 'update',
        before: { [column]: toNumber(sum(current)) },
        after: { [column]: 0, operation: 'budget_column_clear', year, column },
        userId,
      },
      { manager: mg },
    );
    cleared++;
  }

  return {
    success: true,
    summary: { totalItems: items.length, cleared, skipped, errors: 0 },
  };
}
