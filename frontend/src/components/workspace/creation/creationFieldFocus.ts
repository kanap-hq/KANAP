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
 * is not on screen: the first field shown is the target. While `waiting`, `undefined` as long as
 * the declared description shows no field this person may change yet (its editor loading, or
 * opening once its lock is held: a page declares it only where the person may change it), or is
 * not on screen yet when the page showed one before the record was written (`expects`: the
 * record's page declares it once its data has loaded): the target is not known yet.
 */
function createdRecordTarget(root: ParentNode, waiting = false, expects = false): HTMLElement | null | undefined {
  let declaredShown = false;
  for (const declared of root.querySelectorAll<HTMLElement>('[data-creation-description]')) {
    if (!reachable(declared) || declared.closest('[hidden], [aria-hidden="true"]')) continue;
    declaredShown = true;
    const field = textFirst(fieldsOf(declared)).find(editable);
    if (field) return field;
  }
  if (waiting && (declaredShown || expects)) return undefined;
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

/** How long the cursor waits for the record's description from the gesture that wrote it. */
const HOLD_MS = 10000;

/**
 * A record being written, from the gesture that writes it (Enter, Tab, Create, the choice of its
 * last required field) until its description takes the cursor. The cursor waits meanwhile in a
 * field of its own (`field`), out of view on the page's body, named as the description: the
 * browser puts in it what the person types, pastes or composes, and nothing reaches the title or
 * the field just given. `origin`: where the gesture left the focus. `acted`: the person pressed
 * into a field of their own (the cursor stays there, what was typed is dropped). `shown`: the
 * record is written and its page shows. `done`: the field is gone, its text given or dropped.
 */
type Hold = {
  field: HTMLTextAreaElement;
  origin: Element | null;
  deadline: number;
  acted: boolean;
  shown: boolean;
  done: boolean;
  composing: boolean;
  // A description that opens its editor once focused (an integrated document), already opened.
  opened: Element | null;
  stop: () => void;
};
let hold: Hold | null = null;

/** Dialogs and menus opened over the page: a focus they take is theirs. */
const OVER_PAGE = '.MuiModal-root, [role="dialog"]';

/**
 * Keeps the cursor where the creation frame put it (`home`: the waiting field, then the
 * description) against the page: a field the page focuses by itself, or a press that reaches no
 * field, gives it back. The person's own moves end it (`onPerson`): a press into a field while
 * the record is written (`held`); once the description has the cursor, any press, Tab, Escape or
 * shortcut.
 */
type Guard = { home: () => HTMLElement | null; held: boolean; reverts: number; onPerson: () => void };
let guard: Guard | null = null;
// The frame is moving the focus itself: the guard lets it.
let placing = 0;
// The press under way (from the pointer's press until its release has run), and where the focus
// was when it began: a field it focuses is the person's choice.
let press: { target: Element | null; from: Element | null; at: number } | null = null;
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (event) => {
    press = { target: event.target instanceof Element ? event.target : null, from: document.activeElement, at: Date.now() };
    if (guard && !guard.held) guard.onPerson();
  }, true);
  const release = () => {
    const ended = press;
    window.setTimeout(() => {
      if (press === ended) press = null;
    }, 0);
  };
  document.addEventListener('pointerup', release, true);
  document.addEventListener('pointercancel', release, true);
}

/** The press under way: a pointer held down past a second focuses nothing more of its own. */
function pressing(): typeof press {
  return press && Date.now() - press.at < 1000 ? press : null;
}

/**
 * The field the press under way puts the cursor in, when it moves it there from elsewhere: the
 * person goes to that field. A choice in a list (a native select, a list's option), the title and
 * the description are not such a move.
 */
function pressedField(): HTMLElement | null {
  const current = pressing();
  const target = current?.target;
  if (!target || target.closest('select, option, [role="listbox"], [data-creation-title], [data-creation-description]')) return null;
  const field = target.closest(ENTRY_FIELDS) ?? target.closest('.MuiInputBase-root, .MuiAutocomplete-root')?.querySelector(ENTRY_FIELDS) ?? null;
  return isCreationField(field) && field !== current?.from ? field : null;
}

function moveFocus(el: HTMLElement): void {
  placing += 1;
  try {
    el.focus({ preventScroll: el === hold?.field });
  } finally {
    placing -= 1;
  }
}

/** Focus nobody chose: nowhere, or the page scroller Layout focuses after a navigation. */
function nowhere(active: Element | null): boolean {
  if (!active || active === document.body || active === document.documentElement) return true;
  return active instanceof HTMLElement && (active.hasAttribute('data-primary-scroll') || active.classList.contains('kanap-app-scroll'));
}

