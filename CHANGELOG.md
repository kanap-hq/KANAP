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

## 26.10.8 (2026-10-30) · Action required

Plaid makes more changes under approval and reads budget reports, reference data and administration. Every list and report exports to CSV or Excel from the server, imports read Excel workbooks, most records get a History tab, and refusals name the missing right. On-premise installations now pull published images.

### Changes
- Plaid writes budget lines as one family: OPEX and CAPEX lines are read, filtered and grouped together, a new line asks for its type and can be created with its budget version and amount in one approval, and `OPX-n` and `CPX-n` still find their line. A change made by Plaid before this version can no longer be undone from the conversation. (#1039, #1060)
- Plaid creates and modifies incidents, adds journal notes, links assets, applications and technologies, and creates follow-up tasks; a register administrator can ask it to reopen or cancel an incident or lift its confidentiality. (#1065)
- Plaid declares technologies on applications and servers, creates or adopts technology records from the catalog, and updates their versions, owners, support contacts, web links and alert settings. It changes the state of vulnerabilities (To review, Handled, Not affected), with an optional note, and can undo it. (#1068, #1090)
- Plaid deletes one task, contact, location, document, budget line, connection or interface at a time, after a preview that lists what goes with the record. The delete cannot be undone. (#1051)
- Plaid makes the changes a contributor can make on the screens, within a Business Contributor's participation scope. Its change previews and the messages after approval are in the user's language, with the field names and values of the screens. When nothing matches a requested change, it says so. A short "yes" to an offer carries it out. (#1034, #1039, #1042, #1090)
- A service desk agent connected to GLPI can add a technician or a group as an observer of a ticket, with approval. (#1135)
- Plaid and the MCP server read the budget by consolidation account, compare several columns or years, group by two fields, list the largest changes between two columns, give FTE month by month and, with the Reporting right, the chargeback by company and department. They read staff cost, FTE, cost per FTE and day rate as the Cost per FTE report computes them. (#1040, #1129)
- Plaid and the MCP server read cost centers, working-day calendars, analytics dimensions and, for budget readers, exchange rates and the reporting currency. Administrators of users with access to all data can ask about roles, rights and data access. Every reader can ask for the History of a record they can open. (#1102, #1132)
- Plaid and the MCP server read contract terms (state, next due date, cancellation deadline, owner) and what a contract covers; technology versions and the End of support report; incident counts by asset, application, technology and month with the average resolution time; vulnerabilities counted in distinct CVE, with the date the sources were last read. Lists of budget lines and contracts come with the total of every matching record. They say what they cannot read and name the screen that shows it. (#1025, #1034, #1065, #1068, #1090)
- References cited by Plaid open their record for people who can view it, including contracts, companies, suppliers, contacts, locations, connections and contributors. Conversation titles show plain text. (#1023, #1025, #1134)
- MCP server: 12 tools, 13 with web search, including the application classification catalog and record history. A refused call gives its reason, a key over its limit gets a `Retry-After`, and Administration › Plaid has an MCP journal of completed, refused and failed calls. Revoking a key or connection asks for confirmation; on Connected apps, people see the last use and revoke their own API keys. (#1012, #1102)
- Exports: every list exports as CSV or Excel, built by the server, with typed numbers, amounts and dates. Project, request and task exports follow the screen's filters and sort, and the main lists start with their reference. Report tables (budget reports, chargeback, time logged, capacity, end of support) export the same way, with a Parameters sheet in Excel; so do the copy pages, the skills matrix, roadmap occupation and the budget file. Every export is recorded in the audit log with its parameters, format and row count. (#951, #1021, #1035, #1036, #1047)
- Imports: every data import and the budget file accept Excel workbooks (.xlsx) as well as CSV. The first sheet is read, typed amounts and dates are read exactly, and old .xls files are refused with a message. Imports accept yes and no in French, German and Spanish. The contracts import reports every error of a row at once and flags an invalid duration or notice period. (#1037, #1038, #1046, #1117)
- History: budget lines, contracts, incidents, applications, tasks, projects, requests and sixteen other record types (companies, suppliers, contacts, cost centers, accounts, assets, technologies, interfaces, connections, knowledge documents and more) show who changed the record, when and what, in plain words, links included. Records from other modules are named only for people who can open them. The task page has Overview and History tabs; the activity feeds of projects, requests and tasks show comments and decisions only. Team and link changes made to projects and requests before this version are not in the History. (#1059, #1067, #1104)
- Access: a refusal names the missing right and its module in the interface language. The access denied page opens inside the application, and so does a creation address opened without the right to create. Opening Plaid without the AI chat permission names the permission to ask for. (#1023, #1052, #1054, #1055, #1056, #1058, #1097)
- Screens hide the actions a reader cannot take: interface environments and bindings, linked tasks, IT landscape settings lists, planning dates on Portfolio > Planning, task labels and agent page titles are read only for them. (#954, #1030, #1053, #1094, #1116)
- Budget: a budget line linked to a contract that differs in paying company, cost center, supplier or currency shows a warning mark with the differences. The owner pickers of a line list first the people who can read its cost center. A supplier can be created from the supplier field of a contract or budget line. An account reads "number - name" everywhere. (#1017, #1066, #1073, #1089)
- Budget file: the check before loading says which lines, columns and years have quantity and price lines whose amounts the file overrides, with their total. (#1093)
- Reports: the report by analytics dimension counts the lines of each value, lists them in a "Detail by line" view and, on the All tab, gives the OPEX / CAPEX split. Top lines shows each line's reference, and its pie labels slices by their share of the pie. (#1047, #1072, #1100)
- Administration: an administrator can rename the organisation in Admin › Branding (the workspace address stays). Built-in roles show their name and description in the interface language. Sending an invitation asks for confirmation. An About KANAP window gives the version, links and how to reach support. (#968, #999, #1003, #1126)
- Email logs no longer contain recipient addresses or subjects. (#1125)
- Vulnerabilities: the page shows when CISA KEV, EU KEV, EPSS and EUVD were last read, and warns when one fails or has not been read for three days. The technology catalog search lists the entries already adopted, with their reference. (#1119, #1130)
- Records: an interface can be deleted from its record, and a copied interface keeps its specification. Removing a web link offers Undo. Time logged on a project can be backdated. A task with unsaved changes asks before leaving. A typed date is saved once, on leaving the field or Enter. Empty lists offer a create button. Asset pickers show cluster membership, and the connection map panel shows a server's addresses, segment and clusters. (#946, #950, #952, #957, #972, #1009, #1022, #1029, #1095, #1096)
- A user whose profile has no name is asked for one at sign-in, and the account menu shows their email meanwhile. During a trial, the top bar shows the days left, and administrators can turn Plaid on from the home page. (#948, #1000, #1001, #1002)
- Language: number fields use the decimal mark of the interface language; French punctuation stays on the line of its word; Netbox messages, retired options, pickers, the copy preview, renewal tasks, agent costs and sample data dimensions follow the interface or workspace language; screens say "workspace" for tenant. (#949, #956, #958, #960, #961, #966, #969, #971, #973, #997, #1006, #1007, #1019, #1020, #1032, #1046, #1057)
- Sample data: the dialog gives the real duration and says the starting company is replaced; the page lists what blocks a load. (#942, #943)
- User manual and website: CSV and Excel exports and imports, infrastructure rights, the 26.10.7 release article and an article on technologies. (#909, #1004, #1041, #1121, #1128)

### Fixes
- Security: a linked record is shown only to people who can read its module, in Plaid, the MCP server, the task, document and incident pages and the API; a Business Contributor sees only the projects, requests and applications they take part in. Project contributors can no longer change through the API what the project page keeps for members, and replacing the applications, assets or budget lines of a project or request needs the right to read them. The API route that deletes an interface requires the applications administrator level, as the screen does. (#974, #1044, #1051)
- Admin › Roles counts each person holding a role once; a role held only as a primary role can no longer be deleted. (#1118)
- People who can edit a project, request, interface or application can edit its integrated document without write rights on the library. Deleting an interface or request removes its integrated documents for them too. (#1043, #1051)
- Re-importing a French application export keeps the personal data flag and the last disaster recovery test date; date columns export the stored day on servers outside UTC. A budget file without a header line is refused with a clear message. (#1038, #1046)
- On the budget list, a dimension value that does not apply to the line's type shows empty. The overview tiles show a saved budget line without a reload. Reports load their figures once. (#944, #1060, #1099)
- Loading sample data into an empty workspace works after objects were created and deleted there. The starting company of a new sign-up takes its currency from its country. (#921, #947)
- An invalid identifier in an API route answers 400 "Invalid identifier.". (#1092)
- Smaller fixes: the cost per FTE chart keeps its axis labels unique, the departments list waits for a full year, a deleted contract is not loaded again, sanitised host names no longer end with a hyphen, a disabled delete button stays red, form fields have a visible border in dark mode, technology pickers and relation add panels open in the content, the audit log detail shows readable labels and business references, the Users page drops a stray column choice, the Plaid approval card names a requester without a name by email, and several layouts are aligned. (#945, #953, #955, #959, #962, #964, #965, #967, #970, #1005, #1008, #1010, #1011, #1014, #1016, #1033, #1074, #1091)

### On-premise
- Action required: the server pulls the images of the version from `ghcr.io/kanap-hq` (`kanap-api`, `kanap-web`, `kanap-api-tools`, public, no account needed) and no longer builds them. Open outbound access to `ghcr.io` and `pkg-containers.githubusercontent.com` (port 443) before upgrading. Upgrade with `docker compose -f infra/compose.onprem.yml pull`, then `docker compose -f infra/compose.onprem.yml up -d`, in place of `build --pull` and `up -d`. Read "First upgrade to a version with published images" in the operations guide first. (#1013, #1018)
- Once the new version runs, free the old build cache and images (about 2.5 GB): `docker builder prune`, `docker image rm infra-api infra-web`, then `docker image prune`. (#1018)
- The version that runs is the version of the checkout (`git checkout stable`, or `git checkout v<version>`), then `pull` and `up -d`; a rollback works the same way after the restore of the backup. Maintenance commands run in the `tools` service (`docker compose -f infra/compose.onprem.yml run --rm tools ...`). Building the images on the server stays possible with `infra/compose.onprem.build.yml` (fork, local fix, server without access to `ghcr.io`); only that case needs `registry.npmjs.org` and `dl-cdn.alpinelinux.org`. The server needs less: 4 GB of RAM minimum (8 GB recommended with PostgreSQL on the same server) and 10 GB of disk. (#1018)
- Imports read Excel workbooks by default; `IMPORT_XLSX=false` keeps them to CSV files. (#1038)
- The API warns at start about an invalid token lifetime, `API_WORKERS` or `PASSWORD_RESET_TTL`, and about a missing `S3_BUCKET`; an unreadable `PASSWORD_RESET_TTL` lasts 1 hour. The attachment file name migration logs only the names it actually repaired. (#1026, #1123)
- Migrations: run automatically at start (1855500000000-audit-log-parent-record, 1855700000000-audit-log-parent-family-a, 1855710000000-audit-log-contact-links, 1855720000000-audit-log-parent-record-family-c, 1855730000000-audit-log-parent-record-family-d, 1855740000000-document-history-parent, 1855800000000-data-access-hidden-category-count, 1855900000000-audit-log-parent-contracts-incidents, 1855910000000-audit-log-parent-applications, 1855920000000-audit-log-parent-tasks, 1855930000000-audit-log-parent-projects, 1855940000000-audit-log-parent-requests, 1855950000000-vulnerability-feed-signal-sources).
- The audit log migrations link existing audit entries to their parent record and add indexes on the audit log. Their duration grows with the size of the audit log, and audit writes pause for about a second on a large installation. (#1059, #1067, #1104)
- Recommended: none

## 26.10.7 (2026-10-26)

Access to budget and contract data limited by company or cost center, server clusters that host applications and carry connections, a quality pass on assets, applications and incidents, and security updates of the API dependencies.

### Changes
- Data access: administrators can limit a person to chosen companies or cost centers, in read or edit, from the "Data access" tab of the user window or the Access tab of a company or cost center. The budget, contracts, reports, search, the assistant and MCP clients then show only what the person may read; a person without budget rights sees how many budget lines are linked to a record, without their names. Administration > Data access lists the limited people, with CSV export and import, and a company or cost center used by an access cannot be deleted. The user manual has a Data access page. (#750, #783, #786, #794, #801, #837, #876)
- A dimension can accept new values from a budget line: with "Open values" on, anyone who can edit a line adds a value from the line or the budget file. (#786)
- Clusters: an application can be assigned to a server cluster, and its members host it, including nodes added later. A connection can start from, end at or pass through a cluster, and applies to every member in service. Vulnerabilities, end of support, the administration view, maps and the impact view count the members; a cluster's Dependencies tab lists what its members depend on. Cluster rules are consistent (a member cannot be a cluster, a cluster with members has no operating system), and the CSV "Cluster Membership" column imports and exports real memberships. (#792, #793, #796, #797, #802)
- Assets: the record has three property groups and the tabs Overview, Operations, Network, Hardware, Dependencies and Relations. The CSV import checks host names, IP addresses, types, domains, lifecycles, zones and dates before writing; two assets cannot share a name or an FQDN; the export uses the screen labels and follows the list filters; the list sorts references by number and dates by date. A refused delete names the connections that use the asset. (#774, #891, #901)
- Applications: two applications cannot share a name; the CSV import checks owners, categories, lifecycles and names before writing, and the export follows the list filters. An application can join a suite from its record, its record links previous and next versions, and a new application is created with its properties in the side panel, as for assets. In the Deployments tab, the server name opens its asset. A user who can edit an application, interface, project or request can write its description without Knowledge rights. (#738, #771, #785, #851, #877)
- Incidents: the journal shows when a backdated note was recorded; a closed or cancelled incident cannot be deleted; the global search finds an incident by a linked server; the list has compliance columns and filters, and its export follows them. Tasks and audit rows of a restricted incident are hidden from people who cannot see it. Attachments move to the end of the Overview, and a new incident's title is typed in the page header. (#798, #803, #850)
- Vulnerabilities: the section of a server or an application shows the search in progress until the first NVD read of a newly linked product is done, and says when it failed. "Why this row" lists each CPE identifier once. The CISA catalog of known exploited vulnerabilities is read from CISA's GitHub mirror by default, since www.cisa.gov refuses data-centre addresses. (#838, #840, #886, #893)
- CSV import in "Replace" mode changes only the columns present in the file: an empty cell clears the value, a missing column keeps it. The import result says "created" and "updated". (#770, #899)
- Lists keep column widths set by hand after a reload; "Reset columns" restores the defaults. The interfaces list sorts by application, business process, data category and personal data. (#729, #740)
- Records: editable titles show a pencil; date fields replace the date on typing and flag an invalid one; unsaved-changes dialogs name their outcome ("Save and leave", "Leave without saving", "Stay"); "Add" actions sit next to their section titles, and relations tables take the width of their content. The technology page has previous and next arrows. Clearing the annual amount of a budget line, or typing 0, saves zero. (#778, #784, #790, #822, #825, #826, #875)
- The audit log detail shows readable field names and values, with a close button. (#782, #791)
- Confirmations: before archiving a Plaid conversation, clearing the recently viewed history, closing a modified business process, task or standard account, and deleting a connection (with its hops). Supplier, department, contact and business process pages have a delete action; a record still in use cannot be deleted and the message says what uses it. (#769, #772, #775, #779, #887, #902)
- The assistant gives dates and times in the user's time zone, and shows images from other websites as links. (#789, #799)
- Language: CSV export dialogs, chargeback and allocation labels, import row errors, the administration view export, standard account forms and connection codes follow the interface language; amounts and shares on the overview and in reports use the language's number format; the page declares its language for screen readers and browser translation. Spanish and German wording is aligned (Añadir, Operaciones, Notificante, Melder, Diario), and the French and German manuals use the app's words. (#742, #749, #777, #818, #819, #820, #821, #823, #824, #843, #844, #847, #848, #882, #898, #903, #904)
- Website: Contracts and Incidents feature pages in four languages, articles on vulnerability management and the incident register, the 26.10.6 release article, the IT landscape page, and refreshed Plaid screenshots. (#727, #787, #795, #800, #878, #880, #883, #896)
- Sample data: a fictional name for the FroMag supplier; incident journals, five-part reviews and corrective tasks. (#776, #798)

### Fixes
- Security: the API moves to body-parser 2.4.0 (a malformed compressed request could stop an API process), fast-uri 3.1.9 and multer 2.5.0, and to the Zod 4 validation library (GHSA-mrhx-c7xc-m3w5). Roadmap requests carrying more than 10,000 items in one collection are refused. (#884, #894)
- The assistant and MCP clients list the budget lines, contracts and projects linked to an application, an asset, a budget line or a contract only to users who can read those modules. A budget line still shows the names of its own contract and project. (#892)
- Readers and members of the IT landscape can open the Technologies, End of support, Vulnerabilities and Administration zones screens again. (#788)
- A budget reader sees a budget line in read only, without an error message. Changing a contract's budget lines from the contract page requires the right to read the budget. (#728, #801)
- Reloading or closing the page releases the edit lock of a description or a knowledge document at once. (#841, #895)
- Session renewal is limited to 120 renewals a minute per address and tenant and 30 per session; when the limit is reached at load, a screen offers a retry. (#785)
- A request that fails without a message from the server shows the screen's own message. (#905)
- The assistant converts company turnovers into the reporting currency before adding them up, and currency settings ignore a stored code outside the ISO list. After adding a currency, the notice reports the rates actually fetched. (#730, #849)
- Companies: a company without name, country or city is refused with a clear message; the list waits for a complete year and shows a dash for a year without figures. (#755, #846, #879)
- The weekly portfolio report XLSX writes dates as date cells. (#768)
- Emails and activity lines name a user without names "Someone"; the effort allocation dialog sorts such people by the text it shows. (#827, #889)
- A required title error on a new incident, connection or interface clears as soon as a title is typed. (#897)
- Smaller fixes: map side panels say "Open", bulk delete dialogs name the deleted objects, the task requestor is chosen with the person picker, an incident shows its new journal entry after a link from a Relations tab, the incidents total row drops the reference prefix, date columns are headed "Created on" and "Updated on", the French operating system family uses the usual apostrophe, request and project back links are capitalised, the budget tiles name the reporting currency once, the copy screen names an unknown department in the interface language, and a delete dialog hides its count when nothing can be deleted. (#739, #747, #748, #751, #767, #773, #805, #845, #881, #900, #907)

### On-premise
- Action required: none for a valid `.env`. An unrecognised `DEPLOYMENT_MODE` now stops the API at start with the accepted values (`single-tenant`, `multi-tenant`, or unset): check it before upgrading. (#842)
- Optional: limiting data access needs a one-time step on the database server: run `infra/scripts/data-access-role.sql` as a superuser, then restart the API (see the installation guide). Without it, everyone keeps all data and Administration > Data access says so. (#876, #890)
- Behind a reverse proxy, set `RATE_LIMIT_TRUST_PROXY=true` so that the session renewal limits count each client on its own. (#785)
- With vulnerabilities on, open `raw.githubusercontent.com` instead of `www.cisa.gov` on the firewall, or keep `www.cisa.gov` through `KEV_FEED_URL`. (#886)
- Migrations: run automatically at start (1854400000000-data-access-foundations, 1854500000000-data-access-line-policies, 1854600000000-data-access-line-editable, 1854700000000-analytics-axis-open-values, 1854800000000-data-access-references, 1854900000000-cluster-membership-repair, 1855000000000-cluster-membership-from-legacy-text, 1855100000000-data-access-can-read, 1855300000000-incident-search-linked-assets, 1855400000000-data-access-contract-policies).
- 1854900000000-cluster-membership-repair removes invalid cluster memberships (a cluster in itself, a member that is a cluster, a cluster that no longer is one) and logs the counts per tenant. 1855000000000-cluster-membership-from-legacy-text turns the former cluster text of assets into real memberships when it names one cluster, and clears the text when every name is recognised. 1855300000000-incident-search-linked-assets reindexes every incident. Their duration grows with the number of assets and incidents. 1854400000000-data-access-foundations adds an index on contracts, built without `CONCURRENTLY`.
- Recommended: none

## 26.10.6 (2026-10-23)

Security update of the base images: Node.js 24.22.1, nginx 1.31.8 and current CA certificates.

### Changes
- None.

### Fixes
- The images run Node.js 24.22.1 (October 2026 security release: Brotli decoder, TLS hostname and DNS fixes, and a root certificate store without the compromised eMudhra keys) and nginx 1.31.8 (five security fixes), on Alpine packages with OpenSSL 3.5.9 and the CA certificates of 2026-10-20. The `ip-address` library of the API moves to 10.7.4 (GHSA-rxp7-6hxx-x8q5). (#725)

### On-premise
- Action required: none. The usual upgrade rebuilds the images on the new base images.
- Migrations: none
- Recommended: none

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
