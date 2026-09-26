# CSV Import/Export

Purpose: Describe how CSV import/export works across entities, including headers, validation, preflight vs commit, and known constraints.
Audience: Product, Engineering, QA
Status: living
Owner: Eng

## Conventions
- Delimiter: semicolon `;` (not a comma). This is consistent across all CSVs.
- Encoding: UTF‑8 with BOM on export; imports must be valid UTF‑8. If you see an encoding error, save as “CSV UTF‑8”.
- Headers: Exact match required. Use the “Export template” action to get correct headers.
- Status:
  - Most entities: `enabled` or `disabled` (case-insensitive)
  - Users: `contact | invited | enabled | disabled`
    - `contact`: directory contact only (no app access, does not consume a seat)
    - `invited`: invited, not yet enabled (does not consume a seat)
    - `enabled`: active app user (consumes a seat)
    - `disabled`: suspended (does not consume a seat)
- IDs: CSV uses business-friendly identifiers. Relationships are resolved by names as specified per entity (no UUIDs in CSV).

- Lifecycle (`disabled_at`):
  - When provided, `disabled_at` is treated as the source of truth for lifecycle. The backend derives `status` from the timestamp at save time.
  - Leave `disabled_at` blank to keep records active indefinitely. Set a date to schedule end-of-day deactivation (23:59 local input → stored ISO timestamp).
  - OPEX and CAPEX items: `disabled_at` is the item's only end date, shown as "End of validity". A bare date (`2026-12-31`) is stored at 12:00 UTC of that day, so it reads the same calendar day across European time zones and keeps its year; a full ISO timestamp is kept as given. OPEX exports write the full timestamp, CAPEX exports the date.
  - OPEX and CAPEX items, legacy files: an `effective_end` column is still accepted on import for one release and never exported. Its date fills `disabled_at` when that cell is empty; it never overrides a `disabled_at` value and an empty cell clears nothing.
  - If both `status` and `disabled_at` are present and conflict, the date wins; the system will normalize `status` to match `disabled_at`.

## Workflow
1) Export template → download empty CSV with headers
2) Fill CSV → semicolons, exact headers, UTF‑8
3) Preflight check (dry-run) → server validates; returns insert/update counts and up to 5 sample errors
4) Load (commit) → server upserts; response includes processed count

Error reporting
- Header mismatch is reported on row 0 with missing/extra column names.
- Validation errors include row numbers (1-based with header counted as line 1).
- Import aborts on validation errors; no partial writes occur in preflight. On commit, rows are upserted per unique key.

Deduplication & Upsert keys
- Companies: unique by `name`
- Departments: unique by `company_id + name` (CSV uses `company_name` to resolve `company_id`)
- Suppliers: unique by `name`
- Accounts: unique by `account_number`
- Users: unique by `email`

## Endpoints
- Export: `GET /{entity}/export?scope=template|data&year={yyyy?}` → returns `text/csv` with BOM. `year` is optional and defaults to the current calendar year; it allows entities such as Companies to generate dynamic metric columns.
- Import: `POST /{entity}/import?dryRun=true|false&year={yyyy?}` → multipart form with `file`. When omitted, `year` defaults to the current calendar year (see Companies for details).
  - Contracts use `/contracts/export` and `/contracts/import`

Platform Admin (CoA Templates)
- Export Template CSV: `GET /admin/coa-templates/:id/export`
- Import Template CSV: `POST /admin/coa-templates/:id/import?dryRun=true|false`
  - Preflight (dryRun=true) validates header + rows and returns a standard report
  - Commit (dryRun=false) persists the CSV as the template’s `csv_payload`
  - Response shape aligns with other importers: `{ ok, dryRun, total, inserted, updated, processed?, errors[] }`

## Entity Layouts

