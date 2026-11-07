import React from 'react';
import focusWhenMounted from './focusWhenMounted';

/**
 * What a person types or chooses in. The same set as the shell's required-field walk, plus a
 * native select. Buttons (a hint, the properties handle, Create and Cancel) are not fields.
 */
const ENTRY_FIELDS = [
  'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="file"]):not([type="image"]):not([disabled]):not([tabindex="-1"]):not([aria-hidden="true"])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[role="combobox"]:not([aria-disabled="true"]):not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(', ');

/** A preview of a record created at its title is on screen but out of reach until the record exists. */
function reachable(el: HTMLElement): boolean {
  return !el.closest('[inert], [data-testid="creation-preview"]');
}

function firstEntry(scope: ParentNode): HTMLElement | null {
  for (const node of scope.querySelectorAll<HTMLElement>(ENTRY_FIELDS)) {
    if (reachable(node)) return node;
  }
  return null;
}

/**
 * The field Tab from a creation title should land on.
 * A `[data-creation-field]` wins when the plain order would pick the wrong control.
 * Otherwise the first field of the properties panel, then of the main content.
 */
export function findFirstCreationField(root: ParentNode): HTMLElement | null {
  for (const marker of root.querySelectorAll<HTMLElement>('[data-creation-field]')) {
    if (!reachable(marker)) continue;
    if (marker.matches(ENTRY_FIELDS)) return marker;
    const inner = firstEntry(marker);
    if (inner) return inner;
  }
  for (const name of ['properties', 'main'] as const) {
    for (const panel of root.querySelectorAll<HTMLElement>(`[data-creation-panel="${name}"]`)) {
      const field = firstEntry(panel);
      if (field) return field;
    }
  }
  return null;
}

// Armed by Tab in the title. The page that replaces the draft (the record just created) reads it.
// Cleared when that field is focused, when the workspace goes away, or after a few seconds.
let pendingUntil = 0;
let pendingTimer = 0;

export function creationFieldFocusPending(): boolean {
  return Date.now() < pendingUntil;
}

export function clearCreationFieldFocus(): void {
  pendingUntil = 0;
  window.clearTimeout(pendingTimer);
}

function armCreationFieldFocus(): void {
  pendingUntil = Date.now() + 8000;
  window.clearTimeout(pendingTimer);
  pendingTimer = window.setTimeout(() => {
    pendingUntil = 0;
  }, 8000);
}

function focusFromTitle(root: ParentNode, el: HTMLElement): void {
  const active = document.activeElement;
  const title = root.querySelector('[data-creation-title]');
  // Layout hands focus to the page scroller after a navigation: that is not a choice of the person.
  const atScroller = active instanceof HTMLElement && (active.hasAttribute('data-primary-scroll') || active.classList.contains('kanap-app-scroll'));
  const atTitle = !active || active === document.body || active === document.documentElement || atScroller || !!title?.contains(active);
  if (atTitle && active !== el) el.focus();
}

/**
 * Tab in a creation title: commit has already run, and the focus goes to the first field.
 * `focusWhenMounted` covers a field that appears in the next renders. The hook below covers
 * the page the create opens afterwards, which can arrive later than that half-second.
 */
export function focusFirstCreationField(): void {
  armCreationFieldFocus();
  focusWhenMounted(() => findFirstCreationField(document));
}

/**
 * Places the focus armed by `focusFirstCreationField` once the field is on this page.
 * On the draft (`isCreate`) the flag stays, so the record the title creates can take it.
 */
export function useCreationFieldFocus(rootRef: React.RefObject<HTMLElement | null>, isCreate: boolean): void {
  React.useLayoutEffect(() => {
    if (!creationFieldFocusPending()) return;
    const root = rootRef.current;
    if (!root) return;
    const el = findFirstCreationField(root);
    if (!el) return;
    focusFromTitle(root, el);
    if (!isCreate) clearCreationFieldFocus();
  });
  React.useLayoutEffect(() => () => {
    queueMicrotask(() => {
      if (!document.querySelector('[data-workspace-shell]')) clearCreationFieldFocus();
    });
  }, []);
}
