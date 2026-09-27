# OPEX

OPEX (Operating Expenditure) items are your recurring IT costs: software licenses, cloud subscriptions, maintenance contracts, and services. This is where you plan budgets, track actuals, and allocate costs across your organization.

The OPEX workspace helps you manage each spend item from initial budgeting through execution and reporting -- all in one place with year-by-year budget columns, flexible allocation methods, and direct links to suppliers, contracts, applications, and projects.

## Getting started

Navigate to **Budget Management > OPEX** to see your list. Click **New** to create your first item.

The workspace opens in creation mode, with the **Properties** panel open on the right. Type the product name in the title at the top, fill in the properties, then click **Create**.

**Required fields**:
  - **Product name** (the title): What you are spending on (e.g., "Salesforce Licenses", "AWS Compute")
  - **Supplier**: Who you are paying. Links to your Suppliers master data
  - **Paying company**: Which company is paying the supplier (required for accounting)
  - **Account**: The general ledger account for this spend. Only accounts from the paying company's Chart of Accounts will appear
  - **Currency**: ISO code (e.g., USD, EUR). Defaults to your workspace currency; you can override per item
  - **Effective start**: When this spend begins (DD/MM/YYYY)

**Optional but useful**:
  - **Analytics category**: Custom grouping for reporting (e.g., "Infrastructure", "Business Apps"). New categories can be created on the fly
  - **End of validity**: The date this spend stops. Leave it blank if there is no end. After it, the item is disabled and later years no longer count in the budget views
  - **IT owner** / **Business owner**: Who is responsible
  - **Description** and **Notes**: Free text on the Overview tab

Once the item is created, the workspace unlocks all four tabs: **Overview**, **Budget**, **Allocations**, and **Relations**.

**Tip**: You can create items quickly and fill in budgets and allocations later. Start with the essentials and iterate.

---

## Working with the OPEX list

The OPEX list (at **Budget Management > OPEX**) is your main view for browsing, filtering, and navigating spend items.

**Default columns**:
  - **Product Name**: The item name (links to the Overview tab)
  - **Supplier**: The supplier name
  - **Paying Company**: Which company pays for this item
  - **Contract**: The latest linked contract name (links to the Contract workspace)
  - **Account**: The GL account number and name
  - **Allocation**: The allocation method label for the current year (links to the Allocations tab)
  - **Y Budget**: Current-year budget amount (links to the Budget tab for this year)
  - **Y expected landing**: Current-year expected landing amount (links to the Budget tab for this year)
  - **Task**: The latest task title (links to the Overview tab, where the Tasks panel sits)

**Additional columns** (hidden by default, toggle via the column chooser):
  - **Y-1 Budget / Y-1 expected landing**: Prior-year figures
  - **Y Revision / Y actuals**: Current-year revision and actuals amounts
  - **Y+1 Budget / Y+1 Revision**: Next-year figures
  - **Y+2 Budget**: Two-years-out budget
  - **Enabled**: Item status (enabled or disabled)
  - **Description**: Item description
  - **Currency**: ISO currency code
  - **Effective Start**: Start date
  - **End of validity**: Date the item stops (blank means no end)
  - **IT Owner / Business Owner**: Responsible users
  - **Analytics**: Analytics category name
  - **Project ID**: Linked project identifier
  - **Notes**: Internal notes
  - **Created / Updated**: Timestamps

**Filtering**:
  - **Quick search**: Searches across product name, supplier, description, and other text fields. Filters the list in real-time as you type
  - **Column filters**: Click the filter icon in any column header. **Paying Company**, **Account**, **Allocation**, **Currency**, **IT Owner**, **Business Owner**, and **Analytics** use checkbox set filters (multi-select). Other columns use text or number filters
  - **Status scope**: Use the **Show: Enabled / Disabled / All** toggle above the grid (defaults to **Enabled**)

**Sorting**:
  - Click a column header to sort ascending/descending
  - Default sort is by **Y Budget** descending
  - The list remembers your last sort, search, and filters when you return

**Totals row**:
  - The pinned row at the bottom shows totals for all budget columns
  - Totals respect your current filters and search

