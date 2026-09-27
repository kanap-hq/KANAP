import {
  AiEntityFilterRegistry,
  AiFilterDescription,
  AiFilterDescriptionResult,
  AiFilterFieldDef,
  AiFilterRepairSuggestion,
  AiFilterValue,
  AiQueryEntityType,
} from './ai-filter.types';
import { getAiEntityRegistry } from './registries';

const USER_FIELD_RE = /(assignee|creator|requestor|owner|lead|sponsor|contributor)/i;

function inferAcceptedValueKind(fieldName: string, field: AiFilterFieldDef): string {
  if (field.acceptedValueKind) return field.acceptedValueKind;
  if (field.type === 'set' && USER_FIELD_RE.test(fieldName)) return 'user_display_name';
  if (field.type === 'set' && /(company|department|supplier|team|category|stream|source|role)/i.test(fieldName)) {
    return 'exact_display_name';
  }
  if (field.type === 'set') return field.dynamic ? 'exact_value_from_get_filter_values' : 'one_of_declared_values';
  if (field.type === 'text') return 'plain_text';
  if (field.type === 'number') return 'number_comparison';
  if (field.type === 'date') return 'date_comparison';
  return field.type;
}

function inferDoesNotAccept(fieldName: string, field: AiFilterFieldDef): string[] {
  if (field.doesNotAccept) return field.doesNotAccept;
  if (field.type === 'set' && USER_FIELD_RE.test(fieldName)) return ['technical ids unless explicitly documented'];
  return [];
}

function inferExamples(fieldName: string, field: AiFilterFieldDef): string[] {
  if (field.examples) return field.examples;
  if (field.values?.length) return field.values.filter((value): value is string => typeof value === 'string').slice(0, 3);
  if (field.type === 'set' && USER_FIELD_RE.test(fieldName)) return ['Jane Doe'];
  if (field.type === 'text') return ['search text'];
  if (field.type === 'date') return ['{"op":"before","value":"2026-05-08"}'];
  if (field.type === 'number') return ['{"op":"gte","value":10}'];
  return [];
}

/** The fields of `registry`: pass the one resolved for the tenant (OPEX and CAPEX carry its analytics dimensions). */
export function describeAiEntityFilters(
  entityType: AiQueryEntityType,
  registry: AiEntityFilterRegistry = getAiEntityRegistry(entityType),
): AiFilterDescriptionResult {
  const fields: AiFilterDescription[] = Object.entries(registry.fields).map(([fieldName, field]) => ({
    field: fieldName,
    type: field.type,
    description: field.description,
    accepted_value_kind: inferAcceptedValueKind(fieldName, field),
    aliases: field.aliases ?? [],
    lookup_entity: field.lookupEntity ?? null,
    examples: inferExamples(fieldName, field),
    does_not_accept: inferDoesNotAccept(fieldName, field),
    discoverable: field.discoverable === true,
    sortable: field.sortable === true,
    groupable: field.groupable === true,
    aggregable: field.aggregable === true,
    ...(field.values ? { values: field.values } : {}),
  }));

  return {
    entity_type: entityType,
    fields,
    total: fields.length,
    returned: fields.length,
    truncated: false,
    complete: true,
  };
}

export function buildFilterRepairSuggestions(
  registry: AiEntityFilterRegistry,
  ignoredFields: string[],
): AiFilterRepairSuggestion[] {
  return ignoredFields.map((ignored) => {
    const aliasMatch = Object.values(registry.fields).find((field) => (field.aliases ?? []).includes(ignored));
    if (aliasMatch) {
      return {
        field: aliasMatch.ai,
        reason: `Use supported AI field "${aliasMatch.ai}" instead of unsupported alias "${ignored}".`,
      };
    }
    return {
      field: ignored,
      reason: `Unsupported AI filter field for ${registry.entityType}. Call describe_entity_filters to inspect valid fields.`,
    };
  });
}

export function hasEmailOrUuidFilterValue(value: AiFilterValue): boolean {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? [value]
      : [];
  return values.some((entry) => typeof entry === 'string' && (entry.includes('@') || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(entry)));
}
