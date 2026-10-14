type IgnoredFieldValidation = {
  status: 'invalid';
  blocking: true;
  ignored_fields: string[];
  source: 'filters_ignored' | 'fields_ignored' | 'sort_ignored';
  guidance: string;
};

function getIgnoredFields(
  value: unknown,
  key: 'filters_ignored' | 'fields_ignored' | 'sort_ignored',
): string[] {
  if (!value || typeof value !== 'object') {
    return [];
  }
  const candidate = (value as Record<string, unknown>)[key];
  if (!Array.isArray(candidate)) {
    return [];
  }
  return candidate
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
}

export function buildStructuredToolResultValidation(
  toolName: string,
  result: unknown,
): IgnoredFieldValidation | null {
  if (toolName === 'query_entities' || toolName === 'aggregate_entities') {
    const ignoredFields = getIgnoredFields(result, 'filters_ignored');
    if (ignoredFields.length === 0) {
      const ignoredSort = getIgnoredFields(result, 'sort_ignored');
      if (ignoredSort.length === 0) return null;
      return {
        status: 'invalid',
        blocking: true,
        ignored_fields: ignoredSort,
        source: 'sort_ignored',
        guidance:
          'The requested sort field is not supported: the items are in the default order shown in `sort`. Do not answer an ordering question (latest, oldest, largest) from this result. Query again with a field from `sortable_fields`.',
      };
    }
    return {
      status: 'invalid',
      blocking: true,
      ignored_fields: ignoredFields,
      source: 'filters_ignored',
      guidance:
        'One or more requested filters were ignored. Do not answer from this result. Repair the query first by choosing valid fields, using get_filter_values, switching entity, or using scope when appropriate.',
    };
  }

  if (toolName === 'get_filter_values') {
    const ignoredFields = getIgnoredFields(result, 'fields_ignored');
    if (ignoredFields.length === 0) {
      return null;
    }
    return {
      status: 'invalid',
      blocking: true,
      ignored_fields: ignoredFields,
      source: 'fields_ignored',
      guidance:
        'One or more requested filter fields are unsupported for this entity. Do not use those fields in a follow-up query. Repair the request first.',
    };
  }

  return null;
}
