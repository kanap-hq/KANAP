import { EntityManager } from 'typeorm';
import { isLimitedTransaction } from '../data-access/line-write-checks';

/**
 * The budget lines in a project's or a request's history (`portfolio_activities.changed_fields`,
 * keys `opex_items` and `capex_items`, each `[before, after]`), under data-scoped access
 * (planning/data-scoped-access/spec.md §5.4, §6.6).
 *
 * A replacement of the lines stores each side as `{ id, label }` entries. The history is read per
 * reader, in their transaction:
 * - a person who reads the budget and has access to all data sees every label, as before;
 * - a limited person who reads the budget sees the labels of the lines they can read, and the
 *   number of the others (`{ labels, hidden }`);
 * - a person without the budget right (limited or not) sees the number of lines only
 *   (`{ labels: null, hidden }`).
 * Rows written before the ids were stored hold labels only: unchanged for the first reader, a
 * count for the two others. The ids never leave the server.
 */

export type ActivityBudgetLine = { id: string; label: string };

/** A side of the change as one reader sees it: every label, or the readable ones and a count. */
export type ActivityBudgetLineSide = string[] | { labels: string[] | null; hidden: number };

export const BUDGET_LINE_ACTIVITY_FIELDS = ['opex_items', 'capex_items'] as const;

/** The lines of one nature with their labels, sorted by label; a line not found keeps its id. */
export async function activityBudgetLines(mg: EntityManager, nature: 'opex' | 'capex', ids: string[]): Promise<ActivityBudgetLine[]> {
  if (ids.length === 0) return [];
  const rows: Array<{ id: string; product_name: string | null; description: string | null }> = await mg.query(
    `SELECT id, product_name, description
     FROM spend_items
     WHERE tenant_id = app_current_tenant() AND id = ANY($1::uuid[]) AND nature = $2`,
    [ids, nature],
  );
  const byId = new Map<string, string>();
  for (const row of rows) {
    // A CAPEX line's title is its `product_name` (lot Z1); an OPEX line falls back to its description.
    const label = nature === 'capex' ? row.product_name : row.product_name || row.description;
    byId.set(String(row.id).toLowerCase(), label || row.id);
  }
  return ids
    .map((id) => ({ id, label: byId.get(id.toLowerCase()) ?? id }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

function isStoredLine(value: unknown): value is ActivityBudgetLine {
  return typeof value === 'object' && value !== null && typeof (value as any).id === 'string';
}

/** A side written with ids (every entry an `{ id, label }`); an empty side counts as one. */
function storedLines(side: unknown): ActivityBudgetLine[] | null {
  if (!Array.isArray(side) || !side.every(isStoredLine)) return null;
  return side as ActivityBudgetLine[];
}

type ActivityRow = { changed_fields?: Record<string, unknown> | null };

/** The budget line changes of these activities, as `reader` may see them. One query at most. */
export async function budgetLineActivitiesForReader<T extends ActivityRow>(
  mg: EntityManager,
  activities: T[],
  readsBudget: boolean,
): Promise<T[]> {
  const touched = activities.filter((a) => BUDGET_LINE_ACTIVITY_FIELDS.some((field) => Array.isArray(a.changed_fields?.[field])));
  if (touched.length === 0) return activities;

  const limited = readsBudget && (await isLimitedTransaction(mg));
  let readable: Set<string> | null = null;
  if (limited) {
    const ids = new Set<string>();
    for (const a of touched) {
      for (const field of BUDGET_LINE_ACTIVITY_FIELDS) {
        const change = a.changed_fields?.[field];
        if (!Array.isArray(change)) continue;
        for (const side of change) for (const line of storedLines(side) ?? []) ids.add(line.id.toLowerCase());
      }
    }
    // Under the person's policies: the lines they cannot read do not come back.
    const rows: Array<{ id: string }> = ids.size === 0 ? [] : await mg.query(
      `SELECT id FROM spend_items WHERE tenant_id = app_current_tenant() AND id = ANY($1::uuid[])`,
      [Array.from(ids)],
    );
    readable = new Set(rows.map((row) => String(row.id).toLowerCase()));
  }

  const sideFor = (side: unknown): unknown => {
    const lines = storedLines(side);
    const count = Array.isArray(side) ? side.length : 0;
    if (!Array.isArray(side) || count === 0) return side;
    if (!readsBudget) return { labels: null, hidden: count };
    if (!lines) return limited ? { labels: null, hidden: count } : side;
    if (!readable) return lines.map((line) => line.label);
    const shown = lines.filter((line) => readable!.has(line.id.toLowerCase())).map((line) => line.label);
    return shown.length === count ? shown : { labels: shown, hidden: count - shown.length };
  };

  return activities.map((a) => {
    if (!touched.includes(a)) return a;
    const changed: Record<string, unknown> = { ...(a.changed_fields as Record<string, unknown>) };
    for (const field of BUDGET_LINE_ACTIVITY_FIELDS) {
      const change = changed[field];
      if (Array.isArray(change)) changed[field] = change.map(sideFor);
    }
    return { ...a, changed_fields: changed };
  });
}
