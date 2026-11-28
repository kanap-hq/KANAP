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
  /** The last refused save (server answer), until the next change; the page says it in its own words. */
  error: unknown;
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
  /** Sends what waits; false when a save failed and is still kept. */
  flush: () => Promise<boolean>;
  /** Something waits or is being sent. */
  isBusy: () => boolean;
}

/**
 * The one autosave of a settings page, on `useAutosave`. Every field of the page goes through it, so
 * the page has a single "Saving… / Saved" state. Saves of different fields queue in order; a new
 * value of a field replaces the one still waiting for it.
 *
 * Leaving the page through the app's links (`useLeaveGuard`) first sends what waits; only a save
 * that could not go through asks before leaving. A reload or a closed tab warns while something
 * waits (`useAutosaveRegistry`).
 */
export function useSettingsAutosave(): SettingsAutosave {
  const { t } = useTranslation(['common']);
  const dialogs = useKanapDialogs();
  const registry = useAutosaveRegistry();
  const [error, setError] = React.useState<unknown>(null);
  const autosave = useAutosave({ delay: SETTINGS_TEXT_DELAY_MS, registry, onError: setError });
  // Field -> its latest save, in the order the fields changed.
  const pendingRef = React.useRef(new Map<string, SettingSave>());

  // Runs the saves waiting at that moment, in order. A save that can go through a moment later
  // (busy server) is put back for the retry, unless a newer value of its field came meanwhile.
  const runPending = React.useCallback(async () => {
    const entries = [...pendingRef.current.entries()];
    pendingRef.current.clear();
    for (let index = 0; index < entries.length; index += 1) {
      try {
        await entries[index][1]();
      } catch (failure) {
        if (isTransientSaveFailure(failure)) {
          for (const [field, save] of entries.slice(index)) {
            if (!pendingRef.current.has(field)) pendingRef.current.set(field, save);
          }
        }
        throw failure;
      }
    }
  }, []);

  const { schedule, flush: flushAutosave, discard, isBusy, status } = autosave;

  const put = React.useCallback((field: string, save: SettingSave | null): boolean => {
    setError(null);
    pendingRef.current.delete(field);
    if (save) pendingRef.current.set(field, save);
    if (pendingRef.current.size > 0) {
      schedule(runPending);
      return true;
    }
    // Nothing left to send: the save that only waited is dropped (one being sent still lands).
    if (status === 'pending') discard();
    return false;
  }, [schedule, runPending, discard, status]);

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
    if (!isBusy()) return true;
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

  return { status, error, choose, type, commit, flush, isBusy };
}

export default useSettingsAutosave;
