import { BadRequestException, Injectable } from '@nestjs/common';
import { format } from '@fast-csv/format';
import { parseString } from '@fast-csv/parse';
import * as fs from 'fs';
import { decodeCsvBufferUtf8OrThrow } from '../common/encoding';
import { denormalizeCsvRow, neutralizeCsvRow } from '../common/csv/csv-export.service';
import { parseEndOfValidityInput, resolveLifecycleState, StatusState } from '../common/status';
import { AnalyticsContext, normalizeAnalyticsDescription, normalizeAnalyticsName } from './analytics-context';
import { analyticsAxisSubject, isAxisActive, loadAnalyticsAxes, resolveDefaultAxisId } from './analytics-axes.util';
import {
  AnalyticsCategoriesService,
  AnalyticsCategoryValues,
  categoryValuesEqual,
  StoredAnalyticsCategory,
} from './analytics-categories.service';

export const ANALYTICS_VALUE_CSV_HEADERS = ['axis_code', 'name', 'description', 'status', 'disabled_at'] as const;
/** Only the name is required; an absent column keeps what is stored (a new value gets the default). */
const REQUIRED_HEADERS = new Set<string>(['name']);
const DELIMITER = ';';

export interface AnalyticsValueImportResult {
  ok: boolean;
  dryRun: boolean;
  total: number;
  inserted: number;
  updated: number;
  unchanged: number;
  errors: Array<{ row: number; message: string }>;
}

interface ParsedRow {
  line: number;
  existing: StoredAnalyticsCategory | null;
  axisName: string | null;
  values: AnalyticsCategoryValues;
}

const cell = (row: Record<string, string>, key: string) => (row[key] ?? '').toString().trim();

