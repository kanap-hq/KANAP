import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { loadAnalyticsAxes, isAxisActive, analyticsAxisLabel, type AnalyticsAxisInfo } from '../../../analytics/analytics-axes.util';
import { BULK_MAX_ROWS, type BulkChanges, type BulkEditResult } from '../../../common/bulk-edit/bulk-edit';
import { budgetLineReferenceNumbers } from '../../../common/resolve-item-id';
import { BUDGET_NATURES, naturesAnd } from '../../../spend/budget-nature';
import { BudgetLinesService } from '../../../spend/budget-lines.service';
import { AiMutationPreview } from '../../ai-mutation-preview.entity';
import { AiPolicyService } from '../../ai-policy.service';
import {
  BUDGET_LINE_BULK_FIELD_LABELS,
  BUDGET_LINE_FILTER_LABELS,
  BUDGET_LINE_VALUE_WORDS,
  BULK_EDIT_CARD_LABEL,
  bulkEditActionText,
  bulkEditCardText,
  bulkEditCardTitleText,
  bulkEditTitleText,
  type BulkFilterPart,
} from '../../ai-bulk-edit-texts';
import { AiWriteLanguage, previewSummaryText } from '../../ai-write-texts';
import { AiExecutionContextWithManager } from '../../ai.types';
import { aiBudgetListAccess } from '../../query/ai-budget-list-access.util';
import { adaptFilters } from '../../query/ai-filter.adapter';
import type { AiFilterValue } from '../../query/ai-filter.types';
import { resolveAiEntityRegistry } from '../../query/registries';
import { AI_BULK_FILTER_VALUE, isEmptyAiBulkFilterValue, withAiBulkEditWaits } from '../ai-bulk-edit';
import { buildAiMutationAudit } from '../ai-mutation-audit.util';
import { AiMutationOperation, AiMutationPreviewPresentation, AiPreparedMutationPreview } from '../ai-mutation-operation.types';
import { AiBusinessRecordMutationSupportService } from '../ai-business-record-mutation-support.service';
import { AiTaskMutationSupportService } from '../ai-task-mutation-support.service';

/**
 * Kad's change in bulk of budget lines (lot K1 of 26.11.9): the "Change the selection" of the
 * budget lines list, under a card the person approves. One field per card, among the dialog's
 * (cost center, account, paying company, supplier, owners, run or build, a dimension's value); no
 * amount. The lines: a filter of the list (the `query_entities` filters of budget lines, a dozen
 * fields, turned into the list's own parameters), or their references; never the whole list
 * without a criterion. The scope is the list's: its enabled lines, unless the filter names the status.
 *
 * The card's count is the screen's dry run (`BudgetLinesService.bulkUpdate`, the common contract):
 * the same lines, the same refusals, under the person's access (Kad's transaction is limited by
 * `applyDataAccess`, so a line outside it is neither counted nor named). The approval plays the
 * write with the count's `as_of`, `expected_rows` and fingerprint: a list that changed in between
 * refuses it whole. No undo, as the screen; each line's one audit row says "by Kad".
 */

const TOOL = 'bulk_update_budget_lines';
/** The change's key on the card; the frontend labels it (`ai:previewCard.fields.budget_line_bulk_edit`). */
const CARD_FIELD = 'budget_line_bulk_edit';
const CARD_EXAMPLES = 5;

const FIELDS = ['cost_center', 'account', 'paying_company', 'supplier', 'owner_it', 'owner_business', 'run_build', 'dimension'] as const;
type BulkField = (typeof FIELDS)[number];

/** The column of `spend_items` each field writes (`BUDGET_LINE_BULK_FIELDS`). */
const COLUMN: Record<Exclude<BulkField, 'dimension'>, string> = {
  cost_center: 'cost_center_id',
  account: 'account_id',
  paying_company: 'paying_company_id',
  supplier: 'supplier_id',
  owner_it: 'owner_it_id',
  owner_business: 'owner_business_id',
  run_build: 'run_build',
};

/** The fields of the filter: those that aim at lines (no amount, which needs years). Dimensions are `analytics:<code>`. */
export const BUDGET_LINE_BULK_FILTER_FIELDS = [
  'nature', 'status', 'product_name', 'supplier', 'paying_company', 'account', 'cost_center', 'contract',
  'owner_it', 'owner_business', 'run_build', 'analytics_category',
] as const;
const ANALYTICS_PREFIX = 'analytics:';
const ACCEPTED_FILTERS = `${BUDGET_LINE_BULK_FILTER_FIELDS.join(', ')}, and analytics:<code> for another dimension`;
/** The fields whose values are closed lists, worded on the card as the list does. */
const WORDED_FILTER_FIELDS = new Set(['status', 'run_build', 'nature']);

