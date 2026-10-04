# CSV Import/Export

Purpose: Describe how CSV import/export works across entities, including headers, validation, preflight vs commit, and known constraints.
Audience: Product, Engineering, QA
Status: living
Owner: Eng

## Two layers

- **Shared sheet layer** (`backend/src/common/csv-sheet/`): reading and writing for the budget files and the master-data files. Decoding, separator detection, header normalization, date and amount conventions, physical line numbers, the row cap. Callers: `spend/budget-file/`, `companies`, `departments`, `users`, `suppliers`, `accounts`, `cost-centers`, `analytics` (values), `working-day-profiles`.
- **V2 engine** (`backend/src/common/csv/`): applications, assets, incidents, portfolio projects, portfolio requests, tasks. Its own configs, resolver and import workflow.
- **Their own code**: contracts, contacts, business processes and the CoA templates. They use neither layer.

The rest of this page describes the shared sheet layer first, then the budget files, then one line per entity.

## Shared sheet layer

### Encoding and separator

- Export: UTF-8 with BOM. Import: UTF-8 with or without BOM, else Windows-1252 (Excel "CSV" on Windows), accents included.
- The separator is detected on the header line: `,`, `;` or a tab. An export writes the screen language's separator: `,` in English, `;` in French, German and Spanish.
- The decimal mark and the date form follow the screen language on export: English `12280.50` and `2027-03-01`; French and Spanish `12280,50` and `01/03/2027`; German `12280,50` and `01.03.2027`.
- The formula-injection guard is applied once by the writer; the reader undoes it.

### Headers

- Read at any position; case, spaces, underscores and hyphens are ignored.
- **Budget files**: unknown columns are ignored and listed in `ignoredColumns`. A header that looks like an amount column and does not parse (a year-like or month-like tail, or a stem one letter from a column name: `budget_27`, `budjet_2027`, `actual_2026_13`) is a header error. An `analytics:<code>` column naming no dimension is a header error.
- **Master-data files**: strict. A missing column and an unknown one both refuse the file with `Header mismatch. Missing: X, Extra: Y`. `ignoredColumns` is therefore always empty for them.

### Dates

- Accepted: `YYYY-MM-DD`, an ISO timestamp, or a local form with a four-digit year and `/`, `.` or `-` between the parts (`31/12/2027`, `31.12.2027`, `31-12-2027`, `12/31/2027`, an optional `00:00` time).
- Day first or month first is settled by the file when a part is above 12. Otherwise the `dateOrder` switch, then the language recorded in the export (`kanap_token`), then the screen language (day first in French, German and Spanish; month first in English).
- The reading is never silent: `dates.notice` carries "Dates read day first: 01/03/2027 is March 1." and the client offers the switch. A switch that contradicts the file is a file error.
- A bare day is stored at noon UTC; a full timestamp is kept as given. `-` clears where the caller allows it (master data); an amount column refuses it.

### Amounts

- Comma or dot decimal; spaces and non-breaking spaces as thousands separators. When both `.` and `,` appear, the last one is the decimal separator and the other must group by three, else a row error.
- A single mark followed by exactly three digits (`12,280`, `12.280`) is ambiguous: settled by the file when another amount cell shows the decimal mark, else by the `decimalMark` switch, then the export's recorded language, then the screen language (English: `,` thousands; French, German, Spanish: `.` thousands). `amounts.notice` states the reading, with a switch.
- Both conventions in one file is a file error. An amount with more than two decimals is a row error, never rounded silently.

### Lines, size and errors

- Every error names the physical line of the file, as a text editor shows it. A blank line is skipped and still consumes its line.
- Row cap: 20,000 per file (`CSV_ROW_CAP`), streaming parse. A file over the cap is a 400.
- A file that cannot be read at all (bad encoding, empty file, a quoted cell left open, over the cap) is a 400 with the shared layer's message.
- Codes: exact match first; a digits-only code with no exact match matches a unique stored code equal to it once leading zeros are stripped.

## Lifecycle (`disabled_at`)

- Master data (companies, departments, cost centers, analytics values, calendars): `disabled_at` is the end of validity, a date or a full timestamp. `status` is derived from it at save time. A row whose status contradicts its date is refused.
- Budget files have no status column: `end_of_validity` is the line's only end date. A past date means the line is disabled, and the hourly lifecycle sync writes the status.
- Contracts, contacts and the V2 entities keep their own lifecycle columns.

## Workflow

1. Export a file (or download the template from the import dialog).
2. Fill it in.
3. Preflight check (`dryRun=true` on master data; `POST …/budget-file/preflight`): reads, validates, writes nothing.
4. Load (`dryRun=false`; `POST …/budget-file/import`): one transaction, all or nothing.

