import type { AggregateRequest, AggregateResult, AggregateRow } from '../pages/reports/reportAggregates';

/**
 * A stand-in of `POST /…/summary/aggregate` for component tests: the server's rules
 * (`backend/src/common/list-engine/list-aggregate.ts`) on summary rows shaped as the list returns
 * them (`versions` slots, `analytics_value_ids`, names). Enough of them for the reports, the
 * dashboard and the operations pages: set filters (include, exclude, blank markers), blank and
 * not blank, combined AND models; sums with `minus` and `part`, in cents; `having`; orders by
 * measure, key or count, then the keys; `limit`; the total. The real engine is checked against
 * the former browser computation by the backend parity spec.
 */

type Row = Record<string, any>;
type Account = { id: string; consolidation_account_number?: number | null; consolidation_account_name?: string | null };

const SLOT_OFFSETS: Record<string, number> = { yMinus2: -2, yMinus1: -1, y: 0, yPlus1: 1, yPlus2: 2 };
const SUFFIX_METRIC: Record<string, string> = { Budget: 'budget', Revision: 'revision', Forecast: 'forecast', FollowUp: 'follow_up', Landing: 'landing' };
const AMOUNT = /^(local_)?(yMinus2|yMinus1|yPlus1|yPlus2|y\d{4}|y)(Budget|Revision|Forecast|FollowUp|Landing)$/;
const HAS_VERSION = /^has_version_(yMinus2|yMinus1|yPlus1|yPlus2|y\d{4}|y)$/;

function slotYear(slot: string): number {
  const Y = new Date().getFullYear();
  return slot in SLOT_OFFSETS ? Y + SLOT_OFFSETS[slot] : Number(slot.slice(1));
}

function versionOf(row: Row, year: number): any {
  const Y = new Date().getFullYear();
  const dynamic = row.versions?.[`y${year}`];
  if (dynamic) return dynamic;
  const slot = Object.keys(SLOT_OFFSETS).find((key) => Y + SLOT_OFFSETS[key] === year);
  return slot ? row.versions?.[slot] : undefined;
}

/** An amount in cents (reporting currency, or the line's own with `local_`). */
function amountCents(row: Row, field: string): number | null {
  const match = AMOUNT.exec(field);
  if (!match) return null;
  const version = versionOf(row, slotYear(match[2]));
  const metric = SUFFIX_METRIC[match[3]];
  const source = match[1] ? version?.totals : (version?.reporting ?? version?.totals);
  return Math.round(Number(source?.[metric] ?? 0) * 100);
}

function consolidationKey(account: Account | undefined): { key: string | null; label: string | null } {
  const num = account?.consolidation_account_number ?? null;
  const name = (account?.consolidation_account_name ?? '').trim() || null;
  if (num == null && !name) return { key: null, label: null };
  return {
    key: `c_${num != null ? num : name!.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`,
    label: name && num != null ? `[${num}] ${name}` : (name ?? `[${num}]`),
  };
}

function textValue(row: Row, field: string, accounts: Map<string, Account>): string | null {
  const hasVersion = HAS_VERSION.exec(field);
  if (hasVersion) return versionOf(row, slotYear(hasVersion[1]))?.year != null ? 'yes' : null;
  if (field.startsWith('analytics_id_')) return row.analytics_value_ids?.[field.slice('analytics_id_'.length)] ?? null;
  const accountId = row.account?.id ?? row.account_id ?? null;
  if (field === 'account_id') return accountId;
  if (field === 'account_consolidation_key' || field === 'account_consolidation_label') {
    const { key, label } = consolidationKey(accountId ? accounts.get(accountId) : undefined);
    if (field === 'account_consolidation_key') return key;
    // One label per key: the least of the accounts sharing it.
    if (key == null) return null;
    const labels = Array.from(accounts.values()).map(consolidationKey).filter((c) => c.key === key).map((c) => c.label as string).sort();
    return labels[0] ?? label;
  }
  const value = row[field];
  if (value == null || value === '') return null;
  return String(value);
}

function passes(row: Row, field: string, model: any, accounts: Map<string, Account>): boolean {
  if (model?.operator && Array.isArray(model.conditions)) {
    const results = model.conditions.map((condition: any) => passes(row, field, condition, accounts));
    return model.operator === 'OR' ? results.some(Boolean) : results.every(Boolean);
  }
  const type = model?.type ?? model?.filterType;
  const value = AMOUNT.test(field) ? String(amountCents(row, field)! / 100) : textValue(row, field, accounts);
  if (type === 'blank') return value == null;
  if (type === 'notBlank') return value != null;
  if (type === 'set' || model?.filterType === 'set') {
    const values: Array<string | null> = model.values ?? [];
    const blankListed = values.some((v) => v == null || v === '');
    const listed = values.filter((v): v is string => v != null && v !== '');
    if (model.mode === 'exclude') return value == null ? !blankListed : !listed.includes(value);
    return value == null ? blankListed : listed.includes(value);
  }
  return true;
}

