# Settings pages

The design of every settings screen: Administration (the organisation), Settings (a module) and My
account (the person). Validated by the maintainer on a mockup on 2026-11-23. Everything not said
here follows the charter as it is (`kanap.*` tokens, weights 400 and 500, sentence case, action
pills, `KanapDialog`, `useNotify`).

The components live in `frontend/src/components/settings/`. A settings screen writes no section
title, width or save timer by hand. A component is born with its first screen and is then reused
as it is: extend the one in the repository, never write a second one for the same use.

## 1. Five forms, one component each

| Form | Used for | Component | Saving |
|---|---|---|---|
| Settings page | Simple fields: text, number, choice, switch | `SettingsPage` > `SettingsSection variant="flat"` > `SettingField` | Automatic, `useSettingsAutosave` |
| List of values | Named values edited in place | A list editor in a collapsible `SettingsSection` (built by the first list screen that moves to this design; today `EnumEditor`) | Automatic, per row |
| External connection | A third-party system: address, credentials, secret | A connection card (built by the first connection screen that moves to this design) | Save button, Test button |
| Operation | A one-off action | `OperationPanel` | Confirmation |
| List and record | Many objects (users, roles, AI models, keys) | The existing standard: `PageHeader`, grid, `KanapDialog` | Dialog |

## 2. The page: `SettingsPage`

- **Width**: 880 px at most, aligned left. A grid of the "list and record" form takes the full width.
- **Header**: the title alone (22 px, 500), no suffix, no subtitle. On its right, in this order: the
  save state, the page's pills, then History last (`history` slot, kept empty until the History
  lot fills it).
- **Tabs** of a module: 13 px text under the title, the current tab in the interaction colour. The
  tab is in the address (`/it/settings/:tab`). A tab the person cannot open is not drawn.
- **No Save or Cancel button on the page.**
- Loading and a failed load: `loading` shows nothing below the title; `error` shows one line
  instead of the page, and no field is offered.

```tsx
<SettingsPage
  title={t('…title')}
  status={autosave.status}          // omit on an operation page
  actions={<Button variant="action">Restore … default</Button>}
  history={undefined}               // History button, last
  readOnly={!canAdmin}              // a reader: same fields, no pill, no save state
  loading={!ready}
  error={loadFailed ? t('…loadError') : undefined}
>
  …
</SettingsPage>
```

`useSettingsReadOnly()` reads the page's read-only state anywhere below it.

## 3. The section: `SettingsSection`

- `variant="flat"` (settings page): title 13 px, 500, primary colour, 24 px of space above it. An
  `InfoHint` beside the title (`hint`) when the section needs an explanation (logo formats, the
  effect of colours). No sentence under the title.
- The default variant is the collapsible section of the lists of values: chevron, title, then on
  the right its own save state. Sections sit under a group label (`SettingsGroup`, 11 px, 500,
  secondary colour).
- An installation section placed on an organisation page carries the word "installation" in grey
  beside its title (see 8).

## 4. The field: `SettingField`

- Label above (12 px, tertiary), field 32 px high, 480 px at most (`PropertyRow`). Two columns
  when the fields go by pairs, one column under 760 px.
- The label carries the unit: "Maximum image size (MB)", "Conversation retention (days)".
- An empty field shows an example of the expected shape ("e.g., smtp.example.com"). When a default
  applies, the empty field shows that default in grey instead ("5", "20"): emptying the field goes
  back to the default. There is no "Back to the inherited value" gesture.
- The label's `InfoHint` (`hint`) says where to find the value for every field that comes from an
  external system ("In your Resend account, API Keys page…").
- A switch sits left of its label, on one line. An unavailable switch is greyed, with an `InfoHint`
  that says why.
- **A secret** is never read back: the field shows dots, greyed, with the link "Replace" on its
  right. "Replace" empties the field and makes it editable.
- The refusal of a value (`error`) shows under the field, in `kanap.danger`. It is tied to the
  control by `aria-describedby`, and the control carries `aria-invalid` while the refusal shows,
  whatever the kind of field:
  - a text field: on its `input` (`inputProps`; a `TextField` with `error` sets `aria-invalid`);
  - a switch or a checkbox: on its `input` (`inputProps`);
  - radio buttons: on the `RadioGroup`; radios spread over the rows of a table have no group
    element, so each radio of the set carries both;
  - a list (`Select`): on the combobox, through `SelectDisplayProps` (`inputProps` would reach the
    hidden native input).
  A plain element given as is (`<input>`, `<select>`) gets both attributes from `SettingField`. A
  component uses the render function and spreads `aria` (both attributes, empty without an error)
  where its focusable control reads them: given as is, it would carry them on its wrapper.
- A table of fields (one row per item, as Budget columns) fixes its column widths (`table-layout:
  fixed`, a `colgroup`): a refusal wraps in its cell, and the columns never move when it appears or
  goes.

