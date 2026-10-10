# KANAP Design System — "Refined Density"

Apply this design charter when building or modifying any UI component in KANAP.

## Philosophy

**Every pixel works.** KANAP targets IT governance professionals (CIOs, IT managers, DSI teams). The visual grammar is Linear-grade: sober, dense, monochrome-dominant. The chrome (nav, header) disappears; the content dominates. Color is used to **signify**, not to decorate. The aesthetic favors information density over generous whitespace, and trusts users to navigate dense layouts without hand-holding. Dark mode is mandatory and must be tested for every component.

### Chromatic grammar

- **Teal = interactive elements only.** Primary buttons, focus rings, active nav indicators, prose links, and action links. Teal NEVER appears on permanent content text, table cell text, or status indicators.
- **Orange = attention.** Strong CTAs, urgent badges, notification counters, critical scores (>=90). Never as background fill. Carried via MUI's `warning` palette slot.
- **Neutrals = everything else.** Navigation, headers, surfaces, text. The frame is invisible.

### Teal usage — exhaustive rules

Teal is allowed in exactly these contexts:

1. **Prose links** — breadcrumbs, "View all", "Choose columns", inline hyperlinks in descriptive text
2. **Active nav tab** — the underline indicator in the top bar
3. **Focus ring** — 2px ring on focused inputs and buttons
4. **Contained buttons** — teal background with `tealForeground` text
5. **Action links** — "+ Log time", "+ Link existing", toggle links in drawers

Teal is NEVER used for:

- **Any table cell text** — not IDs, not names, not assignees, not links. Not at rest, not on hover. Zero teal in table cells. Enforced by `ag-grid-overrides.css` with `color: inherit !important`.
- Navigation item text (active items use `text.primary` weight 500 + subtle background)
- Status chips or badges
- Metadata labels or values
- Icons in the sidebar or header (use `text.secondary`)

---

## Color palette

### Brand colors

| Token | Light | Dark | Usage |
|---|---|---|---|
| `kanap.teal` | `#1A6B7A` | `#4DB8C9` | Primary interactive elements only |
| `kanap.tealForeground` | `#FFFFFF` | `#0F1117` | Text on teal backgrounds |
| `kanap.orange` | `#E8920F` | `#F0A830` | Warnings, urgent indicators, critical scores |
| `kanap.danger` | `#DC2626` | `#F87171` | Destructive actions, errors |

MUI palette mappings (set in `ThemeContext.tsx`):

| MUI token | Maps to |
|---|---|
| `primary.main` | `kanap.teal` |
| `primary.dark` | `#134E5A` (light) / `#2D9AAD` (dark) |
| `primary.light` | `#E6F4F7` (light) / `rgba(77,184,201,0.12)` (dark) |
| `primary.contrastText` | `kanap.tealForeground` |
| `warning.main` | `kanap.orange` |
| `error.main` | `kanap.danger` |

### Backgrounds and surfaces

| Token | Light | Dark | Usage |
|---|---|---|---|
| `kanap.bg.primary` | `#FFFFFF` | `#181A20` | Main page background, card surfaces |
| `kanap.bg.page` | `#FAFAFA` | `#0F1117` | Page-level wrapper background |
| `kanap.bg.drawer` | `#FBFBFC` | `#14161C` | Right drawer / side panel surfaces |
| `kanap.bg.composer` | `#FFFFFF` | `#1F2128` | Editor/composer surfaces |
| `kanap.bg.hover` | `rgba(0,0,0,0.04)` | `rgba(255,255,255,0.06)` | Subtle hover affordance for rows and list items |

### Text

| Token | Light | Dark | Usage |
|---|---|---|---|
| `kanap.text.primary` | `#111827` | `#E5E7EB` | Main content, values in fields |
| `kanap.text.secondary` | `#6B7280` | `#9CA3AF` | Secondary information, action button text |
| `kanap.text.tertiary` | `#9CA3AF` | `#6B7280` | Field labels, metadata, hints, IDs in small contexts |

### Borders

| Token | Light | Dark | Usage |
|---|---|---|---|
| `kanap.border.default` | `#E5E7EB` | `rgba(255,255,255,0.08)` | Standard borders, dividers between sections |
| `kanap.border.soft` | `#F1F2F4` | `rgba(255,255,255,0.05)` | Subtle dividers within groups |

### Status colors

Semantic logic: **grey** = passive/not started, **blue** = active/in progress, **purple** = in testing, **orange** = attention required, **green** = done/validated, **red** = failed/rejected. All status color maps are centralized in `utils/statusColors.ts` — never define per-page color maps.

| Semantic | Status values | MUI key | Dot/text (light) | Dot/text (dark) | Pill bg (light) | Pill bg (dark) |
|---|---|---|---|---|---|---|
| Passive | open, waiting, draft | `default` | `#9CA3AF` | `#9CA3AF` | `#F3F4F6` | `rgba(255,255,255,0.06)` |
| Active | in_progress | `info` | `#3B82F6` | `#60A5FA` | `#EFF6FF` | `rgba(59,130,246,0.12)` |
| Testing | in_testing | `secondary` | `#8B5CF6` | `#A78BFA` | `#F5F3FF` | `rgba(124,58,237,0.12)` |
| Attention | pending, on_hold | `warning` | `#E8920F` | `#F0A830` | `#FFF4E0` | `rgba(240,168,48,0.12)` |
| Done | completed, approved | `success` | `#10B981` | `#34D399` | `#F0FDF4` | `rgba(34,197,94,0.12)` |
| Cancelled | cancelled | `default` | `#9CA3AF` | `#6B7280` | `#F3F4F6` | `rgba(255,255,255,0.06)` |
| Failed | rejected, failed | `error` | `#DC2626` | `#F87171` | `#FEF2F2` | `rgba(239,68,68,0.12)` |

### Score color scale (calculated priority scores 50–100)

| Score range | Light | Dark | Semantic |
|---|---|---|---|
| 50–59 | `#9CA3AF` | `#6B7280` | Low |
| 60–69 | `#6B7280` | `#9CA3AF` | Moderate |
| 70–79 | `#111827` | `#E5E7EB` | Standard |
| 80–89 | `#F0A830` | `#FAC775` | Elevated |
| 90–100 | `#E8920F` | `#F0A830` | Critical |

### UI element tokens

#### Action pills (page-level action bars)

| Token | Light | Dark |
|---|---|---|
| `kanap.pill.bg` | `#F6F7F9` | `rgba(255,255,255,0.04)` |
| `kanap.pill.border` | `#E5E7EB` | `rgba(255,255,255,0.10)` |
| `kanap.pill.hoverBg` | `#EDEEF1` | `rgba(255,255,255,0.07)` |
| `kanap.pillDanger.bg` | `rgba(220,38,38,0.06)` | `rgba(248,113,113,0.08)` |
| `kanap.pillDanger.border` | `rgba(220,38,38,0.20)` | `rgba(248,113,113,0.25)` |

#### Nav chip and properties tab

| Token | Light | Dark | Usage |
|---|---|---|---|
| `kanap.navChip.bg` | `rgba(26,107,122,0.07)` | `rgba(77,184,201,0.10)` | Sequential nav chip |
| `kanap.navChip.border` | `rgba(26,107,122,0.22)` | `rgba(77,184,201,0.28)` | |
| `kanap.navChip.fg` | `#1A6B7A` | `#4DB8C9` | |
| `kanap.tab.bg` | `rgba(26,107,122,0.09)` | `rgba(77,184,201,0.13)` | Drawer tab (closed) |
| `kanap.tab.border` | `rgba(26,107,122,0.35)` | `rgba(77,184,201,0.42)` | |
| `kanap.tab.fg` | `#1A6B7A` | `#4DB8C9` | |
| `kanap.tab.bgActive` | `#1A6B7A` | `#4DB8C9` | Drawer tab (open) |
| `kanap.tab.fgActive` | `#FFFFFF` | `#0F1117` | |

