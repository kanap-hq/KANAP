import { formatCentsFixed, toCents } from '../../common/amount';
import type { FamilyKey, ReferenceRow } from './families';
import { historyFields } from './fields';
import {
  recordHistoryChildKind,
  type RecordHistoryChildKind,
  type RecordHistoryRecord,
} from '../record-history.inventory';
import { taskRelatedFamily } from './records/tasks';
import { PROJECT_NUMERIC_FIELDS } from './records/portfolio_projects';
import { REQUEST_NUMERIC_FIELDS, requestAuditPayload } from './records/portfolio_requests';
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
export type RecordHistoryHiddenReference = { hidden: true; kind: string; deleted?: true };

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
  /** A fixed word standing for the change of a hidden value (a document body): `contentChanged`. */
  text?: string;
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
  /** The ids the reader may name but whose row no longer exists in the tenant (a deleted record). */
  deleted: Map<FamilyKey, Set<string>>;
  readable: Record<FamilyKey, boolean>;
  dimensions: Map<string, string>;
  categories: Map<string, string>;
  /** The tenant's IT entity labels, by code (a connection's endpoints and a segment's equipment). */
  entityLabels: Map<string, string>;
  /** The environment of each deployment of the record the page names (an application's assignments). */
  instances?: Map<string, string | null>;
  /** The scoring criteria a project's or a request's rows name: criterion names and option labels, by id. */
  criteria?: Map<string, string>;
  criterionOptions?: Map<string, string>;
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
  value: 'value',
  relation: 'relation',
  member: 'member',
  hardware: 'hardware',
  support: 'support',
  technology_version: 'technology_version',
  owner: 'owner',
  vulnerability: 'vulnerability',
  supplier: 'supplier',
  budget_line: 'budget_line',
  sub_item: 'sub_item',
  leg: 'leg',
  set: 'set',
  binding: 'binding',
  person: 'person',
  compliance_item: 'compliance_item',
  instance: 'instance',
  assignment: 'assignment',
  business_process: 'business_process',
  phase: 'phase',
  milestone: 'milestone',
  time_entry: 'time_entry',
  team: 'team',
  dependency: 'dependency',
  document: 'document',
};

/** The kinds whose row is one link to another record, named by a key of its payload. */
type LinkChildKind = 'contact' | 'supplier' | 'contract' | 'budget_line';

/**
 * The payload key of the record a link names, by kind: a contact link carries `contact_id`, a
 * supplier link `supplier_id`, a contract link `contract_id`, and a budget-line link the key of
 * its nature (`spend_item_id`, or `capex_item_id` for a CAPEX line).
 */
const LINK_KEYS: Readonly<Record<LinkChildKind, readonly string[]>> = {
  contact: ['contact_id'],
  supplier: ['supplier_id'],
  contract: ['contract_id'],
  budget_line: ['spend_item_id', 'capex_item_id'],
};

function isLinkKind(kind: RecordHistoryChildKind | null): kind is LinkChildKind {
  return kind !== null && Object.prototype.hasOwnProperty.call(LINK_KEYS, kind);
}

/** The uuid a link payload holds under one of its kind's keys, in `after` then `before`. */
function linkIdOf(row: AuditRow, kind: LinkChildKind): string | null {
  for (const payload of [row.after_json, row.before_json]) {
    if (!isPlainObject(payload)) continue;
    for (const key of LINK_KEYS[kind]) {
      if (isUuid(payload[key])) return payload[key].toLowerCase();
    }
  }
  return null;
}

/**
 * The record a link payload names, by the kind its label gives: the page loader collects it with
 * the other references before the presentation resolves it.
 */
export function linkReference(kind: RecordHistoryChildKind | null, payload: unknown): { family: FamilyKey; id: string } | null {
  if (!isLinkKind(kind) || !isPlainObject(payload)) return null;
  const id = linkIdOfPayload(payload, kind);
  return id ? { family: kind, id } : null;
}

/** The children whose creation is a title only: a version, a budget input, an allocation, a leg, a binding. */
const TECHNICAL_CHILD_KINDS: ReadonlySet<RecordHistoryChildKind> = new Set([
  'version', 'round_input', 'allocations', 'technology_version', 'leg', 'binding',
]);

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

/** A value a change should not show: absent, blank, an empty list, or a list of blank strings. */
function isEmptyHistoryValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0 || value.every((entry) => isEmptyHistoryValue(entry));
  return false;
}

/** A numeric string a metric stores (`"180.000"`) reads as a number, as the metrics tab shows it. */
function historyNumber(value: unknown): unknown {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value.trim())) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return value;
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

type LinkEntry = { url: string | null; label: string };

/**
 * Each link of a set payload: its address and its readable label. The assistant writes
 * `{ payload: { url, description } }` (or a bare label), a project's web link `{ url, label }`.
 */
function linkEntries(value: unknown): LinkEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: LinkEntry[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') {
      if (entry.trim()) entries.push({ url: null, label: entry.trim() });
      continue;
    }
    if (!isPlainObject(entry)) continue;
    const payload = isPlainObject(entry.payload) ? entry.payload : entry;
    const url = typeof payload.url === 'string' && payload.url.trim() ? payload.url.trim() : null;
    // A project's web link carries its `label` where the other links carry a description.
    const label = [payload.description, payload.label, payload.url].find((part) => typeof part === 'string' && part.trim());
    if (typeof label === 'string') entries.push({ url, label: label.trim() });
  }
  return entries;
}

/** The entries of `from` that `against` does not hold, compared on the (address, label) pair. */
function linkEntriesMissing(from: LinkEntry[], against: LinkEntry[]): LinkEntry[] {
  const key = (entry: LinkEntry) => `${entry.url ?? ''}\u0000${entry.label}`;
  const left = new Map<string, number>();
  for (const entry of against) left.set(key(entry), (left.get(key(entry)) ?? 0) + 1);
  const missing: LinkEntry[] = [];
  for (const entry of from) {
    const count = left.get(key(entry)) ?? 0;
    if (count > 0) left.set(key(entry), count - 1);
    else missing.push(entry);
  }
  return missing;
}

/**
 * A replaced link set, compared on the (address, label) pair: a label whose address alone changed
 * reads as that link changed, from the old address to the new one; the other pairs are added or
 * removed. A label two links share is named with its address, so the two stay apart.
 */
function linkSetChanges(beforeValue: unknown, afterValue: unknown): RecordHistoryChange[] {
  const before = linkEntries(beforeValue);
  const after = linkEntries(afterValue);
  const added = linkEntriesMissing(after, before);
  const removed = linkEntriesMissing(before, after);
  const urlsByLabel = new Map<string, Set<string>>();
  for (const entry of [...before, ...after]) {
    const urls = urlsByLabel.get(entry.label) ?? new Set<string>();
    urls.add(entry.url ?? '');
    urlsByLabel.set(entry.label, urls);
  }
  const named = (entry: LinkEntry) => (entry.url && entry.url !== entry.label && (urlsByLabel.get(entry.label)?.size ?? 0) > 1
    ? `${entry.label} (${entry.url})`
    : entry.label);
  const changes: RecordHistoryChange[] = [];
  const addedLeft: LinkEntry[] = [];
  for (const entry of added) {
    const labelled = entry.url !== null && entry.url !== entry.label;
    const index = labelled
      ? removed.findIndex((old) => old.label === entry.label && old.url !== null && old.url !== old.label)
      : -1;
    if (index < 0) {
      addedLeft.push(entry);
      continue;
    }
    const [old] = removed.splice(index, 1);
    changes.push({ field: 'link', dimension: entry.label, before: old.url, after: entry.url });
  }
  for (const entry of addedLeft) changes.push({ field: 'link', event: 'added', after: named(entry) });
  for (const entry of removed) changes.push({ field: 'link', event: 'removed', before: named(entry) });
  return changes;
}

function linkChanges(row: AuditRow): RecordHistoryChange[] {
  if (row.before_json === null || row.before_json === undefined) {
    return [{ field: 'link', event: 'added', after: childRef('link', row.record_id, labelOf(row, ['description', 'url'])) }];
  }
  if (row.after_json === null || row.after_json === undefined) {
    return [{ field: 'link', event: 'removed', before: childRef('link', row.record_id, labelOf(row, ['description', 'url'])) }];
  }
  if (Array.isArray(row.before_json) || Array.isArray(row.after_json)) {
    // The assistant and the project's web links replace the whole set in one row, with no link id:
    // the change names each link by what the payload holds, and never borrows the record's own id.
    return linkSetChanges(row.before_json, row.after_json);
  }
  const changes: RecordHistoryChange[] = [];
  const before = isPlainObject(row.before_json) ? row.before_json : {};
  const after = isPlainObject(row.after_json) ? row.after_json : {};
  // `kind` belongs to the interface's links; the budget line's links do not carry it.
  // `purpose` belongs to the application's links.
  for (const field of ['kind', 'url', 'description', 'purpose']) {
    if (!deepEqual(before[field], after[field])) {
      changes.push({ field, before: safeScalar(before[field]) ?? null, after: safeScalar(after[field]) ?? null });
    }
  }
  return changes;
}

