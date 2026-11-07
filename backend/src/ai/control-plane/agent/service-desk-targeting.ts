import { BadRequestException } from '@nestjs/common';
import { OPEN_TICKET_STATUS_VALUES } from '../providers/provider-constants';
import { ProviderContext, TicketReferenceCatalogKind, TicketRecord, TicketingProvider } from '../providers/provider.types';
import { isRecord } from '../../../common/object-guards';

export const SERVICE_DESK_TARGETING_SCHEMA_VERSION = 1;
export { OPEN_TICKET_STATUS_VALUES };

export type ServiceDeskTargetPredicateOperator = 'eq' | 'in' | 'gte' | 'lte' | 'not';
export type ServiceDeskTargetPredicateResolution =
  | 'pushed_down'
  | 'locally_filtered_bounded_fetch'
  | 'control_plane_resolved'
  | 'unsupported';

export type ServiceDeskTargetPredicate = {
  field: string;
  operator: ServiceDeskTargetPredicateOperator;
  value: unknown;
};

export type ServiceDeskTargetingResolution = {
  predicate: ServiceDeskTargetPredicate;
  resolution: ServiceDeskTargetPredicateResolution;
  reason: string;
};

export type ServiceDeskTargetingModel = {
  schema_version: typeof SERVICE_DESK_TARGETING_SCHEMA_VERSION;
  combinator: 'and';
  predicates: ServiceDeskTargetPredicate[];
  resolution: ServiceDeskTargetingResolution[];
};

export type ServiceDeskTargetingFetchConfig = {
  mode: 'new_tickets_only' | 'all_open' | 'agent_involved';
  createdAfter: string | null;
  createdAfterRelativeHours: number | null;
  lastChangedBefore: string | null;
  statusValues: string[];
  entityId: string | null;
  categoryId: string | null;
};

export type TargetingPreviewSummary = {
  matchEstimate: number;
  sampleSize: number;
  capped: boolean;
  overlapEstimate: number;
  runsPerDayEstimate: number;
  resolution: ServiceDeskTargetingResolution[];
};

const SUPPORTED_OPERATORS = new Set(['eq', 'in', 'gte', 'lte', 'not']);
const OPEN_TICKET_STATUS_VALUE_SET = new Set(OPEN_TICKET_STATUS_VALUES);
// Runtime fetch bounds are derived from canonical predicates where safe, then
// predicates are rechecked locally. Do not label fields "pushed_down" until
// the bound provider's native search criteria are derived directly from those predicates.
const PUSHED_DOWN_FIELDS = new Set<string>();
const LOCAL_FILTER_FIELDS = new Set(['status', 'category', 'entity', 'created_at', 'updated_at', 'inactivity_age', 'priority', 'type']);
const CONTROL_PLANE_FIELDS = new Set(['touched_by']);

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function numericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value.trim().replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function numberInRange(value: unknown, fallback: number, min: number, max: number): number {
  const raw = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(raw)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(raw)));
}

function nestedPolicy(scopePolicy: Record<string, unknown>, key: string): Record<string, unknown> {
  return isRecord(scopePolicy[key]) ? scopePolicy[key] : {};
}

function stablePredicateKey(predicate: ServiceDeskTargetPredicate): string {
  return JSON.stringify({
    field: predicate.field,
    operator: predicate.operator,
    value: predicate.value,
  });
}

function dedupePredicates(predicates: ServiceDeskTargetPredicate[]): ServiceDeskTargetPredicate[] {
  const seen = new Set<string>();
  const result: ServiceDeskTargetPredicate[] = [];
  for (const predicate of predicates) {
    const key = stablePredicateKey(predicate);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(predicate);
    }
  }
  return result;
}

function normalizedPredicate(raw: unknown): ServiceDeskTargetPredicate {
  if (!isRecord(raw)) {
    throw new BadRequestException('Targeting predicates must be objects.');
  }
  const field = stringValue(raw.field)?.toLowerCase();
  const operator = stringValue(raw.operator)?.toLowerCase();
  if (!field || !/^[a-z][a-z0-9_]*$/.test(field)) {
    throw new BadRequestException('Targeting predicate field is invalid.');
  }
  if (!operator || !SUPPORTED_OPERATORS.has(operator)) {
    throw new BadRequestException(`Targeting predicate operator is unsupported for ${field}.`);
  }
  if (operator === 'in' && !Array.isArray(raw.value)) {
    throw new BadRequestException(`Targeting predicate ${field} requires an array value for "in".`);
  }
  if (Array.isArray(raw.any) || Array.isArray(raw.or) || Array.isArray(raw.predicates)) {
    throw new BadRequestException('Targeting supports AND predicates only; cross-field OR is not available.');
  }
  const value = field === 'status'
    ? normalizeStatusPredicateValue(operator as ServiceDeskTargetPredicateOperator, raw.value)
    : raw.value;
  return {
    field,
    operator: operator as ServiceDeskTargetPredicateOperator,
    value,
  };
}