/** Kad builds the filter from the person's words alone: on dev it had added "run or build = run" to reach "all the lines" (lot K1). */
const ONLY_NAMED_CRITERIA = 'Use only the criteria the person named: never add a filter they did not name. '
  + 'A filter on the field being changed is a criterion only when the person named it ("the run lines to build").';

/** A field this tool does not take is said, then changed card by card (lot K1), as for the applications. */
const OTHER_FIELD = 'Any other field is not changed in bulk: say so in the answer, with the fields that are '
  + '(cost center, account, paying company, supplier, IT owner, business owner, run or build, the value of a dimension), '
  + 'then prepare one card per line as usual. Never present cards of one line each, nor a prepare_mutation_plan of them, as a change in bulk.';

const NO_CRITERION = 'Name the lines to change: a filter of the budget lines (supplier, cost center, account, owner, dimension...) or their references (rows). '
  + 'Kad does not change every line of the list at once: ask the person which lines.';

export const BulkUpdateBudgetLinesInputSchema = z.object({
  field: z.enum(FIELDS)
    .describe('The one field this card changes: cost_center, account, paying_company, supplier, owner_it, owner_business, run_build, or dimension (with `dimension`).'),
  value: z.union([z.string().trim().min(1).max(500), z.null()])
    .describe('The new value: a cost center code or name, an account number, a company or supplier name or reference, a person\'s name or email, run or build, a dimension value\'s name. '
      + 'null empties the field (not the account nor the paying company).'),
  dimension: z.string().trim().min(1).max(200).optional()
    .describe('With field dimension: the dimension, by its code or its name.'),
  company: z.string().trim().min(1).max(300).optional()
    .describe('With field account, only when the account number is in several charts of accounts: the company whose chart holds it.'),
  rows: z.array(z.string().trim().min(1).max(40)).min(1).max(BULK_MAX_ROWS).optional()
    .describe('The lines by reference (BL-12). Give rows or filters, not both.'),
  filters: z.record(z.string(), AI_BULK_FILTER_VALUE).optional()
    .describe(`The lines described by the query_entities filters of budget_lines, as the list filters them: ${ACCEPTED_FILTERS}. Give rows or filters, not both.`),
}).strict().refine((value) => (value.rows !== undefined) !== (value.filters !== undefined), {
  message: 'Give the lines by reference (rows) or the budget lines filters (filters), one of the two.',
});

type BulkUpdateBudgetLinesInput = z.infer<typeof BulkUpdateBudgetLinesInputSchema>;

type Request = {
  field: BulkField;
  value: string | null;
  dimension?: string;
  company?: string;
  rows?: string[];
  filters?: Record<string, AiFilterValue>;
};

/** One part of the filter as stored on the card: its field, the tenant's name of a dimension, its values. */
type StoredFilterPart = { key: string; label?: string; op: 'in' | 'not' | 'contains'; values: Array<string | null> };

/** The change resolved: the contract's `changes`, the label of a dimension, the value as the card shows it. */
type ResolvedChange = { changes: BulkChanges; dimension: string | null; valueLabel: string | null };

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function counts(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([code, n]) => [code, Number(n) || 0]));
}

