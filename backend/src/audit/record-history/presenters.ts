import { formatCentsFixed, toCents } from '../../common/amount';
import type { FamilyKey, ReferenceRow } from './families';
import { historyFields } from './fields';
import {
  recordHistoryChildKind,
  type RecordHistoryChildKind,
  type RecordHistoryRecord,
} from '../record-history.inventory';
import { deepEqual, isPlainObject, isUuid, linkSetIds } from './values';

/**
 * The presentation of one audit row: its action, its author, and the fields that changed, in words.
 *
 * The service reads the page and resolves every reference; a child kind (`version`, `link`,
 * `contact`, `task`...) decides how its rows read. The record itself reads from the allow-list of
 * its audit label (`fields.ts`); an undeclared key never comes out. One function per child kind,
 * plus the generic before/after reader the record and its versions share.
 *
 * The page context (`PageContext`) carries what the reader may name: the authors, the versions,
 * the references resolved under their screen rules, and the analytics dimensions.
 */

export type RecordHistoryActorKind = 'user' | 'system' | 'import' | 'assistant';
export type RecordHistoryActor = { kind: RecordHistoryActorKind; name: string | null };

/** A visible reference: the business label, and the reference when the family has one. */
export type RecordHistoryReference = {
  kind: string;
  id: string;
  label: string | null;
  reference?: string | null;
};

/** A reference the person may not read, or a record deleted or outside their access. */
export type RecordHistoryHiddenReference = { hidden: true; kind: string };

export type RecordHistoryChange = {
  field: string;
  before?: unknown;
  after?: unknown;
  event?: 'added' | 'removed';
  /** The budget year of an amount change (or of a column operation). */
  year?: number;
  /** The budget column of an amount change. */
  column?: string;
  /** The year a copied column or allocation comes from. */
  sourceYear?: number;
  /** The column a copied column comes from. */
  sourceColumn?: string;
  /** An allocation copy replaced the destination's manual rows. */
  overwrite?: boolean;
  /** A negative percentage applied by a column copy. */
  percentageIncrease?: string;
  /** The month totals are equal, only their distribution changed. */
  monthlyOnly?: boolean;
  /** The months whose values changed (`YYYY-MM`). */
  months?: string[];
  /** The twelve months of the year are covered, or the payload carries yearly totals. */
  wholeYear?: boolean;
  /** The dimension a value belongs to (a line's analytics values). */
  dimension?: string | null;
  /** Allocation or costed-line changes whose counts are equal. */
  changed?: boolean;
};

export type RecordHistorySubject = {
  kind: 'record' | RecordHistoryChildKind;
  label?: string | null;
};

export type RecordHistoryItem = {
  id: string;
  at: string;
  action: string;
  actor: RecordHistoryActor;
  subject: RecordHistorySubject;
  changes: RecordHistoryChange[];
};

export type RecordHistoryPage = {
  items: RecordHistoryItem[];
  nextCursor: string | null;
};

/** One audit row of a record's page, as the two indexed branches read it. */
export type AuditRow = {
  id: string;
  table_name: string;
  record_id: string | null;
  action: string;
  before_json: unknown;
  after_json: unknown;
  user_id: string | null;
  source: string | null;
  created_at: Date | string;
  created_at_text: string;
};

/** What one page of a record's history names, resolved before any row is presented. */
export type PageContext = {
  entry: RecordHistoryRecord;
  recordId: string;
  users: Map<string, ReferenceRow>;
  versions: Map<string, { name: string | null; year: number | null }>;
  references: Map<FamilyKey, Map<string, ReferenceRow>>;
  readable: Record<FamilyKey, boolean>;
  dimensions: Map<string, string>;
  categories: Map<string, string>;
};

const AMOUNT_MEASURES = ['planned', 'committed', 'forecast', 'actual', 'expected_landing'] as const;

const CHILD_KIND_LABELS: Record<RecordHistoryChildKind, string> = {
  version: 'version',
  amounts: 'amounts',
  allocations: 'allocations',
  round_input: 'round_input',
  link: 'link',
  attachment: 'attachment',
  contact: 'contact',
  application: 'application',
  technology: 'technology',
  asset: 'asset',
  contract: 'contract',
  project: 'project',
  request: 'request',
  task: 'task',
  metrics: 'metrics',
};