```tsx
<SettingField label={t('…method')} hint={t('…methodHelp')} error={error}>
  {({ readOnly, error, aria }) => (
    <Select variant="standard" readOnly={readOnly} error={error} SelectDisplayProps={aria} …>…</Select>
  )}
</SettingField>
```

The render function receives the page's read-only state: the control gets `readOnly`, and the
theme draws it on `kanap.bg.drawer`.

### Automatic saving: `useSettingsAutosave`

- One hook per page, one save state per page. Every field goes through it:
  - `choose(field, save)`: a choice, a switch, a date. Sent at once.
  - `type(field, save)`: a short text. Sent 700 ms after the last key, or at once when the field
    loses the focus (`commit()` in its `onBlur`).
  - `save` is `null` when the page's checks refuse the value: nothing is sent for that field and
    what waited for it is dropped. The refused value stays in the field with its error under it;
    the value before stays stored. A choice refused this way goes back to the stored value at the
    next change of the page (the check is often about another field).
- The state is read in one place: "Saving…" then "Saved" (1.5 s), grey 12 px; "Not saved" in
  `kanap.danger` after a failed save. In the page header for a settings page, in the section
  header for a list of values.
- Every field waiting is sent, whatever the server answers the others.
- **A save the server refuses** (any answer but a busy server): the field shows the stored value
  again at once, text or choice, and the refusal stays under that field until that field changes
  again, whatever else changes meanwhile. The hook keeps it by field: `errorOf(field)`, shown with
  `getApiErrorMessage`. The page's save function puts the stored value back when the failure is
  not transient (`isTransientSaveFailure`), then throws it again.
- **A save a busy server puts off** (409 `retry`, 503 `busy`): the value chosen stays on screen and
  the state says "Saving…" while `useAutosave` retries it (1, 2, 4 s). Once the retries are spent,
  the save stays kept: the state says "Not saved", `error` holds the failure (show it with
  `autosaveErrorMessage`: "not saved yet… sent again with your next change"), the value chosen
  stays on screen, and the save goes again with the next change, when a text field loses the focus,
  or on leaving.
- Leaving the page while a save waits sends it first (`useLeaveGuard`): the menu, the top bar tabs
  and in-app links wait for it. A save refused then keeps the person on the page, without a
  question, the refusal under its field. A save still kept for a busy server asks before leaving
  ("Changes not saved"). A reload or a closed tab warns while a save waits.
- A choice that decides what the page shows (the year of a per-year setting) is off while a save
  of the page is on its way or kept: the refusal and the stored value put back are those of the
  year on screen.
- Each change writes its own audit entry: one per field changed.

## 5. The list of values

- A dense table: headers 11 px, 500; rows separated by a horizontal rule; editable cells 26 px.
- Columns: the name, the list's own columns (category, administrators group, description),
  "Stop offering" (checkbox), then the row actions.
- **Row actions**, in this order: Translate, Delete. Two 26 px icons, grey.
- **Add**: a link "Add an item" under the table. The new row arrives at the bottom, the cursor in
  its name.
- **Deleting** a value that records use opens "Value still in use": "“Colocation” cannot be
  deleted while records use it. Tick “Stop offering”: it stays on existing records and is no
  longer offered." Its button "Stop offering" ticks the box for the person; Cancel closes. A
  free value is deleted without a dialog.
- **Order**: a handle on the left only when order means something (administration zones: from
  level 0 down). Otherwise no handle.
- **Product values** that cannot be changed (lifecycle statuses): a line of text and the word
  "Built-in" in grey, no action.
