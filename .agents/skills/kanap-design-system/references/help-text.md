# Help text, examples and empty states

KANAP screens are dense work surfaces. Every permanent sentence is read on every visit, by people
who already know it after the first one. This page sets how much a screen may say, and the three
shared levers that let it say less.

## The rule: say it once, where it is needed

The screen says what the person needs to act exactly once. Before adding a word of
interface text, take the first option that works:

1. **Nothing.** The label, the value, the icon or the layout already makes it obvious.
2. **The label or the placeholder carries it.** A precise label (`Renewal date`, not `Date`) and a
   data-shape placeholder (`e.g., server1`) answer most "what goes here" questions.
3. **An icon with a tooltip** (`InfoHint`): one sentence the person reads once, on demand.
4. **Collapsible help** (lever 1 below): several sentences, closed by default.
5. **A visible sentence**, only when the person must have read it before acting: an irreversible
   or costly consequence (deletion, a change that rewrites other records, money sent), or a
   blocking condition they cannot see elsewhere.

A visible sentence is the last resort. When the same information already appears on the screen
(a page subtitle that repeats the menu entry, a field help line that repeats the label, a dialog
paragraph that repeats its title), remove the duplicate.

### What this means in practice

- **Field help lines** (`PropertyRow helperText`, `FormHelperText`): only for a constraint the
  person must know before typing (a format the server enforces, a value that cannot change after
  creation). Anything else goes to the label, the placeholder or an `InfoHint` beside the label.
  Validation messages are not help text: they appear on error and leave once fixed.
- **Page subtitles and section intros**: none by default. A list or report page shows its title
  only (`PageHeader`, `ReportLayout`); a section explains itself through its rows.
- **Dialogs**: the title says the action, the fields carry their labels, the footer says the
  verb. A body paragraph only states a consequence (rule 5). No paragraph that explains what the
  fields are for.
- **Alerts and banners**: only for a state that blocks or changes what the person can do now
  (read-only record, frozen workspace, conflicting edit). Never a permanent tip.
- **Tooltips**: one sentence, plain language, no backend words. No `cursor: help`.
- **Settings and configuration**: a field about an external system keeps its "where to find this
  value" hint (product rule), as an `InfoHint` or collapsible help, not a paragraph.

## Lever 1: collapsible help

For explanations that some people need once and most never: how a calculation works, what a
setting changes, how an import maps columns.

- A small text button with an info or help icon (`How it works`, `About this setting`), closed by
  default, opens a short block in place (`Collapse`, no dialog). The block uses the tertiary text
  colour, 12 to 13 px, and closes with the same control.
- The open or closed state is remembered per person in `localStorage`
  (`kanap.{pageName}.help.{section}`), so someone who closed it does not see it again.
- One collapsible help per section at most. If a screen needs several, the screen is the problem.
- Content: three to five sentences or a short list. Longer content belongs in the user manual,
  reached by the Help button (`frontend/src/utils/docUrls.ts`).

The shared component is built with the first screen that needs it (verbosity chantier, lot 6),
under `frontend/src/components/design/`. Until it exists, do not write a local variant: use
`InfoHint` or nothing.

## Lever 2: the label carries the example

Most help lines exist because the label is vague or the field is empty. Fix the label and the
placeholder first.

- **Label**: the business word, precise, sentence case (`Annual contract value`, `Notice period
  (months)`). Units and formats go in the label in parentheses, not in a help line.
- **Placeholder**: a concrete data shape (`e.g., 10.12.34.56`, `e.g., FY2027`), never an
  instruction (`Enter the IP address`). Generic, non-realistic values only: no real vendor or
  tenant-like names.
- **Inline hint**: when a short qualifier is needed, an `InfoHint` beside the label (one
  sentence in its tooltip) replaces the line under the field.
- **Read-only empty value**: tertiary `Not set`, or a field-specific placeholder in metadata bars
  (`Owner missing`).

## Lever 3: the empty state says the gesture

An empty list, tab or section is the moment a newcomer decides what to do next. It says, in one
line, what goes there and how to add it, and offers the action when the person may take it.

- **Lists** (`ServerDataGrid emptyState`): one sentence and, for people who can create, the create
  button (`contained`, small). Reference: `frontend/src/pages/TasksPage.tsx`. A filtered, searched
  or scoped list that returns nothing keeps "No results match…", which is a different state.
- **Workspace tabs and sections**: about one line (product rule): a tertiary sentence ("No
  documents linked") followed by the add action of the section. No large drop zone, no
  illustration, no paragraph.
- **The sentence names the gesture**, not the absence: "Add the first contract of this
  supplier" says more than "There is nothing here yet". Keep it to one line at 1280 px.
- **People who cannot create** see the sentence only, without the button (the interface shows
  only the actions the person can take).

## Record titles

The record title is typed in the workspace header, in creation as in editing (`EditableTitle`).
A body "Name" field that repeats the title is removed. Details of the creation frame live with the
shared creation components (verbosity chantier, lot 1).

## Review checklist

- Does any new sentence repeat a label, a title or another sentence on the same screen?
- Could a help line become a better label, a placeholder or an `InfoHint`?
- Does a dialog body explain the fields instead of stating a consequence?
- Is there a permanent alert that does not reflect a current state?
- Does every empty list or section say what goes there and offer the action when allowed?
- Is every new string in the four locales (`en`, `fr`, `de`, `es`)?