@Injectable()
export class BulkUpdateBudgetLinesAiMutationOperation implements AiMutationOperation<BulkUpdateBudgetLinesInput> {
  readonly toolName = TOOL;
  readonly description = 'Create a card that changes one field on many budget lines at once (cost center, account, paying company, supplier, IT or business owner, run or build, or a dimension value), '
    + 'as the "Change the selection" of the budget lines list. Requires explicit user approval before execution. No amount. '
    + `${ONLY_NAMED_CRITERIA} A request on all the lines, with no other criterion, gets a question asking for one, and no card. ${OTHER_FIELD}`;
  readonly inputSchema = BulkUpdateBudgetLinesInputSchema;
  readonly inputSummary = {
    field: 'One of cost_center, account, paying_company, supplier, owner_it, owner_business, run_build, dimension.',
    value: 'The new value by name, code, number or reference; null empties it (not account or paying_company).',
    dimension: 'With field dimension: its code or name.',
    company: 'With field account, when the number is in several charts: the company whose chart holds it.',
    rows: `Or: up to ${BULK_MAX_ROWS} line references (BL-12).`,
    filters: `Or: the query_entities filters of budget_lines (${ACCEPTED_FILTERS}).`,
  };
  readonly businessResource = 'budget';
  readonly writePreview = {
    entity_type: 'budget_lines',
    fields: [CARD_FIELD],
    reversible: false,
    prompt_hint: 'Use `bulk_update_budget_lines` to change one field on several budget lines at once, as the "Change the selection" of the budget lines list: '
      + 'cost center, account, paying company, supplier, IT owner, business owner, run or build, or the value of a dimension (`field: dimension` with `dimension`). One field per card; no amount. '
      + `Describe the lines with the query_entities filters of budget_lines (\`filters\`: ${ACCEPTED_FILTERS}; take the exact values from get_filter_values) or name them (\`rows\`: BL-12), not both; at most ${BULK_MAX_ROWS} lines. `
      + 'A filter covers the enabled lines of the list, unless it names the status. '
      + `${ONLY_NAMED_CRITERIA} A request on all the lines, with no other criterion, gets a question asking for one, and no card. `
      + 'Give the new value by name, code or number; `null` empties a field, except the account and the paying company. An account number found in several charts of accounts needs `company`. '
      + `${OTHER_FIELD} `
      + 'For one of these fields on more than a few lines, use this tool, never update_business_record line by line nor prepare_mutation_plan. The card counts the lines to change and the refused ones; it cannot be undone.',
  };

  constructor(
    private readonly policy: AiPolicyService,
    private readonly budgetLines: BudgetLinesService,
    private readonly records: AiBusinessRecordMutationSupportService,
    private readonly people: AiTaskMutationSupportService,
  ) {}

  resolveWriteFamily(): string {
    return 'budget_lines';
  }

  prepareCreatePreview(
    context: AiExecutionContextWithManager,
    input: BulkUpdateBudgetLinesInput,
  ): Promise<AiPreparedMutationPreview> {
    return withAiBulkEditWaits(context.manager, () => this.prepareCard(context, input));
  }

  private async prepareCard(
    context: AiExecutionContextWithManager,
    input: BulkUpdateBudgetLinesInput,
  ): Promise<AiPreparedMutationPreview> {
    const request = this.normalizeRequest(input);
    const change = await this.resolveChange(context, request);
    const chosen = request.rows ? await this.resolveRows(context, request.rows) : null;
    const target = chosen
      ? { body: { ids: chosen.ids }, parts: null, defaultScope: false }
      : await this.resolveFilters(context, request.filters ?? {});
    const dry = await this.budgetLines.bulkUpdate(
      { ...target.body, changes: change.changes, dry_run: true },
      context.userId ?? undefined,
      { manager: context.manager, access: await aiBudgetListAccess(this.policy, context), options: { changedIds: true } },
    ) as BulkEditResult;
    if (!dry.changes) {
      const refused = Object.entries(dry.refused).map(([code, n]) => `${code}: ${n}`).join(', ');
      throw new BadRequestException(
        `Nothing to change: of the ${dry.rows} line${dry.rows === 1 ? '' : 's'} reached, ${dry.unchanged} already hold this value`
        + `${refused ? ` and the others are refused (${refused})` : ''}.`,
      );
    }
    // The first lines that would change, by reference, read under the person's access.
    const examples: Array<{ ref: string; title: string }> = (await context.manager.query(
      `SELECT 'BL-' || i.item_number AS ref, i.product_name AS title
         FROM spend_items i
        WHERE i.tenant_id = $1${naturesAnd('i', BUDGET_NATURES)} AND i.id = ANY($2::uuid[])
        ORDER BY i.item_number
        LIMIT ${CARD_EXAMPLES}`,
      [context.tenantId, dry.changed_ids ?? []],
    )).map((row: { ref: string; title: string | null }) => ({ ref: String(row.ref), title: text(row.title) }));
    return {
      targetEntityType: 'budget_lines',
      targetEntityId: null,
      mutationInput: {
        field: request.field,
        ...(change.dimension ? { dimension: change.dimension } : {}),
        value_label: change.valueLabel,
        changes: change.changes,
        ...(chosen ? { refs: chosen.refs } : {}),
        ...(target.parts ? { filter_parts: target.parts, default_scope: target.defaultScope } : {}),
        selection: target.body,
        as_of: dry.as_of,
        expected_rows: dry.rows,
        fingerprint: dry.fingerprint,
      },
      currentValues: {
        values: { rows: dry.rows, changes: dry.changes, unchanged: dry.unchanged, refused: dry.refused, examples },
      },
    };
  }

