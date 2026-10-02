import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AuditService, AuditSourceOptions } from '../audit/audit.service';
import { parsePagination } from '../common/pagination';
import { parseEndOfValidityInput, resolveLifecycleState, StatusState } from '../common/status';
import {
  canonicalCountry,
  canonicalRegion,
  countryName,
  generateWorkingDays,
  HolidayDay,
  holidayLanguage,
  listCountries,
  regionName,
} from './public-holidays';
import {
  CALENDAR_YEAR_MAX,
  CALENDAR_YEAR_MIN,
  CalendarDays,
  isProfileActive,
  mergeDaysByYear,
  normalizeDaysByYear,
} from './working-day-profiles.util';
import { assertSetFilterModes } from '../common/ag-grid-filtering';

/** Every call runs in the caller's tenant transaction; there is no fallback manager. */
export interface WorkingDayProfileContext {
  manager: EntityManager;
  tenantId: string;
  userId?: string | null;
  audit?: AuditSourceOptions;
}

/** A stored row, as `SELECT *` returns it. */
export interface StoredWorkingDayProfile {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  description: string | null;
  days_by_year: CalendarDays;
  country_iso: string | null;
  region_code: string | null;
  status: StatusState;
  disabled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** The writable values of a calendar, normalized. The source is written on creation only. */
export interface WorkingDayProfileValues {
  code: string;
  name: string;
  description: string | null;
  days_by_year: CalendarDays;
  status: StatusState;
  disabled_at: Date | null;
  country_iso?: string | null;
  region_code?: string | null;
}

export interface WorkingDayProfileInput {
  code?: unknown;
  name?: unknown;
  description?: unknown;
  days_by_year?: unknown;
  status?: unknown;
  disabled_at?: unknown;
  country_iso?: unknown;
  region_code?: unknown;
}

export type WorkingDayProfileField =
  | 'code' | 'name' | 'description' | 'days_by_year' | 'status' | 'disabled_at' | 'country_iso' | 'region_code';

/** The source of a standard calendar; both null on a custom one. */
export interface CalendarSource {
  country_iso: string | null;
  region_code: string | null;
}

/**
 * The API shape: `status` is the effective lifecycle, `disabled_at` an ISO
 * string, the country and region names in the language asked for.
 */
export interface WorkingDayProfileRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  days_by_year: CalendarDays;
  country_iso: string | null;
  region_code: string | null;
  country_name: string | null;
  region_name: string | null;
  status: 'enabled' | 'disabled';
  disabled_at: string | null;
  created_at: string;
  updated_at: string;
}

export type WorkingDayProfileListRow = WorkingDayProfileRow & { years: string[] };

export type WorkingDayProfileDetail = WorkingDayProfileRow & { opex_count: number; capex_count: number };

export interface WorkingDayProfileUsage {
  opex: number;
  capex: number;
}

/**
 * One year of a calendar: `edited` when stored, `standard` when it follows
 * the public holidays, `none` on a custom calendar without that year. A
 * standard calendar also gives its standard values and holidays when edited.
 */
export interface WorkingDayProfileYear {
  year: number;
  source: 'edited' | 'standard' | 'none';
  days: string[] | null;
  standard_days: string[] | null;
  holidays: HolidayDay[];
}

export interface CalendarSuggestion {
  country_iso: string;
  country_name: string;
  companies: string[];
}

// -------------------------------------------------------------- field rules ----

export const WORKING_DAY_PROFILE_CODE_MAX = 50;
export const WORKING_DAY_PROFILE_NAME_MAX = 200;
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;

export function calendarRefusal(message: string, field?: WorkingDayProfileField): BadRequestException {
  return new BadRequestException({ statusCode: 400, error: 'Bad Request', message, ...(field ? { field } : {}) });
}

