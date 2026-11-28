import React from 'react';
import { useTranslation } from 'react-i18next';
import useAutosave, { isTransientSaveFailure, useAutosaveRegistry, type AutosaveStatus } from '../../hooks/useAutosave';
import { useLeaveGuard } from '../../hooks/leaveGuard';
import { useKanapDialogs } from '../design';

/** The save of one field: the page's call to its API. */
export type SettingSave = () => Promise<unknown>;

/** Wait before a text being typed is sent, when the field keeps the focus (design-ecrans.md §4). */
export const SETTINGS_TEXT_DELAY_MS = 700;

export interface SettingsAutosave {
  /** The page's one save state, shown by `SettingsPage` in its header. */
  status: AutosaveStatus;
  /**
   * A save the busy server put off and that is still kept once its automatic retries are spent: it
   * goes again with the next change (`autosaveErrorMessage` says so). Null otherwise.
   */
  error: unknown;
  /**
   * The server's refusal of the last value sent for `field`, until that field changes again (null
   * otherwise). The page shows the stored value again and this refusal under the field.
   */
  errorOf: (field: string) => unknown;
  /**
   * A choice, a switch, a date: sent at once. `null` when the page's validation refuses the value:
   * nothing is sent for the field and what waited for it is dropped, so the stored value stays.
   */
  choose: (field: string, save: SettingSave | null) => void;
  /**
   * A text being typed: sent 700 ms after the last key, or at once when the field loses the focus
   * (`commit`). `null` when the value is refused (or back to the stored one): nothing waits for the field.
   */
  type: (field: string, save: SettingSave | null) => void;
  /** The text field lost the focus: what waits is sent now. */
  commit: () => void;
  /** Sends what waits; false when a save failed. */
  flush: () => Promise<boolean>;
  /** Something waits or is being sent. */
  isBusy: () => boolean;
}

/**
 * The one autosave of a settings page, on `useAutosave`. Every field of the page goes through it, so
 * the page has a single "Saving… / Saved" state. Saves of different fields queue in order; a new
 * value of a field replaces the one still waiting for it. Every waiting field is sent, whatever the
 * server answers the others: a refusal is kept for its field (`errorOf`), a field the busy server
 * puts off is sent again.
 *
 * Leaving the page through the app's links (`useLeaveGuard`) first sends what waits. A refused save
 * keeps the person on the page, its refusal under its field; a save still kept (busy server) asks
 * before leaving. A reload or a closed tab warns while something waits (`useAutosaveRegistry`).
 */
export function useSettingsAutosave(): SettingsAutosave {
  const { t } = useTranslation(['common']);
  const dialogs = useKanapDialogs();
  const registry = useAutosaveRegistry();
  const [error, setError] = React.useState<unknown>(null);
  const [refusals, setRefusals] = React.useState<Record<string, unknown>>({});
  // The refusals are kept by field as the run meets them; `useAutosave` only reports the kept save.
  const onError = React.useCallback((failure: unknown) => {
    if (isTransientSaveFailure(failure)) setError(failure);
  }, []);
  const autosave = useAutosave({ delay: SETTINGS_TEXT_DELAY_MS, registry, onError });
  const { schedule, flush: flushAutosave, discard, isBusy, status } = autosave;
  // Field -> its latest save, in the order the fields changed.
  const pendingRef = React.useRef(new Map<string, SettingSave>());
  // A run of the waiting saves is on its way: its outcome must not be dropped.
  const runningRef = React.useRef(false);
  const scheduleRef = React.useRef(schedule);
  scheduleRef.current = schedule;

  // Runs every save waiting at that moment, in order, whatever the server answers each one. A
  // refusal is kept for its field; a save the busy server puts off goes back in the queue, unless a
  // newer value of its field came meanwhile. The first refusal is raised once the run ends (the
  // page's state says "Not saved"); a put off save is raised otherwise, so `useAutosave` retries it.
  const runPending = React.useCallback(async function run(): Promise<void> {
    const entries = [...pendingRef.current.entries()];
    pendingRef.current.clear();
    let refusal: unknown = null;
    let putOff: unknown = null;
    runningRef.current = true;
    try {
      for (const [field, save] of entries) {
        try {
          await save();
        } catch (failure) {
          // A newer value of the field waits: it is sent, and its own outcome counts.
          const replaced = pendingRef.current.has(field);
          if (isTransientSaveFailure(failure)) {
            putOff ??= failure;
            if (!replaced) pendingRef.current.set(field, save);
          } else {
            refusal ??= failure;
            if (!replaced) setRefusals((current) => ({ ...current, [field]: failure }));
          }
        }
      }
    } finally {
      runningRef.current = false;
    }
    if (refusal) {
      // `useAutosave` drops a refused run: what the busy server put off goes in a run of its own.
      if (putOff) scheduleRef.current(run);
      throw refusal;
    }
    if (putOff) throw putOff;
  }, []);

  const put = React.useCallback((field: string, save: SettingSave | null): boolean => {
    setError(null);
    setRefusals((current) => {
      if (!(field in current)) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
    pendingRef.current.delete(field);
    if (save) pendingRef.current.set(field, save);
    if (pendingRef.current.size > 0) {
      schedule(runPending);
      return true;
    }
    // Nothing left to send: only what waited is dropped. A run on its way keeps its outcome (its
    // refusal, the retry of a save the busy server put off).
    if (!runningRef.current) discard();
    return false;
  }, [schedule, runPending, discard]);

  const choose = React.useCallback((field: string, save: SettingSave | null) => {
    if (put(field, save)) void flushAutosave();
  }, [put, flushAutosave]);

  const type = React.useCallback((field: string, save: SettingSave | null) => {
    put(field, save);
  }, [put]);

  const commit = React.useCallback(() => {
    if (pendingRef.current.size > 0) void flushAutosave();
  }, [flushAutosave]);

  const flush = React.useCallback(() => flushAutosave(), [flushAutosave]);

  const leave = React.useCallback(async (): Promise<boolean> => {
    if (await flushAutosave()) return true;
    // Refused: the person stays and reads the refusal under its field, like on a budget line.
    if (!isBusy()) return false;
    const confirmed = await dialogs.confirm({
      title: t('common:autosave.leaveTitle'),
      message: t('common:autosave.leaveMessage'),
      confirmLabel: t('common:autosave.leaveConfirm'),
      intent: 'danger',
    });
    if (!confirmed) return false;
    pendingRef.current.clear();
    discard();
    return true;
  }, [flushAutosave, isBusy, dialogs, t, discard]);

  useLeaveGuard(isBusy, leave);

  const errorOf = React.useCallback((field: string) => refusals[field] ?? null, [refusals]);

  return { status, error, errorOf, choose, type, commit, flush, isBusy };
}

export default useSettingsAutosave;
