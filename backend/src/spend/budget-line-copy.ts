import { BadRequestException } from '@nestjs/common';
import { budgetColumnName, readBudgetColumns } from '../budget-columns/budget-columns.util';
import {
  AMOUNT_MEASURES,
  AmountMeasure,
  AmountsWriteContext,
  AmountsWriteResult,
  BUDGET_COLUMN_MEASURE,
  BudgetColumn,
  assertMeasuresEditable,
  assertYearMatchesVersion,
  isAmountMeasure,
  readVersionMonths,
  replaceAmounts,
  yearPeriods,
} from './amounts-write.util';
import {
  CalendarIssue,
  columnCopyAuditValues,
  copiedColumnRecord,
  loadCopyCalendars,
  loadItemsValidIn,
  planColumnCopy,
  upliftPct,
} from './budget-column-operations';
import { assertColumnBase } from './budget-edit-conflicts';
import { auditTableOf } from './budget-nature';
import { CostLine, missingCalendarYearMessage } from './costing.util';
import { RoundInputFields, RoundInputsContext, upsertRoundInput, versionRoundInputs } from './round-inputs.util';

/**
 * "Start from another column" of the budget tab (plan budget-tab-redesign,
 * lot B3): `bulk-upsert` with `kind: 'copy'` copies one column of the
 * version's year onto another column of the same line and year, with a
 * percentage. The result is the column copy of Budget operations
 * (`copyBudgetColumn`) restricted to this line and year, the destination
 * overwritten: the months keep their shape (`copiedMonths`, whole units with
 * a percentage), a source that follows its lines is copied by its lines with
 * their prices raised (`planLinesCopy`, `upliftedPrice`), lines that are only
 * a reference travel with the copy, and the record says where the column
 * came from (`copied`, a `copy` calculation; `computed` for a copy by lines,
 * whose origin the line's audit row keeps, as the operation does).
 *
 * It needs the ordinary right to write the budget (`budget:member`), unlike
 * the operation (`budget:admin`), and goes through the budget tab's contract:
 * the destination's freeze, its `base`, required with its months and its
 * lines (409 `edit_conflict`), the answer of every `bulk-upsert`. Refused: a frozen destination, a source that is the
 * destination, a source with nothing to copy within the line's dates, a
 * percentage at or below −100, a line with no month in the year, and a line
 * whose calendar has no working days for the year (the operation asks to
 * confirm a replacement calendar after its preview; here the write is refused
 * with the sentence a lines write gives). A disabled calendar is used, as the
 * operation does, and named in the answer.
 */

export type CopyAmountsPayload = {
  kind: 'copy';
  year: number;
  /** The column copied, by its storage name. */
  source: AmountMeasure;
  /** The column written, by its storage name. */
  measure: AmountMeasure;
  /** Percent, above −100; absent or blank is 0. */
  percentage?: number | string | null;
  /** The destination as the screen last knew it: `base.columns.<measure>` with its twelve months and its lines (`[]` without any). */
  base: unknown;
};

export function isCopyPayload(payload: unknown): payload is CopyAmountsPayload {
  return typeof payload === 'object' && payload !== null && (payload as { kind?: unknown }).kind === 'copy';
}

/** What a copy still records once its months are written: the destination's record and lines, and the line's audit row. */
export type ColumnCopyDone = {
  measure: AmountMeasure;
  itemId: string;
  fields: RoundInputFields;
  lines: CostLine[];
  audit: ReturnType<typeof columnCopyAuditValues>;
  /** For the answer: source months outside the line's dates were left out. */
  prorated: boolean;
  /** For the answer: the destination follows the copied lines. */
  fromLines: boolean;
  /** For the answer: disabled calendars the copied lines still use. */
  calendarIssues: CalendarIssue[];
};

export type CopyPayloadResult = AmountsWriteResult & { spread: null; copy: ColumnCopyDone };

export function isCopyResult(result: object): result is CopyPayloadResult {
  return 'copy' in result;
}

/** The API name of each column, as the column operations and their audit rows name it. */
const MEASURE_COLUMN = Object.fromEntries(
  (Object.entries(BUDGET_COLUMN_MEASURE) as Array<[BudgetColumn, AmountMeasure]>).map(([column, measure]) => [measure, column]),
) as Record<AmountMeasure, BudgetColumn>;

function measureOf(value: unknown, field: string): AmountMeasure {
  if (!isAmountMeasure(value)) {
    throw new BadRequestException(`${field} must be one of ${AMOUNT_MEASURES.join(', ')}.`);
  }
  return value;
}

