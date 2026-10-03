import React from 'react';
import api from '../api';
import type { EditConflictAuthor } from './editConflicts';

/**
 * What others changed on the record a workspace shows (plan planning/perf-scale, lot 3G), the
 * client side of `GET /<records>/:id/meta` (backend `common/record-meta.ts`, budget lines in
 * `spend/item-meta.ts`).
 *
 * - The page knows the counters it read or wrote itself: the line's `row_version` from its first
 *   load and from the answers of its own saves, each shown version's `budget_rev` from the Budget
 *   and Allocations tabs' loads and saves (`noteRowVersion`, `noteBudgetRev`). A refetch the page
 *   did not ask for (window focus) does not move them, so a change it brought is still said.
 * - Every 30 seconds while the tab is visible (at once when it becomes visible again), never while
 *   a save is pending or on its way, the meta is read. A counter larger than the known one, on the
 *   line or on the version of the year a Budget or Allocations tab shows, is a change made
 *   elsewhere. An answer that comes back while a save is pending or on its way is dropped (its
 *   counters may be the save's own); one that comes back after a save compares with the counter
 *   that save answered, and the counters only grow.
 * - Nothing of the user pending (no field edited and not saved, no choice waiting, no field being
 *   typed in): the page refreshes what moved in place (`refresh`), the counters become the read
 *   ones, and `notice` says who changed it and when ("Changed by Marie Dupont at 14:02").
 * - Something pending: nothing is refreshed, `outdated` says the line changed elsewhere until the
 *   user reloads (`reload`, which keeps what is pending: it meets the conflict checks when it is
 *   sent) or a later read finds nothing newer than what the page knows (its own save answered a
 *   newer counter, and its reload showed the change).
 * - A refresh that fails (it rejects) shows nothing: the counters stay, the next read tries again.
 * - The record is gone (the meta answers 404): `gone`, and no more reads.
 */

export type MetaVersion = { id: string; budget_year: number; budget_rev: number; changed_by: EditConflictAuthor | null; changed_at: string | null };

export type RecordMetaAnswer = {
  id: string;
  row_version: number;
  changed_by: EditConflictAuthor | null;
  changed_at: string | null;
  versions?: MetaVersion[];
};

/** Who changed the record and when, as the server could tell (either may be unknown). */
export type OthersChange = { by: EditConflictAuthor | null; at: string | null };

/** What moved: the line (to `rowVersion`, when read), the version of a year (`budgetYear`), or both. */
export type OthersRefresh = { line: boolean; budgetYear: number | null; rowVersion?: number | null };

export const OTHERS_POLL_MS = 30_000;

export type UseOthersChangesOptions = {
  /** The record shown (its id), null when there is none to watch (a create form, a record still loading). */
  recordId: string | null;
  /** The meta address of a record. */
  metaUrl: (recordId: string) => string;
  /** `row_version` of the record's first load: the counter the page starts from. */
  loadedRowVersion: number | null | undefined;
  /** The year whose version a Budget or Allocations tab shows, null when none is shown. */
  shownYear: number | null;
  /** A save is on its way (or about to go): no read meanwhile, and an answer read meanwhile is dropped. */
  isSaving: () => boolean;
  /** Something of the user is pending: nothing is refreshed under it. */
  hasPending: () => boolean;
  /** Shows what moved again from the server, keeping whatever is pending. */
  refresh: (what: OthersRefresh) => Promise<unknown> | unknown;
  intervalMs?: number;
};

export type OthersChanges = {
  /** The last change shown by a refresh, for a quiet message. */
  notice: OthersChange | null;
  /** The record was deleted (the meta answered 404). */
  gone: boolean;
  /** A change not shown because something was pending: the "changed elsewhere" badge. */
  outdated: OthersChange | null;
  reloading: boolean;
  /** The badge's action: refresh what moved, keeping what is pending. */
  reload: () => Promise<void>;
  /** The counter the page's own save of the line answered. */
  noteRowVersion: (recordId: string, rowVersion: unknown) => void;
  /** The counter of a year's version as a tab loaded or saved it (null: the year has no version). */
  noteBudgetRev: (recordId: string, year: number, budgetRev: unknown) => void;
  /** The counter of a year's version the page knows (undefined: none given yet), for a tab that may hold an older copy. */
  knownBudgetRev: (recordId: string, year: number) => number | null | undefined;
  /** Reads the meta now (the poll's tick). */
  check: () => Promise<void>;
};

type Known = { recordId: string | null; row: number | null; budget: Map<number, number | null> };

