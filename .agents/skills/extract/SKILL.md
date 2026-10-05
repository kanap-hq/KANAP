---
name: extract
description: Extract hardcoded user-facing strings from React/TypeScript files into i18n locale files and wire t() calls. Run before /translate.
argument-hint: [file-or-glob | --all]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(git diff *), Bash(git show *)
---

# /extract — KANAP i18n String Extraction

Extract hardcoded user-facing strings from React/TypeScript components into the appropriate i18n locale namespace, and replace them with `t()` calls.

## Arguments

- `/extract` — **Smart default.** Extracts from all uncommitted changed `.tsx`/.`.ts` frontend files (uses `git diff`). This is the normal workflow: write code, then `/extract`.
- `/extract frontend/src/pages/portfolio/NewPage.tsx` — Extract from a specific file.
- `/extract frontend/src/pages/portfolio/editors/*.tsx` — Extract from a glob pattern.
- `/extract --all` — **Full audit.** Scans all frontend component files for remaining hardcoded strings. Slow but thorough.

## How It Works

### Step 1: Identify target files

**Default (no arguments):**
Detect changed frontend files from git:

!`git diff --name-only HEAD -- 'frontend/src/pages/**/*.tsx' 'frontend/src/components/**/*.tsx' 'frontend/src/ai/**/*.tsx' 'frontend/src/pages/**/*.ts' | grep -v __tests__ | grep -v '\.test\.' | grep -v '\.spec\.' | head -30`

Also check untracked new files:

!`git ls-files --others --exclude-standard -- 'frontend/src/pages/**/*.tsx' 'frontend/src/components/**/*.tsx' 'frontend/src/ai/**/*.tsx' | head -20`

If no files found, report "No uncommitted frontend changes detected" and stop.

**Explicit path (`$ARGUMENTS`):** Use the provided file path or glob.

**`--all` flag:** Glob all `.tsx` files under `frontend/src/pages/` and `frontend/src/components/`, excluding test files.

### Step 2: For each target file

1. **Read the file** fully
2. **Check if it already has `useTranslation`** — if yes, look only for NEW hardcoded strings (the file was partially extracted before)
3. **Identify all hardcoded user-facing strings** (see identification rules below)
4. **Determine the namespace** from the file path (see namespace mapping below)
5. **Read the existing English locale file** for that namespace to understand current key structure and avoid duplicates
6. **Read `frontend/src/locales/en/common.json`** to check for reusable common keys
7. **Generate translation keys** for each extracted string (see key naming rules below)
8. **For each string, decide**: is it a common key reuse (buttons, status, etc.) or a new domain key?

### Step 3: Apply changes

1. **Add `import { useTranslation } from 'react-i18next'`** if not present
2. **Add `const { t } = useTranslation(['namespace', 'common'])`** inside the component if not present
3. **Add `import { useLocale } from '../../i18n/useLocale'`** if the file has `toLocaleString`/`Intl.*` calls without locale
4. **Replace each hardcoded string** with the appropriate `t()` call
5. **Add new keys to `frontend/src/locales/en/{namespace}.json`** — merge into existing structure
6. **Copy new keys to `frontend/src/locales/{fr,de,es}/{namespace}.json`** with English placeholder values, preserving existing translated content
7. **Replace error fallback patterns** `e?.response?.data?.message || 'Failed to...'` with `getApiErrorMessage(error, t, t('namespace:messages.xxxFailed'))` — add the import if needed

### Step 4: Report

For each file processed, print:
```
✓ pages/portfolio/NewPage.tsx → portfolio namespace
  Extracted: 12 strings (8 new keys, 4 common reuses)
  New keys: projects.newFeature.title, projects.newFeature.columns.name, ...
  Common reuses: common:buttons.save, common:buttons.cancel, common:status.loading, ...
  Skipped: 2 strings (ambiguous — verify manually)
```

At the end:
```
Extraction complete. Run /translate to generate fr/de/es translations.
```

## String Identification Rules

### Always extract
- JSX text content: `<Typography>User-visible text</Typography>`
- String props on UI components: `label="..."`, `title="..."`, `placeholder="..."`, `aria-label="..."`
- AG-Grid column definitions: `headerName: '...'`
- PageHeader: `<PageHeader title="..." />`
- Button text: `<Button>Click me</Button>`
- Dialog titles: `<DialogTitle>...</DialogTitle>`
- Alert/Snackbar messages: `<Alert>...</Alert>`
- Error fallbacks: `|| 'Failed to load data'`
- Confirm messages: `window.confirm('Are you sure?')`
- Empty state text: `"No items found"`, `"No data available"`
- Tooltip text: `<Tooltip title="...">`
- Tab labels: `<Tab label="..." />`
- Chip labels: `<Chip label="..." />`
- Select/MenuItem display text: `<MenuItem>Option text</MenuItem>`

