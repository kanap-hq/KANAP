import { BadRequestException } from '@nestjs/common';
import {
  MONITORING_ACK_STATES,
  MONITORING_ALERT_STATUS_VALUES,
  MONITORING_SEVERITY_VALUES,
} from '../providers/provider-constants';
import { MonitoringAlert, MonitoringAlertListScope } from '../providers/provider.types';
import { isRecord } from '../../../common/object-guards';

export const MONITORING_TARGETING_SCHEMA_VERSION = 1;
export { MONITORING_ACK_STATES, MONITORING_ALERT_STATUS_VALUES, MONITORING_SEVERITY_VALUES };

// Default bounded-fetch statuses when no status predicate exists: every state
// that represents an active alert condition. `up` is excluded (nothing is
// wrong), `paused` is excluded (suppression is a deliberate operator choice —
// diagnosing paused checks would fight that intent), and `unknown` is excluded
// (no actionable signal, mostly probe/connectivity noise). Any of the three
// can still be targeted with an explicit status predicate.
export const DEFAULT_MONITORING_ALERT_STATUS_VALUES = MONITORING_ALERT_STATUS_VALUES.filter(
  (value) => value !== 'up' && value !== 'paused' && value !== 'unknown',
);

export type MonitoringTargetPredicateOperator = 'eq' | 'in' | 'gte' | 'not';
export type MonitoringTargetPredicateResolution =
  | 'pushed_down'
  | 'locally_filtered_bounded_fetch'
  | 'control_plane_resolved'
  | 'unsupported';

export type MonitoringTargetPredicate = {
  field: string;
  operator: MonitoringTargetPredicateOperator;
  value: unknown;
};

export type MonitoringTargetingResolution = {
  predicate: MonitoringTargetPredicate;
  resolution: MonitoringTargetPredicateResolution;
  reason: string;
};

export type MonitoringTargetingModel = {
  schema_version: typeof MONITORING_TARGETING_SCHEMA_VERSION;
  combinator: 'and';
  predicates: MonitoringTargetPredicate[];
  resolution: MonitoringTargetingResolution[];
};

const SUPPORTED_OPERATORS = new Set(['eq', 'in', 'gte', 'not']);
const MONITORING_ALERT_STATUS_VALUE_SET = new Set<string>(MONITORING_ALERT_STATUS_VALUES);
const MONITORING_SEVERITY_VALUE_SET = new Set<string>(MONITORING_SEVERITY_VALUES);
const MONITORING_ACK_STATE_SET = new Set<string>(MONITORING_ACK_STATES);
// Ordered lowest to highest (provider-constants contract); gte severity floors
// compare ladder indexes.
const SEVERITY_LADDER = MONITORING_SEVERITY_VALUES as readonly string[];

// Unlike the service-desk module — whose provider fetch modes predate
// predicate-derived search criteria and therefore keep PUSHED_DOWN_FIELDS
// empty — deriveMonitoringTargetingFetchConfig translates these predicates
// directly into MonitoringAlertListScope members the adapter executes
// natively, so they are honestly labeled `pushed_down`. Every pushed-down
// predicate is STILL re-verified by alertMatchesMonitoringTargeting after the
// fetch (defense against partial provider pushdown). Severity in/eq lists are
// the exception: the scope only carries a floor, so value lists are
// local-filter only.
const PUSHED_DOWN_REASON = 'Translated to the bound monitoring provider\'s alert scope and re-checked locally after the bounded fetch.';
const LOCAL_FILTER_REASON = 'Applied after a bounded provider fetch.';
const CONTROL_PLANE_REASON = 'Resolved from the workspace target state, not provider search.';

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
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

function comparableValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean);
  }
  return [String(value ?? '').trim().toLowerCase()].filter(Boolean);
}

// Vocabulary predicate values: every entry must be a non-empty string; the
// canonical form is lowercase. Returns null when any entry is malformed or the
// list is empty — fail closed, never silently drop entries.
function vocabularyValues(value: unknown): string[] | null {
  const entries = Array.isArray(value) ? value : [value];
  const result: string[] = [];
  for (const entry of entries) {
    const canonical = stringValue(entry)?.toLowerCase();
    if (!canonical) {
      return null;
    }
    result.push(canonical);
  }
  return result.length > 0 ? result : null;
}