const counterOf = (value: unknown): number | null => {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/** The later of two changes (an unknown time loses). */
function latest(a: OthersChange | null, b: OthersChange | null): OthersChange | null {
  if (!a) return b;
  if (!b) return a;
  const time = (change: OthersChange) => (change.at ? Date.parse(change.at) : Number.NEGATIVE_INFINITY);
  return time(b) > time(a) ? b : a;
}

/** What moved in `meta` beyond `known`, and who did it. */
export function othersMoved(meta: RecordMetaAnswer, known: Known, shownYear: number | null): { refresh: OthersRefresh; change: OthersChange | null } {
  const row = counterOf(meta.row_version);
  const line = known.row !== null && row !== null && row > known.row;
  let budgetYear: number | null = null;
  let change: OthersChange | null = line ? { by: meta.changed_by ?? null, at: meta.changed_at ?? null } : null;
  if (shownYear !== null && known.budget.has(shownYear)) {
    const version = (meta.versions ?? []).find((entry) => Number(entry.budget_year) === shownYear);
    const rev = counterOf(version?.budget_rev);
    const knownRev = known.budget.get(shownYear) ?? null;
    // A version created elsewhere for the year shown, or a counter beyond the known one.
    if (rev !== null && (knownRev === null || rev > knownRev)) {
      budgetYear = shownYear;
      change = latest(change, { by: version?.changed_by ?? null, at: version?.changed_at ?? null });
    }
  }
  return { refresh: { line, budgetYear, rowVersion: row }, change: line || budgetYear !== null ? change : null };
}

/** An editable text field has the focus inside `root`: the user may be typing there. */
export function typingWithin(root: HTMLElement | null | undefined): boolean {
  const element = typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null;
  if (!root || !element || !root.contains(element)) return false;
  if (element.isContentEditable) return true;
  if (element instanceof HTMLTextAreaElement) return !element.readOnly && !element.disabled;
  if (element instanceof HTMLInputElement) return !element.readOnly && !element.disabled && !NOT_TYPED.has(element.type);
  return false;
}
const NOT_TYPED = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color', 'hidden', 'image']);

const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

export function useOthersChanges(options: UseOthersChangesOptions): OthersChanges {
  const { recordId, loadedRowVersion, shownYear } = options;
  const intervalMs = options.intervalMs ?? OTHERS_POLL_MS;
  const optionsRef = React.useRef(options);
  optionsRef.current = options;
  const knownRef = React.useRef<Known>({ recordId: null, row: null, budget: new Map() });
  const lastMetaRef = React.useRef<RecordMetaAnswer | null>(null);
  const runningRef = React.useRef(false);
  const abortRef = React.useRef<AbortController | null>(null);
  const [notice, setNotice] = React.useState<OthersChange | null>(null);
  const [gone, setGone] = React.useState(false);
  const goneRef = React.useRef(false);
  const [outdated, setOutdated] = React.useState<OthersChange | null>(null);
  const outdatedRef = React.useRef<OthersChange | null>(null);
  const [reloading, setReloading] = React.useState(false);
  const showOutdated = (next: OthersChange | null) => { outdatedRef.current = next; setOutdated(next); };

  // Another record: nothing known yet, nothing said.
  if (knownRef.current.recordId !== recordId) {
    knownRef.current = { recordId, row: null, budget: new Map() };
    lastMetaRef.current = null;
  }
  React.useEffect(() => {
    setNotice(null);
    setGone(false);
    goneRef.current = false;
    showOutdated(null);
    abortRef.current?.abort();
  }, [recordId]);
  // The record's first load is the counter the page starts from.
  const loadedRow = counterOf(loadedRowVersion);
  if (recordId && loadedRow !== null && knownRef.current.row === null) knownRef.current.row = loadedRow;

  /** The badge goes once the page knows as much as the last read (its own save showed the change). */
  const settleOutdated = React.useCallback(() => {
    const meta = lastMetaRef.current;
    if (!outdatedRef.current || !meta) return;
    if (!othersMoved(meta, knownRef.current, optionsRef.current.shownYear).change) showOutdated(null);
  }, []);

  const noteRowVersion = React.useCallback((id: string, value: unknown) => {
    const known = knownRef.current;
    const row = counterOf(value);
    if (id !== known.recordId || row === null) return;
    known.row = known.row === null ? row : Math.max(known.row, row);
    settleOutdated();
  }, [settleOutdated]);

  const noteBudgetRev = React.useCallback((id: string, year: number, value: unknown) => {
    const known = knownRef.current;
    if (id !== known.recordId) return;
    const rev = counterOf(value);
    const before = known.budget.has(year) ? known.budget.get(year)! : undefined;
    known.budget.set(year, before === undefined ? rev : rev === null ? before : before === null ? rev : Math.max(before, rev));
    settleOutdated();
  }, [settleOutdated]);

  const knownBudgetRev = React.useCallback((id: string, year: number) => {
    const known = knownRef.current;
    return id === known.recordId ? known.budget.get(year) : undefined;
  }, []);

  /** The counters of `meta` become the known ones (what moved is on screen now). */
  const absorb = (meta: RecordMetaAnswer, what: OthersRefresh) => {
    if (what.line) noteRowVersion(meta.id, meta.row_version);
    if (what.budgetYear !== null) {
      const version = (meta.versions ?? []).find((entry) => Number(entry.budget_year) === what.budgetYear);
      noteBudgetRev(meta.id, what.budgetYear, version?.budget_rev ?? null);
    }
  };

  const check = React.useCallback(async () => {
    const { recordId: id, metaUrl, isSaving } = optionsRef.current;
    if (!id || goneRef.current || runningRef.current || !visible() || isSaving()) return;
    runningRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      let meta: RecordMetaAnswer;
      try {
        meta = (await api.get<RecordMetaAnswer>(metaUrl(id), { signal: controller.signal })).data;
      } catch (error) {
        // Deleted: said once, nothing more to read. Any other failure says nothing: the next read tries again.
        const status = (error as { response?: { status?: number } } | null)?.response?.status;
        if (status === 404 && !controller.signal.aborted && optionsRef.current.recordId === id) {
          goneRef.current = true;
          setGone(true);
          showOutdated(null);
        }
        return;
      }
      const current = optionsRef.current;
      // Another record by now, or a save on its way: its counters may be the save's own.
      if (controller.signal.aborted || current.recordId !== id || !meta || meta.id !== id || current.isSaving()) return;
      lastMetaRef.current = meta;
      const moved = othersMoved(meta, knownRef.current, current.shownYear);
      if (!moved.change) {
        showOutdated(null);
        return;
      }
      if (current.hasPending()) {
        showOutdated(moved.change);
        return;
      }
      try {
        await current.refresh(moved.refresh);
      } catch {
        // Not shown: the counters stay, the next read finds the change again.
        return;
      }
      if (optionsRef.current.recordId !== id) return;
      absorb(meta, moved.refresh);
      showOutdated(null);
      setNotice(moved.change);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      runningRef.current = false;
    }
    // absorb only reads refs and stable callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reload = React.useCallback(async () => {
    const id = optionsRef.current.recordId;
    const meta = lastMetaRef.current;
    const change = outdatedRef.current;
    if (!id) return;
    setReloading(true);
    try {
      const what: OthersRefresh = meta ? othersMoved(meta, knownRef.current, optionsRef.current.shownYear).refresh : { line: true, budgetYear: null };
      // Nothing measured (an answer older than a save): the line, and the year shown.
      const refresh = what.line || what.budgetYear !== null ? what : { line: true, budgetYear: optionsRef.current.shownYear };
      try {
        await optionsRef.current.refresh(refresh);
      } catch {
        // Not shown: the badge stays, the user can try again.
        return;
      }
      if (optionsRef.current.recordId !== id) return;
      if (meta && meta.id === id) absorb(meta, refresh);
      showOutdated(null);
      if (change) setNotice(change);
    } finally {
      setReloading(false);
    }
    // absorb only reads refs and stable callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The poll: every `intervalMs` while the tab is visible, at once when it becomes visible again.
  React.useEffect(() => {
    if (!recordId) return undefined;
    let timer: number | null = null;
    const stop = () => {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
    };
    const start = () => {
      stop();
      timer = window.setInterval(() => { void check(); }, intervalMs);
    };
    const onVisibility = () => {
      if (visible()) {
        void check();
        start();
      } else {
        stop();
      }
    };
    if (visible()) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      abortRef.current?.abort();
    };
  }, [recordId, intervalMs, check]);

  // The year shown changed (a tab, a year): what was said about the previous one no longer holds.
  React.useEffect(() => { settleOutdated(); }, [shownYear, settleOutdated]);

  return React.useMemo(
    () => ({ notice, gone, outdated, reloading, reload, noteRowVersion, noteBudgetRev, knownBudgetRev, check }),
    [notice, gone, outdated, reloading, reload, noteRowVersion, noteBudgetRev, knownBudgetRev, check],
  );
}