function attachmentChanges(row: AuditRow): RecordHistoryChange[] {
  // A removal has no row after, or keeps the row with its removal date (an incident's attachment).
  if (row.action === 'delete' || row.after_json === null || row.after_json === undefined) {
    return [{ field: 'attachment', event: 'removed', before: childRef('attachment', row.record_id, labelOf(row, ['original_filename'])) }];
  }
  return [{ field: 'attachment', event: 'added', after: childRef('attachment', row.record_id, labelOf(row, ['original_filename'])) }];
}

/**
 * A link row to another record (a contact of a supplier, a supplier of a contact, a contract or a
 * budget line of a contact): the entry names the other record, and the link's own attributes
 * (role, primary) in words. A creation and a deletion are an added or removed event; an update
 * keeps the same record and reads as its changed attributes. The other record is resolved under
 * the reader's rights, so a module they do not read, or a record outside their data access, reads
 * as `{ hidden: true, kind }`.
 */
function linkRowChanges(kind: LinkChildKind, row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  const before = isPlainObject(row.before_json) ? row.before_json : null;
  const after = isPlainObject(row.after_json) ? row.after_json : null;
  const beforeId = before ? linkIdOfPayload(before, kind) : null;
  const afterId = after ? linkIdOfPayload(after, kind) : null;
  const creating = before === null;
  const deleting = after === null;
  const changes: RecordHistoryChange[] = [];
  if (creating && afterId) {
    changes.push({ field: kind, event: 'added', after: referenceValue(ctx, kind, afterId) });
  } else if (deleting && beforeId) {
    changes.push({ field: kind, event: 'removed', before: referenceValue(ctx, kind, beforeId) });
  } else if (beforeId !== afterId) {
    if (beforeId) changes.push({ field: kind, event: 'removed', before: referenceValue(ctx, kind, beforeId) });
    if (afterId) changes.push({ field: kind, event: 'added', after: referenceValue(ctx, kind, afterId) });
  }
  for (const field of ['role', 'is_primary'] as const) {
    const b = before?.[field];
    const a = after?.[field];
    if (creating) {
      if (a !== undefined && a !== null) changes.push({ field, after: a });
    } else if (deleting) {
      if (b !== undefined && b !== null) changes.push({ field, before: b });
    } else if (!deepEqual(b, a)) {
      changes.push({ field, before: b ?? null, after: a ?? null });
    }
  }
  return changes;
}

/** The record id a link payload names, by its kind's key. */
function linkIdOfPayload(payload: Record<string, unknown>, kind: LinkChildKind): string | null {
  for (const key of LINK_KEYS[kind]) {
    if (isUuid(payload[key])) return payload[key].toLowerCase();
  }
  return null;
}

function contactChanges(row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  // A project's contacts are written as a set (`{ ids }`), the other writers as a list.
  const listOf = (value: unknown) => (isPlainObject(value) && Array.isArray(value.ids) ? value.ids : value);
  const before = listOf(row.before_json);
  const after = listOf(row.after_json);
  if (Array.isArray(before) || Array.isArray(after)) {
    const changes: RecordHistoryChange[] = [];
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
  return linkRowChanges('contact', row, ctx);
}

function setLinkChanges(kind: 'application' | 'technology' | 'asset', row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  // A line's or an incident's link set is an array of ids; a contract writes `{ ids }`. A process's
  // application link is one row with the application id in its payload
  // (`application_business_processes`, read by `record_id`).
  const idsOf = (value: unknown): string[] => {
    if (Array.isArray(value) || (isPlainObject(value) && Array.isArray(value.ids))) return linkSetIds(value);
    if (!isPlainObject(value)) return [];
    const id = value[`${kind}_id`];
    return isUuid(id) ? [id.toLowerCase()] : [];
  };
  const beforeSet = new Set(idsOf(row.before_json));
  const afterSet = new Set(idsOf(row.after_json));
  const changes: RecordHistoryChange[] = [];
  for (const id of afterSet) {
    if (!beforeSet.has(id)) changes.push({ field: kind, event: 'added', after: referenceValue(ctx, kind, id) });
  }
  for (const id of beforeSet) {
    if (!afterSet.has(id)) changes.push({ field: kind, event: 'removed', before: referenceValue(ctx, kind, id) });
  }
  return changes;
}

/** The ids an owner set holds: the writers list `"<type>:<user_id>"` strings. */
function ownerStates(value: unknown): Map<string, { userId: string; role: 'business' | 'it' }> {
  const out = new Map<string, { userId: string; role: 'business' | 'it' }>();
  if (!Array.isArray(value)) return out;
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const [role, userId] = entry.split(':');
    if ((role !== 'business' && role !== 'it') || !isUuid(userId)) continue;
    out.set(entry.toLowerCase(), { userId: userId.toLowerCase(), role });
  }
  return out;
}

/** A relation set: `{ relations: [{ related_asset_id, relation_type }] }` to the source asset. */
function relationStates(value: unknown): Map<string, { assetId: string; type: 'contains' | 'depends_on' }> {
  const out = new Map<string, { assetId: string; type: 'contains' | 'depends_on' }>();
  if (!isPlainObject(value) || !Array.isArray(value.relations)) return out;
  for (const entry of value.relations) {
    if (!isPlainObject(entry) || !isUuid(entry.related_asset_id)) continue;
    const type = entry.relation_type === 'contains' ? 'contains' : entry.relation_type === 'depends_on' ? 'depends_on' : null;
    if (!type) continue;
    const assetId = String(entry.related_asset_id).toLowerCase();
    out.set(`${type}:${assetId}`, { assetId, type });
  }
  return out;
}

/** A cluster's member set: `{ members: [assetId] }`. */
function memberIds(value: unknown): string[] {
  if (!isPlainObject(value) || !Array.isArray(value.members)) return [];
  return value.members.filter(isUuid).map((id) => id.toLowerCase());
}

/** A relation added or removed on the source asset, named by the other asset. */
function relationChanges(row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  const before = relationStates(row.before_json);
  const after = relationStates(row.after_json);
  const changes: RecordHistoryChange[] = [];
  for (const [key, relation] of after) {
    if (before.has(key)) continue;
    changes.push({
      field: `relation_${relation.type}`,
      event: 'added',
      after: referenceValue(ctx, 'asset', relation.assetId),
    });
  }
  for (const [key, relation] of before) {
    if (after.has(key)) continue;
    changes.push({
      field: `relation_${relation.type}`,
      event: 'removed',
      before: referenceValue(ctx, 'asset', relation.assetId),
    });
  }
  return changes;
}

/** A cluster member added or removed, named by the member asset. */
function memberChanges(row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  const before = new Set(memberIds(row.before_json));
  const after = new Set(memberIds(row.after_json));
  const changes: RecordHistoryChange[] = [];
  for (const id of after) {
    if (!before.has(id)) changes.push({ field: 'member', event: 'added', after: referenceValue(ctx, 'asset', id) });
  }
  for (const id of before) {
    if (!after.has(id)) changes.push({ field: 'member', event: 'removed', before: referenceValue(ctx, 'asset', id) });
  }
  return changes;
}

/** An owner added or removed, with the owner type as the field ("IT" or "business"). */
function ownerChanges(row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  const before = ownerStates(row.before_json);
  const after = ownerStates(row.after_json);
  const changes: RecordHistoryChange[] = [];
  for (const [key, owner] of after) {
    if (before.has(key)) continue;
    changes.push({
      field: owner.role === 'it' ? 'owner_it' : 'owner_business',
      event: 'added',
      after: userValue(ctx, owner.userId),
    });
  }
  for (const [key, owner] of before) {
    if (after.has(key)) continue;
    changes.push({
      field: owner.role === 'it' ? 'owner_it' : 'owner_business',
      event: 'removed',
      before: userValue(ctx, owner.userId),
    });
  }
  return changes;
}