// Provider reference ids (group/device/check_type): non-empty strings kept in
// their original case (ids are opaque provider tokens), numbers tolerated as
// numeric object ids. Returns null when any entry is malformed or empty.
function refIdValues(value: unknown): string[] | null {
  const entries = Array.isArray(value) ? value : [value];
  const result: string[] = [];
  for (const entry of entries) {
    const ref = stringValue(entry) ?? (typeof entry === 'number' && Number.isFinite(entry) ? String(entry) : null);
    if (!ref) {
      return null;
    }
    result.push(ref);
  }
  return result.length > 0 ? result : null;
}

function stablePredicateKey(predicate: MonitoringTargetPredicate): string {
  return JSON.stringify({
    field: predicate.field,
    operator: predicate.operator,
    value: predicate.value,
  });
}

function dedupePredicates(predicates: MonitoringTargetPredicate[]): MonitoringTargetPredicate[] {
  const seen = new Set<string>();
  const result: MonitoringTargetPredicate[] = [];
  for (const predicate of predicates) {
    const key = stablePredicateKey(predicate);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(predicate);
    }
  }
  return result;
}

function normalizePredicateValue(field: string, value: unknown): unknown {
  if (field === 'status' || field === 'severity' || field === 'ack_state' || field === 'touched_by') {
    if (Array.isArray(value)) {
      return value.map((entry) => stringValue(entry)?.toLowerCase() ?? entry);
    }
    return stringValue(value)?.toLowerCase() ?? value;
  }
  if (field === 'age_minutes') {
    return numericValue(value) ?? value;
  }
  if (field === 'group' || field === 'device' || field === 'check_type') {
    if (Array.isArray(value)) {
      return value.map((entry) => stringValue(entry) ?? entry);
    }
    return stringValue(value) ?? value;
  }
  return value;
}

function normalizedMonitoringPredicate(raw: unknown): MonitoringTargetPredicate {
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
  return {
    field,
    operator: operator as MonitoringTargetPredicateOperator,
    value: normalizePredicateValue(field, raw.value),
  };
}

// Field/operator/value validation and resolution classification in one pass:
// anything the control plane cannot safely resolve is labeled `unsupported`
// with a reason, and normalizeMonitoringTargeting rejects the whole model —
// a bad predicate can never persist (same fail-closed rule as ticketing).
export function resolveMonitoringTargetingPredicates(predicates: MonitoringTargetPredicate[]): MonitoringTargetingResolution[] {
  return predicates.map((predicate) => {
    const unsupported = (reason: string): MonitoringTargetingResolution => ({ predicate, resolution: 'unsupported', reason });
    const pushedDown = (): MonitoringTargetingResolution => ({ predicate, resolution: 'pushed_down', reason: PUSHED_DOWN_REASON });
    switch (predicate.field) {
      case 'touched_by': {
        // eq 'self' = only alerts this agent already handled; not 'self' = skip
        // alerts this agent already handled (occurrence-scoped, resolved from
        // KANAP target state). The local matcher supports both operators.
        const values = vocabularyValues(predicate.value);
        if ((predicate.operator !== 'eq' && predicate.operator !== 'not') || !values || values.length !== 1 || values[0] !== 'self') {
          return unsupported('touched_by supports only eq or not with the value "self".');
        }
        return { predicate, resolution: 'control_plane_resolved', reason: CONTROL_PLANE_REASON };
      }
      case 'status': {
        if (predicate.operator !== 'eq' && predicate.operator !== 'in' && predicate.operator !== 'not') {
          return unsupported(`Operator "${predicate.operator}" is not supported for status.`);
        }
        const values = vocabularyValues(predicate.value);
        if (!values || values.some((value) => !MONITORING_ALERT_STATUS_VALUE_SET.has(value))) {
          return unsupported('Status values must come from the normalized monitoring status vocabulary.');
        }
        return pushedDown();
      }
      case 'severity': {
        if (predicate.operator === 'gte') {
          const values = vocabularyValues(predicate.value);
          if (!values || values.length !== 1 || !MONITORING_SEVERITY_VALUE_SET.has(values[0])) {
            return unsupported('Severity floor must be a single normalized severity value.');
          }
          return pushedDown();
        }
        if (predicate.operator === 'eq' || predicate.operator === 'in') {
          const values = vocabularyValues(predicate.value);
          if (!values || values.some((value) => !MONITORING_SEVERITY_VALUE_SET.has(value))) {
            return unsupported('Severity values must come from the normalized severity ladder.');
          }
          // Floor-only pushdown: the alert scope cannot express a value list.
          return { predicate, resolution: 'locally_filtered_bounded_fetch', reason: LOCAL_FILTER_REASON };
        }
        return unsupported(`Operator "${predicate.operator}" is not supported for severity.`);
      }
      case 'ack_state': {
        const values = vocabularyValues(predicate.value);
        if (predicate.operator !== 'eq' || !values || values.length !== 1 || !MONITORING_ACK_STATE_SET.has(values[0])) {
          return unsupported('ack_state supports only eq with a normalized acknowledgement state.');
        }
        return pushedDown();
      }
      case 'group':
      case 'device':
      case 'check_type': {
        if (predicate.operator !== 'eq' && predicate.operator !== 'in') {
          return unsupported(`Operator "${predicate.operator}" is not supported for ${predicate.field}.`);
        }
        if (!refIdValues(predicate.value)) {
          return unsupported(`${predicate.field} requires provider reference ids.`);
        }
        return pushedDown();
      }
      case 'age_minutes': {
        if (predicate.operator !== 'gte') {
          return unsupported('age_minutes supports only gte (flap guard).');
        }
        const minutes = numericValue(predicate.value);
        if (minutes == null || minutes <= 0) {
          return unsupported('age_minutes requires a positive number of minutes.');
        }
        return pushedDown();
      }
      default:
        return unsupported('No safe provider or control-plane resolver exists for this predicate.');
    }
  });
}

