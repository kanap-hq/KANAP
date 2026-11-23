import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { resolveBusinessContributorScopeForUser, applicationParticipantCondition, type ParticipationAccessScope } from '../../../auth/business-contributor-scope';
import type { ApplicationBulkRow } from '../../../applications/application-bulk-edit';
import { ApplicationsService } from '../../../applications/services/applications.service';
import { BULK_MAX_ROWS, type BulkChanges, type BulkEditResult } from '../../../common/bulk-edit/bulk-edit';
import { CATALOG_LOCALES, matchCatalogAliases, normalizeAlias, type CatalogTranslations } from '../../../it-ops-settings/catalog-codes';
import { shippedLabelIn, shippedLabelsOf } from '../../../it-ops-settings/catalog-shipped-labels';
import { ItOpsSettingsService } from '../../../it-ops-settings/it-ops-settings.service';
import { AiMutationPreview } from '../../ai-mutation-preview.entity';
import { AiPolicyService } from '../../ai-policy.service';
import {
  APPLICATION_BULK_FIELD_LABELS,
  APPLICATION_FILTER_LABELS,
  APPLICATION_YES_NO_WORDS,
  BULK_EDIT_ALL_LEFT_OUT,
  BULK_EDIT_ALL_LEFT_OUT_MESSAGE,
  BULK_EDIT_CARD_LABEL,
  bulkEditActionText,
  bulkEditCardText,
  bulkEditCardTitleText,
  bulkEditTitleText,
  bulkEditTooLongNote,
  type BulkFilterPart,
} from '../../ai-bulk-edit-texts';
import { AiWriteLanguage, previewSummaryText } from '../../ai-write-texts';
import { AiExecutionContextWithManager } from '../../ai.types';
import { adaptFilters } from '../../query/ai-filter.adapter';
import type { AiFilterValue } from '../../query/ai-filter.types';
import { resolveAiEntityRegistry } from '../../query/registries';
import {
  AI_BULK_EDIT_LIST_MAX,
  AI_BULK_FILTER_VALUE,
  bulkEditPreviewDto,
  bulkExcluded,
  bulkListApplied,
  bulkListWithExclusions,
  effectiveBulkSelection,
  isEmptyAiBulkFilterValue,
  sortedBulkList,
  storedBulkList,
  withAiBulkEditWaits,
  type AiBulkList,
  type AiBulkListRow,
} from '../ai-bulk-edit';
import { buildAiMutationAudit } from '../ai-mutation-audit.util';
import { AiMutationOperation, AiMutationPreviewPresentation, AiPreparedMutationPreview } from '../ai-mutation-operation.types';
import { AiTaskMutationSupportService } from '../ai-task-mutation-support.service';

/**
 * Kad's change in bulk of applications (lot K1 of 26.11.9): the "Change the selection" of the
 * applications list, under a card the person approves. One field per card, among the dialog's:
 * business owners and IT owners (a list of people that replaces the role's, empty allowed), the
 * category (one of the categories still offered, never empty; decision D15), the lifecycle (one of
 * the workspace's states, never empty), the business and the cyber criticality (one of the levels
 * still offered, or empty). A category, a state or a level is given by its name or its code. The
 * applications: a filter of the list (the `query_entities` filters of applications, a dozen
 * fields, turned into the list's own parameters), or their references; never the whole list
 * without a criterion. The scope is the list's: enabled applications, retired ones left out unless
 * the filter names the lifecycle.
 *
 * The card's count is the screen's dry run (`ApplicationsService.bulkUpdate`, the common contract).
 * A Business Contributor whose role was raised to member reaches the applications they own only:
 * the operation passes their scope itself, since a card of many rows names no record the common
 * write check could hold. The approval plays the write with the count's `as_of`, `expected_rows`
 * and fingerprint: a list that changed in between refuses it whole. No undo, as the screen; each
 * application's audit rows say "by Kad".
 */

const TOOL = 'bulk_update_applications';
/** The change's key on the card; the frontend labels it (`ai:previewCard.fields.application_bulk_edit`). */
const CARD_FIELD = 'application_bulk_edit';
const CARD_EXAMPLES = 5;
/** The most people one role receives from a card. */
const MAX_OWNERS = 20;

const FIELDS = ['owners_business', 'owners_it', 'category', 'lifecycle', 'criticality', 'cyber_criticality'] as const;
type BulkField = (typeof FIELDS)[number];
/** The catalog of the value a field holds, by field (the owners are people). */
const FIELD_CATALOG = {
  category: 'applicationCategories',
  lifecycle: 'lifecycleStates',
  criticality: 'businessCriticalityLevels',
  cyber_criticality: 'cyberCriticalityLevels',
} as const;
const OWNER_TYPES = { owners_business: 'business', owners_it: 'it' } as const;