### Companies
- Headers: core company data plus three year-specific metric groups. Format: `name;country_iso;city;postal_code;address;reg_number;vat_number;base_currency;status;disabled_at;headcount_{Y-1};it_users_{Y-1};turnover_{Y-1};headcount_{Y};it_users_{Y};turnover_{Y};headcount_{Y+1};it_users_{Y+1};turnover_{Y+1}`. The base year `Y` defaults to the current calendar year and can be overridden with the `year` query parameter (e.g. `year=2025` yields `headcount_2024`/`2025`/`2026`).
- Unique key: `name`
- Validation: `country_iso` (2 letters, required), `base_currency` (3 letters, required). Other fields are optional and normalised to `NULL` when blank.
- Metrics: all metric columns are optional; populate them when you want to upsert headcount/IT users/turnover. If you provide any metric for a given year, `headcount_{year}` must be a non-negative integer. `it_users_{year}` accepts non-negative integers; `turnover_{year}` accepts non-negative numbers with up to three decimals. Leaving all three columns blank skips updates for that year.
- Export file naming: the server includes the base year in the filename (e.g. `companies_2025.csv`, `companies_template_2025.csv`) to make it clear which metric columns are present.

### Departments
- Headers: `company_name;name;description;status;disabled_at`
- Unique key: `company_id + name` (resolved from `company_name`); enforced at the database level (case‑insensitive).
- References: `company_name` must match an existing Company by `name`

### Suppliers
- Headers: `name;erp_supplier_id;commercial_contact;technical_contact;support_contact;notes;status;disabled_at`
- Unique key: `name`
- Contacts linking: `commercial_contact`, `technical_contact`, and `support_contact` accept a single email address each. On import, the system links the supplier to an existing contact by email (or creates a new contact with that email if none exists). Only one email per column is supported.

### Accounts
- Headers: `account_number;account_name;description;consolidation_account_number;consolidation_account_name;consolidation_account_description;status;disabled_at`
- Unique key: `account_number` (integer)
 - Platform Admin standard accounts use the same headers (without `coa_code`) and are stored per template.

### OPEX (Spend Items)
- Headers: `product_name;description;supplier_name;company_name;account_number;currency;effective_start;status;disabled_at;owner_it_email;owner_business_email;analytics_category;notes;y_minus1_budget;y_minus1_landing;y_budget;y_follow_up;y_landing;y_revision;y_plus1_budget;y_plus1_revision`
- Unique key: composite `(product_name, supplier_id)` resolved from `supplier_name` (case-insensitive)
- References:
  - `supplier_name` → Suppliers by `name`
  - `account_number` → Accounts by `account_number`
  - `owner_*_email` → Users by `email` (optional; ignored if not found during dry-run)
  - `analytics_category` → Analytics Categories by `name` (auto-created when missing during commit)
- Import behavior: existing spend items are left untouched; the importer only inserts brand-new combinations. Use the UI for updates.
- Yearly totals: spread flat over the twelve months. Each planning column written (`planned`, `committed`, `expected_landing`) gets a whole-year round input with `method: spread` and `last_calculation.source: item_csv`. A blank cell leaves the column and its round input untouched; `0` clears the year. Actuals never get a round input.
- Monthly amounts and periods go through the budget rows file below.

### Spend Items Summary (Reporting feed)
- Not a CSV import; derived in-app via `/spend-items/summary` and cached client-side.
- Drives reporting views: `Top OPEX`, `Top OPEX Increase/Decrease`, `Budget comparison`, `Budget by consolidation account`, `Budget by analytics category`.
- Fields include yearly metric totals (`budget`, `landing`, `follow_up`, `revision`) for Y-1, Y, Y+1 plus account/analytics metadata needed for grouping.

### Users
- Headers: `email;first_name;last_name;role;company_name;department_name;status`
- Unique key: `email`
- References:
  - `role`: resolved by `role_name` (creates role if missing with a default description)
  - `company_name`: resolved by Company `name` (optional). If omitted, `department_name` must be omitted as well.
  - `department_name`: resolved by `(company_id, name)`. Requires a valid `company_name`.
- Defaults & Notes:
  - If `role` is empty, the role defaults to `Contact`.
  - If `status` is empty, status defaults to `contact`.
  - Imports do not set passwords; newly created users will have no password until set via UI or a reset flow.