/** The children whose creation is a title only: a version, a budget input, an allocation. */
const TECHNICAL_CHILD_KINDS: ReadonlySet<RecordHistoryChildKind> = new Set(['version', 'round_input', 'allocations']);

/**
 * A technical child's creation: the entry reads as its title, with no field list. A version and a
 * budget input say it with their action; an allocation is written as an update, and its first rows
 * (an empty before, rows after) are its creation.
 */
function technicalCreation(row: AuditRow, kind: RecordHistoryChildKind | null): boolean {
  if (!kind || !TECHNICAL_CHILD_KINDS.has(kind)) return false;
  if (row.action === 'create') return true;
  if (kind === 'allocations') {
    // A copy or a clear is an operation with its own detail, never a plain creation.
    if (isPlainObject(row.after_json) && typeof row.after_json.operation === 'string') return false;
    return (allocationCount(row.before_json) ?? 0) === 0 && (allocationCount(row.after_json) ?? 0) > 0;
  }
  return false;
}

/** The same for a deletion, whose entry keeps its title too. */
function technicalDeletion(row: AuditRow, kind: RecordHistoryChildKind | null): boolean {
  if (!kind || !TECHNICAL_CHILD_KINDS.has(kind)) return false;
  if (row.action === 'delete') return true;
  if (kind === 'allocations') return (allocationCount(row.before_json) ?? 0) > 0 && (allocationCount(row.after_json) ?? 0) === 0;
  return false;
}

/** The contact link states the supplier sync writes, sorted and unique. */
function contactStates(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const states: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') {
      if (entry.trim()) states.push(entry.trim());
      continue;
    }
    if (!isPlainObject(entry)) continue;
    // The assistant's relation items: `{ key, label, payload: { contact_id, role, origin } }`.
    const payload = isPlainObject(entry.payload) ? entry.payload : entry;
    const contactId = payload.contact_id;
    if (!isUuid(contactId)) continue;
    const role = typeof payload.role === 'string' && payload.role.trim() ? payload.role.trim() : null;
    states.push(role ? `${contactId}:${role}` : contactId);
  }
  return Array.from(new Set(states));
}

function contactIdOf(state: string): string | null {
  const id = state.split(':')[0];
  return isUuid(id) ? id : null;
}

/** A value that is a bare uuid and names nothing mapped shows as a nameless record, never as text. */
function safeScalar(value: unknown): unknown {
  if (typeof value === 'string' && isUuid(value)) return { hidden: true, kind: 'record' };
  return value;
}

function isStructured(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => isPlainObject(item));
  return isPlainObject(value);
}

function amountCents(value: unknown): bigint {
  try {
    return toCents(value as string | number | null | undefined);
  } catch {
    return 0n;
  }
}

type AmountGroup = { year: number | null; before: Map<string, bigint>; after: Map<string, bigint> };

/** `YYYY-MM` of a stored period, or null when the payload carries no month. */
function monthOf(period: unknown): string | null {
  if (typeof period !== 'string' || !/^\d{4}-\d{2}/.test(period)) return null;
  return period.slice(0, 7);
}