/** The fields that take a value still offered by the workspace's catalog, by its name or its code. */
const OFFERED_FIELDS = {
  category: { list: 'applicationCategories', what: 'category', all: 'categories', emptied: false },
  criticality: { list: 'businessCriticalityLevels', what: 'business criticality level', all: 'levels', emptied: true },
  cyber_criticality: { list: 'cyberCriticalityLevels', what: 'cyber criticality level', all: 'levels', emptied: true },
} as const;
type OfferedField = keyof typeof OFFERED_FIELDS;

/** The fields of the filter: those that aim at applications. */
export const APPLICATION_BULK_FILTER_FIELDS = [
  'lifecycle', 'criticality', 'cyber_criticality', 'data_class', 'recovery_wave', 'category',
  'supplier', 'editor', 'it_owner', 'business_owner', 'external_facing', 'contains_pii',
] as const;
const ACCEPTED_FILTERS = APPLICATION_BULK_FILTER_FIELDS.join(', ');
/** The filter fields whose values are the workspace's catalog: named or coded, worded by their name. */
const CATALOG_FILTER_FIELDS = {
  lifecycle: 'lifecycleStates',
  category: 'applicationCategories',
  criticality: 'businessCriticalityLevels',
  cyber_criticality: 'cyberCriticalityLevels',
  data_class: 'dataClasses',
  recovery_wave: 'recoveryWaves',
} as const;
type CatalogFilterField = keyof typeof CATALOG_FILTER_FIELDS;
type CatalogList = (typeof CATALOG_FILTER_FIELDS)[CatalogFilterField];
const YES_NO_FILTER_FIELDS = new Set(['external_facing', 'contains_pii']);

/** Kad builds the filter from the person's words alone, as for the budget lines (lot K1). */
const ONLY_NAMED_CRITERIA = 'Use only the criteria the person named: never add a filter they did not name. '
  + 'A filter on the field being changed is a criterion only when the person named it ("the proposed applications to active").';

/** A field this tool does not take is said, then changed card by card (lot K1): on dev, Kad hid that the category is not changed in bulk. */
const OTHER_FIELD = 'Any other field is not changed in bulk: say so in the answer, with the fields that are (business owners, IT owners, category, lifecycle, business criticality, cyber criticality), '
  + 'then prepare one card per application as usual. Never present cards of one application each, nor a prepare_mutation_plan of them, as a change in bulk.';

const NO_CRITERION = 'Name the applications to change: a filter of the applications (lifecycle, criticality, supplier, owner...) or their references (rows). '
  + 'Kad does not change every application of the list at once: ask the person which applications.';

export const BulkUpdateApplicationsInputSchema = z.object({
  field: z.enum(FIELDS)
    .describe('The one field this card changes: owners_business, owners_it, category, lifecycle, criticality (business criticality) or cyber_criticality.'),
  value: z.union([z.string().trim().min(1).max(500), z.array(z.string().trim().min(1).max(320)).max(MAX_OWNERS), z.null()])
    .describe('The new value. owners_business and owners_it: the people (names or emails) who replace the role\'s, [] or null for nobody. '
      + 'category: a category of the workspace by its name or code, never null. lifecycle: a state of the workspace by its name or code, never null. '
      + 'criticality and cyber_criticality: a level by its name or code, null empties it.'),
  rows: z.array(z.string().trim().min(1).max(40)).min(1).max(BULK_MAX_ROWS).optional()
    .describe('The applications by reference (APP-12). Give rows or filters, not both.'),
  filters: z.record(z.string(), AI_BULK_FILTER_VALUE).optional()
    .describe(`The applications described by the query_entities filters of applications, as the list filters them: ${ACCEPTED_FILTERS}. Give rows or filters, not both.`),
}).strict().refine((value) => (value.rows !== undefined) !== (value.filters !== undefined), {
  message: 'Give the applications by reference (rows) or the applications filters (filters), one of the two.',
});

type BulkUpdateApplicationsInput = z.infer<typeof BulkUpdateApplicationsInputSchema>;

type Words = Record<AiWriteLanguage, string>;
type CatalogOption = { code: string; label: string; deprecated?: boolean; translations?: CatalogTranslations; shippedLabels?: string[] };

/** One part of the filter as stored on the card: its field, its values, and their words per language for a catalog field. */
type StoredFilterPart = { key: string; op: 'in' | 'not' | 'contains'; values: Array<string | null>; words?: Record<AiWriteLanguage, Array<string | null>> };

/** The change resolved: the contract's `changes`, and the value as the card shows it in each language (null: emptied). */
type ResolvedChange = { changes: BulkChanges; valueWords: Words | null };

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function counts(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([code, n]) => [code, Number(n) || 0]));
}