/** The technology an `asset_technologies` row installs on this asset, from `record_id`. */
function installedTechnology(row: AuditRow, ctx: PageContext, payload: Record<string, unknown> | null): RecordHistoryChange[] {
  const technologyId = isUuid(row.record_id) ? row.record_id : payload && isUuid(payload.technology_id) ? payload.technology_id : null;
  if (!technologyId) return [];
  const before = isPlainObject(row.before_json) ? row.before_json : null;
  const after = isPlainObject(row.after_json) ? row.after_json : null;
  const operatingSystem = (after?.is_operating_system === true) || (before?.is_operating_system === true);
  const field = operatingSystem ? 'operating_system' : 'technology';
  const event = (added: boolean): RecordHistoryChange => ({
    field,
    event: added ? 'added' : 'removed',
    ...(added ? { after: referenceValue(ctx, 'technology', technologyId) } : { before: referenceValue(ctx, 'technology', technologyId) }),
  });
  if (row.before_json === null || row.before_json === undefined) return [event(true)];
  if (row.after_json === null || row.after_json === undefined) return [event(false)];
  const changes: RecordHistoryChange[] = [];
  if (before && after && before.is_operating_system !== after.is_operating_system) {
    changes.push({
      field: 'operating_system',
      before: before.is_operating_system === true,
      after: after.is_operating_system === true,
    });
  }
  if (before && after && !deepEqual(before.notes, after.notes)) {
    changes.push({ field: 'notes', before: before.notes ?? null, after: after.notes ?? null });
  }
  return changes;
}

/** The asset an `asset_technologies` row installs the technology on, from the payload. */
function installedAsset(row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  const before = isPlainObject(row.before_json) ? row.before_json : null;
  const after = isPlainObject(row.after_json) ? row.after_json : null;
  const assetId = after && isUuid(after.asset_id)
    ? after.asset_id
    : before && isUuid(before.asset_id) ? before.asset_id : null;
  if (!assetId) return [];
  const event = (added: boolean): RecordHistoryChange => ({
    field: 'asset',
    event: added ? 'added' : 'removed',
    ...(added ? { after: referenceValue(ctx, 'asset', assetId) } : { before: referenceValue(ctx, 'asset', assetId) }),
  });
  if (row.before_json === null || row.before_json === undefined) return [event(true)];
  if (row.after_json === null || row.after_json === undefined) return [event(false)];
  const changes: RecordHistoryChange[] = [];
  if (before && after && before.is_operating_system !== after.is_operating_system) {
    changes.push({
      field: 'operating_system',
      before: before.is_operating_system === true,
      after: after.is_operating_system === true,
    });
  }
  if (before && after && !deepEqual(before.notes, after.notes)) {
    changes.push({ field: 'notes', before: before.notes ?? null, after: after.notes ?? null });
  }
  return changes;
}

/** An application link: a bulk `added`/`removed` set, a single link, or an old array. */
function applicationLinkChanges(row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  const before = isPlainObject(row.before_json) ? row.before_json : null;
  const after = isPlainObject(row.after_json) ? row.after_json : null;
  const added = after && Array.isArray(after.added) ? after.added.filter(isUuid).map((id) => id.toLowerCase()) : [];
  const removed = before && Array.isArray(before.removed) ? before.removed.filter(isUuid).map((id) => id.toLowerCase()) : [];
  if (added.length > 0 || removed.length > 0) {
    return [
      ...added.map((id): RecordHistoryChange => ({ field: 'application', event: 'added', after: referenceValue(ctx, 'application', id) })),
      ...removed.map((id): RecordHistoryChange => ({ field: 'application', event: 'removed', before: referenceValue(ctx, 'application', id) })),
    ];
  }
  if (Array.isArray(row.before_json) || Array.isArray(row.after_json)
    || (before && Array.isArray(before.ids)) || (after && Array.isArray(after.ids))) {
    return setLinkChanges('application', row, ctx);
  }
  const applicationId = after && isUuid(after.application_id)
    ? after.application_id
    : before && isUuid(before.application_id) ? before.application_id : null;
  if (!applicationId) return [];
  if (row.before_json === null || row.before_json === undefined) {
    return [{ field: 'application', event: 'added', after: referenceValue(ctx, 'application', applicationId) }];
  }
  if (row.after_json === null || row.after_json === undefined) {
    return [{ field: 'application', event: 'removed', before: referenceValue(ctx, 'application', applicationId) }];
  }
  if (before && after && !deepEqual(before.notes, after.notes)) {
    return [{ field: 'notes', before: before.notes ?? null, after: after.notes ?? null }];
  }
  return [];
}

/**
 * A budget line added or removed by an asset, a technology, a contract or a project, from its id
 * set. On a contract, a project or a request, the lines the reader may not read are counted, never named (`budget_lines_outside`:
 * "and 2 lines outside your access"), as its Budget tab counts them; a deleted line still reads
 * as deleted.
 */
function budgetLineChanges(row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  const before = new Set(linkSetIds(row.before_json));
  const after = new Set(linkSetIds(row.after_json));
  const counted = ctx.entry.table === 'contracts' || ctx.entry.table === 'portfolio_projects' || ctx.entry.table === 'portfolio_requests';
  const changes: RecordHistoryChange[] = [];
  const outside = { added: 0, removed: 0 };
  const push = (event: 'added' | 'removed', id: string) => {
    const value = referenceValue(ctx, 'budget_line', id);
    if (counted && value && 'hidden' in value && !value.deleted) {
      outside[event] += 1;
      return;
    }
    changes.push(event === 'added' ? { field: 'budget_line', event, after: value } : { field: 'budget_line', event, before: value });
  };
  for (const id of after) if (!before.has(id)) push('added', id);
  for (const id of before) if (!after.has(id)) push('removed', id);
  if (outside.added > 0) changes.push({ field: 'budget_lines_outside', event: 'added', after: outside.added });
  if (outside.removed > 0) changes.push({ field: 'budget_lines_outside', event: 'removed', before: outside.removed });
  return changes;
}

/**
 * A compliance item of a contract: its state and its reference, before and after. A creation
 * reads from nothing, a deletion to nothing; the requirement is the entry's title.
 */
function complianceChanges(row: AuditRow): RecordHistoryChange[] {
  const before = isPlainObject(row.before_json) ? row.before_json : {};
  const after = isPlainObject(row.after_json) ? row.after_json : {};
  const changes: RecordHistoryChange[] = [];
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
  for (const [key, field] of [['state', 'compliance_state'], ['reference', 'compliance_reference']] as const) {
    const b = text(before[key]);
    const a = text(after[key]);
    if (b !== a) changes.push({ field, before: b, after: a });
  }
  return changes;
}

/** The renewal decisions the contract screen names (`RENEWAL_DECISIONS`, and the undoing). */
const RENEWAL_DECISION_CODES = new Set(['renew', 'terminate', 'renegotiate', 'end', 'undo']);

/**
 * The renewal markers the renewal service writes beside the saved contract: each one is a sentence
 * ("Renewal decided: Renew", "Renewal stopped", "Renewal resumed", "Renewal task created: T-12"),
 * the task named with the reader's rights. The contract's own field changes follow.
 */
function renewalChanges(row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  const after = isPlainObject(row.after_json) ? row.after_json : null;
  if (!after) return [];
  const changes: RecordHistoryChange[] = [];
  const decision = isPlainObject(after.renewal_decision) ? after.renewal_decision : null;
  if (decision && typeof decision.decision === 'string' && RENEWAL_DECISION_CODES.has(decision.decision)) {
    changes.push({ field: 'renewal_decision', after: decision.decision });
    if (typeof decision.reason === 'string' && decision.reason.trim()) {
      changes.push({ field: 'renewal_reason', after: decision.reason.trim() });
    }
  }
  if (isPlainObject(after.renewal_stop)) changes.push({ field: 'renewal_stop', text: 'renewalStopped' });
  if (isPlainObject(after.renewal_resume)) changes.push({ field: 'renewal_resume', text: 'renewalResumed' });
  const task = isPlainObject(after.renewal_task) ? after.renewal_task : null;
  if (task) changes.push({ field: 'renewal_task', event: 'added', after: referenceValue(ctx, 'task', task.task_id) ?? { hidden: true, kind: 'task' } });
  return changes;
}

/** A vulnerability row: its CVE, its state and its note, in words. */
function vulnerabilityChanges(row: AuditRow): RecordHistoryChange[] {
  const before = isPlainObject(row.before_json) ? row.before_json : {};
  const after = isPlainObject(row.after_json) ? row.after_json : {};
  const changes: RecordHistoryChange[] = [];
  if (!deepEqual(before.cve_id, after.cve_id)) {
    changes.push({ field: 'cve_id', before: before.cve_id ?? null, after: after.cve_id ?? null });
  }
  if (!deepEqual(before.state, after.state)) {
    changes.push({ field: 'vulnerability_state', before: before.state ?? null, after: after.state ?? null });
  }
  if (!deepEqual(before.note, after.note)) {
    changes.push({ field: 'note', before: before.note ?? null, after: after.note ?? null });
  }
  return changes;
}

