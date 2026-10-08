# Applications

Applications is your central registry for documenting the IT application landscape. It covers business applications, productivity tools, infrastructure services, and everything in between. Use it to track ownership, deployments, integrations, financial relations, and compliance information across your entire portfolio.

## Application categories

Every application or service belongs to a **category** that describes its primary purpose. This classification helps different stakeholders filter and focus on what matters to them.

| Category | Description | Examples |
|----------|-------------|----------|
| **Line-of-business** | Core business applications that support specific business processes | SAP, Salesforce, Workday, custom ERP |
| **Productivity** | End-user tools for daily work, including utilities and collaboration | Office 365, Acrobat Reader, Teams, Slack, Chrome |
| **Security** | Tools for protecting systems, data, and access | CrowdStrike, Okta, SIEM platforms, firewalls |
| **Analytics** | Reporting, business intelligence, and data warehouse tools | Power BI, Tableau, Snowflake |
| **Development** | Tools used by developers and DevOps teams | Python, Git, Jenkins, VS Code, Docker |
| **Integration** | Platforms that connect systems and move data | MuleSoft, Kafka, API gateways, ETL tools |
| **Infrastructure** | Foundational services that other systems depend on | PostgreSQL, Redis, Kubernetes, storage systems |

**Tips for classification**:
- Choose based on the application's **primary purpose**, not who manages it
- When in doubt, ask: "What is this tool mainly used for?"
- Categories can be customized in **IT Landscape > Settings** to match your organization's terminology

### Filtering by stakeholder

Different teams can use categories to focus on their area of responsibility:

| Stakeholder | Suggested filter |
|-------------|-----------------|
| Cybersecurity | Security category, or high criticality across all categories |
| Service Desk | Productivity + Line-of-business (user-facing applications) |
| Infrastructure | Infrastructure + Integration |
| Enterprise Architecture | All categories |

---

## Getting started

Navigate to **IT Landscape > Applications** to see your list. Click **New App / Service** to create your first entry.

**Required fields**:
- **Name**: A recognizable name for the application or service
- **Category**: The primary purpose of this application (see categories above)
- **Lifecycle**: Current status (Active, Proposed, Deprecated, Retired, or any custom code defined in Settings)

**Strongly recommended**:
- **Supplier**: The supplier providing the software (links to your Suppliers master data)
- **Publisher**: The software publisher (e.g., Microsoft, SAP, Oracle)
- **Description**: What this application does

Classification fields are optional when you create an application. **Business criticality**, cyber criticality, data confidentiality and recovery wave are chosen among the levels your organization defined in **IT Landscape > Settings**; each option shows the level's definition. Values remain unset until you choose them.

**Optional but useful**:
- **Version**: Current version identifier (free text, e.g., "4.2.1", "2023", "Q1 2024")
- **Go live**: When this version went or will go live
- **End of support**: When vendor support ends for this version
- **Retired date**: When this version was actually decommissioned
- **Licensing**: License terms and notes
- **Notes**: Free-form internal notes
- **Can have child apps**: Enable to use this application as a "suite" that groups other applications

Once you save, the workspace unlocks all tabs for detailed documentation.

**Tip**: Start by documenting your most critical applications. Use the **Deployments** tab to capture which environments exist (Prod, QA, Dev) and which servers run them, then link interfaces, contracts and budget items as you go.

**Permissions**:
- View: `applications:reader`
- Create / edit: `applications:manager` (also called `member`)
- Import / Export / Delete: `applications:admin`

---

## Working with the list

The Applications grid provides a comprehensive view of your application portfolio.

**Top scope filter (Show)**:
- **My apps**: shows apps where you are listed in the properties drawer as either a **Business owner** or **IT owner**. Multi-owner entries are supported.
- **My team's apps**: shows apps where any member of your Portfolio team is listed as Business owner or IT owner. Your own ownership is also included in this scope. Disabled if you are not assigned to a Portfolio team.
- **All apps** (default): shows the full Applications grid with the standard default lifecycle filter behavior.
- Your selection is remembered across sessions -- returning to the page restores your last choice.

