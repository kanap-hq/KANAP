# CSV Import/Export

Purpose: Describe how CSV import/export works across entities, including headers, validation, preflight vs commit, and known constraints.
Audience: Product, Engineering, QA
Status: living
Owner: Eng

## Two layers

- **Shared sheet layer** (`backend/src/common/csv-sheet/`): reading and writing for the budget file and the master-data files. Decoding, separator detection, header normalization, date and amount conventions, physical line numbers, the row cap. Callers: `spend/budget-file/`, `companies`, `departments`, `users`, `suppliers`, `accounts`, `cost-centers`, `analytics` (values), `working-day-profiles`, `contacts`, `contracts`, `business-processes`. Contacts, contracts and business processes keep the import in their own service and call this layer to read and write the file.
- **V2 engine** (`backend/src/common/csv/`): applications, assets, incidents, portfolio projects, portfolio requests, tasks. Its own configs, resolver and import workflow.
- **Their own code**: the CoA templates (`admin/coa-templates`). The file keeps a fixed semicolon. Decoding of an upload goes through `readImportText`.

The rest of this page describes the shared sheet layer first, then the budget file, then one line per entity.

## Shared sheet layer

### Encoding and separator

- Export: UTF-8 with BOM. Import: UTF-8 with or without BOM, else Windows-1252 (Excel "CSV" on Windows), accents included.
- The separator is detected on the header line: `,`, `;` or a tab. An export writes the screen language's separator: `,` in English, `;` in French, German and Spanish.
- The decimal mark and the date form follow the screen language on export: English `12280.50` and `2027-03-01`; French and Spanish `12280,50` and `01/03/2027`; German `12280,50` and `01.03.2027`.
- The formula-injection guard is applied once by the writer; the reader undoes it.

### Headers

