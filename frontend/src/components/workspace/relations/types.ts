import type React from 'react';
import type { ContractLineMismatch } from '../../finance/ContractLineMismatchMark';
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

/** A project or a request linked by conversion: reference, name and status. Read only. */
export type ConversionRow = {
  id: string;
  item_number: number | null;
  name: string;
  status: string | null;
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
  /** Set on a budget line's contracts. Empty when the line and the contract agree. */
  mismatches?: ContractLineMismatch[];
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

/** An application linked to the owner. `reference` is already `APP-n`. */
export type ApplicationRelationRow = {
  id: string;
  reference: string;
  name: string;
  lifecycle: string;
  business_criticality: string | null;
  status: string;
};

/** An asset linked to the owner. `reference` is already `AST-n`. */
export type AssetRelationRow = {
  id: string;
  reference: string;
  name: string;
  kind: string;
  environment: string;
  status: string;
  /** The other containers in service holding it (`contains` only, R3). */
  also_contained_by?: Array<{ id: string; name: string }>;
  /** The members a cluster depends through (folded rows of `depends_on` only). */
  via?: Array<{ id: string; name: string }>;
};

/** A technology linked to the owner. `reference` is already `TEC-n`. */
export type TechnologyRelationRow = {
  id: string;
  reference: string;
  name: string;
  family: string;
  vendor: string | null;
};

/** A business process linked to the owner, with its business owner. */
export type BusinessProcessRow = {
  id: string;
  name: string;
  status: string | null;
  owner_name: string | null;
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
  /** One sentence in a tooltip after the title. */
  hint?: string;
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
  /**
   * Linked rows the caller does not see listed, counted (data access): `text` says it under the
   * rows ("and 3 lines outside your access"), or alone when `rows` is null ("3 budget lines").
   * Shown when `count` is above 0; a section with null rows shows only then.
   */
  outside?: { count: number; text: string };
  /**
   * Rows kept under one folded line at the end of the body, closed at first (the members behind
   * a cluster's dependencies). They have no action of their own.
   */
  folded?: { label: React.ReactNode; rows: T[] };
};

/** An interface linked to the owner (upstream or downstream). `reference` is already `INT-n`. */
export type InterfaceRelationRow = {
  id: string;
  reference: string | null;
  name: string;
  source_application_name: string | null;
  target_application_name: string | null;
  lifecycle: string;
};