- **Restore the default lists**: a page header pill, confirmed ("The lists go back to the values
  shipped with Kadratis. Values still used by records are kept."), then a notice at the bottom of
  the page. The operation always succeeds.

### Translations

- The Translate button opens "Translations of “Guest”": the name as a reminder, then one field per
  interface language (English, Français, Deutsch, Español), Cancel and Save.
- An empty field shows what will display in that language: "Shown: Invités". Display rule,
  unchanged: the translation typed, else the shipped translation while the name is the shipped
  one, else the name.
- The icon is darker (primary text colour) when the value has at least one typed translation.
- The help sentence is in the `InfoHint` of the name reminder: "An empty field takes the
  translation shipped with Kadratis when there is one, otherwise the name."
- A list has the button when its storage keeps translations: today the IT landscape lists and the
  classification.

## 6. The external connection

- A card (border, 8 px radius, 16 px padding): the system's name on the left, the status line on
  the right, the fields in two columns, then Test and Save at the bottom left.
- **Status line**: a dot and a sentence. Green "Last test passed on 15 Nov 2026 at 10:42" or "Test
  message sent to your address"; grey "Changes not saved", "Saved, not tested yet", "Never
  tested"; orange "Testing…". A failure says the cause in one sentence, red dot.
- **Test** (neutral pill) tries the values on screen, saved or not. **Save** (primary pill) is off
  while nothing changed.
- Several providers for one service: a choice above the card ("Send through: SMTP server /
  Resend"), one card visible.
- Leaving the page with a changed card asks for confirmation (`useLeaveGuard`).

## 7. The operation: `OperationPanel`

- The options on one line (type, year, column), then a preview in numbers as soon as the choice is
  complete: three numbers (lines, lines with an amount, total value), the first five lines, "and
  40 more lines", and a link to every line when the page has a full grid.
- A consequence sentence when the action cannot be undone: "Clearing removes the Revision amounts
  and period of 2026 for 45 lines. This cannot be undone."
- A danger pill that carries the verb: "Clear column". Off when there is nothing to do.
- The confirmation asks with the verb ("Clear the Revision column of 2026?"), says the effect in
  numbers and what is kept ("The lines and their other columns are kept."), and its button
  repeats the verb.
- The result is written beside the pill: "Column cleared on 45 lines." Its live region
  (`role="status"`) is there before the result, so a screen reader announces it. The state with
  nothing to do fits in one sentence: "The Revision column of 2026 holds no amount."
- The result counts the lines the preview counted ("lines with an amount"). It names a number of
  lines left aside only with a reason the person understands (for a copy, a destination that
  already holds amounts); lines
  passed over because they hold nothing to change are not counted.
- The preview lines are the largest amounts by size, a negative amount included.
- A page whose operation depends on a setting it could not read (the column names, the freeze)
  shows `SettingsPage` `error`: no option, no pill.
- A refusal (a frozen column in `notices`, another operation running in `result`) reads as a
  refusal, never as a silent failure.
- The panel is a frame: the page computes the preview, runs the operation and writes the result.

```tsx
<SettingsPage title={t('…title')}>
  <OperationPanel
    options={<>…ReportFilter fields…</>}
    exportSlot={<ReportExportButton url="…/export" params={…} fileBase="…" />}
    notices={frozen ? <Alert severity="error">…</Alert> : undefined}
    message={!complete ? t('…chooseFirst') : undefined}
    stats={[{ label, value }, …]}
    preview={{ columns, rows /* page order, the panel shows five */, total, allLines: <Link …/> }}
    consequence={t('…warning', { count })}
    secondaryActions={<Button variant="action">Preview</Button>}   // a dry run, when there is one
    action={{ label: t('…verb'), intent: 'danger', disabled, busy, confirm: { title, message }, onRun }}
    result={result}
  />
</SettingsPage>
```

## 8. Installation settings

- **Two states** for an installation field: set here, or set in the file.
- **Set in the file**: the field is greyed with its value, and a grey line with a lock says "Set in
  the configuration file". On a connection card the line is placed once at the top, with an
  `InfoHint` ("These values come from the SMTP variables of the configuration file. To set them
  here, remove these lines from the file and restart Kadratis."); every field is greyed, Save and
  Replace disappear, Test stays.
- **One domain, one page.** An installation setting that has an organisation counterpart is placed
  on the domain's page, next to what it controls: the web search key under the "Web search"
  switch of the Kad page, the caps in a "Limits" section. These blocks carry the word
  "installation" in grey, and only the operator sees them. For everyone else nothing marks them;
  the dependent switch says "Web search is not available on this installation."
- **Menu**: on-premise, an "Installation" section at the bottom of the Administration menu (Email,
  Security, External feeds, Scheduled tasks, Configuration file), visible to the operator only.
  "Artificial intelligence" is not in it. File storage stays in the file and is only read in
  "Configuration file".

## 9. The reader

A person at reader level opens the page read-only: fields greyed (`kanap.bg.drawer`), no action
pill, no add, no delete, no translation, no handle; a secret only says that it is set. A tab
reserved to another right is not drawn. Without any level: no menu entry, and the direct address
leads to the access denied page. Who opens which page is decided in one place per module (for
the budget, `pages/operations/operationAccess.ts`); the right to act stays read in the page.

## 10. The words of the gestures

| Gesture | Word |
|---|---|
| Bring a screen back to its shipped values | Restore … default ("Restore the default visual identity", "Restore the default lists", "Restore the default allocation") |
| Erase data | Clear ("Clear a budget column") |
| Remove a value from the choices without deleting it | Stop offering |
| Change a secret | Replace |
| Try a connection | Test |
| See past changes | History |

"Reset" stays for the password only.

## 11. Screens the mockup does not show

They follow the rules above and are validated on dev in their lot:

- "All settings": a search field and a dense list grouped by scope then by page; no card, no tile.
- "Configuration file": a read list of the active variables, secrets masked.
- The entry page of the budget settings: today's tiles, an "Operations" section.
- The "list and record" forms: they exist; the work aligns them on `KanapDialog`.
