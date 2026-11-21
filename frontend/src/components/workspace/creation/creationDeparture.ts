import React from 'react';
import { isCreationField } from './creationFieldFocus';

const PAGE = '[data-workspace-shell]';
/** A list, a menu or a dialog opened over the page: a choice made there is made on the page. */
const OVER_PAGE = '.MuiModal-root, .MuiPopper-root, [role="dialog"]';

/**
 * Follows the focus as it leaves a field of a page that creates a record (`useDraftCreation`), and
 * says how it left (`onExit`):
 * - a passage (`true`): to another field of the same page, or by a key that ends the entry in the
 *   field itself (Enter blurs some fields). The field is given.
 * - a departure (`false`): anywhere else. A button of the page (Cancel, Create, the way back, a
 *   tab), a link, the menu, a panel beside the page, Tab out of the page, another window or tab,
 *   or nowhere (a click on the page's background, a button Safari does not focus). The field
 *   gives nothing.
 *
 * A list, a menu or a dialog opened from the field is neither: a choice made there is made on the
 * page. `onReturn` follows the focus coming back to a field of the page (from another window, a
 * list or a button of the page). Returns the function that stops listening.
 *
 * The listeners run before the page's own: the way the focus left is known when the field commits.
 */
export function watchCreationFocus({ onExit, onReturn }: { onExit: (passage: boolean) => void; onReturn: () => void }): () => void {
  // The key whose press is running: a field it blurs (Enter) is given in place.
  let pressed: { key: string; target: EventTarget | null } | null = null;
  const onKeyDown = (event: KeyboardEvent) => {
    const current = { key: event.key, target: event.target };
    pressed = current;
    window.setTimeout(() => {
      if (pressed === current) pressed = null;
    }, 0);
  };
  const onFocusOut = (event: FocusEvent) => {
    const from = event.target instanceof Element ? event.target : null;
    const page = from?.closest(PAGE);
    if (!from || !page) return;
    const to = event.relatedTarget instanceof Element ? event.relatedTarget : null;
    if (to && page.contains(to) && isCreationField(to)) {
      onExit(true);
      return;
    }
    if (to?.closest(OVER_PAGE)) return;
    onExit(!to && pressed?.target === from && pressed.key !== 'Tab');
  };
  const onFocusIn = (event: FocusEvent) => {
    const at = event.target instanceof Element ? event.target : null;
    if (at?.closest(PAGE) && isCreationField(at)) onReturn();
  };
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('focusout', onFocusOut, true);
  document.addEventListener('focusin', onFocusIn, true);
  return () => {
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('focusout', onFocusOut, true);
    document.removeEventListener('focusin', onFocusIn, true);
  };
}

/**
 * Whether the person is still on the new page a write started from: the page is mounted and its
 * address still names the new record (`isCreate`). A write that ends after a departure brings
 * nobody back (`useTitleCreation`, `useDraftCreation`).
 */
export function useCreationPresence(isCreate: boolean): () => boolean {
  const state = React.useRef({ mounted: false, isCreate });
  state.current.isCreate = isCreate;
  React.useEffect(() => {
    const current = state.current;
    current.mounted = true;
    return () => {
      current.mounted = false;
    };
  }, []);
  return React.useCallback(() => state.current.mounted && state.current.isCreate, []);
}