/**
 * A catalog value's name in each language, as the screen shows it (`localizeCatalogItem`): the
 * workspace's translation, else the shipped name in that language while the workspace keeps the
 * shipped value, else its own name.
 */
function optionWords(list: CatalogList, option: CatalogOption): Words {
  return Object.fromEntries(CATALOG_LOCALES.map((locale) => [
    locale,
    option.translations?.[locale]?.label || shippedLabelIn(list, option, locale) || option.label || option.code,
  ])) as Words;
}

function sameWords(value: string): Words {
  return { en: value, fr: value, de: value, es: value };
}

@Injectable()
export class BulkUpdateApplicationsAiMutationOperation implements AiMutationOperation<BulkUpdateApplicationsInput> {
  readonly toolName = TOOL;
  readonly description = 'Create a card that changes one field on two applications or more at once (business owners, IT owners, category, lifecycle, business criticality or cyber criticality), '
    + 'as the "Change the selection" of the applications list. Requires explicit user approval before execution. '
    + `${ONLY_NAMED_CRITERIA} A request on all the applications, with no other criterion, gets a question asking for one, and no card. ${OTHER_FIELD}`;
  readonly inputSchema = BulkUpdateApplicationsInputSchema;
  readonly inputSummary = {
    field: 'One of owners_business, owners_it, category, lifecycle, criticality, cyber_criticality.',
    value: 'owners_*: the people who replace the role\'s ([] for nobody); category: a category by name or code; lifecycle: a state by name or code; '
      + 'criticality, cyber_criticality: a level by name or code, or null.',
    rows: `Or: up to ${BULK_MAX_ROWS} application references (APP-12).`,
    filters: `Or: the query_entities filters of applications (${ACCEPTED_FILTERS}).`,
  };
  readonly businessResource = 'applications';
  readonly writePreview = {
    entity_type: 'applications',
    fields: [CARD_FIELD],
    reversible: false,
    prompt_hint: 'Use `bulk_update_applications` to change one field on several applications at once, as the "Change the selection" of the applications list: '
      + 'business owners or IT owners (the people given replace the role\'s people; [] leaves the role empty), the category (a category still offered, never empty), '
      + 'the lifecycle (a state of the workspace, never empty), the business criticality or the cyber criticality (a level still offered, or null). '
      + 'One field per card. Give a category, a state or a level by its name or its code. '
      + `Describe the applications with the query_entities filters of applications (\`filters\`: ${ACCEPTED_FILTERS}; take the exact values from get_filter_values) or name them (\`rows\`: APP-12), not both; at most ${BULK_MAX_ROWS} applications. `
      + 'A filter covers the enabled applications of the list, the retired ones left out unless it names the lifecycle. '
      + `${ONLY_NAMED_CRITERIA} A request on all the applications, with no other criterion, gets a question asking for one, and no card. `
      + `${OTHER_FIELD} `
      + 'For one of these fields on two applications or more, named or described by a filter, use this tool: one card, never update_business_record application by application nor prepare_mutation_plan. '
      + `The card lists each application it changes (up to ${AI_BULK_EDIT_LIST_MAX}) with its value before, and the person may leave any of them out before approving; it cannot be undone.`,
  };

  constructor(
    private readonly policy: AiPolicyService,
    private readonly applications: ApplicationsService,
    private readonly settings: ItOpsSettingsService,
    private readonly people: AiTaskMutationSupportService,
  ) {}

  resolveWriteFamily(): string {
    return 'applications';
  }

  prepareCreatePreview(
    context: AiExecutionContextWithManager,
    input: BulkUpdateApplicationsInput,
  ): Promise<AiPreparedMutationPreview> {
    return withAiBulkEditWaits(context.manager, () => this.prepareCard(context, input));
  }

  private async prepareCard(
    context: AiExecutionContextWithManager,
    input: BulkUpdateApplicationsInput,
  ): Promise<AiPreparedMutationPreview> {
    const parsed = BulkUpdateApplicationsInputSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Invalid input.');
    const request = parsed.data;
    const scope = await this.scopeOf(context);
    const change = await this.resolveChange(context, request.field, request.value);
    const chosen = request.rows ? await this.resolveRows(context, request.rows, scope) : null;
    const target = chosen
      ? { body: { ids: chosen.ids }, parts: null, defaultScope: false }
      : await this.resolveFilters(context, request.filters ?? {});
    const counted = await this.countCard(context, request.field, change.changes, target.body, [], null);
    const dry = counted.dry!;
    if (!dry.changes) {
      const refused = Object.entries(dry.refused).map(([code, n]) => `${code}: ${n}`).join(', ');
      throw new BadRequestException(
        `Nothing to change: of the ${dry.rows} application${dry.rows === 1 ? '' : 's'} reached, ${dry.unchanged} already hold this value`
        + `${refused ? ` and the others are refused (${refused})` : ''}.`,
      );
    }
    return {
      targetEntityType: 'applications',
      targetEntityId: null,
      mutationInput: {
        field: request.field,
        value_words: change.valueWords,
        changes: change.changes,
        ...(chosen ? { refs: chosen.refs } : {}),
        ...(target.parts ? { filter_parts: target.parts, default_scope: target.defaultScope } : {}),
        selection: target.body,
        as_of: dry.as_of,
        expected_rows: dry.rows,
        fingerprint: dry.fingerprint,
      },
      currentValues: counted.currentValues,
    };
  }

