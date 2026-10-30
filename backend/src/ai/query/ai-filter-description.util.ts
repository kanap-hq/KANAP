import {
  AiAdaptedFilters,
  AiEntityFilterRegistry,
  AiFieldFamilyDescription,
  AiFilterDescription,
  AiFilterDescriptionResult,
  AiFilterFieldDef,
  AiFilterRepairSuggestion,
  AiFilterValue,
  AiInvalidFilterValue,
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
  const fields: AiFilterDescription[] = [];
  const families = new Map<string, AiFieldFamilyDescription>();
  for (const [fieldName, field] of Object.entries(registry.fields)) {
    if (field.family) {
      const family = families.get(field.family) ?? {
        family: field.family,
        type: field.type,
        description: field.description,
        accepted_value_kind: inferAcceptedValueKind(fieldName, field),
        examples: inferExamples(fieldName, field),
        sortable: field.sortable === true,
        groupable: field.groupable === true,
        aggregable: field.aggregable === true,
        fields: [],
      };
      family.fields.push(fieldName);
      families.set(field.family, family);
      continue;
    }
    fields.push({
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
    });
  }

  return {
    entity_type: entityType,
    fields,
    ...(families.size ? { field_families: [...families.values()] } : {}),
    ...(registry.metricFamilies?.length ? { metric_families: registry.metricFamilies } : {}),
    ...(registry.withheldFields?.length ? { fields_withheld: registry.withheldFields } : {}),
    // The keys of a family are listed in it, not here.
    sort_fields: Object.keys(registry.sortFields).filter((key) => !registry.fields[key]?.family),
    default_sort: registry.defaultSort,
    total: fields.length,
    returned: fields.length,
    truncated: false,
    complete: true,
  };
}

/**
 * The refusal fields of a query or an aggregate whose filters did not all apply: the status
 * (`invalid_filter_value` when each filter not applied is a known field given values it does not
 * take), a repair per filter, and the refused values with the accepted ones.
 */
export function invalidFilterResult(registry: AiEntityFilterRegistry, adapted: AiAdaptedFilters): {
  status: 'invalid_filter' | 'invalid_filter_value';
  suggested_repairs: AiFilterRepairSuggestion[];
  invalid_filter_values?: AiInvalidFilterValue[];
} {
  const byField = new Map(adapted.invalid_values.map((entry) => [entry.field, entry]));
  const onlyValues = adapted.ignored.every((field) => byField.has(field));
  return {
    status: onlyValues ? 'invalid_filter_value' : 'invalid_filter',
    suggested_repairs: buildFilterRepairSuggestions(registry, adapted.ignored, byField),
    ...(byField.size ? { invalid_filter_values: adapted.invalid_values } : {}),
  };
}

export function buildFilterRepairSuggestions(
  registry: AiEntityFilterRegistry,
  ignoredFields: string[],
  invalidValues: Map<string, AiInvalidFilterValue> = new Map(),
): AiFilterRepairSuggestion[] {
  return ignoredFields.map((ignored) => {
    const invalid = invalidValues.get(ignored);
    if (invalid) {
      const list = (values: Array<string | null>) => values.map((value) => (value === null ? 'null' : `"${value}"`)).join(', ');
      return {
        field: ignored,
        reason: `${list(invalid.rejected)} is not a value of ${ignored} on ${registry.entityType}. Accepted values: ${list(invalid.accepted)}. Nothing was searched: query again with an accepted value.`,
      };
    }
    // A field the person may not read: the reason, never a field "to inspect".
    const withheld = registry.withheldFields?.find((entry) => entry.field === ignored);
    if (withheld) return { field: ignored, reason: withheld.reason };
    // A field of the family given a value it does not take: the form it takes, never "unsupported".
    const known = registry.fields[ignored];
    if (known) {
      const form = known.type === 'number'
        ? 'a number alone (2026 means {"op":"eq","value":2026}) or a comparison'
        : inferAcceptedValueKind(ignored, known).replace(/_/g, ' ');
      return {
        field: ignored,
        reason: `${ignored} is a ${known.type} field of ${registry.entityType}, and the value given is not one it takes. It takes ${form}, for example ${inferExamples(ignored, known).join(' or ')}. Nothing was searched: query again with that form.`,
      };
    }
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