/** A catalogue synchronization row: its counts and description flags, as changes. */
function catalogSyncChanges(row: AuditRow): RecordHistoryChange[] | null {
  const after = isPlainObject(row.after_json) ? row.after_json : null;
  const sync = after && isPlainObject(after.catalog_sync) ? after.catalog_sync : null;
  if (!sync) return null;
  const changes: RecordHistoryChange[] = [];
  for (const field of ['versions_added', 'versions_updated', 'versions_attached', 'cpe_products_added',
    'cpe_products_removed', 'cve_names_added', 'cve_names_removed']) {
    const value = sync[field];
    if (!isEmptyHistoryValue(value)) changes.push({ field, after: value });
  }
  for (const field of ['description_filled', 'description_updated']) {
    if (sync[field] === true) changes.push({ field, after: true });
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

/** A sub-location: its creation and removal name it, its update reads its fields. */
function subItemChanges(row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  const name = labelOf(row, ['name']);
  if (row.action === 'create') return [{ field: 'sub_item', event: 'added', after: name }];
  if (row.action === 'delete') return [{ field: 'sub_item', event: 'removed', before: name }];
  return genericChanges(row, ctx, { label: row.table_name });
}

/** The people and roles of a site's internal contacts: a stored row or the assistant's relation items. */
function personStates(value: unknown): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const add = (id: unknown, role: unknown) => {
    if (!isUuid(id)) return;
    out.set(id.toLowerCase(), typeof role === 'string' && role.trim() ? role.trim() : null);
  };
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === 'string') {
        const [role, id] = entry.split(':');
        add(id, role);
        continue;
      }
      if (!isPlainObject(entry)) continue;
      const payload = isPlainObject(entry.payload) ? entry.payload : entry;
      add(payload.user_id ?? entry.key, payload.role);
    }
  } else if (isPlainObject(value)) {
    add(value.user_id, value.role);
  }
  return out;
}

/**
 * The person of an internal contact link, resolved with the reader's rights (people are always
 * readable), and the role the site gives them. The assistant writes the whole set as relation
 * items; the screen writes one row. Both read the same way.
 */
function personChanges(row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  const before = personStates(row.before_json);
  const after = personStates(row.after_json);
  const changes: RecordHistoryChange[] = [];
  for (const [id, role] of after) {
    if (before.has(id)) continue;
    changes.push({ field: 'person', event: 'added', after: referenceValue(ctx, 'user', id) });
    if (role) changes.push({ field: 'role', after: role });
  }
  for (const [id, role] of before) {
    if (after.has(id)) continue;
    changes.push({ field: 'person', event: 'removed', before: referenceValue(ctx, 'user', id) });
    if (role) changes.push({ field: 'role', before: role });
  }
  for (const [id, role] of after) {
    if (!before.has(id)) continue;
    const previous = before.get(id) ?? null;
    if (previous !== role) changes.push({ field: 'role', before: previous, after: role });
  }
  if (changes.length > 0) return changes;
  return genericChanges(row, ctx, { label: row.table_name });
}

/** The order of one leg in a before or after snapshot; null when the snapshot is not a leg list. */
function legOrderOf(value: unknown, legId: string | null): number | null {
  if (!Array.isArray(value)) return null;
  for (const entry of value) {
    if (!isPlainObject(entry)) continue;
    if (legId && String(entry.id ?? '').toLowerCase() !== legId) continue;
    const order = Number(entry.order_index);
    if (Number.isFinite(order)) return order;
  }
  return null;
}

/** The saved order of a leg row, from its payload. */
function legOrder(row: AuditRow): number | null {
  for (const payload of [row.after_json, row.before_json]) {
    if (!isPlainObject(payload)) continue;
    const order = Number(payload.order_index);
    if (Number.isFinite(order)) return order;
  }
  return null;
}

/**
 * A path segment: its creation and removal read as "Segment 2 added", its modification as the
 * fields that moved. The swap writes both legs in one row; the entry names the leg it moved.
 */
function legChanges(row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  if (Array.isArray(row.before_json) || Array.isArray(row.after_json)) {
    const legId = row.record_id ? String(row.record_id).toLowerCase() : null;
    const before = legOrderOf(row.before_json, legId);
    const after = legOrderOf(row.after_json, legId);
    if (before === after) return [];
    return [{ field: 'order_index', before, after }];
  }
  return genericChanges(row, ctx, { label: row.table_name });
}

/** A binding of one flow leg to one environment; its creation and removal read as its environment. */
function bindingChanges(row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  return genericChanges(row, ctx, { label: row.table_name });
}

/** The string states of a whole-set write (`["business:<id>"]`), unique and ordered. */
function stateStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')));
}

/** The id a `type:id` or `direction:id` state carries. */
function stateId(state: string): string | null {
  const index = state.indexOf(':');
  const id = index >= 0 ? state.slice(index + 1) : state;
  return isUuid(id) ? id : null;
}

