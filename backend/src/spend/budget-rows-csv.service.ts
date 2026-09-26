import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { format } from '@fast-csv/format';
import { parseString } from '@fast-csv/parse';
import * as fs from 'fs';
import { EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { FreezeService } from '../freeze/freeze.service';
import { formatCents } from '../common/amount';
import { decodeCsvBufferUtf8OrThrow } from '../common/encoding';
import { denormalizeCsvRow, neutralizeCsvRow } from '../common/csv/csv-export.service';
import {
  AMOUNT_MEASURES,
  AmountMeasure,
  AmountRowInput,
  AmountScope,
  BUDGET_COLUMN_MEASURE,
  isAmountMeasure,
  lockYearMonths,
  MEASURE_FREEZE_COLUMN,
  readVersionMonths,
  replaceAmounts,
  validateAmountValue,
  yearPeriods,
} from './amounts-write.util';
import { activeMonths, NO_ACTIVE_MONTH_MESSAGE, SpreadInputError } from './spread.util';
import { isPlanningMeasure, listRoundInputs, PLANNING_MEASURES, RoundInput, saveRoundInput, wholeYear } from './round-inputs.util';
import { BudgetVersionRow, createBudgetVersion, loadVersions } from './budget-column-operations';

/**
 * Budget rows file: the monthly amounts of every OPEX and CAPEX line, one row
 * per line, year and measure, with the period of each planning column.
 *
 * Import guarantees amounts and periods, not history: a row identical to what
 * is stored is left alone (no write, no freeze check, provenance kept); a row
 * whose months change marks the column as edited by hand; a row whose only
 * change is the period updates the period and keeps how the column was
 * produced. The whole file is checked before anything is written.
 */

const MONTH_COLUMNS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const;
export const BUDGET_ROWS_HEADERS = [
  'item_type', 'item_number', 'year', 'measure', 'period_start', 'period_end', ...MONTH_COLUMNS, 'method',
] as const;
const REQUIRED_HEADERS: readonly string[] = BUDGET_ROWS_HEADERS.filter((h) => h !== 'method');

const SCOPES: readonly AmountScope[] = ['opex', 'capex'];
// Table names come only from here: never from the file.
const ITEM_TABLE: Record<AmountScope, string> = { opex: 'spend_items', capex: 'capex_items' };
const AMOUNT_AUDIT_TABLE: Record<AmountScope, string> = { opex: 'spend_amounts', capex: 'capex_amounts' };
const REF_PREFIX: Record<AmountScope, string> = { opex: 'OPX', capex: 'CPX' };
const SCOPE_LABEL: Record<AmountScope, string> = { opex: 'OPEX', capex: 'CAPEX' };

const MEASURE_ALIASES: Record<string, AmountMeasure> = {
  budget: BUDGET_COLUMN_MEASURE.budget,
  revision: BUDGET_COLUMN_MEASURE.revision,
  follow_up: BUDGET_COLUMN_MEASURE.follow_up,
  landing: BUDGET_COLUMN_MEASURE.landing,
};
const EXPORT_MEASURE_ORDER: readonly AmountMeasure[] = ['planned', 'committed', 'forecast', 'actual', 'expected_landing'];

const PLANNING_ORDER = (measure: AmountMeasure) => {
  const index = (PLANNING_MEASURES as readonly string[]).indexOf(measure);
  return index < 0 ? PLANNING_MEASURES.length : index;
};

const LEVEL_RANK: Record<string, number> = { reader: 1, contributor: 2, member: 3, admin: 4 };

/** What the user may do, from the permission guard (administrators pass everything). */
export type BudgetRowsAccess = { isAdmin?: boolean; permissions?: Record<string, string> };

function hasLevel(access: BudgetRowsAccess, scope: AmountScope, level: 'reader' | 'admin'): boolean {
  return access.isAdmin === true || (LEVEL_RANK[access.permissions?.[scope] ?? ''] ?? 0) >= LEVEL_RANK[level];
}

type ErrorEntry = { row: number; message: string };

type ParsedRow = {
  line: number;
  scope: AmountScope;
  itemNumber: number;
  year: number;
  measure: AmountMeasure;
  /** Null on Actuals: their period is ignored. */
  period: { period_start: string; period_end: string } | null;
  months: bigint[];
};

type PlannedRow = ParsedRow & {
  item: { id: string; tenant_id: string };
  version: BudgetVersionRow | null;
  monthsChanged: boolean;
};

const ref = (scope: AmountScope, itemNumber: number) => `${REF_PREFIX[scope]}-${itemNumber}`;
const adminNeeded = (scope: AmountScope) => `${SCOPE_LABEL[scope]} rows need ${SCOPE_LABEL[scope]} administration rights.`;

// item_number is a Postgres integer; the copy operations use the same year bounds.
const MAX_ITEM_NUMBER = 2_147_483_647;
const YEAR_RULE = 'must have four digits, from 1000 to 9999';

function parseYear(raw: string): number | null {
  const year = /^\d{4}$/.test(raw) ? Number(raw) : null;
  return year !== null && year >= 1000 ? year : null;
}

@Injectable()
export class BudgetRowsCsvService {
  constructor(
    private readonly audit: AuditService,
    private readonly freeze: FreezeService,
  ) {}

  async exportCsv(
    params: { scope?: 'template' | 'data'; year?: string; access: BudgetRowsAccess },
    ctx: { manager: EntityManager; tenantId: string },
  ): Promise<{ filename: string; content: string }> {
    const header = '\ufeff' + BUDGET_ROWS_HEADERS.join(';') + '\n';
    if (params.scope === 'template') return { filename: 'budget_rows_template.csv', content: header };

    const rawYear = String(params.year ?? '').trim();
    const year = rawYear === '' ? null : parseYear(rawYear);
    if (rawYear !== '' && year === null) throw new BadRequestException(`year ${YEAR_RULE}.`);
    const scopes = SCOPES.filter((scope) => hasLevel(params.access, scope, 'reader'));
    const filename = year !== null
      ? `budget_rows_${year}_partial.csv`
      : scopes.length < SCOPES.length ? 'budget_rows_partial.csv' : 'budget_rows.csv';

    const lines: Array<Record<string, string>> = [];
    for (const scope of scopes) {
      const items: Array<{ id: string; item_number: number }> = await ctx.manager.query(
        `SELECT id, item_number FROM ${ITEM_TABLE[scope]} WHERE tenant_id = $1 ORDER BY item_number`,
        [ctx.tenantId],
      );
      const numberOf = new Map(items.map((i) => [i.id, Number(i.item_number)]));
      const versions = Array.from(
        (await loadVersions(ctx.manager, scope, ctx.tenantId, items.map((i) => i.id), year !== null ? [year] : undefined)).values(),
      );
      const months = await readVersionMonths(ctx.manager, scope, ctx.tenantId, versions);
      const stored = versions
        .filter((v) => months.get(v.id)?.stored)
        .sort((a, b) => (numberOf.get(a.item_id)! - numberOf.get(b.item_id)!) || (Number(a.budget_year) - Number(b.budget_year)));
      const records = await listRoundInputs(ctx.manager, scope, ctx.tenantId, stored.map((v) => v.id));
      for (const version of stored) {
        const versionYear = Number(version.budget_year);
        for (const measure of EXPORT_MEASURE_ORDER) {
          const record = records.get(version.id)?.find((r) => r.measure === measure);
          const period = measure === 'actual' ? null : record ?? wholeYear(versionYear);
          const values = months.get(version.id)!.months[measure];
          lines.push({
            item_type: scope,
            item_number: String(numberOf.get(version.item_id)),
            year: String(versionYear),
            measure,
            period_start: period?.period_start ?? '',
            period_end: period?.period_end ?? '',
            ...Object.fromEntries(MONTH_COLUMNS.map((column, i) => [column, formatCents(values[i])])),
            method: measure === 'actual' ? '' : record?.method ?? '',
          });
        }
      }
    }

    const chunks: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const stream = format({ headers: [...BUDGET_ROWS_HEADERS], delimiter: ';', transform: neutralizeCsvRow });
      stream.on('data', (chunk) => chunks.push(chunk.toString('utf8')));
      stream.on('end', () => resolve());
      stream.on('error', (err) => reject(err));
      for (const line of lines) stream.write(line);
      stream.end();
    });
    const body = chunks.join('');
    return { filename, content: lines.length ? '\ufeff' + body + '\n' : header };
  }

  async importCsv(
    params: { file: Express.Multer.File; dryRun: boolean; userId: string | null; access: BudgetRowsAccess },
    ctx: { manager: EntityManager; tenantId: string },
  ) {
    const { dryRun } = params;
    const fail = (errors: ErrorEntry[], total: number) => ({
      ok: false, dryRun, total, inserted: 0, updated: 0, unchanged: 0, errors: errors.sort((a, b) => a.row - b.row),
    });

    const { headers, rows } = await this.readFile(params.file);
    const missing = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
    const extras = headers.filter((h) => !(BUDGET_ROWS_HEADERS as readonly string[]).includes(h));
    if (missing.length || extras.length) {
      return fail([{ row: 1, message: `Header mismatch. Missing: ${missing.join(', ') || '-'}, Extra: ${extras.join(', ') || '-'}` }], 0);
    }

    // 1. Each row on its own.
    const errors: ErrorEntry[] = [];
    const parsed: ParsedRow[] = [];
    rows.forEach((raw, index) => {
      const row = this.parseRow(raw, index + 2, errors);
      if (row) parsed.push(row);
    });

    // 2. Duplicates, item types the user cannot read, unknown items.
    const firstLine = new Map<string, number>();
    const unique: ParsedRow[] = [];
    for (const row of parsed) {
      const key = `${row.scope}:${row.itemNumber}:${row.year}:${row.measure}`;
      const first = firstLine.get(key);
      if (first !== undefined) {
        errors.push({ row: row.line, message: `Duplicate row: ${ref(row.scope, row.itemNumber)}, ${row.year}, ${row.measure} already appears on line ${first}.` });
        continue;
      }
      firstLine.set(key, row.line);
      // Not even compared: an "unchanged" answer would disclose amounts the user cannot read.
      if (!hasLevel(params.access, row.scope, 'reader')) {
        errors.push({ row: row.line, message: adminNeeded(row.scope) });
        continue;
      }
      unique.push(row);
    }

    const planned: PlannedRow[] = [];
    let unchanged = 0;
    for (const scope of SCOPES) {
      const scopeRows = unique.filter((r) => r.scope === scope);
      if (scopeRows.length === 0) continue;
      const numbers = Array.from(new Set(scopeRows.map((r) => r.itemNumber)));
      const items: Array<{ id: string; tenant_id: string; item_number: number }> = await ctx.manager.query(
        `SELECT id, tenant_id, item_number FROM ${ITEM_TABLE[scope]} WHERE tenant_id = $1 AND item_number = ANY($2::int[])`,
        [ctx.tenantId, numbers],
      );
      const itemByNumber = new Map(items.map((i) => [Number(i.item_number), i]));
      const years = Array.from(new Set(scopeRows.map((r) => r.year)));
      const versions = await loadVersions(ctx.manager, scope, ctx.tenantId, items.map((i) => i.id), years);
      const versionList = Array.from(versions.values());
      const months = await readVersionMonths(ctx.manager, scope, ctx.tenantId, versionList);
      const records = await listRoundInputs(ctx.manager, scope, ctx.tenantId, versionList.map((v) => v.id));

      // 3. Compare with what is stored.
      for (const row of scopeRows) {
        const item = itemByNumber.get(row.itemNumber);
        if (!item) {
          errors.push({ row: row.line, message: `${ref(scope, row.itemNumber)} does not exist.` });
          continue;
        }
        const version = versions.get(`${item.id}:${row.year}`) ?? null;
        const stored = version ? months.get(version.id)!.months[row.measure] : null;
        const monthsChanged = stored ? row.months.some((v, i) => v !== stored[i]) : row.months.some((v) => v !== 0n);
        const record = version ? records.get(version.id)?.find((r) => r.measure === row.measure) : undefined;
        const storedPeriod = record ?? wholeYear(row.year);
        const periodChanged = row.period !== null
          && (row.period.period_start !== storedPeriod.period_start || row.period.period_end !== storedPeriod.period_end);
        if (!monthsChanged && (!version || !periodChanged)) {
          unchanged++;
          continue;
        }
        planned.push({ ...row, item, version, monthsChanged });
      }
    }

    // 4. Rows that would write: administration of their item type, then the
    //    freeze, once per scope, column and year. An identical row of a type
    //    the user can only read was counted unchanged above: it writes nothing.
    const frozen = new Map<string, string | null>();
    for (const row of planned) {
      if (!hasLevel(params.access, row.scope, 'admin')) {
        errors.push({ row: row.line, message: adminNeeded(row.scope) });
        continue;
      }
      const column = MEASURE_FREEZE_COLUMN[row.measure];
      const key = `${row.scope}:${column}:${row.year}`;
      if (!frozen.has(key)) {
        try {
          await this.freeze.assertNotFrozen({ scope: row.scope, column, year: row.year, action: 'Import' }, { manager: ctx.manager });
          frozen.set(key, null);
        } catch (err) {
          if (!(err instanceof ForbiddenException)) throw err;
          frozen.set(key, err.message);
        }
      }
      const message = frozen.get(key);
      if (message) errors.push({ row: row.line, message });
    }

    if (errors.length > 0) return fail(errors, rows.length);
    const inserted = planned.filter((r) => !r.version).length;
    const updated = planned.length - inserted;
    if (dryRun) return { ok: true, dryRun: true, total: rows.length, inserted, updated, unchanged, errors: [] };

    await this.write(planned, params.userId, ctx.manager);
    return { ok: true, dryRun: false, total: rows.length, inserted, updated, unchanged, errors: [] };
  }

  /** 5. Write the changed rows, grouped by item and year (one amounts write per version). */
  private async write(planned: PlannedRow[], userId: string | null, manager: EntityManager) {
    const groups = new Map<string, PlannedRow[]>();
    for (const row of planned) {
      const key = `${row.scope}:${row.item.id}:${row.year}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    const checkedFreeze = new Set<string>();
    for (const group of groups.values()) {
      const { scope, item, year } = group[0];
      const version = group[0].version ?? await createBudgetVersion(
        { manager, audit: this.audit },
        scope,
        { itemId: item.id, tenantId: item.tenant_id, year, name: `Auto ${year}`, inputGrain: 'monthly' },
        userId,
      );
      const changed = group.filter((r) => r.monthsChanged);
      if (changed.length > 0) {
        const rows: AmountRowInput[] = yearPeriods(year).map((period, i) => {
          const row: AmountRowInput = { period };
          for (const r of changed) row[r.measure] = r.months[i];
          return row;
        });
        const { before, after } = await replaceAmounts({ manager, freeze: this.freeze, scope, version, checkedFreeze }, year, rows);
        await this.audit.log({ table: AMOUNT_AUDIT_TABLE[scope], recordId: null, action: 'update', before, after, userId }, { manager });
      }
      // Months before records, records in column order: the lock order of every amounts writer.
      if (changed.length === 0) await lockYearMonths({ manager, scope, version }, year);
      const byColumn = [...group].sort((a, b) => PLANNING_ORDER(a.measure) - PLANNING_ORDER(b.measure));
      for (const row of byColumn) {
        if (!isPlanningMeasure(row.measure) || !row.period) continue;
        const period = row.period;
        await saveRoundInput({ manager, scope, version, userId, audit: this.audit }, row.measure, (stored: RoundInput | null) => ({
          ...period,
          method: row.monthsChanged ? 'manual' : stored?.method ?? 'manual',
          spread_profile_name: stored?.spread_profile_name ?? null,
          last_calculation: stored?.last_calculation ?? null,
        }));
      }
    }
  }

  private parseRow(raw: Record<string, string>, line: number, errors: ErrorEntry[]): ParsedRow | null {
    const cell = (column: string) => String(raw[column] ?? '').trim();
    const before = errors.length;
    const error = (message: string) => errors.push({ row: line, message });

    const type = cell('item_type').toLowerCase();
    const scope = (SCOPES as readonly string[]).includes(type) ? (type as AmountScope) : null;
    if (!scope) error(`item_type '${cell('item_type')}' is unknown. Use opex or capex.`);

    // The integer, or the business reference of the same item type (OPX-7 on an opex row).
    const numberText = cell('item_number');
    const refMatch = /^(OPX|CPX)-(\d+)$/i.exec(numberText);
    const digits = /^\d+$/.test(numberText)
      ? numberText
      : refMatch && scope && refMatch[1].toUpperCase() === REF_PREFIX[scope] ? refMatch[2] : null;
    let itemNumber: number | null = null;
    if (digits !== null && Number(digits) > MAX_ITEM_NUMBER) {
      error(`item_number '${numberText}' is too large for a line number.`);
    } else if (digits !== null) {
      itemNumber = Number(digits);
    } else if (scope) {
      error(refMatch
        ? `item_number '${numberText}' does not match item_type ${scope}.`
        : `item_number '${numberText}' must be a number or a reference such as ${REF_PREFIX[scope]}-7.`);
    }

    const year = parseYear(cell('year'));
    if (year === null) error(`year '${cell('year')}' ${YEAR_RULE}.`);

    const measureText = cell('measure').toLowerCase();
    const measure: AmountMeasure | null = isAmountMeasure(measureText)
      ? measureText
      : Object.prototype.hasOwnProperty.call(MEASURE_ALIASES, measureText) ? MEASURE_ALIASES[measureText] : null;
    if (!measure) {
      error(`measure '${cell('measure')}' is unknown. Use ${AMOUNT_MEASURES.join(', ')} (or budget, revision, follow_up, landing).`);
    }

    let period: ParsedRow['period'] = null;
    if (measure && measure !== 'actual' && year !== null) {
      const start = cell('period_start');
      const end = cell('period_end');
      if (!start && !end) {
        period = wholeYear(year);
      } else if (!start || !end) {
        error('Give both period_start and period_end, or neither for the whole year.');
      } else {
        try {
          if (activeMonths(year, start, end).length === 0) error(NO_ACTIVE_MONTH_MESSAGE);
          else period = { period_start: start, period_end: end };
        } catch (err) {
          if (!(err instanceof SpreadInputError)) throw err;
          error(err.message);
        }
      }
    }

    const months: bigint[] = [];
    for (const column of MONTH_COLUMNS) {
      const value = cell(column);
      if (value === '') {
        error(`${column} is required; use 0 for an empty month.`);
        continue;
      }
      try {
        months.push(validateAmountValue(value, column));
      } catch (err) {
        if (!(err instanceof BadRequestException)) throw err;
        error(err.message);
      }
    }

    if (errors.length > before || !scope || itemNumber === null || year === null || !measure) return null;
    return { line, scope, itemNumber, year, measure, period, months };
  }

  private async readFile(file: Express.Multer.File | undefined): Promise<{ headers: string[]; rows: Array<Record<string, string>> }> {
    if (!file) throw new BadRequestException('No file uploaded.');
    const buffer = file.buffer ?? ((file as any).path ? fs.readFileSync((file as any).path) : undefined);
    if (!buffer) throw new BadRequestException('The uploaded file is empty.');
    let content: string;
    try {
      content = decodeCsvBufferUtf8OrThrow(buffer as Buffer);
    } catch {
      throw new BadRequestException('Invalid file encoding. Please export or save the CSV as UTF-8 (CSV UTF-8) and use semicolons as separators.');
    }
    const rows: Array<Record<string, string>> = [];
    let headers: string[] = [];
    await new Promise<void>((resolve, reject) => {
      parseString(content, { headers: true, delimiter: ';', ignoreEmpty: true, trim: true })
        .on('headers', (h: string[]) => { headers = h.map((name) => String(name ?? '').trim()); })
        .on('error', (err) => reject(new BadRequestException(`The file could not be read: ${err.message}`)))
        .on('data', (row: Record<string, string>) => rows.push(denormalizeCsvRow(row)))
        .on('end', () => resolve());
    });
    return { headers, rows };
  }
}
