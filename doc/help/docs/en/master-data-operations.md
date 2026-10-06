# Freeze master data and copy yearly metrics

Two tools of [Budget Administration](budget-operations.md) manage company and department metrics across fiscal years: **Freeze master data** and **Copy yearly metrics**. Use them to lock finalized numbers, to carry a baseline forward into next year's planning, or to check what is frozen and what is not.

The yearly metrics are the headcount, IT users and turnover of companies and the headcount of departments. They are master data, and the budget cycle freezes and rolls them forward, so the two tools sit with the other budget operations.

## Where to find it

- Workspace: **Budget management**
- Path: **Budget management > Administration**, section **Operations**, tiles **Freeze master data** and **Copy yearly metrics**
- Permissions:
  - Access to the budget (reader access to OPEX, CAPEX or Budget administration), plus one of `companies:admin`, `departments:admin` or `budget_ops:admin`
  - The tiles are hidden from other users

Master data has no Administration entry of its own.

---

## Freeze master data

Use this tool to lock or unlock company and department metrics for a specific year. Freezing prevents accidental edits after data has been finalized -- useful at year-end close, during audits, or before kicking off next year's budget cycle.

### How it works

1. Select the **Year** you want to manage (range covers the previous year through five years ahead)
2. Check the scopes you want to act on: **Companies**, **Departments**, or both
3. Click **Freeze Data** to lock, or **Unfreeze Data** to unlock

The page shows a status card for each scope:

- **Frozen** (red) -- data is read-only for that year; the card shows who froze it and when
- **Editable** -- data can still be modified

### What freezing affects

Freezing locks the yearly metrics on the **Details** tab of Companies (headcount, IT users, turnover) or Departments (headcount). It does not affect:

- The Overview tab (name, description, and other general fields)
- OPEX or CAPEX items

### Permissions

You need admin access on the relevant scope to freeze or unfreeze:

| Scope | Required permission |
|---|---|
| Companies | `companies:admin` or `budget_ops:admin` |
| Departments | `departments:admin` or `budget_ops:admin` |

If you are admin of one scope only, the other scope is greyed out. The freeze status of both scopes stays visible.

---

## Copy yearly metrics

Copy company and department metrics from one fiscal year to another. A built-in dry run lets you preview every row before committing, so you always know what will be overwritten.

### How it works

1. Select a **Source Year** (where to read values from)
2. Select **Data Sources**: Companies, Departments, or both
3. Select a **Destination Year** (where to write values to)
4. If Companies is selected, pick which **Company Metrics** to copy -- any combination of Headcount, IT Users, and Turnover
5. Click **Dry Run** to generate a preview
6. Review the preview table
7. Click **Copy Data** to apply the changes

### Preview table columns

| Column | What it shows |
|---|---|
| **Type** | Company or Department |
| **Name** | Entity name |
| **Metric** | Headcount, IT Users, or Turnover |
| **Source Value** | The value from the source year |
| **Current Destination** | The existing value in the destination year (if any) |
| **New Value** | The value that will be written -- shown in bold |
| **Status** | "Ready to copy" or the reason the row was skipped |

Skipped rows appear in a warning colour. Common skip reasons:

- Source value is null or empty
- Destination year is frozen for that scope
- Entity is not active for the destination year

### Summary cards

Below the grid, four summary cards give you a quick count:

- **Total rows** -- everything the operation evaluated
- **Ready to copy** -- rows that will be written
- **Skipped** -- rows excluded (with reasons visible in the table)
- **Errors** -- rows that failed during the actual copy

### Frozen data protection

You cannot copy data into a frozen year. If the destination year is frozen for Companies or Departments, an error banner appears and the action buttons are disabled. Unfreeze the destination year first with **Freeze master data**.

### CSV export

You can export the preview table to CSV using the export button in the toolbar. This is handy for offline review or sharing with colleagues before committing. This export writes the table as it is shown. The files the master data pages import are described in [CSV files](csv-files.md).

### Permissions

The same rules apply as for freezing:

| Scope | Required permission |
|---|---|
| Companies | `companies:admin` or `budget_ops:admin` |
| Departments | `departments:admin` or `budget_ops:admin` |

If you only have access to one scope, the other is greyed out in the Data Sources selector.

---

## Common scenarios

### Protecting finalized year-end data

Your 2025 budget is approved. Lock it so no one accidentally changes the numbers.

1. Open **Budget management > Administration > Freeze master data**
2. Select year **2025**
3. Check **Companies** and **Departments**
4. Click **Freeze Data**

All company and department metrics for 2025 are now read-only until you unfreeze them.

### Bootstrapping next year's budget

You want to start 2026 planning using 2025 headcount and turnover as a baseline.

1. Open **Budget management > Administration > Copy yearly metrics**
2. Set **Source Year** to **2025** and **Destination Year** to **2026**
3. Under **Data Sources**, select **Companies**
4. Under **Company Metrics**, select **Headcount** and **Turnover** (deselect IT Users if you do not need it)
5. Click **Dry Run** and review the preview
6. Click **Copy Data**

All companies now carry 2025's headcount and turnover into 2026. Adjust individual values as needed.

### Making a correction to frozen data

You froze 2025 but spotted an error in one company's headcount.

1. Open **Budget management > Administration > Freeze master data**
2. Select year **2025**, check **Companies**, and click **Unfreeze Data**
3. Edit the company's headcount in **Master Data → Companies → Details**
4. Return to **Freeze master data** and re-freeze 2025 Companies

---

## Frequently asked questions

**What happens if I try to edit a frozen year?**
The Details tab for Companies or Departments becomes read-only for that year. You will see a message indicating the data is frozen. Unfreeze to make changes.

**Does freezing affect OPEX or CAPEX items?**
No. Freezing only locks yearly metrics (headcount, IT users, turnover) on Companies and Departments. OPEX and CAPEX items are unaffected.

**Can I copy data to a frozen year?**
No. The Copy tool will show an error and disable the action buttons. Unfreeze the destination year first.

**What happens if the destination already has values?**
The copy operation overwrites them. Always run a Dry Run first so you can see the "Current Destination" column and understand what will be replaced.

**Can I undo a copy?**
No. Copy operations are not reversible. If you need a safety net, export the destination year's data to CSV before copying.

**Why are some rows skipped?**
Rows are skipped when the source value is null, the entity is inactive for the destination year, or the destination is frozen. The Status column in the preview tells you which reason applies.

**Can I copy only specific companies or departments?**
No. The tool copies all entities for the selected scopes and metrics. For selective updates, use CSV export/import on the individual Companies or Departments pages instead.

**Does the copy create new companies or departments?**
No. It only writes metrics for entities that already exist in both years. If a company exists in the source year but not the destination, that row is skipped.

**Who can see freeze status?**
Anyone who can open this page, that is admins of companies, departments or Budget administration. Each admin freezes or unfreezes their own scope.

**Can I freeze future years?**
Yes. The year picker covers a range from last year through five years ahead. Freezing a future year is useful for locking approved budgets before the fiscal year starts.

---

## Tips

- **Always dry run first** -- review the preview table before committing to avoid accidental overwrites
- **Freeze after approval** -- lock data as soon as budgets are signed off to prevent drift
- **Unfreeze temporarily** -- make your correction, then re-freeze right away
- **Copy early** -- start the next planning cycle by copying current-year metrics forward, then adjust for expected changes
- **Check your permissions** -- if a scope is greyed out, ask an admin to grant you the right access level