**Deep linking**:
  - Clicking any cell opens the workspace on the most relevant tab:
    - **Product Name**, **Supplier**, **Paying Company**, **Account**, and other general columns: Opens the **Overview** tab
    - **Budget columns** (Y Budget, Y expected landing, Y-1 Budget, etc.): Opens the **Budget** tab pre-set to that year
    - **Allocation**: Opens the **Allocations** tab for the current year
    - **Task**: Opens the **Overview** tab, where the Tasks panel sits
    - **Contract**: Opens the linked Contract workspace directly (not the OPEX workspace)

**Actions**:
  - **New**: Create a new OPEX item (requires `opex:manager`)
  - **Import CSV**: Bulk-load items from CSV (requires `opex:admin`)
  - **Export CSV**: Export items to CSV (requires `opex:admin`)
  - **Delete Selected**: Bulk-delete selected items (requires `opex:admin`; select rows via checkboxes)

**Prev/Next navigation**:
  - When you open an item, the workspace shows **Prev** and **Next** buttons
  - These navigate through the list in the current sort order, respecting filters and search
  - Moving to another item saves your pending edits first
  - Your list context (sort, filters, search) is preserved when you close the workspace

**Tip**: Use column filters + quick search to build focused views (e.g., "All cloud spend over 10k"), then navigate item-by-item with Prev/Next to review budgets.

---

## The OPEX workspace

Click any row in the list to open the workspace. It has four parts:

  - **Header**: the item reference (e.g., `OPX-12`) with a copy button, the product name (click it to rename the item), **Prev** / **Next**, **Send link**, and the close button
  - **Metadata bar** under the title: **Status**, **IT owner**, and **Business owner**, each editable in place
  - **Four tabs**: **Overview**, **Budget**, **Allocations**, and **Relations** (the Relations tab shows how many links the item has)
  - **Properties panel** on the right: the item's main fields. Open or close it with the properties button; the workspace remembers your choice

**Autosave**:
  - Every change saves automatically. A **Saving...** / **Saved** hint shows in the header
  - Switching tabs, moving to the previous or next item, or closing the workspace saves pending edits first. If a save fails, you stay where you are and an error explains why, so no edit is lost silently
  - **Ctrl+S** (**Cmd+S** on Mac) saves immediately

### Overview

The Overview tab holds the free-text fields and the tasks of the item.

**What you can edit**:
  - **Description**: What the spend covers
  - **Notes**: Free-form internal notes

**Tasks panel**:
  - Lists every task linked to this OPEX item, with **Title**, **Status**, **Priority**, **Due date**, and **Actions** columns. The panel title shows the number of tasks
  - **Status** filter: All (default), Active (not done), Open, In progress, Pending, In testing, Done, or Cancelled. The clear button resets it
  - Click **Add task** to open a new task already linked to this item. Fill in the title, description, priority, assignee, and due date in the task workspace
  - Use the open icon to go to a task, and the delete icon to delete it (you confirm first)
  - Tasks have their own permissions (`tasks:member` to create and edit). OPEX manager access does not grant task editing rights on its own; check with your admin if you cannot create tasks
  - Tasks can also be viewed and managed from **Portfolio > Tasks**, which shows all tasks across your organization

