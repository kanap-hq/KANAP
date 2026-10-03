import React from 'react';
import { OthersChanges, OthersRefresh, typingWithin, useOthersChanges } from '../../hooks/othersChanges';
import type { BudgetTabHandle } from './BudgetTab';
import type { AllocationsTabHandle } from './AllocationsTab';
import type { HeldChoices } from './heldChoices';

/**
 * What others changed on the OPEX or CAPEX line a workspace shows (plan planning/perf-scale, lot
 * 3G), wired to the item page: the line's own fields and, on the Budget and Allocations tabs, the
 * version of the year shown (`hooks/othersChanges.ts` has the rules).
 *
 * Pending, so nothing is refreshed and the "changed elsewhere" badge shows instead: a field of the
 * line edited and not saved, being saved or waiting for a choice; a budget or allocation choice
 * kept for the line while the user is on another tab; what the Budget or Allocations tab shown has
 * pending (`hasPending`); a Relations edit not saved; the focus in a text field of the workspace
 * (the user may be typing there).
 */
export type LineOthersChangesOptions = {
  /** `/spend-items` or `/capex-items`. */
  itemsApi: string;
  /** The line shown, null on a create form or while the next line loads (prev/next). */
  lineId: string | null;
  /** The line's `row_version` as loaded. */
  rowVersion: unknown;
  tab: string;
  year: number;
  root: React.RefObject<HTMLElement | null>;
  /** The page's autosave has a save pending or on its way. */
  lineSaving: () => boolean;
  /** A field of this line is buffered, on its way, or waiting for a choice. */
  linePending: () => boolean;
  budget: React.RefObject<BudgetTabHandle | null>;
  allocations: React.RefObject<AllocationsTabHandle | null>;
  heldChoices: HeldChoices;
  /** Another tab of the line has an edit not saved (Relations). */
  otherTabDirty: () => boolean;
  /** Reads the line again (the detail), unless it already holds `rowVersion`; resolves once shown. */
  refreshLine: (rowVersion: number | null) => Promise<unknown>;
};

export type LineOthersChanges = OthersChanges & {
  /** Something of the user is pending (see above): the page's window-focus refetch waits too. */
  hasPending: () => boolean;
};

export function useLineOthersChanges(options: LineOthersChangesOptions): LineOthersChanges {
  const { itemsApi, lineId, rowVersion, tab, year } = options;
  const ref = React.useRef(options);
  ref.current = options;
  const shownYear = tab === 'budget' || tab === 'allocations' ? year : null;

  const isSaving = React.useCallback(() => {
    const o = ref.current;
    return o.lineSaving()
      || (o.tab === 'budget' && !!o.budget.current?.isSaving())
      || (o.tab === 'allocations' && !!o.allocations.current?.isSaving());
  }, []);

  const hasPending = React.useCallback(() => {
    const o = ref.current;
    const id = o.lineId;
    return o.linePending()
      || (!!id && (o.heldChoices.budget.current?.lineId === id || o.heldChoices.allocation.current?.lineId === id))
      || (o.tab === 'budget' && !!o.budget.current?.hasPending())
      || (o.tab === 'allocations' && !!o.allocations.current?.hasPending())
      || o.otherTabDirty()
      || typingWithin(o.root.current);
  }, []);

  const refresh = React.useCallback(async (what: OthersRefresh) => {
    const o = ref.current;
    const jobs: Array<Promise<unknown> | undefined> = [];
    if (what.line) jobs.push(o.refreshLine(what.rowVersion ?? null));
    if (what.budgetYear !== null && what.budgetYear === o.year) {
      if (o.tab === 'budget') jobs.push(o.budget.current?.reloadFromServer());
      else if (o.tab === 'allocations') jobs.push(o.allocations.current?.reloadFromServer());
    }
    await Promise.all(jobs);
  }, []);

  const metaUrl = React.useCallback((id: string) => `${itemsApi}/${id}/meta`, [itemsApi]);
  const others = useOthersChanges({
    recordId: lineId,
    metaUrl,
    loadedRowVersion: rowVersion as number | null | undefined,
    shownYear,
    isSaving,
    hasPending,
    refresh,
  });
  return React.useMemo(() => ({ ...others, hasPending }), [others, hasPending]);
}