function onGuardFocusIn(event: FocusEvent): void {
  const current = guard;
  const to = event.target instanceof Element ? event.target : null;
  const home = current?.home();
  if (!current || placing || !home || !to || home.contains(to)) return;
  if ((pressing() && isCreationField(to)) || to.closest(OVER_PAGE) || current.reverts >= 20) {
    current.onPerson();
    return;
  }
  // The page focused something by itself (an autofocus, an editor setting its selection), or a
  // press reached no field: the cursor goes back before any key reaches it.
  current.reverts += 1;
  moveFocus(home);
}

function onGuardFocusOut(event: FocusEvent): void {
  const current = guard;
  if (!current || placing || event.relatedTarget || event.target !== current.home()) return;
  // The focus went nowhere (a press on the page's background, a blur): it comes back.
  window.setTimeout(() => {
    const home = guard === current ? current.home() : null;
    if (home && nowhere(document.activeElement)) moveFocus(home);
  }, 0);
}

function onGuardKey(event: KeyboardEvent): void {
  const current = guard;
  if (!current) return;
  const shortcut = event.ctrlKey || event.metaKey || (event.altKey && !event.getModifierState?.('AltGraph'));
  if (!current.held && (event.key === 'Tab' || event.key === 'Escape' || shortcut)) {
    current.onPerson();
    return;
  }
  // A key typed while the focus is nowhere (a field removed under it) goes where it belongs.
  const home = current.home();
  if (home && nowhere(document.activeElement)) moveFocus(home);
}

const GUARD_EVENTS: Array<[string, EventListener]> = [
  ['focusin', onGuardFocusIn as EventListener],
  ['focusout', onGuardFocusOut as EventListener],
  ['keydown', onGuardKey as EventListener],
];

function startGuard(next: Omit<Guard, 'reverts'>): void {
  if (!guard) GUARD_EVENTS.forEach(([type, listener]) => document.addEventListener(type, listener, true));
  guard = { ...next, reverts: 0 };
}

function endGuard(): void {
  if (!guard) return;
  guard = null;
  GUARD_EVENTS.forEach(([type, listener]) => document.removeEventListener(type, listener, true));
}

/** The name of the description the page shows (in its preview or its draft): the waiting field takes it. */
function descriptionName(): string | null {
  const marked = document.querySelector('[data-creation-description]');
  // Its text, not its editor's toolbar.
  const fields = Array.from(marked?.querySelectorAll<HTMLElement>(FIELD_LIKE) ?? []).filter((el) => !el.closest('[role="toolbar"]'));
  const field = fields.find((el) => el.matches('textarea, [contenteditable], [role="textbox"]')) ?? fields[0];
  if (!field) return null;
  const labelledBy = field.getAttribute('aria-labelledby');
  const name = field.getAttribute('aria-label')
    ?? (labelledBy ? document.getElementById(labelledBy)?.textContent : null)
    ?? ((field as HTMLInputElement).labels?.[0]?.textContent ?? null)
    ?? field.getAttribute('placeholder');
  return name?.trim() || null;
}

/** The text field the cursor waits in, out of view on the page's body. */
function waitingField(): HTMLTextAreaElement {
  const field = document.createElement('textarea');
  field.setAttribute('data-creation-hold', '');
  const name = descriptionName();
  if (name) field.setAttribute('aria-label', name);
  field.tabIndex = -1;
  field.spellcheck = false;
  field.setAttribute('autocomplete', 'off');
  Object.assign(field.style, { position: 'fixed', top: '0', left: '-10000px', width: '1px', height: '1px', opacity: '0', pointerEvents: 'none' });
  document.body.appendChild(field);
  return field;
}

/** The waiting field goes: the cursor goes to `returnTo` when it was still there; what it held is dropped. */
function dropHold(current: Hold | null, returnTo: Element | null = null): void {
  if (!current || current.done) return;
  current.done = true;
  if (document.activeElement === current.field && returnTo instanceof HTMLElement && returnTo.isConnected) moveFocus(returnTo);
  if (guard?.held) endGuard();
  current.stop();
}

/** Where the cursor returns when the write is refused: the field it left, the title for Create. */
function returnPlace(origin: Element | null): Element | null {
  if (!origin?.closest('[data-creation-actions]')) return origin;
  const scope = origin.closest('[data-workspace-shell]') ?? document;
  return scope.querySelector('[data-creation-title] input, [data-creation-title] textarea') ?? origin;
}

/**
 * The gesture that writes a record (`useTitleCreation` as the title is given, before the defaults
 * it waits for; `useDraftCreation`): the cursor leaves where it is for the waiting field, until the
 * record's description takes it and what was typed (`armCreatedRecordFocus`, `placeField`). Tab
 * and Shift+Tab move nothing; Enter is a new line, after a first character.
 */