export function normalizeMonitoringTargeting(scopePolicy: unknown): MonitoringTargetingModel {
  const scope = isRecord(scopePolicy) ? scopePolicy : {};
  const rawTargeting = isRecord(scope.targeting) ? scope.targeting : null;
  // Greenfield model: monitoring has no legacy scope-mode blocks to convert.
  // Absent targeting means "no predicates" — the SRE seed's inert placeholder
  // ({ schema_version: 1, combinator: 'and', predicates: [] }) round-trips
  // unchanged into the default bounded fetch.
  const predicates = rawTargeting && Array.isArray(rawTargeting.predicates)
    ? rawTargeting.predicates.map(normalizedMonitoringPredicate)
    : [];
  const model: MonitoringTargetingModel = {
    schema_version: MONITORING_TARGETING_SCHEMA_VERSION,
    combinator: 'and',
    predicates: dedupePredicates(predicates),
    resolution: [],
  };
  model.resolution = resolveMonitoringTargetingPredicates(model.predicates);
  const unsupported = model.resolution.find((entry) => entry.resolution === 'unsupported');
  if (unsupported) {
    throw new BadRequestException(`Unsupported targeting predicate: ${unsupported.predicate.field}.`);
  }
  return model;
}

export function normalizeMonitoringScopePolicy(scopePolicy: unknown): Record<string, unknown> | null {
  if (scopePolicy == null) {
    return null;
  }
  const scope = isRecord(scopePolicy) ? { ...scopePolicy } : {};
  const targeting = normalizeMonitoringTargeting(scope);
  return {
    ...scope,
    targeting,
  };
}