## Budget files (OPEX and CAPEX)

One file per list: the OPEX list exports and imports the OPEX file, the CAPEX list the CAPEX file. Same columns and rules in both. Manual: `doc/help/docs/en/budget-file.md`.

- **Routes**: `GET /spend-items/budget-file/export`, `POST /spend-items/budget-file/preflight`, `POST /spend-items/budget-file/import`, and the same under `/capex-items`. Administration on the list (`opex:admin` / `capex:admin`).
- **Layout**: one row per line. Detail columns (`backend/src/spend/budget-file/columns.ts`, `detailColumns`), then the amount columns, then `kanap_token` last. OPEX: `item_number, name, description, company_name, supplier_name, supplier_erp_id, account_number, cost_center_code, run_build, analytics:<code>…, owner_it_email, owner_business_email, project, currency, effective_start, end_of_validity, notes`. CAPEX: same, with `ppe_type, investment_type, priority` instead of `description`. One `analytics:<code>` column per enabled dimension, the default one included.
- **Amount columns**: `<column>_<year>` for a yearly total, `<column>_<year>_<mm>` for one month, `<column>` being `budget`, `revision`, `forecast`, `actual` or `landing` (storage keys `planned`, `committed`, `expected_landing` and the old `follow_up` are read as synonyms). A yearly header and a monthly header for the same column and year in one file is a header error.
- **Cell rules**: empty keeps the stored value; `-` clears a line detail (never an amount); `0` sets an amount to zero; an amount has at most two decimals; an absent column keeps every stored value of that column.
- **Matching**: `item_number` filled updates that line (`OPX-12` or `12`), empty creates one. A number of the other type, or an unknown one, is a row error. Likely duplicates are warnings, never blocking.
- **Suppliers**: matched by `supplier_erp_id`, else by `supplier_name` (exact, then case-insensitive). `createSuppliers=true` creates a missing supplier with its name and ERP id inside the load transaction; the preflight lists what it would create. Without it, a missing supplier is a row error naming Master data > Suppliers. Accounts, cost centers, companies and users are never created.
- **Dimension values**: a value that does not exist is created by the load and listed in the preflight (`creates.dimensionValues`).
- **Lines and amounts write through the item services**, so validation, the chart-of-accounts check, the supplier contact copy and the audit are the workspace's. A yearly total equal to the stored sum of the twelve months writes nothing; a different one is spread over the column's period, as in the budget tab. A changed month marks the column `manual`, keeping its lines. A changed cell in a frozen column is a row error.
- **Freshness**: `kanap_token` = `v<row_version>.<year>r<budget_rev>…` plus an optional language suffix (`.en`, `.fr`, `.de`, `.es`), letter first so spreadsheets keep it as text. A malformed token on an existing line is a row error; a blank token means no freshness check. The preflight reports the lines changed in KANAP since the export, with who and when.
- **Preflight**: read-only, no lock. Report (`BudgetFileReport`): `fileErrors`, `headerErrors`, `errors[]` (line, column, message, up to 100), `errorCount`, `missing[]` (references summed up with where to fix them), `deleted[]`, `changes` (created, updated, unchanged, with the first entries), `changedSinceExport[]`, `warnings` (duplicates, ignored columns, supplier name differing from the ERP id match), `creates` (dimension values, suppliers), `supplierMessage`, `encoding`, `separator`, `notices`, and `snapshot` (the line versions it read).
- **Load**: multipart `file` plus `snapshot` (the preflight's JSON). One transaction under the per-tenant bulk lock shared with copy, clear and allocation copy: a second bulk operation answers 409 `operation_running`. Lines are locked in id order; if any target line changed since the preflight, the whole load is refused with 409 "Some lines changed since the preflight. Run the preflight again." New line numbers come from one counter update. The route runs `ANALYZE` after more than 1,000 rows.
- **Export**: `GET …/budget-file/export` with `language`, `amountYears` (for example `2026,2027`, at most twelve), `columns` (comma list of the five), `detail` (`yearly` or `months`) and `all` (`true` exports every line, ended lines included, without the list's filters). The other query parameters are the list's own (sort, search, filters, status, `ctx` for a long filter state), and the file follows the list's order. Empty cells where nothing is stored; zero lines still write the header, which is the template. File names `opex.csv` / `capex.csv`.
- **Refusals**: `language` must be `en|fr|de|es`; `dateOrder` `day-first|month-first`; `decimalMark` `comma|dot`; `detail` `yearly|months`; `columns` at least one of the five; `amountYears` a list of years within ten years of the current one. A rejected row keeps its line number; `-` on an amount column, a third decimal and an oversized amount are row errors with their own sentences.
- **Old layouts**: refused as a whole with one `fileErrors` entry. `isOldBudgetLayout` recognizes the old OPEX and CAPEX item headers (`y_budget`, `y_minus1_budget`…, `product_name`, `analytics_category`, `effective_end`, `disabled_at`, `item_type`) and the budget rows layout (`measure` + `jan`). The message: "This file comes from an earlier version of KANAP. Export a fresh file from this list, copy your changes into it, and import it again."
- **Upload cap**: 48 MB (`BUDGET_FILE_MAX_BYTES`); over it, a 413 with the plain message, then the 20,000-row cap of the shared layer.

## Master data (shared layer)

Every importer reads through `readMasterDataFile` (`common/csv-sheet/master-data.ts`) and writes through `writeCsv`. Routes take `language` on export and `language`, `dateOrder`, `decimalMark` on import; they answer `notices` (`{ dates, amounts }`) and `ignoredColumns` beside their own report. A header problem is a `row: 0` entry with the importer's own sentence; every other refusal (encoding, empty file, row cap, unclosed quote) is a 400.

- **Companies**: `name, country_iso, address1, address2, postal_code, city, state, reg_number, vat_number, base_currency, status, disabled_at, notes, headcount_<Y>, it_users_<Y>, turnover_<Y>` for the year before, the year and the year after the selected year. Unique key `name`. `turnover_` goes through the shared amount reader; `headcount_` and `it_users_` are integers.
- **Departments**: `company_name, name, description, status, disabled_at`. Unique key `company_id + name`.
- **Suppliers**: `name, erp_supplier_id, commercial_contact, technical_contact, support_contact, notes, status`. Unique key `name`. The three contact columns accept one email each; the importer links an existing contact or creates one.
- **Users**: `email, first_name, last_name, role, company_name, department_name, status` (`contact|invited|enabled|disabled`, blank means `contact`). Unique key `email`. A role the tenant does not have is created by the **load**, never by the check: a check answers `rolesToCreate` and writes nothing.
- **Accounts**: `account_number, account_name, native_name, description, consolidation_account_number, consolidation_account_name, consolidation_account_description, status`, plus `coa_code` on the global route. Unique key `account_number` within a chart; the global file must carry one uniform `coa_code`. Number columns are integers (`parseIntStrict`).
- **Cost centers**: `code, kind, name, parent_code, company_name, owner_email, description, status, disabled_at` (`disabled_at` optional). Rows in any order; the whole resulting tree is validated before anything is written.
- **Analytics values**: `axis_code, name, description, status, disabled_at` (all optional but `name`). `axis_code` empty means the default dimension.
- **Working-day calendars**: `code, name, description, country, region, status, disabled_at, year, jan…dec`; one row per calendar and year. `disabled_at`, `country` and `region` are optional columns.

## V2 engine entities

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

Assets, incidents, portfolio projects, portfolio requests and tasks follow the same engine and document their own headers in their pages.

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
  - This file keeps its own code (semicolon, UTF-8 with BOM) and is outside the shared sheet layer
  - OPEX links are not part of CSV v1; manage links in the UI
  - Attachments are not part of CSV; upload via UI

## UI usage

- The budget lists (OPEX, CAPEX) have **Import CSV** and **Export CSV** in the toolbar, opening the budget file dialogs. Choosing a file runs the check at once; **Load** sends the checked snapshot.
- The master-data pages and the CoA page use the shared dialogs: **Export CSV** opens a dialog with **Export data**; **Import CSV** opens a dialog with **Download template**, **Preflight check** and **Load**, and shows the date and amount notices with their switch.
- The V2 entities keep their own dialogs (presets, field selection, import modes).

## Samples

`doc/samples/` holds one consistent set, in the order the manual loads it: `companies.csv`, `departments.csv`, `suppliers.csv`, `accounts.csv`, `cost-centers.csv`, `users.csv`, then `opex.csv` and `capex.csv`. English conventions, a fictional company, and every file matching its importer's headers.

## Notes & limitations

- Relationship lookups are case-sensitive by exact name (normalized by service where applicable); ensure consistent spelling.
- Department resolution requires company context to avoid ambiguity.
- Status values outside the entity's own list are rejected.
- Master-data files upsert on their unique keys and **refuse unknown columns**; the budget file ignores them with a warning and updates by `item_number`.
- Master-data files carry no record of the language they were exported in, so an all-ambiguous French file read on an English screen needs the date switch. The budget file records its language in `kanap_token` and never stops on a question after its own export.