- Importing Users creates/updates directory contacts by default; enabling access is done in the UI and consumes seats.

### Contacts
- Headers: `first_name;last_name;job_title;email;phone;mobile;country;notes;active`
- Unique key: `email` (per tenant; case-insensitive)
- Validation:
  - `email`: required, normalized to lowercase
  - `country`: optional 2-letter ISO code
  - `active`: `true|false|1|0|yes|no`
- Notes:
  - Import/export is available to admins only
  - Supplier linking is managed in the UI, not via CSV

### CAPEX Items
- Headers: `item_number;description;ppe_type;investment_type;priority;currency;effective_start;status;disabled_at;notes;company_name;owner_it_email;owner_business_email;analytics_category;y_minus1_budget;y_minus1_landing;y_budget;y_follow_up;y_landing;y_revision;y_plus1_budget;y_plus1_revision;y_plus2_budget`
- Unique key: `description`
- Validation:
  - `ppe_type`: `hardware|software` (case-insensitive)
  - `investment_type`: `replacement|capacity|productivity|security|conformity|business_growth|other` (case-insensitive)
  - `priority`: `mandatory|high|medium|low` (case-insensitive)
  - `currency`: 3-letter ISO code
  - `effective_start`: defaults to `Y-01-01` if omitted
- Budgets:
  - Annual totals are spread equally across 12 months
  - Y-1 Landing and Y Landing map to `expected_landing`
  - Y Follow-up maps to `actual`; Y Revision maps to `committed`
  - Creating budgets populates or creates versions for Y-1, Y, Y+1 with `input_grain=annual`
  - Each planning column written gets a whole-year round input (`method: spread`, `last_calculation.source: item_csv`); a blank cell leaves it untouched; Actuals never get one

### Budget rows (OPEX and CAPEX monthly amounts)
- One tenant-wide file for both item types, reached from Budget Administration ("Budget rows file").
- Endpoints: `GET /budget-rows/export?scope=template|data&year={yyyy?}` (read access to OPEX or CAPEX; only readable item types are exported) and `POST /budget-rows/import?dryRun=true|false` (admin on OPEX or CAPEX; `dryRun` defaults to true).
- Headers, exact order: `item_type;item_number;year;measure;period_start;period_end;jan;feb;mar;apr;may;jun;jul;aug;sep;oct;nov;dec;method`. Every column except `method` is required on import; unknown columns are a header error.
- File name: `budget_rows.csv`; `budget_rows_partial.csv` when the user reads only one item type; `budget_rows_<year>_partial.csv` when `year` is given.
- Export: for every item of each readable type (all statuses) and every version with at least one stored month, five rows in the order `planned`, `committed`, `forecast`, `actual`, `expected_landing`, sorted by item type (OPEX first), item number, year. `period_start` / `period_end` come from the stored round input, else the whole year; blank on `actual`. Amounts use a dot decimal separator. `method` is `spread`, `copied` or `manual`, blank without a round input or on `actual`.
- Import values: `item_type` case-insensitive; `item_number` as the integer or the ref (`OPX-7`, `CPX-7`) matching `item_type`; `measure` also accepts `budget`, `revision`, `follow_up`, `landing`; both period cells blank = whole year, one blank = row error, ignored on `actual`; all twelve months required (`0` for an empty month), comma decimals and spaces accepted; `method` ignored.
- Validation before any write: duplicate `(item_type, item_number, year, measure)`, unknown item, or an item type the user does not administer are row errors. Any row error: `ok: false`, nothing written.
- Rows identical to what is stored (twelve months to the cent and, for planning columns, the period) are `unchanged`: no write and no freeze check, so re-importing an export that covers frozen years succeeds. A changed row on a frozen column is a row error.
- Writes: a missing version is created (`input_grain: monthly`); the twelve months are replaced; changed months mark the round input `manual` with the file's period (profile and last calculation kept); a period-only change updates the period and keeps the method; `actual` rows never create a round input.
- Report: `{ ok, dryRun, total, inserted, updated, unchanged, errors[] }`; `inserted` counts rows that create the item's year, `updated` rows that change months or the period. The shared import dialog shows `inserted` and `updated`, plus an "N rows unchanged" line whenever the report carries `unchanged` (the other importers never send it, so their dialogs are unchanged).
- Upload limit: 10 MB per file (the item CSVs keep the common limit). A year-limited export splits a larger budget into files that fit.

