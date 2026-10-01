# Companies

Companies are the foundation of your master data. They represent the legal entities you allocate IT spend to and report chargebacks for. Every allocation, cost item, and many reports reference a company, so keeping this data accurate is important.

When your workspace is created, it starts with one company named after your organization. Its country is the one you selected during trial signup, and it will auto-assign to the default Chart of Accounts for that country when available. You can rename it or add more.

## Getting started

Navigate to **Master Data > Companies** to open the list.

**Required fields**:

- **Name**: a unique label your teams recognize
- **Country**: ISO country code (searchable by name or code)
- **City**: city where the company is based
- **Base Currency**: ISO currency code (searchable by name or code)

**Tip**: Keep names unique to avoid confusion in imports and selection lists.

## Working with the list

The list shows all companies for your workspace. Use it to review key information at a glance, find companies quickly, and open workspaces for editing.

**Default columns**:

| Column | What it shows |
|---|---|
| **Name** | Company name (click to open the workspace) |
| **Country** | ISO country code |
| **Currency** | Base currency code |
| **Headcount (year)** | Headcount for the selected year (click to open the Details tab) |
| **IT Users (year)** | IT users for the selected year (click to open the Details tab) |
| **Turnover (year)** | Turnover for the selected year (click to open the Details tab) |
| **Status** | Enabled or Disabled |

**Additional columns** (hidden by default, add them from the column chooser):

| Column | What it shows |
|---|---|
| **City** | City |
| **Postal Code** | Postal code |
| **Address 1** | Primary address line |
| **Address 2** | Secondary address line |
| **State** | State or province |
| **Notes** | Free-text notes |
| **Created** | Date and time the record was created |

**Filtering**:

- **Quick search**: free-text search across all visible columns
- **Column filters**: click any column header to filter by value; numeric columns (Headcount, IT Users, Turnover) support number filters
- **Status scope**: the **Show: All / Enabled / Disabled** toggle above the list controls which companies appear. The list shows enabled companies by default

**Year selector**: use the **Year** field in the toolbar to switch which year's metrics are displayed. The bottom row shows **totals** for Headcount, IT Users, and Turnover across all visible (filtered) companies.

**Actions**:

- **New**: create a company (requires `companies:manager`)
- **Import CSV**: bulk-import companies from a CSV file (requires `companies:admin`)
- **Export CSV**: export companies and their metrics to CSV (requires `companies:admin`)
- **Delete Selected**: delete one or more selected companies (requires `companies:admin`; only possible if nothing references the company)

**Search context**: when you open a company workspace from the list, your current search, filters, sort order, and year are preserved. Navigating back to the list restores your previous view.

## Permissions

| Action | Required level |
|---|---|
| View the list and workspaces | `companies:reader` |
| Create or edit companies | `companies:manager` |
| Import, export, or delete | `companies:admin` |

## The company workspace

Click a company name in the list to open its workspace. The workspace has two tabs arranged vertically on the left: **Overview** and **Details**.

Use **Prev** / **Next** to move between companies without returning to the list. Click **Close** (X) to return to the list with your search context intact.

If you have unsaved changes, the app prompts you to save before switching tabs, navigating to another company, or changing years.

---

### Overview

The Overview tab holds general information about the company.

**What you can edit**:

