import { BadRequestException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { AmountMeasure } from '../spend/amounts-write.util';
import { SUMMARY_COLUMNS } from '../spend/spend-summary.builder';

/**
 * The tenant's budget column settings (`tenants.metadata.budget_columns`):
 * a name per column, which columns are shown, which follow what is applied
 * to all columns on the budget tab ("Apply the distribution to all columns"
 * on the spread, "Apply these lines to all columns" on the lines), and the
 * default column. The five columns stay equal: behaviour
 * comes from these settings, never from a column's name. Hidden columns keep
 * their amounts and stay writable through the API and imports.
 */

/** The fixed order of the five columns (the order of `AMOUNT_MEASURES`). */
export const BUDGET_COLUMN_ORDER: readonly AmountMeasure[] = SUMMARY_COLUMNS.map((column) => column.measure);

export const BUDGET_COLUMN_NAME_MAX = 40;

export type ColumnFlags = Record<AmountMeasure, boolean>;

export interface BudgetColumnsSettings {
  labels: Record<AmountMeasure, string | null>;
  enabled: ColumnFlags;
  group_spread: ColumnFlags;
  default_column: AmountMeasure;
}

export interface BudgetColumnsPatch {
  labels?: Partial<Record<AmountMeasure, string | null>>;
  enabled?: Partial<ColumnFlags>;
  group_spread?: Partial<ColumnFlags>;
  default_column?: AmountMeasure;
}

function byColumn<T>(value: (measure: AmountMeasure) => T): Record<AmountMeasure, T> {
  return Object.fromEntries(BUDGET_COLUMN_ORDER.map((measure) => [measure, value(measure)])) as Record<AmountMeasure, T>;
}

// Product defaults: today's screens (four columns shown, every column follows the spread and the lines applied to all columns, column 1 by default).
export const DEFAULT_BUDGET_COLUMNS: BudgetColumnsSettings = {
  labels: byColumn(() => null),
  enabled: { planned: true, committed: true, forecast: false, actual: true, expected_landing: true },
  group_spread: byColumn(() => true),
  default_column: 'planned',
};

function cloneSettings(settings: BudgetColumnsSettings): BudgetColumnsSettings {
  return {
    labels: { ...settings.labels },
    enabled: { ...settings.enabled },
    group_spread: { ...settings.group_spread },
    default_column: settings.default_column,
  };
}

function isColumn(value: unknown): value is AmountMeasure {
  return typeof value === 'string' && (BUDGET_COLUMN_ORDER as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** The product name of a column (English), used when the tenant set none. */
export function productColumnName(measure: AmountMeasure): string {
  return SUMMARY_COLUMNS.find((column) => column.measure === measure)!.label;
}

/** The name the tenant gives a column, else its product name. */
export function budgetColumnName(settings: BudgetColumnsSettings, measure: AmountMeasure): string {
  return settings.labels[measure] ?? productColumnName(measure);
}

const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/;
// Zero width, bidi controls, BOM: invisible names or names that only look distinct.
const FORMAT_CHARACTERS = /\p{Cf}/u;

type LabelCheck = { label: string | null; error?: string };

/** Whitespace collapsed and trimmed; blank is null (the product name). */
function checkLabel(raw: unknown): LabelCheck {
  if (raw === null || raw === undefined) return { label: null };
  if (typeof raw !== 'string') return { label: null, error: 'A column name must be text.' };
  // Checked before whitespace is collapsed: \s matches U+FEFF.
  if (FORMAT_CHARACTERS.test(raw)) return { label: null, error: 'A column name cannot contain invisible characters.' };
  const label = raw.replace(/\s+/g, ' ').trim();
  if (label === '') return { label: null };
  if (CONTROL_CHARACTERS.test(label)) return { label: null, error: 'A column name cannot contain control characters.' };
  if (Array.from(label).length > BUDGET_COLUMN_NAME_MAX) {
    return { label: null, error: `A column name can have at most ${BUDGET_COLUMN_NAME_MAX} characters.` };
  }
  return { label };
}

const fold = (name: string) => name.normalize('NFC').toLowerCase();

/** The first column whose name repeats an earlier column's name (after case folding), if any. */
function duplicateName(settings: BudgetColumnsSettings): { measure: AmountMeasure; name: string } | null {
  const seen = new Set<string>();
  for (const measure of BUDGET_COLUMN_ORDER) {
    const name = budgetColumnName(settings, measure);
    if (seen.has(fold(name))) return { measure, name };
    seen.add(fold(name));
  }
  return null;
}

/**
 * Tolerant read of a stored object: each field is kept when valid, else its
 * default. No shown column restores the default shown columns; a hidden
 * default column moves to the first shown column; an invalid or repeated
 * name falls back to the product name.
 */
export function normalizeBudgetColumns(raw: unknown): BudgetColumnsSettings {
  const settings = cloneSettings(DEFAULT_BUDGET_COLUMNS);
  if (!isRecord(raw)) return settings;
  const labels = isRecord(raw.labels) ? raw.labels : {};
  const enabled = isRecord(raw.enabled) ? raw.enabled : {};
  const group = isRecord(raw.group_spread) ? raw.group_spread : {};
  for (const measure of BUDGET_COLUMN_ORDER) {
    const check = checkLabel(labels[measure]);
    settings.labels[measure] = check.error ? null : check.label;
    if (typeof enabled[measure] === 'boolean') settings.enabled[measure] = enabled[measure] as boolean;
    if (typeof group[measure] === 'boolean') settings.group_spread[measure] = group[measure] as boolean;
  }
  for (let duplicate = duplicateName(settings); duplicate; duplicate = duplicateName(settings)) {
    // A custom name that repeats an earlier name is dropped; a product name only repeats a custom one, dropped in turn.
    const culprit = settings.labels[duplicate.measure] !== null
      ? duplicate.measure
      : BUDGET_COLUMN_ORDER.find((m) => settings.labels[m] !== null && fold(budgetColumnName(settings, m)) === fold(duplicate.name))!;
    settings.labels[culprit] = null;
  }
  if (!BUDGET_COLUMN_ORDER.some((measure) => settings.enabled[measure])) {
    settings.enabled = { ...DEFAULT_BUDGET_COLUMNS.enabled };
  }
  if (isColumn(raw.default_column)) settings.default_column = raw.default_column;
  if (!settings.enabled[settings.default_column]) {
    settings.default_column = BUDGET_COLUMN_ORDER.find((measure) => settings.enabled[measure])!;
  }
  return settings;
}

const PATCH_KEYS = ['labels', 'enabled', 'group_spread', 'default_column'];

function unknownColumn(key: string): BadRequestException {
  return new BadRequestException(`Unknown column '${key}'. Use ${BUDGET_COLUMN_ORDER.join(', ')}.`);
}

function patchMap(patch: Record<string, unknown>, field: string): Record<string, unknown> {
  const value = patch[field];
  if (value === undefined) return {};
  if (!isRecord(value)) throw new BadRequestException(`'${field}' must be an object keyed by column.`);
  for (const key of Object.keys(value)) if (!isColumn(key)) throw unknownColumn(key);
  return value;
}

function patchFlags(patch: Record<string, unknown>, field: 'enabled' | 'group_spread', into: ColumnFlags) {
  for (const [measure, value] of Object.entries(patchMap(patch, field))) {
    if (typeof value !== 'boolean') throw new BadRequestException(`'${field}.${measure}' must be true or false.`);
    into[measure as AmountMeasure] = value;
  }
}

/**
 * Merge a partial update onto the current settings, then validate the whole:
 * names distinct after case folding (custom or product), at least one shown
 * column, a shown default column. Unknown keys and non-boolean flags are refused.
 */
export function applyBudgetColumnsPatch(current: BudgetColumnsSettings, patch: unknown): BudgetColumnsSettings {
  if (!isRecord(patch)) throw new BadRequestException('The budget columns settings must be an object.');
  for (const key of Object.keys(patch)) {
    if (!PATCH_KEYS.includes(key)) throw new BadRequestException(`Unknown setting '${key}'. Use ${PATCH_KEYS.join(', ')}.`);
  }
  const next = cloneSettings(current);
  for (const [measure, value] of Object.entries(patchMap(patch, 'labels'))) {
    const check = checkLabel(value);
    if (check.error) throw new BadRequestException(check.error);
    next.labels[measure as AmountMeasure] = check.label;
  }
  patchFlags(patch, 'enabled', next.enabled);
  patchFlags(patch, 'group_spread', next.group_spread);
  if (patch.default_column !== undefined) {
    if (!isColumn(patch.default_column)) throw unknownColumn(String(patch.default_column));
    next.default_column = patch.default_column;
  }

  const duplicate = duplicateName(next);
  if (duplicate) throw new BadRequestException(`Two columns cannot both be named "${duplicate.name}".`);
  if (!BUDGET_COLUMN_ORDER.some((measure) => next.enabled[measure])) {
    throw new BadRequestException('At least one column must stay shown.');
  }
  if (!next.enabled[next.default_column]) {
    throw new BadRequestException('The default column must be shown: choose another default column first.');
  }
  return next;
}

/** The tenant's settings, product defaults when it never saved any (`tenants` has no RLS: read by id). */
export async function readBudgetColumns(manager: EntityManager, tenantId: string): Promise<BudgetColumnsSettings> {
  const rows: Array<{ value: unknown }> = await manager.query(
    `SELECT metadata->'budget_columns' AS value FROM tenants WHERE id = $1`,
    [tenantId],
  );
  return normalizeBudgetColumns(rows[0]?.value);
}

/**
 * The columns as the AI sees them, in the fixed order: position, AI field
 * suffix (`y_plus1_<suffix>`), financial-plan measure key, name, shown, default.
 */
export function budgetColumnsAiContext(settings: BudgetColumnsSettings) {
  return SUMMARY_COLUMNS.map((column, index) => ({
    column: index + 1,
    ai_field_suffix: column.ai,
    measure: column.measure,
    name: budgetColumnName(settings, column.measure),
    shown: settings.enabled[column.measure],
    default: settings.default_column === column.measure,
  }));
}