function yearOfMonth(month: string | null): number | null {
  if (!month) return null;
  const year = Number(month.slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

/**
 * The before and after values of one measure, by year and month. A write only carries the months it
 * touched, so the sums below are the touched months' totals, never an annual total.
 */
function amountGroups(before: unknown[], after: unknown[], measure: string, fallbackYear: number | null): Map<string, AmountGroup> {
  const groups = new Map<string, AmountGroup>();
  const add = (rows: unknown[], side: 'before' | 'after') => {
    for (const row of rows) {
      if (!isPlainObject(row)) continue;
      const month = monthOf(row.period);
      const year = yearOfMonth(month) ?? fallbackYear;
      const key = year === null ? '' : String(year);
      const group = groups.get(key) ?? { year, before: new Map(), after: new Map() };
      // A payload without a month still counts in its year; it simply names no month.
      group[side].set(month ?? '', amountCents(row[measure]));
      groups.set(key, group);
    }
  };
  add(before, 'before');
  add(after, 'after');
  return groups;
}

function sumGroup(months: Map<string, bigint>): bigint {
  let total = 0n;
  for (const value of months.values()) total += value;
  return total;
}

function groupMonths(group: AmountGroup): string[] {
  return Array.from(new Set([...group.before.keys(), ...group.after.keys()]))
    .filter((month) => month !== '')
    .sort();
}

function groupMonthsDiffer(group: AmountGroup): boolean {
  const months = new Set([...group.before.keys(), ...group.after.keys()]);
  for (const month of months) if ((group.before.get(month) ?? 0n) !== (group.after.get(month) ?? 0n)) return true;
  return false;
}

/** The yearly totals the budget file writes in one flat spread (`after.totals`, `before.totals`). */
function flatAmountChanges(row: AuditRow, ctx: PageContext): RecordHistoryChange[] | null {
  const afterObject = isPlainObject(row.after_json) ? row.after_json : null;
  const afterTotals = afterObject && isPlainObject(afterObject.totals) ? afterObject.totals : null;
  if (!afterTotals) return null;
  const beforeObject = isPlainObject(row.before_json) ? row.before_json : null;
  const beforeTotals = beforeObject && isPlainObject(beforeObject.totals) ? beforeObject.totals : null;
  const version = row.record_id ? ctx.versions.get(row.record_id.toLowerCase()) : undefined;
  const year = typeof afterObject?.year === 'number'
    ? afterObject.year
    : typeof beforeObject?.year === 'number' ? beforeObject.year : version?.year ?? null;
  const changes: RecordHistoryChange[] = [];
  for (const measure of AMOUNT_MEASURES) {
    const b = beforeTotals?.[measure];
    const a = afterTotals[measure];
    if (b === undefined && a === undefined) continue;
    if (b !== undefined && deepEqual(b, a)) continue;
    const money = (value: unknown) => (value === null || value === undefined ? undefined : String(value));
    changes.push({
      field: measure,
      column: measure,
      ...(year === null ? {} : { year }),
      ...(b === undefined ? {} : { before: money(b) }),
      ...(a === undefined ? {} : { after: money(a) }),
      wholeYear: true,
    });
  }
  return changes;
}

function amountChanges(row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  const flat = flatAmountChanges(row, ctx);
  if (flat) return flat;
  const before = Array.isArray(row.before_json) ? row.before_json : [];
  const after = Array.isArray(row.after_json) ? row.after_json : [];
  const version = row.record_id ? ctx.versions.get(row.record_id.toLowerCase()) : undefined;
  const fallbackYear = version?.year ?? null;
  const changes: RecordHistoryChange[] = [];
  for (const measure of AMOUNT_MEASURES) {
    for (const group of amountGroups(before, after, measure, fallbackYear).values()) {
      const b = sumGroup(group.before);
      const a = sumGroup(group.after);
      const monthlyOnly = b === a && groupMonthsDiffer(group);
      if (b === a && !monthlyOnly) continue;
      const months = groupMonths(group);
      changes.push({
        field: measure,
        before: formatCentsFixed(b),
        after: formatCentsFixed(a),
        ...(group.year === null ? {} : { year: group.year }),
        column: measure,
        ...(months.length === 0 ? {} : { months }),
        ...(months.length === 12 ? { wholeYear: true } : {}),
        ...(monthlyOnly ? { monthlyOnly: true } : {}),
      });
    }
  }
  return changes;
}

function allocationCount(value: unknown): number | null {
  if (Array.isArray(value)) return value.length;
  if (isPlainObject(value) && typeof value.count === 'number') return value.count;
  return null;
}

function allocationChanges(row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  const before = row.before_json;
  const after = row.after_json;
  const version = row.record_id ? ctx.versions.get(row.record_id.toLowerCase()) : undefined;
  const year = version?.year ?? null;
  const afterObject = isPlainObject(after) ? after : null;
  if (afterObject?.operation === 'allocation_copy') {
    return [{
      field: 'allocations',
      before: allocationCount(before) ?? 0,
      after: allocationCount(after) ?? 0,
      year: typeof afterObject.destinationYear === 'number' ? afterObject.destinationYear : year ?? undefined,
      sourceYear: typeof afterObject.sourceYear === 'number' ? afterObject.sourceYear : undefined,
      ...(afterObject.overwrite === true ? { overwrite: true } : {}),
    }];
  }
  const b = allocationCount(before);
  const a = allocationCount(after);
  if (b === null && a === null) return [];
  if (b === a && deepEqual(before, after)) return [];
  return [{
    field: 'allocations',
    before: b ?? 0,
    after: a ?? 0,
    ...(year === null ? {} : { year }),
    ...(b === a ? { changed: true } : {}),
  }];
}

function roundInputLines(value: unknown): Array<{ label: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isPlainObject)
    .map((line) => ({ label: typeof line.label === 'string' ? line.label : '' }))
    .filter((line) => line.label.trim() !== '');
}

function roundInputChanges(row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  const before = isPlainObject(row.before_json) ? row.before_json : {};
  const after = isPlainObject(row.after_json) ? row.after_json : {};
  const changes = genericChanges(row, ctx, { label: row.table_name });
  const beforeLines = roundInputLines(before.lines);
  const afterLines = roundInputLines(after.lines);
  const beforeLabels = new Set(beforeLines.map((line) => line.label));
  const afterLabels = new Set(afterLines.map((line) => line.label));
  for (const line of afterLines) {
    if (!beforeLabels.has(line.label)) changes.push({ field: 'line', event: 'added', after: line.label });
  }
  for (const line of beforeLines) {
    if (!afterLabels.has(line.label)) changes.push({ field: 'line', event: 'removed', before: line.label });
  }
  if (beforeLines.length === afterLines.length && deepEqual(beforeLines, afterLines) === false
    && changes.every((change) => change.field !== 'line')) {
    changes.push({ field: 'lines', before: beforeLines.length, after: afterLines.length, changed: true });
  }
  return changes;
}

function childRef(kind: RecordHistoryChildKind, id: string | null, label: string | null): RecordHistoryReference | null {
  if (!id) return null;
  return { kind: CHILD_KIND_LABELS[kind], id, label };
}

function labelOf(row: AuditRow, fields: readonly string[]): string | null {
  for (const payload of [row.after_json, row.before_json]) {
    if (!isPlainObject(payload)) continue;
    for (const field of fields) {
      const value = payload[field];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  return null;
}

/** The readable label of each link in an assistant payload (`{ payload: { url, description } }`). */
function linkLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const labels: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') {
      if (entry.trim()) labels.push(entry.trim());
      continue;
    }
    if (!isPlainObject(entry)) continue;
    const payload = isPlainObject(entry.payload) ? entry.payload : entry;
    const label = [payload.description, payload.url].find((part) => typeof part === 'string' && part.trim());
    if (typeof label === 'string') labels.push(label.trim());
  }
  return Array.from(new Set(labels));
}