export function noteCreationWrite(): void {
  clearCreationFieldFocus();
  const origin = document.activeElement;
  // A press into another field gave the last one (a passage): the person goes on there.
  if (pressedField()) {
    hold = { field: document.createElement('textarea'), origin, deadline: 0, acted: true, shown: false, done: true, composing: false, opened: null, stop: () => undefined };
    return;
  }
  const field = waitingField();
  const current: Hold = {
    field, origin, deadline: Date.now() + HOLD_MS, acted: false, shown: false, done: false, composing: false, opened: null, stop: () => undefined,
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Tab' || (event.key === 'Enter' && event.repeat)) event.preventDefault();
  };
  const onCompositionStart = () => { current.composing = true; };
  const onCompositionEnd = () => { current.composing = false; };
  field.addEventListener('keydown', onKeyDown);
  field.addEventListener('compositionstart', onCompositionStart);
  field.addEventListener('compositionend', onCompositionEnd);
  // Ten seconds at most: what was typed is dropped, and the cursor goes back to where it was while
  // the record is not written yet.
  const timer = window.setTimeout(() => dropHold(current, current.shown ? null : returnPlace(origin)), HOLD_MS);
  current.stop = () => {
    window.clearTimeout(timer);
    field.removeEventListener('keydown', onKeyDown);
    field.removeEventListener('compositionstart', onCompositionStart);
    field.removeEventListener('compositionend', onCompositionEnd);
    field.remove();
  };
  hold = current;
  startGuard({
    home: () => (current.done ? null : field),
    held: true,
    onPerson: () => {
      current.acted = true;
      dropHold(current);
    },
  });
  moveFocus(field);
}

/** The write is over: refused, or the person left. What was typed is dropped (`armCreatedRecordFocus` took a success). */
export function endCreationWrite(): void {
  const current = hold;
  if (!current || current.shown) return;
  hold = null;
  dropHold(current, current.acted ? null : returnPlace(current.origin));
}

export function clearCreationFieldFocus(): void {
  armed = null;
  const current = hold;
  hold = null;
  dropHold(current);
  endGuard();
}

export function armCreationFieldFocus(): void {
  armed = { kind: 'follow', until: Date.now() + 8000, origin: null };
}

/**
 * The record is written and the person is on it (`useRecordCreation`): its page places the
 * cursor, unless the person took a field of their own while it was written: the cursor then stays
 * there. What was typed meanwhile waits for the field the cursor goes to.
 */