  presentPreview(preview: AiMutationPreview, language: AiWriteLanguage = 'en'): AiMutationPreviewPresentation {
    const mutation = (preview.mutation_input ?? {}) as Record<string, unknown>;
    const values = (preview.current_values?.values ?? {}) as Record<string, unknown>;
    const applied = preview.current_values?.applied as Record<string, unknown> | undefined;
    const field = text(mutation.field) as BulkField;
    const fieldLabel = field === 'dimension' ? text(mutation.dimension) : BUDGET_LINE_BULK_FIELD_LABELS[language][field] ?? field;
    const raw = mutation.value_label == null ? null : text(mutation.value_label);
    const value = raw !== null && field === 'run_build' ? BUDGET_LINE_VALUE_WORDS[language].run_build[raw] ?? raw : raw;
    const changes = Number(values.changes) || 0;
    const done = applied ? Number(applied.changed) || 0 : changes;
    const filterParts = Array.isArray(mutation.filter_parts) ? (mutation.filter_parts as StoredFilterPart[]) : null;
    const refs = filterParts ? null : Array.isArray(mutation.refs) ? (mutation.refs as unknown[]).map(text) : [];
    const card = bulkEditCardText({
      family: 'budget_lines',
      selection: filterParts
        ? { kind: 'filter', parts: filterParts.map((part) => this.filterPartWords(part, language)), defaultScope: mutation.default_scope === true }
        : { kind: 'rows', refs: refs ?? [] },
      field: fieldLabel,
      value,
      rows: Number(values.rows) || 0,
      changes,
      unchanged: Number(values.unchanged) || 0,
      refused: counts(values.refused),
      examples: (Array.isArray(values.examples) ? values.examples as Array<Record<string, unknown>> : [])
        .map((row) => ({ ref: text(row.ref), title: text(row.title) })),
    }, language);
    const englishField = field === 'dimension' ? fieldLabel : BUDGET_LINE_BULK_FIELD_LABELS.en[field] ?? field;
    let summary = `Preview ${preview.id} ${preview.status}.`;
    switch (preview.status) {
      case 'pending': summary = `Change ${englishField} on ${bulkEditTitleText('budget_lines', 'en', changes)}.`; break;
      case 'executed': summary = `${englishField} changed on ${bulkEditTitleText('budget_lines', 'en', done)}.`; break;
      case 'rejected': summary = 'The change in bulk of budget lines was rejected.'; break;
      case 'expired': summary = 'The change in bulk of budget lines expired before approval.'; break;
      case 'failed': summary = preview.error_message || 'The change in bulk of budget lines failed.'; break;
    }
    if (language !== 'en') {
      summary = previewSummaryText(
        language,
        preview.status,
        bulkEditActionText(language, 'budget_lines', fieldLabel, preview.status === 'executed' ? done : changes),
        { errorMessage: preview.error_message },
      );
    }
    return {
      target: { entity_type: 'budget_lines', entity_id: null, ref: null, title: bulkEditCardTitleText('budget_lines', language, changes, refs) },
      changes: { [CARD_FIELD]: { label: BULK_EDIT_CARD_LABEL[language], from: null, to: card, format: 'markdown' } },
      summary,
    };
  }

  async executePreview(context: AiExecutionContextWithManager, preview: AiMutationPreview): Promise<void> {
    // Read again at approval: the right may have been withdrawn since the card.
    await this.policy.assertWriteAccess(context, 'budget', context.manager, { level: 'member' });
    const mutation = (preview.mutation_input ?? {}) as Record<string, unknown>;
    const selection = mutation.selection;
    if (!selection || typeof selection !== 'object' || !mutation.changes) throw new BadRequestException('Preview is missing its lines.');
    // The count's instant, lines and fingerprint: a list that changed since refuses the write whole.
    const result = await withAiBulkEditWaits(context.manager, async () => this.budgetLines.bulkUpdate(
      { ...(selection as Record<string, unknown>), changes: mutation.changes, as_of: mutation.as_of, expected_rows: mutation.expected_rows, fingerprint: mutation.fingerprint },
      context.userId ?? undefined,
      { manager: context.manager, access: await aiBudgetListAccess(this.policy, context), audit: buildAiMutationAudit(preview) },
    )) as BulkEditResult;
    preview.current_values = {
      ...(preview.current_values ?? {}),
      applied: { changed: Number(result.changed) || 0, unchanged: result.unchanged, refused: result.refused },
    };
  }