function normalizeStatusPredicateValue(operator: ServiceDeskTargetPredicateOperator, value: unknown): unknown {
  if (operator === 'eq') {
    const canonical = stringValue(value)?.toLowerCase();
    return canonical && OPEN_TICKET_STATUS_VALUE_SET.has(canonical) ? canonical : value;
  }
  if (operator !== 'in' || !Array.isArray(value)) {
    return value;
  }
  const canonicalValues = value
    .map((entry) => stringValue(entry)?.toLowerCase() ?? null)
    .filter((entry): entry is string => !!entry && OPEN_TICKET_STATUS_VALUE_SET.has(entry));
  return canonicalValues.length > 0 ? Array.from(new Set(canonicalValues)) : value;
}

function scopeBlockPredicates(scopePolicy: Record<string, unknown>, mode: string): ServiceDeskTargetPredicate[] {
  const block = nestedPolicy(scopePolicy, mode);
  const predicates: ServiceDeskTargetPredicate[] = [];
  const entityId = stringValue(block.entity_id ?? block.entityId);
  const categoryId = stringValue(block.category_id ?? block.categoryId);
  if (entityId) {
    predicates.push({ field: 'entity', operator: 'eq', value: entityId });
  }
  if (categoryId) {
    predicates.push({ field: 'category', operator: 'eq', value: categoryId });
  }
  return predicates;
}

export function legacyScopeMode(scopePolicy: Record<string, unknown>): string {
  const mode = stringValue(scopePolicy.mode) ?? 'manual_safe_target';
  if (mode === 'all_open' || mode === 'agent_involved' || mode === 'new_tickets_only' || mode === 'manual_safe_target') {
    return mode;
  }
  return 'new_tickets_only';
}

function legacyPredicates(scopePolicy: Record<string, unknown>): ServiceDeskTargetPredicate[] {
  const mode = legacyScopeMode(scopePolicy);
  const predicates: ServiceDeskTargetPredicate[] = [];
  if (mode === 'agent_involved') {
    predicates.push({ field: 'touched_by', operator: 'eq', value: 'self' });
  }
  if (mode === 'all_open' || mode === 'agent_involved') {
    predicates.push({ field: 'status', operator: 'in', value: OPEN_TICKET_STATUS_VALUES });
    predicates.push(...scopeBlockPredicates(scopePolicy, mode));
    return dedupePredicates(predicates);
  }

  const block = nestedPolicy(scopePolicy, 'new_tickets_only');
  const horizonHours = numberInRange(block.hard_backfill_horizon_hours, 72, 1, 24 * 30);
  predicates.push({ field: 'created_at', operator: 'gte', value: { relative_hours: horizonHours } });
  predicates.push({ field: 'status', operator: 'in', value: OPEN_TICKET_STATUS_VALUES });
  predicates.push(...scopeBlockPredicates(scopePolicy, 'new_tickets_only'));
  return dedupePredicates(predicates);
}

export function resolveTargetingPredicates(predicates: ServiceDeskTargetPredicate[]): ServiceDeskTargetingResolution[] {
  return predicates.map((predicate) => {
    if (CONTROL_PLANE_FIELDS.has(predicate.field)) {
      return {
        predicate,
        resolution: 'control_plane_resolved',
        reason: 'Resolved from the workspace target state, not provider search.',
      };
    }
    if (PUSHED_DOWN_FIELDS.has(predicate.field)) {
      return {
        predicate,
        resolution: 'pushed_down',
        reason: 'Translated to the bound ticketing provider\'s native search criteria.',
      };
    }
    if (LOCAL_FILTER_FIELDS.has(predicate.field)) {
      return {
        predicate,
        resolution: 'locally_filtered_bounded_fetch',
        reason: 'Applied after a bounded provider fetch.',
      };
    }
    return {
      predicate,
      resolution: 'unsupported',
      reason: 'No safe provider or control-plane resolver exists for this predicate.',
    };
  });
}