function linkChanges(row: AuditRow): RecordHistoryChange[] {
  if (row.before_json === null || row.before_json === undefined) {
    return [{ field: 'link', event: 'added', after: childRef('link', row.record_id, labelOf(row, ['description', 'url'])) }];
  }
  if (row.after_json === null || row.after_json === undefined) {
    return [{ field: 'link', event: 'removed', before: childRef('link', row.record_id, labelOf(row, ['description', 'url'])) }];
  }
  if (Array.isArray(row.before_json) || Array.isArray(row.after_json)) {
    // The assistant replaces the whole link set in one row, with no link id: the change names each
    // link by what the payload holds, and never borrows the line's own id.
    const beforeLabels = linkLabels(row.before_json);
    const afterLabels = linkLabels(row.after_json);
    const beforeSet = new Set(beforeLabels);
    const afterSet = new Set(afterLabels);
    const changes: RecordHistoryChange[] = [];
    for (const label of afterLabels) if (!beforeSet.has(label)) changes.push({ field: 'link', event: 'added', after: label });
    for (const label of beforeLabels) if (!afterSet.has(label)) changes.push({ field: 'link', event: 'removed', before: label });
    return changes;
  }
  const changes: RecordHistoryChange[] = [];
  const before = isPlainObject(row.before_json) ? row.before_json : {};
  const after = isPlainObject(row.after_json) ? row.after_json : {};
  for (const field of ['url', 'description']) {
    if (!deepEqual(before[field], after[field])) {
      changes.push({ field, before: safeScalar(before[field]) ?? null, after: safeScalar(after[field]) ?? null });
    }
  }
  return changes;
}