export function normalizeCalendarCode(raw: unknown): string {
  const code = typeof raw === 'string' ? raw.trim() : raw == null ? '' : String(raw).trim();
  if (!code) throw calendarRefusal('Code is required.', 'code');
  if ([...code].length > WORKING_DAY_PROFILE_CODE_MAX) {
    throw calendarRefusal(`Code must be ${WORKING_DAY_PROFILE_CODE_MAX} characters or fewer.`, 'code');
  }
  if (CONTROL_OR_FORMAT.test(code)) throw calendarRefusal('Code cannot contain control or invisible characters.', 'code');
  return code;
}

export function normalizeCalendarName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim() : raw == null ? '' : String(raw).trim();
  if (!name) throw calendarRefusal('Name is required.', 'name');
  if ([...name].length > WORKING_DAY_PROFILE_NAME_MAX) {
    throw calendarRefusal(`Name must be ${WORKING_DAY_PROFILE_NAME_MAX} characters or fewer.`, 'name');
  }
  if (CONTROL_OR_FORMAT.test(name)) throw calendarRefusal('Name cannot contain control or invisible characters.', 'name');
  return name;
}

export function normalizeCalendarDescription(raw: unknown): string | null {
  if (raw == null) return null;
  const text = String(raw).trim();
  return text === '' ? null : text;
}

export const SOURCE_CHANGE_REFUSAL = 'The country of a calendar cannot be changed. Create another calendar.';

const blankToNull = (raw: unknown): string | null => {
  const text = raw == null ? '' : String(raw).trim();
  return text === '' ? null : text;
};

/**
 * The country and region of a new calendar, as the public holiday package
 * codes them ("fr" -> "FR"). Blank means a custom calendar; a region needs
 * its country and must be one of its regions.
 */
export function normalizeCalendarSource(countryRaw: unknown, regionRaw: unknown): CalendarSource {
  const countryText = blankToNull(countryRaw);
  const regionText = blankToNull(regionRaw);
  if (!countryText) {
    if (regionText) throw calendarRefusal(`Give the country of region ${regionText}.`, 'country_iso');
    return { country_iso: null, region_code: null };
  }
  const country = canonicalCountry(countryText);
  if (!country) throw calendarRefusal(`Country ${countryText} is not in the list.`, 'country_iso');
  if (!regionText) return { country_iso: country, region_code: null };
  const region = canonicalRegion(country, regionText);
  if (!region) throw calendarRefusal(`${regionText} is not a region of ${countryName(country, 'en')}.`, 'region_code');
  return { country_iso: country, region_code: region };
}

/**
 * Whether a country and region given for an existing calendar are its own:
 * an absent value (undefined) always is; a given one must match what is
 * stored, codes compared without case.
 */
export function isSameCalendarSource(stored: CalendarSource, countryRaw: unknown, regionRaw: unknown): boolean {
  const same = (storedValue: string | null, raw: unknown) =>
    raw === undefined || (blankToNull(raw)?.toLowerCase() ?? null) === (storedValue?.toLowerCase() ?? null);
  return same(stored.country_iso, countryRaw) && same(stored.region_code, regionRaw);
}

/** The days of a body, as the util normalizes them; its refusal keeps its sentence and names the field. */
export function normalizeCalendarDays(raw: unknown, partial: boolean): Record<string, string[] | null> {
  try {
    return normalizeDaysByYear(raw, { partial });
  } catch (err) {
    if (err instanceof BadRequestException) throw calendarRefusal(refusalMessage(err), 'days_by_year');
    throw err;
  }
}

/** The sentence of a refusal, whether it was built with a string or with a body. */
export function refusalMessage(err: unknown): string {
  if (err instanceof BadRequestException) {
    const response = err.getResponse() as any;
    const message = typeof response === 'string' ? response : response?.message;
    if (Array.isArray(message)) return message.join(' ');
    if (typeof message === 'string' && message) return message;
  }
  return (err as Error)?.message || 'Invalid value.';
}

/** Years in ascending order, so two equal calendars compare and store identically. */
export function sortDays(days: Record<string, string[]>): CalendarDays {
  const out: CalendarDays = {};
  for (const year of Object.keys(days).sort()) out[year] = [...days[year]];
  return out;
}