  /**
   * The card recounted with the applications the person left out (lot K2e of 26.12.1): the stored
   * selection and change, never the model's words again; the left out applications go in
   * `excluded`, which the approval signs with the rest of `mutation_input`, and stay listed, unticked.
   */
  prepareExclusions(context: AiExecutionContextWithManager, preview: AiMutationPreview, excluded: string[]): Promise<AiPreparedMutationPreview> {
    return withAiBulkEditWaits(context.manager, async () => {
      const mutation = (preview.mutation_input ?? {}) as Record<string, unknown>;
      const previous = storedBulkList(preview.current_values);
      if (!previous) throw new BadRequestException('This card does not list its applications: none can be left out.');
      const listed = new Set(previous.rows.map((row) => row.id));
      if (excluded.some((id) => !listed.has(id))) throw new BadRequestException('Only an application this card lists can be left out.');
      const selection = mutation.selection as Record<string, unknown> | undefined;
      if (!selection || typeof selection !== 'object' || !mutation.changes) throw new BadRequestException('Preview is missing its applications.');
      const counted = await this.countCard(context, text(mutation.field) as BulkField, mutation.changes as BulkChanges, selection, excluded, previous);
      const { excluded: _previous, ...rest } = mutation;
      return {
        targetEntityType: 'applications',
        targetEntityId: null,
        mutationInput: {
          ...rest,
          ...(excluded.length > 0 ? { excluded } : {}),
          as_of: counted.dry?.as_of ?? null,
          expected_rows: counted.dry?.rows ?? 0,
          fingerprint: counted.dry?.fingerprint ?? null,
        },
        currentValues: counted.currentValues,
      };
    });
  }

  /** A card with every application left out cannot be approved; "Approve all" leaves it out. */
  isApprovable(preview: AiMutationPreview): boolean {
    return this.approvalRefusal(preview) === null;
  }

  approvalRefusal(preview: AiMutationPreview): string | null {
    const values = (preview.current_values?.values ?? {}) as Record<string, unknown>;
    return values.changes !== undefined && Number(values.changes) === 0 ? BULK_EDIT_ALL_LEFT_OUT_MESSAGE : null;
  }

  /**
   * The count of a card (the screen's dry run) on its selection less the applications left out,
   * and what the card stores: the counts, the first applications, and, up to
   * `AI_BULK_EDIT_LIST_MAX`, the list of every application it changes with its value before.
   */
  private async countCard(
    context: AiExecutionContextWithManager,
    field: BulkField,
    changes: BulkChanges,
    selection: Record<string, unknown>,
    excluded: string[],
    previous: AiBulkList | null,
  ): Promise<{ dry: BulkEditResult<ApplicationBulkRow> | null; currentValues: Record<string, unknown> }> {
    const body = effectiveBulkSelection({ selection, excluded });
    const leftOut = excluded.length > 0 ? { excluded: excluded.length } : {};
    if (!body) {
      // Every chosen application left out: nothing to count, the card lists them unticked.
      return {
        dry: null,
        currentValues: {
          values: { rows: 0, changes: 0, unchanged: 0, refused: {}, examples: [], ...leftOut },
          bulk_list: bulkListWithExclusions({ rows: [], words: {} }, previous!, excluded),
        },
      };
    }
    const dry = await this.applications.bulkUpdate(
      { ...body, changes, dry_run: true },
      context.userId ?? null,
      { manager: context.manager, tenantId: context.tenantId, accessScope: await this.scopeOf(context), options: { changedIds: true, changedRows: true } },
    ) as BulkEditResult<ApplicationBulkRow>;
    const changed = dry.changed_rows ?? [];
    let list: AiBulkList | null = null;
    let examples: Array<{ ref: string; title: string }>;
    if (changed.length <= AI_BULK_EDIT_LIST_MAX) {
      const counted = await this.listOf(context, field, changed);
      list = previous ? bulkListWithExclusions(counted, previous, excluded) : counted;
      examples = counted.rows.slice(0, CARD_EXAMPLES).map((row) => ({ ref: row.ref, title: row.title }));
    } else {
      // The first applications that would change, by reference.
      examples = (await context.manager.query(
        `SELECT a.sequential_id AS ref, a.name AS title
           FROM applications a
          WHERE a.tenant_id = $1 AND a.id = ANY($2::uuid[])
          ORDER BY substring(a.sequential_id from '(\\d+)$')::bigint NULLS LAST, a.name
          LIMIT ${CARD_EXAMPLES}`,
        [context.tenantId, dry.changed_ids ?? []],
      )).map((row: { ref: string | null; title: string | null }) => ({ ref: text(row.ref), title: text(row.title) }));
    }
    return {
      dry,
      currentValues: {
        values: { rows: dry.rows, changes: dry.changes, unchanged: dry.unchanged, refused: dry.refused, examples, ...leftOut },
        ...(list ? { bulk_list: list } : {}),
      },
    };
  }

