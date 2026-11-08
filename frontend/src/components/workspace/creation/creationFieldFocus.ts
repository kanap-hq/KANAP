import React from 'react';

/**
 * What a person types or chooses in. Buttons (a hint, the properties handle, Create and Cancel)
 * are not fields.
 */
const ENTRY_FIELDS = [
  'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="file"]):not([type="image"]):not([disabled]):not([tabindex="-1"]):not([aria-hidden="true"])',
  'textarea:not([disabled]):not([aria-hidden="true"])',
  'select:not([disabled])',
  '[role="combobox"]:not([aria-disabled="true"]):not([tabindex="-1"]):not([disabled])',
  '[contenteditable="true"]',
  // A document shown read-only opens its editor when it takes the focus.
  '[role="textbox"][tabindex]:not([tabindex="-1"]):not([aria-disabled="true"])',
].join(', ');

/** A field the creation needs: a required `PropertyRow`, or a page's own `[data-creation-field]`. */
const REQUIRED_STOPS = '[data-required-field], [data-creation-field]';

/** Free text: a text area or an editor. */
const FREE_TEXT = 'textarea:not([disabled]):not([aria-hidden="true"]), [contenteditable="true"], [role="textbox"][tabindex]:not([tabindex="-1"]):not([aria-disabled="true"])';

/** A preview of a record created at its title is on screen but out of reach until the record exists. */
function reachable(el: Element): boolean {
  return !el.closest('[inert], [data-testid="creation-preview"]');
}

function fieldsOf(scope: HTMLElement): HTMLElement[] {
  if (scope.matches(ENTRY_FIELDS)) return reachable(scope) ? [scope] : [];
  return Array.from(scope.querySelectorAll<HTMLElement>(ENTRY_FIELDS)).filter(reachable);
}

/** The field shows a value: typed text, a choice, or the chips of a list of several values. */
function hasValue(field: HTMLElement): boolean {
  if (field.isContentEditable) return !!field.textContent?.trim();
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) {
    if (field.value.trim()) return true;
    return !!field.closest('.MuiAutocomplete-root')?.querySelector('.MuiChip-root');
  }
  // A MUI select shows its choice in a div and keeps its value in the hidden input beside it.
  const native = field.parentElement?.querySelector<HTMLInputElement>('input.MuiSelect-nativeInput');
  if (native) return !!native.value;
  return !!field.textContent?.replace(/​/g, '').trim();
}

type Stop = { el: HTMLElement; kind: 'title' | 'required' | 'description' };

/** A page's `[data-creation-description]`, else the first free text of the content, then of the panel. */
function descriptionOf(root: ParentNode): HTMLElement | null {
  for (const marked of root.querySelectorAll<HTMLElement>('[data-creation-description]')) {
    if (reachable(marked)) return marked;
  }
  for (const name of ['main', 'properties'] as const) {
    for (const panel of root.querySelectorAll<HTMLElement>(`[data-creation-panel="${name}"]`)) {
      for (const text of panel.querySelectorAll<HTMLElement>(FREE_TEXT)) {
        if (reachable(text) && !text.closest(`${REQUIRED_STOPS}, [data-creation-title]`)) return text;
      }
    }
  }
  return null;
}

/** The title, the fields the creation needs in screen order, and the description last. */
function creationStops(root: ParentNode): Stop[] {
  const stops: Stop[] = [];
  const title = root.querySelector<HTMLElement>('[data-creation-title]');
  if (title) stops.push({ el: title, kind: 'title' });
  for (const el of root.querySelectorAll<HTMLElement>(REQUIRED_STOPS)) {
    // A page's marker inside a required row is the same stop.
    if (reachable(el) && !el.parentElement?.closest(REQUIRED_STOPS) && !el.closest('[data-creation-title]')) {
      stops.push({ el, kind: 'required' });
    }
  }
  const description = descriptionOf(root);
  if (description) stops.push({ el: description, kind: 'description' });
  return stops;
}

/**
 * The stop after `index`: the next required field still empty, then the description. A
 * description marked by its page but not yet on screen (an editor loading) is returned without a field.
 */
function nextStop(stops: Stop[], index: number): Stop | null {
  for (const stop of stops.slice(index + 1)) {
    const fields = fieldsOf(stop.el);
    if (stop.kind === 'required' && (fields.length === 0 || fields.every(hasValue))) continue;
    return stop;
  }
  return null;
}

/** On the way back: every required field, filled or not, then the title. */
function previousStop(stops: Stop[], index: number): Stop | null {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (stops[i].kind !== 'description' && fieldsOf(stops[i].el).length > 0) return stops[i];
  }
  return null;
}

/** The field the creation goes to from its title, null while it is not on screen. */
function findFirstCreationField(root: ParentNode): HTMLElement | null {
  const stops = creationStops(root);
  const stop = nextStop(stops, stops.findIndex((s) => s.kind === 'title'));
  return stop ? fieldsOf(stop.el)[0] ?? null : null;
}