Token definitions live in `frontend/src/pages/tasks/theme/taskDetailTokens.ts`, resolved per light/dark mode via `resolveKanapPalette()` in `ThemeContext.tsx`. When rolling out to other workspaces, import from this file or extract to a shared location.

---

## Typography

### Font families

```ts
fontFamily: {
  sans: "'Inter Variable', Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  mono: "'JetBrains Mono Variable', 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
}
```

### Font weights

Only two weights: **400 (regular)** and **500 (medium)**. Never use 600, 700, or higher — they look heavy against the rest of the UI.

### Type scale

| Element | Size | Weight | Color | Notes |
|---|---|---|---|---|
| Page title | 22px | 500 | primary | line-height 1.3 |
| Section title | 16px | 500 | primary | |
| Section label (e.g. "Description") | 12px | 500 | tertiary | sentence case |
| Body text | 14px | 400 | primary | line-height 1.6, sidebar items |
| Body secondary | 13px | 400 | primary | secondary content, comments |
| Form field label | 12px | 400 | tertiary | line-height 1.3 |
| Form field value | 13px | 400 | primary | line-height 1.4 |
| MenuItem in dropdowns | 13px | 400 | primary | match field value size to avoid zoom effect |
| Metadata bar chips | 12px | 400 | primary | tertiary inline label 11px if present |
| Action pill text | 12px | 500 | secondary | |
| Action pill danger text | 12px | 500 | danger | |
| Nav chip number | 11px | 500 | navChip.fg | mono |
| Technical IDs (T-49, DOC-65) | 11–14px | 400 | tertiary or secondary | always mono |
| Comment author | 13px | 500 | primary | |
| Comment date | 11px | 400 | tertiary | |
| Tab labels | 13px | 400 / 500 | tertiary / primary | inactive / active |
| Sidebar item | 14px | 400 / 500 | secondary / primary | inactive / active |
| Sidebar section label | 11px | 500 | secondary | sentence case |
| Table header | 11px | 500 | secondary | sentence case |
| Table cell | 13px | 400 | primary | |
| Table ID cell | 12px | 400 | secondary | mono, tabular-nums |
| Composer footer controls | 11px | 400 | primary | label tertiary inline |
| Composer submit button | 12px | 500 | tealForeground | bg teal |
| Toggle / link teal | 12px | 400 | teal | |

### Monospace convention

All technical identifiers use JetBrains Mono with these properties:

- **Font**: `'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace`
- **Size**: 11–14px depending on context (12px default — monospace appears larger at equal size)
- **Color**: `kanap.text.secondary` or `kanap.text.tertiary` depending on prominence
- **Numeric alignment**: `font-variant-numeric: tabular-nums`

Applies to: task IDs (`T-48`), project IDs (`PRJ-5`), request IDs (`REQ-12`), interface IDs, asset IDs, connection IDs, location codes, error codes, hash values, version strings — any system-generated reference number.

In AG Grid columns, set via `cellStyle` on the column definition. The `--kanap-text-secondary` CSS variable is defined in `ag-grid-overrides.css` for both light and dark themes.

### Entity references vs technical IDs

Workspace titles and list identity columns must show human/business references, not database identifiers. Use references such as `T-4`, `PRJ-3`, `REQ-12`, `AST-5`, `INT-8`, and `CONN-2`.

- Never show raw UUIDs or truncated UUID fragments as the primary title prefix.
- If an entity type lacks a display reference, add a proper reference field and migration/backfill before rebuilding the workspace UI.
- Keep the reference monospace and secondary/tertiary; keep the entity name/title as the primary visual signal.
- Tooltip/copy affordances may expose the display reference. Technical database IDs belong in developer tooling, API payloads, or diagnostic views only.

### Sentence case rule

ALL text uses sentence case. Never Title Case, never ALL CAPS. This applies to section labels, button text, menu items, table headers, sidebar section labels — everywhere. No exceptions.

---

## Component patterns

### MUI usage rules

KANAP uses MUI components but only with specific patterns. Violations cause visual inconsistency.

**Absolute bans:**

- Do NOT use `FormControl` with `InputLabel`. The MUI label positioning conflicts with the label-above-value pattern and produces visual duplicates.
- Do NOT use `Select` with the `label` prop directly — same issue.
- Do NOT use `<TextField label="...">` in workspace forms. Exception (decision 2026-08-04): in dialogs the `label` prop is acceptable — the theme deliberately restyles it into a static label-above-underline (`MuiInputLabel` override in `ThemeContext.tsx`), and that is the de-facto dialog convention. `PropertyRow` remains preferred for new code; never rely on floating-label behavior.
- Do NOT use `MuiDrawer` for contained side panels. MUI Drawer is designed for full-screen overlays, which is incompatible with KANAP's pattern of containing the drawer to the work area below the page header.

**Always (decision 2026-09-08 — form fields are bordered boxes):**

- Every form field is a discreet bordered box drawn **by the theme** (`MuiInput` override in `ThemeContext.tsx`): 1px `kanap.border.default`, 6px radius, ~32px tall, `kanap.bg.primary` background, `kanap.border.strong` on hover, `kanap.teal` border on focus, `kanap.danger` on error, `kanap.bg.drawer` background when read-only or disabled. Same box in dialogs, properties drawers, content tabs, create forms, and popover forms. Light and dark.
- Write `<TextField variant="standard">`, `<Select>`, `<Autocomplete>` with **no field sx**. `disableUnderline` is no longer needed (the theme hides the underline). Never draw a field border by hand (`'& .MuiInputBase-root': { border: ... }`).
- Wrap each field in a `<PropertyRow label="...">` component that renders the label as a styled `<div>` above the input. Its value slot is capped at 480px so bordered fields never stretch across a wide content tab; pass `valueSx={{ maxWidth: ... }}` to widen or narrow.
- Selects use `drawerSelectSx` (full row width, 13px) in drawers/dialogs and `pageSelectSx` on pages; menu items use `drawerMenuItemSx`.
- Controls that are **not** form fields keep no box: metadata-bar chips, panel filter selects ("Status ▾"), control-bar mode selects, composer-footer selects, click-to-edit titles → `inlineControlSx` (old hover surface). Inputs living inside a custom surface (chat composer, journal composer, picker search boxes) → `fieldResetSx`. Editable table cells → `tableCellFieldSx` (numbers, right-aligned) / `tableCellTextFieldSx` (text): same box, compact ~25px, 4px radius.
- Prefer `InputProps.readOnly` over `disabled` for computed values: the box stays, text stays selectable, no teal on focus.
- Required asterisk: orange `#E8920F` (not red)

### Standard sx constants

Define and reuse these constants instead of inlining sx props on each field. Shared form/drawer primitives live in `frontend/src/theme/formSx.ts` and `frontend/src/components/design`. Import them instead of recreating local copies. If you find yourself copy-pasting an `sx={{ ... }}` object across multiple fields, that's a signal to extract it. None of these constants draws a border: the theme owns the field box.

| Constant | Use it on |
|---|---|
| `drawerFieldValueSx` | Value slot of `PropertyRow` (applied automatically) or a field used outside a row: hides nested MUI labels, 13px typography |
| `drawerSelectSx` / `pageSelectSx` | Form-field `<Select>` in drawers and dialogs / on pages (`pageSelectSx` caps the width at 420px; pair with `MenuProps={compactSelectMenuProps}`) |
| `drawerMenuItemSx` | Every `<MenuItem>` (13px, py 6px) so menus do not zoom relative to the field |
| `drawerDatePickerSx` | Date inputs inside rows (13px) |
| `longFormSurfaceFieldSx` | Description / Notes composer surfaces (8px radius, `kanap.bg.composer`, min height) |
| `inlineControlSx` | Inline controls that are not form fields: filter selects, composer-footer selects, control-bar selects, click-to-edit titles |
| `fieldResetSx` | Inputs inside a custom surface that already draws the border (chat/journal composers, picker search boxes) |
| `tableCellFieldSx` / `tableCellTextFieldSx` | Editable table cells: compact bordered box, numbers right-aligned / text left-aligned |
| `drawerAutocompleteListboxSx` | `ListboxProps.sx` of every `<Autocomplete>` |