  /**
   * The applications a count changes, by reference, each with its value before as the screen names
   * it: a catalog value in each language, the owners by their names. An owner the person cannot read
   * makes the value before hidden, never named.
   */
  private async listOf(context: AiExecutionContextWithManager, field: BulkField, changed: ApplicationBulkRow[]): Promise<AiBulkList> {
    if (changed.length === 0) return { rows: [], words: {} };
    const named: Array<{ id: string; ref: string | null; title: string | null }> = await context.manager.query(
      `SELECT a.id::text AS id, a.sequential_id AS ref, a.name AS title FROM applications a WHERE a.tenant_id = $1 AND a.id = ANY($2::uuid[])`,
      [context.tenantId, changed.map((row) => row.id)],
    );
    const names = new Map(named.map((row) => [row.id, { ref: text(row.ref), title: text(row.title) }]));
    const words: AiBulkList['words'] = {};
    const before = new Map<string, Pick<AiBulkListRow, 'before' | 'hidden'>>();
    if (field === 'owners_business' || field === 'owners_it') {
      const type = OWNER_TYPES[field];
      const held = new Map(changed.map((row) => [row.id, row.owners.filter((owner) => owner.owner_type === type).map((owner) => owner.user_id)]));
      const people = Array.from(new Set(Array.from(held.values()).flat()));
      const found: Array<{ id: string; label: string }> = people.length === 0 ? [] : await context.manager.query(
        `SELECT u.id::text AS id, COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), u.email) AS label
           FROM users u WHERE u.tenant_id = $1 AND u.id = ANY($2::uuid[])`,
        [context.tenantId, people],
      );
      const labels = new Map(found.map((person) => [person.id, text(person.label)]));
      for (const [id, ids] of held) {
        if (ids.length === 0) before.set(id, { before: null });
        else if (ids.some((user) => !labels.has(user))) before.set(id, { before: null, hidden: true });
        else {
          const key = ids.join(',');
          words[key] = sameWords(ids.map((user) => labels.get(user)!).join(', '));
          before.set(id, { before: key });
        }
      }
    } else {
      const list = FIELD_CATALOG[field];
      const options = new Map((await this.catalog(context, list)).map((option) => [option.code, option]));
      for (const row of changed) {
        const code = row[field] ?? null;
        if (code !== null && !words[code]) {
          const option = options.get(code);
          words[code] = option ? optionWords(list, option) : sameWords(code);
        }
        before.set(row.id, { before: code });
      }
    }
    return sortedBulkList({
      rows: changed.map((row) => ({ id: row.id, ...(names.get(row.id) ?? { ref: '', title: '' }), ...before.get(row.id)!, kept: true })),
      words,
    });
  }