  /** A part of the filter in the person's language: the column's label, and the words of a closed list. */
  private filterPartWords(part: StoredFilterPart, language: AiWriteLanguage): BulkFilterPart {
    const label = part.label ?? BUDGET_LINE_FILTER_LABELS[language][part.key] ?? part.key;
    if (WORDED_FILTER_FIELDS.has(part.key)) {
      const words = BUDGET_LINE_VALUE_WORDS[language][part.key];
      return { label, op: part.op, values: part.values.map((value) => (value === null ? null : words[value] ?? value)) };
    }
    return { label, op: part.op, values: part.values };
  }

  /** The request as the operation takes it (a plan step never reaches it: `AI_BULK_EDIT_TOOLS`). */
  private normalizeRequest(input: BulkUpdateBudgetLinesInput | Record<string, unknown>): Request {
    const parsed = BulkUpdateBudgetLinesInputSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Invalid input.');
    const raw = parsed.data;
    if (raw.dimension !== undefined && raw.field !== 'dimension') throw new BadRequestException('dimension goes with field dimension.');
    if (raw.field === 'dimension' && raw.dimension === undefined) throw new BadRequestException('Name the dimension (dimension) whose value changes.');
    if (raw.company !== undefined && raw.field !== 'account') throw new BadRequestException('company goes with field account: it names the chart of accounts.');
    return { ...raw };
  }

  /** The value in the contract's terms (ids), resolved as `update_business_record` resolves it. */
  private async resolveChange(context: AiExecutionContextWithManager, request: Request): Promise<ResolvedChange> {
    const { field, value } = request;
    if (field === 'dimension') {
      const axis = await this.resolveDimension(context, request.dimension!);
      const name = analyticsAxisLabel(axis);
      if (value === null) return { changes: { analytics_values: { [axis.id]: null } }, dimension: name, valueLabel: null };
      const found = await this.records.findDimensionValue(context, axis.id, value);
      if (!found) throw new NotFoundException(`"${value}" is not a value of the dimension "${name}".`);
      return { changes: { analytics_values: { [axis.id]: found.id } }, dimension: name, valueLabel: found.name };
    }
    const column = COLUMN[field];
    if (value === null) {
      if (field === 'account' || field === 'paying_company') {
        throw new BadRequestException(`The ${field === 'account' ? 'account' : 'paying company'} of a budget line cannot be emptied.`);
      }
      return { changes: { [column]: null }, dimension: null, valueLabel: null };
    }
    switch (field) {
      case 'run_build': {
        const choice = value.toLowerCase();
        if (choice !== 'run' && choice !== 'build') throw new BadRequestException('run_build takes run or build, or null.');
        return { changes: { run_build: choice }, dimension: null, valueLabel: choice };
      }
      case 'owner_it':
      case 'owner_business': {
        try {
          const person = await this.people.resolveUserReference(context, value);
          return { changes: { [column]: person.id }, dimension: null, valueLabel: person.label };
        } catch (error) {
          if (error instanceof NotFoundException) throw new NotFoundException(`No person found matching "${value}".`);
          throw error;
        }
      }
      case 'account':
        return this.resolveAccount(context, value, request.company);
      default: {
        const target = field === 'cost_center' ? 'cost_centers' : field === 'supplier' ? 'suppliers' : 'companies';
        const found = await this.records.resolveRecordReference(context, target, value);
        return { changes: { [column]: found.id }, dimension: null, valueLabel: found.label };
      }
    }
  }