function toIso(value: Date | string | null): string {
  if (value == null) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
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

  async exportCsv(scope: 'data' | 'template', ctx: AnalyticsContext): Promise<{ filename: string; content: string }> {
    const rows: Array<Record<string, string>> = [];
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
        rows.push({
          axis_code: codeById.get(value.axis_id) ?? '',
          name: value.name,
          description: value.description ?? '',
          status: isAxisActive(value) ? StatusState.ENABLED : StatusState.DISABLED,
          disabled_at: toIso(value.disabled_at),
        });
      }
    }
    const headers = [...ANALYTICS_VALUE_CSV_HEADERS];
    const chunks: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const stream = format({ headers, delimiter: DELIMITER, alwaysWriteHeaders: true, transform: neutralizeCsvRow });
      stream.on('data', (chunk) => chunks.push(chunk.toString('utf8')));
      stream.on('end', () => resolve());
      stream.on('error', (err) => reject(err));
      for (const row of rows) stream.write(row);
      stream.end();
    });
    return {
      filename: scope === 'template' ? 'analytics_values_template.csv' : 'analytics_values.csv',
      content: '﻿' + chunks.join(''),
    };
  }

  /**
   * Upsert by (dimension, name). The whole file is checked before any write;
   * nothing is written unless it is clean, and a row identical to the stored
   * value is counted unchanged and writes nothing (no audit row).
   */
  async importCsv(
    { file, dryRun }: { file: Express.Multer.File; dryRun: boolean },
    ctx: AnalyticsContext,
  ): Promise<AnalyticsValueImportResult> {
    const failed = (errors: AnalyticsValueImportResult['errors'], total = 0): AnalyticsValueImportResult => ({
      ok: false, dryRun, total, inserted: 0, updated: 0, unchanged: 0, errors,
    });
    const parsed = await this.parseFile(file);
    if ('headerError' in parsed) return failed([{ row: 0, message: parsed.headerError }]);
    const { rows, headers } = parsed;
    const has = (header: string) => headers.includes(header);

    // Blank dimension codes need the default; a file with none leaves a tenant without dimensions untouched.
    const needsDefault = !has('axis_code') || rows.some((row) => cell(row, 'axis_code') === '');
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
    rows.forEach((raw, index) => {
      const line = index + 2;
      const rowErrors: string[] = [];
      const attempt = <T>(fn: () => T): T | undefined => {
        try {
          return fn();
        } catch (err) {
          rowErrors.push((err as Error).message);
          return undefined;
        }
      };

      const code = has('axis_code') ? cell(raw, 'axis_code') : '';
      let axisId: string | null = null;
      let axisName: string | null = null;
      // A disabled dimension's rows are checked once the row is resolved: unchanged ones pass (a re-imported export).
      let disabledAxis: { name: string | null } | null = null;
      if (code) {
        const axis = axisByCode.get(code.toLowerCase());
        if (!axis) rowErrors.push(`Unknown dimension '${code}'.`);
        else {
          axisId = axis.id;
          axisName = axis.name;
          if (axis.status !== 'enabled') disabledAxis = axis;
        }
      } else if (defaultAxisId || dryRun) {
        // A dry run on a tenant without dimensions: the default is created at load.
        axisId = defaultAxisId;
        axisName = defaultAxisId ? axisById.get(defaultAxisId)?.name ?? null : null;
      }

      const name = attempt(() => normalizeAnalyticsName(cell(raw, 'name')));
      const key = axisId !== null && name ? `${axisId}|${name.toLowerCase()}` : null;
      if (name && (axisId !== null || !code)) {
        const fileKey = `${axisId ?? '(default)'}|${name.toLowerCase()}`;
        const firstLine = lineByKey.get(fileKey);
        if (firstLine) rowErrors.push(`${name} is already on row ${firstLine}.`);
        else lineByKey.set(fileKey, line);
      }
      const existing = key ? storedByKey.get(key) ?? null : null;

      const statusRaw = has('status') ? cell(raw, 'status').toLowerCase() : '';
      if (statusRaw && statusRaw !== StatusState.ENABLED && statusRaw !== StatusState.DISABLED) {
        rowErrors.push(`Invalid status '${cell(raw, 'status')}'. Use 'enabled' or 'disabled'.`);
      }
      const disabledAtRaw = has('disabled_at') ? cell(raw, 'disabled_at') : '';
      let disabledAt: Date | null | undefined;
      if (disabledAtRaw) disabledAt = attempt(() => parseEndOfValidityInput(disabledAtRaw)) ?? undefined;

      if (rowErrors.length > 0 || !name) {
        for (const message of rowErrors) errors.push({ row: line, message });
        return;
      }
      // Absent columns keep the stored lifecycle; present ones follow the departments rule (blank status = enabled).
      const lifecycleGiven = has('status') || has('disabled_at');
      const lifecycle = lifecycleGiven
        ? resolveLifecycleState({
          currentDisabledAt: existing?.disabled_at ?? null,
          nextStatus: has('status') ? statusRaw || StatusState.ENABLED : undefined,
          nextDisabledAt: disabledAt,
        })
        : resolveLifecycleState({ currentDisabledAt: existing?.disabled_at ?? null });
      const values: AnalyticsCategoryValues = {
        axis_id: axisId ?? '',
        // The name is the match key: a different case in the file refers to the stored value, it does not rename it.
        name: existing?.name ?? name,
        description: has('description')
          ? normalizeAnalyticsDescription(cell(raw, 'description'))
          : existing?.description ?? null,
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
    return { ok: true, dryRun, total: rows.length, inserted, updated, unchanged, errors: [] };
  }

  private async parseFile(file: Express.Multer.File): Promise<{ rows: Array<Record<string, string>>; headers: string[] } | { headerError: string }> {
    if (!file) throw new BadRequestException('No file uploaded');
    const buf = file.buffer ?? ((file as any).path ? fs.readFileSync((file as any).path) : undefined);
    if (!buf) throw new BadRequestException('Empty upload');
    let content: string;
    try {
      content = decodeCsvBufferUtf8OrThrow(buf as Buffer);
    } catch {
      throw new BadRequestException('Invalid file encoding. Please export or save the CSV as UTF-8 (CSV UTF-8) and use semicolons as separators.');
    }
    const rows: Array<Record<string, string>> = [];
    let headers: string[] = [];
    await new Promise<void>((resolve, reject) => {
      parseString(content, { headers: true, delimiter: DELIMITER, ignoreEmpty: true, trim: true })
        .on('headers', (found: string[]) => { headers = found; })
        .on('error', (err) => reject(new BadRequestException(`The file could not be read: ${err.message}`)))
        .on('data', (row: Record<string, string>) => rows.push(denormalizeCsvRow(row)))
        .on('end', () => resolve());
    });
    const expected: readonly string[] = ANALYTICS_VALUE_CSV_HEADERS;
    const missing = expected.filter((header) => REQUIRED_HEADERS.has(header) && !headers.includes(header));
    const extras = headers.filter((header) => !expected.includes(header));
    if (missing.length > 0 || extras.length > 0) {
      return { headerError: `Header mismatch. Missing: ${missing.join(', ') || '-'}, Extra: ${extras.join(', ') || '-'}` };
    }
    return { rows, headers };
  }
}
