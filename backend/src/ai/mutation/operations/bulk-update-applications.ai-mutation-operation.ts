import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { resolveBusinessContributorScopeForUser, applicationParticipantCondition, type ParticipationAccessScope } from '../../../auth/business-contributor-scope';
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
  bulkEditActionText,
  bulkEditCardText,
  bulkEditTitleText,
  type BulkFilterPart,
} from '../../ai-bulk-edit-texts';
import { AiWriteLanguage, previewSummaryText } from '../../ai-write-texts';
import { AiExecutionContextWithManager } from '../../ai.types';
import { adaptFilters } from '../../query/ai-filter.adapter';
import type { AiFilterValue } from '../../query/ai-filter.types';
import { resolveAiEntityRegistry } from '../../query/registries';
import { AI_BULK_FILTER_VALUE, isEmptyAiBulkFilterValue, withAiBulkEditWaits } from '../ai-bulk-edit';
import { buildAiMutationAudit } from '../ai-mutation-audit.util';
import { AiMutationOperation, AiMutationPreviewPresentation, AiPreparedMutationPreview } from '../ai-mutation-operation.types';
import { AiTaskMutationSupportService } from '../ai-task-mutation-support.service';

/**
 * Kad's change in bulk of applications (lot K1 of 26.11.9): the "Change the selection" of the
 * applications list, under a card the person approves. One field per card, among the dialog's:
 * business owners and IT owners (a list of people that replaces the role's, empty allowed), the
 * lifecycle (one of the workspace's states, never empty) and the business criticality (one of the
 * levels still offered, or empty). A state or a level is given by its name or its code. The
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
const CARD_FIELD_LABEL: Record<AiWriteLanguage, string> = {
  en: 'Change in bulk',
  fr: 'Modification en masse',
  de: 'Massenänderung',
  es: 'Modificación masiva',
};
const CARD_EXAMPLES = 5;
/** The most people one role receives from a card. */
const MAX_OWNERS = 20;

const FIELDS = ['owners_business', 'owners_it', 'lifecycle', 'criticality'] as const;
type BulkField = (typeof FIELDS)[number];

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

const NO_CRITERION = 'Name the applications to change: a filter of the applications (lifecycle, criticality, supplier, owner...) or their references (rows). '
  + 'Kad does not change every application of the list at once: ask the person which applications.';