// Armed by a Tab along the creation. When the page shows something else (the record the title
// created, a tab the page opened), it places the focus once. Cleared then, or after a few seconds.
let armedUntil = 0;

export function clearCreationFieldFocus(): void {
  armedUntil = 0;
}

function armCreationFieldFocus(): void {
  armedUntil = Date.now() + 8000;
}

/** Focus nobody chose yet: nowhere, the page scroller Layout focuses after a navigation, or the title. */
function atStart(root: ParentNode, active: Element | null): boolean {
  if (!active || active === document.body || active === document.documentElement) return true;
  if (active instanceof HTMLElement && (active.hasAttribute('data-primary-scroll') || active.classList.contains('kanap-app-scroll'))) return true;
  return !!root.querySelector('[data-creation-title]')?.contains(active);
}

/**
 * Focuses the creation's first field once it is on screen. Until the person types or clicks, for
 * a few seconds, the focus follows that field as the record loads: an editor arrives, a default
 * fills a required field a moment after it shows, Layout hands the focus to the page scroller.
 * The focus somewhere else (the page's choice) ends it too.
 */
function placeFirstField(root: HTMLElement): void {
  const started = Date.now();
  let placed: HTMLElement | null = null;
  let acted = false;
  const act = () => { acted = true; };
  document.addEventListener('keydown', act, true);
  document.addEventListener('pointerdown', act, true);
  const stop = () => {
    document.removeEventListener('keydown', act, true);
    document.removeEventListener('pointerdown', act, true);
  };
  const attempt = () => {
    const active = document.activeElement;
    if (acted || !root.isConnected || (active !== placed && !atStart(root, active))) {
      stop();
      return;
    }
    const field = findFirstCreationField(root);
    if (field && field !== active) {
      field.focus();
      placed = field;
    }
    if (Date.now() - started < 3000) window.setTimeout(attempt, 50);
    else stop();
  };
  attempt();
}

/**
 * Tab in a record being created (new, or created and still showing Create and Cancel) follows
 * the fields to fill: from the title to each required field still empty, in screen order, then
 * to the description (or the first free text). Shift+Tab goes back from a required field through
 * the others and the title. A field of several inputs (first and last name, a date and its time)
 * is crossed first. Elsewhere, and from the description on, Tab is the browser's.
 *
 * `onTitleTab` is the page's own step from the title (an interface opens its Flow tab): the focus
 * follows on the page it opens. An `EditableTitle` commits its name on a Tab handled here.
 */
export function followCreationFields(event: React.KeyboardEvent<HTMLElement>, onTitleTab?: () => void): void {
  if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
  const root = event.currentTarget;
  if (!root.querySelector('[data-creation-actions]')) return;
  const target = event.target as HTMLElement;
  const stops = creationStops(root);
  const index = stops.findIndex((stop) => stop.el.contains(target));
  if (index < 0) return;
  const fields = fieldsOf(stops[index].el);
  const edge = event.shiftKey ? fields[0] : fields[fields.length - 1];
  if (!edge || !edge.contains(target)) return;

  if (event.shiftKey) {
    // From the description the browser's own way back reaches Create and Cancel.
    if (stops[index].kind === 'description') return;
    const previous = previousStop(stops, index);
    const field = previous ? fieldsOf(previous.el).pop() : undefined;
    if (!field) return;
    event.preventDefault();
    field.focus();
    return;
  }

  // A typed title goes on even with nothing on screen yet: the record it creates takes the focus.
  const titleToCommit = stops[index].kind === 'title' && hasValue(target);
  if (titleToCommit && onTitleTab) {
    event.preventDefault();
    armCreationFieldFocus();
    onTitleTab();
    return;
  }
  const next = nextStop(stops, index);
  const field = next ? fieldsOf(next.el)[0] : undefined;
  if (!field && !titleToCommit) return;
  event.preventDefault();
  // A record created meanwhile reopens on its own address: the focus goes on there.
  armCreationFieldFocus();
  field?.focus();
}

/**
 * Places the focus armed by `followCreationFields` once the page shows something else: `page`
 * names what it shows (a new record or a record, and its tab), and a page that mounts is new.
 * On the page where Tab was pressed, the focus has already moved.
 */
export function useCreationFieldFocus(rootRef: React.RefObject<HTMLElement | null>, page: string): void {
  const shown = React.useRef<string | null>(null);
  React.useLayoutEffect(() => {
    const root = rootRef.current;
    // A page still loading draws no workspace yet: the render that does places the focus.
    if (!root) return;
    const changed = shown.current !== page;
    shown.current = page;
    if (!changed || !armedUntil) return;
    const live = Date.now() < armedUntil;
    clearCreationFieldFocus();
    if (live) placeFirstField(root);
  });
  React.useLayoutEffect(() => () => {
    queueMicrotask(() => {
      if (!document.querySelector('[data-workspace-shell]')) clearCreationFieldFocus();
    });
  }, []);
}