type Group = { keys: Array<string | null>; rows: Row[] };

function measureCents(rows: Row[], measure: AggregateRequest['spec']['measures'][number]): number {
  let sum = 0;
  for (const row of rows) {
    let cents = amountCents(row, measure.field) ?? 0;
    if (measure.minus) cents -= amountCents(row, measure.minus) ?? 0;
    if (measure.part === 'positive') cents = Math.max(cents, 0);
    if (measure.part === 'negative') cents = Math.min(cents, 0);
    sum += cents;
  }
  return sum;
}

function rowOf(keys: Array<string | null>, rows: Row[], request: AggregateRequest): AggregateRow {
  return {
    keys,
    count: rows.length,
    values: Object.fromEntries(request.spec.measures.map((m) => [m.id, measureCents(rows, m) / 100])),
    unknown: {},
  };
}

const compareText = (a: string | null, b: string | null) => (a === b ? 0 : a == null ? -1 : b == null ? 1 : a.localeCompare(b));

export function fakeAggregate(rows: Row[], request: AggregateRequest, options: { accounts?: Account[] } = {}): AggregateResult {
  const accounts = new Map((options.accounts ?? []).map((account) => [account.id, account]));
  const filters = request.query.filters ?? {};
  const kept = rows.filter((row) => Object.entries(filters).every(([field, model]) => passes(row, field, model, accounts)));
  const { spec } = request;
  const byKey = new Map<string, Group>();
  for (const row of kept) {
    const keys = spec.groupBy.map((field) => textValue(row, field, accounts));
    const id = JSON.stringify(keys);
    const group = byKey.get(id) ?? { keys, rows: [] };
    group.rows.push(row);
    byKey.set(id, group);
  }
  let groups = Array.from(byKey.values()).map((group) => rowOf(group.keys, group.rows, request));
  for (const having of spec.having ?? []) {
    groups = groups.filter((group) => {
      const value = group.values[having.measure] ?? 0;
      switch (having.op) {
        case 'gt': return value > having.value;
        case 'gte': return value >= having.value;
        case 'lt': return value < having.value;
        case 'lte': return value <= having.value;
        case 'eq': return value === having.value;
        default: return value !== having.value;
      }
    });
  }
  const order = spec.order?.length ? spec.order : [{ by: 'count' as const, dir: 'DESC' as const }];
  groups.sort((a, b) => {
    for (const term of order) {
      const sign = term.dir === 'DESC' ? -1 : 1;
      let diff = 0;
      if (term.by === 'count') diff = (a.count - b.count) * sign;
      else if (term.by === 'measure') diff = ((a.values[term.id!] ?? 0) - (b.values[term.id!] ?? 0)) * sign;
      else {
        const x = a.keys[term.index!];
        const y = b.keys[term.index!];
        if (x == null || y == null) {
          if (x !== y) diff = (x == null) === ((term.nulls ?? (term.dir === 'ASC' ? 'LAST' : 'FIRST')) === 'FIRST') ? -1 : 1;
        } else diff = x.localeCompare(y) * sign;
      }
      if (diff !== 0) return diff;
    }
    for (let i = 0; i < a.keys.length; i += 1) {
      const diff = compareText(a.keys[i], b.keys[i]);
      if (diff !== 0) return diff;
    }
    return 0;
  });
  const groupCount = groups.length;
  const shown = spec.limit != null ? groups.slice(0, spec.limit) : groups;
  const rest = spec.limit != null ? groups.slice(spec.limit) : [];
  const restRows = rest.length ? Array.from(byKey.values()).filter((g) => rest.some((r) => JSON.stringify(r.keys) === JSON.stringify(g.keys))).flatMap((g) => g.rows) : [];
  return {
    groups: shown,
    others: spec.others && rest.length ? rowOf([], restRows, request) : null,
    total: rowOf([], kept, request),
    groupCount,
    reportingCurrency: spec.measures.length ? 'EUR' : null,
  };
}

/** The distinct values of `fields` over the rows (`/summary/filter-values`), nulls last. */
export function fakeFilterValues(rows: Row[], fields: string[]): Record<string, Array<string | null>> {
  const accounts = new Map<string, Account>();
  return Object.fromEntries(fields.map((field) => {
    const values = Array.from(new Set(rows.map((row) => textValue(row, field, accounts))));
    return [field, values.sort(compareText).sort((a, b) => (a == null ? 1 : 0) - (b == null ? 1 : 0))];
  }));
}