Deprecated no-op aliases still exported for older call sites: `dialogBorderedFieldSx`, `editableFieldValueSx`, `nakedFieldPlaceholderSx`. Do not use them in new code.

### AppBar (top navigation)

- Height: **48px**
- Background: `kanap.bg.primary` (white in light, dark in dark) — NOT colored
- Bottom border: 1px `kanap.border.default`
- Tab navigation: **centered** in available space, `kanap.text.secondary` for inactive, `kanap.text.primary` weight 500 for active, teal underline indicator (2px)
- Logo: rendered in its natural colors, not inverted
- Icon buttons: `kanap.text.secondary` color

### Sidebar (left navigation)

- Width: **220px** expanded, **56px** collapsed
- Background: same as `kanap.bg.page` — no contrast with main content
- Item height: **38px**
- Item text: 14px, weight 400
- Item icons: `1.3rem` (~21px)
- Item border-radius: **6px**
- Item horizontal padding: **12px** (1.5 MUI units)
- Active item: background `#F3F4F6` (light) / `rgba(255,255,255,0.06)` (dark), text `kanap.text.primary` weight 500 — no left border accent, no teal background
- Hover: `action.hover`
- **Section labels**: 11px, weight 500, sentence case, color `kanap.text.secondary`, padding-top 18px, padding-bottom 10px, horizontal padding 18px (aligned with item content)
- **Section gap**: 8px of space between end of one section and title of next

### Cards

- Border-radius: **8px**
- Border: 1px `kanap.border.default`
- Shadow at rest: **none** (rely on border)
- Shadow on hover: `0 4px 12px rgba(0,0,0,0.05)` (light) / `0 4px 12px rgba(0,0,0,0.25)` (dark)
- Hover transform: `translateY(-1px)` — subtle
- Padding: **16px**
- Transition: `160ms ease`

### Button variants

Four button variants extend MUI's default Button, defined via `MuiButton.variants` in the theme.

**Page-level action bars** (list page and admin page headers, the actions of a `ChipToggleBar` band
and of the context line under it, workspace title rows, the actions of a `ReportLayout` filter bar:
Run, Dry run, Copy data, Clear column) use only the three compact pills below, all the same size.
The form controls of a filter bar keep their field style. The home dashboard quick actions keep
their outlined look with icons, at the pill height (30px) and radius (5px). Write the variant at each call site; never restyle buttons through a selector on the
header.

**Dialog footers** use the same three pills, all the same size: `action-primary` for the main
action of the dialog (Save, Create, Continue), `action` for Cancel, Close, Back and every other
action, `action-danger` when the main action is destructive (Delete, Replace all, Reject).
`KanapDialog` renders Cancel as `action` and its main action as `action-primary` by default; pass
`saveVariant="action-danger"` for a destructive one, or `saveVariant="action"` when the only button
closes a read-only dialog.

