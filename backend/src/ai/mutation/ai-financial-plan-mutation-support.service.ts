import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { validate as isUuid } from 'uuid';
import { CapexAllocationsService, SpendAllocationsService } from '../../spend/spend-allocations.service';
import { defaultAllocationDriver } from '../../spend/allocation-save';
import { lockBudgetLine, lockBudgetVersions } from '../../spend/budget-locks';
import { CapexAmountsService, SpendAmountsService } from '../../spend/spend-amounts.service';
import { CapexVersionsService, SpendVersionsService } from '../../spend/spend-versions.service';
import { BUDGET_LINE_PREFIX, BudgetNature, natureAnd } from '../../spend/budget-nature';
import { budgetLineReferenceNumbers, parseItemRef } from '../../common/resolve-item-id';
import { presentChild } from '../../spend/budget-line-presentation';
import { AMOUNT_MEASURES, AmountMeasure, assertSpreadProfile, validateAmountValue } from '../../spend/amounts-write.util';
import { costLine, RoundInput } from '../../spend/round-inputs.util';
import { formatAmount, formatCents } from '../../common/amount';
import { budgetColumnName, BudgetColumnsSettings, readBudgetColumns } from '../../budget-columns/budget-columns.util';
import { AiMutationPreview } from '../ai-mutation-preview.entity';
import { AiExecutionContextWithManager, AiMutationPreviewChangeDto, AiPreviewAmounts } from '../ai.types';
import { AiMutationAuditOptions, buildAiMutationAudit } from './ai-mutation-audit.util';
import { amountsEntryCheckWarning, ENTRY_CHECK_STORE_KEY, entryCheckWarningChange } from './ai-entry-check-warning';
import type { ColumnAfterWrite } from '../../spend/budget-line-entry-check';
import {
  AiMutationPreviewPresentation,
  AiPreparedMutationPreview,
} from './ai-mutation-operation.types';
import {
  AiWriteLanguage, AllocationBasis, AllocationSplitView, allocationSplitText, manualAllocationRemovedText, previewSummaryText, quoted, writeActionText,
} from '../ai-write-texts';

export const AI_FINANCIAL_PLAN_ENTITY_TYPES = ['budget_lines'] as const;
export type AiFinancialPlanEntityType = typeof AI_FINANCIAL_PLAN_ENTITY_TYPES[number];

export const AI_FINANCIAL_PLAN_ACTIONS = [
  'create_version',
  'update_version',
  'upsert_amounts',
  'replace_allocations',
] as const;
export type AiFinancialPlanAction = typeof AI_FINANCIAL_PLAN_ACTIONS[number];

export const AI_FINANCIAL_PLAN_BUSINESS_RESOURCES = ['budget'] as const;

/** Amounts given with a new line (`create_business_record`), checked at preview time and written with it. */
export type AiNewLineAmounts = {
  amounts: Record<string, unknown>;
  /** What the approval card shows: the year and the amounts, under the tenant's column names. */
  display: string;
  /** The same amounts as numbers, which the card writes in the person's language. */
  preview: AiPreviewAmounts;
};

/** Stored amounts of a preview, as the card receives them; null when the preview holds none. */
export function storedPreviewAmounts(value: unknown): AiPreviewAmounts | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AiPreviewAmounts : null;
}

export type AiWriteFinancialPlanInput = {
  entity_type: AiFinancialPlanEntityType;
  ref: string;
  action: AiFinancialPlanAction;
  version_ref?: string | null;
  fields?: Record<string, unknown> | null;
  amounts?: unknown;
  allocations?: unknown[] | null;
};

type FinancialItemRef = {
  id: string;
  ref: string | null;
  label: string;
  nature: BudgetNature;
  row: Record<string, unknown>;
};

type FinancialVersionRef = {
  id: string;
  ref: string | null;
  label: string;
  nature: BudgetNature;
  row: Record<string, unknown>;
};

type NormalizedVersionFields = {
  fields: Record<string, unknown>;
  displayValues: Record<string, string | null>;
  fieldLabels: Record<string, string>;
};

// Amounts are decimal strings ('1200', '99999999999999.99'): money never goes through a JS number here.
type AmountPayload =
  | {
    kind: 'annual';
    year: number;
    totals: Partial<Record<AmountMeasure, string>>;
    spread_profile_name?: string;
  }
  | {
    kind: 'quarterly';
    year: number;
    measure: AmountMeasure;
    Q1?: string;
    Q2?: string;
    Q3?: string;
    Q4?: string;
    spread_profile_name?: string;
  }
  | {
    kind: 'monthly';
    year: number;
    months: Array<{
      period: string;
      planned?: string;
      forecast?: string;
      committed?: string;
      actual?: string;
      expected_landing?: string;
    }>;
  };

type AllocationInput = {
  company_id: string;
  department_id: string | null;
  /** The percentage given, for the manual percentages method (`manual_pct`) only. */
  allocation_pct?: number;
};

const INPUT_GRAINS = ['annual', 'quarterly', 'monthly'] as const;
const ALLOCATION_METHODS = ['default', 'headcount', 'it_users', 'turnover', 'manual_company', 'manual_department', 'manual_pct'] as const;
const ALLOCATION_DRIVERS = ['headcount', 'it_users', 'turnover'] as const;
/** The methods whose split is the companies or departments picked by hand. */
const MANUAL_SELECTION_METHODS: ReadonlySet<string> = new Set(['manual_company', 'manual_department']);
/** Every method whose split is stored rows, which an automatic method drops. */
const MANUAL_METHODS: ReadonlySet<string> = new Set([...MANUAL_SELECTION_METHODS, 'manual_pct']);
/** The keys a model may give a percentage under. */
const PERCENT_KEYS = ['allocation_pct', 'pct', 'percentage', 'percent', 'share'] as const;

/** Where the shares of a method come from: its driver, or none (manual percentages, the tenant's default rule). */
function allocationBasis(method: string, driver: unknown): AllocationBasis | null {
  if (method === 'manual_department') return 'department_headcount';
  if (method === 'manual_company') return (ALLOCATION_DRIVERS as readonly unknown[]).includes(driver) ? driver as AllocationBasis : 'headcount';
  return (ALLOCATION_DRIVERS as readonly string[]).includes(method) ? method as AllocationBasis : null;
}

/** A percentage as a model may write it (60, "60", "60 %", "60,5"). */
export function percentValue(value: unknown, label: string): number {
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(/%/g, '').replace(',', '.').trim());
  if (!Number.isFinite(parsed)) throw new BadRequestException(`${label} must be a number.`);
  return parsed;
}

const VERSION_FIELD_CONFIG: Record<string, {
  label: string;
  kind: 'date' | 'enum' | 'integer' | 'text' | 'upper3';
  nullable?: boolean;
  enumValues?: readonly string[];
}> = {
  version_name: { label: 'Version Name', kind: 'text' },
  input_grain: { label: 'Input Grain', kind: 'enum', enumValues: INPUT_GRAINS },
  as_of_date: { label: 'As Of Date', kind: 'date' },
  budget_year: { label: 'Budget Year', kind: 'integer' },
  allocation_method: { label: 'Allocation Method', kind: 'enum', enumValues: ALLOCATION_METHODS },
  allocation_driver: { label: 'Allocation Driver', kind: 'enum', enumValues: ALLOCATION_DRIVERS },
  notes: { label: 'Notes', kind: 'text', nullable: true },
  reporting_currency: { label: 'Reporting Currency', kind: 'upper3' },
};

/** The right a financial plan write needs: `budget`, whatever the nature of the line (lot R). */
export function getAiFinancialPlanBusinessResource(entityType: unknown): string {
  requireFinancialEntityType(entityType);
  return 'budget';
}

function requireFinancialEntityType(value: unknown): AiFinancialPlanEntityType {
  const normalized = String(value || '').trim() as AiFinancialPlanEntityType;
  if (!AI_FINANCIAL_PLAN_ENTITY_TYPES.includes(normalized)) {
    throw new BadRequestException('Unsupported financial plan entity type.');
  }
  return normalized;
}

function requireFinancialAction(value: unknown): AiFinancialPlanAction {
  const normalized = String(value || '').trim() as AiFinancialPlanAction;
  if (!AI_FINANCIAL_PLAN_ACTIONS.includes(normalized)) {
    throw new BadRequestException('Unsupported financial plan action.');
  }
  return normalized;
}

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException(`${label} must be an object.`);
  }
  return { ...(value as Record<string, unknown>) };
}

function optionalObjectValue(value: unknown, label: string): Record<string, unknown> {
  if (value == null) return {};
  return objectValue(value, label);
}

function normalizeKey(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function normalizeComparable(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (Array.isArray(value) || typeof value === 'object') {
    return JSON.stringify(value ?? null);
  }
  return value;
}

function sameValue(left: unknown, right: unknown): boolean {
  return normalizeComparable(left) === normalizeComparable(right);
}

function toJsonValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value === undefined) return null;
  return value;
}