  /**
   * The account by its number, its name or "number - name", in the workspace. One match is enough;
   * a number found in several charts of accounts needs the company whose chart holds it. A company
   * without a chart takes the workspace's default chart, else the accounts without a chart: the
   * accounts the screen's picker offers for that company (`lookupAccounts`).
   */
  private async resolveAccount(context: AiExecutionContextWithManager, value: string, companyRef?: string): Promise<ResolvedChange> {
    let chart: { id: string | null; company: string } | null = null;
    if (companyRef) {
      const company = await this.records.resolveRecordReference(context, 'companies', companyRef);
      const own = company.row.coa_id == null ? null : String(company.row.coa_id);
      const fallback = own ?? (await context.manager.query(
        `SELECT g.id::text AS id FROM chart_of_accounts g WHERE g.tenant_id = $1 AND g.is_global_default = true ORDER BY g.id LIMIT 1`,
        [context.tenantId],
      ))[0]?.id ?? null;
      chart = { id: fallback, company: company.label };
    }
    const params: unknown[] = [context.tenantId, value];
    if (chart) params.push(chart.id);
    const rows: Array<{ id: string; label: string; chart: string | null; coa_id: string | null }> = await context.manager.query(
      `SELECT a.id::text AS id, concat_ws(' - ', a.account_number::text, a.account_name) AS label, c.name AS chart, a.coa_id::text AS coa_id
         FROM accounts a
         LEFT JOIN chart_of_accounts c ON c.tenant_id = a.tenant_id AND c.id = a.coa_id
        WHERE a.tenant_id = $1
          AND (a.id::text = lower($2::text) OR a.account_number::text = $2::text OR lower(a.account_name) = lower($2::text)
               OR lower(concat(a.account_number, ' - ', a.account_name)) = lower($2::text))
          ${chart ? 'AND a.coa_id IS NOT DISTINCT FROM $3::uuid' : ''}
        ORDER BY a.account_number, c.name
        LIMIT 20`,
      params,
    );
    if (rows.length === 0) {
      throw new NotFoundException(`No account found matching "${value}"${chart ? ` in the chart of accounts of ${chart.company}` : ''}.`);
    }
    if (rows.length > 1) {
      const charts = Array.from(new Set(rows.map((row) => row.coa_id)));
      if (charts.length > 1) {
        const names = Array.from(new Set(rows.map((row) => row.chart ?? 'no chart'))).join(', ');
        throw new BadRequestException(`The account "${value}" is in several charts of accounts (${names}): name the company whose chart holds it (company).`);
      }
      throw new BadRequestException(`Several accounts match "${value}": ${rows.map((row) => row.label).join(', ')}. Give the account number.`);
    }
    return { changes: { account_id: rows[0].id }, dimension: null, valueLabel: rows[0].label };
  }

  /** An enabled dimension of the lines, by its code or its name. */
  private async resolveDimension(context: AiExecutionContextWithManager, ref: string): Promise<AnalyticsAxisInfo> {
    const wanted = ref.toLowerCase();
    const axes = (await loadAnalyticsAxes(context.manager, context.tenantId)).filter((axis) => isAxisActive(axis));
    const found = axes.filter((axis) => axis.code.toLowerCase() === wanted || axis.id === wanted)
      .concat(axes.filter((axis) => (axis.name ?? '').trim().toLowerCase() === wanted));
    if (found.length === 0) {
      throw new NotFoundException(`No dimension "${ref}" on the budget lines. The dimensions: ${axes.map((axis) => `${analyticsAxisLabel(axis)} (${axis.code})`).join(', ') || 'none'}.`);
    }
    return found[0];
  }

  /**
   * The lines the references name, in this tenant and under the person's access: `BL-n` or a bare
   * number is the line's own number, `OPX-n` or `CPX-n` its old number. A reference that names no
   * line the person reads is refused, the same for a line gone and a line outside the access. The
   * card names the lines by their key (`BL-12`), whatever was typed.
   */
  private async resolveRows(context: AiExecutionContextWithManager, refs: string[]): Promise<{ ids: string[]; refs: string[] }> {
    const parsed = refs.map((ref) => ({ ref, ...budgetLineReferenceNumbers(ref) }));
    const bad = parsed.find((entry) => entry.itemNumber === null && entry.legacyNumber === null);
    if (bad) throw new BadRequestException(`"${bad.ref}" is not a budget line reference (BL-12).`);
    const found: Array<{ id: string; item_number: number; legacy_number: string | null }> = await context.manager.query(
      `SELECT i.id::text AS id, i.item_number, i.legacy_number
         FROM spend_items i
        WHERE i.tenant_id = $1${naturesAnd('i', BUDGET_NATURES)}
          AND (i.item_number = ANY($2::int[]) OR i.legacy_number = ANY($3::text[]))`,
      [
        context.tenantId,
        parsed.flatMap((entry) => (entry.itemNumber === null ? [] : [entry.itemNumber])),
        parsed.flatMap((entry) => (entry.legacyNumber === null ? [] : [entry.legacyNumber])),
      ],
    );
    const chosen = new Map<string, string>();
    const missing: string[] = [];
    for (const entry of parsed) {
      const row = found.find((line) => (entry.itemNumber !== null ? Number(line.item_number) === entry.itemNumber : line.legacy_number === entry.legacyNumber));
      if (row) chosen.set(row.id, `BL-${row.item_number}`);
      else missing.push(entry.ref);
    }
    if (missing.length > 0) throw new NotFoundException(`No budget line ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ` (and ${missing.length - 10} more)` : ''} in this workspace.`);
    return { ids: Array.from(chosen.keys()), refs: Array.from(chosen.values()) };
  }