**Default columns**:
- **Name**: Application name with category caption and an "Included in: {suite}" badge for components of a suite
- **Category**: The application's primary purpose
- **Environments**: Coloured chips showing active environments (Prod, Pre-prod, QA, Test, Dev, Sandbox). Hover for the base URL and lifecycle.
- **Lifecycle**: Current status
- **Criticality**: Business importance level
- **Publisher**: Software publisher
- **Derived Users (Y)**: Calculated user count for the current year (based on the audience set in the properties drawer)
- **Created**: When the record was created

**Default sort**: **Name** ascending (A to Z).

**Additional columns** (via column chooser):
- **Suites**: Parent suites this application belongs to
- **Supplier**: Linked supplier name
- **Business Owners** / **IT Owners**: Assigned owners (truncated, hover or click to see all)
- **Hosting**: Derived from server locations assigned to app deployments
- **External Facing**: Whether the app is internet-accessible
- **SSO Enabled** / **MFA Enabled**: Authentication features
- **Data Integration / ETL**: Whether the app participates in data integrations
- **OPEX Items** / **CAPEX Items** / **Contracts**: Linked spend and contracts
- **Components**: Child applications (if this is a suite)
- **Data Class** / **Contains PII** / **Data Residency**: Compliance information
- **Cyber criticality**, **Recovery wave**, **RTO**, **RPO**, **Review state/date**: Classification and continuity fields