- Read at any position; case, spaces, underscores and hyphens are ignored.
- **Budget files**: unknown columns are ignored and listed in `ignoredColumns`. A header that looks like an amount column and does not parse (a year-like or month-like tail, or a stem one letter from a column name: `budget_27`, `budjet_2027`, `actual_2026_13`) is a header error. An `analytics:<code>` column naming no dimension is a header error.
- **Master-data files**: strict. A missing column and an unknown one both refuse the file with a `row: 0` error `Header mismatch. Missing: X, Extra: Y` that names only the parts that apply (`headerMismatchError` in `common/csv-sheet/master-data.ts`). It carries a `code` (`CSV_HEADER_MISSING_COLUMNS`, `CSV_HEADER_UNKNOWN_COLUMNS` or `CSV_HEADER_MISMATCH`) and `params: { missing, extra }`, which `CsvImportDialog` translates from `errors.json` and shows on a **Header** line. `ignoredColumns` is therefore always empty for them.

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
- Contracts, contacts and the V2 entities keep their own lifecycle columns. The contracts file has no end-of-validity column (see [Contracts](#contracts)).

## Workflow

1. Export a file (or download the template from the import dialog).
2. Fill it in.
3. Preflight check (`dryRun=true` on master data; `POST …/budget-file/preflight`): reads, validates, writes nothing.
4. Load (`dryRun=false`; `POST …/budget-file/import`): one transaction, all or nothing.

## Budget file (OPEX and CAPEX)

One file for both natures since lot C1b: a `nature` column says whether a row is an OPEX or a CAPEX line, and every check of a row follows that nature. The OPEX list exports its OPEX lines, the CAPEX list its CAPEX lines, in the same layout; either list imports a file of both. Manual: `doc/help/docs/en/budget-file.md`.

- **Routes**: `GET /spend-items/budget-file/export`, `POST /spend-items/budget-file/preflight`, `POST /spend-items/budget-file/import`, and the same under `/capex-items`. `budget:admin` on either route, which covers the lines of both natures (lot R): a file of both loads from either list. The route gives the nature of a row of a file without a `nature` column.
- **Layout**: one row per line. Detail columns (`backend/src/spend/budget-file/columns.ts`, `detailColumns`), then the amount columns, then `kanap_token` last: `nature, item_number, name, description, company_name, supplier_name, supplier_erp_id, account_number, cost_center_code, run_build, analytics:<code>…, owner_it_email, owner_business_email, project, currency, effective_start, end_of_validity, notes`, the same for both natures. `name` is the line's `product_name`, `description` an OPEX line's description; on a CAPEX line `description` is neither read nor written until lot U (the export leaves it empty, a filled cell is a warning in `warnings.ignoredCells`). One `analytics:<code>` column per enabled dimension, the default one included, whatever lines it is for; the PP&E type, investment type and priority of a CAPEX line are `analytics:ppe_type`, `analytics:investment_type` and `analytics:priority` (lot C1). A file with the three columns `ppe_type`, `investment_type` and `priority` together (a CAPEX file exported before lot C1) is refused as a whole with an explanation; one or two of them alone are ignored with a warning, like any unknown column.
- **Nature**: `opex` or `capex` (any case). Required on a new line when the column is there; blank on an existing line keeps its nature; `-` is a row error. A row naming an existing line with the other nature is a row error ("BL-125 is a CAPEX line, not an OPEX line. A file does not change the type of a line."): the type changes from the line (lot M). A file without the column (an export of before lot C1b) is read as lines of the route's nature.
- **Per row, by its nature**: the dimensions a row may fill (a value or `-` on a dimension of the other nature is a row error, `notApplicableDimensionMessage`) and the required ones, the account's "Used for", restricted values, the frozen columns (`freeze_states` of the row's nature), the duplicate hint (OPEX name and supplier, CAPEX name, among the lines of the same nature).
- **Amount columns**: `<column>_<year>` for a yearly total, `<column>_<year>_<mm>` for one month, `<column>` being `budget`, `revision`, `forecast`, `actual` or `landing` (storage keys `planned`, `committed`, `expected_landing` and the old `follow_up` are read as synonyms). A yearly header and a monthly header for the same column and year in one file is a header error.
- **Cell rules**: empty keeps the stored value; `-` clears a line detail (never an amount); `0` sets an amount to zero; an amount has at most two decimals; an absent column keeps every stored value of that column.
- **Matching**: `item_number` filled updates that line, empty creates one. `BL-12` names the line's own number (`item_number`, unique per tenant) on both routes, and so does a bare `12` in a file with a `nature` column; in a file without it (a file of before lot C1b) a bare number keeps its former meaning, `CPX-12` on the CAPEX route and the OPEX line's number on the OPEX route. `OPX-12` and `CPX-3` name the line by `legacy_number`, an `OPX` number also an OPEX line's own number. An unknown number is a row error ("does not match a line", or "is no longer available since the export" with a token: the line was deleted, or is out of the person's data access). The `kanap_token` carries no line identity (`v<row_version>.<year>r<budget_rev>`), so it cannot tell that a number names another line than the one exported. One line named twice is a row error. Likely duplicates are warnings, never blocking.
- **Suppliers**: matched by `supplier_erp_id`, else by `supplier_name` (exact, then case-insensitive). `createSuppliers=true` creates a missing supplier with its name and ERP id inside the load transaction; the preflight lists what it would create. Without it, a missing supplier is a row error naming Master data > Suppliers. Accounts, cost centers, companies and users are never created.
- **Dimension values**: a value that does not exist is created by the load and listed in the preflight (`creates.dimensionValues`).
- **Lines and amounts write through the item services**, the service of each line's nature, its fields named as the columns (`fields: 'columns'`: `product_name`, `description`, not the CAPEX alias's names), so validation, the chart-of-accounts check, the supplier contact copy and the audit (labels by nature) are the workspace's. A new line takes the next BL number; a new CAPEX line also its CPX number. A yearly total equal to the stored sum of the twelve months writes nothing; a different one is spread over the column's period, as in the budget tab. A changed month marks the column `manual`, keeping its lines. A changed cell in a frozen column is a row error.
- **Freshness**: `kanap_token` = `v<row_version>.<year>r<budget_rev>…` plus an optional language suffix (`.en`, `.fr`, `.de`, `.es`), letter first so spreadsheets keep it as text. A malformed token on an existing line is a row error; a blank token means no freshness check. The preflight reports the lines changed in KANAP since the export, with who and when.
- **Text cells**: the reader trims a cell; the preflight trims the stored text the same way before comparing, so a note stored with a final line break reads unchanged.
- **Preflight**: read-only, no lock. Report (`BudgetFileReport`): `fileErrors`, `headerErrors`, `errors[]` (line, column, message, up to 100), `errorCount`, `missing[]` (references summed up with where to fix them), `deleted[]`, `changes` (created, updated, unchanged, with the first entries), `changedSinceExport[]`, `warnings` (duplicates, ignored columns, supplier name differing from the ERP id match), `creates` (dimension values, suppliers), `supplierMessage`, `encoding`, `separator`, `notices`, and `snapshot` (the line versions it read).
- **Load**: multipart `file` plus `snapshot` (the preflight's JSON). One transaction under the per-tenant bulk lock shared with copy, clear and allocation copy: a second bulk operation answers 409 `operation_running`. Lines are locked in id order, nature by nature; if any target line changed since the preflight, the whole load is refused with 409 "Some lines changed since the preflight. Run the preflight again." New line numbers come from one counter update. The route runs `ANALYZE` after more than 1,000 rows.
- **Export**: `GET …/budget-file/export` with `language`, `amountYears` (for example `2026,2027`, at most twelve), `columns` (comma list of the five), `detail` (`yearly` or `months`), `all` (`true` exports every line, ended lines included, without the list's filters) and `format` (`csv`, the default, or `xlsx`: one sheet `budget`, amounts as numbers, days as dates). The other query parameters are the list's own (sort, search, filters, status, `ctx` for a long filter state), and the file follows the list's order. Empty cells where nothing is stored, and on a dimension of the other nature than the line's; zero lines still write the header, which is the template. The lines of the route's nature, `item_number` as `BL-n`. File name `budget.csv` on both routes. The export's audit row (`table_name = 'export'`) gets `format`, the type of the file sent (`csv` or `xlsx`), and `rows`, the number of lines written.
- **Refusals**: `language` must be `en|fr|de|es`; `dateOrder` `day-first|month-first`; `decimalMark` `comma|dot`; `detail` `yearly|months`; `columns` at least one of the five; `amountYears` a list of years within ten years of the current one. A rejected row keeps its line number; `-` on an amount column, a third decimal and an oversized amount are row errors with their own sentences.
- **Old layouts**: refused as a whole with one `fileErrors` entry. `isOldBudgetLayout` recognizes the old OPEX and CAPEX item headers (`y_budget`, `y_minus1_budget`…, `product_name`, `analytics_category`, `effective_end`, `disabled_at`, `item_type`) and the budget rows layout (`measure` + `jan`). The message: "This file comes from an earlier version of KANAP. Export a fresh file from this list, copy your changes into it, and import it again."
- **Upload cap**: 48 MB (`BUDGET_FILE_MAX_BYTES`); over it, a 413 with the plain message, then the 20,000-row cap of the shared layer.

## Master data (shared layer)

Every importer reads through `readMasterDataFile` (`common/csv-sheet/master-data.ts`) and writes through `writeCsv`. Routes take `language` on export and `language`, `dateOrder`, `decimalMark` on import; they answer `notices` (`{ dates, amounts }`) and `ignoredColumns` beside their own report. A header problem is a `row: 0` entry with the importer's own sentence; every other refusal (encoding, empty file, row cap, unclosed quote) is a 400.

- **Companies**: `name, country_iso, address1, address2, postal_code, city, state, reg_number, vat_number, base_currency, status, disabled_at, notes, headcount_<Y>, it_users_<Y>, turnover_<Y>` for the year before, the year and the year after the selected year. Unique key `name`. `turnover_` goes through the shared amount reader; `headcount_` and `it_users_` are integers.
- **Departments**: `company_name, name, description, status, disabled_at`. Unique key `company_id + name`.
- **Suppliers**: `name, erp_supplier_id, commercial_contact, technical_contact, support_contact, notes, status`. Unique key `name`. The three contact columns accept one email each; the importer links an existing contact or creates one.
- **Users**: `email, first_name, last_name, role, company_name, department_name, status` (`contact|invited|enabled|disabled`, blank means `contact`). Unique key `email`. A role the tenant does not have is created by the **load**, never by the check: a check answers `rolesToCreate` and writes nothing.
- **Accounts**: `account_number, account_name, native_name, description, consolidation_account_number, consolidation_account_name, consolidation_account_description, status`, plus `coa_code` on the global route. Unique key `account_number` within a chart; the global file must carry one uniform `coa_code`. Number columns are whole numbers from 1 to 15 digits (`readAccountNumber`, `accounts/account-number.ts`): a longer one is a row error (`CSV_ACCOUNT_NUMBER_TOO_LONG`), leading zeros a row warning in `warnings[]` (`CSV_ACCOUNT_NUMBER_LEADING_ZEROS`), which the import dialog shows after the check.
- **Cost centers**: `code, kind, name, parent_code, company_name, owner_email, description, status, disabled_at` (`disabled_at` optional). Rows in any order; the whole resulting tree is validated before anything is written.
- **Analytics values**: `axis_code, name, description, status, disabled_at` (all optional but `name`). `axis_code` empty means the default dimension.
- **Working-day calendars**: `code, name, description, country, region, status, disabled_at, year, jan…dec`; one row per calendar and year. `disabled_at`, `country` and `region` are optional columns.
- **Technology links** (`technologies/technology-links-csv.service.ts`), an example of a file of links where one row is one link: `asset_reference, asset_name, technology_reference, technology_name, version, operating_system, notes, source` (servers) and `application_reference, application_name, technology_reference, technology_name, version, notes, source` (applications). No upsert key of its own: a row matches its subjects by reference or name, adds or updates a link through the services of the single links, and never deletes one. An existing link keeps its provenance. `source` is optional and ignored on import.
  A large file takes time: the import writes link by link, through those services, in one transaction (about 15 seconds for 20,000 new links on a local database, more on a server). Until it commits, it holds the lock of every technology of the file and of every server it marks, so a link edit on those technologies waits and may time out. Prefer several smaller files for a very large load.

## Contracts

Imported and exported by `backend/src/contracts/contracts.service.ts` (`importCsv`, `exportCsv`), with its own matching and validation. The file itself is the shared sheet layer: `readMasterDataFile` on import, `writeCsv` on export (`writeListExport` in `common/csv/list-export`). UTF-8 with BOM on export. UTF-8 with or without BOM, or Windows-1252, on import. The export separator is `,` in English and `;` in French, German and Spanish. The import detects `,`, `;` or a tab on the header line. Dates and amounts follow the shared rules above, with the `dateOrder` and `decimalMark` switches and their notices. An `.xlsx` workbook uses the same columns (the first sheet). Routes: `GET /contracts/export` (`scope` `template` or `data`, `language`, `format` `csv` or `xlsx`) and `POST /contracts/import` (`dryRun`, default true, `language`, `dateOrder`, `decimalMark`). The contracts list uses the shared import and export dialogs. A file that has a row error writes nothing.

- **Headers**: `name, company_name, supplier_name, cost_center, start_date, duration_months, auto_renewal, notice_period_months, yearly_amount_at_signature, currency, billing_frequency, status, owner_email, notes`. Same header rules as the other master-data files. `cost_center` is optional: a file without that column keeps each contract's stored cost center. Any other missing column, and any unknown column, refuses the file with a `row: 0` header mismatch.
- **Match**: `name` + `supplier_name`. The supplier is resolved by exact name, then the contract by that supplier and the exact name. A repeated pair keeps the first row and drops the later ones. `Foo` and `foo` with the same supplier count as one pair for that drop. The stored name stays the exact text of the row that is kept.
- **References**:
  - `company_name` → companies by exact `name` (required)
  - `supplier_name` → suppliers by exact `name` (required)
  - `cost_center` → an enabled cost center or group, by exact `name`. A filled cell sets it. A blank cell on an update clears a stored one, and a new contract stays without one. An unknown name is a row error (`CSV_REFERENCE_NOT_FOUND`).
  - `owner_email` → users by `email`, ignoring case (optional). A blank cell clears the owner.
- **`start_date`** (required): `YYYY-MM-DD`, an ISO timestamp (the UTC day is stored), or a local form (`31/12/2027`, `31.12.2027`, `31-12-2027`, `12/31/2027`), with the shared day-or-month order. The export writes the screen language's form: `2027-12-31` in English, `31/12/2027` in French and Spanish, `31.12.2027` in German. A blank cell and `-` are refused (`CSV_VALUE_REQUIRED`). An unreadable date is a row error (`CSV_DATE_INVALID`).
- **`auto_renewal`**: yes or no in the four languages (`yes`/`no`, `oui`/`non`, `ja`/`nein`, `sí`/`no`). The same reader also accepts `true`/`false`, `1`/`0`, the adjective forms (`vrai`/`faux`, `wahr`/`falsch`, `verdadero`/`falso`, Spanish without the accent) and the short forms `y`/`n`, `on`/`off`, `t`/`f`, in any case. A blank cell is no. Anything else is a row error (`CSV_BOOLEAN_INVALID`). The export writes the screen language's yes or no.
- **`yearly_amount_at_signature`**: the shared amount rules. A comma or a dot is the decimal mark. Spaces and non-breaking spaces group thousands. When both marks appear, the last one is the decimal mark and the other must group by three. A single mark followed by exactly three digits (`12,280`, `12.280`) is settled by another amount cell, then by `decimalMark`, then by the screen language. Both conventions in the column are a file error. A blank cell is 0. `-` and an unreadable amount are row errors (`CSV_NUMBER_INVALID`). The reader accepts up to 20 digits after the decimal mark. The column is `numeric(18, 2)`: the database stores the value on two decimals. The export writes the amount with the screen language's decimal mark.
- **Months, currency, billing, status**: a blank `duration_months` is 12 and a blank `notice_period_months` is 1. Any other cell must be a whole number from 0 to 2147483647, or it is a row error (`CSV_NUMBER_INVALID`). A blank `currency` is `EUR`. The value is uppercased and must be three letters (`CSV_CURRENCY_INVALID` otherwise). `billing_frequency` is `monthly`, `quarterly`, `annual` or `other`, matched as written (a blank cell is `annual`). `status` is `enabled` or `disabled`, in any case. Any other text is read as `enabled`. A blank `status` means `enabled` on a new contract and leaves the stored status on an update.
- **End of validity**: absent from the file. The export writes `status` from the stored end of validity, so a date that has passed exports as `disabled` while the stored status column can still say `enabled`. On an update, a blank `status`, or one equal to the status read from that end, keeps the stored end. `enabled` clears it. `disabled` sets the end to now, and keeps an end that has already passed. A new contract is enabled unless the row says `disabled`.
- **Tacit renewal**: a row that turns `auto_renewal` off on a contract already renewed, while that contract has no end of validity, is refused, dry run included. The contract page sets the end in the same action.
- **Left out of the file**: links to budget lines, and attachments. Both stay on the contract page.

A row identical to the stored contract counts as unchanged and is not written: company, cost center when the column is present, owner, start date, duration, renewal, notice, amount, currency, billing, notes, and a status that leaves the end of validity as it is.

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

## UI usage

- The budget lists (OPEX, CAPEX) have **Import CSV** and **Export CSV** in the toolbar, opening the budget file dialogs. Choosing a file runs the check at once; **Load** sends the checked snapshot.
- The master-data pages, the contracts page and the CoA page use the shared dialogs: **Export CSV** opens a dialog with **Export data**; **Import CSV** opens a dialog with **Download template**, **Preflight check** and **Load**, and shows the date and amount notices with their switch.
- The V2 entities keep their own dialogs (presets, field selection, import modes).

## Samples

`doc/samples/` holds one consistent set, in the order the manual loads it: `companies.csv`, `departments.csv`, `suppliers.csv`, `accounts.csv`, `cost-centers.csv`, `users.csv`, then `budget.csv` (OPEX and CAPEX lines). English conventions, a fictional company, and every file matching its importer's headers.

## Notes & limitations

- Relationship lookups are case-sensitive by exact name (normalized by service where applicable); ensure consistent spelling.
- Department resolution requires company context to avoid ambiguity.
- Status values outside the entity's own list are rejected. On the contracts file, `disabled` disables the contract and every other text is read as `enabled`.
- Master-data files upsert on their unique keys and **refuse unknown columns**; the budget file ignores them with a warning and updates by `item_number`.
- Master-data files carry no record of the language they were exported in, so an all-ambiguous French file read on an English screen needs the date switch. The budget file records its language in `kanap_token` and never stops on a question after its own export.
