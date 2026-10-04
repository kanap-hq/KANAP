import { BadRequestException, Injectable } from '@nestjs/common';
import * as fs from 'fs';
import { resolveLifecycleState, StatusState } from '../common/status';
import {
  cellOf,
  CsvDataRow,
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
import { mergeDaysByYear } from './working-day-profiles.util';
import {
  CalendarSource,
  calendarValuesEqual,
  effectiveStatus,
  isSameCalendarSource,
  normalizeCalendarCode,
  normalizeCalendarDays,
  normalizeCalendarDescription,
  normalizeCalendarName,
  normalizeCalendarSource,
  refusalMessage,
  sortDays,
  SOURCE_CHANGE_REFUSAL,
  StoredWorkingDayProfile,
  WorkingDayProfileContext,
  WorkingDayProfilesService,
  WorkingDayProfileValues,
} from './working-day-profiles.service';

export const CALENDAR_MONTH_HEADERS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const;
export const WORKING_DAY_PROFILE_CSV_HEADERS = [
  'code', 'name', 'description', 'country', 'region', 'status', 'disabled_at', 'year', ...CALENDAR_MONTH_HEADERS,
] as const;
/**
 * Accepted when absent: without `disabled_at` the file sets the lifecycle
 * through `status` alone; without `country` and `region` it creates custom
 * calendars and keeps the source of the existing ones.
 */
const OPTIONAL_HEADERS = ['disabled_at', 'country', 'region'] as const;

export interface WorkingDayProfileImportResult {
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

/** One file row, parsed on its own. */
interface ParsedRow {
  line: number;
  key: string;
  code: string;
  name: string;
  description: string | null;
  status: StatusState;
  disabledAt: Date | null | undefined;
  /** The cells as written (trimmed, blank = null); validated once per calendar. */
  country: string | null;
  region: string | null;
  year: string | null;
  days: string[] | null;
}

/** One calendar of the file: its first row sets the header fields, every row may add a year. */
interface FileCalendar {
  first: ParsedRow;
  rows: ParsedRow[];
  years: Map<string, number>;
}

@Injectable()
export class WorkingDayProfilesCsvService {
  constructor(private readonly calendars: WorkingDayProfilesService) {}

  /**
   * One row per calendar and year, years ascending; a calendar without years
   * is one row with a blank year and months. A standard calendar exports its
   * country and region codes and its edited years only.
   */
  async exportCsv(
    scope: 'data' | 'template',
    ctx: WorkingDayProfileContext,
    language: CsvLanguage = 'en',
  ): Promise<{ filename: string; content: string }> {
    const headers = [...WORKING_DAY_PROFILE_CSV_HEADERS];
    const rows: string[][] = [];
    if (scope === 'data') {
      const stored = await this.calendars.loadStored(ctx);
      stored.sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true, sensitivity: 'base' }) || a.id.localeCompare(b.id));
      for (const calendar of stored) {
        const base = [
          calendar.code,
          calendar.name,
          calendar.description ?? '',
          calendar.country_iso ?? '',
          calendar.region_code ?? '',
          effectiveStatus(calendar),
          endOfValidityCell(calendar.disabled_at, language),
        ];
        const days = sortDays(calendar.days_by_year ?? {});
        const years = Object.keys(days);
        if (years.length === 0) {
          rows.push([...base, '', ...CALENDAR_MONTH_HEADERS.map(() => '')]);
          continue;
        }
        for (const year of years) {
          rows.push([...base, year, ...CALENDAR_MONTH_HEADERS.map((_month, index) => days[year][index] ?? '')]);
        }
      }
    }
    return {
      filename: scope === 'template' ? 'working_day_calendars_template.csv' : 'working_day_calendars.csv',
      content: writeCsv({ language, headers, rows }),
    };
  }

  /**
   * Upsert by code (case-insensitive), one row per calendar and year. The
   * whole file is validated before anything is written: rows of one code must
   * agree on the calendar's fields, a year appears once per code, a row with a
   * year gives its twelve months. Years absent from the file are kept: an
   * import never removes a year. A row identical to what is stored is counted
   * unchanged, and a calendar without any change writes nothing. The country
   * and region are applied on creation; on an existing calendar they are
   * blank or its own. The years of a standard calendar are its edited years.
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
    ctx: WorkingDayProfileContext,
  ): Promise<WorkingDayProfileImportResult> {
    const read = await this.parseFile(file, language ?? 'en', dateOrder, decimalMark);
    const failed = (errors: WorkingDayProfileImportResult['errors'], total = 0): WorkingDayProfileImportResult => ({
      ok: false, dryRun, total, inserted: 0, updated: 0, unchanged: 0,
      errors: [...errors].sort((a, b) => a.row - b.row),
      ignoredColumns: read.ignoredColumns, notices: read.notices,
    });
    if (read.headerError) return failed([{ row: 0, message: read.headerError }]);
    const { rows } = read;
    // An absent `disabled_at` column is not a blank cell: the file then sets the lifecycle through `status` alone.
    const hasDisabledAt = read.present.includes('disabled_at');

    const stored = await this.calendars.lockAll(ctx);
    const storedByCode = new Map(stored.map((row) => [row.code.toLowerCase(), row]));

    // Pass 1: every row on its own, grouped by code.
    const errors: WorkingDayProfileImportResult['errors'] = [];
    const calendars = new Map<string, FileCalendar>();
    rows.forEach((raw) => {
      // The physical line Excel shows, blank lines included.
      const line = raw.line;
      const row = this.parseRow(raw, line, hasDisabledAt, errors);
      if (!row) return;
      const group = calendars.get(row.key);
      if (!group) {
        calendars.set(row.key, { first: row, rows: [row], years: new Map(row.year ? [[row.year, line]] : []) });
        return;
      }
      const disagreement = disagreeOn(group.first, row);
      if (disagreement) {
        errors.push({ row: line, message: `Rows of ${group.first.code} disagree on the ${disagreement}.` });
        return;
      }
      if (row.year) {
        const firstLine = group.years.get(row.year);
        if (firstLine) {
          errors.push({ row: line, message: `${group.first.code} has ${row.year} twice (rows ${firstLine} and ${line}).` });
          return;
        }
        group.years.set(row.year, line);
      }
      group.rows.push(row);
    });

    // The source of each calendar: validated for a new one, blank or unchanged for a stored one.
    const sources = new Map<string, CalendarSource>();
    for (const [key, group] of calendars) {
      const existing = storedByCode.get(key) ?? null;
      const { first } = group;
      if (existing) {
        // A blank cell keeps the stored value; a filled one must be it.
        if (!isSameCalendarSource(existing, first.country ?? undefined, first.region ?? undefined)) {
          errors.push({ row: first.line, message: SOURCE_CHANGE_REFUSAL });
        }
        continue;
      }
      try {
        sources.set(key, normalizeCalendarSource(first.country, first.region));
      } catch (err) {
        errors.push({ row: first.line, message: refusalMessage(err) });
      }
    }

    // The resulting calendars: names stay unique across the stored ones and the file.
    const results = new Map<string, { existing: StoredWorkingDayProfile | null; values: WorkingDayProfileValues }>();
    for (const [key, group] of calendars) {
      const existing = storedByCode.get(key) ?? null;
      const patch: Record<string, string[]> = {};
      for (const row of group.rows) if (row.year && row.days) patch[row.year] = row.days;
      const lifecycle = resolveLifecycleState({
        currentDisabledAt: existing?.disabled_at ?? null,
        nextStatus: group.first.status,
        nextDisabledAt: group.first.disabledAt,
      });
      results.set(key, {
        existing,
        values: {
          code: group.first.code,
          name: group.first.name,
          description: group.first.description,
          days_by_year: mergeDaysByYear(existing?.days_by_year ?? {}, patch),
          status: lifecycle.status,
          disabled_at: lifecycle.disabled_at,
          ...(existing ? {} : sources.get(key)),
        },
      });
    }
    const nameOwner = new Map<string, string>();
    for (const row of stored) {
      if (!results.has(row.code.toLowerCase())) nameOwner.set(row.name.toLowerCase(), row.code.toLowerCase());
    }
    for (const [key, result] of results) {
      const name = result.values.name.toLowerCase();
      const owner = nameOwner.get(name);
      if (owner && owner !== key) {
        errors.push({ row: calendars.get(key)!.first.line, message: `A calendar named ${result.values.name} already exists.` });
      } else nameOwner.set(name, key);
    }
    if (errors.length > 0) return failed(errors, rows.length);

    // Counts per row: a new calendar or a new year is inserted; a changed year,
    // or the first row of a calendar whose fields changed, is updated.
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    const toWrite: Array<{ existing: StoredWorkingDayProfile | null; values: WorkingDayProfileValues; line: number }> = [];
    for (const [key, group] of calendars) {
      const { existing, values } = results.get(key)!;
      if (!existing) {
        inserted += group.rows.length;
        toWrite.push({ existing, values, line: group.first.line });
        continue;
      }
      const fieldsChanged = !calendarValuesEqual(existing, { ...values, days_by_year: existing.days_by_year });
      for (const row of group.rows) {
        const storedDays = row.year ? existing.days_by_year?.[row.year] : undefined;
        if (row.year && !storedDays) inserted += 1;
        else if ((row.year && !sameYear(storedDays!, row.days!)) || (row === group.first && fieldsChanged)) updated += 1;
        else unchanged += 1;
      }
      if (!calendarValuesEqual(existing, values)) toWrite.push({ existing, values, line: group.first.line });
    }

    if (!dryRun) {
      toWrite.sort((a, b) => a.line - b.line);
      // The final names are unique (checked above), but a swap or a chain of
      // renames repeats a name midway: the renamed calendars first take a
      // temporary name, then every calendar gets its final values. The audit
      // compares with the stored row read before, so it shows the real change.
      const renamed = toWrite
        .filter((entry) => entry.existing && entry.existing.name !== entry.values.name)
        .map((entry) => entry.existing!.id);
      if (renamed.length > 0) {
        await ctx.manager.query(
          `UPDATE working_day_profiles SET name = '__renaming_' || id::text
            WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
          [ctx.tenantId, renamed],
        );
      }
      for (const entry of toWrite) {
        await this.calendars.persist(ctx, entry.existing, entry.values);
      }
    }
    return {
      ok: true, dryRun, total: rows.length, inserted, updated, unchanged, errors: [],
      ignoredColumns: read.ignoredColumns, notices: read.notices,
    };
  }

  /** One row on its own; its refusals go to `errors` and it is then left out. */
  private parseRow(
    raw: CsvDataRow,
    line: number,
    hasDisabledAt: boolean,
    errors: WorkingDayProfileImportResult['errors'],
  ): ParsedRow | null {
    const rowErrors: string[] = rowProblems(raw, ['disabled_at']);
    const attempt = <T>(fn: () => T): T | undefined => {
      try {
        return fn();
      } catch (err) {
        rowErrors.push(refusalMessage(err));
        return undefined;
      }
    };
    const code = attempt(() => normalizeCalendarCode(cellOf(raw, 'code')));
    const name = attempt(() => normalizeCalendarName(cellOf(raw, 'name')));

    const statusRaw = cellOf(raw, 'status').toLowerCase();
    if (statusRaw && statusRaw !== StatusState.ENABLED && statusRaw !== StatusState.DISABLED) {
      rowErrors.push(`Invalid status '${cellOf(raw, 'status')}'. Use 'enabled' or 'disabled'.`);
    }
    const disabledAtRaw = hasDisabledAt ? cellOf(raw, 'disabled_at') : '';
    let disabledAt: Date | null | undefined;
    if (disabledAtRaw) {
      // A bare day at noon UTC, a full ISO timestamp kept; an unreadable cell is a row error.
      const end = endOfValidityOf(raw, 'disabled_at');
      if (end.error) rowErrors.push(end.error);
      else disabledAt = end.value;
    }

    const year = cellOf(raw, 'year');
    const months = CALENDAR_MONTH_HEADERS.map((month) => cellOf(raw, month));
    let normalizedYear: string | null = null;
    let days: string[] | null = null;
    if (!year) {
      if (months.some((value) => value !== '')) rowErrors.push('Give the year of these working days.');
    } else {
      const normalized = attempt(() => normalizeCalendarDays({ [year]: months }, false));
      const [entry] = Object.entries(normalized ?? {});
      if (entry?.[1]) [normalizedYear, days] = entry as [string, string[]];
    }

    if (rowErrors.length > 0 || !code || !name) {
      for (const message of rowErrors) errors.push({ row: line, message });
      return null;
    }
    return {
      line,
      key: code.toLowerCase(),
      code,
      name,
      description: normalizeCalendarDescription(cellOf(raw, 'description')),
      status: (statusRaw || StatusState.ENABLED) as StatusState,
      disabledAt,
      country: cellOf(raw, 'country') || null,
      region: cellOf(raw, 'region') || null,
      year: normalizedYear,
      days,
    };
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
      fields: WORKING_DAY_PROFILE_CSV_HEADERS,
      dateFields: ['disabled_at'],
      optional: OPTIONAL_HEADERS,
      language,
      dateOrder,
      decimalMark,
    });
  }
}

/** The first calendar field two rows of one code disagree on, or null. */
function disagreeOn(first: ParsedRow, row: ParsedRow): string | null {
  if (first.name !== row.name) return 'name';
  if (first.description !== row.description) return 'description';
  if ((first.country ?? '').toLowerCase() !== (row.country ?? '').toLowerCase()) return 'country';
  if ((first.region ?? '').toLowerCase() !== (row.region ?? '').toLowerCase()) return 'region';
  if (first.status !== row.status) return 'status';
  const a = first.disabledAt ? first.disabledAt.getTime() : null;
  const b = row.disabledAt ? row.disabledAt.getTime() : null;
  if (a !== b) return 'end of validity';
  return null;
}

function sameYear(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
