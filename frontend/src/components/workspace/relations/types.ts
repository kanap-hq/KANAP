import type React from 'react';
import type { RelationOption } from '../RelationAddPicker';
import type { RelationsColumn } from '../RelationsTable';

/** A budget line linked to the owner, with its amount for the year in the reporting currency. */
export type BudgetLineRow = {
  id: string;
  item_number: number | null;
  nature: 'opex' | 'capex';
  product_name: string;
  supplier_name: string | null;
  amount: number | null;
  currency: string;
  status: string;
  /** No rate for the year: `amount` is null, this is the amount in the line's own currency, left out of the total. */
  fx_missing?: { currency: string; amount: number };
};

export type ContractRow = {
  id: string;
  name: string;
  supplier_name: string | null;
  end_date: string | null;
  yearly_amount: number | null;
  currency: string | null;
  auto_renewal: boolean;
  in_renewal_window: boolean;
  status: string;
};

export type ProjectRow = {
  id: string;
  item_number: number | null;
  name: string;
  status: string | null;
  planned_end: string | null;
};

export type IncidentLinkRow = {
  id: string;
  item_number: number;
  title: string | null;
  status: string;
  severity: string;
  detected_at: string | null;
};

/** A row the shared sections can link and unlink. */
export type AnyRow = { id: string };

/** One total line under a relations table. */
export type RelationTotal = { key: string; label: React.ReactNode; cells: Record<string, React.ReactNode> };

/**
 * A linked section, as data: what it shows, where its rows lead, how its picker searches.
 * `rows` is null when the caller cannot read the module, and the section is left out.
 */
export type SectionSpec<T extends AnyRow> = {
  kind: string;
  title: string;
  empty: string;
  searchPlaceholder: string;
  rows: T[] | null;
  columns: Array<RelationsColumn<T>>;
  href: (row: T) => string;
  label: (row: T) => string;
  muted?: (row: T) => boolean;
  /** Linking needs a right on the other module too (incidents); true by default. */
  editable?: boolean;
  /** Rows that can be unlinked (all by default): a closed incident cannot. */
  removable?: (row: T) => boolean;
  /** The rows the picker never offers (all by default). */
  linkedIds?: (rows: T[]) => Set<string>;
  search: (q: string, signal?: AbortSignal) => Promise<RelationOption[]>;
  /** Total lines under the table, shown from two rows on. */
  totals?: (rows: T[]) => RelationTotal[];
  /** A line under the table (what its totals leave out). */
  notice?: (rows: T[]) => React.ReactNode;
};