function formatValue(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** An amount read exactly (a number in its shortest form, or a decimal string), as a decimal string to the cent. */
function normalizeAmount(value: unknown, label: string): string {
  return formatCents(validateAmountValue(value, label));
}

function normalizeYear(value: unknown, label = 'year'): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1900 || parsed > 3000) {
    throw new BadRequestException(`${label} must be a valid year.`);
  }
  return parsed;
}

function normalizeDate(value: unknown, label: string): string {
  const text = String(value || '').trim();
  const parsed = new Date(text);
  if (!text || Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${label} must be a valid date.`);
  }
  return text;
}

function amountRowsSignature(rows: unknown[]): string {
  return JSON.stringify(
    rows
      .map((row: any) => ({
        period: String(row.period || ''),
        planned: String(row.planned ?? 0),
        forecast: String(row.forecast ?? 0),
        committed: String(row.committed ?? 0),
        actual: String(row.actual ?? 0),
        expected_landing: String(row.expected_landing ?? 0),
      }))
      .sort((a, b) => a.period.localeCompare(b.period)),
  );
}

function allocationSignature(payload: Record<string, unknown>): string {
  const items = Array.isArray(payload.items) ? payload.items : [];
  return JSON.stringify({
    resolved_method: payload.resolved_method ?? null,
    total_pct: payload.total_pct ?? null,
    items: items
      .map((row: any) => ({
        company_id: String(row.company_id || ''),
        department_id: row.department_id == null ? null : String(row.department_id),
        allocation_pct: String(row.allocation_pct ?? ''),
        source: row.source ?? null,
      }))
      .sort((a, b) => `${a.company_id}:${a.department_id ?? ''}`.localeCompare(`${b.company_id}:${b.department_id ?? ''}`)),
  });
}

function periodYear(period: unknown): number | null {
  const match = String(period || '').match(/^(\d{4})-\d{2}-\d{2}$/);
  return match ? Number(match[1]) : null;
}

function makeMonthlyPayloadFromRows(rows: unknown[], fallbackYear: number): AmountPayload {
  const months = (rows as any[])
    .map((row) => ({
      period: String(row.period || ''),
      planned: formatAmount(row.planned ?? 0),
      forecast: formatAmount(row.forecast ?? 0),
      committed: formatAmount(row.committed ?? 0),
      actual: formatAmount(row.actual ?? 0),
      expected_landing: formatAmount(row.expected_landing ?? 0),
    }))
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.period))
    .sort((a, b) => a.period.localeCompare(b.period));
  return {
    kind: 'monthly',
    year: months[0] ? periodYear(months[0].period) ?? fallbackYear : fallbackYear,
    months,
  };
}

function amountTouchedPeriods(payload: AmountPayload): string[] {
  if (payload.kind === 'monthly') {
    return Array.from(new Set(payload.months.map((row) => row.period))).sort();
  }
  return Array.from({ length: 12 }, (_, index) => `${payload.year}-${String(index + 1).padStart(2, '0')}-01`);
}

function completeAmountRowsForPeriods(rows: unknown[], periods: string[]): unknown[] {
  const rowByPeriod = new Map((rows as any[]).map((row) => [String(row.period || ''), row]));
  return periods.map((period) => {
    const row = rowByPeriod.get(period);
    return {
      period,
      planned: row?.planned ?? 0,
      forecast: row?.forecast ?? 0,
      committed: row?.committed ?? 0,
      actual: row?.actual ?? 0,
      expected_landing: row?.expected_landing ?? 0,
    };
  });
}

/**
 * How a column was entered before a write of amounts, kept on the card so that "Undo" enters it
 * again the same way: a spread (its period and its yearly total and profile, or its quarters), or a
 * column built from quantity and price (its lines stay on the column: the write keeps them as its
 * reference). A column typed month by month, copied or never entered has none: its months are typed
 * back.
 */
type ColumnInput = {
  measure: AmountMeasure;
  method: 'spread' | 'computed';
  period_start?: string;
  period_end?: string;
  total?: string;
  profile?: string;
  quarters?: Record<'Q1' | 'Q2' | 'Q3' | 'Q4', string>;
  distribution?: 'equal' | '445';
};

/** The columns a payload writes. */
function amountMeasures(payload: AmountPayload): AmountMeasure[] {
  if (payload.kind === 'annual') return AMOUNT_MEASURES.filter((measure) => payload.totals[measure] !== undefined);
  if (payload.kind === 'quarterly') return [payload.measure];
  return AMOUNT_MEASURES.filter((measure) => payload.months.some((row) => row[measure] !== undefined));
}

/**
 * The columns a payload writes, each with its total for the year once written (lot B12b, the
 * warning of a column left to check): a yearly or quarterly payload sets its columns' year, a
 * monthly one its months over the months stored (`beforeItems`, the year's rows as listed). A
 * monthly column whose cents do not change is not written as an amount (`recordPayloadRoundInputs`
 * keeps how it was entered): left out.
 */
export function columnsAfterWrite(raw: unknown, beforeItems: readonly unknown[] = []): ColumnAfterWrite[] {
  const payload = raw as AmountPayload;
  const cents = (value: unknown) => Math.round(Number(value ?? 0) * 100) || 0;
  const measures = amountMeasures(payload);
  if (payload.kind === 'annual') return measures.map((measure) => ({ year: payload.year, measure, total: cents(payload.totals[measure]) }));
  if (payload.kind === 'quarterly') {
    return [{ year: payload.year, measure: payload.measure, total: (['Q1', 'Q2', 'Q3', 'Q4'] as const).reduce((sum, q) => sum + cents(payload[q]), 0) }];
  }
  const months = new Map<string, Record<string, unknown>>();
  for (const row of beforeItems as Array<Record<string, unknown>>) months.set(String(row?.period ?? ''), { ...row });
  const changed = measures.filter((measure) => payload.months.some((row) => row[measure] !== undefined && cents(row[measure]) !== cents(months.get(row.period)?.[measure])));
  for (const row of payload.months) months.set(row.period, { ...(months.get(row.period) ?? {}), ...Object.fromEntries(measures.filter((m) => row[m] !== undefined).map((m) => [m, row[m]])) });
  return changed.map((measure) => ({
    year: payload.year,
    measure,
    total: [...months.entries()].filter(([period]) => periodYear(period) === payload.year).reduce((sum, [, row]) => sum + cents(row[measure]), 0),
  }));
}

/** How each column of `measures` is entered now (`ColumnInput`), from the version's records. */
function columnInputs(roundInputs: unknown, measures: readonly AmountMeasure[]): ColumnInput[] {
  const records = Array.isArray(roundInputs) ? roundInputs as any[] : [];
  const inputs: ColumnInput[] = [];
  for (const measure of measures) {
    const record = records.find((row) => row?.measure === measure);
    const calculation = record?.last_calculation;
    const period = { period_start: String(record?.period_start), period_end: String(record?.period_end) };
    if (record?.method === 'computed' && Array.isArray(record.lines) && record.lines.length > 0) {
      inputs.push({ measure, method: 'computed' });
    } else if (record?.method === 'spread' && calculation?.kind === 'annual') {
      inputs.push({ measure, method: 'spread', ...period, total: String(calculation.total), profile: String(calculation.profile) });
    } else if (record?.method === 'spread' && calculation?.kind === 'quarterly') {
      inputs.push({ measure, method: 'spread', ...period, quarters: calculation.quarters, distribution: calculation.distribution });
    }
  }
  return inputs;
}

/** The `ColumnInput`s a card holds; anything else is left to the months typed back. */
function storedColumnInputs(value: unknown): ColumnInput[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is ColumnInput => !!entry && typeof entry === 'object'
    && AMOUNT_MEASURES.includes(entry.measure) && (entry.method === 'spread' || entry.method === 'computed'));
}

function allocationInputsFromRows(rows: unknown[], method: string | null): AllocationInput[] {
  if (!method || !MANUAL_METHODS.has(method)) return [];
  return (rows as any[])
    .map((row) => ({
      company_id: String(row.company_id || ''),
      department_id: method === 'manual_department' ? textOrNull(row.department_id) : null,
      ...(method === 'manual_pct' ? { allocation_pct: Number(row.allocation_pct ?? 0) } : {}),
    }))
    .filter((row) => row.company_id && (method !== 'manual_department' || row.department_id));
}

@Injectable()
export class AiFinancialPlanMutationSupportService {
  constructor(
    private readonly capexAllocations: CapexAllocationsService,
    private readonly capexAmounts: CapexAmountsService,
    private readonly capexVersions: CapexVersionsService,
    private readonly spendAllocations: SpendAllocationsService,
    private readonly spendAmounts: SpendAmountsService,
    private readonly spendVersions: SpendVersionsService,
  ) {}

  getWritableFieldDescriptions(): string[] {
    return [
      'budget_lines action=create_version: fields version_name, input_grain, as_of_date, budget_year, allocation_method, allocation_driver, notes, reporting_currency',
      'budget_lines action=update_version: version_ref plus fields version_name, input_grain, as_of_date, allocation_method, allocation_driver, notes, reporting_currency; budget_year is immutable',
      'budget_lines action=upsert_amounts: version_ref plus amounts with kind annual, quarterly, or monthly',
      'budget_lines action=replace_allocations: version_ref plus allocations, read with the version\'s allocation_method: manual_company takes companies only (their shares follow allocation_driver), manual_department departments only (shares follow their headcount), manual_pct companies each with allocation_pct (summing to 100); automatic methods take an empty list. To split by given percentages, set allocation_method manual_pct with update_version first',
    ];
  }

  async prepareCreatePreview(
    context: AiExecutionContextWithManager,
    input: AiWriteFinancialPlanInput,
  ): Promise<AiPreparedMutationPreview> {
    const entityType = requireFinancialEntityType(input.entity_type);
    const action = requireFinancialAction(input.action);
    const item = await this.resolveItem(context, input.ref);

    if (action === 'create_version') {
      const normalized = this.normalizeVersionFields(input.fields, 'create');
      return {
        targetEntityType: entityType,
        targetEntityId: item.id,
        mutationInput: {
          action,
          entity_type: entityType,
          item_id: item.id,
          fields: normalized.fields,
          display_values: normalized.displayValues,
          field_labels: normalized.fieldLabels,
        },
        currentValues: {
          target_ref: item.ref,
          target_title: item.label,
          values: null,
          display_values: null,
        },
      };
    }

    const version = await this.resolveVersion(context, item, input.version_ref);
    if (action === 'update_version') {
      return this.withManualAllocationRemoval(context, version, this.prepareUpdateVersionPreview(item, version, input.fields, null));
    }
    if (action === 'upsert_amounts') {
      const amounts = this.normalizeAmountPayload(input.amounts);
      this.assertAmountsYearMatchesVersion(amounts, version);
      // An unknown spread profile is refused now, with the message the write would give.
      await assertSpreadProfile(context.manager, amounts.kind, 'spread_profile_name' in amounts ? amounts.spread_profile_name : undefined);
      const before = await this.listAmounts(context, item.nature, version.id, amounts.year);
      const columns = await readBudgetColumns(context.manager, context.tenantId);
      const beforeItems = Array.isArray(before.items) ? before.items : [];
      const reverseItems = completeAmountRowsForPeriods(beforeItems, amountTouchedPeriods(amounts));
      // Kad writes totals: on an account that expects quantity and price, the card warns (lot B12b).
      const warning = await amountsEntryCheckWarning(context.manager, context.tenantId,
        { nature: item.nature, accountId: item.row.account_id, endOfValidity: item.row.disabled_at as string | Date | null },
        columnsAfterWrite(amounts, beforeItems));
      return {
        targetEntityType: entityType,
        targetEntityId: item.id,
        mutationInput: {
          action,
          entity_type: entityType,
          item_id: item.id,
          version_id: version.id,
          version_ref: version.ref,
          version_title: version.label,
          amounts,
        },
        currentValues: {
          target_ref: item.ref,
          target_title: `${item.label} / ${version.label}`,
          values: {
            year: amounts.year,
            items: reverseItems,
            totals: before.totals,
            signature: amountRowsSignature(beforeItems),
            inputs: columnInputs(before.round_inputs, amountMeasures(amounts)),
          },
          display_values: {
            from: this.formatAmountSummary(before, columns),
            to: this.formatAmountPayload(amounts, columns),
            from_amounts: this.previewTotals(before, columns, item.row.currency),
            to_amounts: this.previewPayload(amounts, columns, item.row.currency),
          },
          ...(warning ? { [ENTRY_CHECK_STORE_KEY]: warning } : {}),
        },
      };
    }
    if (action === 'replace_allocations') {
      const before = await this.listAllocations(context, item.nature, version.id);
      const method = String(version.row.allocation_method || 'default');
      const allocations = await this.normalizeAllocations(context, input.allocations ?? [], method, version.row.allocation_driver);
      const beforeItems = Array.isArray(before.items) ? before.items as Array<Record<string, unknown>> : [];
      const fromSplit = beforeItems.length === 0
        ? { kind: 'none' as const }
        : await this.splitView(context, beforeItems, allocationBasis(String(before.method ?? method), before.driver));
      // The shares the approval stores, computed as the save computes them (the driver's, or the percentages given).
      const planned = allocations.length === 0 ? null : await this.planAllocations(context, item.nature, version.id, allocations);
      const toSplit = planned ? await this.splitView(context, planned, allocationBasis(method, version.row.allocation_driver)) : { kind: 'automatic' as const };
      return {
        targetEntityType: entityType,
        targetEntityId: item.id,
        mutationInput: {
          action,
          entity_type: entityType,
          item_id: item.id,
          version_id: version.id,
          version_ref: version.ref,
          version_title: version.label,
          allocations,
        },
        currentValues: {
          target_ref: item.ref,
          target_title: `${item.label} / ${version.label}`,
          values: {
            allocation_method: version.row.allocation_method ?? null,
            ...before,
            signature: allocationSignature(before),
          },
          // The split before and after, by name (`splitView`), written in the person's language when shown.
          display_values: { from_split: fromSplit, to_split: toSplit, from: allocationSplitText('en', fromSplit), to: allocationSplitText('en', toSplit) },
        },
      };
    }

    throw new BadRequestException('Unsupported financial plan action.');
  }

  async prepareReversePreview(
    context: AiExecutionContextWithManager,
    preview: AiMutationPreview,
  ): Promise<AiPreparedMutationPreview> {
    const mutation = preview.mutation_input ?? {};
    const action = requireFinancialAction(mutation.action);
    const entityType = requireFinancialEntityType(preview.target_entity_type || mutation.entity_type);
    const itemId = textOrNull(mutation.item_id) || preview.target_entity_id;
    if (!itemId) throw new BadRequestException('Original preview is missing the financial item.');
    const item = await this.resolveItemById(context, itemId);

    if (action === 'create_version') {
      throw new BadRequestException('Undo is not supported for created financial versions.');
    }
    if (action === 'update_version') {
      const versionId = textOrNull(mutation.version_id);
      if (!versionId) throw new BadRequestException('Original preview is missing the financial version.');
      const version = await this.resolveVersionById(context, item, versionId);
      const previousValues = objectValue(preview.current_values?.values, 'current_values.values');
      return this.withManualAllocationRemoval(context, version, this.prepareUpdateVersionPreview(item, version, previousValues, preview.id));
    }
    if (action === 'upsert_amounts') {
      const versionId = textOrNull(mutation.version_id);
      if (!versionId) throw new BadRequestException('Original preview is missing the financial version.');
      const version = await this.resolveVersionById(context, item, versionId);
      const previousValues = objectValue(preview.current_values?.values, 'current_values.values');
      const previousRows = Array.isArray(previousValues.items) ? previousValues.items : [];
      const year = normalizeYear(previousValues.year ?? version.row.budget_year, 'year');
      const prepared = await this.prepareCreatePreview(context, {
        entity_type: entityType,
        ref: item.id,
        action: 'upsert_amounts',
        version_ref: version.id,
        amounts: makeMonthlyPayloadFromRows(previousRows, year),
      });
      // The months as they were, and how their columns were entered (`ColumnInput`).
      const inputs = storedColumnInputs(previousValues.inputs);
      if (inputs.length === 0) return prepared;
      // A column entered again as quantity × price is not left to check: the warning reads the others.
      const rebuilt = new Set(inputs.filter((input) => input.method === 'computed').map((input) => input.measure));
      let currentValues = prepared.currentValues;
      if (rebuilt.size > 0 && currentValues?.[ENTRY_CHECK_STORE_KEY]) {
        const { [ENTRY_CHECK_STORE_KEY]: _warned, ...rest } = currentValues;
        // The months stored now, as the first evaluation read them (`values.items`).
        const storedItems = (currentValues.values as { items?: unknown } | undefined)?.items;
        const storedNow = Array.isArray(storedItems) ? storedItems : [];
        const warning = await amountsEntryCheckWarning(context.manager, context.tenantId,
          { nature: item.nature, accountId: item.row.account_id, endOfValidity: item.row.disabled_at as string | Date | null },
          columnsAfterWrite(prepared.mutationInput.amounts, storedNow).filter((column) => !rebuilt.has(column.measure)));
        currentValues = { ...rest, ...(warning ? { [ENTRY_CHECK_STORE_KEY]: warning } : {}) };
      }
      return { ...prepared, currentValues, mutationInput: { ...prepared.mutationInput, restore_inputs: inputs } };
    }
    if (action === 'replace_allocations') {
      const versionId = textOrNull(mutation.version_id);
      if (!versionId) throw new BadRequestException('Original preview is missing the financial version.');
      const version = await this.resolveVersionById(context, item, versionId);
      const previousValues = objectValue(preview.current_values?.values, 'current_values.values');
      const method = textOrNull(previousValues.allocation_method);
      const previousRows = Array.isArray(previousValues.items) ? previousValues.items : [];
      return this.prepareCreatePreview(context, {
        entity_type: entityType,
        ref: item.id,
        action: 'replace_allocations',
        version_ref: version.id,
        allocations: allocationInputsFromRows(previousRows, method),
      });
    }

    throw new BadRequestException('Unsupported financial plan action.');
  }

  presentPreview(preview: AiMutationPreview, language: AiWriteLanguage = 'en'): AiMutationPreviewPresentation {
    const entityType = requireFinancialEntityType(preview.target_entity_type || preview.mutation_input?.entity_type);
    const action = requireFinancialAction(preview.mutation_input?.action);
    const mutation = preview.mutation_input ?? {};
    const current = preview.current_values ?? {};
    const title = textOrNull(current.target_title) || textOrNull(mutation.version_title) || 'Financial plan';
    const changes: Record<string, AiMutationPreviewChangeDto> = {};
    const removedAllocation = action === 'update_version' && Array.isArray(mutation.removes_manual_allocation)
      ? mutation.removes_manual_allocation.map(String)
      : [];

    if (action === 'create_version' || action === 'update_version') {
      const fields = objectValue(mutation.fields, 'mutation_input.fields');
      const displayValues = optionalObjectValue(mutation.display_values, 'mutation_input.display_values');
      const fieldLabels = optionalObjectValue(mutation.field_labels, 'mutation_input.field_labels');
      const previous = current.values && typeof current.values === 'object' ? current.values as Record<string, unknown> : {};
      for (const fieldName of Object.keys(fields)) {
        changes[fieldName] = {
          label: String(fieldLabels[fieldName] || fieldName),
          from: action === 'create_version' ? null : formatValue(previous[fieldName]),
          to: formatValue(displayValues[fieldName] ?? fields[fieldName]),
          format: 'text',
        };
      }
      // An automatic method drops the stored manual split: the card says so (`removed`, a code the card translates).
      if (removedAllocation.length > 0) {
        changes.allocations = { label: 'Allocations', from: removedAllocation.join(', '), to: 'removed', format: 'text' };
      }
    } else if (action === 'upsert_amounts') {
      const display = current.display_values && typeof current.display_values === 'object' ? current.display_values as Record<string, unknown> : {};
      const fromAmounts = storedPreviewAmounts(display.from_amounts);
      const toAmounts = storedPreviewAmounts(display.to_amounts);
      changes.amounts = {
        label: 'Amounts',
        from: formatValue(display.from),
        to: formatValue(display.to),
        format: 'text',
        ...(toAmounts ? { amounts: { from: fromAmounts, to: toAmounts } } : {}),
      };
      Object.assign(changes, entryCheckWarningChange(current, preview.status, language));
    } else if (action === 'replace_allocations') {
      const display = current.display_values && typeof current.display_values === 'object' ? current.display_values as Record<string, unknown> : {};
      // A card stored before the split was kept by name shows its texts as they were.
      const side = (split: unknown, text: unknown) => (split && typeof split === 'object' ? allocationSplitText(language, split as AllocationSplitView) : formatValue(text));
      changes.allocations = {
        label: 'Allocations',
        from: side(display.from_split, display.from),
        to: side(display.to_split, display.to),
        format: 'text',
      };
    }

    let summary = `Preview ${preview.id} ${preview.status}.`;
    if (preview.status === 'pending') {
      summary = this.pendingSummary(action, title);
    } else if (preview.status === 'executed') {
      summary = this.executedSummary(action, title);
    } else if (preview.status === 'failed') {
      summary = preview.error_message || `Financial plan preview for "${title}" failed.`;
    } else if (preview.status === 'rejected') {
      summary = `Financial plan preview for "${title}" was rejected.`;
    } else if (preview.status === 'expired') {
      summary = `Financial plan preview for "${title}" expired before approval.`;
    }

    if (language !== 'en') {
      summary = previewSummaryText(language, preview.status, writeActionText.writeFinancialPlan(language, action, quoted(language, title)), {
        errorMessage: preview.error_message,
      });
    }
    if (preview.status === 'pending' && removedAllocation.length > 0) summary = `${summary} ${manualAllocationRemovedText(language)}`;

    return {
      target: {
        entity_type: entityType,
        entity_id: preview.target_entity_id ?? null,
        ref: textOrNull(current.target_ref),
        title,
      },
      changes,
      summary,
    };
  }

  async executePreview(context: AiExecutionContextWithManager, preview: AiMutationPreview): Promise<void> {
    const entityType = requireFinancialEntityType(preview.target_entity_type || preview.mutation_input?.entity_type);
    const action = requireFinancialAction(preview.mutation_input?.action);
    const mutation = preview.mutation_input ?? {};
    const itemId = textOrNull(mutation.item_id) || preview.target_entity_id;
    if (!itemId) throw new BadRequestException('Preview is missing the financial item.');
    const item = await this.resolveItemById(context, itemId);
    // Lock order (`spend/budget-locks.ts`): the line, then the version, before what the preview
    // saw is compared with what is stored, so nothing changes between the check and the write.
    const scope = item.nature;
    if (!(await lockBudgetLine(context.manager, scope, context.tenantId, item.id))) {
      throw new NotFoundException(`${this.itemLabelSingular()} not found.`);
    }
    // The services write the audit rows the screen writes for the same gesture, attributed to the
    // card (lot K2a): Kad adds none of its own.
    const audit = buildAiMutationAudit(preview);

    if (action === 'create_version') {
      const fields = objectValue(mutation.fields, 'mutation_input.fields');
      const saved = await this.createVersion(context, item.nature, item.id, fields, audit);
      const version = await this.resolveVersionById(context, item, String((saved as any).id));
      preview.mutation_input = {
        ...mutation,
        version_id: version.id,
        version_ref: version.ref,
        version_title: version.label,
      };
      return;
    }

    const versionId = textOrNull(mutation.version_id);
    if (!versionId) throw new BadRequestException('Preview is missing the financial version.');
    await lockBudgetVersions(context.manager, scope, context.tenantId, [versionId]);
    const version = await this.resolveVersionById(context, item, versionId);

    if (action === 'update_version') {
      const fields = objectValue(mutation.fields, 'mutation_input.fields');
      const previous = objectValue(preview.current_values?.values, 'current_values.values');
      this.assertVersionFieldsUnchanged(version.row, previous);
      await this.updateVersion(context, item.nature, item.id, version, fields, audit);
      return;
    }

    if (action === 'upsert_amounts') {
      const amounts = this.normalizeAmountPayload(mutation.amounts);
      this.assertAmountsYearMatchesVersion(amounts, version);
      const previous = objectValue(preview.current_values?.values, 'current_values.values');
      const before = await this.listAmounts(context, item.nature, version.id, amounts.year);
      const beforeItems = Array.isArray(before.items) ? before.items : [];
      if (amountRowsSignature(beforeItems) !== String(previous.signature || '')) {
        throw new ConflictException('Financial amounts changed after the preview was created.');
      }
      const inputs = storedColumnInputs(mutation.restore_inputs);
      if (inputs.length > 0) await this.enterColumnsAgain(context, item.nature, version.id, amounts, inputs, audit);
      else await this.upsertAmounts(context, item.nature, version.id, amounts, audit);
      return;
    }

    if (action === 'replace_allocations') {
      const allocations = this.normalizeStoredAllocations(mutation.allocations);
      const previous = objectValue(preview.current_values?.values, 'current_values.values');
      const before = await this.listAllocations(context, item.nature, version.id);
      if (allocationSignature(before) !== String(previous.signature || '')) {
        throw new ConflictException('Financial allocations changed after the preview was created.');
      }
      await this.replaceAllocations(context, item.nature, version.id, allocations, audit);
      return;
    }

    throw new BadRequestException('Unsupported financial plan action.');
  }

  /**
   * The amounts a new line is created with (issue 127: one preview, one approval for a line and its
   * amount). Checked as `upsert_amounts` checks them, before the line exists: the payload, the
   * spread profile. Nothing is read from the line.
   */
  async prepareNewLineAmounts(
    context: AiExecutionContextWithManager,
    raw: unknown,
    currency: unknown,
  ): Promise<AiNewLineAmounts> {
    const amounts = this.normalizeAmountPayload(raw);
    await assertSpreadProfile(context.manager, amounts.kind, 'spread_profile_name' in amounts ? amounts.spread_profile_name : undefined);
    const columns = await readBudgetColumns(context.manager, context.tenantId);
    return {
      amounts: amounts as unknown as Record<string, unknown>,
      display: this.formatAmountPayload(amounts, columns),
      preview: this.previewPayload(amounts, columns, currency),
    };
  }

  /**
   * Writes the amounts of a line the same preview has just created: its budget version for the
   * amounts' year, named as the budget tab names it (`Y2026`), then the amounts. Same services,
   * locks and audit rows as `create_version` then `upsert_amounts` (the budget tab's, attributed to
   * the card); same transaction as the line, so a refusal leaves nothing behind.
   */
  async writeNewLineAmounts(
    context: AiExecutionContextWithManager,
    preview: AiMutationPreview,
    itemId: string,
    raw: unknown,
  ): Promise<void> {
    const amounts = this.normalizeAmountPayload(raw);
    const item = await this.resolveItemById(context, itemId);
    const scope = item.nature;
    if (!(await lockBudgetLine(context.manager, scope, context.tenantId, item.id))) {
      throw new NotFoundException(`${this.itemLabelSingular()} not found.`);
    }
    const audit = buildAiMutationAudit(preview);
    const saved = await this.createVersion(context, item.nature, item.id, {
      version_name: `Y${amounts.year}`,
      budget_year: amounts.year,
      as_of_date: `${amounts.year}-01-01`,
      input_grain: amounts.kind,
    }, audit);
    const version = await this.resolveVersionById(context, item, String((saved as any).id));
    await lockBudgetVersions(context.manager, scope, context.tenantId, [version.id]);
    await this.upsertAmounts(context, item.nature, version.id, amounts, audit);
  }

  private pendingSummary(action: AiFinancialPlanAction, title: string): string {
    switch (action) {
      case 'create_version': return `Create financial version for "${title}".`;
      case 'update_version': return `Update financial version "${title}".`;
      case 'upsert_amounts': return `Update financial amounts for "${title}".`;
      case 'replace_allocations': return `Replace financial allocations for "${title}".`;
    }
  }

  private executedSummary(action: AiFinancialPlanAction, title: string): string {
    switch (action) {
      case 'create_version': return `Created financial version for "${title}".`;
      case 'update_version': return `Updated financial version "${title}".`;
      case 'upsert_amounts': return `Updated financial amounts for "${title}".`;
      case 'replace_allocations': return `Replaced financial allocations for "${title}".`;
    }
  }

  /**
   * A version leaving a manual split for an automatic method: its approval drops the stored rows (the
   * Allocations tab's save), so the card names them (company, or company / department) and says that
   * no other step is needed.
   */
  private async withManualAllocationRemoval(
    context: AiExecutionContextWithManager,
    version: FinancialVersionRef,
    prepared: AiPreparedMutationPreview,
  ): Promise<AiPreparedMutationPreview> {
    const fields = (prepared.mutationInput.fields ?? {}) as Record<string, unknown>;
    const nextMethod = fields.allocation_method;
    if (typeof nextMethod !== 'string' || MANUAL_METHODS.has(nextMethod)) return prepared;
    if (!MANUAL_METHODS.has(String(version.row.allocation_method || 'default'))) return prepared;
    const rows: Array<Record<string, unknown>> = await context.manager.query(
      `SELECT company_id, department_id FROM spend_allocations WHERE tenant_id = $1 AND version_id = $2 AND NOT is_system_generated`,
      [context.tenantId, version.id],
    );
    if (rows.length === 0) return prepared;
    const split = await this.splitView(context, rows, null);
    const labels = split.kind === 'rows' ? split.rows.map((row) => row.label) : [];
    return { ...prepared, mutationInput: { ...prepared.mutationInput, removes_manual_allocation: labels } };
  }

  private prepareUpdateVersionPreview(
    item: FinancialItemRef,
    version: FinancialVersionRef,
    rawFields: unknown,
    sourcePreviewId: string | null,
  ): AiPreparedMutationPreview {
    const normalized = this.normalizeVersionFields(rawFields, 'update');
    const previousValues: Record<string, unknown> = {};
    const nextFields: Record<string, unknown> = {};
    const nextDisplayValues: Record<string, string | null> = {};
    const fieldLabels: Record<string, string> = {};
    for (const fieldName of Object.keys(normalized.fields)) {
      const currentValue = toJsonValue(version.row[fieldName]);
      const nextValue = normalized.fields[fieldName];
      if (sameValue(currentValue, nextValue)) continue;
      previousValues[fieldName] = currentValue;
      nextFields[fieldName] = nextValue;
      nextDisplayValues[fieldName] = normalized.displayValues[fieldName];
      fieldLabels[fieldName] = normalized.fieldLabels[fieldName];
    }
    if (Object.keys(nextFields).length === 0) {
      throw new BadRequestException('Financial version already has the requested values.');
    }
    // As on the Allocations tab: a driver is chosen for the manual split by company; every other
    // method has its own, which the save stores whatever is sent.
    if (nextFields.allocation_driver !== undefined) {
      const method = String(nextFields.allocation_method ?? version.row.allocation_method ?? 'default');
      if (method !== 'manual_company' && nextFields.allocation_driver !== defaultAllocationDriver(method)) {
        throw new BadRequestException(`Allocation Driver applies to the manual_company method only; ${method} uses ${defaultAllocationDriver(method)}.`);
      }
    }
    return {
      targetEntityType: 'budget_lines',
      targetEntityId: item.id,
      mutationInput: {
        action: 'update_version',
        entity_type: 'budget_lines',
        item_id: item.id,
        version_id: version.id,
        version_ref: version.ref,
        version_title: version.label,
        fields: nextFields,
        display_values: nextDisplayValues,
        field_labels: fieldLabels,
        source_preview_id: sourcePreviewId,
      },
      currentValues: {
        target_ref: item.ref,
        target_title: `${item.label} / ${version.label}`,
        values: previousValues,
        display_values: previousValues,
      },
    };
  }

  private normalizeVersionFields(rawFields: unknown, mode: 'create' | 'update'): NormalizedVersionFields {
    const input = optionalObjectValue(rawFields, 'fields');
    const fields: Record<string, unknown> = {};
    const displayValues: Record<string, string | null> = {};
    const fieldLabels: Record<string, string> = {};
    for (const [rawName, rawValue] of Object.entries(input)) {
      if (rawValue === undefined) continue;
      const fieldName = normalizeKey(rawName);
      const config = VERSION_FIELD_CONFIG[fieldName];
      if (!config) {
        throw new BadRequestException(`${rawName} is not writable for financial versions. Writable fields: ${Object.keys(VERSION_FIELD_CONFIG).join(', ')}.`);
      }
      if (fieldName === 'budget_year' && mode === 'update') {
        throw new BadRequestException('budget_year is immutable for financial versions.');
      }
      const empty = rawValue == null || (typeof rawValue === 'string' && rawValue.trim() === '');
      if (empty) {
        if (!config.nullable) throw new BadRequestException(`${config.label} cannot be empty.`);
        fields[fieldName] = null;
        displayValues[fieldName] = null;
        fieldLabels[fieldName] = config.label;
        continue;
      }
      let value: unknown;
      if (config.kind === 'integer') {
        value = normalizeYear(rawValue, config.label);
      } else if (config.kind === 'date') {
        value = normalizeDate(rawValue, config.label);
      } else if (config.kind === 'enum') {
        const normalized = String(rawValue).trim().toLowerCase();
        if (!(config.enumValues || []).includes(normalized)) {
          throw new BadRequestException(`${config.label} must be one of ${(config.enumValues || []).join(', ')}.`);
        }
        value = normalized;
      } else if (config.kind === 'upper3') {
        const normalized = String(rawValue).trim().toUpperCase();
        if (!/^[A-Z]{3}$/.test(normalized)) throw new BadRequestException(`${config.label} must be a 3-letter currency code.`);
        value = normalized;
      } else {
        value = String(rawValue).trim();
      }
      fields[fieldName] = value;
      displayValues[fieldName] = formatValue(value);
      fieldLabels[fieldName] = config.label;
    }
    if (Object.keys(fields).length === 0) {
      throw new BadRequestException('At least one financial version field is required.');
    }
    if (mode === 'create' && !textOrNull(fields.version_name)) {
      throw new BadRequestException('Version Name is required for financial version creation.');
    }
    return { fields, displayValues, fieldLabels };
  }

  // A version holds one budget year: amounts for another year are refused at
  // preview time rather than after approval.
  private assertAmountsYearMatchesVersion(amounts: AmountPayload, version: FinancialVersionRef) {
    const versionYear = Number(version.row.budget_year);
    if (amounts.year !== versionYear) {
      throw new BadRequestException(
        `The amounts are for ${amounts.year}, but financial version "${version.label}" is for ${versionYear}. `
        + `Use amounts.year ${versionYear}, or the version of ${amounts.year}.`,
      );
    }
  }

  private normalizeAmountPayload(raw: unknown): AmountPayload {
    const input = objectValue(raw, 'amounts');
    const kind = String(input.kind || '').trim().toLowerCase();
    const year = normalizeYear(input.year, 'amounts.year');
    if (kind === 'annual') {
      const totalsInput = objectValue(input.totals, 'amounts.totals');
      const totals: Partial<Record<AmountMeasure, string>> = {};
      for (const measure of AMOUNT_MEASURES) {
        if (!Object.prototype.hasOwnProperty.call(totalsInput, measure) || totalsInput[measure] == null) continue;
        totals[measure] = normalizeAmount(totalsInput[measure], `amounts.totals.${measure}`);
      }
      if (Object.keys(totals).length === 0) throw new BadRequestException('amounts.totals must include at least one amount measure.');
      const payload: AmountPayload = { kind: 'annual', year, totals };
      if (input.spread_profile_name != null) payload.spread_profile_name = String(input.spread_profile_name);
      return payload;
    }
    if (kind === 'quarterly') {
      const measure = String(input.measure || '').trim().toLowerCase() as AmountMeasure;
      if (!AMOUNT_MEASURES.includes(measure)) {
        throw new BadRequestException(`amounts.measure must be one of ${AMOUNT_MEASURES.join(', ')}.`);
      }
      const payload: AmountPayload = { kind: 'quarterly', year, measure };
      let quarterCount = 0;
      for (const quarter of ['Q1', 'Q2', 'Q3', 'Q4'] as const) {
        if (!Object.prototype.hasOwnProperty.call(input, quarter) || input[quarter] == null) continue;
        payload[quarter] = normalizeAmount(input[quarter], `amounts.${quarter}`);
        quarterCount += 1;
      }
      if (quarterCount === 0) throw new BadRequestException('Quarterly amounts must include at least one quarter value.');
      if (input.spread_profile_name != null) payload.spread_profile_name = String(input.spread_profile_name);
      return payload;
    }
    if (kind === 'monthly') {
      const monthsInput = input.months;
      if (!Array.isArray(monthsInput) || monthsInput.length === 0) {
        throw new BadRequestException('amounts.months must contain at least one month.');
      }
      const months = monthsInput.map((entry, index) => {
        const row = objectValue(entry, `amounts.months[${index}]`);
        const period = normalizeDate(row.period, `amounts.months[${index}].period`);
        if (!/^\d{4}-\d{2}-01$/.test(period)) {
          throw new BadRequestException(`amounts.months[${index}].period must use YYYY-MM-01 format.`);
        }
        const rowYear = periodYear(period);
        if (rowYear !== year) throw new BadRequestException(`amounts.months[${index}].period must be in ${year}.`);
        const normalized: {
          period: string;
          planned?: string;
          forecast?: string;
          committed?: string;
          actual?: string;
          expected_landing?: string;
        } = { period };
        let amountCount = 0;
        for (const measure of AMOUNT_MEASURES) {
          if (!Object.prototype.hasOwnProperty.call(row, measure) || row[measure] == null) continue;
          normalized[measure] = normalizeAmount(row[measure], `amounts.months[${index}].${measure}`);
          amountCount += 1;
        }
        if (amountCount === 0) throw new BadRequestException(`amounts.months[${index}] must include at least one amount measure.`);
        return normalized;
      });
      return { kind: 'monthly', year, months };
    }
    throw new BadRequestException('amounts.kind must be annual, quarterly, or monthly.');
  }

  private normalizeStoredAllocations(value: unknown): AllocationInput[] {
    if (!Array.isArray(value)) throw new BadRequestException('mutation_input.allocations must be an array.');
    return value.map((entry, index) => {
      const row = objectValue(entry, `mutation_input.allocations[${index}]`);
      const companyId = textOrNull(row.company_id);
      if (!companyId) throw new BadRequestException(`mutation_input.allocations[${index}].company_id is required.`);
      const pct = row.allocation_pct == null ? NaN : Number(row.allocation_pct);
      return {
        company_id: companyId,
        department_id: textOrNull(row.department_id),
        ...(Number.isFinite(pct) ? { allocation_pct: pct } : {}),
      };
    });
  }

  private async normalizeAllocations(
    context: AiExecutionContextWithManager,
    raw: unknown,
    method: string,
    driver: unknown,
  ): Promise<AllocationInput[]> {
    if (!Array.isArray(raw)) throw new BadRequestException('allocations must be an array.');
    const isManualCompany = method === 'manual_company';
    const isManualDepartment = method === 'manual_department';
    const isManualPct = method === 'manual_pct';
    if (!isManualCompany && !isManualDepartment && !isManualPct) {
      if (raw.length > 0) {
        throw new BadRequestException('Automatic allocation methods require an empty allocations array.');
      }
      return [];
    }

    const normalized: AllocationInput[] = [];
    for (let index = 0; index < raw.length; index += 1) {
      const entry = raw[index];
      const row = typeof entry === 'string' ? { ref: entry } : objectValue(entry, `allocations[${index}]`);
      const pctKey = PERCENT_KEYS.find((key) => row[key] != null && row[key] !== '');
      if (isManualPct) {
        const companyRef = textOrNull(row.company_id) || textOrNull(row.company_ref) || textOrNull(row.company) || textOrNull(row.ref);
        if (!companyRef) throw new BadRequestException(`allocations[${index}] must identify a company.`);
        if (!pctKey) {
          throw new BadRequestException(`allocations[${index}] must give allocation_pct: the manual_pct method stores the percentages given, which must sum to 100.`);
        }
        const company = await this.resolveCompany(context, companyRef);
        normalized.push({ company_id: company.id, department_id: null, allocation_pct: percentValue(row[pctKey], `allocations[${index}].${pctKey}`) });
        continue;
      }
      // The shares of a split by company or by department are computed: a percentage would be dropped.
      if (pctKey) {
        throw new BadRequestException(isManualCompany
          ? `The manual_company method computes each company's share: its shares follow the driver (${allocationBasis(method, driver)}), so ${pctKey} cannot be set. `
            + 'Send the companies without allocation_pct, or set allocation_method to manual_pct with update_version to give the percentages yourself.'
          : 'The manual_department method computes each department\'s share: its shares follow the departments\' headcount, so '
            + `${pctKey} cannot be set. Send the departments without allocation_pct, or set allocation_method to manual_pct with update_version to give percentages by company.`);
      }
      if (isManualCompany) {
        const companyRef = textOrNull(row.company_id) || textOrNull(row.company_ref) || textOrNull(row.company) || textOrNull(row.ref);
        if (!companyRef) throw new BadRequestException(`allocations[${index}] must identify a company.`);
        const company = await this.resolveCompany(context, companyRef);
        normalized.push({ company_id: company.id, department_id: null });
        continue;
      }
      const departmentRef = textOrNull(row.department_id) || textOrNull(row.department_ref) || textOrNull(row.department) || textOrNull(row.ref);
      if (!departmentRef) throw new BadRequestException(`allocations[${index}] must identify a department.`);
      const companyRef = textOrNull(row.company_id) || textOrNull(row.company_ref) || textOrNull(row.company);
      const company = companyRef ? await this.resolveCompany(context, companyRef) : null;
      const department = await this.resolveDepartment(context, departmentRef, company?.id ?? null);
      if (company && department.company_id !== company.id) {
        throw new BadRequestException(`Department "${department.label}" does not belong to company "${company.label}".`);
      }
      normalized.push({ company_id: department.company_id, department_id: department.id });
    }
    if (normalized.length === 0) {
      throw new BadRequestException(
        'Manual allocation methods require at least one allocation entry. To remove a manual allocation, set the version to an '
        + 'automatic allocation method with update_version (allocation_method default, headcount, it_users or turnover): '
        + 'that removes the stored manual rows, and no other step is needed.',
      );
    }
    // Percentages are kept as given: a company named twice gets them added, as on the Allocations tab.
    if (isManualPct) return normalized;
    return Array.from(
      new Map(normalized.map((item) => [`${item.company_id}:${item.department_id ?? ''}`, item])).values(),
    );
  }

  private assertVersionFieldsUnchanged(live: Record<string, unknown>, expected: Record<string, unknown>): void {
    for (const [fieldName, expectedValue] of Object.entries(expected)) {
      if (!sameValue(live[fieldName], expectedValue)) {
        const label = VERSION_FIELD_CONFIG[fieldName]?.label ?? fieldName;
        throw new ConflictException(`${label} changed after the preview was created.`);
      }
    }
  }

  private async resolveItem(
    context: AiExecutionContextWithManager,
    ref: unknown,
  ): Promise<FinancialItemRef> {
    const normalized = textOrNull(ref);
    if (!normalized) throw new BadRequestException('Budget line reference is required.');
    if (isUuid(normalized)) return this.resolveItemById(context, normalized);
    // A line of either nature is one family: its title is `product_name`, its reference `BL-n` or
    // a bare number, and the legacy `OPX-n` / `CPX-n` the screens showed before.
    const number = budgetLineReferenceNumbers(normalized);
    const rows = await context.manager.query(
      `
      SELECT *
      FROM spend_items
      WHERE tenant_id = $1 AND nature IN ('opex', 'capex')
        AND (LOWER(product_name) = LOWER($2::text) OR item_number = $3 OR legacy_number = $4::text)
      ORDER BY (LOWER(product_name) = LOWER($2::text)) DESC, product_name
      LIMIT 6
      `,
      [context.tenantId, normalized, number.itemNumber, number.legacyNumber],
    );
    if (rows.length === 0) throw new NotFoundException(`No budget lines found matching "${normalized}".`);
    // A reference names one line; a title several when lines share it.
    const exact = rows.filter((row: Record<string, unknown>) => String(row.product_name ?? '').toLowerCase() === normalized.toLowerCase());
    const matches = exact.length > 0 ? exact : rows;
    if (matches.length > 1) throw new BadRequestException(`Multiple budget lines matched "${normalized}". Use a UUID.`);
    return this.itemRef(matches[0]);
  }

  private async resolveItemById(
    context: AiExecutionContextWithManager,
    id: string,
  ): Promise<FinancialItemRef> {
    const rows = await context.manager.query(
      `SELECT * FROM spend_items WHERE tenant_id = $1 AND id = $2 AND nature IN ('opex', 'capex') LIMIT 1`,
      [context.tenantId, id],
    );
    if (!rows[0]) throw new NotFoundException('Budget line not found.');
    return this.itemRef(rows[0]);
  }

  private itemRef(row: Record<string, unknown>): FinancialItemRef {
    const id = String(row.id || '');
    const nature: BudgetNature = row.nature === 'capex' ? 'capex' : 'opex';
    const label = textOrNull(row.product_name) || 'Untitled budget line';
    const ref = row.item_number == null ? null : `${BUDGET_LINE_PREFIX}-${row.item_number}`;
    return { id, ref, label, nature, row };
  }

  private async resolveVersion(
    context: AiExecutionContextWithManager,
    item: FinancialItemRef,
    ref: unknown,
  ): Promise<FinancialVersionRef> {
    const normalized = textOrNull(ref);
    if (!normalized) throw new BadRequestException('version_ref is required for this financial plan action.');
    if (isUuid(normalized)) return this.resolveVersionById(context, item, normalized);
    // The versions of a line resolved with its nature (`resolveItemById`): no predicate of their own.
    const numericYear = Number(normalized);
    const rows = await context.manager.query(
      `
      SELECT *
      FROM spend_versions
      WHERE tenant_id = $1
        AND spend_item_id = $2
        AND (LOWER(version_name) = LOWER($3) OR budget_year = $4)
      ORDER BY created_at DESC
      LIMIT 6
      `,
      [context.tenantId, item.id, normalized, Number.isInteger(numericYear) ? numericYear : -1],
    );
    if (rows.length === 0) throw new NotFoundException(`Financial version "${normalized}" not found.`);
    if (rows.length > 1) throw new BadRequestException(`Multiple financial versions matched "${normalized}". Use a UUID.`);
    return this.versionRef(item.nature, rows[0]);
  }

  private async resolveVersionById(
    context: AiExecutionContextWithManager,
    item: FinancialItemRef,
    id: string,
  ): Promise<FinancialVersionRef> {
    const rows = await context.manager.query(
      `SELECT * FROM spend_versions WHERE tenant_id = $1 AND spend_item_id = $2 AND id = $3 LIMIT 1`,
      [context.tenantId, item.id, id],
    );
    if (!rows[0]) throw new NotFoundException('Financial version not found.');
    return this.versionRef(item.nature, rows[0]);
  }

  /** A version row as its nature's API names its line (`capex_item_id` for a CAPEX line): what its audit rows record. */
  private versionRef(nature: BudgetNature, stored: Record<string, unknown>): FinancialVersionRef {
    const row: Record<string, unknown> = presentChild(nature, stored);
    const id = String(row.id || '');
    const ref = textOrNull(row.version_name) || textOrNull(row.budget_year) || id;
    const year = row.budget_year == null ? null : String(row.budget_year);
    const label = [row.version_name, year].map(textOrNull).filter(Boolean).join(' / ') || id;
    return { id, ref, label, nature, row };
  }

  private async resolveCompany(context: AiExecutionContextWithManager, ref: string): Promise<{ id: string; label: string }> {
    const uuid = isUuid(ref);
    const rows = await context.manager.query(
      `
      SELECT id, name
      FROM companies
      WHERE tenant_id = $1
        AND (${uuid ? 'id = $2 OR ' : ''}LOWER(name) = LOWER($2::text))
      ORDER BY name
      LIMIT 6
      `,
      [context.tenantId, ref],
    );
    if (rows.length === 0) throw new NotFoundException(`Company "${ref}" not found.`);
    if (rows.length > 1) throw new BadRequestException(`Multiple companies matched "${ref}". Use a UUID.`);
    return { id: String(rows[0].id), label: String(rows[0].name || rows[0].id) };
  }

  private async resolveDepartment(
    context: AiExecutionContextWithManager,
    ref: string,
    companyId: string | null,
  ): Promise<{ id: string; company_id: string; label: string }> {
    const uuid = isUuid(ref);
    const params: unknown[] = [context.tenantId, ref];
    let companyClause = '';
    if (companyId) {
      params.push(companyId);
      companyClause = ` AND d.company_id = $3`;
    }
    const rows = await context.manager.query(
      `
      SELECT d.id, d.company_id, d.name, c.name AS company_name
      FROM departments d
      LEFT JOIN companies c ON c.id = d.company_id AND c.tenant_id = d.tenant_id
      WHERE d.tenant_id = $1
        AND (${uuid ? 'd.id = $2 OR ' : ''}LOWER(d.name) = LOWER($2::text))
        ${companyClause}
      ORDER BY c.name, d.name
      LIMIT 6
      `,
      params,
    );
    if (rows.length === 0) throw new NotFoundException(`Department "${ref}" not found.`);
    if (rows.length > 1) throw new BadRequestException(`Multiple departments matched "${ref}". Provide company_id/company_ref or use a department UUID.`);
    return {
      id: String(rows[0].id),
      company_id: String(rows[0].company_id),
      label: [rows[0].company_name, rows[0].name].map(textOrNull).filter(Boolean).join(' / ') || String(rows[0].id),
    };
  }

  private createVersion(
    context: AiExecutionContextWithManager,
    nature: BudgetNature,
    itemId: string,
    fields: Record<string, unknown>,
    audit: AiMutationAuditOptions,
  ): Promise<unknown> {
    // A version created since the preview (a budget tab, an import) is refused,
    // not returned as if this action had created it (and audited as such).
    if (nature === 'opex') {
      return this.spendVersions.createForItem(itemId, fields as any, context.userId, { manager: context.manager, refuseExisting: true, audit });
    }
    return this.capexVersions.createForItem(itemId, fields as any, context.userId, { manager: context.manager, refuseExisting: true, audit });
  }

  /**
   * The version's own fields as the budget tab writes them; its allocation method and driver as the
   * Allocations tab saves them (`updateForItem`, `changeAllocationMethod`), so an automatic method
   * drops the rows of a manual split with their audit row, and a driver change computes the split again.
   */
  private async updateVersion(
    context: AiExecutionContextWithManager,
    nature: BudgetNature,
    itemId: string,
    version: FinancialVersionRef,
    fields: Record<string, unknown>,
    audit: AiMutationAuditOptions,
  ): Promise<void> {
    const versions = nature === 'opex' ? this.spendVersions : this.capexVersions;
    await versions.updateForItem(itemId, { ...fields, id: version.id } as any, context.userId, { manager: context.manager, audit });
  }

  /**
   * "Undo" of a write of amounts: the months of the columns typed by hand typed back, then each other
   * column entered again as it was, by the budget tab's own writes: a spread spread again from its
   * total or quarters over its period, a column built from quantity and price computed again from
   * its lines.
   */
  private async enterColumnsAgain(
    context: AiExecutionContextWithManager,
    nature: BudgetNature,
    versionId: string,
    amounts: AmountPayload,
    inputs: ColumnInput[],
    audit: AiMutationAuditOptions,
  ): Promise<void> {
    if (amounts.kind !== 'monthly') throw new BadRequestException('An undo of amounts writes months.');
    const { year } = amounts;
    const again = new Set(inputs.map((input) => input.measure));
    const months = amounts.months
      .map((row) => {
        const typed: typeof row = { period: row.period };
        for (const measure of AMOUNT_MEASURES) if (!again.has(measure) && row[measure] !== undefined) typed[measure] = row[measure];
        return typed;
      })
      .filter((row) => AMOUNT_MEASURES.some((measure) => row[measure] !== undefined));
    if (months.length > 0) await this.upsertAmounts(context, nature, versionId, { kind: 'monthly', year, months }, audit);
    for (const input of inputs) {
      const period = { period_start: input.period_start, period_end: input.period_end };
      let payload: Record<string, unknown>;
      if (input.method === 'computed') {
        const listed = await this.listAmounts(context, nature, versionId, year);
        const record = (Array.isArray(listed.round_inputs) ? listed.round_inputs as RoundInput[] : []).find((row) => row.measure === input.measure);
        if (!record?.lines.length) throw new ConflictException('The quantity and price lines changed after the preview was created.');
        payload = { kind: 'lines', year, measure: input.measure, lines: record.lines.map(costLine) };
      } else if (input.quarters) {
        payload = { kind: 'quarterly', year, measure: input.measure, ...input.quarters, spread_profile_name: input.distribution === '445' ? '4-4-5' : 'flat', ...period };
      } else {
        payload = { kind: 'annual', year, totals: { [input.measure]: input.total }, spread_profile_name: input.profile, ...period };
      }
      await this.upsertAmounts(context, nature, versionId, payload, audit);
    }
  }

  private async upsertAmounts(
    context: AiExecutionContextWithManager,
    nature: BudgetNature,
    versionId: string,
    amounts: AmountPayload | Record<string, unknown>,
    audit: AiMutationAuditOptions,
  ): Promise<unknown> {
    if (nature === 'opex') {
      return this.spendAmounts.bulkUpsert(versionId, amounts as any, context.userId, { manager: context.manager, audit });
    }
    return this.capexAmounts.bulkUpsert(versionId, amounts as any, context.userId, { manager: context.manager, audit });
  }

  private async replaceAllocations(
    context: AiExecutionContextWithManager,
    nature: BudgetNature,
    versionId: string,
    allocations: AllocationInput[],
    audit: AiMutationAuditOptions,
  ): Promise<unknown> {
    if (nature === 'opex') {
      return this.spendAllocations.bulkUpsert(versionId, allocations, context.userId, { manager: context.manager, tenantId: context.tenantId, audit });
    }
    return this.capexAllocations.bulkUpsert(versionId, allocations, context.userId, { manager: context.manager, tenantId: context.tenantId, audit });
  }

  private listAmounts(
    context: AiExecutionContextWithManager,
    nature: BudgetNature,
    versionId: string,
    year: number,
  ): Promise<Record<string, unknown>> {
    if (nature === 'opex') {
      return this.spendAmounts.listByYear(versionId, year, { manager: context.manager }) as any;
    }
    return this.capexAmounts.listByYear(versionId, year, { manager: context.manager }) as any;
  }

  private planAllocations(context: AiExecutionContextWithManager, nature: BudgetNature, versionId: string, allocations: AllocationInput[]) {
    const service = nature === 'opex' ? this.spendAllocations : this.capexAllocations;
    return service.plan(versionId, allocations, { manager: context.manager, tenantId: context.tenantId });
  }

  private listAllocations(
    context: AiExecutionContextWithManager,
    nature: BudgetNature,
    versionId: string,
  ): Promise<Record<string, unknown>> {
    if (nature === 'opex') {
      return this.spendAllocations.listForVersion(versionId, { manager: context.manager, tenantId: context.tenantId }) as any;
    }
    return this.capexAllocations.listForVersion(versionId, { manager: context.manager, tenantId: context.tenantId }) as any;
  }

  // The approval card names columns as the tenant does, in the fixed column order.
  private formatAmountSummary(value: Record<string, unknown>, columns: BudgetColumnsSettings): string {
    const year = value.year == null ? 'selected year' : String(value.year);
    const totals = value.totals && typeof value.totals === 'object' ? value.totals as Record<string, unknown> : {};
    const parts = AMOUNT_MEASURES
      .map((measure) => `${budgetColumnName(columns, measure)}: ${totals[measure] ?? 0}`)
      .join(', ');
    return `${year} totals (${parts})`;
  }

  private formatAmountPayload(payload: AmountPayload, columns: BudgetColumnsSettings): string {
    if (payload.kind === 'annual') {
      const parts = AMOUNT_MEASURES
        .filter((measure) => payload.totals[measure] !== undefined)
        .map((measure) => `${budgetColumnName(columns, measure)}: ${payload.totals[measure]}`);
      return `${payload.year} annual totals (${parts.join(', ')})`;
    }
    if (payload.kind === 'quarterly') {
      return `${payload.year} quarterly ${budgetColumnName(columns, payload.measure)} (${['Q1', 'Q2', 'Q3', 'Q4'].map((q) => `${q}: ${(payload as any)[q] ?? 0}`).join(', ')})`;
    }
    return `${payload.year} monthly rows (${payload.months.length})`;
  }

  /** The year's totals before the write: the shown columns, and a hidden one that holds an amount. */
  private previewTotals(value: Record<string, unknown>, columns: BudgetColumnsSettings, currency: unknown): AiPreviewAmounts {
    const stored = value.totals && typeof value.totals === 'object' ? value.totals as Record<string, unknown> : {};
    const totals: Partial<Record<AmountMeasure, number>> = {};
    for (const measure of AMOUNT_MEASURES) {
      const amount = Number(stored[measure] ?? 0) || 0;
      if (columns.enabled[measure] || amount !== 0) totals[measure] = amount;
    }
    return { ...this.previewBase(value.year == null ? null : Number(value.year), columns, currency), totals };
  }

  private previewPayload(payload: AmountPayload, columns: BudgetColumnsSettings, currency: unknown): AiPreviewAmounts {
    const base = this.previewBase(payload.year, columns, currency);
    if (payload.kind === 'annual') {
      const totals: Partial<Record<AmountMeasure, number>> = {};
      for (const measure of AMOUNT_MEASURES) {
        if (payload.totals[measure] !== undefined) totals[measure] = Number(payload.totals[measure]);
      }
      return { ...base, totals };
    }
    if (payload.kind === 'quarterly') {
      const quarter = (value: string | undefined) => Number(value ?? 0);
      return {
        ...base,
        quarters: { measure: payload.measure, values: { Q1: quarter(payload.Q1), Q2: quarter(payload.Q2), Q3: quarter(payload.Q3), Q4: quarter(payload.Q4) } },
      };
    }
    return { ...base, months: payload.months.length };
  }

  private previewBase(year: number | null, columns: BudgetColumnsSettings, currency: unknown): Pick<AiPreviewAmounts, 'year' | 'currency' | 'column_names'> {
    const columnNames: AiPreviewAmounts['column_names'] = {};
    for (const measure of AMOUNT_MEASURES) {
      const name = columns.labels[measure];
      if (name) columnNames[measure] = name;
    }
    const code = typeof currency === 'string' ? currency.trim().toUpperCase() : '';
    return { year, currency: /^[A-Z]{3}$/.test(code) ? code : null, column_names: columnNames };
  }

  /**
   * Split rows as a card shows them, sorted by name: a company or department by its name, as the
   * Allocations tab shows them. The names are carried by the line the person reads, so they show even
   * without the right to read the companies or departments lists. Never an id.
   */
  private async splitView(
    context: AiExecutionContextWithManager,
    rows: ReadonlyArray<{ company_id?: unknown; department_id?: unknown; allocation_pct?: unknown }>,
    basis: AllocationBasis | null,
  ): Promise<AllocationSplitView> {
    const namesOf = async (table: 'companies' | 'departments', key: 'company_id' | 'department_id') => {
      const ids = Array.from(new Set(rows.map((row) => textOrNull(row[key])).filter((id): id is string => !!id)));
      if (ids.length === 0) return new Map<string, string>();
      const found: Array<{ id: string; name: string }> = await context.manager.query(
        `SELECT id::text AS id, name FROM ${table} WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
        [context.tenantId, ids],
      );
      return new Map(found.map((row) => [row.id, row.name]));
    };
    const companies = await namesOf('companies', 'company_id');
    const departments = await namesOf('departments', 'department_id');
    const view = rows.map((row) => {
      const department = departments.get(String(row.department_id ?? ''));
      const label = [companies.get(String(row.company_id ?? '')) ?? '—', department].filter(Boolean).join(' / ');
      const pct = row.allocation_pct == null || row.allocation_pct === '' ? null : Math.round(Number(row.allocation_pct) * 100) / 100;
      return { label, pct: pct != null && Number.isFinite(pct) ? pct : null };
    }).sort((a, b) => a.label.localeCompare(b.label));
    return { kind: 'rows', rows: view, basis };
  }

  private itemLabelSingular(): string {
    return 'budget line';
  }

  private itemLabelPlural(): string {
    return 'budget lines';
  }

}