**Properties panel**:
  - **Supplier**, **Paying company**, **Account** (filtered by the paying company's Chart of Accounts), **Currency** (only the currencies allowed in your workspace), **Analytics category**, and **Effective start**
  - **Lifecycle**: the **Enabled** switch and the **End of validity** date. See [Status and Lifecycle](#status-and-lifecycle)
  - **Created** and **Updated** dates (read only)

**Tip**: When you create an item, an "Obsolete account" warning means the selected account does not belong to the paying company's Chart of Accounts. Choose a different account to resolve the warning.

---

### Budget

The Budget tab is where you enter financial data per year. It supports multiple budget columns and two input modes, shown as tabs: **Flat** (annual totals) and **Monthly** (monthly breakdown).

**Year selection**:
  - Use the year tabs at the top to switch between Y-2, Y-1, Y (current year), Y+1, and Y+2
  - Each year has its own version, mode, and amounts
  - Switching years saves your pending edits first

**Budget columns**:
  - **Budget**: Initial annual budget approved at the start of the year
  - **Revision**: Mid-year budget update (e.g., after a reforecast)
  - **Actuals**: Expected actual spend (your best estimate as the year progresses)
  - **Expected landing**: Final actual spend after year-end close

**Period of a column**:
  - Every column (Budget, Revision, Forecast, Actuals and Expected landing) has a period inside the year, for example April to December
  - A month counts when the period covers its 15th. A period that starts on April 10 includes April; one that starts on April 20 begins in May
  - A column with no amount and no period yet gets a suggestion: the item's **Effective start** and **End of validity**, limited to the year. An item that starts on April 1 suggests April to December
  - A column that already holds amounts and has no period reads as the whole year, so existing data behaves as before

**Flat vs Monthly**:
  - **Flat**: Enter one total per column. The total is spread evenly over the months of the column's period, and the months outside it are set to zero. The period shows under each total before you type, for example "9 months, April to December". Only the total you edit is saved. The other columns keep their monthly amounts.
  - Click the pencil icon next to the period under a total (**Change period**) to open the spread panel on that column, with its current total. If the item's dates leave no month in the year, the total is disabled and reads "No month of 2026 is within the item's dates." Click the pencil icon next to it (**Choose the period**) to set one yourself.
  - **Monthly**: Enter amounts per month (Jan-Dec) for each column, plus a **Forecast** column for additional planning. Quarter subtotals and a yearly total are shown. Only the months you change are saved.
  - Switch between modes with the **Flat** and **Monthly** tabs. Switching does not change your amounts.

**Freeze behavior**:
  - If a year's budget columns are frozen (via Budget Administration), the corresponding inputs become read-only and show a lock icon
  - You can still view frozen data; admins can unfreeze via **Budget Management > Budget Administration > Freeze/Unfreeze**
  - Each column can be frozen independently (Budget, Revision, Forecast, Actuals, Expected landing)

**Spreading an amount**:
  - The spread panel is always visible in the **Monthly** tab. In the **Flat** tab it opens from the pencil icon under a total
  - Choose a **Column** (Budget, Revision, Forecast, Expected landing or Actuals), check the **Amount**, pick a **Distribution** (**Flat** or **4-4-5**), and set the **From** and **To** dates. The dates start from the column's current period, and the distribution from the column's own
  - The amount starts with the column's current total, in both tabs, and follows when you choose another column. It is empty when the column has no amount
  - **Apply to all columns** is on by default: the selected column, plus Budget, Revision, Forecast and Expected landing, all get the same period and distribution, each with its own current total. Hover the switch to see which columns follow. The other columns keep their own period, and frozen columns never change. Turn the switch off to spread only the selected column
  - **Reset** fills the panel with the column's current total, **Flat** and the whole year. It saves nothing: click **Apply** to use it. With **Apply to all columns** on, **Reset** then **Apply** brings every column back to a flat spread over twelve months
  - Totals typed in the **Flat** tab still apply to their own column only
  - The **From** and **To** dates show the period. When some months fall outside it, the panel says which ones will be set to zero ("January to March will be set to zero."). A whole-year period shows no line. Hover the info icon next to the panel title to see the 15th rule
  - With **4-4-5**, the weights of the months that count are scaled up so the whole amount lands on them
  - A soft warning appears when the period goes beyond the item's dates. You can still apply
  - **Apply** stays disabled while a date is missing or no month counts. Nothing is saved before you click **Apply**
  - From the **Monthly** tab, Apply fills the grid. From the **Flat** tab, you stay in the Flat view

**How each column was produced**:
  - A short label tells you where the amounts of a column come from. In the **Monthly** tab it sits under the column header (hover it to see the period). In the **Flat** tab it sits next to the period
  - **Spread flat**, **Spread 4-4-5** or **Spread by quarter**: the amounts come from a spread
  - **Copied from Budget 2025 +2%**: the amounts come from **Copy budget columns** in Budget Administration, with the percentage shown when there is one
  - **Edited by hand**: a month was changed in the grid or by a budget rows import
  - A column with no label kept the data it had before periods existed

**Monthly tools**:
  - **Clear column**: the icon next to a column header sets every month of that column to zero, for example before entering the whole amount in a single month. It counts as an edit by hand. To remove both the amounts and the period of a column for every item, use **Reset budget column** in Budget Administration

**Multi-year trend**:
  - A chart below the grid shows the item's budget columns across years and updates as you type

**How to use it**:
  1. Select the year you are planning for
  2. Choose the **Flat** or **Monthly** tab
  3. Fill in the relevant columns (Budget for initial planning, Actuals for tracking, Expected landing for the year-end figure)
  4. Your changes save automatically; a **Saving...** / **Saved** hint shows next to the year tabs

**Tip**: For most items, Flat mode is faster. Use Monthly mode when the spend varies significantly by month (e.g., seasonal licensing, one-time setup fees).

---

### Allocations

The Allocations tab distributes the spend across your companies and departments. This drives chargeback reports and cost-per-user KPIs.

**Year selection**:
  - Works the same as Budget: use year tabs to switch between Y-2, Y-1, Y, Y+1, Y+2
  - Each year can have a different allocation method
  - The **Year budget** of the selected year shows on the right, and the table shows each share as a percentage and as an amount

**Allocation methods**:

| Method | How it works |
|---|---|
| **Headcount (default)** | Splits spend proportionally by each company's headcount for the selected year. No manual selection required -- percentages are computed automatically from company metrics. This is the standard default. |
| **IT users** | Splits spend proportionally by each company's IT user count for the selected year. |
| **Turnover** | Splits spend proportionally by each company's turnover (revenue) for the selected year. |
| **Manual by company** | You select which companies receive this spend and choose a driver in **Allocate by** (Headcount, IT users, or Turnover) to calculate percentages among the selected companies only. |
| **Manual by department** | You select specific company/department pairs. Percentages are calculated from each department's headcount. Useful when a spend item benefits only certain departments (e.g., a CRM used by Sales). |
| **Manual percentages** | You pick the companies and type each percentage yourself. The percentages must add up to 100%. |

**Default vs pinned methods**:
  - The **default** entry -- shown as *Headcount (default)* until your organisation configures another method -- follows the setting in **Budget Management > Administration > Default Allocation Method**. Every item left on the default is re-driven when an admin changes that setting
  - That setting can also restrict the default to a **selection of companies** (for example the entity that carries the IT budget): the driver then applies to those companies only, and the option reads *Default (n companies)*
  - **Headcount**, **IT users** and **Turnover** pin that method on the item: a pinned method keeps working even if the organisation default changes later
  - Items with a manual allocation are never affected by the default setting

**How percentages work**:
  - For **automatic methods** (Headcount, IT users, Turnover): percentages are computed from the latest company metrics across your enabled companies. You do not edit them directly
  - For **Manual by company** and **Manual by department**: you pick the companies or departments, and the system calculates percentages from your chosen driver and the current metrics
  - For **Manual percentages**: typing a percentage pins that row, and the remaining rows share what is left. **Split equally** gives every row the same share; **Clear manual pins** releases the pinned rows
  - Percentages reflect live data. If you update a company's headcount, allocations recalculate

**How to use it**:
  1. Select the year
  2. Choose an allocation method in **Method**
  3. For a manual method, use **Add row** to add companies (or company/department pairs) and the remove icon to drop one. For **Manual by company**, pick a driver in **Allocate by**
  4. Changes save automatically

**Common issues**:
  - **Missing metrics**: One or more companies have zero or missing headcount/IT users/turnover for the selected year. Fill in the metrics in **Master Data > Companies** (Details tab)
  - **"Manual percentages must sum to 100%."**: Adjust the rows, or click **Split equally**

**Tip**: Use Headcount (default) for most items -- it is the simplest and updates automatically. Reserve manual methods for spend that benefits specific companies or departments only.

---

### Relations

The Relations tab links this OPEX item to related objects: Projects, Applications, Contracts, Contacts, Relevant websites, and Attachments. Everything on this tab saves automatically.

**Projects**:
  - Use the autocomplete to link one or more projects from your Portfolio
  - This helps group spend by project in reports and enables project accounting
  - Remove a project by clicking the X on its chip

**Applications**:
  - Use the autocomplete to link one or more applications or services from your IT catalogue
  - This helps track which OPEX items fund which applications or services

**Contracts**:
  - Use the autocomplete to link one or more contracts
  - When linked, the contract name appears in the OPEX list **Contract** column for quick reference
  - Contracts can link to multiple OPEX items (many-to-many relationship)
  - Remove a contract by clicking the X on its chip

**Contacts**:
  - Link contacts to this spend item: pick a contact, then pick its role (**Commercial**, **Technical**, **Support**, or **Other**). Choosing the role adds the contact
  - The table shows the role, first name, last name, job title, email, and mobile. Hover the role to see whether the contact comes from the supplier or was added manually
  - Remove a contact with the remove icon
  - Useful for tracking who to reach out to for renewals, support issues, or negotiations

**Relevant websites**:
  - Click **Add URL** to add a link (e.g., vendor portals, documentation, admin consoles, internal wikis). Each link has a **Name** and a **URL**
  - Click a link row to edit it, or use the delete icon to remove it

**Attachments**:
  - Upload files related to this spend item (e.g., contracts, invoices, quotes, SOWs, technical specs)
  - Drag and drop files into the attachment area, or click **Select files** to browse
  - Click a file chip to download the file
  - Delete an attachment with the delete icon on its chip (you confirm first; requires `opex:manager`)

**Tip**: Link contracts to track renewals across multiple OPEX items. Add vendor portal URLs for quick access. Upload quotes and invoices as attachments to centralize all spend-related documentation.

---

## CSV Import/Export

You can bulk-load OPEX items via CSV to speed up initial setup or sync with external systems.

**Export**:
  1. Click **Export CSV** in the OPEX list
  2. Choose:
     - **Template**: Headers only (use this to create a blank CSV to fill in)
     - **Data**: All current OPEX items with budgets for Y-1, Y, and Y+1

**CSV structure**:
  - Delimiter: semicolon `;` (not comma)
  - Encoding: UTF-8 (save as "CSV UTF-8" in Excel)
  - Headers: `product_name;description;supplier_name;company_name;account_number;currency;effective_start;status;disabled_at;owner_it_email;owner_business_email;analytics_category;notes;y_minus1_budget;y_minus1_landing;y_budget;y_follow_up;y_landing;y_revision;y_plus1_budget;y_plus1_revision`
  - `disabled_at` is the end of validity: the date the item stops. Use a date (`2026-12-31`) or a full date and time. Leave it empty if there is no end
  - Older files with an `effective_end` column still import: its date fills the end of validity when `disabled_at` is empty

**Import**:
  1. Click **Import CSV** in the OPEX list
  2. Upload your CSV file (drag-and-drop or file picker)
  3. Click **Preflight** to validate:
     - Headers match exactly
     - Suppliers, accounts, and users exist in your workspace
     - Required fields (product_name, currency, effective_start, paying_company) are present
     - No duplicate product_name + supplier combinations
  4. Review the preflight report (shows counts and up to 5 sample errors)
  5. If OK, click **Load** to import

**Important notes**:
  - **Unique key**: OPEX items are identified by `(product_name, supplier_name)`. If a combination already exists, it is **skipped** (no updates)
  - **Insert-only**: The importer only creates new items; it will not update existing ones. Use the UI to edit existing items
  - **References**: `supplier_name` must match a Supplier by name (case-insensitive). `account_number` must match an Account. `owner_it_email` and `owner_business_email` must match enabled users by email
  - **Analytics Category**: If the category does not exist, it is created automatically during import
  - **Budgets**: Budget columns populate Y-1, Y, and Y+1 versions. Amounts are spread evenly across 12 months (Flat mode) and the column's period becomes the whole year. An empty cell leaves the column as it is; `0` clears it
  - **Monthly amounts**: to load or review amounts month by month, with the period of each column, use the **Budget rows file** in Budget Administration

**Common errors**:
  - **"Supplier not found"**: Create the supplier in **Master Data > Suppliers** first, then re-import
  - **"Account not found"**: Add the account in **Master Data > Charts of Accounts**, then re-import
  - **"Invalid currency"**: Use 3-letter ISO codes (USD, EUR, GBP) that are allowed in your workspace currency settings
  - **"Header mismatch"**: Download a fresh template; headers must match exactly (including order)

**Tip**: Start with the template export, fill in a few rows, and run a preflight to catch issues early. Fix errors in the CSV and re-upload until preflight passes, then load.

---

## Status and Lifecycle

Every OPEX item has a **status** (Enabled or Disabled) and an optional **End of validity** that controls when it appears in reports and selection lists. It is the only end date of an item.

**How it works**:
  - **Enabled**: The item is active and appears everywhere (lists, reports, allocations)
  - **End of validity**: The date the item stops. Leave it blank if there is no end
  - After the end of validity:
    - The item no longer appears in selection lists for new contracts or allocations
    - It is excluded from reports for years strictly after the end of validity
    - Historical data remains intact; the item still appears in reports covering years when it was active

**Setting status**:
  - When you create the item, you can set its **End of validity** in the **Properties** panel
  - Later, change the **Status** in the metadata bar, or use the **Lifecycle** field in the **Properties** panel (**Enabled** switch and **End of validity**). Switching an item to Disabled without a date sets its end of validity to today
  - You can schedule a future end of validity (useful for planned end-of-contract items)

**Viewing disabled items**:
  - By default, the OPEX list shows only **Enabled** items
  - Use the **Show: Disabled** or **Show: All** toggle to see disabled items

**When to disable vs delete**:
  - **Prefer disabling**: Keeps history intact, ensures reports remain consistent, and supports audit trails
  - **Delete only if**: The item was created by mistake and has no budgets, allocations, or tasks
  - Deletion is guarded: you cannot delete an item that is referenced by contracts, tasks, or has budget data

**Tip**: Use the End of validity to sunset OPEX items when contracts end or services are discontinued. Do not delete unless it is a true mistake.

---

## Tips and Best Practices

1. **Start simple**: Create items with just the essentials (product name, supplier, paying company, account), then add budgets and allocations as you plan.

2. **Use the default allocation method**: For most items, Headcount (Default) is enough. Reserve manual allocations for spend that benefits specific companies or departments only.

3. **Link contracts**: If you manage spend via contracts, link them in the Relations tab. It makes renewals easier to track.

4. **Link applications**: Associate OPEX items with the applications or services they fund. This provides a clear cost-to-application mapping.

5. **Upload documentation**: Use the Attachments feature to store vendor contracts, quotes, invoices, and SOWs.

6. **Add vendor portal links**: Use Relevant Websites to link to vendor admin consoles, support portals, and documentation for quick access.

7. **Track contacts**: Add supplier contacts with roles (Commercial, Technical, Support) so your team knows who to call for each spend item.

8. **Leverage analytics categories**: Tag items with categories (Infrastructure, Business Apps, Security) to group spend in reports.

9. **Keep company metrics up to date**: Allocations depend on company headcount, IT users, and turnover. Outdated metrics cause allocation errors.

10. **Use CSV for bulk setup**: If you are migrating from another system or have hundreds of items, start with CSV import. Export a template, fill it in, and preflight before loading.

11. **Disable, do not delete**: Preserve history by disabling items when they are no longer active. Delete only if it is a mistake.

12. **Review the totals row**: Before finalizing budgets, check the pinned totals row in the list to ensure your spend adds up as expected.

13. **Use deep linking**: Click directly on a budget column in the list to jump to the Budget tab for that year. Click the Task column to jump to the item's tasks on the Overview tab. This saves navigation time.

14. **Freeze budgets after year-end close**: Use Budget Administration to freeze prior-year budgets once actuals are finalized, preventing accidental edits.

---

## Permissions

OPEX access is controlled by three levels:

- `opex:reader` -- View the OPEX list, open items, see budgets and allocations (read-only), download attachments
- `opex:manager` -- Create and edit OPEX items, update budgets and allocations, upload and delete attachments, manage relations and links
- `opex:admin` -- All manager rights plus CSV import/export, budget operations (freeze, copy, reset), and bulk delete

Additionally:
- Tasks have separate permissions (`tasks:member` to create/edit tasks on OPEX items)
- Users with `tasks:reader` can view tasks but not create or edit them

If you cannot perform an action (e.g., **Import CSV** button is missing, cannot upload attachments), check with your workspace admin to review your role permissions.

---

## Need help?

- **CSV issues**: Download a fresh template, ensure UTF-8 encoding, and run preflight to see detailed errors
- **Allocation errors**: Check that all companies have the required metrics (headcount, IT users, turnover) for the selected year
- **Obsolete account warning**: The account does not belong to the paying company's Chart of Accounts; pick a different account
- **Missing buttons or tabs**: Your role may not have the required permission level (manager or admin). Contact your workspace admin