export function sameDays(a: CalendarDays | null | undefined, b: CalendarDays | null | undefined): boolean {
  return JSON.stringify(sortDays(a ?? {})) === JSON.stringify(sortDays(b ?? {}));
}

const sameInstant = (a: Date | null, b: Date | null) => (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);

/** The effective lifecycle: a stored `enabled` whose end of validity has passed reads `disabled`. */
export function effectiveStatus(row: { status: string; disabled_at: Date | string | null }): 'enabled' | 'disabled' {
  return isProfileActive(row) ? 'enabled' : 'disabled';
}

export function calendarValuesEqual(stored: StoredWorkingDayProfile, next: WorkingDayProfileValues): boolean {
  return stored.code === next.code
    && stored.name === next.name
    && (stored.description ?? null) === next.description
    && sameDays(stored.days_by_year, next.days_by_year)
    && effectiveStatus(stored) === next.status
    && sameInstant(stored.disabled_at, next.disabled_at);
}

const iso = (value: Date | string | null | undefined): string | null =>
  value == null ? null : new Date(value).toISOString();

export function toCalendarRow(stored: StoredWorkingDayProfile, lang = 'en'): WorkingDayProfileRow {
  const country = stored.country_iso ?? null;
  const region = stored.region_code ?? null;
  return {
    id: stored.id,
    code: stored.code,
    name: stored.name,
    description: stored.description ?? null,
    days_by_year: sortDays(stored.days_by_year ?? {}),
    country_iso: country,
    region_code: region,
    country_name: country ? countryName(country, lang) : null,
    region_name: country && region ? regionName(country, region, lang) : null,
    status: effectiveStatus(stored),
    disabled_at: iso(stored.disabled_at),
    created_at: iso(stored.created_at)!,
    updated_at: iso(stored.updated_at)!,
  };
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "3 OPEX lines and 1 CAPEX line", or '' when unused. */
export function calendarUsageText(usage: WorkingDayProfileUsage | undefined): string {
  if (!usage) return '';
  const parts: string[] = [];
  if (usage.opex > 0) parts.push(plural(usage.opex, 'OPEX line', 'OPEX lines'));
  if (usage.capex > 0) parts.push(plural(usage.capex, 'CAPEX line', 'CAPEX lines'));
  return parts.join(' and ');
}

/** A 23505 on either unique index, as a sentence naming the field. */
export function uniqueViolation(err: any, values: Pick<WorkingDayProfileValues, 'code' | 'name'>): BadRequestException | null {
  if (err?.code !== '23505') return null;
  if (String(err?.constraint ?? '') === 'uniq_working_day_profiles_tenant_name') {
    return calendarRefusal(`A calendar named ${values.name} already exists.`, 'name');
  }
  return calendarRefusal(`A calendar with code ${values.code} already exists.`, 'code');
}

// ------------------------------------------------------------ list helpers ----

const SOURCE_FIELDS = ['country', 'country_iso', 'country_name', 'region_code', 'region_name'];
const FILTER_FIELDS = new Set(['code', 'name', 'description', 'status', 'years', 'disabled_at', ...SOURCE_FIELDS]);
const SORT_FIELDS = new Set(['code', 'name', 'description', 'status', 'years', 'disabled_at', 'created_at', 'updated_at', ...SOURCE_FIELDS]);
const MAX_IDS = 10_000;

/** A grid filter model on one value: set, blank, text operators, combined AND/OR. */
function passesFilter(value: unknown, raw: any): boolean {
  if (!raw || typeof raw !== 'object') return true;
  if ((raw.operator === 'AND' || raw.operator === 'OR') && Array.isArray(raw.conditions) && raw.conditions.length > 0) {
    const results = raw.conditions.map((condition: any) => passesFilter(value, condition));
    return raw.operator === 'OR' ? results.some(Boolean) : results.every(Boolean);
  }
  const text = value == null ? '' : String(value);
  const blank = text === '';
  if (raw.filterType === 'set' || raw.type === 'set') {
    const values: unknown[] = Array.isArray(raw.values) ? raw.values : [];
    if (values.length === 0) return false;
    const wanted = values.filter((entry) => entry != null && entry !== '').map((entry) => String(entry));
    if (blank) return wanted.length < values.length;
    return wanted.includes(text);
  }
  const type = String(raw.type ?? 'contains');
  if (type === 'blank') return blank;
  if (type === 'notBlank') return !blank;
  const needleRaw = raw.filter ?? raw.value;
  if (needleRaw == null || needleRaw === '') return true;
  const needle = String(needleRaw).toLowerCase();
  const haystack = text.toLowerCase();
  switch (type) {
    case 'equals': return haystack === needle;
    case 'notEqual': return haystack !== needle;
    case 'startsWith': return haystack.startsWith(needle);
    case 'endsWith': return haystack.endsWith(needle);
    case 'notContains': return !haystack.includes(needle);
    default: return haystack.includes(needle);
  }
}

/** "France (Moselle)", "France", or '' on a custom calendar. */
export function calendarSourceLabel(row: Pick<WorkingDayProfileRow, 'country_name' | 'region_name'>): string {
  if (!row.country_name) return '';
  return row.region_name ? `${row.country_name} (${row.region_name})` : row.country_name;
}

/** The value a filter or a sort reads: the years and country columns read as their displayed text. */
function fieldValue(row: WorkingDayProfileListRow, field: string): unknown {
  if (field === 'years') return row.years.join(', ');
  if (field === 'country') return calendarSourceLabel(row);
  return (row as any)[field];
}

function compareValues(a: unknown, b: unknown): number {
  return String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' });
}

// ----------------------------------------------------------------- service ----

@Injectable()
export class WorkingDayProfilesService {
  constructor(private readonly audit: AuditService) {}

  // Reads ------------------------------------------------------------------

  async list(query: any, ctx: WorkingDayProfileContext) {
    const parsed = parsePagination(query ?? {}, { field: 'code', direction: 'ASC' });
    const rows = await this.listRows(query, parsed, ctx);
    return { items: rows.slice(parsed.skip, parsed.skip + parsed.limit), total: rows.length, page: parsed.page, limit: parsed.limit };
  }

  async listIds(query: any, ctx: WorkingDayProfileContext): Promise<{ ids: string[]; total: number }> {
    const parsed = parsePagination({ ...(query ?? {}), page: 1 }, { field: 'code', direction: 'ASC' });
    const rows = await this.listRows(query, parsed, ctx);
    return { ids: rows.slice(0, MAX_IDS).map((row) => row.id), total: rows.length };
  }

  async get(id: string, ctx: WorkingDayProfileContext, lang?: string): Promise<WorkingDayProfileDetail> {
    this.assertContext(ctx);
    const [stored] = await this.loadByIds(ctx, [id]);
    if (!stored) throw new NotFoundException('Calendar not found.');
    const usage = (await this.countUsage(ctx, [id])).get(id) ?? { opex: 0, capex: 0 };
    return { ...toCalendarRow(stored, holidayLanguage(lang)), opex_count: usage.opex, capex_count: usage.capex };
  }

  /**
   * One year of a calendar with the values it computes with: the edited
   * year when stored, else the standard values on a standard calendar.
   */
  async getYear(id: string, yearRaw: unknown, ctx: WorkingDayProfileContext, lang?: string): Promise<WorkingDayProfileYear> {
    this.assertContext(ctx);
    const text = String(yearRaw ?? '').trim();
    const year = /^\d{4}$/.test(text) ? Number(text) : NaN;
    if (!(year >= CALENDAR_YEAR_MIN && year <= CALENDAR_YEAR_MAX)) {
      throw calendarRefusal(`Pick a year between ${CALENDAR_YEAR_MIN} and ${CALENDAR_YEAR_MAX}.`);
    }
    const [stored] = await this.loadByIds(ctx, [id]);
    if (!stored) throw new NotFoundException('Calendar not found.');
    const edited = (stored.days_by_year ?? {})[String(year)] ?? null;
    const country = canonicalCountry(stored.country_iso);
    const region = stored.region_code ? canonicalRegion(country, stored.region_code) : null;
    if (country && (!stored.region_code || region)) {
      const standard = generateWorkingDays(country, region, year, holidayLanguage(lang));
      return {
        year,
        source: edited ? 'edited' : 'standard',
        days: edited ?? standard.days,
        standard_days: standard.days,
        holidays: standard.holidays,
      };
    }
    return { year, source: edited ? 'edited' : 'none', days: edited, standard_days: null, holidays: [] };
  }

  /** Every country with public holiday rules, and its regions, names in `lang`. */
  countries(lang?: string) {
    return { items: listCountries(holidayLanguage(lang)) };
  }

  /**
   * The countries of the tenant's enabled companies that have no standard
   * calendar for the whole country yet (whatever its status), with the
   * companies there, sorted by country name in `lang`. A country whose code,
   * or name in `lang`, is already a calendar's code or name (without case) is
   * left out too: creating it would be refused.
   */
  async suggestions(ctx: WorkingDayProfileContext, lang?: string): Promise<{ items: CalendarSuggestion[] }> {
    this.assertContext(ctx);
    const language = holidayLanguage(lang);
    const companies: Array<{ name: string; country_iso: string; status: string; disabled_at: Date | null }> = await ctx.manager.query(
      `SELECT c.name, upper(btrim(c.country_iso)) AS country_iso, c.status, c.disabled_at
         FROM companies c
        WHERE c.tenant_id = $1
          AND c.country_iso IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM working_day_profiles w
             WHERE w.tenant_id = $1 AND w.country_iso = upper(btrim(c.country_iso)) AND w.region_code IS NULL
          )`,
      [ctx.tenantId],
    );
    const taken: Array<{ code: string; name: string }> = await ctx.manager.query(
      `SELECT code, name FROM working_day_profiles WHERE tenant_id = $1`,
      [ctx.tenantId],
    );
    const takenCodes = new Set(taken.map((row) => row.code.toLowerCase()));
    const takenNames = new Set(taken.map((row) => row.name.toLowerCase()));
    const byCountry = new Map<string, string[]>();
    for (const company of companies) {
      const country = canonicalCountry(company.country_iso);
      if (!country || !isProfileActive(company)) continue;
      if (takenCodes.has(country.toLowerCase()) || takenNames.has(countryName(country, language).toLowerCase())) continue;
      byCountry.set(country, [...(byCountry.get(country) ?? []), company.name]);
    }
    const collator = new Intl.Collator([language, 'en'], { sensitivity: 'base' });
    const items = [...byCountry.entries()]
      .map(([country, names]) => ({
        country_iso: country,
        country_name: countryName(country, language),
        companies: [...new Set(names)].sort((a, b) => collator.compare(a, b)),
      }))
      .sort((a, b) => collator.compare(a.country_name, b.country_name) || a.country_iso.localeCompare(b.country_iso));
    return { items };
  }

  private async listRows(query: any, parsed: ReturnType<typeof parsePagination>, ctx: WorkingDayProfileContext): Promise<WorkingDayProfileListRow[]> {
    assertSetFilterModes(parsed.filters);
    this.assertContext(ctx);
    const lang = holidayLanguage(query?.lang);
    const stored = await this.loadStored(ctx);
    let rows: WorkingDayProfileListRow[] = stored.map((row) => {
      const api = toCalendarRow(row, lang);
      return { ...api, years: Object.keys(api.days_by_year) };
    });

    const filters: Record<string, any> = parsed.filters && typeof parsed.filters === 'object' ? parsed.filters : {};
    const includeDisabled = ['1', 'true'].includes(String(query?.includeDisabled ?? '').toLowerCase());
    // Same scope as the other lifecycle lists: enabled only unless asked otherwise.
    if (parsed.status) rows = rows.filter((row) => row.status === parsed.status);
    else if (!includeDisabled && !Object.prototype.hasOwnProperty.call(filters, 'status')) {
      rows = rows.filter((row) => row.status === StatusState.ENABLED);
    }
    for (const [field, model] of Object.entries(filters)) {
      if (!FILTER_FIELDS.has(field)) continue;
      rows = rows.filter((row) => passesFilter(fieldValue(row, field), model));
    }
    const q = String(parsed.q ?? '').trim().toLowerCase();
    if (q) {
      rows = rows.filter((row) => [row.code, row.name, row.description ?? '', calendarSourceLabel(row)]
        .some((value) => value.toLowerCase().includes(q)));
    }

    const field = SORT_FIELDS.has(parsed.sort.field) ? parsed.sort.field : 'code';
    const dir = parsed.sort.direction === 'DESC' ? -1 : 1;
    const byCode = (a: WorkingDayProfileListRow, b: WorkingDayProfileListRow) => compareValues(a.code, b.code) || a.id.localeCompare(b.id);
    rows.sort((a, b) => {
      const av = fieldValue(a, field);
      const bv = fieldValue(b, field);
      const aBlank = av == null || av === '';
      const bBlank = bv == null || bv === '';
      if (aBlank || bBlank) {
        if (aBlank && bBlank) return byCode(a, b);
        return aBlank ? dir : -dir;
      }
      return compareValues(av, bv) * dir || byCode(a, b);
    });
    return rows;
  }

  // Writes -----------------------------------------------------------------

  /**
   * With a country (and maybe a region), a standard calendar: its years follow
   * the public holidays and the days given become edited years.
   */
  async create(body: WorkingDayProfileInput, ctx: WorkingDayProfileContext, lang?: string): Promise<WorkingDayProfileDetail> {
    this.assertContext(ctx);
    const lifecycle = this.lifecycle(null, body);
    const days = normalizeCalendarDays(body?.days_by_year ?? {}, false);
    const values: WorkingDayProfileValues = {
      code: normalizeCalendarCode(body?.code),
      name: normalizeCalendarName(body?.name),
      description: normalizeCalendarDescription(body?.description),
      days_by_year: mergeDaysByYear({}, days),
      status: lifecycle.status,
      disabled_at: lifecycle.disabled_at,
      ...normalizeCalendarSource(body?.country_iso, body?.region_code),
    };
    await this.assertUnique(ctx, values, null);
    const saved = await this.persist(ctx, null, values);
    return this.get(saved.id, ctx, lang);
  }

  /**
   * PATCH semantics: an absent key keeps the stored value; `days_by_year` is
   * merged per year. The country and region are accepted only unchanged.
   */
  async update(id: string, body: WorkingDayProfileInput, ctx: WorkingDayProfileContext, lang?: string): Promise<WorkingDayProfileDetail> {
    this.assertContext(ctx);
    const has = (key: keyof WorkingDayProfileInput) =>
      body != null && Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined;
    const [existing] = await this.lockByIds(ctx, [id]);
    if (!existing) throw new NotFoundException('Calendar not found.');
    if (!isSameCalendarSource(existing, body?.country_iso, body?.region_code)) {
      throw calendarRefusal(SOURCE_CHANGE_REFUSAL, 'country_iso');
    }

    const lifecycle = this.lifecycle(existing, body);
    const values: WorkingDayProfileValues = {
      code: has('code') ? normalizeCalendarCode(body.code) : existing.code,
      name: has('name') ? normalizeCalendarName(body.name) : existing.name,
      description: has('description') ? normalizeCalendarDescription(body.description) : existing.description ?? null,
      days_by_year: has('days_by_year')
        ? mergeDaysByYear(existing.days_by_year, normalizeCalendarDays(body.days_by_year, true))
        : sortDays(existing.days_by_year ?? {}),
      status: lifecycle.status,
      disabled_at: lifecycle.disabled_at,
    };
    if (!calendarValuesEqual(existing, values)) {
      await this.assertUnique(ctx, values, id);
      await this.persist(ctx, existing, values);
    }
    return this.get(id, ctx, lang);
  }

  // Shared with the delete and CSV services ----------------------------------

  async loadStored(ctx: WorkingDayProfileContext): Promise<StoredWorkingDayProfile[]> {
    return ctx.manager.query(`SELECT * FROM working_day_profiles WHERE tenant_id = $1`, [ctx.tenantId]);
  }

  async loadByIds(ctx: WorkingDayProfileContext, ids: string[]): Promise<StoredWorkingDayProfile[]> {
    if (ids.length === 0) return [];
    return ctx.manager.query(
      `SELECT * FROM working_day_profiles WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [ctx.tenantId, ids],
    );
  }

  /** Locks the rows (FOR UPDATE, stable order) and returns them; unknown ids are absent. */
  async lockByIds(ctx: WorkingDayProfileContext, ids: string[]): Promise<StoredWorkingDayProfile[]> {
    if (ids.length === 0) return [];
    return ctx.manager.query(
      `SELECT * FROM working_day_profiles WHERE tenant_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR UPDATE`,
      [ctx.tenantId, ids],
    );
  }

  /** Locks every calendar of the tenant (the CSV import rewrites any of them). */
  async lockAll(ctx: WorkingDayProfileContext): Promise<StoredWorkingDayProfile[]> {
    this.assertContext(ctx);
    return ctx.manager.query(
      `SELECT * FROM working_day_profiles WHERE tenant_id = $1 ORDER BY id FOR UPDATE`,
      [ctx.tenantId],
    );
  }

  /**
   * Distinct OPEX and CAPEX lines (items) with a quantity × price line on each
   * calendar, whatever the year or column, one query. Lock the calendars first
   * when the count guards a delete: a lines write takes a key-share lock on
   * the calendars it names, which waits for FOR UPDATE.
   */
  async countUsage(ctx: WorkingDayProfileContext, ids: string[]): Promise<Map<string, WorkingDayProfileUsage>> {
    const usage = new Map<string, WorkingDayProfileUsage>();
    if (ids.length === 0) return usage;
    const rows: Array<{ id: string; opex: number; capex: number }> = await ctx.manager.query(
      `SELECT p.id,
              (SELECT count(DISTINCT v.spend_item_id)::int
                 FROM spend_round_input_lines l
                 JOIN spend_round_inputs r ON r.tenant_id = l.tenant_id AND r.id = l.round_input_id
                 JOIN spend_versions v ON v.tenant_id = r.tenant_id AND v.id = r.version_id
                WHERE l.tenant_id = $1 AND r.tenant_id = $1 AND v.tenant_id = $1 AND l.working_day_profile_id = p.id) AS opex,
              (SELECT count(DISTINCT v.capex_item_id)::int
                 FROM capex_round_input_lines l
                 JOIN capex_round_inputs r ON r.tenant_id = l.tenant_id AND r.id = l.round_input_id
                 JOIN capex_versions v ON v.tenant_id = r.tenant_id AND v.id = r.version_id
                WHERE l.tenant_id = $1 AND r.tenant_id = $1 AND v.tenant_id = $1 AND l.working_day_profile_id = p.id) AS capex
         FROM working_day_profiles p
        WHERE p.tenant_id = $1 AND p.id = ANY($2::uuid[])`,
      [ctx.tenantId, ids],
    );
    for (const row of rows) usage.set(row.id, { opex: Number(row.opex), capex: Number(row.capex) });
    return usage;
  }

  /** A readable refusal before the unique indexes (which stay the guarantee). */
  async assertUnique(ctx: WorkingDayProfileContext, values: Pick<WorkingDayProfileValues, 'code' | 'name'>, id: string | null) {
    const rows: Array<{ code: string; name: string }> = await ctx.manager.query(
      `SELECT code, name FROM working_day_profiles
        WHERE tenant_id = $1 AND ($2::uuid IS NULL OR id <> $2::uuid)
          AND (lower(code) = lower($3) OR lower(name) = lower($4))`,
      [ctx.tenantId, id, values.code, values.name],
    );
    if (rows.some((row) => row.code.toLowerCase() === values.code.toLowerCase())) {
      throw calendarRefusal(`A calendar with code ${values.code} already exists.`, 'code');
    }
    if (rows.some((row) => row.name.toLowerCase() === values.name.toLowerCase())) {
      throw calendarRefusal(`A calendar named ${values.name} already exists.`, 'name');
    }
  }

  /** Inserts (existing = null) or updates one calendar and writes its audit row. An update never changes the source. */
  async persist(
    ctx: WorkingDayProfileContext,
    existing: StoredWorkingDayProfile | null,
    values: WorkingDayProfileValues,
  ): Promise<StoredWorkingDayProfile> {
    let saved: StoredWorkingDayProfile | undefined;
    const days = JSON.stringify(sortDays(values.days_by_year));
    try {
      const rows = existing
        ? await ctx.manager.query(
          `UPDATE working_day_profiles
              SET code = $3, name = $4, description = $5, days_by_year = $6::jsonb, status = $7, disabled_at = $8, updated_at = now()
            WHERE tenant_id = $1 AND id = $2
        RETURNING *`,
          [ctx.tenantId, existing.id, values.code, values.name, values.description, days, values.status, values.disabled_at],
        )
        : await ctx.manager.query(
          `INSERT INTO working_day_profiles (tenant_id, code, name, description, days_by_year, status, disabled_at, country_iso, region_code)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)
        RETURNING *`,
          [
            ctx.tenantId, values.code, values.name, values.description, days, values.status, values.disabled_at,
            values.country_iso ?? null, values.region_code ?? null,
          ],
        );
      // An UPDATE … RETURNING through the query runner comes back as [rows, count].
      saved = (Array.isArray(rows[0]) ? (rows[0] as any)[0] : rows[0]) as StoredWorkingDayProfile | undefined;
    } catch (err: any) {
      const unique = uniqueViolation(err, values);
      if (unique) throw unique;
      if (err?.code === '23514') {
        // The CHECK constraints mirror the rules above; this only fires on a rule the service missed.
        throw calendarRefusal('This calendar cannot be saved as it is.');
      }
      throw err;
    }
    if (!saved) throw new NotFoundException('Calendar not found.');
    await this.audit.log(
      {
        table: 'working_day_profiles',
        recordId: saved.id,
        action: existing ? 'update' : 'create',
        before: existing,
        after: saved,
        userId: ctx.userId ?? null,
        source: ctx.audit?.source,
        sourceRef: ctx.audit?.sourceRef ?? null,
      },
      { manager: ctx.manager },
    );
    return saved;
  }

  // Internals ----------------------------------------------------------------

  private lifecycle(existing: StoredWorkingDayProfile | null, body: WorkingDayProfileInput | undefined) {
    let nextDisabledAt: Date | null | undefined;
    if (body && Object.prototype.hasOwnProperty.call(body, 'disabled_at') && body.disabled_at !== undefined) {
      try {
        nextDisabledAt = parseEndOfValidityInput(body.disabled_at);
      } catch (err) {
        throw calendarRefusal((err as Error).message, 'disabled_at');
      }
    }
    let nextStatus: StatusState | undefined;
    if (body?.status !== undefined && body?.status !== null) {
      const status = String(body.status).trim().toLowerCase();
      if (status !== StatusState.ENABLED && status !== StatusState.DISABLED) {
        throw calendarRefusal("Status must be 'enabled' or 'disabled'.", 'status');
      }
      nextStatus = status as StatusState;
    }
    return resolveLifecycleState({
      currentDisabledAt: existing?.disabled_at ?? null,
      nextStatus,
      nextDisabledAt,
    });
  }

  private assertContext(ctx: WorkingDayProfileContext) {
    if (!ctx?.manager || !ctx?.tenantId) {
      throw new InternalServerErrorException('Calendar reads and writes need the request transaction.');
    }
  }
}