**Classification progress**: the Compliance tile on your dashboard shows how many applications you can see are reviewed, need a review, or still have classification fields to complete, plus the points that call for action. Each figure opens the applications list filtered accordingly. See [My dashboard](my-dashboard.md#compliance).

**Filtering**:
- Quick search: matches name and editor/publisher
- Criticality, cyber criticality, data class and recovery wave filters list their values in catalog order (most critical first, waves in restoration order).
- Most columns use checkbox set filters showing only values present in the current result set; the floating filter shows `All`, `None`, or `N selected` with an **x** to clear.
- Retired applications are hidden by default; use the **Lifecycle** filter to include Retired.

**Actions**:
- **New App / Service**: Create a new entry (`applications:manager`)
- **Import CSV**: Bulk import from CSV file (`applications:admin`)
- **Export CSV**: Export the list to CSV (`applications:admin`). Catalog-backed columns (category, lifecycle, criticality, cyber criticality, recovery wave, data class, access methods) are exported as their names; the import accepts a name or the internal code.
- **Copy item**: Duplicate a selected application with all its core relations (`applications:manager`). See [Copying applications](#copying-applications) for what is and is not copied.
- **Delete Selected**: Remove selected applications (`applications:admin`)

---

## The Applications workspace

Click any row to open the workspace. The workspace has a **header** with quick metadata, a **properties drawer** on the right (the application's identity card -- always visible), and a **content area** in the centre that switches with each tab.

### Header

The header shows:
- **Application name** (editable in place)
- **Reference**: short identifier you can copy
- **Lifecycle** chip: click to change
- **Business criticality** chip: shows the level and opens a menu of the organization's levels
- **Version** chip (if a version is set): click to copy
- **Go live** date
- **Send link**: copy a shareable link to this workspace
- **Create new version**: launch the version migration wizard (see [Version management](#version-management))
- **Delete** (`applications:admin`)
- **Previous / Next**: walk through the filtered list without returning to the grid

### Properties drawer (right panel)

The drawer is the application's identity card. It is shown on every tab and edited inline -- changes save automatically.

**Identity**:
- **Category**, **Supplier**, **Publisher**

**Lifecycle dates**:
- **Go live**, **End of support**, **Retired date**

**Owners**:
- **Business owners**: business stakeholders accountable for this application (multi-select)
- **IT owners**: IT team members responsible for technical support (multi-select)

**Audience**:
- Add **Company / Departments** rows to record who uses this application. Pick a company and optionally restrict to specific departments.
- A live **Users** count is shown.
- **Calculation method**: **Derived** (computed from the audience based on master-data IT Users / Headcount metrics) or **Manual** (a single override number you type in).

---

### Overview

The Overview tab is the application's narrative. It contains:

**Description**: A rich-text description of the application. The editor autosaves as you type.

**Connections**: A read-only summary built from the application's interfaces. For non-middleware apps it shows two rows: **Receives from** and **Sends to**. For ETL/middleware apps it shows a single **Connected to** row. Each entry is a clickable pill that opens the related application; "+ N more in Interfaces" jumps to the Interfaces tab.

**Knowledge**: Linked knowledge articles. If you have `knowledge:member`, you can create new articles directly from this section.

---

### Deployments

The Deployments tab documents where the application actually runs -- one block per environment, with the servers attached to each.

**Environments**: Production, Pre-prod, QA, Test, Dev, Sandbox.

**For each deployment you can capture**:
- **Lifecycle**: per-environment status (Active, Proposed, Deprecated, Retired, etc.)
- **Base URL**: the access URL for this environment
- **SSO enabled** / **MFA supported**
- **Notes**

**Add deployment** opens a dialog where you set environment, lifecycle, base URL, SSO/MFA flags and notes. Each environment can only be added once. The lifecycle chip on a deployment header can also be changed inline from a popup menu.

**Servers per deployment**: Each deployment block shows a table of assigned servers:

| Column | What it shows |
|--------|---------------|
| **Server** | Asset name (clickable) |
| **Role** | e.g., Web, Database, Application (from the server role list in Settings) |
| **Hosting** | Derived from the asset's location |
| **Since** | Date the server was assigned to this deployment |

Click **Add server** on the deployment header to attach an asset. Cluster assets are excluded -- assign cluster member hosts instead.

**Tip**: Document servers in **IT Landscape > Assets** first, then link them here. The asset's Overview tab will show the same assignments in reverse.

---

### Interfaces

The Interfaces tab shows all integrations this application participates in -- as source, target, or middleware. The tab badge shows the total count.

Interfaces are **grouped by environment** (PROD, PRE_PROD, QA, ...). Within each environment they are split into:

- **Inbound** -- this application receives data
- **Outbound** -- this application sends data
- **Routed** -- this application is the middleware/ETL for a flow between two other apps

Each row shows the interface name, the counterpart application, and a **Via middleware** indicator. Click the row to open the interface workspace; click the counterpart to open the other application.

**Tip**: Interfaces are managed from the Interfaces page. This tab is a convenience read-only view, but it is the fastest way to navigate between connected applications.

---

### Operations

The Operations tab captures how users access the application and who supports it.

**Technical**:
- **Access methods** (multi-select): how users access this application. Options are configurable in [IT Landscape Settings](it-ops-settings.md). Defaults include Web, Locally installed application, Mobile application, Proprietary HMI (industrial interface), Terminal / CLI, VDI / Remote Desktop, Kiosk.
- **External facing**: whether the application is accessible from the internet
- **Data integration / ETL**: whether the application participates in data integration pipelines (also flips this app into "middleware" mode for the Interfaces and Connections views)
- **Can have child apps**: turn this application into a Suite that groups other applications

**Support**:
- A table of support contacts pulled from your Contacts master data. Each row shows the contact name, email, phone, and a free-text role (e.g., Account Manager, L1 Support).
- **Add contact** opens a dialog to pick a contact and set a role.
- **Support notes**: free-form text for support arrangements (SLA, escalation paths, on-call info).

---

### Compliance

The Compliance tab captures data protection and regulatory information.

**What you can edit**:
- **Data class**: confidentiality level (Public, Internal, Confidential, Restricted, or any custom code defined in Settings)
- **Last DR test**: date of the most recent disaster recovery test
- **Contains PII**: whether the application stores personally identifiable information
- **Data residency**: countries where data is stored (multi-select, ISO codes + names)

**Tip**: Data Classes are configurable in **IT Landscape > Settings**. Customize them to match your organization's data classification policy.

### Classification and continuity

The Compliance area also records the application's continuity and classification decisions. Missing values are shown as **Not set**; KANAP does not substitute a default level.

The tab is organized in four blocks, in the order of a business impact analysis.

**Criticality**:
- **Business criticality** is chosen among the levels defined by your organization. Each option shows the level's definition, typically the interruption the activity can tolerate. The level is a stable reference: renaming a level, changing its definition or reordering the catalog in Settings never moves an application to another level.
- **Cyber criticality** is selected independently. The picker shows each level's description; use the level whose plausible consequences are highest. Do not confuse cyber criticality with the level of risk.

**Data**:
- **Data confidentiality** uses the organization's data-class catalog.
- **Contains personal data** and **Data residency** complete the data picture.

**Continuity and recovery**:
- **Recovery wave** identifies the order in which the application is restored. It does not imply a duration or severity.
- **RTO** is the target time to restore service. **RPO** is the acceptable data-loss duration and may be zero. If the RTO reaches the maximum tolerable downtime defined on the chosen business level, KANAP shows a warning but keeps both values.
- Under the wave, KANAP lists the interfaces that link this application to an application planned in a **later** wave ("Exchanges with CRM, planned in V3"), with a link to each interface. Both applications must be up for the flow to work; the recovery plan owner decides. Retired interfaces are ignored, and users with a restricted Business Contributor scope do not see this list.
- **Last recovery test** records the most recent test date. A link opened from this area uses the single existing **Knowledge** section in Overview; it does not create a duplicate record. Older URL links remain available under Relations.

Two discreet hints may appear: data at the highest confidentiality level combined with the lowest cyber criticality, and an application at the most critical business level without a recovery test in the last twelve months. They never block anything.

**Review**:
- **Justification** records the reasoning behind the levels and what the recovery plan relies on.
- The review is a timestamp: **Mark as reviewed** records who reviewed the classification and when. It is available once business criticality, cyber criticality, data confidentiality, recovery wave and the justification are present.
- The review date and reviewer stay visible afterwards. When a classification value, a recovery reference or the data residency changes after the review, the tab shows **Changed since review** and the list shows **Review needed**. Editing the application name or publisher does not affect it. Changing the catalog in Settings never invalidates a review.

---

### Relations

The Relations tab links this application to your financial, contract, project and task records. The tab badge counts all linked items. Changes save automatically.

**Components** (only when "Can have child apps" is enabled): a table listing the child applications of this Suite, with their lifecycle and criticality. Click a row to open the child workspace.

**Relations**:
- **OPEX items**: recurring costs associated with this application
- **CAPEX items**: capital expenditure projects
- **Contracts**: vendor contracts
- **Projects**: portfolio projects linked to this application
- **Tasks**: tasks linked to this application. This list is read-only here -- tasks gain or lose this link when you set the **App / Service** field on a task in the Tasks page.

**Relevant websites**: add URLs with optional names -- useful for vendor portals, monitoring dashboards, or documentation links. **Add URL** opens a dialog; existing entries can be edited or deleted.

**Attachments**: Drag and drop files or click **Select files** to upload. Click an attachment chip to download it. Delete is available to managers.

---

## Version management

KANAP offers **two ways to manage application versions**, depending on how your organization handles upgrades:

| Approach | Best for | What happens |
|----------|----------|--------------|
| **Simple** | Most applications | Update the version fields in the properties drawer or in the create form -- same record, new version number |
| **Sophisticated** | Major migrations | Use **Create new version** to create a new application record with lineage tracking -- run old and new versions side by side |

### Simple version tracking (in-place updates)

For most applications -- where you upgrade and the old version simply goes away -- update **Version**, **Go live**, **End of support** and **Retired date** in the create form or the properties drawer. The header version chip and the **Go live** metadata reflect what you set.

This approach keeps everything in a single record. When you upgrade, update the version fields and you're done. History is tracked in the audit log.

**Use this when**: upgrades happen in place with no overlap -- one version replaces another.

### Creating a new version (parallel migrations)

For major application upgrades where you need to run old and new versions in parallel across different environments (e.g., SAP S/4HANA 1909 in Prod while 2023 is in QA), use **Create new version** in the workspace header.

The wizard has three steps:

1. **Version details** -- new application name, version label, **Go live** and **End of support** dates.
2. **Copy options** -- choose what to copy from the source. Defaults shown below.
3. **Interfaces** -- pick which interfaces to migrate to the new version.

The new version is created as a separate application with:
- A **Proposed** lifecycle (ready to configure before go-live)
- A link to its predecessor (used by the version timeline)
- Copied data based on your selections
- Duplicated interfaces pointing to the new version

Classification and continuity values are copied, but the new version starts with a reset review and no copied last recovery test.

### What gets copied

| Option | Default |
|--------|---------|
| Owners (business and IT) | On |
| Companies (audience) | On |
| Departments | On |
| Data residency | On |
| Links | On |
| Support contacts | On |
| Budget items (OPEX + CAPEX, paired) | On |
| Contracts | On |
| Deployments | Off |
| Deployment bindings | Off (only available when Deployments is selected) |

**Not copied** (must be set up fresh): suite membership, attachments, server assignments.

### Interface migration

During version creation, the wizard shows all interfaces where this application is source, target, or middleware (when ETL is enabled). Selected interfaces are duplicated with their references updated to the new version. Each migrated interface includes its legs, owners, companies, key identifiers, links, and data residency. Migrated interfaces start with a **Proposed** lifecycle. The original interfaces stay linked to the old version.

**Copying bindings**: If you select both **Deployments** and **Deployment bindings**, interface bindings are also copied. Bindings are mapped to the new application's deployments (matched by environment); environment-specific details (endpoints, authentication, job names) are cleared, and binding status is reset to **Proposed**.

**ETL/Middleware applications**: If the application has **Data integration / ETL** enabled, the wizard also shows interfaces that *flow through* this application as middleware. These are interfaces where another source sends data to another target via your ETL. Copying them creates new interface definitions for the upgraded ETL with middleware references properly updated.

**Tip**: Use this when upgrading your ERP or ETL: migrate the critical interfaces and optionally copy bindings to get a head start on environment configuration.

---

## Copying applications

There are two ways to copy an application in KANAP:

### Copy item (from the Applications grid)

Use this when you want to create an independent duplicate of an application -- typically to create a similar application entry without version lineage.

1. Select an application in the grid
2. Click **Copy item**
3. The system creates a copy with " (copy)" appended to the name
4. You're navigated to the new application to make changes

**What gets copied**: All core fields (except last DR test date), including classification and continuity values, owners, companies, departments, suites, OPEX/CAPEX items, contracts, links, data residency, and support contacts. The copied application's review is reset.

**What does NOT get copied**: Deployments, interfaces, server assignments, attachments, version fields (version, go-live date, end of support).

### Comparison: Copy item vs Create new version

| Aspect | Copy item | Create new version |
|--------|-----------|-------------------|
| **Purpose** | Independent duplicate | Versioned successor with lineage |
| **User options** | None (automatic) | 3-step wizard |
| **Lineage** | No predecessor link | Sets predecessor |
| **Lifecycle** | Preserved | Reset to Proposed |
| **Name** | "(copy)" suffix | User-specified |

**Relations**:

| Relation | Copy item | Create new version |
|----------|-----------|--------------------|
| Owners (business and IT) | Yes | Optional (default: yes) |
| Companies (audience) | Yes | Optional (default: yes) |
| Departments | Yes | Optional (default: yes) |
| Data residency | Yes | Optional (default: yes) |
| Links | Yes | Optional (default: yes) |
| Support contacts | Yes | Optional (default: yes) |
| Suites (membership) | Yes | No |
| OPEX items | Yes | Optional (default: yes) |
| CAPEX items | Yes | Optional (default: yes) |
| Contracts | Yes | Optional (default: yes) |
| Deployments | No | Optional (default: no) |
| Bindings | No | Optional (default: no) |
| Interfaces | No | User-selected |
| Server assignments | No | No |
| Attachments | No | No |

**Core fields**:

| Field | Copy item | Create new version |
|-------|-----------|--------------------|
| Description | Yes | Yes |
| ETL enabled | Yes | Yes |
| Support notes | Yes | Yes |
| Last DR test | No | No |
| Version fields | No | User-specified |
| Users override | Yes | Reset to null |
| Users year | Yes | Reset to current year |

---

## CSV import/export

Maintain your application inventory at scale using CSV import and export. This feature supports bulk operations for initial data loading, periodic updates from external systems, and data extraction for reporting.

### Accessing CSV features

From the Applications list:
- **Export CSV**: Download applications to a CSV file
- **Import CSV**: Upload a CSV file to create or update applications
- **Download Template** (from inside the import dialog): Get a blank CSV with correct headers

**Permissions required**: `applications:admin` for import/export operations.

### Export options

**Presets**:

| Preset | Description |
|--------|-------------|
| **Full Export** | All exportable fields including computed/read-only data (timestamps, data residency, user metrics) |
| **Data Enrichment** | Only importable fields -- ideal for round-trip editing workflows |

**Template export**: Downloads headers only -- useful for preparing import files with the correct structure. The template includes all importable fields.

**Custom selection**: Choose specific fields to include in your export.

### Import workflow

1. **Prepare your file**: Use UTF-8 encoding with semicolon (`;`) separators. Download a template to ensure correct headers.

2. **Choose import settings**:
   - **Mode**:
     - `Enrich` (default): Empty cells preserve existing values -- only update what you specify
     - `Replace`: Supplied fields are replaced; blank classification cells preserve their values and `__CLEAR__` explicitly clears them
   - **Operation**:
     - `Upsert` (default): Create new applications or update existing ones
     - `Update only`: Only modify existing applications, skip new ones
     - `Insert only`: Only create new applications, skip existing ones

3. **Validate first**: Click **Preflight** to validate your file without making changes. Review errors and warnings.

4. **Apply changes**: If validation passes, click **Import** to commit changes.

### Field reference

**Overview fields**:

| CSV Column | Description | Required | Notes |
|------------|-------------|----------|-------|
| `id` | Application UUID | No | For updates; leave blank for new applications |
| `name` | Application name | Yes | Used as unique identifier for matching |
| `description` | What the application does | No | |
| `category` | Primary purpose | No | Accepts code or label from Settings |
| `supplier_name` | Vendor name | No | Must match existing supplier |
| `editor` | Software publisher | No | Free text (e.g., Microsoft, SAP) |
| `criticality` | Business criticality | No | Accepts code or label from Settings; `__CLEAR__` clears it |
| `lifecycle` | Current status | No | Accepts code or label from Settings |
| `is_suite` | Can have child apps | No | `true` or `false` |
| `status` | Enabled/disabled | No | `enabled` or `disabled` |

**Version fields**:

| CSV Column | Description | Notes |
|------------|-------------|-------|
| `version` | Current version | Free text |
| `go_live_date` | When version went live | Date format: YYYY-MM-DD |
| `end_of_support_date` | Vendor support end date | Date format: YYYY-MM-DD |
| `retired_date` | Decommission date | Date format: YYYY-MM-DD |

**Technical fields**:

| CSV Column | Description | Notes |
|------------|-------------|-------|
| `access_methods` | How users access | Comma-separated codes or labels from Settings (e.g., `web,mobile,vdi`) |
| `external_facing` | Internet accessible | `true` or `false` |
| `etl_enabled` | Data integration | `true` or `false` |
| `support_notes` | Support information | Free text |
| `licensing` | License terms | Free text |
| `notes` | Internal notes | Free text |

**Compliance fields**:

| CSV Column | Description | Notes |
|------------|-------------|-------|
| `data_class` | Data classification | Accepts code or label from Settings |
| `last_dr_test` | Last DR test date | Date format: YYYY-MM-DD |
| `contains_pii` | Stores personal data | `true` or `false` |
| `data_residency` | Data storage countries | Export only (ISO codes) |

**Classification fields**:

| CSV Column | Description | Notes |
|------------|-------------|-------|
| `criticality` | Business criticality level | Tenant catalog code or unambiguous label |
| `cyber_criticality` | Cyber consequence level | Tenant catalog code or unambiguous label |
| `recovery_wave` | Recovery order | Tenant catalog code or unambiguous label |
| `rto_minutes` / `rpo_minutes` | Recovery objectives | Whole minutes; RPO may be zero |
| `classification_justification` | Classification reasoning | Free text |

A blank classification cell preserves the existing value in both Enrich and Replace modes; use the literal `__CLEAR__` to clear a classification.

**Owner fields**:

| CSV Column | Description | Notes |
|------------|-------------|-------|
| `business_owner_email_1` through `_4` | Business owner emails | Must match existing users by email |
| `it_owner_email_1` through `_4` | IT owner emails | Must match existing users by email |

**Export-only fields** (included in Full Export but not importable):

| CSV Column | Description |
|------------|-------------|
| `data_residency` | Data storage countries (ISO codes, comma-separated) |
| `users_mode` | User count method (`manual`, `it_users`, `headcount`) |
| `users_year` | Reference year for user calculations |
| `users_override` | Manual user count override |
| `created_at` | Record creation timestamp |
| `updated_at` | Last modification timestamp |

### Label and code acceptance

For fields configured in **IT Landscape > Settings**, you can use either the internal code or the display label:

| Field | Example codes | Example labels |
|-------|---------------|----------------|
| Category | `lob`, `productivity`, `security` | `Line-of-business`, `Productivity`, `Security` |
| Lifecycle | `active`, `proposed`, `deprecated` | `Active`, `Proposed`, `Deprecated` |
| Data Class | `public`, `internal`, `confidential` | `Public`, `Internal`, `Confidential` |

The system automatically normalizes values during import, so `Line-of-business`, `line-of-business`, and `lob` all resolve to the same category.

### Matching and updates

Applications are matched by **name** (case-insensitive). When a match is found:
- With `Enrich` mode: Only non-empty CSV values update the application
- With `Replace` mode: All supplied fields are updated; blank classification cells preserve existing classifications, and `__CLEAR__` explicitly clears them

If you include the `id` column with a valid UUID, matching uses ID first, then falls back to name.

### Limitations

- **Deployments not included**: Environment deployments (Prod, QA, Dev) require workspace configuration
- **Server assignments excluded**: Server bindings must be set up in the Deployments tab
- **Interfaces excluded**: Integration definitions are not part of CSV import/export
- **Maximum 4 owners per type**: Up to 4 business owners and 4 IT owners can be imported/exported
- **User metrics are export-only**: Audience and user count fields (`users_mode`, `users_year`, `users_override`) are managed in the workspace
- **Data residency is export-only**: Country selections must be managed in the Compliance tab

### Troubleshooting

**"File isn't properly formatted" error**: This usually indicates an encoding issue. Ensure your CSV is saved as **UTF-8**:

- **In LibreOffice**: When opening a CSV, select `UTF-8` in the Character set dropdown (not "Japanese (Macintosh)" or other encodings). When saving, check "Edit filter settings" and choose UTF-8.
- **In Excel**: Save As > CSV UTF-8 (Comma delimited), then open in a text editor to change commas to semicolons.
- **General tip**: If you see garbled characters (`?¿`, `ï»¿`) at the start of your file, the encoding is incorrect.

### Example CSV

```csv
name;category;supplier_name;criticality;lifecycle;go_live_date;external_facing
Salesforce CRM;Line-of-business;Salesforce Inc;Critical;Active;2020-01-15;true
Microsoft 365;Productivity;Microsoft;high;active;2019-06-01;false
Custom ERP;lob;;Moderate;Active;2018-03-20;false
```

---

## Tips

- **Start with critical apps**: Document your business-critical applications first, then work down the criticality levels.
- **Use Suites for grouping**: Enable "Can have child apps" in the Operations tab to mark an application as a Suite that groups related components (e.g., SAP modules under an SAP Suite).
- **Link to spend early**: Connect OPEX, CAPEX and contracts in the Relations tab to see the full cost picture for each application.
- **Keep deployments current**: The Deployments tab drives the environment chips in the list -- keep it updated for accurate visibility.
- **Document the audience**: Set company and department audiences in the properties drawer; the user count is then derived automatically and used in reports.
- **Leverage category filtering**: Use the Category column filter to focus on specific application types (e.g., show only Line-of-business apps, or exclude Productivity tools).
- **Attach knowledge early**: Link runbooks and architecture documents from the Overview tab so the team knows where to look during incidents.
- **Tasks come from the Tasks page**: To attach a task to an application, set the App / Service field on the task itself; it will then appear under Relations > Tasks.