export const BulkUpdateApplicationsInputSchema = z.object({
  field: z.enum(FIELDS)
    .describe('The one field this card changes: owners_business, owners_it, lifecycle or criticality (business criticality).'),
  value: z.union([z.string().trim().min(1).max(500), z.array(z.string().trim().min(1).max(320)).max(MAX_OWNERS), z.null()])
    .describe('The new value. owners_business and owners_it: the people (names or emails) who replace the role\'s, [] or null for nobody. '
      + 'lifecycle: a state of the workspace by its name or code, never null. criticality: a level by its name or code, null empties it.'),
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
  readonly description = 'Create a card that changes one field on many applications at once (business owners, IT owners, lifecycle or business criticality), '
    + 'as the "Change the selection" of the applications list. Requires explicit user approval before execution.';
  readonly inputSchema = BulkUpdateApplicationsInputSchema;
  readonly inputSummary = {
    field: 'One of owners_business, owners_it, lifecycle, criticality.',
    value: 'owners_*: the people who replace the role\'s ([] for nobody); lifecycle: a state by name or code; criticality: a level by name or code, or null.',
    rows: `Or: up to ${BULK_MAX_ROWS} application references (APP-12).`,
    filters: `Or: the query_entities filters of applications (${ACCEPTED_FILTERS}).`,
  };
  readonly businessResource = 'applications';
  readonly writePreview = {
    entity_type: 'applications',
    fields: [CARD_FIELD],
    reversible: false,
    prompt_hint: 'Use `bulk_update_applications` to change one field on several applications at once, as the "Change the selection" of the applications list: '
      + 'business owners or IT owners (the people given replace the role\'s people; [] leaves the role empty), the lifecycle (a state of the workspace, never empty) '
      + 'or the business criticality (a level still offered, or null). One field per card. Give a state or a level by its name or its code. '
      + `Describe the applications with the query_entities filters of applications (\`filters\`: ${ACCEPTED_FILTERS}; take the exact values from get_filter_values) or name them (\`rows\`: APP-12), not both; at most ${BULK_MAX_ROWS} applications. `
      + 'A filter covers the enabled applications of the list, the retired ones left out unless it names the lifecycle. Never change the whole list without a criterion: ask which applications. '
      + 'For more than a few applications, use this tool, never update_business_record application by application nor prepare_mutation_plan. The card counts the applications to change; it cannot be undone.',
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
    const dry = await this.applications.bulkUpdate(
      { ...target.body, changes: change.changes, dry_run: true },
      context.userId ?? null,
      { manager: context.manager, tenantId: context.tenantId, accessScope: scope, options: { changedIds: true } },
    ) as BulkEditResult;
    if (!dry.changes) {
      const refused = Object.entries(dry.refused).map(([code, n]) => `${code}: ${n}`).join(', ');
      throw new BadRequestException(
        `Nothing to change: of the ${dry.rows} application${dry.rows === 1 ? '' : 's'} reached, ${dry.unchanged} already hold this value`
        + `${refused ? ` and the others are refused (${refused})` : ''}.`,
      );
    }
    // The first applications that would change, by reference.
    const examples: Array<{ ref: string; title: string }> = (await context.manager.query(
      `SELECT a.sequential_id AS ref, a.name AS title
         FROM applications a
        WHERE a.tenant_id = $1 AND a.id = ANY($2::uuid[])
        ORDER BY substring(a.sequential_id from '(\\d+)$')::bigint NULLS LAST, a.name
        LIMIT ${CARD_EXAMPLES}`,
      [context.tenantId, dry.changed_ids ?? []],
    )).map((row: { ref: string | null; title: string | null }) => ({ ref: text(row.ref), title: text(row.title) }));
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
    const fieldLabel = APPLICATION_BULK_FIELD_LABELS[language][field] ?? field;
    const valueWords = mutation.value_words as Partial<Words> | null | undefined;
    const value = valueWords ? text(valueWords[language] ?? valueWords.en) : null;
    const changes = Number(values.changes) || 0;
    const done = applied ? Number(applied.changed) || 0 : changes;
    const filterParts = Array.isArray(mutation.filter_parts) ? (mutation.filter_parts as StoredFilterPart[]) : null;
    const card = bulkEditCardText({
      family: 'applications',
      selection: filterParts
        ? { kind: 'filter', parts: filterParts.map((part) => this.filterPartWords(part, language)), defaultScope: mutation.default_scope === true }
        : { kind: 'rows', refs: Array.isArray(mutation.refs) ? (mutation.refs as unknown[]).map(text) : [] },
      field: fieldLabel,
      value,
      rows: Number(values.rows) || 0,
      changes,
      unchanged: Number(values.unchanged) || 0,
      refused: counts(values.refused),
      examples: (Array.isArray(values.examples) ? values.examples as Array<Record<string, unknown>> : [])
        .map((row) => ({ ref: text(row.ref), title: text(row.title) })),
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
      target: { entity_type: 'applications', entity_id: null, ref: null, title: bulkEditTitleText('applications', language, changes) },
      changes: { [CARD_FIELD]: { label: CARD_FIELD_LABEL[language], from: null, to: card, format: 'markdown' } },
      summary,
    };
  }

  async executePreview(context: AiExecutionContextWithManager, preview: AiMutationPreview): Promise<void> {
    // Read again at approval: the right may have been withdrawn since the card.
    await this.policy.assertWriteAccess(context, 'applications', context.manager, { level: 'member' });
    const mutation = (preview.mutation_input ?? {}) as Record<string, unknown>;
    const selection = mutation.selection;
    if (!selection || typeof selection !== 'object' || !mutation.changes) throw new BadRequestException('Preview is missing its applications.');
    // The count's instant, applications and fingerprint: a list that changed since refuses the write whole.
    const result = await withAiBulkEditWaits(context.manager, async () => this.applications.bulkUpdate(
      { ...(selection as Record<string, unknown>), changes: mutation.changes, as_of: mutation.as_of, expected_rows: mutation.expected_rows, fingerprint: mutation.fingerprint },
      context.userId ?? null,
      { manager: context.manager, tenantId: context.tenantId, accessScope: await this.scopeOf(context), audit: buildAiMutationAudit(preview) },
    )) as BulkEditResult;
    preview.current_values = {
      ...(preview.current_values ?? {}),
      applied: { changed: Number(result.changed) || 0, unchanged: result.unchanged, refused: result.refused },
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
    if (value === null) return { changes: { criticality: null }, valueWords: null };
    const levels = await this.catalog(context, 'businessCriticalityLevels');
    const offered = levels.filter((level) => !level.deprecated);
    const found = matchCatalogAliases(levels, normalizeAlias(value));
    if (found.length !== 1 || found[0].deprecated) {
      throw new NotFoundException(`"${value}" is not a business criticality level offered in this workspace. The levels: ${offered.map((level) => `${level.label} (${level.code})`).join(', ')}.`);
    }
    return { changes: { criticality: found[0].code }, valueWords: optionWords('businessCriticalityLevels', found[0]) };
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
