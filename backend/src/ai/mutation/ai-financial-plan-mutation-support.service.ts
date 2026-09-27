import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { validate as isUuid } from 'uuid';
import { AuditService } from '../../audit/audit.service';
import { CapexAllocationsService } from '../../capex/capex-allocations.service';
import { CapexAmountsService } from '../../capex/capex-amounts.service';
import { CapexVersionsService } from '../../capex/capex-versions.service';
import { SpendAllocationsService } from '../../spend/spend-allocations.service';
import { SpendAmountsService } from '../../spend/spend-amounts.service';
import { SpendVersionsService } from '../../spend/spend-versions.service';
import { AMOUNT_MEASURES, AmountMeasure } from '../../spend/amounts-write.util';
import { budgetColumnName, BudgetColumnsSettings, readBudgetColumns } from '../../budget-columns/budget-columns.util';
import { AiMutationPreview } from '../ai-mutation-preview.entity';
import { AiExecutionContextWithManager, AiMutationPreviewChangeDto } from '../ai.types';
import { buildAiMutationAudit } from './ai-mutation-audit.util';
import {
  AiMutationPreviewPresentation,
  AiPreparedMutationPreview,
} from './ai-mutation-operation.types';

export const AI_FINANCIAL_PLAN_ENTITY_TYPES = ['spend_items', 'capex_items'] as const;
export type AiFinancialPlanEntityType = typeof AI_FINANCIAL_PLAN_ENTITY_TYPES[number];

export const AI_FINANCIAL_PLAN_ACTIONS = [
  'create_version',
  'update_version',
  'upsert_amounts',
  'replace_allocations',
] as const;
export type AiFinancialPlanAction = typeof AI_FINANCIAL_PLAN_ACTIONS[number];

export const AI_FINANCIAL_PLAN_BUSINESS_RESOURCES = ['opex', 'capex'] as const;

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
  row: Record<string, unknown>;
};

type FinancialVersionRef = {
  id: string;
  ref: string | null;
  label: string;
  row: Record<string, unknown>;
};

type NormalizedVersionFields = {
  fields: Record<string, unknown>;
  displayValues: Record<string, string | null>;
  fieldLabels: Record<string, string>;
};

type AmountPayload =
  | {
    kind: 'annual';
    year: number;
    totals: Partial<Record<AmountMeasure, number>>;
    spread_profile_name?: string;
  }
  | {
    kind: 'quarterly';
    year: number;
    measure: AmountMeasure;
    Q1?: number;
    Q2?: number;
    Q3?: number;
    Q4?: number;
    spread_profile_name?: string;
  }
  | {
    kind: 'monthly';
    year: number;
    months: Array<{
      period: string;
      planned?: number;
      forecast?: number;
      committed?: number;
      actual?: number;
      expected_landing?: number;
    }>;
  };

type AllocationInput = {
  company_id: string;
  department_id: string | null;
};

const INPUT_GRAINS = ['annual', 'quarterly', 'monthly'] as const;
const ALLOCATION_METHODS = ['default', 'headcount', 'it_users', 'turnover', 'manual_company', 'manual_department'] as const;
const ALLOCATION_DRIVERS = ['headcount', 'it_users', 'turnover'] as const;

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

