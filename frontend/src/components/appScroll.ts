/**
 * Keyboard scrolling for the bounded app shell (Layout).
 *
 * The page scrolls inside `.kanap-app-scroll`, or, in a workspace, inside its content column,
 * not the window. The browser sends PageDown / Space / arrows to the focused element's scroll
 * container, so after a navigation started from the side nav or the app bar nothing would
 * scroll until the user clicked into the page. After each navigation Layout hands focus to
 * the page's primary scroller, without taking it from anything the page or the user chose.
 */

/** Marks a workspace's own scroller (the content column). Layout focuses it when present. */
export const PRIMARY_SCROLL_ATTR = 'data-primary-scroll';
const PRIMARY_SCROLL_SELECTOR = `[${PRIMARY_SCROLL_ATTR}]`;

const OVERLAY_SELECTOR = '[role="dialog"], [role="presentation"], [role="menu"], [role="listbox"], [role="tooltip"]';

function isEditable(el: Element): boolean {
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function isUnfocused(active: Element | null): boolean {
  return !active || active === document.body || active === document.documentElement;
}

/**
 * Whether focus may move to the page scroller.
 * `atNavigation`: true for the check made right when the route changes, where the focused
 * element is the link, tab or row that started the navigation. Later checks (the page is
 * still loading) only move focus that is nowhere, or still on the app scroller.
 */
export function canTakeFocus(appScroller: HTMLElement, active: Element | null, atNavigation: boolean): boolean {
  if (isUnfocused(active) || active === appScroller) return true;
  if (!atNavigation) return false;
  const el = active as Element;
  // A field the page autofocused or the user is typing in, or an open menu or dialog.
  if (isEditable(el) || el.closest(OVERLAY_SELECTOR)) return false;
  // Focus already inside the page's primary scroller: keyboard scrolling works from there.
  const primary = appScroller.querySelector(PRIMARY_SCROLL_SELECTOR);
  if (primary && primary.contains(el)) return false;
  return true;
}

/**
 * Focus the page's primary scroller (a workspace content column) or, failing that, the app
 * scroller, with `preventScroll`. A code-split page or a workspace still loading has no
 * content column yet, so the scroller subtree is watched until one appears or `timeoutMs`
 * passes. Returns a cleanup to call on the next navigation.
 */
export function focusPageScroller(appScroller: HTMLElement, timeoutMs = 5000): () => void {
  const attempt = (atNavigation: boolean): boolean => {
    const primary = appScroller.querySelector<HTMLElement>(PRIMARY_SCROLL_SELECTOR);
    const target = primary ?? appScroller;
    if (document.activeElement !== target && canTakeFocus(appScroller, document.activeElement, atNavigation)) {
      target.focus({ preventScroll: true });
    }
    return primary !== null;
  };

  if (attempt(true)) return () => {};

  let timer: number | undefined;
  const observer = new MutationObserver(() => {
    if (attempt(false)) stop();
  });
  function stop() {
    observer.disconnect();
    if (timer !== undefined) window.clearTimeout(timer);
  }
  observer.observe(appScroller, { childList: true, subtree: true });
  timer = window.setTimeout(stop, timeoutMs);
  return stop;
}