  presentPreview(preview: AiMutationPreview, language: AiWriteLanguage = 'en'): AiMutationPreviewPresentation {
    const mutation = (preview.mutation_input ?? {}) as Record<string, unknown>;
    const values = (preview.current_values?.values ?? {}) as Record<string, unknown>;
    const applied = preview.current_values?.applied as Record<string, unknown> | undefined;
    const field = text(mutation.field) as BulkField;
    const fieldLabel = APPLICATION_BULK_FIELD_LABELS[language][field] ?? field;
    const valueWords = mutation.value_words as Partial<Words> | null | undefined;
    const value = valueWords ? text(valueWords[language] ?? valueWords.en) : null;
    const changes = Number(values.changes) || 0;
    const done = applied ? Number(applied.changed) || 0 : changes;
    const filterParts = Array.isArray(mutation.filter_parts) ? (mutation.filter_parts as StoredFilterPart[]) : null;
    const refs = filterParts ? null : Array.isArray(mutation.refs) ? (mutation.refs as unknown[]).map(text) : [];
    const list = storedBulkList(preview.current_values);
    const card = bulkEditCardText({
      family: 'applications',
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
      excluded: bulkExcluded(mutation).length,
      listed: list !== null,
    }, language);
    const englishField = APPLICATION_BULK_FIELD_LABELS.en[field] ?? field;
    let summary = `Preview ${preview.id} ${preview.status}.`;
    switch (preview.status) {
      case 'pending': summary = `Change ${englishField} on ${bulkEditTitleText('applications', 'en', changes)}.`; break;
      case 'executed': summary = `${englishField} changed on ${bulkEditTitleText('applications', 'en', done)}.`; break;
      case 'rejected': summary = 'The change in bulk of applications was rejected.'; break;
      case 'expired': summary = 'The change in bulk of applications expired before approval.'; break;
      case 'failed': summary = preview.error_message || 'The change in bulk of applications failed.'; break;
    }
    if (language !== 'en') {
      summary = previewSummaryText(
        language,
        preview.status,
        bulkEditActionText(language, 'applications', fieldLabel, preview.status === 'executed' ? done : changes),
        { errorMessage: preview.error_message },
      );
    }
    return {
      target: { entity_type: 'applications', entity_id: null, ref: null, title: bulkEditCardTitleText('applications', language, changes, refs) },
      changes: { [CARD_FIELD]: { label: BULK_EDIT_CARD_LABEL[language], from: null, to: card, format: 'markdown' } },
      summary,
      // The list goes to the screen only: the model reads the counts of the card's change.
      ...(list ? { bulkEdit: bulkEditPreviewDto(list, fieldLabel, value, language) } : {}),
      ...(!list && preview.status === 'pending' && changes > AI_BULK_EDIT_LIST_MAX
        ? { assistantNote: bulkEditTooLongNote('applications', changes, AI_BULK_EDIT_LIST_MAX) }
        : {}),
      ...(preview.error_message === BULK_EDIT_ALL_LEFT_OUT_MESSAGE ? { errorMessage: BULK_EDIT_ALL_LEFT_OUT[language] } : {}),
    };
  }

  async executePreview(context: AiExecutionContextWithManager, preview: AiMutationPreview): Promise<void> {
    // Read again at approval: the right may have been withdrawn since the card.
    await this.policy.assertWriteAccess(context, 'applications', context.manager, { level: 'member' });
    const mutation = (preview.mutation_input ?? {}) as Record<string, unknown>;
    if (!mutation.selection || typeof mutation.selection !== 'object' || !mutation.changes) throw new BadRequestException('Preview is missing its applications.');
    // The card's selection less the applications left out: what the approval signed.
    const selection = effectiveBulkSelection(mutation);
    if (!selection) throw new BadRequestException(BULK_EDIT_ALL_LEFT_OUT_MESSAGE);
    // The count's instant, applications and fingerprint: a list that changed since refuses the write whole.
    const result = await withAiBulkEditWaits(context.manager, async () => this.applications.bulkUpdate(
      { ...selection, changes: mutation.changes, as_of: mutation.as_of, expected_rows: mutation.expected_rows, fingerprint: mutation.fingerprint },
      context.userId ?? null,
      { manager: context.manager, tenantId: context.tenantId, accessScope: await this.scopeOf(context), audit: buildAiMutationAudit(preview), options: { changedIds: true } },
    )) as BulkEditResult;
    const list = storedBulkList(preview.current_values);
    preview.current_values = {
      ...(preview.current_values ?? {}),
      applied: { changed: Number(result.changed) || 0, unchanged: result.unchanged, refused: result.refused },
      // The list stays on the card, each application it changed marked.
      ...(list ? { bulk_list: bulkListApplied(list, result.changed_ids ?? []) } : {}),
    };
  }

  /**
   * A Business Contributor's scope, as the screen's route resolves it: the applications they own,
   * unless another role reads the applications. The card of many rows names no record, so the
   * common check of the record in the write scope holds nothing: the scope goes to the list itself.
   */
  private scopeOf(context: AiExecutionContextWithManager): Promise<ParticipationAccessScope | undefined> {
    return resolveBusinessContributorScopeForUser(
      { manager: context.manager, userId: context.userId, tenantId: context.tenantId },
      'applications',
      'reader',
    );
  }

  /** A part of the filter in the person's language: the column's label, and the words of a catalog or a yes-or-no value. */
  private filterPartWords(part: StoredFilterPart, language: AiWriteLanguage): BulkFilterPart {
    const label = APPLICATION_FILTER_LABELS[language][part.key] ?? part.key;
    if (part.words) return { label, op: part.op, values: part.words[language] ?? part.values };
    if (YES_NO_FILTER_FIELDS.has(part.key)) {
      const words = APPLICATION_YES_NO_WORDS[language] as Record<string, string>;
      return { label, op: part.op, values: part.values.map((value) => (value === null ? null : words[value] ?? value)) };
    }
    return { label, op: part.op, values: part.values };
  }