/**
 * Validates and plans the copy, checks the freeze and the base, then writes
 * the destination's twelve months. The line and the version are locked by
 * the caller (`bulk-upsert`). `recordColumnCopy` then stores the record.
 */
export async function writeCopyPayload(ctx: AmountsWriteContext, itemId: string, rawPayload: unknown): Promise<CopyPayloadResult> {
  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    throw new BadRequestException('The amounts must be an object.');
  }
  const payload = rawPayload as Record<string, unknown>;
  const year = assertYearMatchesVersion(payload.year, ctx.version);
  const source = measureOf(payload.source, 'source');
  const measure = measureOf(payload.measure, 'measure');
  if (source === measure) throw new BadRequestException('A column cannot be copied onto itself: choose another column.');
  const pct = upliftPct(payload.percentage, 'percentage');
  // The copy replaces the destination, lines included: it says what the screen showed of it.
  assertColumnBase(payload.base, measure, 'copy');
  // A frozen destination refuses the copy before anything is read, locked or written.
  await assertMeasuresEditable(ctx, year, [measure]);

  const { manager, scope } = ctx;
  const tenantId = ctx.version.tenant_id;
  const [item] = await loadItemsValidIn(manager, scope, tenantId, year, [itemId]);
  if (!item) throw new BadRequestException(`The line has no month in ${year}: its dates leave nothing to copy to.`);
  const stored = (await readVersionMonths(manager, scope, tenantId, [ctx.version])).get(ctx.version.id)!.months;
  const sourceRecord = (await versionRoundInputs(manager, scope, ctx.version)).find((record) => record.measure === source);
  // The calendars of the source's lines, held FOR KEY SHARE after the version's lock and before the months (`budget-locks.ts`).
  const calendarIds = (sourceRecord?.lines ?? []).flatMap((line) => (line.working_day_profile_id ? [line.working_day_profile_id] : []));
  const calendars = sourceRecord && sourceRecord.lines.length > 0
    ? await loadCopyCalendars(manager, scope, tenantId, [itemId], calendarIds, true)
    : { calendars: new Map(), countryOf: new Map() };
  const plan = planColumnCopy(item, stored[source], sourceRecord, year, pct, calendars);

  if (plan.empty) {
    const name = budgetColumnName(await readBudgetColumns(manager, tenantId), source);
    const nothing = stored[source].every((cents) => cents === 0n) && !sourceRecord?.lines.length;
    throw new BadRequestException(nothing
      ? `Nothing to copy: ${name} ${year} is empty.`
      : `Nothing to copy: ${name} ${year} has no amount within the line's dates.`);
  }
  // Same year: a calendar without days for it cannot be replaced silently, as a lines write refuses it.
  const changed = plan.issues.find((issue) => issue.kind !== 'disabled');
  if (changed) throw new BadRequestException(`Line ${changed.lineNumber}: ${missingCalendarYearMessage(changed.calendar, year)}`);

  const upliftText = pct.toString();
  const record = copiedColumnRecord(plan, sourceRecord, { sourceYear: year, sourceMeasure: source, destinationYear: year, upliftPct: upliftText, validity: item.validity });
  await ctx.beforeWrite?.({ kind: 'columns', columns: [{ measure, months: plan.target, lines: record.lines }] });
  const written = await replaceAmounts(ctx, year, yearPeriods(year).map((period, i) => ({ period, [measure]: plan.target[i] })));
  const currentTotal = stored[measure].reduce((sum, cents) => sum + cents, 0n);
  return {
    ...written,
    spread: null,
    copy: {
      measure,
      itemId,
      fields: record.fields,
      lines: record.lines,
      audit: columnCopyAuditValues(plan, {
        sourceYear: year,
        sourceColumn: MEASURE_COLUMN[source],
        destinationYear: year,
        destinationColumn: MEASURE_COLUMN[measure],
        upliftPct: upliftText,
        currentTotal,
      }),
      prorated: plan.prorated,
      fromLines: !!plan.lines,
      calendarIssues: plan.issues,
    },
  };
}

/**
 * The destination's record and lines (written even when the months were
 * already those: the column now says it was copied), then the line's audit
 * row of a column copy, as the operation writes it.
 */
export async function recordColumnCopy(ctx: RoundInputsContext, copy: ColumnCopyDone): Promise<void> {
  await upsertRoundInput(ctx, copy.measure, copy.fields, copy.lines);
  await ctx.audit.log(
    { table: auditTableOf(ctx.scope, 'spend_items'), recordId: copy.itemId, action: 'update', ...copy.audit, userId: ctx.userId },
    { manager: ctx.manager },
  );
}
