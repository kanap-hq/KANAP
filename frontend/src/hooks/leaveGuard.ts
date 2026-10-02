import { useCallback, useEffect, useRef } from 'react';

/**
 * Leaving a page through the app's own links (the left menu, the workspace
 * tabs of the top bar, the user menu), lot 3C review. The app runs under
 * `BrowserRouter`, which has no navigation blocker: a page with edits it could
 * not save yet (a busy server, an edit waiting for the user's choice) registers
 * a guard, and the layout asks it before such a move.
 *
 * - `isBusy`: something is not saved yet (checked at the click, synchronously);
 * - `leave`: saves what can be saved, asks the user about what cannot (the
 *   page's own confirmation, the same as its close button); true when the
 *   user may go.
 *
 * The browser's back and forward buttons are not covered (no blocker): the
 * page keeps such edits for the session (`useSharedPatchBuffer`) and shows
 * them again when the user comes back. A hard unload warns
 * (`useAutosaveRegistry`).
 */
export type LeaveGuard = {
  isBusy: () => boolean;
  leave: () => Promise<boolean>;
};

const guards = new Set<LeaveGuard>();

export function registerLeaveGuard(guard: LeaveGuard): () => void {
  guards.add(guard);
  return () => {
    guards.delete(guard);
  };
}

/** Whether a page would ask before the user leaves it. */
export function isLeaveGuarded(): boolean {
  return [...guards].some((guard) => guard.isBusy());
}

let asking: Promise<boolean> | null = null;

/** Asks every busy page in turn; true when the user may leave. A second move while one asks is dropped (false). */
export function confirmLeave(): Promise<boolean> {
  if (asking) return asking.then(() => false);
  const run = (async () => {
    for (const guard of [...guards]) {
      if (guard.isBusy() && !(await guard.leave().catch(() => false))) return false;
    }
    return true;
  })();
  asking = run;
  const done = () => {
    if (asking === run) asking = null;
  };
  run.then(done, done);
  return run;
}

/** Registers the page's guard for its lifetime; the latest `isBusy` and `leave` are called. */
export function useLeaveGuard(isBusy: () => boolean, leave: () => Promise<boolean>): void {
  const latest = useRef({ isBusy, leave });
  latest.current = { isBusy, leave };
  useEffect(() => registerLeaveGuard({
    isBusy: () => latest.current.isBusy(),
    leave: () => latest.current.leave(),
  }), []);
}

/** Runs `go` once the busy pages let the user leave (a menu item, a tab's own navigation). */
export function useGuardedLeave(): (go: () => void) => Promise<void> {
  return useCallback(async (go: () => void) => {
    if (isLeaveGuarded() && !(await confirmLeave())) return;
    go();
  }, []);
}

/**
 * Guards every in-app link of the document (a click on an `a[href]` to this
 * site, in the same tab): while a page is busy the click is held, the page
 * saves or asks, then the click goes through again. A link to another site,
 * to a new tab or with a modifier key is left alone (the page stays, or the
 * browser warns on unload). `navigate` follows a link removed from the page
 * meanwhile.
 */
export function useInAppLinkGuard(navigate: (to: string) => void): void {
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  useEffect(() => {
    let replaying = false;
    const onClick = (event: MouseEvent) => {
      if (replaying || event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor || anchor.hasAttribute('download')) return;
      if (anchor.target && anchor.target !== '_self') return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (!asking && !isLeaveGuarded()) return;
      event.preventDefault();
      event.stopPropagation();
      void confirmLeave().then((ok) => {
        if (!ok) return;
        if (!anchor.isConnected) {
          navigateRef.current(`${url.pathname}${url.search}${url.hash}`);
          return;
        }
        replaying = true;
        try {
          anchor.click();
        } finally {
          replaying = false;
        }
      });
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);
}