function intersectValues(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

function accumulateRefIds(current: string[] | null, predicate: MonitoringTargetPredicate): string[] | null {
  if (predicate.operator !== 'eq' && predicate.operator !== 'in') {
    return current;
  }
  const values = refIdValues(predicate.value);
  if (!values) {
    return current;
  }
  return current == null ? values : intersectValues(current, values);
}

// Collapses the predicates into the provider-native bounded fetch scope. The
// scope is a best-effort pushdown, never the authority: every derived bound is
// re-verified by alertMatchesMonitoringTargeting on each fetched alert, so a
// provider that ignores part of the scope cannot leak out-of-scope alerts into
// ingestion. Contradictory predicates may collapse a member to an empty list
// (the provider treats empty as its default); the local matcher then rejects
// every candidate, which is the correct AND semantics.
export function deriveMonitoringTargetingFetchConfig(
  targeting: MonitoringTargetingModel,
  opts: { maxResults: number },
): MonitoringAlertListScope {
  let statusSelected: string[] | null = null;
  const statusExcluded = new Set<string>();
  let severityFloor: string | null = null;
  let ackState: string | null = null;
  let groupIds: string[] | null = null;
  let deviceIds: string[] | null = null;
  let checkTypeIds: string[] | null = null;
  let minAgeMinutes: number | null = null;

  for (const predicate of targeting.predicates) {
    if (predicate.field === 'status' && (predicate.operator === 'eq' || predicate.operator === 'in')) {
      const values = comparableValues(predicate.value).filter((value) => MONITORING_ALERT_STATUS_VALUE_SET.has(value));
      if (values.length > 0) {
        statusSelected = statusSelected == null ? values : intersectValues(statusSelected, values);
      }
      continue;
    }
    if (predicate.field === 'status' && predicate.operator === 'not') {
      // Exclusions subtract from the working set; a lone `not` predicate never
      // widens the fetch beyond the non-up default (an explicit eq/in is the
      // only way to target up/paused/unknown states).
      for (const value of comparableValues(predicate.value)) {
        statusExcluded.add(value);
      }
      continue;
    }
    if (predicate.field === 'severity' && predicate.operator === 'gte') {
      const floor = stringValue(predicate.value)?.toLowerCase() ?? null;
      const floorIndex = floor ? SEVERITY_LADDER.indexOf(floor) : -1;
      if (floorIndex >= 0 && (severityFloor == null || floorIndex > SEVERITY_LADDER.indexOf(severityFloor))) {
        severityFloor = floor;
      }
      // Severity eq/in lists are local-filter only (no scope member).
      continue;
    }
    if (predicate.field === 'ack_state' && predicate.operator === 'eq') {
      ackState = stringValue(predicate.value)?.toLowerCase() ?? ackState;
      continue;
    }
    if (predicate.field === 'group') {
      groupIds = accumulateRefIds(groupIds, predicate);
      continue;
    }
    if (predicate.field === 'device') {
      deviceIds = accumulateRefIds(deviceIds, predicate);
      continue;
    }
    if (predicate.field === 'check_type') {
      checkTypeIds = accumulateRefIds(checkTypeIds, predicate);
      continue;
    }
    if (predicate.field === 'age_minutes' && predicate.operator === 'gte') {
      const minutes = numericValue(predicate.value);
      if (minutes != null && minutes > 0) {
        minAgeMinutes = minAgeMinutes == null ? minutes : Math.max(minAgeMinutes, minutes);
      }
    }
    // touched_by (control-plane resolved) and unknown fields contribute
    // nothing to the provider scope.
  }

  const baseStatuses = statusSelected ?? [...DEFAULT_MONITORING_ALERT_STATUS_VALUES];
  return {
    statusValues: baseStatuses.filter((value) => !statusExcluded.has(value)),
    severityFloor,
    ackState,
    groupIds,
    deviceIds,
    checkTypeIds,
    minAgeMinutes,
    maxResults: opts.maxResults,
  };
}

// Optional adapter metadata carried outside the normalized MonitoringAlert
// shape (same cast pattern as the ticketing matcher's `type` field): richer
// adapters may attach groupId/deviceId/checkTypeId to their alert records for
// exact-id verification.
function alertMetadataString(alert: MonitoringAlert, key: string): string | null {
  const raw = (alert as unknown as Record<string, unknown>)[key];
  return typeof raw === 'string' && raw.trim() ? raw.trim().toLowerCase() : null;
}

// Group pushdown is id-scoped at the provider (e.g. PRTG filters by objid), so
// the local re-check matches the alert's group ref id when the adapter exposes
// one, and falls back to the human-readable groupPath elements — the fallback
// covers name-based refs, which is all the normalized alert carries.
function groupPredicateMatches(alert: MonitoringAlert, predicate: MonitoringTargetPredicate): boolean {
  const wanted = new Set(comparableValues(predicate.value));
  const groupId = alertMetadataString(alert, 'groupId');
  if (groupId && wanted.has(groupId)) {
    return true;
  }
  return (alert.groupPath ?? []).some((element) => wanted.has(String(element).trim().toLowerCase()));
}

function devicePredicateMatches(alert: MonitoringAlert, predicate: MonitoringTargetPredicate): boolean {
  const wanted = new Set(comparableValues(predicate.value));
  const deviceId = alertMetadataString(alert, 'deviceId');
  if (deviceId && wanted.has(deviceId)) {
    return true;
  }
  const deviceName = String(alert.deviceName ?? '').trim().toLowerCase();
  return !!deviceName && wanted.has(deviceName);
}

// Local re-verification of every predicate against a fetched alert — the
// authority over whatever the provider returned for the pushed-down scope.
export function alertMatchesMonitoringTargeting(
  alert: MonitoringAlert,
  targeting: MonitoringTargetingModel,
  context: { touchedBySelf?: boolean; now?: Date } = {},
): boolean {
  const now = context.now ?? new Date();
  for (const predicate of targeting.predicates) {
    if (predicate.field === 'touched_by') {
      const expectsSelf = comparableValues(predicate.value).includes('self');
      const touched = context.touchedBySelf === true;
      if (predicate.operator === 'eq' && expectsSelf && !touched) return false;
      if (predicate.operator === 'not' && expectsSelf && touched) return false;
      continue;
    }
    if (predicate.field === 'age_minutes') {
      const threshold = numericValue(predicate.value);
      const startedMs = dateMs(alert.occurrenceStartedAt);
      // Fail closed: without a known occurrence start the alert cannot prove
      // its age, which keeps flapping/paused candidates out (D4 flap guard).
      if (threshold == null || startedMs == null) return false;
      const ageMinutes = (now.getTime() - startedMs) / 60_000;
      if (predicate.operator === 'gte' && ageMinutes < threshold) return false;
      continue;
    }
    if (predicate.field === 'severity') {
      const alertRank = SEVERITY_LADDER.indexOf(String(alert.severity ?? '').trim().toLowerCase());
      if (predicate.operator === 'gte') {
        const floor = stringValue(predicate.value)?.toLowerCase() ?? '';
        const floorRank = SEVERITY_LADDER.indexOf(floor);
        if (alertRank < 0 || floorRank < 0 || alertRank < floorRank) return false;
        continue;
      }
      const allowed = comparableValues(predicate.value);
      const left = String(alert.severity ?? '').trim().toLowerCase();
      if ((predicate.operator === 'eq' || predicate.operator === 'in') && !allowed.includes(left)) return false;
      if (predicate.operator === 'not' && allowed.includes(left)) return false;
      continue;
    }
    if (predicate.field === 'group') {
      const matched = groupPredicateMatches(alert, predicate);
      if ((predicate.operator === 'eq' || predicate.operator === 'in') && !matched) return false;
      if (predicate.operator === 'not' && matched) return false;
      continue;
    }
    if (predicate.field === 'device') {
      const matched = devicePredicateMatches(alert, predicate);
      if ((predicate.operator === 'eq' || predicate.operator === 'in') && !matched) return false;
      if (predicate.operator === 'not' && matched) return false;
      continue;
    }
    if (predicate.field === 'check_type') {
      // Fail closed when the adapter exposes no check-type metadata on the
      // alert: a predicate the control plane cannot verify never silently
      // passes (mirror of the ticketing matcher's strictness).
      const checkTypeId = alertMetadataString(alert, 'checkTypeId') ?? alertMetadataString(alert, 'checkType');
      if (!checkTypeId) return false;
      const allowed = comparableValues(predicate.value);
      if ((predicate.operator === 'eq' || predicate.operator === 'in') && !allowed.includes(checkTypeId)) return false;
      if (predicate.operator === 'not' && allowed.includes(checkTypeId)) return false;
      continue;
    }
    if (predicate.field === 'status' || predicate.field === 'ack_state') {
      const left = String((predicate.field === 'status' ? alert.status : alert.ackState) ?? '').trim().toLowerCase();
      const allowed = comparableValues(predicate.value);
      if ((predicate.operator === 'eq' || predicate.operator === 'in') && !allowed.includes(left)) return false;
      if (predicate.operator === 'not' && allowed.includes(left)) return false;
      continue;
    }
    // Unknown fields never survive normalization; fail closed regardless.
    return false;
  }
  return true;
}

export type MonitoringTargetingPresetKey = 'unacknowledged_down' | 'critical_and_high' | 'stable_down_10min';

export type MonitoringTargetingPreset = {
  key: MonitoringTargetingPresetKey;
  predicates: () => MonitoringTargetPredicate[];
};

// Starter targeting recipes shared by the settings UI and the SRE seed. Each
// entry is a factory so every consumer receives a fresh predicate array.
export const MONITORING_TARGETING_PRESETS: readonly MonitoringTargetingPreset[] = [
  {
    // Unacknowledged down alerts — the default triage inbox.
    key: 'unacknowledged_down',
    predicates: () => [
      { field: 'status', operator: 'in', value: ['down', 'down_partial'] },
      { field: 'ack_state', operator: 'eq', value: 'unacknowledged' },
    ],
  },
  {
    // Critical & high severity, any active state.
    key: 'critical_and_high',
    predicates: () => [
      { field: 'severity', operator: 'gte', value: 'high' },
    ],
  },
  {
    // Down for at least 10 minutes — flap-guarded stable outages.
    key: 'stable_down_10min',
    predicates: () => [
      { field: 'status', operator: 'in', value: ['down', 'down_partial'] },
      { field: 'age_minutes', operator: 'gte', value: 10 },
    ],
  },
];