function attachmentChanges(row: AuditRow): RecordHistoryChange[] {
  if (row.after_json === null || row.after_json === undefined) {
    return [{ field: 'attachment', event: 'removed', before: childRef('attachment', row.record_id, labelOf(row, ['original_filename'])) }];
  }
  return [{ field: 'attachment', event: 'added', after: childRef('attachment', row.record_id, labelOf(row, ['original_filename'])) }];
}

function contactChanges(row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  const changes: RecordHistoryChange[] = [];
  const before = row.before_json;
  const after = row.after_json;
  if (Array.isArray(before) || Array.isArray(after)) {
    const beforeSet = new Set(contactStates(before));
    const afterSet = new Set(contactStates(after));
    for (const state of afterSet) {
      if (!beforeSet.has(state)) {
        changes.push({ field: 'contact', event: 'added', after: referenceValue(ctx, 'contact', contactIdOf(state)) });
      }
    }
    for (const state of beforeSet) {
      if (!afterSet.has(state)) {
        changes.push({ field: 'contact', event: 'removed', before: referenceValue(ctx, 'contact', contactIdOf(state)) });
      }
    }
    return changes;
  }
  if (after === null || after === undefined) {
    const id = isPlainObject(before) && isUuid(before.contact_id) ? before.contact_id : null;
    return [{ field: 'contact', event: 'removed', before: referenceValue(ctx, 'contact', id) }];
  }
  const id = isPlainObject(after) && isUuid(after.contact_id) ? after.contact_id : null;
  return [{ field: 'contact', event: 'added', after: referenceValue(ctx, 'contact', id) }];
}

function setLinkChanges(kind: 'application' | 'technology', row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  // A line's link set is an array of ids. A process's application link is one row with the
  // application id in its payload (`application_business_processes`, read by `record_id`).
  const single = (value: unknown): string[] => {
    if (!isPlainObject(value)) return [];
    const id = value[`${kind}_id`];
    return isUuid(id) ? [id] : [];
  };
  const before = Array.isArray(row.before_json) ? row.before_json : single(row.before_json);
  const after = Array.isArray(row.after_json) ? row.after_json : single(row.after_json);
  const beforeSet = new Set(before.filter(isUuid).map((id) => id.toLowerCase()));
  const afterSet = new Set(after.filter(isUuid).map((id) => id.toLowerCase()));
  const changes: RecordHistoryChange[] = [];
  for (const id of afterSet) {
    if (!beforeSet.has(id)) changes.push({ field: kind, event: 'added', after: referenceValue(ctx, kind, id) });
  }
  for (const id of beforeSet) {
    if (!afterSet.has(id)) changes.push({ field: kind, event: 'removed', before: referenceValue(ctx, kind, id) });
  }
  return changes;
}

function assetIds(value: unknown): string[] {
  if (!isPlainObject(value) || !Array.isArray(value.ids)) return [];
  return value.ids.filter(isUuid).map((id) => id.toLowerCase());
}

function assetChanges(row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  const before = new Set(assetIds(row.before_json));
  const after = new Set(assetIds(row.after_json));
  const lineId = ctx.recordId.toLowerCase();
  const asset = referenceValue(ctx, 'asset', row.record_id);
  if (after.has(lineId) && !before.has(lineId)) return [{ field: 'asset', event: 'added', after: asset }];
  if (before.has(lineId) && !after.has(lineId)) return [{ field: 'asset', event: 'removed', before: asset }];
  return [];
}

/**
 * A contract, project or request link: from the line side the payload holds the other objects, so
 * each added or removed id is one link; from the contract, project or request side the payload
 * holds line ids, and the entry names that record when this line joined or left its set. The name
 * resolves with the reader's rights (contract policy and scope, project/request participation).
 */