export function normalizeServiceDeskTargeting(scopePolicy: unknown): ServiceDeskTargetingModel {
  const scope = isRecord(scopePolicy) ? scopePolicy : {};
  const rawTargeting = isRecord(scope.targeting) ? scope.targeting : null;
  const predicates = rawTargeting && Array.isArray(rawTargeting.predicates)
    ? rawTargeting.predicates.map(normalizedPredicate)
    : legacyPredicates(scope);
  const model: ServiceDeskTargetingModel = {
    schema_version: SERVICE_DESK_TARGETING_SCHEMA_VERSION,
    combinator: 'and',
    predicates: dedupePredicates(predicates),
    resolution: [],
  };
  model.resolution = resolveTargetingPredicates(model.predicates);
  const unsupported = model.resolution.find((entry) => entry.resolution === 'unsupported');
  if (unsupported) {
    throw new BadRequestException(`Unsupported targeting predicate: ${unsupported.predicate.field}.`);
  }
  return model;
}

export function normalizeServiceDeskScopePolicy(scopePolicy: unknown): Record<string, unknown> | null {
  if (scopePolicy == null) {
    return null;
  }
  const scope = isRecord(scopePolicy) ? { ...scopePolicy } : {};
  const targeting = normalizeServiceDeskTargeting(scope);
  return {
    ...scope,
    targeting,
  };
}

function comparableValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean);
  }
  return [String(value ?? '').trim().toLowerCase()].filter(Boolean);
}

function dateMs(value: unknown): number | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.getTime();
  }
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function predicateThresholdMs(value: unknown, now: Date): number | null {
  if (isRecord(value) && typeof value.relative_hours === 'number') {
    return now.getTime() - value.relative_hours * 60 * 60 * 1000;
  }
  if (isRecord(value) && typeof value.seconds === 'number') {
    return now.getTime() - value.seconds * 1000;
  }
  return dateMs(value);
}

function relativeHoursValue(value: unknown): number | null {
  if (!isRecord(value)) {
    return null;
  }
  const hours = numericValue(value.relative_hours);
  return hours != null && hours > 0 ? hours : null;
}

function secondsValue(value: unknown): number | null {
  if (isRecord(value)) {
    const seconds = numericValue(value.seconds);
    return seconds != null && seconds > 0 ? seconds : null;
  }
  const seconds = numericValue(value);
  return seconds != null && seconds > 0 ? seconds : null;
}

function absoluteOrRelativeDateIso(value: unknown, now: Date): { iso: string; relativeHours: number | null } | null {
  const relativeHours = relativeHoursValue(value);
  if (relativeHours != null) {
    return {
      iso: new Date(now.getTime() - relativeHours * 60 * 60 * 1000).toISOString(),
      relativeHours,
    };
  }
  const ms = dateMs(value);
  return ms == null ? null : { iso: new Date(ms).toISOString(), relativeHours: null };
}

function predicateSingleValue(predicate: ServiceDeskTargetPredicate): string | null {
  if (predicate.operator === 'eq') {
    return stringValue(predicate.value);
  }
  if (predicate.operator === 'in' && Array.isArray(predicate.value) && predicate.value.length === 1) {
    return stringValue(predicate.value[0]);
  }
  return null;
}

function predicateStatusValues(predicate: ServiceDeskTargetPredicate): string[] | null {
  if (predicate.field !== 'status' || (predicate.operator !== 'eq' && predicate.operator !== 'in')) {
    return null;
  }
  return comparableValues(predicate.value);
}

