import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LOOKUP_PAGE_SIZE, lookupIdsKey, useLookupSearch, type LookupOption, type LookupScope } from './useLookupPicker';

/**
 * A new record starts from what is obvious (lot A2, decision D39): a starred field whose picker
 * offers this person one value only takes it, and a list filtered on one value hands it to the
 * record created from it. Both fill the field once, as if the person had chosen the value.
 *
 * A value here is an id or a code; null when there is nothing to fill (no value, several, a read
 * refused or in error); undefined while it is not known yet.
 */
export type FillValue = string | null | undefined;

/** Where a limited data access lets this person put a record (`useLinePlacementDefault`). */
export type PlacementStart = { ready: boolean; companyId: string | null; needsChoice: boolean };

/** No data access limit: every company the picker offers. */
export const UNSCOPED_PLACEMENT: PlacementStart = { ready: true, companyId: null, needsChoice: false };

/**
 * The one value a lookup picker offers, read as it reads it (same endpoint, scope and lifecycle):
 * one page of two rows, one row and no more is the only value.
 */
export function useOnlyLookupValue({ endpoint, scope, enabled = true }: {
  endpoint: string;
  scope?: LookupScope;
  enabled?: boolean;
}): FillValue {
  const search = useLookupSearch<LookupOption>({ endpoint, scope, open: true, text: '', enabled, limit: 2 });
  const row = enabled && search.settled && search.items.length === 1 && !search.hasMore ? search.items[0] : null;
  useLabelKnown(endpoint, row);
  if (!enabled || search.failed) return null;
  if (!search.settled) return undefined;
  return row?.id ?? null;
}

/**
 * The row found is the label of the value filled: the picker reads it from the cache instead of
 * asking for it again by id.
 */
function useLabelKnown(endpoint: string, row: LookupOption | null): void {
  const queryClient = useQueryClient();
  React.useEffect(() => {
    if (row && !queryClient.getQueryData(lookupIdsKey(endpoint, [row.id]))) queryClient.setQueryData(lookupIdsKey(endpoint, [row.id]), [row]);
  }, [endpoint, queryClient, row]);
}

/**
 * The one company a company picker offers this person: the one company of a limited data access
 * (none when the access leaves a choice), otherwise the one company of the workspace.
 */
export function useOnlyCompany(placement: PlacementStart, enabled = true): FillValue {
  const open = enabled && placement.ready && !placement.needsChoice && !placement.companyId;
  const only = useOnlyLookupValue({ endpoint: '/companies/lookup', enabled: open });
  if (!enabled) return null;
  if (!placement.ready) return undefined;
  if (placement.needsChoice) return null;
  return placement.companyId ?? only;
}

/**
 * The one row a lookup picker offers whose label is exactly `label` (a list filter holds labels):
 * searched by `text` (the label itself by default), null when no row or several carry it, or when
 * `allowed` leaves it out.
 */
export function useLookupLabelMatch<T extends LookupOption>({ endpoint, scope, label, text, labelOf, allowed, enabled = true }: {
  endpoint: string;
  scope?: LookupScope;
  label: string | null;
  text?: string;
  labelOf: (row: T) => string;
  allowed?: ReadonlySet<string> | null;
  enabled?: boolean;
}): FillValue {
  const open = enabled && !!label;
  const search = useLookupSearch<T>({ endpoint, scope, open, text: text ?? label ?? '', enabled: open, limit: LOOKUP_PAGE_SIZE });
  const matches = open && search.settled ? search.items.filter((row) => labelOf(row) === label) : [];
  const row = matches.length === 1 && (!allowed || allowed.has(matches[0].id)) ? matches[0] : null;
  useLabelKnown(endpoint, row);
  if (!open || search.failed) return null;
  if (!search.settled) return undefined;
  return row?.id ?? null;
}

/**
 * Of a filter value and an obvious value, the one that fills: the filter's when it names a value
 * offered, the obvious one otherwise. Undefined while the filter's is not known.
 */
export function firstFill(fromFilter: FillValue, obvious: FillValue): FillValue {
  if (fromFilter === undefined) return undefined;
  return fromFilter ?? obvious;
}

/** A fill that does not show (each one emptied again before the page renders it) is not tried forever. */
const MAX_FILLS = 3;

/**
 * Fills a field of a new record once: while the field is empty and its value is known, `fill` runs
 * with it, as the person's choice would. Once the page has rendered the field with a value (the one
 * given here, the person's, or one another field brought), an empty field was emptied on purpose and
 * is never filled again on the page. The memory is what the page showed, not the call to `fill`: an
 * effect of the page that empties its draft on mount (twice under `React.StrictMode`) cannot leave the
 * field empty for good. `empty` is true while the field holds nothing, or only its default (pass null
 * as `value` when the value is that default). `key` names the field and what its value depends on
 * (an account is filled once per company and type); null while the field cannot take a value yet.
 * A record that exists is never filled.
 */
export function useFillOnce({ isNew, key, empty, value, fill }: {
  isNew: boolean;
  key: string | null;
  empty: boolean;
  value: FillValue;
  fill: (value: string) => void;
}): void {
  const stateRef = React.useRef({ key: null as string | null, shown: false, fills: 0 });
  // After every render: the field as the page shows it now decides.
  React.useEffect(() => {
    const state = stateRef.current;
    if (!isNew) {
      stateRef.current = { key: null, shown: false, fills: 0 };
      return;
    }
    if (key === null) return;
    if (state.key !== key) stateRef.current = { key, shown: false, fills: 0 };
    const current = stateRef.current;
    if (current.shown) return;
    if (!empty) {
      current.shown = true;
      return;
    }
    if (!value || current.fills >= MAX_FILLS) return;
    current.fills += 1;
    fill(value);
  });
}
