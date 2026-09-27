import { BadRequestException } from '@nestjs/common';
import { AiEntityFilterRegistry, AiQueryEntityType } from './ai-filter.types';
import { getAiEntityRegistry } from './registries';

type SuspiciousQuickSearchClause = {
  field: string;
  operator: ':' | '=';
  value: string;
};

const RESERVED_QUERY_KEYS = ['scope', 'group_by', 'groupBy', 'metric', 'sort', 'page', 'limit'];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeClauseValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith('\'') && trimmed.endsWith('\''))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export function findStructuredQuickSearchClauses(
  entityType: AiQueryEntityType,
  q?: string | null,
  registry: AiEntityFilterRegistry = getAiEntityRegistry(entityType),
): SuspiciousQuickSearchClause[] {
  const quickSearch = String(q ?? '').trim();
  if (!quickSearch) {
    return [];
  }

  const keys = Array.from(new Set([
    ...Object.keys(registry.fields),
    ...RESERVED_QUERY_KEYS,
  ])).sort((a, b) => b.length - a.length);

  if (keys.length === 0) {
    return [];
  }

  const pattern = new RegExp(
    `(^|[\\s,(])(${keys.map(escapeRegExp).join('|')})\\s*([:=])\\s*("([^"\\\\]|\\\\.)+"|'([^'\\\\]|\\\\.)+'|[^\\s,;]+)`,
    'gi',
  );

  const clauses: SuspiciousQuickSearchClause[] = [];
  let match: RegExpExecArray | null = pattern.exec(quickSearch);
  while (match) {
    const field = match[2]?.trim();
    const operator = match[3] as ':' | '=';
    const value = normalizeClauseValue(match[4] ?? '');
    if (field && value) {
      clauses.push({ field, operator, value });
    }
    match = pattern.exec(quickSearch);
  }

  return clauses;
}

/** `registry`: the one resolved for the tenant, so its analytics dimension keys count as field names too. */
export function assertPlainTextQuickSearch(
  entityType: AiQueryEntityType,
  q?: string | null,
  registry?: AiEntityFilterRegistry,
): void {
  const clauses = findStructuredQuickSearchClauses(entityType, q, registry);
  if (clauses.length === 0) {
    return;
  }

  const examples = Array.from(new Set(clauses.map((clause) => `${clause.field}${clause.operator}${clause.value}`)));
  throw new BadRequestException(
    `Quick-search q must be plain text. Do not encode structured filters in q (${examples.join(', ')}). ` +
    'Use the filters field for entity attributes and scope for first-person ownership. ' +
    'If you intended a literal text search, remove the field:value or field=value syntax.',
  );
}
