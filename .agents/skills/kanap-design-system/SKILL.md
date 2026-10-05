---
name: kanap-design-system
description: >-
  Apply the KANAP "Refined Density" design system to React/Vite front-end work.
  Use whenever creating, modifying, refactoring, or auditing KANAP UI: pages,
  workspace/detail views, forms, drawers, dialogs, tables, AG Grid columns,
  cards, navigation, theme tokens, MUI overrides, styling, dark mode, or
  replacing legacy MUI-heavy layouts. Do not use for backend, API, database, or
  non-UI-only tasks.
---

# KANAP Design System

Use this skill as a mandatory front-end guardrail for KANAP. The source charter is preserved in [references/kanap-design-charter.md](references/kanap-design-charter.md); read it before non-trivial UI work and whenever exact spacing, token, typography, drawer, table, form, or workspace details matter.

## Operating Workflow

1. Identify the UI surface: list page, workspace/detail page, form, drawer, dialog, table, card, navigation, or shared component.
2. Inspect nearby existing implementations before editing. Prefer shared primitives and patterns over new local variants.
3. Load the relevant sections of the full charter for exact values, especially for workspace pages, forms, AG Grid, theme tokens, and dark mode.
4. Implement with `kanap.*` theme tokens and existing shared CSS/components where available.
5. Verify light and dark mode implications, keyboard/focus behavior, sentence case, and typography weights.
6. For audits or reviews, report violations by severity and include concrete file references.

## Non-Negotiable Refactor Lessons

These rules come from previous KANAP refactors and must be enforced during implementation and review:

- Never call `window.confirm`. Use `KanapDialog` for confirmations. For destructive confirmations with dependants, set `saveLabel="Delete anyway"` and make the body explicit: include the exact dependant count and explain the effect.
- Confirm deletions only when the target has dependants. If there are no dependants, delete directly. When a list view needs this decision, include `usage_count` in the list response so the UI does not need a second round-trip.
- Use MUI `Popover`, not `Menu`, for form content anchored to a metadata chip. `Menu` can jump to the top-left after rerenders when its anchor changes. Set explicit `anchorOrigin` and `transformOrigin`.
- For finite option pickers, prefetch options with `useQuery` and render each option directly as a flat `MenuItem`. Never nest an `Autocomplete` inside a `Popover` or create a picker that needs two clicks before choosing.
- Do not add drag and drop unless manual ordering is semantically necessary, such as timelines or priorities. Alphabetical sorting is enough for most KANAP lists.
- Do not place `LinearProgress` over tab content. During tab changes, prefer an empty state while fetching and render content when ready; avoid noisy loading flashes.
- Use sentence case everywhere. Never introduce title case or uppercase UI text.
- Never use teal for table cell text. Row hover is enough to show clickability.
- Use `MetadataUserPicker` for single-user metadata pickers such as assignee, owner, lead, and requestor. Do not use `UserSelect`, MUI `Autocomplete`, or local picker code for these cases.
- `ShareDialog` user/workspace lists show names only. Do not add an email subtitle line.
- Before editing a file, read it in the current session so edits apply against the latest file state. When using session-aware `Read` and `Edit` tools, run `Read` before `Edit`.
- Group independent tool operations as parallel tool calls by default, especially independent reads, searches, and inspections.

## Core Visual Direction

KANAP uses a dense, sober, Linear-grade visual grammar for IT governance users. Content dominates; chrome recedes. Use monochrome neutrals by default. Color must signify state or interaction, not decorate.

Follow these non-negotiables:

- Use teal only for interactive elements: primary buttons, focus rings, active nav indicators, prose/action links.
- Never use teal in table cells, status chips, permanent content text, metadata values, or header/sidebar icons.
- Use orange for attention/urgency and critical scores, never as broad decorative fill.
- Support dark mode for every UI change.
- Use `kanap.*` palette tokens instead of hardcoded colors unless the charter explicitly specifies a fixed value.
- Keep typography to weights `400` and `500`; never introduce `600`, `700`, bold, uppercase, or title case.
- Use sentence case for all labels, headers, menu items, buttons, and section names.

## MUI And Forms

KANAP uses MUI, but only through constrained patterns:

- Do not use `FormControl` with `InputLabel`.
- Do not use `TextField label="..."`.
- Do not use `Select label="..."`.
- Do not use `MuiDrawer` for contained side panels.
- Use label-above-value form rows with `PropertyRow`.
- Every form field is a discreet bordered box drawn by the theme (`MuiInput` override): 1px `kanap.border.default`, 6px radius, ~32px, teal border on focus, `kanap.bg.drawer` when read-only. Write `TextField variant="standard"` / `Select` with no field sx; never draw or remove the border by hand.
- Only inline controls (filter selects, composer-footer selects, click-to-edit titles) use `inlineControlSx`; inputs inside a custom surface use `fieldResetSx`; editable table cells use `tableCellFieldSx` / `tableCellTextFieldSx`.
- Empty editable fields need concrete data-shape placeholders (`e.g., server1`), never instruction copy.
- Use tertiary `Not set` only for display/read-only empty values, not as a generic editable-field placeholder.
- Use shared `sx` constants for repeated drawer/select/date/menu styling; do not paste large repeated inline `sx` objects.
- Required asterisks are orange, not red.

## Workspace Pages

Workspace/detail pages should follow the reference implementation in `frontend/src/pages/tasks/TaskWorkspacePage.tsx` unless the existing shared workspace components have superseded it.

Expected structure:

- Full-width neutral topbar with breadcrumb and sequential navigation chip.
- Full-width title block with mono ID, click-to-edit title, metadata bar, and action pills.
- Main work area with content column, permanent drawer-tab gutter, zero-width tab anchor, and right-side contained properties drawer.
- Drawer state persisted in `localStorage` with `kanap.{pageName}.{setting}` keys.
- Rich text description editor hides toolbar until focus.
- Autosave is the default for every in-place edit on existing workspace entities, including child tab panels, drawer fields, metadata controls, relations, links, and supporting detail sections. Use save-on-change for selects/dates/autocompletes/toggles and short relation changes, blur-to-save or short debounced autosave for one-line text, and debounced autosave for long-form text.
- Title IDs show proper business references (`T-4`, `PRJ-3`, `AST-5`), not raw or truncated technical UUIDs; add/backfill reference fields when needed.
- Metadata bars expose the primary scanning fields as inline editable controls where practical: lifecycle/status, environment, type/classification, assignee/owner, location, and important dates. Keep their menus compact and anchored to the clicked item.
- Clicking a metadata date opens the date picker immediately near the click target/cursor, not an intermediate full-width date field.
- Long-form text areas such as Description, Notes, Purpose, Risks, and Support notes use a defined editor/composer surface (`kanap.bg.composer`, `kanap.border.default`, 8px radius) so text is visually separated from the page background in light and dark mode.
- Keep technical, high-density work blocks in the content column when drawer placement would make comparison or scanning worse; the drawer is for scalar properties, not every field by default.

For dense workspace sections:

- Prefer full-width inline metric bars over stacked cards when metrics are summary context.
- Do not repeat the same metric in multiple sections; show it once where it best supports the workflow.
- Comparable progress/consumption bars must use matching widths and visual weight.
- Keep inline metric sliders/bars long enough to be usable and balanced; prefer about 200px on desktop over tiny 100px controls.
- Use small tertiary source labels for calculated/manual values when provenance matters.
- Keep related tables as separate tables in a grid, with enough gap or a subtle divider so they do not read as one merged table.
- When allocation values are derived from editable base totals, expose the base totals inline near the allocation result; dialogs should edit distribution, not hide the calculation basis.

## Shared Workspace Pickers

Use these shared components instead of local picker variants on workspace pages:

- `frontend/src/components/workspace/MetadataUserPicker.tsx` is the standard single-user picker for metadata bars: assignee, requestor, owner, lead, and similar one-person fields. One click on the current value must open the anchored search popover directly. Lists show names only, never email addresses. Search matches names only. The active user appears first with the "me" suffix, followed by a subtle separator before other users. Empty values use field-specific placeholders such as "Assignee missing", not raw translation keys or generic `Not set`.
- Do not use `UserSelect`, MUI `Autocomplete`, or local menu/popover code for single-user metadata controls. If extra behavior is needed, extend `MetadataUserPicker` first.
- `frontend/src/components/knowledge/KnowledgeLinkPickerDialog.tsx` is the standard "Link existing" document picker for workspace knowledge relations. Prefer using it through `EntityKnowledgePanel`; compact task drawers may use the dialog directly.
- The link picker must query `/knowledge/link-options` with server-side `q`, `page`, and `limit`. Never implement this by fetching only the first `/knowledge` page and filtering locally. Search must work for title/name and business refs such as `DOC-...`.
- Searching in the link picker must keep the modal shell stable: redraw only the document list area, keep the search field focused, and show a thin in-list loading indicator when replacing results. Keep pagination through a compact "Load more" action.

## Tables And Status

For AG Grid and dense lists:

- Row height is compact; headers are sentence case, 11px, weight `500`.
- Use horizontal borders only; no zebra striping.
- Link columns stay neutral at rest and on hover; row hover and cursor communicate clickability.
- Technical IDs use mono font, tabular nums, and secondary/tertiary text color.
- Status in tables/lists is dot plus text, not pill.
- Status color logic must come from `frontend/src/utils/statusColors.ts`, not page-local maps.

For plain HTML tables in workspace sections, use the same dense typography and horizontal dividers. If a table cell contains a true secondary navigation link, keep it neutral at rest and use only a restrained underline/teal hover treatment; never make table links permanently teal.

## Dialog Interactions

- When editing percentage allocations, manual edits may pin rows for redistribution, but the user must still be able to edit pinned values.
- If automatic redistribution happens immediately, do not add a redundant "redistribute remainder" action.
- Provide simple reset actions such as "Split equally" or "Clear manual pins" only when they remove real manual work.

## Knowledge Lists

- Directly linked documents take precedence over related documents.
- If the same document appears as both direct and related, display it only in direct documents.
- If the same related document is found through multiple paths, display it once and merge or summarize provenance instead of duplicating rows.

## Anti-Patterns To Block

Block or refactor these during UI work:

- Colored header bars or decorative teal surfaces.
- Heavy shadows, MUI elevations above subtle card hover treatment, or excessive borders.
- Subtle separator lines between normal content groups unless a documented pattern calls for them; use spacing first. Separators belong in drawer property groups, tables, composer/editor borders, and intentional list/table disambiguation.
- Dropdown-only pages or metadata dropdowns that stretch across the full page; menus should support visible content and stay compact/anchored.
- Pill/chip styling for non-status metadata.
- Permanent rich-text toolbars for description-like editors.
- Explicit save buttons or global "Save changes" actions for in-place editing of existing entities. Keep explicit submit/save only for create forms, dialogs, composers, imports/uploads, and other bounded transactional flows.
- ISO dates in user-facing UI.
- `cursor: help` on tooltip targets.
- Auto-focus at page load.
- Border radius above 12px except true pill chips.
- Animations above 200ms.

## Reference Loading

Read [references/kanap-design-charter.md](references/kanap-design-charter.md) for:

- Exact color palette and token mappings.
- Typography scale and monospace conventions.
- Component dimensions and spacing.
- Workspace page rollout checklist.
- Drawer tab and property group rules.
- AG Grid CSS enforcement details.
- Full implementation checklist.