  /**
   * The list's own parameters for a filter of Kad: the grid model of `adaptFilters` (the model the
   * screen's list sends), with `includeDisabled` when the filter names the status, so the lines are
   * those the list shows. A field outside the dozen accepted, ignored or with a value the field does
   * not take is refused; a filter that names nothing but the status is no criterion.
   */
  private async resolveFilters(
    context: AiExecutionContextWithManager,
    filters: Record<string, AiFilterValue>,
  ): Promise<{ body: { all: true; filters: Record<string, unknown> }; parts: StoredFilterPart[]; defaultScope: boolean }> {
    const keys = Object.keys(filters);
    const accepted = (key: string) => (BUDGET_LINE_BULK_FILTER_FIELDS as readonly string[]).includes(key) || key.startsWith(ANALYTICS_PREFIX);
    const outside = keys.filter((key) => !accepted(key));
    if (outside.length > 0) {
      throw new BadRequestException(`These budget lines filters cannot choose lines to change: ${outside.join(', ')}. Use ${ACCEPTED_FILTERS}; or name the lines (rows).`);
    }
    // A part without a value is no criterion: an empty exclusion would reach the whole list, or open the disabled lines.
    if (keys.filter((key) => key !== 'status').length === 0 || keys.some((key) => isEmptyAiBulkFilterValue(filters[key]))) {
      throw new BadRequestException(NO_CRITERION);
    }
    const registry = await resolveAiEntityRegistry(
      context,
      'budget_lines',
      async (entityType) => this.policy.canReadEntityType(context, entityType, context.manager),
    );
    const adapted = adaptFilters(registry, filters);
    if (adapted.ignored.length > 0) {
      const parts = adapted.ignored.map((field) => {
        const invalid = adapted.invalid_values.find((entry) => entry.field === field);
        return invalid ? `${field} (takes ${invalid.accepted.map((value) => value ?? 'null').join(', ')})` : field;
      });
      throw new BadRequestException(`These budget lines filters cannot be used: ${parts.join('; ')}. Use ${ACCEPTED_FILTERS}, with the values get_filter_values gives.`);
    }
    const axes = await loadAnalyticsAxes(context.manager, context.tenantId);
    const parts: StoredFilterPart[] = keys.map((key) => {
      const value = filters[key];
      const label = key === 'analytics_category'
        ? analyticsAxisLabel(axes.find((axis) => axis.is_default) ?? { name: null })
        : key.startsWith(ANALYTICS_PREFIX)
          ? analyticsAxisLabel(axes.find((axis) => axis.code === key.slice(ANALYTICS_PREFIX.length)) ?? { name: key.slice(ANALYTICS_PREFIX.length) })
          : undefined;
      if (typeof value === 'string') {
        const field = registry.fields[key];
        return { key, ...(label ? { label } : {}), op: field?.type === 'text' ? 'contains' as const : 'in' as const, values: [value.trim()] };
      }
      if (value && typeof value === 'object' && !Array.isArray(value) && 'not' in value) {
        return { key, ...(label ? { label } : {}), op: 'not' as const, values: (value as { not: Array<string | null> }).not };
      }
      return { key, ...(label ? { label } : {}), op: 'in' as const, values: Array.isArray(value) ? value as Array<string | null> : [String(value)] };
    });
    const named = Object.prototype.hasOwnProperty.call(filters, 'status');
    return {
      body: { all: true, filters: { filters: adapted.filters, ...(named ? { includeDisabled: true } : {}) } },
      parts,
      defaultScope: !named,
    };
  }
}