/** The readable label of a web link in a whole-set write. */
function setLinkLabel(entry: unknown): string | null {
  if (!isPlainObject(entry)) return null;
  for (const field of ['description', 'url']) {
    const value = entry[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/** Stable identity of a link in a whole-set write: its kind, description and address. */
function setLinkKey(entry: unknown): string {
  return isPlainObject(entry)
    ? [entry.kind, entry.description, entry.url].map((value) => (value == null ? '' : String(value))).join('\u0000')
    : '';
}

/** A leg of the Flow tab, as a nameless reference the frontend reads as "Segment N". */
function interfaceLegRef(entry: Record<string, unknown>): RecordHistoryReference | null {
  const id = entry.id;
  if (!isUuid(id)) return null;
  const order = Number(entry.order_index);
  return { kind: 'leg', id: id.toLowerCase(), label: Number.isFinite(order) ? String(order) : null };
}

/**
 * A set the interface's writers replace as a whole: every element added or removed is one line,
 * the removed elements keep their readable label. The interface legs also report the fields a
 * leg changed, so an edit inside the Flow tab is not silent.
 */
function setChanges(row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  const label = row.table_name;
  if (label === 'interface_links' && !Array.isArray(row.before_json) && !Array.isArray(row.after_json)) {
    // A single-row write: the link presenter reads its address and description.
    return linkChanges(row);
  }
  if (label === 'interface_mapping_sets' || label === 'interface_mapping_groups' || label === 'interface_mapping_rules') {
    // A set is named by `name`; a group and a rule by `title`. Creation and removal are the event;
    // a modification reads the allow-listed fields.
    const field = label === 'interface_mapping_sets' ? 'mapping_set'
      : label === 'interface_mapping_groups' ? 'mapping_group' : 'mapping_rule';
    const name = labelOf(row, label === 'interface_mapping_sets' ? ['name'] : ['title']);
    if (row.action === 'create') return [{ field, event: 'added', after: name }];
    if (row.action === 'delete') return [{ field, event: 'removed', before: name }];
    return genericChanges(row, ctx, { label });
  }
  if (label === 'interface_legs') {
    const changes: RecordHistoryChange[] = [];
    const before = Array.isArray(row.before_json) ? row.before_json.filter(isPlainObject) : [];
    const after = Array.isArray(row.after_json) ? row.after_json.filter(isPlainObject) : [];
    const beforeById = new Map(before.filter((leg) => isUuid(leg.id)).map((leg) => [String(leg.id).toLowerCase(), leg]));
    const afterById = new Map(after.filter((leg) => isUuid(leg.id)).map((leg) => [String(leg.id).toLowerCase(), leg]));
    for (const [id, leg] of afterById) {
      if (!beforeById.has(id)) changes.push({ field: 'interface_leg', event: 'added', after: interfaceLegRef(leg) });
    }
    for (const [id, leg] of beforeById) {
      if (!afterById.has(id)) changes.push({ field: 'interface_leg', event: 'removed', before: interfaceLegRef(leg) });
    }
    for (const [id, leg] of afterById) {
      const previous = beforeById.get(id);
      if (!previous) continue;
      for (const field of ['leg_type', 'from_role', 'to_role', 'trigger_type', 'integration_pattern', 'data_format', 'job_name', 'order_index']) {
        if (!deepEqual(previous[field], leg[field])) {
          changes.push({ field, before: previous[field] ?? null, after: leg[field] ?? null });
        }
      }
    }
    return changes;
  }
  if (label === 'interface_links') {
    const describe = (entry: unknown) => setLinkLabel(entry);
    const before = new Map((Array.isArray(row.before_json) ? row.before_json : []).map((entry) => [setLinkKey(entry), entry]));
    const after = new Map((Array.isArray(row.after_json) ? row.after_json : []).map((entry) => [setLinkKey(entry), entry]));
    const changes: RecordHistoryChange[] = [];
    for (const [key, entry] of after) {
      if (!before.has(key)) changes.push({ field: 'link', event: 'added', after: describe(entry) });
    }
    for (const [key, entry] of before) {
      if (!after.has(key)) changes.push({ field: 'link', event: 'removed', before: describe(entry) });
    }
    return changes;
  }
  if (label === 'interface_owners') {
    // The owner type is part of the screen's line ("IT owner added"), so the type is the field.
    const before = ownerStates(row.before_json);
    const after = ownerStates(row.after_json);
    const changes: RecordHistoryChange[] = [];
    for (const [key, owner] of after) {
      if (before.has(key)) continue;
      changes.push({
        field: owner.role === 'it' ? 'owner_it' : 'owner_business',
        event: 'added',
        after: referenceValue(ctx, 'user', owner.userId),
      });
    }
    for (const [key, owner] of before) {
      if (after.has(key)) continue;
      changes.push({
        field: owner.role === 'it' ? 'owner_it' : 'owner_business',
        event: 'removed',
        before: referenceValue(ctx, 'user', owner.userId),
      });
    }
    return changes;
  }
  const beforeStates = stateStrings(row.before_json);
  const afterStates = stateStrings(row.after_json);
  if (beforeStates.length === 0 && afterStates.length === 0) return [];
  const beforeSet = new Set(beforeStates);
  const afterSet = new Set(afterStates);
  const changes: RecordHistoryChange[] = [];
  const valueOf = (state: string): unknown => {
    switch (label) {
      case 'interface_owners':
        return referenceValue(ctx, 'user', stateId(state));
      case 'interface_companies':
        return referenceValue(ctx, 'company', stateId(state));
      case 'interface_dependencies':
        return referenceValue(ctx, 'interface', stateId(state));
      case 'interface_key_identifiers': {
        const [source = '', destination = ''] = state.split(':');
        return [source, destination].filter((part) => part.trim() !== '').join(' → ');
      }
      case 'interface_data_residency':
        return state;
      case 'application_companies':
        return referenceValue(ctx, 'company', stateId(state));
      case 'application_departments':
        return referenceValue(ctx, 'department', stateId(state));
      case 'application_suites':
        return referenceValue(ctx, 'application', stateId(state));
      case 'application_data_residency':
        return state;
      default:
        return state;
    }
  };
  const fieldOf = (): string => {
    switch (label) {
      case 'interface_owners': return 'owner';
      case 'interface_companies': return 'company';
      case 'interface_dependencies': return 'dependency';
      case 'interface_key_identifiers': return 'key_identifier';
      case 'interface_data_residency': return 'country';
      case 'application_companies': return 'company';
      case 'application_departments': return 'department';
      case 'application_suites': return 'suite';
      case 'application_data_residency': return 'country';
      default: return 'set';
    }
  };
  const field = fieldOf();
  for (const state of afterStates) {
    if (!beforeSet.has(state)) changes.push({ field, event: 'added', after: valueOf(state) });
  }
  for (const state of beforeStates) {
    if (!afterSet.has(state)) changes.push({ field, event: 'removed', before: valueOf(state) });
  }
  return changes;
}

/** The environment code of a deployment row, from its payload (`after`, then `before`). */
function instanceEnvironment(row: AuditRow, side: 'before' | 'after'): string | null {
  const payload = side === 'after' ? row.after_json : row.before_json;
  return isPlainObject(payload) && typeof payload.environment === 'string' && payload.environment.trim()
    ? payload.environment.trim()
    : null;
}

/**
 * A deployment of the application: its creation and removal read as its environment ("Environment
 * added: Production"), its modification as the fields that changed, under the environment title.
 */
function instanceChanges(row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  if (row.action === 'create' || row.before_json === null || row.before_json === undefined) {
    return [{ field: 'instance', event: 'added', after: instanceEnvironment(row, 'after') }];
  }
  if (row.action === 'delete' || row.after_json === null || row.after_json === undefined) {
    return [{ field: 'instance', event: 'removed', before: instanceEnvironment(row, 'before') }];
  }
  return genericChanges(row, ctx, { label: row.table_name });
}

/** The deployment an assignment row names, in `after` then `before`. */
function assignmentInstanceId(row: AuditRow): string | null {
  for (const payload of [row.after_json, row.before_json]) {
    if (isPlainObject(payload) && isUuid(payload.app_instance_id)) return payload.app_instance_id.toLowerCase();
  }
  return null;
}

/**
 * A server of a deployment: the asset added or removed, named under the reader's rights (an asset
 * they cannot read stays "an asset"), with its role; a modification reads as the role, the date
 * and the notes that changed. The entry's title is the deployment's environment.
 */
function assignmentChanges(row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  const before = isPlainObject(row.before_json) ? row.before_json : null;
  const after = isPlainObject(row.after_json) ? row.after_json : null;
  const assetOf = (payload: Record<string, unknown> | null) => (payload && isUuid(payload.asset_id) ? payload.asset_id : null);
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
  if (!before) {
    const changes: RecordHistoryChange[] = [{ field: 'assignment', event: 'added', after: referenceValue(ctx, 'asset', assetOf(after)) ?? { hidden: true, kind: 'asset' } }];
    if (text(after?.role)) changes.push({ field: 'server_role', after: text(after?.role) });
    return changes;
  }
  if (!after) {
    return [{ field: 'assignment', event: 'removed', before: referenceValue(ctx, 'asset', assetOf(before)) ?? { hidden: true, kind: 'asset' } }];
  }
  const changes: RecordHistoryChange[] = [];
  const beforeAsset = assetOf(before)?.toLowerCase() ?? null;
  const afterAsset = assetOf(after)?.toLowerCase() ?? null;
  if (beforeAsset !== afterAsset) {
    if (beforeAsset) changes.push({ field: 'assignment', event: 'removed', before: referenceValue(ctx, 'asset', beforeAsset) });
    if (afterAsset) changes.push({ field: 'assignment', event: 'added', after: referenceValue(ctx, 'asset', afterAsset) });
  }
  if (!deepEqual(text(before.role), text(after.role))) changes.push({ field: 'server_role', before: text(before.role), after: text(after.role) });
  for (const field of ['since_date', 'notes'] as const) {
    if (!deepEqual(before[field] ?? null, after[field] ?? null)) changes.push({ field, before: before[field] ?? null, after: after[field] ?? null });
  }
  return changes;
}

/**
 * A business process link. Written from the process, the process is `record_id`; written from a
 * request (`setOwnedLink`, the assistant), `record_id` is the request and the payload the set of
 * process ids, so each process added or removed is one event.
 */
function processLinkChanges(row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  if (String(row.record_id ?? '').toLowerCase() === ctx.recordId.toLowerCase()) {
    const before = new Set(linkSetIds(row.before_json));
    const after = new Set(linkSetIds(row.after_json));
    const changes: RecordHistoryChange[] = [];
    for (const id of after) if (!before.has(id)) changes.push({ field: 'business_process', event: 'added', after: referenceValue(ctx, 'business_process', id) });
    for (const id of before) if (!after.has(id)) changes.push({ field: 'business_process', event: 'removed', before: referenceValue(ctx, 'business_process', id) });
    return changes;
  }
  const process = referenceValue(ctx, 'business_process', row.record_id);
  if (row.before_json === null || row.before_json === undefined) return [{ field: 'business_process', event: 'added', after: process }];
  if (row.after_json === null || row.after_json === undefined) return [{ field: 'business_process', event: 'removed', before: process }];
  return [];
}

/** The interface's middleware applications, written as an id list by older writers. */
function middlewareChanges(row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  const idsOf = (value: unknown): string[] => (
    Array.isArray(value) ? value.filter(isUuid).map((id) => id.toLowerCase()) : []
  );
  const before = new Set(idsOf(isPlainObject(row.before_json) ? row.before_json.middleware_application_ids : null));
  const after = new Set(idsOf(isPlainObject(row.after_json) ? row.after_json.middleware_application_ids : null));
  const changes: RecordHistoryChange[] = [];
  for (const id of after) {
    if (!before.has(id)) changes.push({ field: 'middleware', event: 'added', after: referenceValue(ctx, 'application', id) });
  }
  for (const id of before) {
    if (!after.has(id)) changes.push({ field: 'middleware', event: 'removed', before: referenceValue(ctx, 'application', id) });
  }
  return changes;
}

/** The status of a phase or a milestone reads from its own list, never the project's. */
function renamedStatus(changes: RecordHistoryChange[], field: 'phase_status' | 'milestone_status'): RecordHistoryChange[] {
  return changes.map((change) => (change.field === 'status' ? { ...change, field } : change));
}

/**
 * A phase or a milestone of the project: its creation and removal read as its name ("Phase added:
 * Design"), its modification as the fields that changed, under its name.
 */
function phaseChanges(kind: 'phase' | 'milestone', row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  const name = labelOf(row, ['name']);
  if (row.action === 'create' || row.before_json === null || row.before_json === undefined) {
    return [{ field: kind, event: 'added', after: name }];
  }
  if (row.action === 'delete' || row.after_json === null || row.after_json === undefined) {
    return [{ field: kind, event: 'removed', before: name }];
  }
  return renamedStatus(genericChanges(row, ctx, { label: row.table_name }), kind === 'phase' ? 'phase_status' : 'milestone_status');
}

/**
 * A time entry: its creation and removal name the person and the hours; its modification reads as
 * the fields that changed.
 */
function timeEntryChanges(row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  const before = isPlainObject(row.before_json) ? row.before_json : null;
  const after = isPlainObject(row.after_json) ? row.after_json : null;
  const hours = (payload: Record<string, unknown> | null) => historyNumber(payload?.hours ?? null);
  if (!before && after) {
    return [
      { field: 'time_entry', event: 'added', after: userValue(ctx, after.user_id) },
      ...(after.hours === undefined || after.hours === null ? [] : [{ field: 'hours', after: hours(after) }]),
    ];
  }
  if (before && !after) {
    return [
      { field: 'time_entry', event: 'removed', before: userValue(ctx, before.user_id) },
      ...(before.hours === undefined || before.hours === null ? [] : [{ field: 'hours', before: hours(before) }]),
    ];
  }
  return genericChanges(row, ctx, { label: row.table_name, numeric: ['hours'] });
}

/** The ids of a team payload (`{ role, ids }`), or of an effort allocation's people. */
function teamIds(value: unknown): string[] {
  return isPlainObject(value) ? linkSetIds(value) : [];
}

/** The role of a team payload: the IT or the business team. */
function teamRole(row: AuditRow): string | null {
  for (const payload of [row.after_json, row.before_json]) {
    if (isPlainObject(payload) && (payload.role === 'it_team' || payload.role === 'business_team')) return payload.role;
  }
  return null;
}

/** The percentages of an effort allocation payload: `{ allocations: [{ user_id, allocation_pct }] }`. */
function allocationShares(value: unknown): Map<string, number> {
  const out = new Map<string, number>();
  if (!isPlainObject(value) || !Array.isArray(value.allocations)) return out;
  for (const entry of value.allocations) {
    if (!isPlainObject(entry) || !isUuid(entry.user_id)) continue;
    const pct = Number(entry.allocation_pct);
    if (Number.isFinite(pct)) out.set(entry.user_id.toLowerCase(), pct);
  }
  return out;
}

/**
 * A team of a project or a request: each person added to or removed from the role ("IT team member
 * added: Jane Doe"). An effort allocation reads as its mode and as each person's share that moved
 * ("IT effort, Jane Doe: 40 % → 60 %"), the person named as every reader names people.
 */
function teamChanges(row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  const changes: RecordHistoryChange[] = [];
  if (/_effort_allocations$/.test(row.table_name)) {
    const before = isPlainObject(row.before_json) ? row.before_json : {};
    const after = isPlainObject(row.after_json) ? row.after_json : {};
    const type = after.effort_type === 'business' || before.effort_type === 'business' ? 'business' : 'it';
    const modeField = `${type}_effort_allocation_mode`;
    if (!deepEqual(before.mode ?? null, after.mode ?? null)) {
      changes.push({ field: modeField, before: before.mode ?? null, after: after.mode ?? null });
    }
    const beforeShares = allocationShares(before);
    const afterShares = allocationShares(after);
    const people = Array.from(new Set([...beforeShares.keys(), ...afterShares.keys()])).sort();
    for (const id of people) {
      const b = beforeShares.get(id) ?? null;
      const a = afterShares.get(id) ?? null;
      if (b === a) continue;
      const person = userValue(ctx, id);
      const name = isPlainObject(person) && !('hidden' in person) && typeof person.label === 'string' ? person.label : null;
      changes.push({ field: `effort_allocation_${type}`, dimension: name, before: b, after: a });
    }
    return changes;
  }
  const role = teamRole(row);
  if (!role) return [];
  const before = new Set(teamIds(row.before_json));
  const after = new Set(teamIds(row.after_json));
  for (const id of after) if (!before.has(id)) changes.push({ field: role, event: 'added', after: userValue(ctx, id) });
  for (const id of before) if (!after.has(id)) changes.push({ field: role, event: 'removed', before: userValue(ctx, id) });
  return changes;
}

/**
 * A dependency of a project or a request: each record it came to depend on, or stopped depending
 * on, named with the reader's rights (`{ ids }` projects, `request_ids` requests).
 */
function dependencyChanges(row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  const changes: RecordHistoryChange[] = [];
  const diff = (family: 'project' | 'request', read: (value: unknown) => string[]) => {
    const before = new Set(read(row.before_json));
    const after = new Set(read(row.after_json));
    for (const id of after) if (!before.has(id)) changes.push({ field: 'dependency', event: 'added', after: referenceValue(ctx, family, id) });
    for (const id of before) if (!after.has(id)) changes.push({ field: 'dependency', event: 'removed', before: referenceValue(ctx, family, id) });
  };
  diff('project', (value) => linkSetIds(value));
  diff('request', (value) => (isPlainObject(value) ? linkSetIds(value.request_ids) : []));
  return changes;
}

/** The integrated document slots a project or a request page shows, by slot key. */
const DOCUMENT_SLOTS: ReadonlySet<string> = new Set(['purpose', 'risks_mitigations', 'specification', 'overview']);

/** An edit of an integrated document of the record (its purpose, its risks): the slot, never its content. */
function documentChanges(row: AuditRow): RecordHistoryChange[] {
  for (const payload of [row.after_json, row.before_json]) {
    if (isPlainObject(payload) && typeof payload.slot === 'string' && DOCUMENT_SLOTS.has(payload.slot)) {
      return [{ field: 'document_updated', after: payload.slot }];
    }
  }
  return [];
}

/** The scoring of a project or a request: `criteria_values` maps a criterion id to an option id. */
function criteriaMap(value: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (!isPlainObject(value) || !isPlainObject(value.criteria_values)) return out;
  for (const [criterionId, optionId] of Object.entries(value.criteria_values)) {
    if (isUuid(criterionId) && isUuid(optionId)) out.set(criterionId.toLowerCase(), optionId.toLowerCase());
  }
  return out;
}

/**
 * Each criterion whose option changed, named by the criterion and its options as the scoring tab
 * names them. A criterion or an option deleted since reads as a deleted option, never as its id.
 */
function scoringChanges(row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  const before = criteriaMap(row.before_json);
  const after = criteriaMap(row.after_json);
  const option = (id: string | undefined): unknown => {
    if (!id) return null;
    const label = ctx.criterionOptions?.get(id);
    return label === undefined ? { hidden: true, kind: 'criterion_value', deleted: true } : label;
  };
  const changes: RecordHistoryChange[] = [];
  const criteria = Array.from(new Set([...before.keys(), ...after.keys()]));
  for (const criterionId of criteria) {
    const b = before.get(criterionId);
    const a = after.get(criterionId);
    if (b === a) continue;
    // A creation has no before: the scoring it starts with is a value, not a change.
    if (row.before_json === null || row.before_json === undefined) {
      changes.push({ field: 'criterion', dimension: ctx.criteria?.get(criterionId) ?? null, after: option(a) });
      continue;
    }
    changes.push({ field: 'criterion', dimension: ctx.criteria?.get(criterionId) ?? null, before: option(b), after: option(a) });
  }
  return changes;
}

/**
 * One change per dimension whose category changed. A removed value shows as `null`.
 * A creation names the value only: there is no before, as a criterion does.
 */
function dimensionChanges(before: unknown, after: unknown, ctx: PageContext, creating: boolean): RecordHistoryChange[] {
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
      ...(creating ? {} : { before: name(beforeCategory) }),
      after: name(afterCategory),
    });
  }
  return changes;
}