  /** A catalog's values, each also known by the names the screen shows for a shipped value (as an import takes them). */
  private async catalog(context: AiExecutionContextWithManager, list: CatalogList): Promise<CatalogOption[]> {
    // The lifecycle states and the categories are the workspace's settings, the levels its classification catalog.
    const options = list === 'lifecycleStates' || list === 'applicationCategories'
      ? (await this.settings.getSettings(context.tenantId, { manager: context.manager }))[list]
      : (await this.settings.getClassificationCatalog(context.tenantId, { manager: context.manager }))[list];
    return ((options || []) as CatalogOption[]).map((option) => {
      const shippedLabels = shippedLabelsOf(list, option);
      return shippedLabels.length ? { ...option, shippedLabels } : option;
    });
  }

  /** The value in the contract's terms: people's ids, a state's or a level's code. */
  private async resolveChange(context: AiExecutionContextWithManager, field: BulkField, value: string | string[] | null): Promise<ResolvedChange> {
    if (field === 'owners_business' || field === 'owners_it') {
      const refs = value === null ? [] : Array.isArray(value) ? value : [value];
      const people: Array<{ id: string; label: string }> = [];
      for (const ref of refs) {
        try {
          const person = await this.people.resolveUserReference(context, ref);
          if (!people.some((known) => known.id === person.id)) people.push({ id: person.id, label: person.label });
        } catch (error) {
          if (error instanceof NotFoundException) throw new NotFoundException(`No person found matching "${ref}".`);
          throw error;
        }
      }
      return {
        changes: { [field]: people.map((person) => person.id) },
        valueWords: people.length === 0 ? null : sameWords(people.map((person) => person.label).join(', ')),
      };
    }
    if (Array.isArray(value)) throw new BadRequestException(`${field} takes one value.`);
    if (field === 'lifecycle') {
      if (value === null) throw new BadRequestException('The lifecycle of an application cannot be emptied.');
      const states = await this.catalog(context, 'lifecycleStates');
      const found = matchCatalogAliases(states, normalizeAlias(value));
      if (found.length !== 1) {
        throw new NotFoundException(`"${value}" is not a lifecycle state of this workspace. The states: ${states.map((state) => `${state.label} (${state.code})`).join(', ')}.`);
      }
      return { changes: { lifecycle: found[0].code }, valueWords: optionWords('lifecycleStates', found[0]) };
    }
    return this.resolveOffered(context, field, value);
  }

  /**
   * A category or a level, among those the workspace still offers: one no longer offered is refused,
   * by its name or its code, as the screen's dialog leaves it out. The card names it as the screen does.
   */
  private async resolveOffered(context: AiExecutionContextWithManager, field: OfferedField, value: string | null): Promise<ResolvedChange> {
    const { list, what, all, emptied } = OFFERED_FIELDS[field];
    if (value === null) {
      if (!emptied) throw new BadRequestException(`The ${what} of an application cannot be emptied.`);
      return { changes: { [field]: null }, valueWords: null };
    }
    const options = await this.catalog(context, list);
    const offered = options.filter((option) => !option.deprecated);
    const found = matchCatalogAliases(options, normalizeAlias(value));
    if (found.length !== 1 || found[0].deprecated) {
      throw new NotFoundException(`"${value}" is not a ${what} offered in this workspace. The ${all}: ${offered.map((option) => `${option.label} (${option.code})`).join(', ')}.`);
    }
    return { changes: { [field]: found[0].code }, valueWords: optionWords(list, found[0]) };
  }

  /**
   * The applications the references name, in this tenant and in the person's scope: `APP-n`, or a
   * bare number. A reference that names no application the person reaches is refused, the same for
   * an application gone and one outside a Business Contributor's scope. The card names the
   * applications by their key (`APP-12`), whatever was typed.
   */
  private async resolveRows(
    context: AiExecutionContextWithManager,
    refs: string[],
    scope: ParticipationAccessScope | undefined,
  ): Promise<{ ids: string[]; refs: string[] }> {
    const wanted = refs.map((ref) => {
      const match = ref.trim().match(/^(?:APP-)?0*(\d{1,9})$/i);
      if (!match) throw new BadRequestException(`"${ref}" is not an application reference (APP-12).`);
      return { ref, key: `APP-${match[1]}` };
    });
    const params: unknown[] = [context.tenantId, wanted.map((entry) => entry.key)];
    let where = '';
    if (scope) {
      params.push(scope.userId);
      where = ` AND ${applicationParticipantCondition('a', `$${params.length}`)}`;
    }
    const found: Array<{ id: string; ref: string }> = await context.manager.query(
      `SELECT a.id::text AS id, upper(a.sequential_id) AS ref
         FROM applications a
        WHERE a.tenant_id = $1 AND upper(a.sequential_id) = ANY($2::text[])${where}`,
      params,
    );
    const byRef = new Map(found.map((row) => [row.ref, row.id]));
    const missing = wanted.filter((entry) => !byRef.has(entry.key)).map((entry) => entry.ref);
    if (missing.length > 0) throw new NotFoundException(`No application ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ` (and ${missing.length - 10} more)` : ''} in this workspace.`);
    const chosen = new Map(wanted.map((entry) => [byRef.get(entry.key)!, entry.key]));
    return { ids: Array.from(chosen.keys()), refs: Array.from(chosen.values()) };
  }