export function getAiFinancialPlanBusinessResource(entityType: unknown): string {
  const normalized = requireFinancialEntityType(entityType);
  return normalized === 'spend_items' ? 'opex' : 'capex';
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

function normalizeNumber(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new BadRequestException(`${label} must be a number.`);
  return parsed;
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
      planned: Number(row.planned ?? 0),
      forecast: Number(row.forecast ?? 0),
      committed: Number(row.committed ?? 0),
      actual: Number(row.actual ?? 0),
      expected_landing: Number(row.expected_landing ?? 0),
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

function allocationInputsFromRows(rows: unknown[], method: string | null): AllocationInput[] {
  if (method !== 'manual_company' && method !== 'manual_department') return [];
  return (rows as any[])
    .map((row) => ({
      company_id: String(row.company_id || ''),
      department_id: method === 'manual_department' ? textOrNull(row.department_id) : null,
    }))
    .filter((row) => row.company_id && (method !== 'manual_department' || row.department_id));
}

@Injectable()
export class AiFinancialPlanMutationSupportService {
  constructor(
    private readonly audit: AuditService,
    private readonly capexAllocations: CapexAllocationsService,
    private readonly capexAmounts: CapexAmountsService,
    private readonly capexVersions: CapexVersionsService,
    private readonly spendAllocations: SpendAllocationsService,
    private readonly spendAmounts: SpendAmountsService,
    private readonly spendVersions: SpendVersionsService,
  ) {}

  getWritableFieldDescriptions(): string[] {
    return [
      'spend_items/capex_items action=create_version: fields version_name, input_grain, as_of_date, budget_year, allocation_method, allocation_driver, notes, reporting_currency',
      'spend_items/capex_items action=update_version: version_ref plus fields version_name, input_grain, as_of_date, allocation_method, allocation_driver, notes, reporting_currency; budget_year is immutable',
      'spend_items/capex_items action=upsert_amounts: version_ref plus amounts with kind annual, quarterly, or monthly',
      'spend_items/capex_items action=replace_allocations: version_ref plus allocations for manual_company/manual_department methods, or an empty list for automatic methods',
    ];
  }

  async prepareCreatePreview(
    context: AiExecutionContextWithManager,
    input: AiWriteFinancialPlanInput,
  ): Promise<AiPreparedMutationPreview> {
    const entityType = requireFinancialEntityType(input.entity_type);
    const action = requireFinancialAction(input.action);
    const item = await this.resolveItem(context, entityType, input.ref);

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

    const version = await this.resolveVersion(context, entityType, item.id, input.version_ref);
    if (action === 'update_version') {
      return this.prepareUpdateVersionPreview(entityType, item, version, input.fields, null);
    }
    if (action === 'upsert_amounts') {
      const amounts = this.normalizeAmountPayload(input.amounts);
      this.assertAmountsYearMatchesVersion(amounts, version);
      const before = await this.listAmounts(context, entityType, version.id, amounts.year);
      const columns = await readBudgetColumns(context.manager, context.tenantId);
      const beforeItems = Array.isArray(before.items) ? before.items : [];
      const reverseItems = completeAmountRowsForPeriods(beforeItems, amountTouchedPeriods(amounts));
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
          },
          display_values: {
            from: this.formatAmountSummary(before, columns),
            to: this.formatAmountPayload(amounts, columns),
          },
        },
      };
    }
    if (action === 'replace_allocations') {
      const before = await this.listAllocations(context, entityType, version.id);
      const allocations = await this.normalizeAllocations(context, input.allocations ?? [], String(version.row.allocation_method || 'default'));
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
          display_values: {
            from: this.formatAllocationSummary(before),
            to: this.formatAllocationInputs(allocations),
          },
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
    const item = await this.resolveItemById(context, entityType, itemId);

    if (action === 'create_version') {
      throw new BadRequestException('Undo is not supported for created financial versions.');
    }
    if (action === 'update_version') {
      const versionId = textOrNull(mutation.version_id);
      if (!versionId) throw new BadRequestException('Original preview is missing the financial version.');
      const version = await this.resolveVersionById(context, entityType, item.id, versionId);
      const previousValues = objectValue(preview.current_values?.values, 'current_values.values');
      return this.prepareUpdateVersionPreview(entityType, item, version, previousValues, preview.id);
    }
    if (action === 'upsert_amounts') {
      const versionId = textOrNull(mutation.version_id);
      if (!versionId) throw new BadRequestException('Original preview is missing the financial version.');
      const version = await this.resolveVersionById(context, entityType, item.id, versionId);
      const previousValues = objectValue(preview.current_values?.values, 'current_values.values');
      const previousRows = Array.isArray(previousValues.items) ? previousValues.items : [];
      const year = normalizeYear(previousValues.year ?? version.row.budget_year, 'year');
      return this.prepareCreatePreview(context, {
        entity_type: entityType,
        ref: item.id,
        action: 'upsert_amounts',
        version_ref: version.id,
        amounts: makeMonthlyPayloadFromRows(previousRows, year),
      });
    }
    if (action === 'replace_allocations') {
      const versionId = textOrNull(mutation.version_id);
      if (!versionId) throw new BadRequestException('Original preview is missing the financial version.');
      const version = await this.resolveVersionById(context, entityType, item.id, versionId);
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

  presentPreview(preview: AiMutationPreview): AiMutationPreviewPresentation {
    const entityType = requireFinancialEntityType(preview.target_entity_type || preview.mutation_input?.entity_type);
    const action = requireFinancialAction(preview.mutation_input?.action);
    const mutation = preview.mutation_input ?? {};
    const current = preview.current_values ?? {};
    const title = textOrNull(current.target_title) || textOrNull(mutation.version_title) || 'Financial plan';
    const changes: Record<string, AiMutationPreviewChangeDto> = {};

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
    } else if (action === 'upsert_amounts') {
      const display = current.display_values && typeof current.display_values === 'object' ? current.display_values as Record<string, unknown> : {};
      changes.amounts = {
        label: 'Amounts',
        from: formatValue(display.from),
        to: formatValue(display.to),
        format: 'text',
      };
    } else if (action === 'replace_allocations') {
      const display = current.display_values && typeof current.display_values === 'object' ? current.display_values as Record<string, unknown> : {};
      changes.allocations = {
        label: 'Allocations',
        from: formatValue(display.from),
        to: formatValue(display.to),
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
    const item = await this.resolveItemById(context, entityType, itemId);

    if (action === 'create_version') {
      const fields = objectValue(mutation.fields, 'mutation_input.fields');
      const saved = await this.createVersion(context, entityType, item.id, fields);
      const version = await this.resolveVersionById(context, entityType, item.id, String((saved as any).id));
      preview.mutation_input = {
        ...mutation,
        version_id: version.id,
        version_ref: version.ref,
        version_title: version.label,
      };
      await this.logAiAudit(context, preview, this.versionTable(entityType), version.id, 'create', null, version.row);
      return;
    }

    const versionId = textOrNull(mutation.version_id);
    if (!versionId) throw new BadRequestException('Preview is missing the financial version.');
    const version = await this.resolveVersionById(context, entityType, item.id, versionId);

    if (action === 'update_version') {
      const fields = objectValue(mutation.fields, 'mutation_input.fields');
      const previous = objectValue(preview.current_values?.values, 'current_values.values');
      this.assertVersionFieldsUnchanged(version.row, previous);
      await this.updateVersion(context, entityType, item.id, version.id, fields);
      const after = await this.resolveVersionById(context, entityType, item.id, version.id);
      await this.logAiAudit(context, preview, this.versionTable(entityType), version.id, 'update', version.row, after.row);
      return;
    }

    if (action === 'upsert_amounts') {
      const amounts = this.normalizeAmountPayload(mutation.amounts);
      this.assertAmountsYearMatchesVersion(amounts, version);
      const previous = objectValue(preview.current_values?.values, 'current_values.values');
      const before = await this.listAmounts(context, entityType, version.id, amounts.year);
      const beforeItems = Array.isArray(before.items) ? before.items : [];
      if (amountRowsSignature(beforeItems) !== String(previous.signature || '')) {
        throw new ConflictException('Financial amounts changed after the preview was created.');
      }
      await this.upsertAmounts(context, entityType, version.id, amounts);
      const after = await this.listAmounts(context, entityType, version.id, amounts.year);
      await this.logAiAudit(context, preview, this.amountsTable(entityType), null, 'update', before, after);
      return;
    }

    if (action === 'replace_allocations') {
      const allocations = this.normalizeStoredAllocations(mutation.allocations);
      const previous = objectValue(preview.current_values?.values, 'current_values.values');
      const before = await this.listAllocations(context, entityType, version.id);
      if (allocationSignature(before) !== String(previous.signature || '')) {
        throw new ConflictException('Financial allocations changed after the preview was created.');
      }
      await this.replaceAllocations(context, entityType, version.id, allocations);
      const after = await this.listAllocations(context, entityType, version.id);
      await this.logAiAudit(context, preview, this.allocationsTable(entityType), null, 'update', before, after);
      return;
    }

    throw new BadRequestException('Unsupported financial plan action.');
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

  private prepareUpdateVersionPreview(
    entityType: AiFinancialPlanEntityType,
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
    return {
      targetEntityType: entityType,
      targetEntityId: item.id,
      mutationInput: {
        action: 'update_version',
        entity_type: entityType,
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
      const totals: Partial<Record<AmountMeasure, number>> = {};
      for (const measure of AMOUNT_MEASURES) {
        if (!Object.prototype.hasOwnProperty.call(totalsInput, measure) || totalsInput[measure] == null) continue;
        totals[measure] = normalizeNumber(totalsInput[measure], `amounts.totals.${measure}`);
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
        payload[quarter] = normalizeNumber(input[quarter], `amounts.${quarter}`);
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
          planned?: number;
          forecast?: number;
          committed?: number;
          actual?: number;
          expected_landing?: number;
        } = { period };
        let amountCount = 0;
        for (const measure of AMOUNT_MEASURES) {
          if (!Object.prototype.hasOwnProperty.call(row, measure) || row[measure] == null) continue;
          normalized[measure] = normalizeNumber(row[measure], `amounts.months[${index}].${measure}`);
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
      return {
        company_id: companyId,
        department_id: textOrNull(row.department_id),
      };
    });
  }

  private async normalizeAllocations(
    context: AiExecutionContextWithManager,
    raw: unknown,
    method: string,
  ): Promise<AllocationInput[]> {
    if (!Array.isArray(raw)) throw new BadRequestException('allocations must be an array.');
    const isManualCompany = method === 'manual_company';
    const isManualDepartment = method === 'manual_department';
    if (!isManualCompany && !isManualDepartment) {
      if (raw.length > 0) {
        throw new BadRequestException('Automatic allocation methods require an empty allocations array.');
      }
      return [];
    }

    const normalized: AllocationInput[] = [];
    for (let index = 0; index < raw.length; index += 1) {
      const entry = raw[index];
      const row = typeof entry === 'string' ? { ref: entry } : objectValue(entry, `allocations[${index}]`);
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
    if (normalized.length === 0) throw new BadRequestException('Manual allocation methods require at least one allocation entry.');
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
    entityType: AiFinancialPlanEntityType,
    ref: unknown,
  ): Promise<FinancialItemRef> {
    const normalized = textOrNull(ref);
    if (!normalized) throw new BadRequestException('Financial item reference is required.');
    if (isUuid(normalized)) {
      return this.resolveItemById(context, entityType, normalized);
    }
    const table = entityType === 'spend_items' ? 'spend_items' : 'capex_items';
    const labelColumn = entityType === 'spend_items' ? 'product_name' : 'description';
    const rows = await context.manager.query(
      `
      SELECT *
      FROM ${table}
      WHERE tenant_id = $1 AND LOWER(${labelColumn}) = LOWER($2::text)
      ORDER BY ${labelColumn}
      LIMIT 6
      `,
      [context.tenantId, normalized],
    );
    if (rows.length === 0) throw new NotFoundException(`No ${this.itemLabelPlural(entityType)} found matching "${normalized}".`);
    if (rows.length > 1) throw new BadRequestException(`Multiple ${this.itemLabelPlural(entityType)} matched "${normalized}". Use a UUID.`);
    return this.itemRef(entityType, rows[0]);
  }

  private async resolveItemById(
    context: AiExecutionContextWithManager,
    entityType: AiFinancialPlanEntityType,
    id: string,
  ): Promise<FinancialItemRef> {
    const table = entityType === 'spend_items' ? 'spend_items' : 'capex_items';
    const rows = await context.manager.query(`SELECT * FROM ${table} WHERE tenant_id = $1 AND id = $2 LIMIT 1`, [context.tenantId, id]);
    if (!rows[0]) throw new NotFoundException(`${this.itemLabelSingular(entityType)} not found.`);
    return this.itemRef(entityType, rows[0]);
  }

  private itemRef(entityType: AiFinancialPlanEntityType, row: Record<string, unknown>): FinancialItemRef {
    const id = String(row.id || '');
    const label = entityType === 'spend_items'
      ? textOrNull(row.product_name) || 'Untitled spend item'
      : textOrNull(row.description) || 'Untitled CAPEX item';
    return { id, ref: label, label, row };
  }

  private async resolveVersion(
    context: AiExecutionContextWithManager,
    entityType: AiFinancialPlanEntityType,
    itemId: string,
    ref: unknown,
  ): Promise<FinancialVersionRef> {
    const normalized = textOrNull(ref);
    if (!normalized) throw new BadRequestException('version_ref is required for this financial plan action.');
    if (isUuid(normalized)) return this.resolveVersionById(context, entityType, itemId, normalized);
    const table = this.versionTable(entityType);
    const itemColumn = entityType === 'spend_items' ? 'spend_item_id' : 'capex_item_id';
    const numericYear = Number(normalized);
    const rows = await context.manager.query(
      `
      SELECT *
      FROM ${table}
      WHERE tenant_id = $1
        AND ${itemColumn} = $2
        AND (LOWER(version_name) = LOWER($3) OR budget_year = $4)
      ORDER BY created_at DESC
      LIMIT 6
      `,
      [context.tenantId, itemId, normalized, Number.isInteger(numericYear) ? numericYear : -1],
    );
    if (rows.length === 0) throw new NotFoundException(`Financial version "${normalized}" not found.`);
    if (rows.length > 1) throw new BadRequestException(`Multiple financial versions matched "${normalized}". Use a UUID.`);
    return this.versionRef(rows[0]);
  }

  private async resolveVersionById(
    context: AiExecutionContextWithManager,
    entityType: AiFinancialPlanEntityType,
    itemId: string,
    id: string,
  ): Promise<FinancialVersionRef> {
    const table = this.versionTable(entityType);
    const itemColumn = entityType === 'spend_items' ? 'spend_item_id' : 'capex_item_id';
    const rows = await context.manager.query(
      `SELECT * FROM ${table} WHERE tenant_id = $1 AND ${itemColumn} = $2 AND id = $3 LIMIT 1`,
      [context.tenantId, itemId, id],
    );
    if (!rows[0]) throw new NotFoundException('Financial version not found.');
    return this.versionRef(rows[0]);
  }

  private versionRef(row: Record<string, unknown>): FinancialVersionRef {
    const id = String(row.id || '');
    const ref = textOrNull(row.version_name) || textOrNull(row.budget_year) || id;
    const year = row.budget_year == null ? null : String(row.budget_year);
    const label = [row.version_name, year].map(textOrNull).filter(Boolean).join(' / ') || id;
    return { id, ref, label, row };
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
    entityType: AiFinancialPlanEntityType,
    itemId: string,
    fields: Record<string, unknown>,
  ): Promise<unknown> {
    if (entityType === 'spend_items') {
      return this.spendVersions.createForItem(itemId, fields as any, context.userId, { manager: context.manager });
    }
    return this.capexVersions.createForItem(itemId, fields as any, context.userId, { manager: context.manager });
  }

  private updateVersion(
    context: AiExecutionContextWithManager,
    entityType: AiFinancialPlanEntityType,
    itemId: string,
    versionId: string,
    fields: Record<string, unknown>,
  ): Promise<unknown> {
    const body = { ...fields, id: versionId };
    if (entityType === 'spend_items') {
      return this.spendVersions.updateForItem(itemId, body as any, context.userId, { manager: context.manager });
    }
    return this.capexVersions.updateForItem(itemId, body as any, context.userId, { manager: context.manager });
  }

  private async upsertAmounts(
    context: AiExecutionContextWithManager,
    entityType: AiFinancialPlanEntityType,
    versionId: string,
    amounts: AmountPayload,
  ): Promise<unknown> {
    if (entityType === 'spend_items') {
      return this.spendAmounts.bulkUpsert(versionId, amounts as any, context.userId, { manager: context.manager });
    }
    return this.capexAmounts.bulkUpsert(versionId, amounts as any, context.userId, { manager: context.manager });
  }

  private async replaceAllocations(
    context: AiExecutionContextWithManager,
    entityType: AiFinancialPlanEntityType,
    versionId: string,
    allocations: AllocationInput[],
  ): Promise<unknown> {
    if (entityType === 'spend_items') {
      return this.spendAllocations.bulkUpsert(versionId, allocations, context.userId, { manager: context.manager });
    }
    return this.capexAllocations.bulkUpsert(versionId, allocations, context.userId, { manager: context.manager });
  }

  private listAmounts(
    context: AiExecutionContextWithManager,
    entityType: AiFinancialPlanEntityType,
    versionId: string,
    year: number,
  ): Promise<Record<string, unknown>> {
    if (entityType === 'spend_items') {
      return this.spendAmounts.listByYear(versionId, year, { manager: context.manager }) as any;
    }
    return this.capexAmounts.listByYear(versionId, year, { manager: context.manager }) as any;
  }

  private listAllocations(
    context: AiExecutionContextWithManager,
    entityType: AiFinancialPlanEntityType,
    versionId: string,
  ): Promise<Record<string, unknown>> {
    if (entityType === 'spend_items') {
      return this.spendAllocations.listForVersion(versionId, { manager: context.manager }) as any;
    }
    return this.capexAllocations.listForVersion(versionId, { manager: context.manager }) as any;
  }

  private async logAiAudit(
    context: AiExecutionContextWithManager,
    preview: AiMutationPreview,
    table: string,
    recordId: string | null,
    action: 'create' | 'update',
    before: unknown,
    after: unknown,
  ): Promise<void> {
    const audit = buildAiMutationAudit(preview);
    await this.audit.log(
      {
        table,
        recordId,
        action,
        before,
        after,
        userId: context.userId,
        source: audit.source,
        sourceRef: audit.sourceRef,
      },
      { manager: context.manager },
    );
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

  private formatAllocationSummary(value: Record<string, unknown>): string {
    const items = Array.isArray(value.items) ? value.items : [];
    if (items.length === 0) return 'No allocation rows';
    return items
      .map((row: any) => [row.company_id, row.department_id, row.allocation_pct == null ? null : `${row.allocation_pct}%`, row.source].map(textOrNull).filter(Boolean).join(' / '))
      .join(', ');
  }

  private formatAllocationInputs(value: AllocationInput[]): string {
    if (value.length === 0) return 'Automatic allocation';
    return value.map((row) => [row.company_id, row.department_id].filter(Boolean).join(' / ')).join(', ');
  }

  private itemLabelSingular(entityType: AiFinancialPlanEntityType): string {
    return entityType === 'spend_items' ? 'spend item' : 'CAPEX item';
  }

  private itemLabelPlural(entityType: AiFinancialPlanEntityType): string {
    return entityType === 'spend_items' ? 'spend items' : 'CAPEX items';
  }

  private versionTable(entityType: AiFinancialPlanEntityType): string {
    return entityType === 'spend_items' ? 'spend_versions' : 'capex_versions';
  }

  private amountsTable(entityType: AiFinancialPlanEntityType): string {
    return entityType === 'spend_items' ? 'spend_amounts' : 'capex_amounts';
  }

  private allocationsTable(entityType: AiFinancialPlanEntityType): string {
    return entityType === 'spend_items' ? 'spend_allocations' : 'capex_allocations';
  }
}
