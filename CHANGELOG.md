# Changelog

Every published version of KANAP, newest first. Versions are numbered `YY.M.N` (year, month,
number in the month: `26.10.1`, then `26.10.2`, then `26.11.1`), and each one has a Git tag of
the same name with a `v` in front (`v26.10.1`). The `stable` branch points to the latest
published version. The same entries are on the GitHub releases page.

Each entry starts with a level-two heading: the version and its date, for example
`26.11.1 (2026-11-03)`. The heading ends with `· Action required` when an existing installation
must do something before or after the upgrade. Below the heading, one or two lines say what the
version brings, followed by three lists:

- **Changes** and **Fixes**: what users see, with the number of the pull request.
- **On-premise**: the required actions (`Action required: ...`), the database migrations, which
  run automatically at start, and the recommended settings.

To upgrade across several versions, read every entry between your version and the target: the
actions add up. The release process is described in `doc/releasing.md`.

## 26.10.4 (2026-10-16)

A quality release: safer deletes, lists that filter, sort and export as shown, the interface in the user's language, and one common CSV format.

### Changes
- Deleting a record that is still in use is refused before the confirmation, with what uses it and what to do instead (for example disable it). This covers suppliers, companies, applications with interfaces, contracts with compliance requirements, incidents with regulatory records, and the other referential records. A list's delete names the records it keeps and deletes only the others. Deleting from a record page always asks for confirmation. (#598, #601, #605, #614, #629)
- Contracts can be deleted. Incident administrators can delete incidents. (#605, #629)
- Lists show a message when nothing matches, sort names ignoring case and accents, open the item from anywhere in the name cell, and export what they show (search, filters, sort) or the whole register on request. Every column filter a list offers now narrows it on the server. (#598, #606, #616)
- The interface, the user manual, the shipped catalogs and task types, dates, numbers, currencies and the audit log follow the user's language. Only the texts of the language in use are downloaded, which makes the first page load lighter. (#607, #610, #612, #613, #615, #617, #620, #622, #623, #625, #628)
- Supplier and company names are unique regardless of case; a name already in use is reported under the name field. An import that names an item in another case updates it and keeps its stored spelling. (#599, #608)
- CSV exports and imports share one format: yes/no, dates and decimals follow the file's language, the end of validity is exported as a date, and an unchanged file re-imports without changes. Incident date-times are written in the user's local time, with the zone in the header. (#600, #608, #630)
- Switching an item off disables it at once; a future end of validity shows "Active until". (#598, #608)

### Fixes
- The infrastructure connections on an interface map no longer fail with an error. (#609)
- Deleting a company no longer deletes its departments or clears it on users, sites and tasks. Deleting a supplier, a contact or a user no longer leaves links behind. (#601, #614, #618)
- Two forms no longer erase a future end of validity when "Active" is selected again. (#608)
- A website or sub-location description typed right after creating the row is saved. (#624, #629)
- Moving the highlight in a report's exclusion picker is faster on long lists. (#619)

### On-premise
- Action required: none
- Migrations: run automatically at start (1854070000000-contracts-reference-keys, 1854080000000-supplier-contacts-supplier-key, 1854090000000-company-reference-keys, 1854100000000-suppliers-unique-name-ci, 1854110000000-companies-unique-name-ci, 1854130000000-task-type-codes, 1854150000000-portfolio-contact-link-keys, 1854160000000-link-and-reference-keys, 1854170000000-location-search-label-separator, 1854180000000-foreign-key-indexes). They never stop on imperfect data: supplier or company names that differ only by case are renamed with a number ("SAP (2)"), links left behind by earlier deletes are removed or cleared, and every change is logged. The index migration creates 267 indexes and may take a few seconds on a large database.
- Managed documents whose record no longer exists are moved each night to the unfiled documents of the Managed Docs library, with an audit entry; nothing is deleted.
- Recommended: none

## 26.10.3 (2026-10-15)

CSV imports that handle real files, longer account numbers, and the launch article in its final form.

### Changes
- CSV imports accept files saved by Excel in Windows-1252 as well as UTF-8, refuse an Excel or OpenDocument workbook with a message that says how to save it as CSV, and show the reason when a file or a download is refused. Unknown columns are reported as a warning and no longer block an import. (#589, #592, #594)
- Re-importing a CSV file of projects, requests, assets, incidents, applications or tasks reports the rows identical to the stored records as unchanged and leaves those records and their history untouched. (#593, #596)
- Account numbers can have up to 15 digits. The CSV import reports a longer number as a row error and warns when leading zeros are dropped. (#591)
- A new chart of accounts is selected right after it is created, the import dialog names the chart it loads into, and account counts refresh after an import. (#590)
- Website: the 26.10.1 launch article in its final wording, the offer page tightened, and permanent redirects for the old author page and `/opex`. (#587, #588, #595)

### Fixes
- Import and export messages of the CSV dialogs, presets and buttons are translated. (#589, #590, #592)

### On-premise
- Action required: none. `.env` is unchanged.
- Migrations: run automatically at start (1854060000000-account-number-bigint). It widens the account number columns and needs no action.
- Recommended: none.

## 26.10.2 (2026-10-15)

A small follow-up to 26.10.1: one fix on the budget line workspace, and the launch article on the website.

### Changes
- The website's changelog page lists the release articles of the blog, starting with the 26.10.1 launch article. (#583)

### Fixes
- After a budget line's type is changed between OPEX and CAPEX, the Properties panel shows the new type and its fields right away, with no reload. (#584)
- The 26.10.1 entry links the on-premise operations page at its real address. (#582)

### On-premise
- Action required: none. `.env` is unchanged.
- Migrations: none.
- Recommended: none.

## 26.10.1 (2026-10-15)

First published version of KANAP. From now on, KANAP comes in numbered and dated versions, about one a month. Self-hosted installations follow the `stable` branch, and each GitHub release carries its notes and an inventory of the components it contains.

### Changes
- One budget for OPEX and CAPEX lines: one Budget lines list with a Type column and a single Total row, one workspace per line at `/ops/budget/BL-n`, and BL-n references in search, Plaid and e-mails. A line can change type in place or from a later year. Old addresses and OPX-n or CPX-n references keep working. (#493, #504, #505, #507, #534)
- The Budget tab of a line shows one card per column, then how the selected column is built (an amount, quantity and price, or month by month), then the result. A column can take its whole amount at a date or start from another column with a percentage, and the tab can put the columns back to their opening values. (#519, #520, #521)
- Budget reports have an All tab next to OPEX and CAPEX, chargeback reports cover CAPEX lines, and the overview has one Budget tile with personal settings. Freeze states are set per column and nature in one click. (#510, #512, #513, #517)
- New workspaces start with four recommended analytics dimensions (cost pool, IT tower, purpose, priority), none required. Existing workspaces can add them from Master data. Dimensions are reordered by dragging, each value shows the lines that use it, the CAPEX criteria become dimensions, and search finds lines by their dimension values. (#483, #486, #494, #518)
- Budget administration has one Copy budget columns operation: amounts, allocations or both, for all lines or for one nature, with a line-by-line preview. One budget file holds both natures, up to 20,000 lines. (#495, #496, #532)
- Contracts: the list shows each contract's next due date, state, totals and commitments against its budget lines. Tacit renewals ask the owner for a decision within a decision window (90 days by default), and terminating proposes the first end the notice allows. A Compliance tab lists the clauses a contract should hold, deduced from the applications and assets it covers, with a CSV register. (#526, #528, #529, #530, #531, #539)
- Supplier and contact pages save as you edit and list the records that use them. The contact picker lists names grouped by supplier, and country names follow the interface language. (#543, #547, #548, #550, #551, #553)
- The account menu and Settings › About show the KANAP version, with a link to the release notes. (#535)
- The audit log records sign-in, session, role and export events, and exports as CSV with readable labels. (#445, #449)
- Claude, ChatGPT and Grok connect to KANAP over MCP by signing in with the user's KANAP account, after a consent screen. Settings › Connected apps lists and disconnects them. API keys keep working, and MCP requests leave the included AI allowance untouched. (#549, #555, #556, #557, #565)
- Plaid and MCP tools find records by their reference, apply every sort and filter they offer, state the currency of amounts, name the field of an invalid query and answer on recovery tests. (#488, #558, #559, #561)
- Sign-in allows 60 requests per minute per address and pauses an account for 15 minutes on that address after 5 wrong passwords; the sign-in page shows the wait. A share link goes to 20 recipients at most, 30 links per hour per user. Payment details are visible to users with the billing permission only. (#537, #544)
- Sample data covers suppliers' contacts, the recommended dimensions and a classification campaign in progress. (#412, #487, #523, #542)
- FTE reports: staffing, cost per FTE and daily rate views, with links from report rows to the items and to filtered lists. (#415, #422, #423, #425, #426, #429)
- Billing: subscribing or changing plan asks for the general terms of sale, plan changes bill at once or at the end of the period, and invoices are A4 in the customer's language. (#568, #569, #571, #572)
- Interface: fewer breadcrumbs, more readable grey text in both themes, compact dialog buttons, one-line picker lists and actions under the title on narrow screens. The web app needs Chrome or Edge 111, Firefox 114 or Safari 16.4 or newer. (#435, #481, #500, #503, #522, #533, #552)

### Fixes
- Contracts with tacit renewal show the end of their current term and their next cancellation deadline. Adding months keeps the day or uses the last day of the month. (#524)
- The billing page shows the renewal date again, and a late card payment gets its grace period before access is frozen. (#567)
- Long rich text is processed in the background with a time limit, so other users stay served. Autosave retries when the server is busy, and CSV imports report size errors on the row. (#566)
- Grid filters and quick search match `%`, `_` and `\` as typed. Pasted and imported text keeps its escaped characters and decodes entities once. (#554, #574, #575)
- Saving a contact with a supplier and no contact type keeps it open and shows the field to complete. (#541)
- A role holding a retired permission level no longer hides the access another role gives. Signing out clears the previous user's filters and cached data. (#497, #514)
- The copy preview counts every line of its table, report titles on the All tab name both line types, and a year without exchange rates gets them when a read needs them. (#527, #545, #546)
- A failing AI tool call no longer ends the assistant's answer, and an unknown name gets a clear "not found". (#472, #473)

### On-premise
- Action required: none. `.env` is unchanged.
- Migrations: run automatically at start (1853890000000-account-nature, 1853900000000-analytics-axis-applies-to, 1853910000000-analytics-value-applies-to, 1853920000000-analytics-axis-required, 1853930000000-analytics-value-order, 1853940000000-search-index-analytics-values, 1853950000000-budget-line-nature, 1853960000000-budget-lines-nature, 1853970000000-budget-lines-merge, 1853980000000-capex-criteria-dimensions, 1853990000000-budget-right, 1854000000000-budget-line-predecessor, 1854010000000-capex-notes-to-description, 1854020000000-budget-line-search-ref, 1854030000000-budget-dashboard-config, 1854040000000-contract-compliance-items, 1854050000000-ai-api-keys-oauth-grants).
- An installation on the build of 2026-09-27 also gets the migrations in between: see https://github.com/kanap-hq/KANAP/compare/0b51024a...v26.10.1.
- Budget lines have a single Budget right. A role with `opex=admin, capex=reader` becomes a budget administrator, and the migration log names each widened role.
- Rich text is limited to 200 KB per content. `/api/health` reports `text_processing`.
- Recommended: about 600 to 780 MB of memory for the API with 2 processes (rich text is processed in threads). Allow uploads of 80 MB on the reverse proxy (`client_max_body_size 80m` on nginx) so that a budget file of 20,000 lines goes through. Set `APP_BASE_URL`, which a later version will require, `CORS_ORIGINS`, and `APP_ENV=production` behind HTTPS. Read the `[ENV]`, `[CONFIG]`, `[CORS]` and `[VERSION]` lines at start.
- MCP sign-in without an API key needs the reverse proxy to pass `/.well-known/oauth-` to the API and keep its `WWW-Authenticate` header. See "Connecting AI assistants over MCP" on the on-premise configuration page. API keys work unchanged.
- Follow the `stable` branch to upgrade. The upgrade procedure, including how to move an existing checkout from `main` to `stable`, is on the on-premise operations page: https://doc.kanap.net/on-premise/operations/#upgrade-procedure