**`variant="action-primary"`**: the one key action of the bar (New X, Add X, or Invite when it is
the only main action). At most one per bar.
- Same dimensions as `action`
- Background and border `kanap.teal` (the tenant's branded primary when set), color `kanap.tealForeground`
- Hover: the darker primary shade, no shadow
- A split button (`ButtonGroup variant="action-primary"`) keeps both halves primary and joined: 5px on the outer corners, square inner corners

**`variant="action"`**: every other action of the bar (Import CSV, Export CSV, Invite (n),
Disable (n), Move (n), Manage X, Edit, a "new" chip in a band, Send link, Convert to request):
- Padding `4px 11px`, 30px tall (12px text on the 1.75 button line-height, plus the 1px border), border-radius 5px, font-size 12px, weight 500
- `textTransform: 'none'`, `minWidth: 0`, one line (`whiteSpace: nowrap`, `flexShrink: 0`)
- Background `kanap.pill.bg`, border `1px solid kanap.pill.border`, color `kanap.text.secondary`
- Hover: `kanap.pill.hoverBg`, no shadow

**`variant="action-danger"`**: a destructive action, only while it has something to act on
(delete the selection once the selection is not empty, delete on a workspace):
- Same dimensions as `action`
- Background `kanap.pillDanger.bg`, border `kanap.pillDanger.border`, color `kanap.danger`
- `DeleteSelectedButton` does this itself: `action` and disabled at 0 selected, `action-danger` from 1, label "Delete (n)"

**Disabled** (all three): the neutral pill, `kanap.pill.bg` / `kanap.pill.border`, text
`kanap.text.tertiary`. No teal, no red.

**Icons on pills**: 14px (`sx={{ fontSize: '14px !important' }}` on the icon). Keep `+` on "new"
actions and the trash on delete; import and export carry no icon.

**`variant="contained"`**: primary CTAs in create forms, composers and empty states (Submit, Save,
"Create your first chart of accounts"):
- Background `kanap.teal`, color `kanap.tealForeground`
- Border-radius: 6px, no shadow (flat)
- Height: 36px (medium), 32px (small)
- `textTransform: 'none'`

`contained` and `outlined` stay in create forms, composers and empty states; they do not appear in
page-level action bars or dialog footers.

**General rules**: no uppercase, no shadow on any variant. The theme's default button radius is 6px.

### Tabs (compact horizontal navigation)

Override MUI's default Tabs:

```ts
MuiTabs: {
  styleOverrides: {
    root: { minHeight: 'auto' },
    indicator: { display: 'none' },
  },
},
MuiTab: {
  styleOverrides: {
    root: ({ theme }) => ({
      minHeight: 'auto',
      padding: 0,
      marginRight: 16,
      textTransform: 'none',
      fontSize: 13,
      fontWeight: 400,
      color: theme.palette.kanap.text.tertiary,
      minWidth: 'auto',
      '&.Mui-selected': {
        color: theme.palette.kanap.text.primary,
        fontWeight: 500,
      },
    }),
  },
},
```

Active tab is distinguished by color and weight: active = `kanap.teal` weight 500, inactive = `kanap.text.tertiary` weight 400 (decision 2026-08-04: teal active tab text is the sanctioned convention for workspace content tabs). No underline indicator. No background highlight.

### Forms — PropertyRow pattern

All form fields use the label-above-value pattern via `PropertyRow`. No MUI `FormControl` or `InputLabel` anywhere.

```tsx
function PropertyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '5px 0' }}>
      <div style={{ fontSize: 12, color: 'kanap.text.tertiary', lineHeight: 1.3 }}>{label}</div>
      <div style={{ fontSize: 13, color: 'kanap.text.primary', lineHeight: 1.4 }}>{children}</div>
    </div>
  );
}
```

Rules:

- All `<Select>` are `variant="standard"` using `drawerSelectSx`; the theme draws the box
- All `<MenuItem>` use `drawerMenuItemSx` (fontSize 13, py 6px, minHeight auto) — prevents zoom effect
- All MUI underlines suppressed via CSS overrides
- Complex components (UserSelect, CompanySelect, DateEUField) keep their internal logic but their MUI labels are hidden via `'& .MuiInputLabel-root': { display: 'none' }`
- Content-tab scalar fields use the same `PropertyRow` treatment as drawer fields: label above, `variant="standard"`, the theme's bordered box. The `PropertyRow` value slot is capped at 480px on content tabs; override with `valueSx` when a field needs another width.
- Read-only values shown as fields keep the box with a `kanap.bg.drawer` background and no teal on focus (`InputProps.readOnly`). Display-only values that are never edited are plain text, not disabled fields.
- Empty editable fields must use concrete data-shape placeholders, not instruction copy. Prefer generic, non-realistic examples such as `e.g., server1` or `e.g., 10.12.34.56`; avoid generic text like "Enter manufacturer..." or "Search items". Never reference real product/vendor names or tenant-like hostnames that could appear as another tenant's data.
- For display/read-only empty values, use the drawer-style tertiary `Not set` pattern. Do not use `Not set` as the placeholder for ordinary editable free-text fields.
- Generous vertical gap between fields: **16–20px**

### Selects, menus, and dropdowns

Dropdowns support an already useful page; they must not be the whole page experience. Avoid "dropdown-only" pages where the main viewport is mostly empty until the user opens menus.

- Metadata-bar dropdowns render as plain inline text/buttons at rest, then open compact menus anchored to the clicked item.
- Drawer dropdowns use the full drawer row width because the drawer is already narrow; page-level dropdowns and metadata dropdowns should size to content or a modest max width, never stretch across the full page.
- Use the same visual treatment for comparable metadata controls. For example, asset type and location in a metadata bar should both look like compact inline metadata buttons and open similarly styled menus.
- `MenuItem` typography must match field values (13px, weight 400) to avoid a zoom effect when a menu opens.
- Do not introduce a full-width popover or modal when a simple anchored menu, autocomplete, or date picker is enough.

**`Menu` vs `Popover` decision rule:**

- Use MUI **`<Menu>`** only for a flat list of selectable options (lifecycle states, type enums, finite picker lists, etc.). The Menu wraps `<MenuItem>` children, full stop.
- Use MUI **`<Popover>`** with explicit `anchorOrigin`/`transformOrigin` for any **anchored form content** (combined country+city editor, provider+region editor, multi-field popovers). Never put a `<TextField>`, `<Select>`, or other form control as a direct child of `<Menu>` — the Menu re-positions to the top-left of the viewport after re-render when the underlying chip remounts, producing the "jumping menu" bug.
- Rule of thumb: if you'd write `<Menu>{... not MenuItems ...}</Menu>`, change it to `<Popover>`.

**Flat `MenuItem` picker preferred over nested `Autocomplete`:**

For finite lists (a few dozen options or fewer — companies, locations, hosting types, providers, environments), prefetch via `useQuery` and render directly as `<MenuItem>` rows inside a `<Menu>` anchored to the chip. One click opens the picker, second click selects. Mirror the Asset workspace's Location chip exactly.

- Never embed a `<CompanySelect>` / `<UserSelect>` / `<Autocomplete>` inside a Popover or Menu when a flat MenuItem list would do — it forces two clicks (open Popover, then open the inner Autocomplete dropdown) and double-feedback on selection.
- Include a leading `— Clear —` MenuItem when the current value is non-null and the field is nullable, instead of a separate clear icon. This rule applies to **Menu-based finite-list pickers only** (decision 2026-08-04); search-popover pickers such as `MetadataUserPicker` keep their dedicated Clear button.
- Reserve `<Autocomplete>` for large catalogs (knowledge documents, users at scale, country search) where typed filtering is necessary.

### Status display — two patterns

**Pattern 1: dot + text (tables and lists)**

Used in AG Grid cells and list items where density matters.

- Colored dot: **6px** circle, inline before text, 6px gap
- Text: status color from palette, 12–13px, weight 500
- No background, no border, no pill shape
- Applies to: workflow statuses, environment states

**Pattern 2: subtle pill (dashboard cards only)**

Used in dashboard cards where a status chip is isolated and needs visual weight.

- Border-radius: **9999px** (full pill)
- Height: **22px**
- Font: 12px, weight 500
- Subtle colored background + colored text (see status colors table for pill bg values)
- No border, no outline

**Pattern 3: filter-toggle pills (decision 2026-08-04)**

Pill-shaped **filter toggles** (e.g. the agents activity filters: Proposal / Decision / Execution) are permitted — they are buttons, and the "an element gets a border only if it is clickable" rule covers them. This does not relax the ban on pills for non-status metadata display.

**What is NOT a status and gets no visual treatment:**

- Task type ("Task", "OPEX") — plain `kanap.text.secondary` text
- Context ("Project") — plain `kanap.text.secondary` text
- Score ("70") — plain `kanap.text.primary` text
- Roles ("IT Lead") — `kanap.text.tertiary` 11px text
- Categories, classifications — plain text

**Rule: an element gets a border only if it is clickable and needs to signal that at rest (buttons) or if it is a form field (the theme's field box). Everything else is text.**

### Data tables (AG Grid)

- Row height: **38px**
- Header: background `kanap.bg.page`, text `kanap.text.secondary`, sentence case 11px weight 500, no column separator lines
- Cell font: Inter 13px
- No alternating row colors — use hover highlight + horizontal border
- Borders: horizontal only, very subtle (`#F5F5F5` light / `rgba(255,255,255,0.04)` dark)
- Row hover: `#F9FAFB` (light) / `rgba(255,255,255,0.03)` (dark)
- Selection background: `primary.light`
- Sticky header: always
- **Link columns**: text is `kanap.text.primary` at rest. No teal on hover — cliquability is conveyed by cursor:pointer + row hover background only. Never put teal on table cell text.
- **ID columns** (T-48, PRJ-5, INT-12): `color: var(--kanap-text-secondary)`, mono font, 12px, `tabular-nums`
- Wrapper border-radius: **8px**

### Dense workspace tables

Use this pattern for plain `<table>` elements inside workspace tabs and detail sections:

- Header: 12px, weight 500, `kanap.text.tertiary`, sentence case
- Cell: 13px, weight 400, `kanap.text.primary`
- Borders: horizontal only, `kanap.border.default` under the header and `kanap.border.soft` between rows
- Row hover: `kanap.bg.hover` or the closest shared hover token
- Right-align numeric columns with a shared `.r` class
- Keep related tables as distinct table elements in a 2-column grid with at least 20px gap; add a subtle vertical divider only when needed to prevent them reading as one continuous table
- If a table cell contains a true secondary navigation link, keep it neutral at rest and use a restrained underline/teal hover treatment only; never make table links permanently teal
- If displayed allocations depend on editable base totals, keep those totals editable inline next to the allocation heading or result. Allocation dialogs should adjust distribution only, not hide the calculation basis.

### Workspace metric strips

Use inline metric strips when a workspace tab needs quick context before detailed sections:

- Prefer one full-width lightweight container over multiple small metric cards
- Align groups with `justify-content: space-between` when there are two primary metrics
- Use inline labels and values with optional 10px tertiary source labels under each group
- Use sliders or stacked bars with matching widths when comparing progress and consumption; avoid visually oversized bars in one section and tiny bars in another
- Inline metric sliders and bars should remain usable and visually balanced; prefer about 200px on desktop over tiny 100px controls, then adapt responsively on narrow screens
- Do not repeat the same story twice. If a calculated metric appears in the overview, avoid duplicating the same breakdown as a second section unless the section adds actionable detail
- Use `kanap.bg.drawer`, `kanap.border.soft`, and 8px radius for subtle surfaces; avoid white cards inside already neutral work areas

### Separators and grouping

Use spacing first. Do not add subtle separator lines between normal content groups unless a documented pattern calls for them.

Allowed separators:

- Drawer property groups (`kanap.border.soft`)
- Table headers and table rows
- Composer/editor borders around long-form text surfaces
- Intentional dividers between adjacent tables/lists that otherwise read as one merged block

Avoid separators inside simple overview fact groups such as location context; grid spacing and label/value typography are enough.

### Editable inline fields (click-to-edit)

Titles and other prominent editable fields use click-to-edit:

- At rest: rendered as a plain `<span>` or `<h1>`, no border, no input affordance, `cursor: text`
- On click: replaced by an `<input>` with the same font properties, focused automatically
- Save on Enter or blur. Cancel on Escape.
- The input must visually match the resting span (same font-size, weight, color). Border appears only on focus, never on hover or at rest.

### Rich text editors (toolbar reveal on focus)

Rich text editors can hide their toolbar at rest and reveal it on focus:

```css
.kanap-mdx-root.kanap-mdx-hide-toolbar .kanap-mdx-toolbar {
  display: none;
}
.kanap-mdx-root.kanap-mdx-hide-toolbar:focus-within .kanap-mdx-toolbar {
  display: flex;
}
```

Use the `MarkdownEditor` `surface` prop, which adds the `kanap-mdx-surface` class, for description-like long-form editors. The surface remains visible at rest; only the toolbar may toggle.

### Long-form text surfaces

Long-form readable/editable text must sit on a defined surface so it is clearly separated from the page background in both light and dark mode.

Use this for Description, Notes, Purpose, Risks, Support notes, PII descriptions, and similar multi-line fields. Description has no exception: the surface is always visible, while the toolbar may stay hidden until focus.

- Background: `kanap.bg.composer`
- Border: `1px solid kanap.border.default`
- Border radius: 8px
- Padding: 14px 16px for plain text fields, or the shared editor padding for rich text
- Body text: 14px, weight 400, line-height 1.6, `kanap.text.primary`
- Focus: teal border/focus ring only; no heavy shadow
- Empty placeholder: `kanap.text.tertiary`

Do not leave long-form Notes/Description content as naked text directly on `kanap.bg.primary` or `kanap.bg.page`. Short scalar values can be plain text; long-form content needs a surface.

### Composer pattern (unified action panel)

When a single panel combines multiple actions (comment + status change + time log):

```
[Editor input area]
[Footer: ctrl-status   ctrl-time-with-slider   submit-button]
```

- Status and time controls have inline labels (label-left-of-value, not label-above-value) for compactness
- Status: inline label (`kanap.text.tertiary` 11px) + inline `<Select>` (`inlineControlSx`, no field box) with colored dot + status text per item. Shows current status as default. No FormControl, no InputLabel.
- Time: inline label + `<Slider>` flex-1 (rail in `sliderTrack` grey, track+thumb in teal, height 4px, thumb 14px) + value in mono
- Slider takes `flex: 1` to fill available space
- Submit: teal contained button, flex-shrink 0. Label changes dynamically based on what's filled in.
- Submit is disabled if and only if all three inputs are empty
- Submit supports `Ctrl+Enter` / `Cmd+Enter` from inside the comment editor. Plain `Enter` remains a line break.
- If the editor hides/reveals its toolbar on focus, the submit button must preserve the first click. Prevent the editor blur/layout shift on submit pointer-down when needed so users do not need to click twice.
- After successful submit, shows transient success label (e.g. "Logged 2h") for ~1500ms, then resets. During success state, `pointer-events: none` to prevent double submits.
- Footer: single line, `border-top 1px solid kanap.border.soft`, padding `10px 16px 12px`

### Allocation dialogs

Percentage allocation dialogs should reduce arithmetic work:

- Editing a percentage pins that row for automatic redistribution purposes, but it remains editable
- Redistribute remaining percentage immediately across unpinned rows, preserving their current relative weights when possible
- Do not add a "redistribute remainder" action when redistribution already happens on edit
- Show invalid totals clearly when pinned rows exceed 100%
- Provide only high-value bulk actions such as "Split equally" and "Clear manual pins"

### Avatars

Use MUI `<Avatar>` with custom sizes. Always include initials, always use `bgcolor: 'kanap.teal'` with `color: 'kanap.tealForeground'`.

| Context | Size | Font size |
|---|---|---|
| Comment thread | 26px | 10px / 500 |
| Metadata bar | 18px | 9px / 500 |
| Drawer inline (Requestor, etc.) | 16px | 8px / 500 |

### Date formatting

Never display ISO date strings in user-facing UI. Use a localized short format:

```ts
function formatShortDate(date: string | Date | null): string {
  if (!date) return 'Not set';
  const d = new Date(date);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}
```

Output: `15 Mar` (same year) or `30 Nov 2025` (different year). The shared implementation lives in `lib/dateFormat.ts` (`formatShortDate` / `formatShortDateTime`) — never define a local copy.

**Date inputs (decision 2026-08-04):** date fields render the formatted display value (`31 Mar 2027`) at rest and switch to numeric `dd/mm/yyyy` only while focused for editing (see `DateEUField`).

### Metadata date interaction

Dates shown in metadata bars should open the date picker immediately when clicked.

- Do not first replace the metadata item with another full-width date field.
- Open the in-page calendar (`components/fields/DateCalendarPopover`) anchored to the clicked item. Never the browser's native picker (`showPicker()`): the page cannot keep it inside the window.
- Keep the formatted metadata value visible and compact at rest.
- Use the drawer date field for slower property editing; use the metadata date for direct quick edits.

### Auto-save and feedback

Autosave is the default for every in-place edit on existing workspace entities. No explicit Save buttons or global "Save changes" actions for editing existing content.

- **Selects, dates, autocompletes**: save on change (onChange handler). No feedback needed — don't block UI on save round-trips.
- **Toggles, relation pickers, linked URLs, child-tab detail panels**: save on change or with a short debounce. Child panels must not bubble ordinary dirty state up into a global workspace save action.
- **Titles**: blur-to-save on the inline editor input (silent, no feedback needed)
- **One-line text fields**: blur-to-save or short debounced autosave. Do not require a manual workspace-level save.
- **Descriptions and other long-form text**: debounced autosave — saves after the last keystroke via a lightweight partial PATCH where possible. Shows a subtle status indicator in the section header when useful: "Saving..." during the API call, "Saved" for ~1.5s after success, then hidden. Ctrl+S may flush pending autosave, but it must not be required for normal persistence.

Create forms, dialogs, composers/comments, imports/uploads, and other bounded transactional flows still use explicit submit buttons — autosave applies to in-place editing of existing entities only.

### Confirmations and destructive actions

Never use the native `window.confirm()`, `alert()`, or `prompt()`. They break the visual continuity of the workspace and ignore tenant branding.

- Use **`KanapDialog`** (`components/design/KanapDialog`) for every confirmation, destructive prompt, or category-switch warning (e.g. on-prem ↔ cloud hosting type bascule). `onSave` carries the destructive action; `onClose` cancels.
- For destructive ops, set `saveLabel="Delete anyway"` / `saveLabel="Continue"` — never just `"OK"`. The label is the user's explicit consent statement, not an acknowledgement.
- The dialog body must explain **what the action affects** and **what will survive**. For example: *"3 assets are currently assigned to Rack 5. Deleting this sub-location will leave them without a sub-location assignment. The asset records themselves are kept; only their sub-location link is cleared."*

**Confirmation only when there are dependents:**

- If a delete has no impact on related records (count of dependents = 0), execute it immediately — no dialog, no friction.
- If a delete has dependents (count > 0), open the `KanapDialog` and show the precise count with correct singular/plural grammar.
- Always include the dependent count in the list endpoint response (`usage_count`, `assignments_count`, etc.) so the frontend can branch synchronously without a second round-trip.

### Loading states across tab transitions

A flash of `LinearProgress` on every tab switch reads as screen flicker, not as feedback.

- Workspace tabs and tab-content components must **not** render `<LinearProgress />` on their initial mount/fetch. Show an empty layout during the brief fetch, then the content when ready.
- The exception is the **initial workspace load** (the parent shell): a single thin progress bar is acceptable until the root entity is first fetched, then never re-shown for subsequent in-tab fetches.
- For inline saves, prefer a small "Saving…" / "Saved" text indicator in the relevant section header (debounced surfaces), not a full-width progress bar.

### List ordering and drag-and-drop

Only add drag-to-reorder when the items have an inherent manual order that alphabetical sort cannot express (project timelines, kanban columns, prioritized rules). For ordinary reference lists — sub-locations, contact roles, tags, options — use **alphabetical sort** server-side and on every mutation. Drag-and-drop adds plumbing (display_order column, reorder endpoint, optimistic UI rollback, drag handles) that costs more than the UX gain when the natural order is alphabetical.

---

## List pages

Reference implementations: `frontend/src/pages/CompaniesPage.tsx` (plain list),
`frontend/src/pages/coa/CoaPage.tsx` (list split by collections).

### Plain list page

```
PageHeader: breadcrumb, title ........................ [action bar]
Grid toolbar: [quick filter] Show: o All o Enabled o Disabled  [extra filters]
Choose columns   Reset columns
Grid
```

The action bar follows "Button variants": one `action-primary` (New X), `action` for the rest,
`DeleteSelectedButton` for the selection.

### List split by collections (toggle band)

When the grid shows the items of one collection picked among several (charts of accounts,
analytics dimensions, knowledge libraries), the actions follow what they act on:

```
PageHeader: breadcrumb, title (no actions)
ChipToggleBar: [collection] [collection] [collection] ........ [+ New] [Manage X]
ChipToggleContextLine: <collection name> · <n> items ......... [New item] [Import] [Export] [Delete (n)]
                       optional secondary line (scope, access, description)
Grid toolbar, column chooser, grid
```

- The band (`frontend/src/components/ChipToggleBar.tsx`) holds the collection toggles and the
  actions on collections (create, manage, edit). Never put item actions on the band.
- The context line (`ChipToggleContextLine`, same file) names the selected collection with the
  grid total (title 14px weight 500) and carries the actions on the items, aligned with its title row.
  The count follows the grid (current scope and folder); never add a backend call only for it.
- Item actions never sit above the band: the user picks the collection first, then acts in it.
- When the band is the page's own header and the top nav tab already names the page (knowledge
  base), the page has no `PageHeader`.

### Breadcrumbs on list pages

`PageHeader` hides a breadcrumb that holds a single crumb: it links nowhere and repeats the top
nav tab or the title. Multi-level breadcrumbs (`Master data / Charts of accounts`) stay.

## Workspace pages (detail / edit)

Workspace pages are full-height detail views for a single entity (task, project, request, contract, etc.). They follow a strict layout. Reference implementation: `TaskWorkspacePage.tsx`.

### Layout structure

```
WorkspacePage (full height, flex column)
+-- Topbar (full width, border-bottom)
|   +-- Breadcrumb + NavChip
+-- TitleBlock (full width)
|   +-- TitleRow: [ID mono] [click-to-edit title] ... [action pills] [x]
|   +-- MetadataBar: [Status] [Score] [Priority] [Avatar Assignee] [Due date] [Project]
+-- WorkArea (flex row)
    +-- ContentColumn (flex: 1, pr: 29px gutter)
    |   +-- Description (rich text, toolbar hidden until focus)
    |   +-- Attachments
    |   +-- Activity (tabs: Comments / History / Time Log)
    +-- TabAnchor (width: 0, relative) -> classeur tab (absolute, 26x120px)
    +-- PropertiesDrawer (280px, conditional)
```

### Topbar

- Padding: `11px 20px`
- Border-bottom: `1px solid kanap.border.default`
- Content: back link (12px, `kanap.text.secondary`) + breadcrumb segments + NavChip
- NavChip: teal-tinted pill with sequential position, monospace 11px, border-radius 5px
- NavChip arrow buttons should keep the chip visually compact but expose a forgiving hit target, at least 24x24px. Use centered small chevrons and subtle hover fill rather than making the chip visually heavier.
- No shadow, no background color

### Title block

- Padding: `26px 32px 22px`
- **Title row**: flex, items flex-start, gap 24px, margin-bottom 18px
  - **ID prefix** (`T-49`): monospace 14px, `kanap.text.secondary`, vertical-align 1px, mr 14px, click-to-copy. Always a business display reference (`T-4`, `PRJ-3`, `AST-5`), never a raw or truncated UUID. Add/backfill a reference field if one does not exist yet.
  - **Title**: 22px weight 500, click-to-edit pattern (span -> input on click, save on blur, cancel on Escape)
  - **Actions**: pill buttons on the right, gap 8px, mt 7px. Use `variant="action"` and `variant="action-danger"` (`action-primary` for a single key action). Close button at the end.
- **Metadata bar**: flex, gap 22px, flex-wrap, font-size 12px
  - Status chip: colored dot (8px) + label, click -> Menu with all statuses
  - Score chip: colored dot + monospace value, read-only with Tooltip
  - Priority chip: `kanap.text.tertiary` label + value, click -> Menu
  - Assignee chip: Avatar (18px) + name, click -> anchored search popover via the shared `MetadataUserPicker` (not `UserSelect` or a local menu). See "Shared workspace pickers" below.
  - Due date chip: `kanap.text.tertiary` label + formatted date, click -> Popover with DatePicker
  - Project chip (conditional): `kanap.text.tertiary` label + project name (max 220px, ellipsis), click -> navigate

- Use metadata bars for the fields users scan and adjust while navigating records: lifecycle/status, environment, type/classification, assignee/owner, location, and important dates. If a field is important enough to summarize in metadata, make it editable there when permissions allow.
- Comparable metadata controls should use comparable styling. Do not make one control look like a metadata menu and another like a drawer form field.
- Metadata menus/popovers should be compact and anchored to the clicked metadata item. Avoid full-width menus across the page.
- Metadata values remain neutral at rest. Use teal only for hover/focus/active interaction, not permanent value text.

### Content column

- Flex: 1, min-width: 0, overflow: auto
- Padding: `8px 0 24px 24px`, **right padding: 29px** (permanent gutter for the classeur tab)
- **Description section**: label 12px weight 500, rich text editor with toolbar hidden until focus
- **Notes and other long-form text**: same defined editor/composer surface as Description; never naked text floating directly on the page background
- **Activity section**: no section label — tabs serve as section title
- **Activity composer**: card with `border 1px solid kanap.border.default`, border-radius 8px. See Composer pattern above.

### Properties drawer

Right-side panel toggled by a classeur tab.

**Classeur tab (always visible):**
- Sits in a zero-width anchor (`width: 0, position: relative`) between content and drawer
- Tab: `position: absolute, right: 0, top: 20px`, width 26px, height 120px
- Border-radius: `8px 0 0 8px`, border-right: none (fuses with drawer border when open)
- z-index: 2 (overlaps drawer border-left)
- Colors: teal-tinted bg when closed (`kanap.tab.bg`), solid teal bg when open (`kanap.tab.bgActive`)
- Label: vertical text "Properties" with chevron (closed) / (open)
- If the classeur tab is vertically offset to align with the metadata bar, the open drawer panel must use the same offset and compensate its height so tab and panel remain visually fused.
- The 29px content gutter ensures no visual overlap between tab and content text

**Drawer panel (conditional, 280px):**
- No header (the classeur tab serves as label)
- Border-left: `1px solid kanap.border.default`, bg: `kanap.bg.drawer`
- State persisted in localStorage (`kanap.{pageName}.drawerOpen`)

**Drawer content — property groups:**

Groups separated by soft dividers (`1px solid kanap.border.soft`). No section titles, no accordions, no collapse/expand. Groups are visually distinguished by dividers only.

```css
.kanap-prop-group {
  padding: 6px 18px 8px;
}
.kanap-prop-group + .kanap-prop-group {
  border-top: 1px solid var(--kanap-border-soft);
  margin-top: 6px;
  padding-top: 10px;
}
```

All fields inside groups use the PropertyRow pattern. All Selects use `drawerSelectSx`, all MenuItems use `drawerMenuItemSx`.

**Drawer placement boundary:**

- Put scalar, low-density properties in the drawer: lifecycle, environment, ownership, classifications, dates, toggles, and simple one-line values.
- Keep high-density technical blocks in the content column when users need comparison, scanning, or inline context. Examples include IP address/subnet/VLAN rows, mapping matrices, endpoint tables, assignment tables, and hardware/support detail groups.
- Do not move a field to the drawer just because it is editable. If drawer placement makes the workflow cramped or hides related context, keep it in the tab content and style it with the same form rules.
- Duplicating a value between metadata and drawer is acceptable when metadata supports fast navigation/editing and the drawer supports slower property review.

**Sanctioned shell exception — knowledge workspace (decision 2026-08-04):** the knowledge workspace keeps its library-style architecture (left folder tree + right tabbed Properties/Comments panel) instead of the standard workspace shell; folder navigation is core to the domain. Charter rules still apply to the panel *content* (field patterns, dots, tabs, surfaces).

**Knowledge section (example of a list-in-drawer pattern):**
- One line per document: ID mono 11px `kanap.text.tertiary` + title 13px `kanap.text.primary` (ellipsis overflow)
- Hover reveals action icons (open, unlink — turns `kanap.danger` on hover)
- Empty state: "No documents linked" in `kanap.text.tertiary`
- Action links below list: teal 12px, `whiteSpace: nowrap`
- Direct documents take precedence over related documents. If the same document appears in both groups, display it only as direct.
- Related documents must be deduplicated across provenance paths. Display each document once and merge or summarize the sources that linked it.

### Shared workspace pickers

Workspace pages must reuse these shared components instead of one-off picker variants. Extend the shared component first if extra behavior is needed.

**`MetadataUserPicker`** (`frontend/src/components/workspace/MetadataUserPicker.tsx`) — the standard single-user picker for metadata bars: assignee, requestor, owner, lead, and any one-person field.

- One click on the current value opens an anchored search popover directly. No intermediate menu, no full-width modal.
- The active user appears first with a "me" suffix, followed by a subtle separator before the rest of the users.
- Empty values use field-specific placeholders such as "Assignee missing", "Requestor missing", "Owner missing" — not raw translation keys, not generic `Not set`.
- Do not use `UserSelect`, MUI `Autocomplete`, or local menu/popover code for single-user metadata controls. If extra behavior is needed, extend `MetadataUserPicker` first.

**User display in any picker (MetadataUserPicker, ShareDialog recipients, comment mentions, share/notify lists, etc.):**

- Lists show **names only** — never email addresses as a subline, never `name (email)` parentheticals.
- Search matches **names only** (concatenated `first_name + last_name`), not email substrings.
- Selected chips/tags show the formatted name. The internal record continues to carry the email for backend lookups; only the display drops it.
- If a user genuinely has no `first_name` and no `last_name`, fall back to email — but that's a degraded case, not the default rendering.

**`KnowledgeLinkPickerDialog`** (`frontend/src/components/knowledge/KnowledgeLinkPickerDialog.tsx`) — the standard "Link existing" document picker for workspace knowledge relations.

- Prefer using it through `EntityKnowledgePanel`. Compact task drawers may use the dialog directly.
- Must query `/knowledge/link-options` with server-side `q`, `page`, and `limit`. Never implement search by fetching only the first `/knowledge` page and filtering locally — it silently breaks past the first 20 docs.
- Search must work for title/name AND business refs such as `DOC-...`.
- Modal shell must stay stable while typing: redraw only the document list area, keep the search field focused, and show a thin in-list loading indicator when replacing results.
- Pagination is a compact "Load more" action at the bottom of the list — not infinite scroll, not numbered pages.

### Keyboard shortcuts (workspace-level)

| Key | Action | Condition |
|---|---|---|
| `J` or left arrow | Previous item | Not in input/textarea |
| `K` or right arrow | Next item | Not in input/textarea |
| `Escape` | Close workspace (back to list) | Not in input/textarea |
| `P` or `.` | Toggle properties drawer | Not in input/textarea |
| `Ctrl+S` | Save all dirty fields | Always |
| `Ctrl+Enter` / `Cmd+Enter` | Submit focused comment composer | Composer has content/action and focus is inside editor |

### Rollout checklist for new workspaces

When converting an existing page to this pattern:

1. Create a `{Entity}DetailHeader` component (topbar + title + metadata bar)
2. Create a `{Entity}MetadataBar` with entity-specific chips
3. Create a `{Entity}PropertiesDrawer` using PropertyRow pattern (no FormControl/InputLabel)
4. Replace any left sidebar with right-side drawer + classeur tab
5. Add toolbar-reveal-on-focus to all rich text editors
6. Ensure the title prefix uses a proper display reference, not a raw UUID; add/backfill one if missing
7. Make primary metadata fields editable inline with compact anchored menus/date pickers
8. Give Description/Notes/Purpose/Risks-style text a defined editor/composer surface
9. Decide drawer vs content placement by workflow density, not by whether a field is editable
10. Replace ToggleButtonGroup with compact Tabs (13px, no indicator)
11. Add keyboard shortcuts (J/K/arrows/Escape/P)
12. Wire title blur-to-save
13. Add `kanap` palette tokens if not already present (they're shared)
14. Test light + dark mode, mobile responsive, auto-save on all fields

---

## Spacing system

### Page sections

| Context | Value |
|---|---|
| Page topbar | `padding: 11px 20px` |
| Title block | `padding: 26px 32px 22px` |
| Content section | `padding: 24px 32px 0` |
| Content section (last) | `padding: 24px 32px 32px` |
| Drawer body | `padding: 10px 0 14px` |
| Property group | `padding: 6px 18px 8px` |
| Property row | `padding: 5px 0` |
| Composer input | `padding: 14px 16px 18px`, min-height 100px |
| Composer footer | `padding: 10px 16px 12px` |

### Gaps and margins

| Element | Value |
|---|---|
| Title row to metadata bar | `margin-bottom: 18px` |
| Metadata bar items | `gap: 22px` |
| Activity head to composer | `margin-bottom: 14px` |
| Composer to comments | `margin-bottom: 22px` |
| Comments | `gap: 22px` |
| Action pills | `gap: 8px` |
| Breadcrumb crumbs | `gap: 9px` |
| Composer footer controls | `gap: 18px` |

### General scale (MUI units, 1 = 8px)

| Units | Pixels | Usage |
|---|---|---|
| 0.5 | 4px | Micro gaps within tight lists |
| 1 | 8px | Element gaps |
| 1.5 | 12px | Related element groups |
| 2 | 16px | Section padding, card padding |
| 2.5 | 20px | Field gap in dense layouts |
| 3 | 24px | Major section gaps |
| 4 | 32px | Page-level spacing |

---

## Border radius

| Element | Radius |
|---|---|
| Composer container, cards | 8px |
| Action pills (`action-primary`, `action`, `action-danger`), nav chip, MenuItems | 5px |
| Submit button, dialog and form CTAs, default button radius | 6px |
| Sidebar items | 6px |
| AG Grid wrapper | 8px |
| Avatars | 50% |
| Pill chips (status in dashboard) | 9999px |
| Slider track | 2px |
| Drawer tab | `8px 0 0 8px` (rounded left side only) |

Max border-radius is 12px except pill chips (9999px).

---

## Layout rules

- Page topbar and title block are full width
- Drawer is contained to the work area below the title block, never extends above
- When drawer is closed: 29px right padding on content (26px tab + 3px gap)
- When drawer is open: content + tab anchor + drawer panel sit side by side via flex
- Reverse-chronological sorting for activity feeds (most recent at top, just under composer)
- Sequential navigation arrows live grouped with the breadcrumb (left), not in the actions area (right)

---

## Interaction patterns

### Persistent UI state

Drawer open/closed, description collapse/expand, and similar UI states persist in localStorage. Use `kanap.{pageName}.{setting}` key format.

### Hover-revealed actions

Actions on list items (unlink button, edit button) are hidden by default and revealed on hover via `opacity: 0 -> 1` transition. Always accessible via `aria-label` regardless of hover state.

### Auto-save with optimistic updates

Most form fields save on every change, optimistically update the UI, and show a toast on backend errors. Don't block UI on save round-trips.

---

## CSS architecture — how the rules are enforced

### Global link coloring (`ThemeContext.tsx` -> MuiCssBaseline)

- `.MuiLink-root` gets `color: primary.main` — colors standalone MUI Link components (prose links)
- `.MuiBreadcrumbs-root a` gets `color: primary.main` — breadcrumb links
- No blanket `a { color: teal }` — this was the source of teal leaking everywhere

### AG Grid cell protection (`ag-grid-overrides.css`)

- `.ag-theme-quartz .ag-cell a` and `.ag-theme-quartz-dark .ag-cell a` get `color: inherit !important`
- Overrides any MUI Link styling inside grid cells
- Covers `.MuiLink-root` inside cells, `:visited`, `:hover`
- `cursor: pointer` set on `.ag-row` for all rows

### Custom CSS variables in AG Grid

- `--kanap-text-secondary`: `#6B7280` (light) / `rgba(255,255,255,0.55)` (dark) — used by ID column cellStyles

### Navigation link neutralization (`ThemeContext.tsx`)

- `MuiListItemButton` and `MuiTab` have `color: 'inherit'` in theme overrides
- Prevents global MuiLink styling from coloring nav items

---

## Anti-patterns — NEVER do these

1. **No colored header bars.** The AppBar is always neutral. Never a solid teal/blue banner.
2. **No heavy shadows.** Max = subtle border + light hover shadow. No MUI elevation > 2.
3. **No borders everywhere.** Use spacing to separate. Borders only on cards, explicit dividers, and composer panels.
4. **No fluorescent status colors.** Dot+text in tables, subtle pill in cards only.
5. **No uppercase text.** Sentence case everywhere, no exceptions.
6. **No border-radius > 12px** except pill chips (9999px).
7. **No animations > 200ms.**
8. **No blue-grey backgrounds** in light mode. Use pure neutral greys.
9. **Zero teal in table cells.** No cell text uses teal/primary. Enforced by `ag-grid-overrides.css`.
10. **No left-border accents** on active nav items. Use subtle background fill.
11. **No pill/chip for non-status metadata.** Task type, context, score, roles = plain text.
12. **No custom input components replacing MUI TextField.** Use theme overrides for styling.
13. **No `FormControl` + `InputLabel`** on form fields. Use PropertyRow exclusively.
14. **No `cursor: help`** on tooltipped elements. Let the tooltip work without visual cue.
15. **No save buttons for in-place editing.** All existing-entity workspace fields auto-save by default, including drawer fields, metadata controls, relations, linked URLs, and child-tab detail panels. Selects/dates/autocompletes/toggles save on change; titles save on blur; short text saves on blur or short debounce; long-form text saves on debounce. Ctrl+S may flush pending autosave, but it must not be required. Create forms, dialogs, composers, imports, and uploads still have explicit submit buttons.
16. **No permanent toolbars** on rich text editors. Hide them, reveal on focus.
17. **No auto-focus on form inputs at page load.** Let users orient themselves first.
18. **No font weights other than 400 and 500.** No 600, 700, or bold.
19. **No more than 2 color ramps** in a single component (gray + one accent max).
20. **No `MuiDrawer`** for contained side panels. Build a custom flex layout.
21. **No inlined sx props** that should be shared constants.
22. **No ISO date strings** in user-facing display. Always format.
23. **No section headers in bold with collapse chevrons** inside drawers. Use plain dividers.
24. **No duplicating action labels** (e.g. label "Status" both above and inside a dropdown).
25. **No duplicate metric storytelling.** If two sections communicate the same value or progression, consolidate them.
26. **No raw or truncated UUIDs** as title/list references. Use business references such as `AST-5`.
27. **No dropdown-only workspace pages** and no full-page-width metadata dropdowns. Menus must be compact and anchored.
28. **No naked long-form text areas** on page backgrounds. Notes/Description-like content needs a composer/editor surface.
29. **No automatic drawer dumping ground.** Keep technical/high-density blocks in the content column when drawer placement harms scanning or comparison.
30. **No undocumented separator lines** between normal content groups. Use spacing first.
31. **No naked form fields and no hand-drawn field borders.** Every form field gets the theme's bordered box; never suppress it on a form field and never re-draw it with `'& .MuiInputBase-root': { border ... }`. Only inline controls (`inlineControlSx`), inputs inside a custom surface (`fieldResetSx`), and editable table cells (`tableCellFieldSx`) deviate.
32. **No invisible empty editable fields.** Empty inputs need concrete example placeholders (`e.g., server1`), never instruction copy.
33. **No local user picker variants on workspace metadata.** Use the shared `MetadataUserPicker` for assignee/requestor/owner/lead/etc. — not `UserSelect`, MUI `Autocomplete`, or hand-rolled menus.
34. **No client-side filtering of `/knowledge` for link pickers.** Use `KnowledgeLinkPickerDialog` against `/knowledge/link-options` with server-side `q`/`page`/`limit`; never paginate locally over the first page only.
35. **No `window.confirm` / `alert` / `prompt`.** Every destructive or category-switch confirmation uses `KanapDialog` with a descriptive body and an explicit `saveLabel` such as "Delete anyway" or "Continue".
36. **No `Menu` wrapping form content.** Use `Popover` (with explicit `anchorOrigin`/`transformOrigin`) when the anchored content includes any `TextField`, `Select`, `Autocomplete`, or multi-field layout. `Menu` is reserved for flat `MenuItem` lists.
37. **No nested `Autocomplete`/`Select` inside a metadata-bar `Menu`/`Popover` for finite-list pickers.** Prefetch the list and render flat `MenuItem` rows so one click opens the picker and a second click selects.
38. **No drag-reorder on lists that sort naturally alphabetically.** Reserve drag-and-drop for inherently manual ordering (timelines, prioritized rules, kanban). Sub-locations, contacts, options, tags etc. sort alphabetically server-side.
39. **No `LinearProgress` on tab-content first paint.** Tab switching must not produce a flash of progress bar — show empty layout during fetch, then content. The shell may show a single progress bar on the initial root-entity fetch only.
40. **No unconditional confirmation on delete.** If the count of impacted dependents is zero, delete directly. Show a `KanapDialog` only when `usage_count > 0` (or equivalent), and include the count in the list endpoint payload to avoid a second round-trip.
41. **No email subline in user picker lists.** All user pickers (MetadataUserPicker, ShareDialog recipients, mentions, share/notify lists) display names only; search matches names only. Email is internal data, not surface UI.

---

## Tenant branding

- Tenants can set a custom primary color (light + dark variants) via the branding page
- Custom color replaces `kanap.teal` / `primary.main` only — neutrals, surfaces, text, accent orange stay fixed
- Custom logo replaces the KANAP logo in the AppBar — must handle any aspect ratio gracefully
- When no custom branding: use the KANAP teal palette as default

---

## Implementation checklist

Before merging any new UI component, verify:

- [ ] Renders correctly in both light and dark mode
- [ ] Uses theme tokens (`kanap.*`) instead of hardcoded colors
- [ ] No `FormControl` or `InputLabel` on any form field
- [ ] No `cursor: help`, no permanent disabled buttons
- [ ] Font weights are only 400 or 500
- [ ] Sentence case throughout
- [ ] All technical IDs in monospace font
- [ ] Workspace title/list references use display references, not UUID fragments
- [ ] Sx constants are shared, not inlined per field
- [ ] Form fields rely on the theme box: no field sx that draws or removes a border, `inlineControlSx` / `fieldResetSx` / `tableCellFieldSx` only where the charter allows
- [ ] Metadata bar controls are compact, editable where useful, and anchored to the clicked item
- [ ] Metadata date clicks open the picker immediately near the click target/cursor
- [ ] Long-form Notes/Description-style fields use `kanap.bg.composer` plus `kanap.border.default`
- [ ] Drawer contains scalar properties; dense technical blocks remain in content when needed
- [ ] Auto-save on all fields: selects/dates on change, titles on blur, descriptions on debounced timer (2s)
- [ ] Hover/focus states defined explicitly
- [ ] Keyboard accessible (proper aria-labels, focus order, escape handling)
- [ ] Reverse-chronological for activity-style lists
- [ ] UI state persistence in localStorage where applicable
- [ ] No teal on table cell text
- [ ] Single-user metadata controls use `MetadataUserPicker`, not `UserSelect` or local menus
- [ ] Knowledge link pickers use `KnowledgeLinkPickerDialog` with server-side `/knowledge/link-options` search
- [ ] All confirmations and destructive prompts use `KanapDialog`; no `window.confirm`/`alert`/`prompt`
- [ ] `Menu` wraps only `MenuItem` lists; form content lives in `Popover` with explicit anchor origins
- [ ] Finite-list pickers (companies, locations, types) render flat `MenuItem` rows, not nested `Autocomplete`
- [ ] Destructive deletes show the impacted-dependents count and skip confirmation when count is zero
- [ ] No `LinearProgress` on tab-content first paint
- [ ] List ordering is alphabetical server-side unless drag-reorder is semantically required
- [ ] All user pickers (incl. ShareDialog recipients, mentions) display names only — no email subline