export function armCreatedRecordFocus(): void {
  const current = hold;
  if (!current || current.acted) {
    clearCreationFieldFocus();
    return;
  }
  current.shown = true;
  armed = { kind: 'created', until: Date.now() + 8000, origin: current.origin, expects: !!document.querySelector('[data-creation-description]') };
  // A page that never shows the record lets the cursor go.
  window.setTimeout(() => {
    if (hold === current && armed?.kind === 'created') clearCreationFieldFocus();
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

/** Puts text where the field's caret is, as typing would: React reads the change from the input event. */
function insertInto(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  if (!value) return;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set?.call(input, input.value.slice(0, start) + value + input.value.slice(end));
  input.setSelectionRange(start + value.length, start + value.length);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** How `field` takes the text typed while its record was written; null when it takes none (a list, a number). */
function textInsertion(field: HTMLElement): ((text: string) => void) | null {
  const registered = insertions.get(field);
  if (registered) return registered;
  if (field instanceof HTMLTextAreaElement) return (text) => insertInto(field, text);
  if (field instanceof HTMLInputElement && TEXT_INPUTS.includes(field.getAttribute('type') ?? '') && !field.matches('[role="combobox"]')) {
    return (text) => insertInto(field, text.replace(/\n/g, ''));
  }
  return null;
}

/**
 * The record's page shows `field`, where the cursor goes: once it takes text (an editor started,
 * not one still starting; a text that opens its editor once focused is opened first) and no
 * composition runs in the waiting field, the cursor goes there, and what was typed is put in it
 * at once, in order. `force`: the wait is over, the field gets the cursor whatever it is, and a
 * field that takes no text gets nothing of what was typed. False while it waits.
 */
function giveHeld(current: Hold, field: HTMLElement, force: boolean): boolean {
  if (current.composing && !force) return false;
  const insert = textInsertion(field);
  const text = current.field.value.replace(/^\n+/, '');
  // An editor that says nothing of how it takes text may have the cursor when nothing was typed.
  const editor = field.matches('[contenteditable="true"]');
  if (!insert && field.matches(FREE_TEXT) && !force && !(editor && !text)) {
    if (!editor && current.opened !== field) {
      current.opened = field;
      moveFocus(field);
      moveFocus(current.field);
    }
    return false;
  }
  moveFocus(field);
  if (document.activeElement !== field) {
    if (!force) moveFocus(current.field);
    return false;
  }
  insert?.(text);
  current.done = true;
  current.stop();
  return true;
}

/**
 * Focuses the field `find` names once it is on screen (`undefined`: not known yet). Until the
 * person acts, for a few seconds, the focus follows that field as the record loads: an editor
 * arrives, a default fills a required field a moment after it shows, Layout hands the focus to the
 * page scroller. The focus somewhere else (the page's choice, or a field the person went to) ends
 * it; `origin` is where the gesture that wrote the record left it. A key typed while the focus is
 * nowhere yet chooses nothing: the field it was meant for still gets the cursor.
 * A record just written (`created`) gets in that field what was typed while it was written (the
 * waiting field, `noteCreationWrite`), and keeps the cursor there against the page until the person
 * moves it, up to the end of the wait.
 */
function placeField(
  root: HTMLElement,
  find: (root: HTMLElement, late: boolean) => HTMLElement | null | undefined,
  origin: Element | null = null,
  created = false,
): void {
  const session = created ? hold : null;
  const started = Date.now();
  // The wait: a few seconds, the whole wait of the text typed while the record is written.
  let late = Math.max(started + 3000, session && !session.done ? session.deadline : 0);
  let placed: HTMLElement | null = null;
  let acted = false;
  const atRest = (active: Element | null) => atStart(root, active) || (!!origin && active === origin) || (!!session && active === session.field);
  const act = (event: Event) => {
    if (event.defaultPrevented) return;
    if (event.type === 'keydown') {
      const active = document.activeElement;
      if (atRest(active)) return;
      // Typing in the description just given what was typed meanwhile: the person goes on writing.
      const key = event as KeyboardEvent;
      if (session && active === placed && key.key !== 'Tab' && key.key !== 'Escape' && !key.ctrlKey && !key.metaKey && !key.altKey) return;
    }
    // While the record is written, the guard judges presses.
    if (event.type === 'pointerdown' && session && !session.done) return;
    acted = true;
  };
  document.addEventListener('keydown', act, true);
  document.addEventListener('pointerdown', act, true);
  const stop = () => {
    document.removeEventListener('keydown', act, true);
    document.removeEventListener('pointerdown', act, true);
    if (!session) return;
    if (hold === session) hold = null;
    dropHold(session);
    if (guard && !guard.held) endGuard();
  };
  if (session && !session.done) {
    // Once the description has what was typed, the guard keeps the cursor in it until the person moves.
    startGuard({ home: () => (session.done ? placed : session.field), held: true, onPerson: () => {
      if (session.done) {
        acted = true;
        endGuard();
        return;
      }
      session.acted = true;
      dropHold(session);
    } });
  }
  const attempt = () => {
    const active = document.activeElement;
    const isLate = Date.now() >= late;
    // An editor that opens on focus may take the focus into its text itself: the field found.
    const field = root.isConnected ? find(root, isLate) : null;
    if (acted || session?.acted || !root.isConnected || (active !== placed && active !== field && !atRest(active))) {
      stop();
      return;
    }
    if (field && session && !session.done) {
      if (giveHeld(session, field, isLate)) {
        placed = field;
        if (guard) guard.held = false;
        // The page settles around the description in a moment: the cursor is kept there that long.
        late = Math.max(started + 3000, Date.now() + 1500);
      }
    } else if (field) {
      if (field !== active) moveFocus(field);
      placed = field;
    }
    if (!isLate) window.setTimeout(attempt, 50);
    else stop();
  };
  attempt();
}

/**
 * Focus nobody chose yet: nowhere, the page scroller Layout focuses after a navigation, the title,
 * or Create, which the press that created the record focused.
 */
function atStart(root: ParentNode, active: Element | null): boolean {
  if (nowhere(active)) return true;
  if (active?.closest('[data-creation-actions]')) return true;
  return !!root.querySelector('[data-creation-title]')?.contains(active);
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
      if (kind === 'created') clearCreationFieldFocus();
      return;
    }
    if (kind === 'created') placeField(root, (scope, late) => createdRecordTarget(scope, !late, expects), origin, true);
    else placeField(root, findFirstCreationField);
  });
  React.useLayoutEffect(() => () => {
    queueMicrotask(() => {
      if (!document.querySelector('[data-workspace-shell]')) clearCreationFieldFocus();
    });
  }, []);
}