### Never extract
- Strings already wrapped in `t()` or `t('...')`
- Import paths, module names
- CSS values, color codes
- URLs, API endpoints
- Console logging: `console.log(...)`, `console.warn(...)`, `console.error(...)`
- Object keys used as identifiers (not display text)
- Database values: `'enabled'`, `'in_progress'`, `'pending_review'` when used as enum values
- Brand names: `'KANAP'`, `'Microsoft'`, `'Stripe'`
- Technical constants: regex, number literals
- Test file content
- Comments (they don't render in UI)
- Strings in `key=`, `value=`, `name=` props (these are form data identifiers, not display text)
- Strings inside `navigate()`, `Link to=`, route paths

### Edge cases — skip and report
- Strings that MIGHT be user-facing but you're not sure → skip and list in "Skipped" section
- Very short strings (1-2 characters) that could be punctuation → skip
- Strings that are duplicates of existing locale keys with slightly different wording → flag for manual review

## Namespace Mapping

Determine the namespace from the file path:

| File path contains | Namespace | Example |
|---|---|---|
| `pages/portfolio/`, `pages/tasks/` | `portfolio` | `portfolio:projects.columns.name` |
| `pages/it/` | `it` | `it:applications.columns.name` |
| `pages/opex/`, `pages/capex/`, `pages/contracts/`, `pages/operations/`, `pages/reports/` | `ops` | `ops:opex.columns.product` |
| `pages/companies/`, `pages/departments/`, `pages/suppliers/`, `pages/contacts/`, `pages/coa/`, `pages/accounts/`, `pages/analytics/`, `pages/business-processes/` | `master-data` | `master-data:companies.columns.name` |
| `pages/admin/` | `admin` | `admin:users.columns.email` |
| `pages/knowledge/` | `knowledge` | `knowledge:documents.columns.title` |
| `pages/ai/`, `ai/components/` | `ai` | `ai:chat.placeholder` |
| `pages/settings/` | `settings` | `settings:notifications.title` |
| `pages/Login`, `pages/Forgot`, `pages/Reset`, `pages/AcceptInvite` | `auth` | `auth:login.title` |
| `pages/Dashboard`, `pages/workspace/` | `common` | `common:dashboard.tiles.myTasks` |
| `components/` (shared) | `common` | `common:csv.exportTitle` |
| Anything else | `common` | `common:labels.newLabel` |

## Key Naming Convention

Follow the pattern `{section}.{subsection}.{element}`:

| String type | Key pattern | Example |
|---|---|---|
| Page title | `{entity}.title` | `projects.title` = "Portfolio Projects" |
| Column header | `{entity}.columns.{fieldName}` | `projects.columns.projectName` = "Project Name" |
| Button | Reuse `common:buttons.*` if generic; else `{entity}.actions.{action}` | `common:buttons.save` or `projects.actions.newProject` |
| Form field label | `{entity}.fields.{fieldName}` | `projects.fields.startDate` = "Start Date" |
| Error message | `{entity}.messages.{description}` or `common:messages.*` | `projects.messages.loadFailed` |
| Confirm dialog | `{entity}.confirmations.{action}` | `projects.confirmations.unsavedChanges` |
| Empty state | `{entity}.states.empty` | `projects.states.empty` = "No projects found" |
| Tab label | `{entity}.tabs.{tabName}` | `projects.tabs.summary` = "Summary" |
| Status label | Use existing `statuses.*` or `common:statuses.*` | `portfolio:statuses.project.in_progress` |
| Loading state | Reuse `common:status.loading` | — |

## Common Key Reuse

Before creating a new key, check if the string already exists in `common.json`. Reuse these — never duplicate:

**Buttons:** `common:buttons.save`, `.cancel`, `.delete`, `.close`, `.create`, `.add`, `.remove`, `.deleteSelected`, `.saveChanges`, `.reset`, `.edit`, `.export`, `.import`, `.view`, `.viewAll`, `.open`, `.back`, `.clear`, `.continue`, `.send`, `.upload`, `.browse`

**Status:** `common:status.loading`, `.saving`, `.deleting`, `.sending`, `.importing`, `.exporting`

**Messages:** `common:messages.loadFailed`, `.saveFailed`, `.loadFailedRefresh`

**Delete dialog:** `common:delete.*` (confirmTitle, warningMessage, singleItem, multipleItems, etc.)

**Filters:** `common:filters.quickFilter`, `.clearQuickFilter`, `.search`, `.noOptions`, `.blank`

**CSV:** `common:csv.*` (exportTitle, importTitle, etc.)

**Selects:** `common:selects.loading`, `.noAccountsFound`, etc.

If a string matches a common key exactly, use the common key with namespace prefix: `t('common:buttons.save')`.

## Error Handling Pattern

Replace this:
```typescript
} catch (e: any) {
  setError(e?.response?.data?.message || 'Failed to load data');
}
```

With this:
```typescript
import { getApiErrorMessage } from '../utils/apiErrorMessage';
// ...
} catch (e: any) {
  setError(getApiErrorMessage(e, t, t('namespace:entity.messages.loadFailed')));
}
```

## Rules

- **Read before writing.** Always read the existing locale file before adding keys.
- **Merge, never overwrite.** Add new keys to existing JSON structure. Preserve existing keys.
- **Preserve key order.** Match the order of the English source file.
- **Preserve existing translations.** When adding to fr/de/es, keep existing translated values for existing keys. Only add new keys with English placeholders.
- **One namespace per file.** Each source file maps to exactly one namespace (plus `common` for reuses).
- **Don't over-extract.** When in doubt, skip the string and report it. False negatives are better than false positives.
- **Run typecheck after.** After extraction, run `cd frontend && npm run typecheck` to verify no type errors were introduced.