function linkedRecordChanges(kind: 'contract' | 'project' | 'request', row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  const before = new Set(linkSetIds(row.before_json));
  const after = new Set(linkSetIds(row.after_json));
  const lineId = ctx.recordId.toLowerCase();
  const changes: RecordHistoryChange[] = [];
  if (String(row.record_id ?? '').toLowerCase() === lineId) {
    for (const id of after) {
      if (!before.has(id)) changes.push({ field: kind, event: 'added', after: referenceValue(ctx, kind, id) });
    }
    for (const id of before) {
      if (!after.has(id)) changes.push({ field: kind, event: 'removed', before: referenceValue(ctx, kind, id) });
    }
    return changes;
  }
  const record = referenceValue(ctx, kind, row.record_id);
  if (after.has(lineId) && !before.has(lineId)) changes.push({ field: kind, event: 'added', after: record });
  if (before.has(lineId) && !after.has(lineId)) changes.push({ field: kind, event: 'removed', before: record });
  return changes;
}

function taskChanges(row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  const task = referenceValue(ctx, 'task', row.record_id);
  if (row.action === 'delete' || (row.after_json === null || row.after_json === undefined)) {
    return [{ field: 'task', event: 'removed', before: task }];
  }
  if (row.action === 'create' || (row.action !== 'update' && (row.before_json === null || row.before_json === undefined))) {
    return [{ field: 'task', event: 'added', after: task }];
  }
  // A legacy update writes `before: null`: a modification whose detail is not known.
  return [];
}

/** One change per dimension whose category changed; a removed value shows as `null`. */
function dimensionChanges(before: unknown, after: unknown, ctx: PageContext): RecordHistoryChange[] {
  const b = isPlainObject(before) ? before : {};
  const a = isPlainObject(after) ? after : {};
  const axes = new Set([...Object.keys(b), ...Object.keys(a)]);
  const changes: RecordHistoryChange[] = [];
  for (const axisId of axes) {
    const beforeCategory = b[axisId];
    const afterCategory = a[axisId];
    if (deepEqual(beforeCategory, afterCategory)) continue;
    const name = (id: unknown) => (isUuid(id) ? ctx.categories.get(id.toLowerCase()) ?? null : null);
    changes.push({
      field: 'dimension',
      dimension: isUuid(axisId) ? ctx.dimensions.get(axisId.toLowerCase()) ?? null : null,
      before: name(beforeCategory),
      after: name(afterCategory),
    });
  }
  return changes;
}

type GenericOptions = { label: string };

/**
 * The changed keys of a before/after payload, from its label's allow-list only: a field outside it
 * is dropped, with no neighbour to guess, and the fields the history has no structured form for
 * are left out. A whole payload that is not an object only yields the fields of a column operation
 * (copy, clear), which are read below.
 */
function genericChanges(row: AuditRow, ctx: PageContext, options: GenericOptions): RecordHistoryChange[] {
  const before = isPlainObject(row.before_json) ? row.before_json : {};
  const after = isPlainObject(row.after_json) ? row.after_json : {};
  const changes: RecordHistoryChange[] = [];
  const fields = historyFields(options.label);
  const creating = row.before_json === null || row.before_json === undefined;
  const deleting = row.after_json === null || row.after_json === undefined;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const field of keys) {
    if (!Object.prototype.hasOwnProperty.call(fields, field)) continue;
    const rule = fields[field];
    if (rule.hidden) continue;
    const b = before[field];
    const a = after[field];
    if (deepEqual(b, a)) continue;
    if ((b === null || b === undefined || b === '') && (a === null || a === undefined || a === '')) continue;
    if (field === 'analytics_values') {
      changes.push(...dimensionChanges(b, a, ctx));
      continue;
    }
    if (isStructured(b) || isStructured(a)) continue;
    let beforeValue: unknown = b;
    let afterValue: unknown = a;
    const family = rule.family;
    if (family === 'user') {
      beforeValue = userValue(ctx, b);
      afterValue = userValue(ctx, a);
    } else if (family) {
      beforeValue = referenceValue(ctx, family, b);
      afterValue = referenceValue(ctx, family, a);
    } else {
      beforeValue = safeScalar(b);
      afterValue = safeScalar(a);
    }
    if (Array.isArray(beforeValue) || Array.isArray(afterValue)) {
      const scalars = (value: unknown) => Array.isArray(value) && value.every((item) => item === null || ['string', 'number', 'boolean'].includes(typeof item));
      if (!scalars(beforeValue) || !scalars(afterValue)) continue;
      // An array of ids has no readable form here: never copy uuids into the answer.
      const ids = (value: unknown) => Array.isArray(value) && value.some(isUuid);
      if (ids(beforeValue) || ids(afterValue)) continue;
    }
    changes.push({
      field,
      ...(creating ? {} : { before: beforeValue ?? null }),
      ...(deleting ? {} : { after: afterValue ?? null }),
    });
  }
  return changes;
}

