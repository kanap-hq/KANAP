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
 * description is still loading (its editor shows no field yet), or not on screen yet when the
 * page showed one before the record was written (`expects`: the record's page declares it once
 * its data has loaded): the target is not known yet.
 */
function createdRecordTarget(root: ParentNode, expects = false): HTMLElement | null | undefined {
  let declaredShown = false;
  for (const declared of root.querySelectorAll<HTMLElement>('[data-creation-description]')) {
    if (!reachable(declared) || declared.closest('[hidden], [aria-hidden="true"]')) continue;
    declaredShown = true;
    const field = textFirst(fieldsOf(declared)).find(editable);
    if (field) return field;
    // A description shown read only has its field, closed: the next field is the target.
    if (!declared.querySelector(FIELD_LIKE)) return undefined;
  }
  if (expects && !declaredShown) return undefined;
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
// `expects`: the page showed a description (`data-creation-description`, in its preview or its
// draft) when the record was written: the record's page waits for it rather than for its first field.
type Armed = { kind: 'follow' | 'created'; until: number; origin: Element | null; expects?: boolean };
let armed: Armed | null = null;

/**
 * A record being written (`noteCreationWrite`), then shown, until its cursor is placed: where the
 * focus was when the write started (`origin`: the title, the field just given, Create), the
 * characters typed meanwhile (`typed`), and whether the person took a field of their own
 * (`acted`): the cursor then stays there and nothing typed is replayed.
 */
type Write = {
  origin: Element | null;
  // The origin, a text field, read only while the write runs: what is typed does not go into it.
  locked: HTMLInputElement | HTMLTextAreaElement | null;
  typed: string;
  acted: boolean;
  // The record is written and shown: the page places its cursor (`armCreatedRecordFocus`).
  shown: boolean;
  // The field the page placed the cursor in, still to be entered (an editor opening on focus).
  placed: Element | null;
  stop: () => void;
};
let write: Write | null = null;

function endWrite(): void {
  write?.stop();
  write = null;
}

/** The write is over: refused, or the person left. What it kept is dropped (`armCreatedRecordFocus` took a success). */
export function endCreationWrite(): void {
  if (!write?.shown) endWrite();
}

export function clearCreationFieldFocus(): void {
  armed = null;
  endWrite();
}

export function armCreationFieldFocus(): void {
  armed = { kind: 'follow', until: Date.now() + 8000, origin: null };
}

/** A shortcut: Ctrl, Cmd or Alt held (AltGr, which types a character, aside). */
function MODIFIERS(event: KeyboardEvent): boolean {
  return event.metaKey || ((event.ctrlKey || event.altKey) && !event.getModifierState?.('AltGraph'));
}

/** The text a key types, or null: one printable character, or Enter (a new line). */
function typedBy(event: KeyboardEvent): string | null {
  if (MODIFIERS(event)) return null;
  if (event.key === 'Enter') return '\n';
  return Array.from(event.key).length === 1 ? event.key : null;
}

/** A field this person may change, the origin locked by the write included. */
function ownField(active: Element | null, current: Write): active is HTMLElement {
  return !!active && (active === current.locked || (active instanceof HTMLElement && editable(active)));
}

/**
 * The creation frame starts writing a record (`useTitleCreation`, `useDraftCreation`): where the
 * focus is now (the title, the field just given, Create) is the gesture's own place, which the
 * cursor leaves for the record created. Until then the characters typed are kept for its
 * description (Enter as a new line, after a first character), and Tab, Shift+Tab and Enter move
 * nothing: the field the write started from takes none of them. This holds while the focus is
 * there or nowhere yet (`atStart`); elsewhere the keys are the person's. The person takes a field
 * of their own by a press, or by typing in another field than that one: the cursor stays there.
 * Shortcuts and the keys of a composition (accents, input methods) are left alone; a composition
 * cannot start in the read-only origin.
 */
export function noteCreationWrite(): void {
  endWrite();
  const origin = document.activeElement;
  const locked = (origin instanceof HTMLInputElement || origin instanceof HTMLTextAreaElement) && !origin.readOnly ? origin : null;
  if (locked) locked.readOnly = true;
  const current: Write = { origin, locked, typed: '', acted: false, shown: false, placed: null, stop: () => undefined };
  const release = () => {
    if (current.locked) current.locked.readOnly = false;
    current.locked = null;
  };
  const takeOver = () => {
    current.acted = true;
    current.typed = '';
    release();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (current.acted || event.defaultPrevented) return;
    const active = document.activeElement;
    if (active !== origin && active !== current.placed && !atStart(document, active)) {
      // The focus is elsewhere, moved there by the person or the page: the keys are theirs, and a
      // character typed in a field makes it theirs.
      const text = typedBy(event);
      if (text !== null && text !== '\n' && ownField(active, current)) takeOver();
      return;
    }
    if (event.isComposing || event.keyCode === 229 || event.key === 'Process' || event.key === 'Dead') return;
    const text = typedBy(event);
    if (event.key === 'Tab' && !MODIFIERS(event)) {
      // Tab and Shift+Tab: the cursor goes to the description all the same.
    } else if (event.key === 'Backspace' && !MODIFIERS(event)) {
      current.typed = Array.from(current.typed).slice(0, -1).join('');
    } else if (text === '\n') {
      if (current.typed && !event.repeat) current.typed += text;
    } else if (text !== null) {
      current.typed += text;
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };
  const onPress = () => {
    if (!current.acted) takeOver();
  };
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('pointerdown', onPress, true);
  document.addEventListener('mousedown', onPress, true);
  current.stop = () => {
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('pointerdown', onPress, true);
    document.removeEventListener('mousedown', onPress, true);
    release();
  };
  write = current;
}

/**
 * The record is written and the person is on it (`useRecordCreation`): its page places the
 * cursor, unless the person took a field of their own while it was written: the cursor then stays
 * there. What was typed meanwhile waits for the field the cursor goes to.
 */
export function armCreatedRecordFocus(): void {
  const done = write;
  if (!done || done.acted) {
    armed = null;
    endWrite();
    return;
  }
  done.shown = true;
  armed = { kind: 'created', until: Date.now() + 8000, origin: done.origin, expects: !!document.querySelector('[data-creation-description]') };
  // A page that never shows the record lets the keys go.
  window.setTimeout(() => {
    if (write === done && armed?.kind === 'created') clearCreationFieldFocus();
  }, 8000);
}

/** A field that takes text: a text area, a text input, or an editor that says how (`registerTypedTextInsertion`). */
const TEXT_INPUTS = ['text', 'search', 'url', 'tel', ''];
const insertions = new WeakMap<Element, (text: string) => void>();

/** A rich text editor tells the creation frame how text typed while its record was written goes into it. */
export function registerTypedTextInsertion(field: Element, insert: (text: string) => void): () => void {
  insertions.set(field, insert);
  return () => {
    if (insertions.get(field) === insert) insertions.delete(field);
  };
}

/** Puts `text` where the field's caret is, as typing would: false when the field takes no text. */
function insertTyped(field: HTMLElement, text: string): boolean {
  const insert = insertions.get(field);
  if (insert) {
    if (text) insert(text);
    return true;
  }
  const isArea = field instanceof HTMLTextAreaElement;
  if (!isArea && !(field instanceof HTMLInputElement && TEXT_INPUTS.includes(field.getAttribute('type') ?? ''))) return false;
  const input = field as HTMLInputElement | HTMLTextAreaElement;
  const value = isArea ? text : text.replace(/\n/g, '');
  if (!value) return true;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  // The prototype's setter: React reads the change from the input event as from typing.
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set?.call(input, input.value.slice(0, start) + value + input.value.slice(end));
  input.setSelectionRange(start + value.length, start + value.length);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

/**
 * The cursor is in `field`, placed by the page of the record just written: what was typed
 * meanwhile goes into it, and the keys are let go. A text that takes nothing yet (an integrated
 * document opening its editor on focus, an editor still starting) waits; any other field drops
 * what was typed.
 */
function enterPlaced(field: HTMLElement): void {
  const current = write;
  if (!current?.shown || document.activeElement !== field) return;
  current.placed = field;
  if (!insertTyped(field, current.typed) && field.matches(FREE_TEXT)) return;
  endWrite();
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
 * it was meant for still gets the cursor. A record just written (`created`) gets what was typed
 * while it was written in that field.
 */
function placeField(
  root: HTMLElement,
  find: (root: HTMLElement, late: boolean) => HTMLElement | null | undefined,
  origin: Element | null = null,
  created = false,
): void {
  const started = Date.now();
  let placed: HTMLElement | null = null;
  let acted = false;
  const atRest = (active: Element | null) => atStart(root, active) || (!!origin && active === origin);
  const act = (event: Event) => {
    // A key the write kept for the record moved nothing.
    if (event.defaultPrevented || (event.type === 'keydown' && atRest(document.activeElement))) return;
    acted = true;
  };
  document.addEventListener('keydown', act, true);
  document.addEventListener('pointerdown', act, true);
  const stop = () => {
    document.removeEventListener('keydown', act, true);
    document.removeEventListener('pointerdown', act, true);
    if (created && write?.shown) endWrite();
  };
  const attempt = () => {
    const active = document.activeElement;
    // The last attempt takes what is on screen: a description still awaited gives way.
    const late = Date.now() - started >= 3000;
    // An editor that opens on focus may take the focus into its text itself: the field found.
    const field = root.isConnected ? find(root, late) : null;
    if (acted || (created && write?.acted) || !root.isConnected || (active !== placed && active !== field && !atRest(active))) {
      stop();
      return;
    }
    if (field) {
      if (field !== active) field.focus();
      placed = field;
      if (created) enterPlaced(field);
    }
    if (!late) window.setTimeout(attempt, 50);
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
    const { kind, until, origin, expects = false } = armed;
    armed = null;
    if (Date.now() >= until) {
      if (kind === 'created') endWrite();
      return;
    }
    if (kind === 'created') placeField(root, (scope, late) => createdRecordTarget(scope, expects && !late), origin, true);
    else placeField(root, findFirstCreationField);
  });
  React.useLayoutEffect(() => () => {
    queueMicrotask(() => {
      if (!document.querySelector('[data-workspace-shell]')) clearCreationFieldFocus();
    });
  }, []);
}