  /**
   * The list's own parameters for a filter of Kad: the grid model of `adaptFilters` (the model the
   * screen's list sends), so the applications are those the list shows: enabled, retired ones left
   * out unless the filter names the lifecycle. A catalog value is taken by its name or its code. A
   * field outside the dozen accepted, ignored or with a value the field does not take is refused.
   */
  private async resolveFilters(
    context: AiExecutionContextWithManager,
    filters: Record<string, AiFilterValue>,
  ): Promise<{ body: { all: true; filters: Record<string, unknown> }; parts: StoredFilterPart[]; defaultScope: boolean }> {
    const keys = Object.keys(filters);
    const outside = keys.filter((key) => !(APPLICATION_BULK_FILTER_FIELDS as readonly string[]).includes(key));
    if (outside.length > 0) {
      throw new BadRequestException(`These applications filters cannot choose applications to change: ${outside.join(', ')}. Use ${ACCEPTED_FILTERS}; or name the applications (rows).`);
    }
    // A part without a value is no criterion: an empty exclusion would reach the whole list, or open the retired applications.
    if (keys.length === 0 || keys.some((key) => isEmptyAiBulkFilterValue(filters[key]))) throw new BadRequestException(NO_CRITERION);
    const coded: Record<string, AiFilterValue> = {};
    const parts: StoredFilterPart[] = [];
    for (const key of keys) {
      const value = filters[key];
      const negated = !!value && typeof value === 'object' && !Array.isArray(value) && 'not' in value;
      const op: StoredFilterPart['op'] = negated ? 'not' : 'in';
      const raw: Array<string | null> = negated
        ? (value as { not: Array<string | null> }).not
        : Array.isArray(value) ? value : typeof value === 'string' ? [value.trim()] : [];
      if (key in CATALOG_FILTER_FIELDS && raw.length > 0) {
        const list = CATALOG_FILTER_FIELDS[key as CatalogFilterField];
        const options = await this.catalog(context, list);
        const chosen = raw.map((entry) => {
          if (entry === null && key !== 'lifecycle') return null;
          const found = entry === null ? [] : matchCatalogAliases(options, normalizeAlias(entry));
          if (found.length !== 1) {
            throw new BadRequestException(`"${entry}" is not a value of the applications filter ${key}. It takes: ${options.map((option) => `${option.label} (${option.code})`).join(', ')}${key === 'lifecycle' ? '' : ', or null (not set)'}.`);
          }
          return found[0];
        });
        const codes = chosen.map((option) => (option === null ? null : option.code));
        coded[key] = negated ? { not: codes } : codes;
        const words = Object.fromEntries(CATALOG_LOCALES.map((locale) => [locale, chosen.map((option) => (option === null ? null : optionWords(list, option)[locale]))]));
        parts.push({ key, op, values: codes, words: words as StoredFilterPart['words'] });
        continue;
      }
      coded[key] = value;
      parts.push({ key, op, values: raw });
    }
    const registry = await resolveAiEntityRegistry(
      context,
      'applications',
      async (entityType) => this.policy.canReadEntityType(context, entityType, context.manager),
    );
    const adapted = adaptFilters(registry, coded);
    if (adapted.ignored.length > 0) {
      const named = adapted.ignored.map((field) => {
        const invalid = adapted.invalid_values.find((entry) => entry.field === field);
        return invalid ? `${field} (takes ${invalid.accepted.map((value) => value ?? 'null').join(', ')})` : field;
      });
      throw new BadRequestException(`These applications filters cannot be used: ${named.join('; ')}. Use ${ACCEPTED_FILTERS}, with the values get_filter_values gives.`);
    }
    return {
      body: { all: true, filters: { filters: adapted.filters } },
      parts,
      defaultScope: !Object.prototype.hasOwnProperty.call(filters, 'lifecycle'),
    };
  }
}