function intersectStatusValues(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

export function staleInactivitySecondsFromTargeting(targeting: ServiceDeskTargetingModel): number | null {
  let seconds: number | null = null;
  for (const predicate of targeting.predicates) {
    if (predicate.field !== 'inactivity_age' || predicate.operator !== 'gte') {
      continue;
    }
    const value = secondsValue(predicate.value);
    if (value == null) {
      continue;
    }
    seconds = seconds == null ? value : Math.max(seconds, value);
  }
  return seconds;
}

function priorityRank(value: unknown): number | null {
  const numeric = numericValue(value);
  if (numeric != null) {
    return numeric;
  }
  const key = String(value ?? '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  const ranks: Record<string, number> = {
    very_low: 1,
    lowest: 1,
    low: 2,
    medium: 3,
    normal: 3,
    high: 4,
    very_high: 5,
    major: 6,
    urgent: 6,
  };
  return ranks[key] ?? null;
}

function predicatePriorityRanks(value: unknown): number[] {
  const values = Array.isArray(value) ? value : [value];
  return values.map(priorityRank).filter((rank): rank is number => rank != null);
}

export function deriveServiceDeskTargetingFetchConfig(
  targeting: ServiceDeskTargetingModel,
  now: Date = new Date(),
): ServiceDeskTargetingFetchConfig {
  let touchedBySelf = false;
  let createdAfter: string | null = null;
  let createdAfterRelativeHours: number | null = null;
  let lastChangedBefore: string | null = null;
  let statusValues = comparableValues(OPEN_TICKET_STATUS_VALUES);
  let entityId: string | null = null;
  let categoryId: string | null = null;

  for (const predicate of targeting.predicates) {
    const predicateStatuses = predicateStatusValues(predicate);
    if (predicateStatuses) {
      statusValues = intersectStatusValues(statusValues, predicateStatuses);
      continue;
    }
    if (predicate.field === 'touched_by' && predicate.operator === 'eq' && comparableValues(predicate.value).includes('self')) {
      touchedBySelf = true;
      continue;
    }
    if (predicate.field === 'created_at' && predicate.operator === 'gte') {
      const bound = absoluteOrRelativeDateIso(predicate.value, now);
      if (bound) {
        createdAfter = bound.iso;
        createdAfterRelativeHours = bound.relativeHours;
      }
      continue;
    }
    if (predicate.field === 'updated_at' && predicate.operator === 'lte') {
      const bound = absoluteOrRelativeDateIso(predicate.value, now);
      if (bound) {
        lastChangedBefore = bound.iso;
      }
      continue;
    }
    if (predicate.field === 'inactivity_age' && predicate.operator === 'gte') {
      const seconds = secondsValue(predicate.value);
      if (seconds != null) {
        lastChangedBefore = new Date(now.getTime() - seconds * 1000).toISOString();
      }
      continue;
    }
    if (predicate.field === 'entity') {
      entityId = predicateSingleValue(predicate) ?? entityId;
      continue;
    }
    if (predicate.field === 'category') {
      categoryId = predicateSingleValue(predicate) ?? categoryId;
    }
  }

  return {
    mode: touchedBySelf ? 'agent_involved' : createdAfter ? 'new_tickets_only' : 'all_open',
    createdAfter,
    createdAfterRelativeHours,
    lastChangedBefore,
    statusValues,
    entityId,
    categoryId,
  };
}

function ticketValue(ticket: TicketRecord, field: string, now: Date): unknown {
  switch (field) {
    case 'status':
      return ticket.status;
    case 'category':
      return ticket.scope?.categoryId ?? null;
    case 'entity':
      return ticket.scope?.entityId ?? null;
    case 'created_at':
      return ticket.createdAt;
    case 'updated_at':
      return ticket.updatedAt;
    case 'inactivity_age': {
      const updated = dateMs(ticket.updatedAt);
      return updated == null ? null : Math.max(0, Math.floor((now.getTime() - updated) / 1000));
    }
    case 'priority':
      return ticket.priority ?? null;
    case 'type':
      return (ticket as unknown as Record<string, unknown>).type ?? null;
    default:
      return null;
  }
}

export function ticketMatchesServiceDeskTargeting(
  ticket: TicketRecord,
  targeting: ServiceDeskTargetingModel,
  opts: { agentTouched?: boolean; now?: Date } = {},
): boolean {
  const now = opts.now ?? new Date();
  for (const predicate of targeting.predicates) {
    if (predicate.field === 'touched_by') {
      const expectsSelf = comparableValues(predicate.value).includes('self');
      const touched = opts.agentTouched === true;
      if (predicate.operator === 'eq' && expectsSelf && !touched) return false;
      if (predicate.operator === 'not' && expectsSelf && touched) return false;
      continue;
    }
    const value = ticketValue(ticket, predicate.field, now);
    if (predicate.field === 'created_at' || predicate.field === 'updated_at') {
      const left = dateMs(value);
      const right = predicateThresholdMs(predicate.value, now);
      if (left == null || right == null) return false;
      if (predicate.operator === 'gte' && left < right) return false;
      if (predicate.operator === 'lte' && left > right) return false;
      if (predicate.operator === 'eq' && left !== right) return false;
      if (predicate.operator === 'not' && left === right) return false;
      continue;
    }
    if (predicate.field === 'inactivity_age') {
      const left = numberValue(value);
      const right = isRecord(predicate.value) ? numberValue(predicate.value.seconds) : numberValue(predicate.value);
      if (left == null || right == null) return false;
      if (predicate.operator === 'gte' && left < right) return false;
      if (predicate.operator === 'lte' && left > right) return false;
      if (predicate.operator === 'eq' && left !== right) return false;
      if (predicate.operator === 'not' && left === right) return false;
      continue;
    }
    if (predicate.field === 'priority') {
      const leftRank = priorityRank(value);
      const ranks = predicatePriorityRanks(predicate.value);
      if (leftRank != null && ranks.length > 0) {
        if (predicate.operator === 'gte' && leftRank < Math.min(...ranks)) return false;
        if (predicate.operator === 'lte' && leftRank > Math.max(...ranks)) return false;
        if ((predicate.operator === 'eq' || predicate.operator === 'in') && !ranks.includes(leftRank)) return false;
        if (predicate.operator === 'not' && ranks.includes(leftRank)) return false;
        continue;
      }
    }
    const left = String(value ?? '').trim().toLowerCase();
    const allowed = comparableValues(predicate.value);
    if (predicate.operator === 'eq' && !allowed.includes(left)) return false;
    if (predicate.operator === 'in' && !allowed.includes(left)) return false;
    if (predicate.operator === 'not' && allowed.includes(left)) return false;
  }
  return true;
}

export type ReferenceSubtreeResolver = (kind: TicketReferenceCatalogKind, ids: string[]) => Promise<string[]>;

function isTreeCatalogPredicate(predicate: ServiceDeskTargetPredicate): predicate is ServiceDeskTargetPredicate & { field: TicketReferenceCatalogKind } {
  return (predicate.field === 'category' || predicate.field === 'entity')
    && (predicate.operator === 'eq' || predicate.operator === 'in' || predicate.operator === 'not');
}

// Category/entity selections are recursive: expand predicate values to include all
// descendants (selected ids first) so eq/in/not matching covers whole subtrees.
// When the resolver cannot expand (provider error), it returns the input ids and
// matching degrades to exact-id behavior.
export async function expandServiceDeskTargetingSubtrees(
  targeting: ServiceDeskTargetingModel,
  resolver: ReferenceSubtreeResolver,
): Promise<ServiceDeskTargetingModel> {
  if (!targeting.predicates.some(isTreeCatalogPredicate)) {
    return targeting;
  }
  const predicates: ServiceDeskTargetPredicate[] = [];
  for (const predicate of targeting.predicates) {
    if (!isTreeCatalogPredicate(predicate)) {
      predicates.push(predicate);
      continue;
    }
    const roots = comparableValues(predicate.value);
    if (roots.length === 0) {
      predicates.push(predicate);
      continue;
    }
    const expanded = await resolver(predicate.field, roots);
    const merged = Array.from(new Set([
      ...roots,
      ...expanded.map((id) => String(id).trim().toLowerCase()).filter(Boolean),
    ]));
    predicates.push({ ...predicate, value: merged });
  }
  return { ...targeting, predicates };
}

// Provider-backed subtree resolver with per-instance memoization and a safe
// fallback: any provider failure resolves to the input ids (exact-id matching).
export function createProviderSubtreeResolver(
  provider: Pick<TicketingProvider, 'resolveReferenceSubtree'>,
  context: ProviderContext,
  onError?: (kind: TicketReferenceCatalogKind, ids: string[], message: string) => void,
): ReferenceSubtreeResolver {
  const memo = new Map<string, Promise<string[]>>();
  return (kind, ids) => {
    const key = `${kind}|${[...ids].sort().join(',')}`;
    let pending = memo.get(key);
    if (!pending) {
      pending = (async () => {
        try {
          const result = await provider.resolveReferenceSubtree(context, { kind, ids });
          if (result.ok === false) {
            onError?.(kind, ids, result.message ?? 'subtree resolution unavailable');
            return ids;
          }
          const expanded = result.data?.ids;
          return Array.isArray(expanded) && expanded.length > 0 ? expanded.map((id) => String(id)) : ids;
        } catch (error: any) {
          onError?.(kind, ids, String(error?.message ?? error ?? 'subtree resolution failed'));
          return ids;
        }
      })();
      memo.set(key, pending);
    }
    return pending;
  };
}
