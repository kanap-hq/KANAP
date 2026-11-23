import React from 'react';
import focusWhenMounted from './focusWhenMounted';

/**
 * What a person types or chooses in. Buttons (a hint, the properties handle, Create or Done and
 * Cancel) are not fields.
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

/** A field a person types or chooses in, within reach (`useDraftCreation` tells a passage to it from a departure). */
export function isCreationField(el: Element | null): el is HTMLElement {
  return el instanceof HTMLElement && el.matches(ENTRY_FIELDS) && reachable(el);
}

function fieldsOf(scope: HTMLElement): HTMLElement[] {
  if (scope.matches(ENTRY_FIELDS)) return reachable(scope) ? [scope] : [];
  return Array.from(scope.querySelectorAll<HTMLElement>(ENTRY_FIELDS)).filter(reachable);
}

/**
 * The fields of a description, its text first: an editor's toolbar (a block style list, hidden
 * until the text has the focus) comes before its text on screen.
 */
function textFirst(fields: HTMLElement[]): HTMLElement[] {
  return [...fields.filter((el) => el.matches(FREE_TEXT)), ...fields.filter((el) => !el.matches(FREE_TEXT))];
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

/** The field a stop is entered by: the first, the text first in a description. */
function entryOf(stop: Stop): HTMLElement | undefined {
  const fields = fieldsOf(stop.el);
  return (stop.kind === 'description' ? textFirst(fields) : fields)[0];
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
  return stop ? entryOf(stop) ?? null : null;
}

/**
 * Puts the cursor in the first field a check marked missing (its label's `data-missing`,
 * `FieldLabel`), in screen order as Tab follows it, once the marks are on screen.
 */
export function focusFirstMissingField(): void {
  focusWhenMounted(() => {
    const label = document.querySelector<HTMLElement>('[data-missing]');
    const row = label?.closest<HTMLElement>(REQUIRED_STOPS) ?? label?.parentElement;
    return row ? fieldsOf(row)[0] : null;
  });
}

/** A field shown but closed to this person: read only, or kept for a value written elsewhere. */
const FIELD_LIKE = 'input:not([type="hidden"]), textarea, select, [contenteditable], [role="textbox"], [role="combobox"]';

/** A field this person may change, on screen: within reach, not hidden, not read only. */
function editable(el: HTMLElement): boolean {
  return isCreationField(el)
    && !el.matches('[readonly], [aria-readonly="true"]')
    && !el.closest('[hidden], [aria-hidden="true"]');
}

/**
 * Where the cursor goes once a record is created (the rule of the creation frame): the
 * description the page declares (`data-creation-description`, only where this person may change
 * it), else the first field this person may change, in reading order (the content, then the
 * properties panel; the title, in the header, comes before both). A description on a tab not shown
 * is not on screen: the first field shown is the target. `undefined` while the declared
 * description is still loading (its editor shows no field yet): the target is not known yet.
 */
function createdRecordTarget(root: ParentNode): HTMLElement | null | undefined {
  for (const declared of root.querySelectorAll<HTMLElement>('[data-creation-description]')) {
    if (!reachable(declared) || declared.closest('[hidden], [aria-hidden="true"]')) continue;
    const field = textFirst(fieldsOf(declared)).find(editable);
    if (field) return field;
    // A description shown read only has its field, closed: the next field is the target.
    if (!declared.querySelector(FIELD_LIKE)) return undefined;
  }
  for (const name of ['main', 'properties'] as const) {
    for (const panel of root.querySelectorAll<HTMLElement>(`[data-creation-panel="${name}"]`)) {
      const field = Array.from(panel.querySelectorAll<HTMLElement>(ENTRY_FIELDS))
        .find((el) => editable(el) && !el.closest('[data-creation-title], [data-creation-actions]'));
      if (field) return field;
    }
  }
  return null;
}

/** The field the cursor goes to on a record just created; null when there is none. */
export function findCreatedRecordField(root: ParentNode): HTMLElement | null {
  return createdRecordTarget(root) ?? null;
}

// What the focus does once the page shows something else (the record just created, a tab the
// page opened). `follow`: Tab in a new record's title handed to the page's own step (an interface
// opens its Flow tab): the first field to fill there. `created`: the creation frame wrote the
// record (`useRecordCreation`): its description, else its first field. Placed once, then cleared,
// or after a few seconds.
type Armed = { kind: 'follow' | 'created'; until: number; origin: Element | null };
let armed: Armed | null = null;
// The record being written (`noteCreationWrite`): where the focus was when its write started, and
// whether the person has used the page since (a press, a key typed in a field).
let write: { origin: Element | null; acted: boolean; stop: () => void } | null = null;

function endWrite(): void {
  write?.stop();
  write = null;
}

/** The write is over, refused or not: what it watched is let go (`armCreatedRecordFocus` took it on success). */
export function endCreationWrite(): void {
  endWrite();
}

export function clearCreationFieldFocus(): void {
  armed = null;
}

export function armCreationFieldFocus(): void {
  armed = { kind: 'follow', until: Date.now() + 8000, origin: null };
}

/**
 * The creation frame starts writing a record (`useTitleCreation`, `useDraftCreation`): where the
 * focus is now (the title, the field just given, Create) is the gesture's own place, which the
 * cursor may leave for the record created. A field the person goes to while the record is written
 * is theirs: the cursor stays there.
 */
export function noteCreationWrite(): void {
  endWrite();
  const current: NonNullable<typeof write> = { origin: document.activeElement, acted: false, stop: () => undefined };
  const act = (event: Event) => {
    // A key typed while the focus is nowhere yet (the title the write closed) chooses nothing.
    if (event.type === 'keydown' && atStart(document, document.activeElement)) return;
    current.acted = true;
  };
  const events = ['keydown', 'pointerdown', 'mousedown'] as const;
  events.forEach((name) => document.addEventListener(name, act, true));
  current.stop = () => events.forEach((name) => document.removeEventListener(name, act, true));
  write = current;
}

/**
 * The record is written and the person is on it (`useRecordCreation`): its page places the
 * cursor, unless the person used the page while it was written (a press, a key typed in a field):
 * the cursor then stays where they put it.
 */
export function armCreatedRecordFocus(): void {
  const done = write;
  endWrite();
  armed = done?.acted ? null : { kind: 'created', until: Date.now() + 8000, origin: done?.origin ?? null };
}

/**
 * Focus nobody chose yet: nowhere, the page scroller Layout focuses after a navigation, the title,
 * or Create, which the press that created the record focused.
 */
function atStart(root: ParentNode, active: Element | null): boolean {
  if (!active || active === document.body || active === document.documentElement) return true;
  if (active instanceof HTMLElement && (active.hasAttribute('data-primary-scroll') || active.classList.contains('kanap-app-scroll'))) return true;
  if (active.closest('[data-creation-actions]')) return true;
  return !!root.querySelector('[data-creation-title]')?.contains(active);
}

/**
 * Focuses the field `find` names once it is on screen (`undefined`: not known yet). Until the
 * person types in a field or clicks, for a few seconds, the focus follows that field as the record
 * loads: an editor arrives, a default fills a required field a moment after it shows, Layout hands
 * the focus to the page scroller. The focus somewhere else (the page's choice, or a field the
 * person went to while the record was written) ends it too; `origin` is where the gesture that
 * wrote the record left it. A key typed while the focus is nowhere yet chooses nothing: the field
 * it was meant for still gets the cursor.
 */
function placeField(root: HTMLElement, find: (root: HTMLElement) => HTMLElement | null | undefined, origin: Element | null = null): void {
  const started = Date.now();
  let placed: HTMLElement | null = null;
  let acted = false;
  const atRest = (active: Element | null) => atStart(root, active) || (!!origin && active === origin);
  const act = (event: Event) => {
    if (event.type === 'keydown' && atRest(document.activeElement)) return;
    acted = true;
  };
  document.addEventListener('keydown', act, true);
  document.addEventListener('pointerdown', act, true);
  const stop = () => {
    document.removeEventListener('keydown', act, true);
    document.removeEventListener('pointerdown', act, true);
  };
  const attempt = () => {
    const active = document.activeElement;
    if (acted || !root.isConnected || (active !== placed && !atRest(active))) {
      stop();
      return;
    }
    const field = find(root);
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
 * Tab in a record being created (new, or created and still showing Done and Cancel) follows
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
    // From the description the browser's own way back reaches Done and Cancel.
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
  const field = next ? entryOf(next) : undefined;
  if (!field && !titleToCommit) return;
  event.preventDefault();
  // A record this Tab gives is written by the creation frame, which places the cursor on it.
  field?.focus();
}

/**
 * Places the focus armed above once the page shows something else: `page` names what it shows (a
 * new record or a record, and its tab), and a page that mounts is new. A record the creation frame
 * has just written gets its cursor here (`armCreatedRecordFocus`), whatever gave it (Enter, Tab,
 * Create, the choice of its last required field); a record opened otherwise gets none. On the page
 * where Tab was pressed, the focus has already moved.
 */
export function useCreationFieldFocus(rootRef: React.RefObject<HTMLElement | null>, page: string): void {
  const shown = React.useRef<string | null>(null);
  React.useLayoutEffect(() => {
    const root = rootRef.current;
    // A page still loading draws no workspace yet: the render that does places the focus.
    if (!root) return;
    const changed = shown.current !== page;
    shown.current = page;
    if (!changed || !armed) return;
    const { kind, until, origin } = armed;
    clearCreationFieldFocus();
    if (Date.now() >= until) return;
    if (kind === 'created') placeField(root, createdRecordTarget, origin);
    else placeField(root, findFirstCreationField);
  });
  React.useLayoutEffect(() => () => {
    queueMicrotask(() => {
      if (!document.querySelector('[data-workspace-shell]')) clearCreationFieldFocus();
    });
  }, []);
}
