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

## 26.10.5 (2026-10-23)

A technology layer with its catalog and vulnerabilities, Relations tabs on one model for every record, and amounts in several currencies handled throughout the budget.

### Changes
- Technologies: a Technologies list and record in the IT section, created from a catalog of 192 products or by hand, with versions and their end of support dates, Servers, Applications, Operations, Compliance and Relations tabs, support contacts, hosting types from the IT settings, and a CSV export and import of the server and application links. An application recorded for a technical component can be converted into a technology. (#634, #637, #644, #647, #650, #656, #679, #682, #691)
- The catalog follows endoflife.date and, for products it does not cover (Check Point, Cisco ASA and NX-OS, Junos, Arista, NetScaler, Dell storage, WebLogic and others), the vendors' official lifecycle pages, each version showing its source and the date it was checked. Adopted technologies receive new versions, end of support dates, identifiers and descriptions; values entered by hand are kept. A new "Network" family is added and "Network and security" is renamed "Security". (#655, #657, #686, #712)
- A server's operating system is one of its technologies, shown first with its version and support dates. Operating systems from the former IT settings list become technologies automatically. (#662)
- An End of support report in the IT operations section lists the technology versions, operating systems, applications and hardware whose support ends within a chosen horizon, with the servers and applications they touch. (#640)
- Administration zones: a new administration view lists zones, directory services and domains with their forests, trusts and domain controllers. Servers and other assets can be placed in a zone, and the view flags gaps in the separation between zones. New tenants start with three zones, Tier 0 to Tier 2. (#651, #676)
- Vulnerabilities: a new page lists the vulnerabilities of the technologies in use, one row per technology, version and CVE, read from the NVD and from the publishers' records on CVE.org, with the source and age of each row, filters, export and a change of state in bulk. Technologies are matched by version, operating systems by branch, SUSE Linux Enterprise Server by service pack. (#642, #654, #655, #688, #694, #696, #706)
- Vulnerabilities show the exploitation signals of the CISA and European Union catalogs and the EPSS probability, are listed with the exploited ones first, and link to the European vulnerability database (EUVD). (#690)
- Each technology and version can be included in or excluded from alerts; operating systems and online services start excluded. IT owners receive an email for new critical or high vulnerabilities and for vulnerabilities known to be exploited, with the severity shown on the Vulnerabilities page. (#654, #687, #690, #721)
- Servers and applications show their vulnerabilities in their lists and records, with a severe badge, and a "Vulnerabilities in your estate" tile on the home page summarises what needs attention. On an application, a technology is added with its version and can be recorded on the application's servers. (#697, #708)
- The assistant and MCP clients can read technologies, their versions, servers and applications, and the vulnerabilities, read only. (#680, #708)
- Relations tabs of applications, technologies, assets, budget lines, contracts, projects, requests, incidents, interfaces and locations share one model: tables with the main facts of each related record, links added from a search and saved at once, suggestions (same supplier, technologies of the linked servers), and links and files in one section. An asset's Relations tab shows what is affected if it goes down. (#632, #638, #639, #641, #664, #698, #709, #711, #715, #716, #717, #718, #719, #720)
- Currencies: an amount without an exchange rate for its year is left out of totals, reports, chargeback and the assistant's sums, marked on its line and named in a warning with a link to enter the rate. Budget administrators can enter a rate by hand, the rate fetch covers every currency in use, and changing the reporting currency fetches the rates of every year and asks for confirmation. (#672, #674, #675, #677, #683)
- Company turnover is converted to the reporting currency in allocations and chargeback indicators. Allocation shares change for groups whose companies use different currencies. (#669, #683)
- Companies: numbers and percentages in the user's language, turnover with its currency, decimal input in the user's language, delete from the company page, and a CSV import that checks city, repeated names and frozen years, with optional metric years. The freeze page says who froze a year and when. (#666, #667, #668)
- Budget lines: the cost center list shows only the cost centers of the paying company. The budget file export adds the cost center path after its code and a "Current year" option; the budget file check warns when a row's company differs from its cost center's company. Change type is in the Properties panel. (#710, #713, #714, #716)
- The IT menu is reordered from applications to infrastructure, with a Reference data section; Netbox moves to a tab of the IT settings. The Netbox import attaches virtual machines to their cluster. (#678, #684)
- Grids offer a "Reset filters" button. Pages no longer flicker on the first visit. The dashboard's Log time button appears for project contributors and lists only the projects and tasks where the user can log time. (#633, #660, #671)
- Record headers: "Share" replaces "Send link", "New version" replaces "Create new version", and Delete is a trash icon. (#708)
- The user manual documents technologies, vulnerabilities, the administration view, the end of support report and the related changes. (#648, #658, #663, #665, #670, #681, #723)
- Website: the blog in German and Spanish, a filter by topic and related articles on feature pages, the site in the browser's language, About and Offer pages, and articles on OPEX and CAPEX, contractors' FTE and daily rates, contract management and currencies. (#643, #645, #646, #652, #653, #659, #661, #673, #685)
- Sample data: the Fromage & Co tenant has an incident register and more application deployments. (#689, #699)

### Fixes
- Images attached to assistant conversations are no longer removed by the weekly storage cleanup. (#635)
- The older incident and location link routes require the right to read the linked assets or applications, like the Relations tab. (#722)
- A budget line created without a start date is refused with a clear message. (#683)

### On-premise
- Action required: none. `.env` is unchanged and no variable became mandatory.
- Migrations: run automatically at start (1854190000000-technologies, 1854200000000-technology-search-index, 1854260000000-vulnerabilities, 1854270000000-technology-support, 1854290000000-technology-admin-zone, 1854300000000-technology-catalog-cpe, 1854310000000-technology-hosting-type, 1854320000000-technology-catalog-sync, 1854330000000-operating-system-technology, 1854340000000-asset-admin-zone, 1854340000000-currency-rate-sources, 1854350000000-vulnerability-alerts, 1854360000000-vulnerability-signals, 1854370000000-vulnerability-cve-records).
- 1854330000000-operating-system-technology turns each server's operating system into a technology, then drops the `assets.operating_system` column and the operating systems list of the IT settings. Its duration grows with the number of servers.
- 1854370000000-vulnerability-cve-records runs `CREATE EXTENSION IF NOT EXISTS pg_trgm`. The extension already exists on every installation: 1853000000000-ai-search-index created it in June 2026, before the first published version, so the statement changes nothing.
- Vulnerabilities and the daily catalog sync are off by default on-premise: `VULNERABILITY_FEED_ENABLED=true` and `TECHNOLOGY_CATALOG_SYNC_ENABLED=true` turn them on (see "Optional: vulnerabilities" and "Optional: technology catalog" in the configuration guide). Without the catalog sync, adopted technologies follow the catalog shipped with each new version. Mirrors can replace every outside source (`NVD_API_BASE_URL`, `CVE_LIST_EXPORT_URL`, `KEV_FEED_URL`, `EPSS_FEED_URL`, `EUVD_BASE_URL`). The first reading of the CVE.org list takes about 2 minutes and about 700 MB in the database.
- Recommended: with `VULNERABILITY_FEED_ENABLED=true`, set `NVD_API_KEY` (free, see "Optional: vulnerabilities" in the configuration guide). Without it, the NVD allows one request every 6 seconds and the first reading takes longer.

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
