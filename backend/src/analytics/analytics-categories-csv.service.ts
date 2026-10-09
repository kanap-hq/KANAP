import { BadRequestException, Injectable } from '@nestjs/common';
import * as fs from 'fs';
import { resolveLifecycleState, StatusState } from '../common/status';
import {
  cellOf,
  CsvDateOrder,
  CsvLanguage,
  DecimalMark,
  endOfValidityCell,
  endOfValidityOf,
  MasterDataFileRead,
  readMasterDataFile,
  rowProblems,
  writeCsv,
} from '../common/csv-sheet';
import { csvItemLifecycle, csvLifecycleConflict } from '../spend/item-write.util';
import { AnalyticsContext, normalizeAnalyticsDescription, normalizeAnalyticsName } from './analytics-context';
import { analyticsAxisSubject, isAxisActive, loadAnalyticsAxes, resolveDefaultAxisId } from './analytics-axes.util';
import {
  AnalyticsCategoriesService,
  AnalyticsCategoryValues,
  categoryValuesEqual,
  StoredAnalyticsCategory,
  valueAppliesToConflict,
} from './analytics-categories.service';
import { AXIS_APPLIES_TO, AxisAppliesTo } from './analytics-axis.entity';

export const ANALYTICS_VALUE_CSV_HEADERS = ['axis_code', 'name', 'description', 'status', 'disabled_at', 'applies_to'] as const;
/** Only the name is required; an absent column keeps what is stored (a new value gets the default). */
const OPTIONAL_HEADERS = ['axis_code', 'description', 'status', 'disabled_at', 'applies_to'] as const;

/** An `applies_to` cell: '' is null (OPEX and CAPEX lines), undefined an invalid value. */
function csvAppliesTo(raw: string): AxisAppliesTo | null | undefined {
  const text = raw.trim().toLowerCase();
  if (text === '') return null;
  return (AXIS_APPLIES_TO as readonly string[]).includes(text) ? (text as AxisAppliesTo) : undefined;
}

export interface AnalyticsValueImportResult {
  ok: boolean;
  dryRun: boolean;
  total: number;
  inserted: number;
  updated: number;
  unchanged: number;
  errors: Array<{ row: number; message: string }>;
  /** The unknown headers the file carried, and what the shared layer noticed. */
  ignoredColumns: string[];
  notices: { dates: string | null; amounts: string | null };
}

interface ParsedRow {
  line: number;
  existing: StoredAnalyticsCategory | null;
  axisName: string | null;
  values: AnalyticsCategoryValues;
}

/**
 * The values (analytics categories) of every dimension in one file:
 * `axis_code;name;description;status;disabled_at`. A blank `axis_code` is the
 * default dimension. Rows match on (dimension, name) case-insensitively.
 * Dimensions themselves are created on the page (no dimensions file).
 */
@Injectable()
export class AnalyticsCategoriesCsvService {
  constructor(private readonly categories: AnalyticsCategoriesService) {}

  async exportCsv(
    scope: 'data' | 'template',
    ctx: AnalyticsContext,
    language: CsvLanguage = 'en',
  ): Promise<{ filename: string; content: string }> {
    const headers = [...ANALYTICS_VALUE_CSV_HEADERS];
    const rows: string[][] = [];
    if (scope === 'data') {
      const axes = await loadAnalyticsAxes(ctx.manager, ctx.tenantId);
      const order = new Map(axes.map((axis, index) => [axis.id, index]));
      const codeById = new Map(axes.map((axis) => [axis.id, axis.code]));
      const values: StoredAnalyticsCategory[] = await ctx.manager.query(
        `SELECT * FROM analytics_categories WHERE tenant_id = $1 ORDER BY lower(name) ASC, id ASC`,
        [ctx.tenantId],
      );
      values.sort((a, b) => (order.get(a.axis_id) ?? 0) - (order.get(b.axis_id) ?? 0));
      for (const value of values) {
        rows.push([
          codeById.get(value.axis_id) ?? '',
          value.name,
          value.description ?? '',
          isAxisActive(value) ? StatusState.ENABLED : StatusState.DISABLED,
          endOfValidityCell(value.disabled_at, language),
          value.applies_to ?? '',
        ]);
      }
    }
    return {
      filename: scope === 'template' ? 'analytics_values_template.csv' : 'analytics_values.csv',
      content: writeCsv({ language, headers, rows }),
    };
  }