type GenericOptions = { label: string; /** Fields whose numeric strings read as numbers (the company metrics). */ numeric?: readonly string[] };

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
    const b = before[field];
    const a = after[field];
    if (deepEqual(b, a)) continue;
    if (isEmptyHistoryValue(b) && isEmptyHistoryValue(a)) continue;
    if (rule.hidden) {
      // A hidden value never comes out; a field that declares a word still tells that it changed,
      // on an update only (a creation or a deletion is the entry itself).
      if (rule.changedWord && !creating && !deleting) changes.push({ field, text: rule.changedWord });
      continue;
    }
    if (field === 'analytics_values') {
      changes.push(...dimensionChanges(b, a, ctx, creating));
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
    } else if (field.endsWith('_entity_code') && ctx.entry.table === 'connections') {
      const labelOfCode = (value: unknown) => (
        typeof value === 'string' && value.trim() && ctx.entityLabels.has(value.trim().toLowerCase())
          ? ctx.entityLabels.get(value.trim().toLowerCase())
          : value
      );
      beforeValue = labelOfCode(b);
      afterValue = labelOfCode(a);
    } else {
      beforeValue = safeScalar(b);
      afterValue = safeScalar(a);
    }
    if (options.numeric?.includes(field)) {
      beforeValue = historyNumber(beforeValue);
      afterValue = historyNumber(afterValue);
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

function taskPeople(value: unknown): string[] {
  return Array.isArray(value) ? Array.from(new Set(value.filter(isUuid).map((id) => id.toLowerCase()))) : [];
}

/**
 * A task's own row, beyond its allow-listed fields: the record it belongs to, read from its type and
 * its id together ("Belongs to: PRJ-3"), the request it was converted into, and each owner or viewer
 * added or removed. Every record is named with the reader's rights, or withheld by its kind.
 */
function taskRecordChanges(row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  const before = isPlainObject(row.before_json) ? row.before_json : null;
  const after = isPlainObject(row.after_json) ? row.after_json : null;
  const changes: RecordHistoryChange[] = [];
  const relatedKey = (payload: Record<string, unknown> | null) => (payload
    ? `${String(payload.related_object_type ?? '')}:${String(payload.related_object_id ?? '').toLowerCase()}`
    : null);
  const related = (payload: Record<string, unknown> | null) => {
    const family = payload ? taskRelatedFamily(payload.related_object_type) : null;
    return family && payload ? referenceValue(ctx, family, payload.related_object_id) : null;
  };
  if (relatedKey(before) !== relatedKey(after)) {
    const beforeValue = related(before);
    const afterValue = related(after);
    if (beforeValue || afterValue) {
      changes.push({
        field: 'related_object',
        ...(before ? { before: beforeValue } : {}),
        ...(after ? { after: afterValue } : {}),
      });
    }
  }
  const requestId = after?.converted_to_request_id;
  if (isUuid(requestId) && !deepEqual(before?.converted_to_request_id, requestId)) {
    changes.push({ field: 'converted_to_request', after: referenceValue(ctx, 'request', requestId) });
  }
  changes.push(...genericChanges(row, ctx, { label: row.table_name }));
  // A deletion is the entry itself: its people are not removed one by one.
  if (after) {
    for (const [field, kind] of [['owner_ids', 'task_owner'], ['viewer_ids', 'task_viewer']] as const) {
      const beforeSet = new Set(taskPeople(before?.[field]));
      const afterSet = new Set(taskPeople(after[field]));
      for (const id of afterSet) {
        if (!beforeSet.has(id)) changes.push({ field: kind, event: 'added', after: userValue(ctx, id) });
      }
      for (const id of beforeSet) {
        if (!afterSet.has(id)) changes.push({ field: kind, event: 'removed', before: userValue(ctx, id) });
      }
    }
  }
  return changes;
}

/** The project a request was converted into, named with the reader's rights on projects. */
function requestConversionChanges(row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  const before = isPlainObject(row.before_json) ? row.before_json : null;
  const after = isPlainObject(row.after_json) ? row.after_json : null;
  const projectId = after?.converted_to_project_id;
  if (!isUuid(projectId) || deepEqual(before?.converted_to_project_id, projectId)) return [];
  return [{ field: 'converted_to_project', after: referenceValue(ctx, 'project', projectId) }];
}

function recordChanges(row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  const columnOperation = columnOperationChanges(row);
  if (columnOperation) return columnOperation;
  if (row.table_name === 'technologies') {
    const sync = catalogSyncChanges(row);
    if (sync) return sync;
  }
  if (row.table_name === 'tasks' && ctx.entry.table === 'tasks') return taskRecordChanges(row, ctx);
  if (row.table_name === 'contracts') return [...renewalChanges(row, ctx), ...genericChanges(row, ctx, { label: row.table_name })];
  if (row.table_name === 'portfolio_projects') {
    return [...genericChanges(row, ctx, { label: row.table_name, numeric: PROJECT_NUMERIC_FIELDS }), ...scoringChanges(row, ctx)];
  }
  if (row.table_name === 'portfolio_requests') {
    // The deletion of the origin task names it under its own key: it reads as the origin task.
    const read = { ...row, before_json: requestAuditPayload(row.before_json), after_json: requestAuditPayload(row.after_json) };
    return [
      ...requestConversionChanges(read, ctx),
      ...genericChanges(read, ctx, { label: row.table_name, numeric: REQUEST_NUMERIC_FIELDS }),
      ...scoringChanges(read, ctx),
    ];
  }
  const changes = genericChanges(row, ctx, { label: row.table_name })
    // The middleware list has its own events below; the id-list itself is never a field line.
    .filter((change) => change.field !== 'middleware_application_ids');
  // An id list has no field line: each middleware application added or removed is one event.
  if (row.table_name === 'interfaces') return [...middlewareChanges(row, ctx), ...changes];
  return changes;
}

function valueName(row: AuditRow): string | null {
  for (const payload of [row.after_json, row.before_json]) {
    if (isPlainObject(payload) && typeof payload.name === 'string' && payload.name.trim()) return payload.name.trim();
  }
  return null;
}

/**
 * A value of a dimension: its addition and removal read as the event, its modification as the
 * fields that changed. A forced deletion keeps its removal title; the counts stay on the value's
 * own record entry.
 */
function valueChanges(row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  const name = valueName(row);
  if (row.action === 'create') return name ? [{ field: 'value', event: 'added', after: name }] : [];
  if (row.action === 'delete') return name ? [{ field: 'value', event: 'removed', before: name }] : [];
  return genericChanges(row, ctx, { label: 'analytics_categories' });
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
    case 'supplier':
      return linkRowChanges('supplier', row, ctx);
    case 'application':
      return row.table_name === 'application_technologies'
        ? applicationLinkChanges(row, ctx)
        : setLinkChanges('application', row, ctx);
    case 'technology':
      // From an asset or an application, the link row names the technology in `record_id`.
      return row.table_name === 'asset_technologies' || row.table_name === 'application_technologies'
        ? installedTechnology(row, ctx, isPlainObject(row.after_json) ? row.after_json : isPlainObject(row.before_json) ? row.before_json : null)
        : setLinkChanges('technology', row, ctx);
    case 'asset':
      // From a budget line, the asset wrote the set of its lines; from a contract or an incident,
      // the set holds the assets.
      if (row.table_name === 'asset_technologies') return installedAsset(row, ctx);
      return ctx.entry.table === 'spend_items' ? assetChanges(row, ctx) : setLinkChanges('asset', row, ctx);
    case 'budget_line':
      // A contact's link row names its budget line in the payload; an asset or a technology writes
      // the set of its budget lines.
      return ctx.entry.table === 'contacts' ? linkRowChanges('budget_line', row, ctx) : budgetLineChanges(row, ctx);
    case 'relation':
      return relationChanges(row, ctx);
    case 'member':
      return memberChanges(row, ctx);
    case 'owner':
      return ownerChanges(row, ctx);
    case 'vulnerability':
      return vulnerabilityChanges(row);
    case 'hardware':
    case 'support':
    case 'technology_version':
      return genericChanges(row, ctx, { label: row.table_name });
    case 'contract':
      // From the budget line, the contract links are sets whose payload lists the contracts or the
      // line ids; from a contact, the link row names its one contract in `contract_id`.
      return isPlainObject(row.after_json) && isUuid(row.after_json.contract_id)
        || isPlainObject(row.before_json) && isUuid(row.before_json.contract_id)
        ? linkRowChanges('contract', row, ctx)
        : linkedRecordChanges(kind, row, ctx);
    case 'project':
    case 'request':
      return linkedRecordChanges(kind, row, ctx);
    case 'task':
      return taskChanges(row, ctx);
    case 'metrics':
      return genericChanges(row, ctx, { label: row.table_name, numeric: ['headcount', 'it_users', 'turnover'] });
    case 'value':
      return valueChanges(row, ctx);
    case 'sub_item':
      return subItemChanges(row, ctx);
    case 'person':
      return personChanges(row, ctx);
    case 'leg':
      return legChanges(row, ctx);
    case 'set':
      return setChanges(row, ctx);
    case 'binding':
      return bindingChanges(row, ctx);
    case 'instance':
      return instanceChanges(row, ctx);
    case 'assignment':
      return assignmentChanges(row, ctx);
    case 'business_process':
      return processLinkChanges(row, ctx);
    case 'version':
      return genericChanges(row, ctx, { label: row.table_name });
    case 'compliance_item':
      return complianceChanges(row);
    case 'phase':
    case 'milestone':
      return phaseChanges(kind, row, ctx);
    case 'time_entry':
      return timeEntryChanges(row, ctx);
    case 'team':
      return teamChanges(row, ctx);
    case 'dependency':
      return dependencyChanges(row, ctx);
    case 'document':
      return documentChanges(row);
    default:
      return [];
  }
}

