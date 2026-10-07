# Accounts and Charts of Accounts (Tenant + Platform Admin)

Status: current (merged CoA+Accounts page implemented; legacy accounts list route redirected)
Last Updated: 2026-10-07

This document explains the functional model and APIs for Charts of Accounts (CoA) and Accounts, including tenant flows, platform-admin templates, CSV import/export, the native account name capability, and CoA filtering in OPEX/CAPEX workspaces.

## Concepts

- Chart of Accounts (CoA): A named set of accounts in a tenant. One default CoA can be set per country. Companies link to a CoA via `companies.coa_id`. Accounts link to a CoA via `accounts.coa_id` (NOT NULL).
- Platform Templates: A catalog of per-country CoA templates managed by platform admins. Tenants can load a template into a CoA (copy), then edit accounts freely.
- Seed Templates: 20 pre-configured templates (10 standards × 2 versions) are seeded automatically via migration. See [Seed Templates](#seed-templates) for the full catalog.
- CSV alignment: Accounts CSV import/export is CoA-aware. Global accounts CSV includes a `coa_code` column. CoA-scoped CSV uses the CoA route.
- Native account name: Each account can optionally carry a `native_name` (original local-language name). The UI shows it as a tooltip over the English name and exposes a hidden "Native Name" column.
- Global templates: When loading a platform template marked global, country input is not required; the CoA is created with scope `GLOBAL` (no country). A tenant may mark one CoA as the Global Default; setting a Global Default also assigns it to all companies in the tenant where `companies.coa_id` is NULL.
- Chart roles: three independent roles, each held by at most one chart (per country for the first one). See [Chart roles](#chart-roles).
- Consolidation mapping: every account carries a consolidation account number that points at an account of the tenant's consolidation chart. See [Consolidation chart](#consolidation-chart).

## Chart roles

| Role | Column | Scope | UI label | Meaning |
|---|---|---|---|---|
| Country default | `is_default` | `COUNTRY` charts only | Country default ({country}) | Proposed when a company is created in that country. One per tenant and country. |
| Global default | `is_global_default` | `GLOBAL` charts only | Default for other countries | Used for companies in a country that has no default chart. One per tenant. Setting it also assigns the chart to companies with `coa_id` NULL. |
| Consolidation chart | `is_consolidation` | any scope | Consolidation chart | The group accounts every local account maps to for consolidated reporting. One per tenant. |

The roles are independent: the base case (and the backfill of existing tenants) is one IFRS chart that is both the global default and the consolidation chart, but a tenant can split them. Each role can be removed (the chart then holds no role). A chart moved from `GLOBAL` to `COUNTRY` scope loses the global default. Deleting a chart (the usual delete rules apply) removes its roles with it. Every role change is written to the audit log on `chart_of_accounts` (before and after), one line per chart changed.

New tenants: provisioning copies the platform template marked `loaded_by_default` (IFRS v1.0) into a `GLOBAL` chart and makes it both the global default and the consolidation chart.

## Consolidation chart

The consolidation account number (`accounts.consolidation_account_number`) is the key. The consolidation name and description of an account are derived from the consolidation chart's account of that number, on the server:

- Create, update and CSV import (template loading reuses the import): when the number matches an account of the consolidation chart, `consolidation_account_name` and `consolidation_account_description` are overwritten with that account's name and description. An account of the consolidation chart that maps to its own number takes its own (new) name and description.
- When the number matches nothing (or the tenant has no consolidation chart), what the caller sent is kept, so legacy names stay visible.
- When the number is set to null (or a CSV row leaves it empty), name and description are cleared too.
- Propagation: when an account of the consolidation chart is created, renamed, given a new description or renumbered, every tenant account mapped to its old or new number takes its number, name and description, in the same transaction. A self-reference follows a renumbering. Each account rewritten gets its own audit line (before and after).

Status of an account against the consolidation chart (`consolidation_status`):

| Status | Meaning |
|---|---|
| `mapped` | The consolidation number exists in the consolidation chart. |
| `outside` | The number is set but absent from the consolidation chart, or the tenant has no consolidation chart. |
| `unmapped` | No consolidation number. |

Changing the consolidation chart never remaps accounts. The switch resyncs the derived fields only: every account whose number matches an account of the new consolidation chart takes that account's name and description. Accounts whose number is absent from it become `outside`; the preview endpoint gives the counts before the switch. Reports group by consolidation number (else name) and are not affected by the role itself.

## CoA Filtering Logic (Accounts by Company)

### Backend Filtering Behavior

When querying accounts with `?companyId=X`, the backend enforces **strict CoA-based filtering**:

**For companies WITH a CoA assigned** (`coa_id` is set):
- Returns ONLY accounts that belong to that specific CoA
- Example: Company "Acme France" with CoA "FR-2024" → shows only accounts from "FR-2024"

**For companies WITHOUT a CoA** (unexpected after backfill):
- Fallback to the tenant’s Global Default CoA when present
- Note: a migration backfills `companies.coa_id` to a country default or the Global Default; new companies are auto-assigned

**Implementation** (`backend/src/accounts/accounts.service.ts`):
```typescript
if (companyId) {
  const company = await repo.findOne({ where: { id: companyId } });
  if (company) {
    if (company.coa_id) {
      where.coa_id = company.coa_id;  // Filter by specific CoA
    } else {
      // Fallback to tenant Global Default CoA when present
      const rows = await manager.query(`SELECT id FROM chart_of_accounts WHERE is_global_default = true LIMIT 1`);
      where.coa_id = rows?.[0]?.id || undefined;
    }
  }
}
```

### Virtual Field Handling (coa_code)

The `coa_code` field is a **virtual field** enriched after the query. It doesn't exist in the `accounts` table.

**For sorting by CoA**:
- Frontend sorts by `coa_code`
- Backend maps `coa_code` → `coa_id` for SQL ORDER BY

**For filtering by CoA**:
- Frontend filters by `coa_code` (text patterns like "FR", "UK-2024")
- Backend:
  1. Looks up CoA IDs matching the code pattern via `chart_of_accounts` table
  2. Converts filter to use those CoA IDs with an IN clause
  3. Supports all filter types: equals, contains, startsWith, endsWith

**Implementation** (`backend/src/accounts/accounts.service.ts`):
```typescript
// Sorting: map virtual field to actual column
const sortField = sort.field === 'coa_code' ? 'coa_id' : sort.field;

// Filtering: look up CoA IDs by code pattern
if ('coa_code' in filters) {
  const coaRows = await manager.query(
    `SELECT id FROM chart_of_accounts WHERE code ILIKE $1`,
    [pattern]
  );
  const coaIds = coaRows.map(r => r.id);
  filters.coa_id = { filterType: 'set', values: coaIds };
  delete filters.coa_code;
}
```

### Obsolete Account Detection (OPEX/CAPEX Workspaces)

When editing OPEX or CAPEX items, the system detects when an account doesn't match the company's CoA:

**Warning Trigger**:
- Item has `account_id` set
- Item has `paying_company_id` set
- Account's `coa_id` ≠ Company's `coa_id`

**User Experience**:
```
⚠️ Obsolete account detected. The selected account does not belong to
the company's Chart of Accounts. Please update the account.
```

This occurs during:
- Migration to CoA-enabled workflow (old items with pre-CoA accounts)
- Data errors (account manually reassigned to different CoA)

**Implementation** (frontend editors):
```typescript
// Fetch account's coa_id
const accountRes = await api.get(`/accounts/${accountId}`);
const accountCoaId = accountRes.data?.coa_id;

// Fetch company's coa_id
const companyRes = await api.get(`/companies/${companyId}`);
const companyCoaId = companyRes.data?.coa_id;

// Detect mismatch
const hasObsoleteAccount = accountId && companyId &&
  accountCoaId && companyCoaId &&
  accountCoaId !== companyCoaId;
```

## Data Model

### chart_of_accounts
- `id uuid` (PK)
- `tenant_id uuid` (RLS via `app.current_tenant`)
- `code text` (unique per tenant)
- `name text`
- `scope text` (`GLOBAL` | `COUNTRY`)
- `country_iso char(2) NULL` (required only when `scope=COUNTRY`)
- `is_default boolean` (applies to `COUNTRY` scope; unique per tenant+country via partial unique index)
- `is_global_default boolean` (applies to `GLOBAL` scope; one per tenant via partial unique index)
- `is_consolidation boolean NOT NULL DEFAULT false` (any scope; one per tenant via the partial unique index `uq_coa_tenant_consolidation` on `(tenant_id) WHERE is_consolidation`)
- `created_at/updated_at timestamptz`

RLS is enforced; all queries run with `tenant_id = app.current_tenant()`.

### accounts
- `id uuid` (PK)
- `tenant_id uuid` (RLS)
- `coa_id uuid NOT NULL` (scoped to a CoA)
- `account_number text` (stored as text for compatibility; accepts numeric input via transformer)
- `account_name text` (English UI label)
- `native_name text NULL` (original local-language label)
- `description text NULL`
- `consolidation_account_number int NULL`
- `consolidation_account_name text NULL`
- `consolidation_account_description text NULL`
- `status status_state` (enabled|disabled + disabled_at window semantics)
- `disabled_at timestamptz NULL`
- `created_at/updated_at timestamptz`

Planned constraint post backfill: unique `(tenant_id, coa_id, account_number)` and NOT NULL on `coa_id`.

**Note on `account_number` validation**: The DTO uses `@Transform` to automatically convert numeric values to strings before validation, ensuring compatibility when frontends send numbers instead of strings:
```typescript
@Transform(({ value }) => (value != null ? String(value) : value))
@IsString()
account_number?: string | null;
```

### companies
- `coa_id uuid NULL` with auto-assignment from default CoA by `country_iso` on create/update when missing.

Global Default Fallback
- When no country default exists for the company’s country, auto-assignment falls back to the tenant’s Global Default CoA (`is_global_default=true`).
- Country default takes precedence; the global default applies to all other countries until a country-specific default is set.

## Tenant APIs

Base permissions follow the existing model: `accounts:reader|manager|admin`.

### CoA CRUD (tenant)
- `GET /chart-of-accounts` → paginated list
  - Supports quick search, AG Grid filters (and sort) on `code`, `name`, `country_iso`, `scope`, `is_default`, `is_global_default`, `is_consolidation`, `created_at`, `updated_at`.
  - Each item carries `is_consolidation`, `companies_count`, `accounts_count`, `accounts_unmapped_count` (accounts without consolidation number) and `accounts_outside_count` (number set but absent from the consolidation chart; 0 when the tenant has none). Disabled accounts count too. The counts come from one batched query.
- `GET /chart-of-accounts/:id` → detail, with the same counts
- `POST /chart-of-accounts` → create (supports `is_default`; ensures one default per country)
- `PATCH /chart-of-accounts/:id` → update
- `DELETE /chart-of-accounts/:id` → guarded delete
  - Blocks when any companies link to the CoA
  - Blocks when any OPEX/CAPEX items reference accounts in that CoA
  - When allowed, deletes the CoA and all unused accounts within it
- `DELETE /chart-of-accounts/bulk` → guarded bulk delete
- `GET /chart-of-accounts/templates` → list platform templates (for selection in load dialog)

### Chart roles (tenant)

All role endpoints require `accounts` at manager level (`member`), run in the request transaction and write one audit line per chart changed.

- `PATCH /chart-of-accounts/:id/global-default` → makes this `GLOBAL` chart the global default (400 for a `COUNTRY` chart), clears the previous one, assigns it to companies with `coa_id` NULL. Empty response.
- `DELETE /chart-of-accounts/:id/global-default` → removes the global default from this chart → `{ cleared: boolean }` (`false` when it did not hold it).
- `PATCH /chart-of-accounts/:id` with `{ is_default: true | false }` → sets or removes the country default.
- `PATCH /chart-of-accounts/:id/consolidation` → makes this chart (any scope) the consolidation chart, clears the previous one, then resyncs the derived fields → `{ resynced, outside }`: the accounts whose consolidation name or description was rewritten, and the accounts of the other charts whose consolidation number is absent from this chart.
- `DELETE /chart-of-accounts/:id/consolidation` → removes the role from this chart → `{ cleared: boolean }` (`false` when it did not hold it). Accounts are not touched.
- `GET /chart-of-accounts/:id/consolidation-impact` → preview for the confirmation dialog, no write → `{ matched, outside, unmapped }`: among the accounts of the other charts, those whose consolidation number exists in this chart, is set but absent from it, or is not set.

### CoA-scoped Accounts CSV (tenant)
- `GET /chart-of-accounts/:id/accounts/export?scope=data|template`
  - `template`: headers only
  - `data`: rows for this CoA
- `POST /chart-of-accounts/:id/accounts/import?dryRun=true|false`
  - Semicolon-delimited UTF-8 CSV; validates and either reports preflight or writes changes

### Accounts (tenant)
- `GET /accounts` → paginated list
  - Supports quick search, AG filters, and CoA scoping via `?companyId` or `?coaId`
  - Enriches items with `coa_code` for display and `consolidation_status` (`mapped` | `outside` | `unmapped`, see [Consolidation chart](#consolidation-chart)), computed for the page in one query
  - `?consolidationStatus=mapped|outside|unmapped` filters on the server (page and total follow the filter); any other value is a 400. `GET /accounts/ids` accepts it too.
- `GET /accounts/:id` → detail, with `consolidation_status`
- `POST /accounts` → create account (requires `coa_id`; UI provides a required selector; API accepts `?coaId=` fallback)
- `PATCH /accounts/:id` → update account (including moving to a different CoA via `coa_id`)
  - Create, update and import derive the consolidation name and description from the consolidation chart, and an account of the consolidation chart propagates its changes (see [Consolidation chart](#consolidation-chart)).
- `GET /accounts/export?scope=...&coaId=...` → CSV
  - Global export includes `coa_code` to identify the CoA; scoped export uses `coaId`
- `POST /accounts/import?dryRun=...&coaId=...` → CSV import
  - When not scoping via `?coaId`, a single `coa_code` must be provided across all rows

Deletion
- Account deletion is guarded: it fails if any OPEX/CAPEX items still reference the account. Disable accounts instead when appropriate.


### Load from Template (tenant)
- `POST /chart-of-accounts/:id/load-template` with `{ template_id, dryRun?: boolean, overwrite?: boolean }`
  - `overwrite=false`: only insert missing account numbers; leave existing accounts unchanged.
  - `overwrite=true` (default): update existing accounts in the target CoA.
  
Preflight for template import:
- `POST /chart-of-accounts/import-template/preflight` with `{ template_id, target_coa_id? }`
  - Without `target_coa_id`, indicates all rows would be inserted when creating a new CoA.
  - With `target_coa_id`, reports `{ inserted, updated }` based on existing account numbers.
  - Preflight and then apply accounts into the selected CoA (copy behavior; no sync)
Notes on Global Templates
- When a platform template is marked global, the tenant CoA created from it does not prompt for a country. The CoA is created with `scope=GLOBAL` and can be marked as the tenant’s Global Default.

## Platform Admin APIs

Guarded by `PlatformAdminGuard` and intended for the platform host.

- `GET /admin/coa-templates` → list
- `GET /admin/coa-templates/:id` → detail
- `POST /admin/coa-templates` → create `{ template_code, template_name, version, is_global?, loaded_by_default?, country_iso? }`
- `PATCH /admin/coa-templates/:id` → edit (same fields)
- `DELETE /admin/coa-templates/:id` → delete
- `GET /admin/coa-templates/:id/export` → CSV of template accounts
- `POST /admin/coa-templates/:id/import?dryRun=true|false` → upload CSV (semicolons, UTF‑8)
  - `dryRun=true` performs a preflight only and returns `{ ok, dryRun: true, total, inserted, updated, errors: [] }`
  - `dryRun=false` persists as the template’s `csv_payload` and returns `{ ok, dryRun: false, total, inserted, updated, processed, errors: [] }`

Standard Accounts within a Template (CRUD on the template CSV)
- `GET /admin/coa-templates/:id/accounts?sort=account_number:ASC&q=&page=1&limit=50` → list rows parsed from the template’s CSV
- `GET /admin/coa-templates/:id/accounts/ids?sort=...&q=...` → `{ ids: string[] }` ordered for prev/next in workspace
- `GET /admin/coa-templates/:id/accounts/:accountNumber` → get one row (by `account_number`)
- `POST /admin/coa-templates/:id/accounts` → create row `{ account_number, account_name, native_name?, description?, consolidation_account_number?, consolidation_account_name?, consolidation_account_description?, status }`
- `PATCH /admin/coa-templates/:id/accounts/:accountNumber` → update row; allows renumbering
- `DELETE /admin/coa-templates/:id/accounts/:accountNumber` → delete row
- `DELETE /admin/coa-templates/:id/accounts/bulk` → delete many `{ ids: string[] }` (ids are account numbers)

## CSV Schema (Accounts)

CSV is semicolon (`;`) delimited, UTF‑8 (export includes BOM for Excel). Header order matters and is validated.

Global export/import (`/accounts`):
```
coa_code;account_number;account_name;native_name;description;consolidation_account_number;consolidation_account_name;consolidation_account_description;status
```

CoA-scoped export/import (`/chart-of-accounts/:id/accounts`):
```
account_number;account_name;native_name;description;consolidation_account_number;consolidation_account_name;consolidation_account_description;status
```

Validation rules:
- `account_number`: required, integer (stored as text for compatibility)
- `account_name`: required (English UI name)
- `native_name`: optional (original local-language name)
- `status`: `enabled|disabled` (defaults to enabled); disable uses `disabled_at` in the model
- `consolidation_*`: optional; `consolidation_account_number` must be an integer if provided. When it matches an account of the consolidation chart, the file's consolidation name and description are replaced by that account's; when it is empty, they are cleared.

Import behavior:
- Deduplicates by `account_number` within the target CoA (first row wins)
- Classifies rows as inserts/updates by existence in the target CoA
- `dryRun=true` returns a report `{ ok, total, inserted, updated, errors[] }`
- Global import requires either a `?coaId` param or a single uniform `coa_code` column across rows

## Frontend

### Master Data → Charts of Accounts (Merged CoA + Accounts)
- The tenant UI now uses a single CoA-centric page at `/master-data/coa`.
- Top section: horizontal CoA chip bar (`code` with default badges) plus `New` and `Manage`.
- URL state: selected CoA is stored as `?selected=<coaId>` (legacy `?coaId=` links are mapped automatically).
- Accounts grid is always CoA-scoped (no cross-CoA list view in the main UI).
- Account actions are on the same page:
  - `New Account`
  - `Import CSV` (to `/chart-of-accounts/:id/accounts/import`)
  - `Export CSV` (to `/chart-of-accounts/:id/accounts/export`)
  - `Delete Selected` (guarded)
- Account columns reuse prior Accounts page behavior, including native-name tooltip and optional hidden `Native Name` column.

Manage dialog:
- Replaced the oversized CoA grid with a compact modal:
  - Left: selectable CoA list
  - Right: details panel (scope, country, defaults, counts)
  - Actions: `New`, `Set Country Default`, `Set Global Default`, `Delete Selected`

Legacy route behavior:
- `/master-data/accounts` now redirects to `/master-data/coa` and preserves list/query context.
- Account workspace routes remain `/master-data/accounts/:id/:tab` for deep links and prev/next navigation.

Account create/edit:
- Create and Edit forms still include required CoA selection.
- Moving an account to a different CoA is supported; uniqueness conflicts on `(tenant_id, coa_id, account_number)` return friendly errors.

### Master Data → Companies
- Overview tab: CoA selector appears between Country and Address 1; persists `coa_id`.
- Defaulting in the form: when a country is selected, the CoA field preselects the country default when available; otherwise it preselects the tenant’s Global Default. The dropdown lists `COUNTRY`-scoped CoAs for the selected country and also includes all `GLOBAL`-scoped CoAs (with the Global Default highlighted by the UI).
- Set Global Default behavior: when a CoA is set as the tenant’s Global Default, companies with `coa_id` still NULL are automatically assigned to it.

### Platform Admin → CoA Templates
- Grid to manage template metadata and CSV payload
- CSV Import supports preflight (dry run) and commit

### Platform Admin → Standard Accounts
- Route: `/admin/standard-accounts` with a template selector
- Lists and manages “standard accounts” stored in the selected template’s CSV
- Actions: New, Import (preflight + load), Export, Delete Selected
- Workspace: `/admin/standard-accounts/:templateId/:accountNumber/overview` with prev/next navigation
- Isolation: This UI only edits the template CSV; tenant `accounts` are unaffected until a tenant loads the template into their CoA

## Seed Templates

### Overview

KANAP ships with **20 pre-configured CoA templates** covering 10 accounting standards, each in two versions:

| Code | Country | Standard | v1.0 Accounts | v2.0 Accounts |
|------|---------|----------|---------------|---------------|
| `IFRS` | Global | IFRS | 14 | ~30 |
| `FR-PCG` | FR | Plan Comptable General | 20 | ~31 |
| `DE-SKR03` | DE | Standardkontenrahmen 03 | 20 | ~32 |
| `GB-UKGAAP` | GB | UK GAAP | 20 | ~31 |
| `ES-PGC` | ES | Plan General de Contabilidad | 20 | ~31 |
| `IT-PDC` | IT | Piano dei Conti | 20 | ~31 |
| `NL-RGS` | NL | Rekeningschema (RGS) | 20 | ~31 |
| `BE-PCMN` | BE | Plan Comptable Minimum Normalise | 20 | ~31 |
| `CH-KMU` | CH | Kontenrahmen KMU | 20 | ~31 |
| `US-USGAAP` | US | US GAAP | 20 | ~32 |

**v1.0 (Simple)**: IT-focused accounts using real country-standard account numbers. Covers the essential cost categories: CAPEX (hardware, software), OPEX (licenses, cloud, telecom, consulting, staff, training, etc.).

**v2.0 (Detailed)**: All v1.0 accounts plus granular sub-accounts (e.g., Purchased vs. Internally Developed Software, Network Equipment, SaaS vs. Perpetual Licenses, Mobile Communications, IT Bonuses, IT Insurance).

**IFRS v1.0** is special: it contains the 14 consolidation accounts themselves, each self-referencing as its own consolidation target. It is marked `loaded_by_default=true` and auto-provisioned to new tenants.

### Consolidation Mapping

All templates map every account to one of 14 IFRS consolidation accounts:

| # | Account | Category |
|---|---------|----------|
| 1000 | Tangible Assets (CAPEX) | Physical IT equipment — IAS 16 |
| 1100 | Intangible Assets (CAPEX) | Capitalized software and rights — IAS 38 |
| 1200 | Depreciation & Amortization | Expense for PPE and intangibles — IAS 16/38 |
| 1300 | Impairments & Write-offs | Impairment of assets — IAS 36 |
| 2000 | Software Licenses (OPEX) | Recurring licenses and subscriptions |
| 2100 | Cloud & Hosting Services | IaaS/PaaS/SaaS usage and hosting |
| 2200 | Telecommunications & Network | Internet, mobile, lines, VPN |
| 2300 | Maintenance & Support | Software/hardware maintenance contracts |
| 2400 | IT Consulting & External Services | Professional services, integration, contractors |
| 2500 | IT Staff Costs | Salaries, benefits — IAS 19 |
| 2600 | Training & Certification | Staff training and certifications |
| 2700 | Workplace IT (Non-capitalized) | End-user devices/peripherals not capitalized |
| 2800 | Travel & Mobility (IT Projects) | Project-related travel costs |
| 2900 | Other IT Operating Expenses | Miscellaneous IT OPEX |

### File Structure

Templates are stored as TypeScript string constants in `backend/src/seed/coa-templates/`:

```
backend/src/seed/coa-templates/
  index.ts              # TemplateDefinition[] registry — metadata + CSV imports
  ifrs-v1.ts            # IFRS v1.0 (14 self-referencing consolidation accounts)
  ifrs-v2.ts            # IFRS v2.0 (14 parents + ~16 sub-accounts)
  fr-pcg-v1.ts          # France v1.0 (6-digit PCG numbers)
  fr-pcg-v2.ts          # France v2.0
  de-skr03-v1.ts        # Germany v1.0 (SKR03 ranges)
  de-skr03-v2.ts        # Germany v2.0
  gb-ukgaap-v1.ts       # UK v1.0
  gb-ukgaap-v2.ts       # UK v2.0
  es-pgc-v1.ts          # Spain v1.0
  es-pgc-v2.ts          # Spain v2.0
  it-pdc-v1.ts          # Italy v1.0
  it-pdc-v2.ts          # Italy v2.0
  nl-rgs-v1.ts          # Netherlands v1.0
  nl-rgs-v2.ts          # Netherlands v2.0
  be-pcmn-v1.ts         # Belgium v1.0
  be-pcmn-v2.ts         # Belgium v2.0
  ch-kmu-v1.ts          # Switzerland v1.0
  ch-kmu-v2.ts          # Switzerland v2.0
  us-usgaap-v1.ts       # US v1.0
  us-usgaap-v2.ts       # US v2.0
```

Each file exports a `csv` string constant with BOM prefix (`\ufeff`) and semicolon delimiter, matching the `encodeTemplateRows` convention in `admin-coa-templates.service.ts`. TypeScript string exports were chosen over `.csv` files to avoid adding `copyfiles` to the build pipeline.

### Migration

**File**: `backend/src/migrations/1826000000000-seed-coa-templates.ts`

**`up()` logic** (destructive replacement — intentional):
1. Validates all CSV payloads (header schema, integer account numbers, valid status values)
2. `DELETE FROM coa_templates` — replaces all existing templates
3. Inserts all 20 templates from the `TEMPLATES` registry
4. Asserts exactly one `loaded_by_default=true` global template exists (IFRS v1.0)

**`down()` logic**: Deletes seeded templates by matching `(template_code, version, is_global, country_iso)` 4-tuple. Does not restore previously deleted manual templates.

**Note**: The migration is explicitly destructive. Tenant CoAs copied from previous templates are unaffected (no FK dependency between `coa_templates` and tenant `accounts`).

### Native Names

Country templates include `native_name` in the local language:
- FR: `Logiciels informatiques`, `Hebergement cloud et IaaS`
- DE: `EDV-Software`, `Cloud-Hosting und IaaS`
- IT: `Licenze software`, `Hosting cloud e IaaS`
- NL: `Softwarelicenties`, `Cloudhosting en IaaS`
- BE: `Logiciels informatiques`, `Hebergement cloud et IaaS`
- CH: `Software`, `Cloud-Hosting und IaaS`
- ES: `Licencias de software`, `Alojamiento cloud e IaaS`
- GB/US: No native names (English is the primary language)

## Security & RLS
- All tenant resources apply RLS using `app.current_tenant()`
- Platform admin APIs are only accessible on the platform host with platform admin privileges

## Migrations & Ops
- Run migrations: `cd backend && npm run typeorm -- migration:run`
  - Includes: initial CoA, CoA templates, `accounts.native_name`, Legacy CoA backfill, `accounts.coa_id` NOT NULL, CoA `scope` migration (GLOBAL vs COUNTRY with constraints), and seed CoA templates (20 templates)
- Seed templates migration (`1826000000000-seed-coa-templates`): replaces all `coa_templates` rows with the 20 seed templates. Revert + re-run is safe. Tenant CoAs are unaffected.
- Backend build: `cd backend && npm run build`
- Frontend: `cd frontend && npm run build` or `npm run dev`

- Consolidation chart migration (`1853860000000-chart-of-accounts-consolidation`): adds `is_consolidation` and its partial unique index; every tenant without a consolidation chart gets its global default chart (if any) as consolidation chart. It disables row level security on `chart_of_accounts` and `search_index` around the backfill (the chart's search trigger writes into `search_index`), restores it as found and logs the counts. Rerun-safe.

Operational Notes
- Setting a CoA as Global Default also assigns it to companies with `coa_id` = NULL.
- Scope migration: legacy tenants that previously used the `ZZ` sentinel are transparently migrated to `scope=GLOBAL` with `country_iso=NULL`.

## Future Work
- Consider promoting `companies.coa_id` to NOT NULL (auto-assigned on create/update already)
- Optional: add `chart_of_accounts.language_tag` (BCP‑47) for countries with multiple official languages