/** A column copy or clear writes the line's row with the API column and its operation context. */
function columnOperationChanges(row: AuditRow): RecordHistoryChange[] | null {
  const after = isPlainObject(row.after_json) ? row.after_json : null;
  if (!after) return null;
  const operation = after.operation;
  if (operation === 'budget_column_clear') {
    const column = typeof after.column === 'string' ? after.column : null;
    if (!column) return null;
    const before = isPlainObject(row.before_json) ? row.before_json[column] : null;
    return [{
      field: column,
      before: typeof before === 'number' || typeof before === 'string' ? before : 0,
      after: 0,
      ...(typeof after.year === 'number' ? { year: after.year } : {}),
    }];
  }
  if (operation === 'budget_column_copy') {
    const destinationColumn = typeof after.destinationColumn === 'string' ? after.destinationColumn : null;
    const sourceColumn = typeof after.sourceColumn === 'string' ? after.sourceColumn : null;
    if (!destinationColumn || !sourceColumn) return null;
    const before = isPlainObject(row.before_json) ? row.before_json[destinationColumn] : null;
    return [{
      field: destinationColumn,
      before: typeof before === 'number' || typeof before === 'string' ? before : 0,
      after: after[destinationColumn] ?? null,
      ...(typeof after.destinationYear === 'number' ? { year: after.destinationYear } : {}),
      ...(typeof after.sourceYear === 'number' ? { sourceYear: after.sourceYear } : {}),
      sourceColumn,
      ...(after.percentageIncrease !== undefined ? { percentageIncrease: String(after.percentageIncrease) } : {}),
    }];
  }
  return null;
}

function recordChanges(row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  const columnOperation = columnOperationChanges(row);
  if (columnOperation) return columnOperation;
  return genericChanges(row, ctx, { label: row.table_name });
}

function changesFor(row: AuditRow, kind: RecordHistoryChildKind | null, ctx: PageContext): RecordHistoryChange[] {
  if (kind === null) return recordChanges(row, ctx);
  // A technical child's birth or removal is its title: its fields are not a change the reader reads.
  if (technicalCreation(row, kind) || technicalDeletion(row, kind)) return [];
  switch (kind) {
    case 'amounts':
      return amountChanges(row, ctx);
    case 'allocations':
      return allocationChanges(row, ctx);
    case 'round_input':
      return roundInputChanges(row, ctx);
    case 'link':
      return linkChanges(row);
    case 'attachment':
      return attachmentChanges(row);
    case 'contact':
      return contactChanges(row, ctx);
    case 'application':
    case 'technology':
      return setLinkChanges(kind, row, ctx);
    case 'asset':
      return assetChanges(row, ctx);
    case 'contract':
    case 'project':
    case 'request':
      return linkedRecordChanges(kind, row, ctx);
    case 'task':
      return taskChanges(row, ctx);
    case 'metrics':
      return genericChanges(row, ctx, { label: row.table_name });
    case 'version':
      return genericChanges(row, ctx, { label: row.table_name });
    default:
      return [];
  }
}