- **Name** (required): the company display name
- **Country** (required): ISO country code, searchable by name or code
- **Chart of Accounts**: the CoA linked to this company (see below)
- **Address 1**, **Address 2**: address lines
- **Postal Code**: postal / ZIP code
- **City** (required): city name
- **State**: state or province
- **Registration #**: company registration number
- **VAT #**: VAT identification number
- **Base Currency** (required): ISO currency code, searchable by name or code
- **Lifecycle**: the status switch, labelled with the current state (**Enabled** or **Disabled**), and the **End of validity** date. See [Status and lifecycle](#status-and-lifecycle)
- **Notes**: free-text notes

---

### Details

The Details tab manages **yearly metrics**. Use the year tabs at the top to switch between years (current year plus two years before and after).

**What you can edit**:

- **Headcount** (required): total employee count for the year, must be a non-negative integer
- **IT Users** (optional): number of IT users, must be a non-negative integer
- **Turnover** (optional): revenue in millions of the company's base currency, up to 3 decimal places

**How it works**:

- Each save applies only to the currently selected year
- If metrics for the year are **frozen**, the fields are read-only; unfreeze them from **Master Data Administration** to make changes
- You need `companies:manager` to edit metrics

## Chart of Accounts

Each company can be linked to a **Chart of Accounts** (CoA), which defines the set of accounts available when recording OPEX or CAPEX items for that company.

**How it works**:

- When you create a company, it is automatically assigned to the default CoA for its country (if one exists). If no country default exists, the global default CoA is used.
- You can change the CoA assignment in the company's **Overview** tab using the **Chart of Accounts** selector. The selector shows CoAs matching the company's country plus any global-scope CoAs.
- The CoA you select determines which accounts appear in the account dropdown when creating or editing spend items for this company.

**What this means for your workflow**:

- **Companies with a CoA**: when recording OPEX/CAPEX, you can only select accounts that belong to that company's Chart of Accounts. This ensures accounting consistency.
- **Companies without a CoA** (legacy): can use accounts that do not belong to any Chart of Accounts. This supports gradual migration to the CoA system.
- **Changing CoAs**: if you switch a company to a different CoA, existing spend items keep their current accounts (with a warning if they do not match the new CoA), but new items will use accounts from the new CoA.

**Setting up Charts of Accounts**: go to **Master Data > Charts of Accounts** to view, create, or manage your CoA sets. You can create CoAs from scratch or load them from platform templates (country-specific standard account sets). Each country can have one default CoA that is automatically assigned to new companies from that country.

**Tip**: if you see an "obsolete account" warning when editing OPEX/CAPEX items, it means the account does not belong to the company's current Chart of Accounts. Update the account to one from the correct CoA to resolve this.

## Status and lifecycle

Use the **End of validity** to control when a company stops being active.

- Companies are **Enabled** by default. Leave the **End of validity** blank to keep the company active indefinitely, or schedule a future date.
- Switching the company to **Disabled** without a date sets its end of validity to today.
- When the end of validity passes, the status switches to **Disabled** on its own within the hour.
- After the end of validity:
    - The company no longer appears in selection lists for new allocations and is excluded from reports for strictly later years.
    - Historical data remains intact; the company still appears in reports covering years when it was active.
- **Prefer disabling over deleting.** Deletion is only possible if nothing references the company (no allocations, spend or cost centers). A company that cost centers belong to is refused with a message such as "Company A is used by 3 cost centers. Change their company or disable it instead."

## Yearly metrics

Many parts of the app are year-aware. Companies have metrics per year:

- **Headcount** (required for the year)
- **IT Users** (optional)
- **Turnover** (optional, in millions of the company's base currency)

**Where it matters**:

- Allocations can use Headcount, IT Users, or Turnover to distribute costs across companies for a given year.
- Reports use these metrics for KPIs and ratios.
- Only companies active for a year are considered for that year's allocation and reporting.

**Freeze and copy**:

- You can **freeze** a year once finalized to prevent edits.
- Use **Master Data Administration** to copy metrics from one year to another (choose which metrics to copy). Frozen years cannot be overwritten.

## CSV import/export

Keep large sets in sync with your source systems using CSV (semicolon `;` separated).

**Export**:

- **Template**: header-only file you can fill in (includes dynamic columns for Y-1, Y, Y+1 based on the selected year)
- **Data**: current companies plus their metrics for Y-1 / Y / Y+1

**Import**:

- Start with **Preflight** (validates headers, encoding, required fields, duplicates, and metrics)
- If Preflight is OK, **Load** will apply inserts and updates
- Matching is by company **name** (within your workspace). Duplicates in the file are deduplicated by name (first occurrence wins)
- **Required fields**: Name, Country (2 letters) and Base Currency (3 letters). City is optional in the file
- **Optional field**: `coa_code` (references a Chart of Accounts; if omitted, the default CoA for the country is used)
- **Status and end of validity**: `status` is `enabled` or `disabled`, and `disabled_at` is the end of validity, a date (`2026-12-31`) or a full date and time. The export writes the status read from the end of validity. A new company is enabled unless the row says `disabled`. On an update, a blank `status` and a blank `disabled_at` keep the stored values. `enabled` with an empty date clears the end of validity. `disabled` with an empty date keeps a date that has already passed, and otherwise ends the company today
- A row whose status contradicts its date is refused with a row error: "Status is enabled but the end of validity has passed. Clear the date or set the status to disabled. If the file comes from an older export, export the data again." or "Status is disabled but the end of validity is still to come. Set the status to enabled or set a date that has passed."
- **Metrics**: if you provide any metrics for a year, Headcount is required for that year; IT Users and Turnover are optional. Turnover accepts up to 3 decimals and must be expressed in millions of the company's base currency

**Notes**:

- Use **UTF-8 encoding** and **semicolons** as separators
- The list refreshes automatically after a successful load
- If importing with `coa_code`, ensure the Chart of Accounts exists in your workspace first

## Tips

- **Disable over delete**: keep history consistent and reports meaningful.
- **Chart of Accounts**: assign CoAs to companies to ensure consistent account usage across OPEX/CAPEX items.
- **Turnover**: enter values in millions of the company's base currency (e.g., 2.5 = 2.5 million in that currency).
- **Headcount** is the most common allocation driver; keep it up to date for the current year.
- **Frozen metrics**: you can still review them, but edits are blocked until you unfreeze from Administration.
- **Column chooser**: use it to show or hide columns like City, Address, State, or Created to suit your workflow.
- **Metric columns link to Details**: clicking a Headcount, IT Users, or Turnover value opens the Details tab directly for that company.