/** A budget year stored as a number or as its four digits. */
function budgetYear(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^\d{4}$/.test(value.trim())) return Number(value.trim());
  return null;
}

/**
 * The year a version entry names. The loaded row wins. A version deleted since is absent from
 * that map, and the audit payload still carries `budget_year`.
 */
function versionYear(row: AuditRow, ctx: PageContext): number | null {
  const stored = row.record_id ? ctx.versions.get(row.record_id.toLowerCase())?.year ?? null : null;
  if (stored !== null && Number.isFinite(stored)) return stored;
  for (const payload of [row.after_json, row.before_json]) {
    if (!isPlainObject(payload)) continue;
    const year = budgetYear(payload.budget_year);
    if (year !== null) return year;
  }
  return null;
}

function subjectLabel(row: AuditRow, kind: RecordHistoryChildKind | null, ctx: PageContext, changes: RecordHistoryChange[]): string | null {
  if (kind === null) return null;
  switch (kind) {
    case 'version': {
      // The screen names a budget year by its year ("Budget 2027"), never the stored version name.
      const year = versionYear(row, ctx);
      return year === null ? null : String(year);
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
    case 'value':
      return row.action === 'update' ? valueName(row) : null;
    case 'metrics': {
      for (const payload of [row.after_json, row.before_json]) {
        if (!isPlainObject(payload)) continue;
        if (typeof payload.fiscal_year === 'number') return String(payload.fiscal_year);
        if (typeof payload.fiscal_year === 'string' && payload.fiscal_year.trim()) return payload.fiscal_year.trim();
      }
      return null;
    }
    case 'sub_item':
      // The event line of a creation or removal carries the name; an update names it in its title.
      return row.action === 'create' || row.action === 'delete' ? null : labelOf(row, ['name']);
    case 'leg': {
      const order = Array.isArray(row.before_json) || Array.isArray(row.after_json)
        ? (legOrderOf(row.after_json, row.record_id ? String(row.record_id).toLowerCase() : null)
          ?? legOrderOf(row.before_json, row.record_id ? String(row.record_id).toLowerCase() : null))
        : legOrder(row);
      return order === null ? null : String(order);
    }
    case 'binding':
      return labelOf(row, ['environment']);
    case 'compliance_item':
      // The requirement code: the page names it as the Compliance tab does.
      return labelOf(row, ['requirement']);
    case 'phase':
    case 'milestone':
      // A creation or a removal names it in its event line; an update in its title.
      return row.action === 'create' || row.action === 'delete' ? null : labelOf(row, ['name']);
    case 'instance':
      // A creation or a removal names its environment in its event line; an update in its title.
      return row.action === 'create' || row.action === 'delete' ? null : labelOf(row, ['environment']);
    case 'assignment': {
      const instanceId = assignmentInstanceId(row);
      return instanceId ? ctx.instances?.get(instanceId) ?? null : null;
    }
    case 'person': {
      if (row.action === 'create' || row.action === 'delete') return null;
      for (const payload of [row.after_json, row.before_json]) {
        if (!isPlainObject(payload) || !isUuid(payload.user_id)) continue;
        const person = referenceValue(ctx, 'user', payload.user_id);
        return person && !('hidden' in person) ? person.label : null;
      }
      return null;
    }
    case 'set': {
      if (row.table_name === 'interface_legs' && Array.isArray(row.before_json) && Array.isArray(row.after_json)) {
        const before = new Map(row.before_json.filter(isPlainObject).filter((leg) => isUuid(leg.id)).map((leg) => [String(leg.id).toLowerCase(), leg]));
        const after = new Map(row.after_json.filter(isPlainObject).filter((leg) => isUuid(leg.id)).map((leg) => [String(leg.id).toLowerCase(), leg]));
        const changed: number[] = [];
        for (const [id, leg] of after) {
          const previous = before.get(id);
          if (!previous) continue;
          if (JSON.stringify(previous) !== JSON.stringify(leg)) {
            const order = Number(leg.order_index);
            if (Number.isFinite(order)) changed.push(order);
          }
        }
        return changed.length === 1 ? String(changed[0]) : null;
      }
      if (row.table_name === 'interface_links' && !Array.isArray(row.before_json) && !Array.isArray(row.after_json)) {
        return labelOf(row, ['description', 'url']);
      }
      return null;
    }
    case 'contact':
    case 'supplier':
    case 'budget_line':
    case 'application':
    case 'technology':
    case 'asset':
    case 'contract':
    case 'project':
    case 'request':
    case 'task':
    case 'relation':
    case 'member':
    case 'business_process':
    case 'owner': {
      const events = changes.filter((change) => change.event);
      const labels = new Set<string>();
      for (const change of events) {
        const value = (change.after ?? change.before) as RecordHistoryReference | RecordHistoryHiddenReference | null | undefined;
        if (value && typeof value === 'object' && !('hidden' in value) && typeof value.label === 'string' && value.label.trim()) {
          labels.add(value.label.trim());
        }
      }
      // The same label on both sides (a role change) names the entry; two different records do not.
      if (labels.size === 1) return Array.from(labels)[0];
      if (kind === 'task' && row.record_id) {
        return ctx.references.get('task')?.get(row.record_id.toLowerCase())?.label ?? null;
      }
      // A link whose contact did not change (an update of its role or primary flag) still names
      // the record it links to.
      if (isLinkKind(kind)) {
        const linked = linkIdOf(row, kind);
        if (linked) return ctx.references.get(kind)?.get(linked)?.label ?? null;
      }
      return null;
    }
    case 'technology_version': {
      const payload = isPlainObject(row.after_json) ? row.after_json : isPlainObject(row.before_json) ? row.before_json : null;
      return payload && typeof payload.label === 'string' ? payload.label.trim() || null : null;
    }
    case 'vulnerability': {
      const payload = isPlainObject(row.after_json) ? row.after_json : isPlainObject(row.before_json) ? row.before_json : null;
      return payload && typeof payload.cve_id === 'string' ? payload.cve_id.trim() || null : null;
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

/** A value as two sides of a change compare it: a number and its decimal text are one value. */
function comparableValue(value: unknown): unknown {
  // Only a plain decimal form: a code with a leading zero ("01000") stays text.
  if (typeof value === 'string' && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value.trim())) return Number(value);
  return value;
}

/**
 * A field change whose before and after read the same (a numeric column saved as a number after
 * it was read as text: "64.58 → 64.58") is no change. A change that carries more than its two
 * values (a year, a criterion, an event) keeps its own rule, and a withheld record on either side
 * stays: two hidden records may be two different ones.
 */
function unchangedValue(change: RecordHistoryChange): boolean {
  if (!Object.prototype.hasOwnProperty.call(change, 'before') || !Object.prototype.hasOwnProperty.call(change, 'after')) return false;
  if (Object.keys(change).some((key) => key !== 'field' && key !== 'before' && key !== 'after')) return false;
  const hidden = (value: unknown) => isPlainObject(value) && value.hidden === true;
  if (hidden(change.before) || hidden(change.after)) return false;
  return deepEqual(comparableValue(change.before), comparableValue(change.after));
}

export function presentItem(row: AuditRow, entry: RecordHistoryRecord, ctx: PageContext): RecordHistoryItem {
  const kind = entry.auditLabels.includes(row.table_name) ? null : recordHistoryChildKind(entry, row.table_name);
  // An update left with no visible change is dropped by the service.
  const changes = changesFor(row, kind, ctx).filter((change) => !unchangedValue(change));
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
  const id = value.toLowerCase();
  if (!ctx.readable[family]) return { hidden: true, kind: family };
  const row = ctx.references.get(family)?.get(id);
  if (!row) {
    // The person reads the module and the row is absent from its table: the record was deleted,
    // never merely withheld. The two never read the same.
    return ctx.deleted.get(family)?.has(id)
      ? { hidden: true, kind: family, deleted: true }
      : { hidden: true, kind: family };
  }
  return {
    kind: family,
    id,
    label: row.label ?? null,
    ...(row.reference ? { reference: row.reference } : {}),
  };
}

function userValue(ctx: PageContext, value: unknown): unknown {
  if (!isUuid(value)) return value;
  const id = value.toLowerCase();
  const row = ctx.readable.user ? ctx.users.get(id) : undefined;
  if (!row) {
    // A person outside the tenant, or a deleted account, is not a readable record. The history
    // tells the deleted one apart so a removal of their link does not read as a withheld name.
    return ctx.deleted.get('user')?.has(id)
      ? { hidden: true, kind: 'user', deleted: true }
      : { hidden: true, kind: 'user' };
  }
  return { kind: 'user', id, label: row.label ?? null };
}