function subjectLabel(row: AuditRow, kind: RecordHistoryChildKind | null, ctx: PageContext, changes: RecordHistoryChange[]): string | null {
  if (kind === null) return null;
  switch (kind) {
    case 'version': {
      const payload = isPlainObject(row.after_json) ? row.after_json : isPlainObject(row.before_json) ? row.before_json : null;
      const name = payload && typeof payload.version_name === 'string' ? payload.version_name : null;
      if (name) return name;
      return row.record_id ? ctx.versions.get(row.record_id.toLowerCase())?.name ?? null : null;
    }
    case 'amounts':
    case 'allocations':
      return row.record_id ? ctx.versions.get(row.record_id.toLowerCase())?.name ?? null : null;
    case 'round_input': {
      const payload = isPlainObject(row.after_json) ? row.after_json : isPlainObject(row.before_json) ? row.before_json : null;
      return payload && typeof payload.measure === 'string' ? payload.measure : null;
    }
    case 'link': {
      const label = labelOf(row, ['description', 'url']);
      if (label) return label;
      const events = changes.filter((change) => change.event);
      if (events.length === 1) {
        const value = events[0].after ?? events[0].before;
        if (typeof value === 'string' && value.trim()) return value;
      }
      return null;
    }
    case 'attachment':
      return labelOf(row, ['original_filename']);
    case 'metrics': {
      for (const payload of [row.after_json, row.before_json]) {
        if (!isPlainObject(payload)) continue;
        if (typeof payload.fiscal_year === 'number') return String(payload.fiscal_year);
        if (typeof payload.fiscal_year === 'string' && payload.fiscal_year.trim()) return payload.fiscal_year.trim();
      }
      return null;
    }
    case 'contact':
    case 'application':
    case 'technology':
    case 'asset':
    case 'contract':
    case 'project':
    case 'request':
    case 'task': {
      const events = changes.filter((change) => change.event);
      const labels = new Set<string>();
      for (const change of events) {
        const value = (change.after ?? change.before) as RecordHistoryReference | RecordHistoryHiddenReference | null | undefined;
        if (value && !('hidden' in value) && typeof value.label === 'string' && value.label.trim()) {
          labels.add(value.label.trim());
        }
      }
      // The same label on both sides (a role change) names the entry; two different records do not.
      if (labels.size === 1) return Array.from(labels)[0];
      if (kind === 'task' && row.record_id) {
        return ctx.references.get('task')?.get(row.record_id.toLowerCase())?.label ?? null;
      }
      return null;
    }
    default:
      return null;
  }
}

function actorOf(row: AuditRow, users: Map<string, ReferenceRow>): RecordHistoryActor {
  const source = String(row.source ?? '').trim().toLowerCase();
  const name = row.user_id ? users.get(row.user_id.toLowerCase())?.label ?? null : null;
  const importing = source === 'budget_file' || /(^|_)import($|_)/.test(source);
  if (source === 'system' || (!row.user_id && !importing && source !== 'ai_chat' && source !== 'ai_mcp')) {
    return { kind: 'system', name: null };
  }
  if (source === 'ai_chat' || source === 'ai_mcp') return { kind: 'assistant', name };
  if (importing) return { kind: 'import', name };
  return { kind: 'user', name };
}

function presentedAction(row: AuditRow, kind: RecordHistoryChildKind | null): string {
  if (technicalCreation(row, kind)) return 'create';
  if (technicalDeletion(row, kind)) return 'delete';
  return row.action;
}

export function presentItem(row: AuditRow, entry: RecordHistoryRecord, ctx: PageContext): RecordHistoryItem {
  const kind = entry.auditLabels.includes(row.table_name) ? null : recordHistoryChildKind(entry, row.table_name);
  const changes = changesFor(row, kind, ctx);
  const label = subjectLabel(row, kind, ctx, changes);
  return {
    id: row.id,
    at: new Date(row.created_at).toISOString(),
    action: presentedAction(row, kind),
    actor: actorOf(row, ctx.users),
    subject: {
      kind: kind ?? 'record',
      ...(label ? { label } : {}),
    },
    changes,
  };
}

function referenceValue(ctx: PageContext, family: FamilyKey, value: unknown): RecordHistoryReference | RecordHistoryHiddenReference | null {
  if (value === null || value === undefined) return null;
  if (!isUuid(value)) return null;
  if (!ctx.readable[family]) return { hidden: true, kind: family };
  const row = ctx.references.get(family)?.get(value.toLowerCase());
  if (!row) return { hidden: true, kind: family };
  return {
    kind: family,
    id: value.toLowerCase(),
    label: row.label ?? null,
    ...(row.reference ? { reference: row.reference } : {}),
  };
}

function userValue(ctx: PageContext, value: unknown): unknown {
  if (!isUuid(value)) return value;
  const row = ctx.readable.user ? ctx.users.get(value.toLowerCase()) : undefined;
  // A person outside the tenant, or a deleted account, is not a readable record: hide it.
  if (!row) return { hidden: true, kind: 'user' };
  return { kind: 'user', id: value.toLowerCase(), label: row.label ?? null };
}