### Contracts
- Headers: `name;company_name;supplier_name;start_date;duration_months;auto_renewal;notice_period_months;yearly_amount_at_signature;currency;billing_frequency;status;owner_email;notes`
- Unique key: composite `name + supplier_name`
- References:
  - `company_name` → Companies by `name` (required)
  - `supplier_name` → Suppliers by `name` (required)
  - `owner_email` → Users by `email` (optional)
- Validation:
  - `currency`: 3-letter code
  - `billing_frequency`: `monthly|quarterly|annual|other`
  - `start_date`: ISO `YYYY-MM-DD`
- Notes:
  - OPEX links are not part of CSV v1; manage links in the UI
  - Attachments are not part of CSV; upload via UI

### Applications (Apps & Services)
- Headers: `id;name;description;category;supplier_name;editor;criticality;lifecycle;is_suite;version;go_live_date;end_of_support_date;retired_date;licensing;notes;access_methods;external_facing;etl_enabled;support_notes;data_class;last_dr_test;contains_pii;status;business_owner_email_1;business_owner_email_2;business_owner_email_3;business_owner_email_4;it_owner_email_1;it_owner_email_2;it_owner_email_3;it_owner_email_4`
- Unique key: `name` (case-insensitive)
- References:
  - `supplier_name` → Suppliers by `name` (optional)
  - `business_owner_email_*` / `it_owner_email_*` → Users by `email` (optional; up to 4 each)
- Settings-backed fields (accept both codes and labels from IT Landscape Settings):
  - `category`: e.g., `line_of_business`, `productivity`, `security`
  - `lifecycle`: e.g., `active`, `proposed`, `deprecated`, `retired`
  - `data_class`: e.g., `public`, `internal`, `confidential`, `restricted`
  - `access_methods`: comma-separated, e.g., `web,mobile,vdi`. Default codes: `web`, `local`, `mobile`, `hmi`, `terminal`, `vdi`, `kiosk`. Tenants can configure custom access methods in IT Ops Settings.
- Fixed enums:
  - `criticality`: `business_critical`, `high`, `medium`, `low` (also accepts labels like "Business Critical")
  - `status`: `enabled`, `disabled`
- Export-only fields (not in import template):
  - `data_residency`: comma-separated ISO country codes
  - `users_mode`, `users_year`, `users_override`: audience/user count fields
  - `created_at`, `updated_at`: timestamps
- Export presets:
  - **Data Enrichment**: All importable fields (for round-trip editing)
  - **Full Export**: All exportable fields including computed/read-only fields
- Import modes:
  - **Enrich** (default): Empty cells preserve existing values
  - **Replace**: Empty cells clear existing values
- Import operations:
  - **Upsert** (default): Create or update
  - **Update only**: Skip new applications
  - **Insert only**: Skip existing applications

## UI Usage
- Each page (Companies, Departments, Suppliers, Accounts, Users) has Import and Export actions.
- Export dialog offers:
  - Export template → headers only
  - Export data → current records
- Import dialog supports:
  - Drag-and-drop or file picker (`.csv`)
  - Preflight check (dry-run) → shows totals and errors
  - Load (commit) → runs only after a successful preflight

## Samples
- See `doc/samples/` for starter CSVs that match the headers. For Users, see `doc/samples/users.csv`.

## Notes & Limitations
- Relationship lookups are case-sensitive by exact name (normalized by service where applicable); ensure consistent spelling.
- Department resolution requires company context to avoid ambiguity.
- Status values outside `enabled|disabled` are rejected.
- Most entities upsert rows based on their unique keys; the OPEX importer currently only creates new rows and never overwrites existing data. The budget rows file is the way to update amounts of existing items in bulk.