  /**
   * Upsert by (dimension, name). The whole file is checked before any write;
   * nothing is written unless it is clean, and a row identical to the stored
   * value is counted unchanged and writes nothing (no audit row).
   */
  async importCsv(
    {
      file,
      dryRun,
      language,
      dateOrder,
      decimalMark,
    }: {
      file: Express.Multer.File;
      dryRun: boolean;
      language?: CsvLanguage;
      dateOrder?: CsvDateOrder;
      decimalMark?: DecimalMark;
    },
    ctx: AnalyticsContext,
  ): Promise<AnalyticsValueImportResult> {
    const read = await this.parseFile(file, language ?? 'en', dateOrder, decimalMark);
    const failed = (errors: AnalyticsValueImportResult['errors'], total = 0): AnalyticsValueImportResult => ({
      ok: false, dryRun, total, inserted: 0, updated: 0, unchanged: 0, errors,
      ignoredColumns: read.ignoredColumns, notices: read.notices,
    });
    if (read.headerError) return failed([{ row: 0, message: read.headerError }]);
    const { rows } = read;
    // An absent column is not a blank cell: it keeps what is stored, as it always has.
    const has = (header: string) => read.present.includes(header);

    // Blank dimension codes need the default; a file with none leaves a tenant without dimensions untouched.
    const needsDefault = !has('axis_code') || rows.some((row) => cellOf(row, 'axis_code') === '');
    const defaultAxisId = needsDefault && rows.length > 0
      ? await resolveDefaultAxisId(ctx.manager, ctx.tenantId, { create: !dryRun })
      : null;
    const axes = await loadAnalyticsAxes(ctx.manager, ctx.tenantId);
    const axisByCode = new Map(axes.map((axis) => [axis.code.toLowerCase(), axis]));
    const axisById = new Map(axes.map((axis) => [axis.id, axis]));
    const stored: StoredAnalyticsCategory[] = await ctx.manager.query(
      `SELECT * FROM analytics_categories WHERE tenant_id = $1`,
      [ctx.tenantId],
    );
    const storedByKey = new Map(stored.map((row) => [`${row.axis_id}|${row.name.toLowerCase()}`, row]));

    const errors: AnalyticsValueImportResult['errors'] = [];
    const parsedRows: ParsedRow[] = [];
    const lineByKey = new Map<string, number>();
    rows.forEach((raw) => {
      // The physical line Excel shows, blank lines included.
      const line = raw.line;
      const rowErrors: string[] = rowProblems(raw, ['disabled_at']);
      const attempt = <T>(fn: () => T): T | undefined => {
        try {
          return fn();
        } catch (err) {
          rowErrors.push((err as Error).message);
          return undefined;
        }
      };

      const code = has('axis_code') ? cellOf(raw, 'axis_code') : '';
      let axisId: string | null = null;
      let axisName: string | null = null;
      let axisAppliesTo: AxisAppliesTo | null = null;
      // A disabled dimension's rows are checked once the row is resolved: unchanged ones pass (a re-imported export).
      let disabledAxis: { name: string | null } | null = null;
      if (code) {
        const axis = axisByCode.get(code.toLowerCase());
        if (!axis) rowErrors.push(`Unknown dimension '${code}'.`);
        else {
          axisId = axis.id;
          axisName = axis.name;
          axisAppliesTo = axis.applies_to;
          if (axis.status !== 'enabled') disabledAxis = axis;
        }
      } else if (defaultAxisId || dryRun) {
        // A dry run on a tenant without dimensions: the default is created at load.
        axisId = defaultAxisId;
        axisName = defaultAxisId ? axisById.get(defaultAxisId)?.name ?? null : null;
        axisAppliesTo = defaultAxisId ? axisById.get(defaultAxisId)?.applies_to ?? null : null;
      }

      const name = attempt(() => normalizeAnalyticsName(cellOf(raw, 'name')));
      const key = axisId !== null && name ? `${axisId}|${name.toLowerCase()}` : null;
      if (name && (axisId !== null || !code)) {
        const fileKey = `${axisId ?? '(default)'}|${name.toLowerCase()}`;
        const firstLine = lineByKey.get(fileKey);
        if (firstLine) rowErrors.push(`${name} is already on row ${firstLine}.`);
        else lineByKey.set(fileKey, line);
      }
      const existing = key ? storedByKey.get(key) ?? null : null;

      const statusRaw = has('status') ? cellOf(raw, 'status').toLowerCase() : '';
      if (statusRaw && statusRaw !== StatusState.ENABLED && statusRaw !== StatusState.DISABLED) {
        rowErrors.push(`Invalid status '${cellOf(raw, 'status')}'. Use 'enabled' or 'disabled'.`);
      }
      const status = statusRaw === StatusState.ENABLED || statusRaw === StatusState.DISABLED ? statusRaw : null;
      const disabledAtRaw = has('disabled_at') ? cellOf(raw, 'disabled_at') : '';
      let disabledAt: Date | null = null;
      if (disabledAtRaw) {
        // A bare day at noon UTC, a full ISO timestamp kept; an unreadable cell is a row error.
        const end = endOfValidityOf(raw, 'disabled_at');
        if (end.error) rowErrors.push(end.error);
        else disabledAt = end.value;
      }
      const lifecycleConflict = csvLifecycleConflict(status, disabledAt);
      if (lifecycleConflict) rowErrors.push(lifecycleConflict);
      // An absent column keeps what is stored (null for a new value); a blank cell clears it.
      const appliesToRaw = has('applies_to') ? cellOf(raw, 'applies_to') : '';
      const appliesTo = has('applies_to') ? csvAppliesTo(appliesToRaw) : existing?.applies_to ?? null;
      if (appliesTo === undefined) {
        rowErrors.push(`Invalid applies_to '${appliesToRaw}'. Use 'opex', 'capex' or leave it empty.`);
      } else {
        const conflict = valueAppliesToConflict({ name: axisName, applies_to: axisAppliesTo }, appliesTo);
        if (conflict) rowErrors.push(conflict);
      }

      if (rowErrors.length > 0 || !name) {
        for (const message of rowErrors) errors.push({ row: line, message });
        return;
      }
      // A blank or absent status or date: enabled for a new value, the stored one on an update (`csvItemLifecycle`).
      const next = csvItemLifecycle(status, disabledAt, !!existing);
      const lifecycle = resolveLifecycleState({
        currentDisabledAt: existing?.disabled_at ?? null,
        nextStatus: next.status,
        nextDisabledAt: next.disabled_at,
      });
      const values: AnalyticsCategoryValues = {
        axis_id: axisId ?? '',
        // The name is the match key: a different case in the file refers to the stored value, it does not rename it.
        name: existing?.name ?? name,
        description: has('description')
          ? normalizeAnalyticsDescription(cellOf(raw, 'description'))
          : existing?.description ?? null,
        applies_to: appliesTo ?? null,
        status: lifecycle.status,
        disabled_at: lifecycle.disabled_at,
      };
      // In a disabled dimension only a row that changes nothing is accepted: no new value, no edit.
      if (disabledAxis && !(existing && categoryValuesEqual(existing, values))) {
        errors.push({ row: line, message: `${analyticsAxisSubject(disabledAxis)} is disabled. Enable it or leave it out.` });
        return;
      }
      parsedRows.push({ line, existing, axisName, values });
    });
    if (errors.length > 0) return failed([...errors].sort((a, b) => a.row - b.row), rows.length);

    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    const toWrite: ParsedRow[] = [];
    for (const row of parsedRows) {
      if (!row.existing) inserted += 1;
      else if (categoryValuesEqual(row.existing, row.values)) {
        unchanged += 1;
        continue;
      } else updated += 1;
      toWrite.push(row);
    }
    if (!dryRun) {
      for (const row of toWrite) {
        await this.categories.persist(ctx, row.existing, row.values, { name: row.axisName });
      }
    }
    return { ok: true, dryRun, total: rows.length, inserted, updated, unchanged, errors: [], ignoredColumns: read.ignoredColumns, notices: read.notices };
  }

  private parseFile(
    file: Express.Multer.File,
    language: CsvLanguage,
    dateOrder?: CsvDateOrder,
    decimalMark?: DecimalMark,
  ): Promise<MasterDataFileRead> {
    if (!file) throw new BadRequestException('No file uploaded');
    const buf = file.buffer ?? ((file as any).path ? fs.readFileSync((file as any).path) : undefined);
    if (!buf) throw new BadRequestException('Empty upload');
    return readMasterDataFile({
      file: buf as Buffer,
      fields: ANALYTICS_VALUE_CSV_HEADERS,
      dateFields: ['disabled_at'],
      optional: OPTIONAL_HEADERS,
      language,
      dateOrder,
      decimalMark,
    });
  }
}
