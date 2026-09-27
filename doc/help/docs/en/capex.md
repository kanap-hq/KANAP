# CAPEX

CAPEX (Capital Expenditure) items are your investments in long-term assets: hardware purchases, software licenses with multi-year value, infrastructure projects, and equipment. This is where you plan capital budgets, track project spending, and allocate costs across your organization.

The CAPEX workspace helps you manage each capital item from initial budgeting through execution and reporting -- all in one place with year-by-year budget columns, flexible allocation methods, and direct links to projects, contracts, and contacts.

## Getting started

Navigate to **Budget Management > CAPEX** to see your list. Click **New** to create your first item.

The workspace opens in creation mode, with the **Properties** panel open on the right. Type the investment's name in the title at the top, fill in the properties, then click **Create**.

**Required fields**:

- **Title**: What you are investing in (e.g., "New Server Infrastructure", "ERP Software License"). This is the item's description, shown in the **Description** column of the list
- **Paying company**: Which company is making the investment (required for accounting)
- **Currency**: ISO code (e.g., USD, EUR). Defaults to your workspace CAPEX currency; you can override per item
- **PP&E type**: Property, Plant & Equipment classification -- Hardware or Software
- **Investment type**: Purpose of the investment (see options below)
- **Priority**: Business priority level (see options below)
- **Effective start**: When this investment begins (DD/MM/YYYY)

**Strongly recommended**:

- **Account**: The general ledger account for this capital expenditure. Only accounts from the paying company's Chart of Accounts will appear
- **Supplier**: The vendor or supplier for this investment. Select from your master data suppliers

**Optional but useful**:

- **Analytics category**: Custom grouping for reporting
- **End of validity**: The date this investment stops, for example when the asset's useful life ends or the project completes. Leave it blank if there is no end. After it, the item is disabled and later years no longer count in the budget views
- **IT owner** / **Business owner**: Who is responsible
- **Description** (Overview tab): Free-form details about the investment

Once the item is created, the workspace unlocks all four tabs: **Overview**, **Budget**, **Allocations**, and **Relations**.

**Tip**: You can create items quickly and fill in budgets and allocations later. Start with the essentials and iterate.

---

## Investment types

CAPEX items must be classified by investment type. This helps analyze capital spending patterns:

- **Replacement**: Replacing existing assets that are obsolete or end-of-life
- **Capacity**: Adding capacity to support business growth or increased demand
- **Productivity**: Improving efficiency or reducing operational costs
- **Security**: Enhancing security posture, compliance, or risk mitigation
- **Conformity**: Meeting regulatory or compliance requirements
- **Business Growth**: Enabling new products, markets, or business capabilities
- **Other**: Investments that do not fit the above categories

**Priority levels**:

- **Mandatory**: Must be done (regulatory, critical infrastructure, security)
- **High**: Strong business case, high ROI or strategic importance
- **Medium**: Valuable but can be deferred if needed
- **Low**: Nice to have, can be postponed

---

## Working with the CAPEX list

The CAPEX list (at **Budget Management > CAPEX**) is your main view for browsing, filtering, and navigating capital items.

### Default columns

| Column | What it shows |
|---|---|
| **Ref** | Item reference, for example CPX-12 |
| **Description** | Name of the investment |
| **Supplier** | The supplier name |
| **Paying company** | Which company pays for this item |
| **Contract** | The latest linked contract name |
| **Account** | The GL account number and name |
| **PP&E type** | Hardware or Software |
| **Investment type** | Purpose of the investment |
| **Priority** | Business priority level |
| **Allocation** | Current-year allocation method label |
| **Budget Y** | Current-year planned capital budget (reporting currency) |
| **Expected landing Y** | Current-year expected landing (reporting currency) |
| **Task** | Title of the most recent task linked to this item |

### Additional columns

These columns are hidden by default. Show them from the column chooser (hamburger menu in the grid header):

| Column | What it shows |
|---|---|
| **Amount columns** | Every budget column (Budget, Revision, Forecast, Actuals and Expected landing) for Y-1, Y, Y+1 and Y+2. The header gives the column, the year relative to today and the calendar year, for example **Revision Y+1 (2027)**. Amounts are in the reporting currency |
| **Currency** | Item-level currency code |
| **Effective start** | Start date |
| **End of validity** | Date the item stops (blank means no end) |
| **IT owner** / **Business owner** | Responsible users |
| **Analytics** | Analytics category name |
| **Project** | Names of the projects linked on the Relations tab |
| **Notes** | Free-form notes |
| **Enabled** | Status (enabled or disabled) |
| **Created** / **Updated** | Timestamps |

### Quick search

The search box at the top searches the reference, description, supplier, paying company, account, contract, project names, allocation, owners, analytics category, PP&E type, investment type, priority, notes, currency and status. Results update in real time as you type.

### Column filters

Each filterable column header has a filter icon. **Supplier**, **Paying company**, **Account**, **PP&E type**, **Investment type**, **Priority**, **Allocation**, **Currency**, **IT owner**, **Business owner** and **Analytics** use checkbox set filters with **All**, **None**, and a clear button. Multiple filters combine with AND logic.

Every amount column has a number filter. A number typed in the box under the header keeps the items with at least that amount. Open the filter menu for the other conditions: greater than, less than, equal, not equal, or between two amounts.

**Effective start**, **End of validity**, **Created** and **Updated** have date filters. Pick a date in the box under the header to keep the items on that date, or open the filter menu for before, after, between, blank or not blank.

Text columns use text filters. On **Ref**, type the number or the full reference, for example `12` or `CPX-12`.

### Sorting

Click a column header to sort ascending or descending. Every column sorts, including every amount column. The default sort is **Budget Y**, highest first. The list remembers your last sort when you return.

### Totals row

The pinned row at the bottom shows the total of every amount column. Totals respect your current filters and search. All amounts are converted to your reporting currency, shown in the page title.

### Deep linking

Click any cell in a row to open the workspace on the tab most relevant to that column:

- **Description**, **Supplier**, **Paying company**, **PP&E type**, **Investment type**, **Priority** and the other general columns: Opens **Overview**
- **Amount columns** (Budget Y, Expected landing Y, Revision Y+1, etc.): Opens the **Budget** tab for the column's year
- **Allocation**: Opens the **Allocations** tab for the current year
- **Task**: Opens the **Overview** tab, where the Tasks panel sits
- **Contract**: Opens the linked contract directly

### Status filter

Use the **Show: Enabled / Disabled / All** toggle above the grid to control lifecycle scope (defaults to **Enabled**). Pick **Disabled** to review archived investments or **All** to include both states. Totals update immediately.

### Search context preservation

Your list context -- sort order, search text, and active filters -- is preserved when you open an item and restored when you return to the list. This means you can drill into several items in sequence without losing your place.

### Prev/Next navigation

When you open an item, the workspace shows **Prev** and **Next** buttons. These navigate through the list in the current sort order, respecting filters and search, and save your pending edits first. The counter (e.g., "Item 3 of 47") shows your position in the filtered list.

**Tip**: Use column filters and quick search to build focused views (e.g., "All hardware investments with high priority"), then navigate item-by-item with **Prev**/**Next** to review budgets.

---

## The CAPEX workspace

Click any row in the list to open the workspace. It has four parts:

- **Header**: the item reference (e.g., `CPX-7`) with a copy button, the investment's name (click it to rename the item), **Prev** / **Next**, **Send link**, and the close button
- **Metadata bar** under the title: **Status**, **Priority**, **IT owner**, and **Business owner**, each editable in place
- **Four tabs**: **Overview**, **Budget**, **Allocations**, and **Relations** (the Relations tab shows how many links the item has)
- **Properties panel** on the right: the item's main fields. Open or close it with the properties button; the workspace remembers your choice

**Autosave**:

- Every change saves automatically. A **Saving...** / **Saved** hint shows in the header
- Switching tabs, moving to the previous or next item, or closing the workspace saves pending edits first. If a save fails, you stay where you are and an error explains why, so no edit is lost silently
- **Ctrl+S** (**Cmd+S** on Mac) saves immediately

### Overview

The Overview tab holds the details of the investment and its tasks.

**What you can edit**:

- **Description**: Free-form details about the investment (exported as `notes` in CSV). The investment's name itself is the title at the top

**Tasks panel**:

- Lists every task linked to this CAPEX item, with **Title**, **Status**, **Priority**, **Due date**, and **Actions** columns. The panel title shows the number of tasks
- **Status** filter: All (default), Active (not done), or a specific status. The clear button resets it
- Click **Add task** to open a new task already linked to this item. Fill in the title, description, priority, assignee, and due date in the task workspace
- Use the open icon to go to a task, and the delete icon to delete it (you confirm first)
- Tasks have their own permissions (`tasks:member` to create and edit). CAPEX manager access does not grant task editing rights on its own; check with your admin if you cannot create tasks
- Tasks can also be viewed and managed from **Portfolio > Tasks**, which shows all tasks across your organization
- The latest task title is also shown in the list view's **Task** column (hidden by default)

**Properties panel**:

- **Supplier**, **Paying company**, **Account** (filtered by the paying company's Chart of Accounts), **Currency** (only the currencies allowed in your workspace), **PP&E type**, **Investment type**, **Analytics category**, and **Effective start**
- **Lifecycle**: the **Enabled** switch and the **End of validity** date. See [Status and lifecycle](#status-and-lifecycle)
- **Created** and **Updated** dates (read only)
- **Priority** is set in the Properties panel when you create the item, then in the metadata bar

**Tip**: When you create an item, an "obsolete account" warning means the selected account does not belong to the paying company's Chart of Accounts. Choose a different account to resolve the warning.

---

### Budget

The Budget tab is where you enter financial data per year. It supports multiple budget columns and two input modes, shown as tabs: **Flat** (annual total) and **Monthly** (12-month breakdown).

**Year selection**:

- Use the year tabs at the top to switch between Y-2, Y-1, Y (current year), Y+1, and Y+2
- Each year has its own version, allocation method, and amounts
- Switching years saves your pending edits first

**Budget columns** (all years):

- **Budget**: Initial planned capital budget
- **Revision**: Mid-year budget update (e.g., after scope changes or reforecasts)
- **Actuals**: Expected actual spending (your best estimate as the year progresses)
- **Expected landing**: Final actual capital expenditure after year-end close

**Period of a column**:

- Every column (Budget, Revision, Forecast, Actuals and Expected landing) has a period inside the year, for example April to December
- A month counts when the period covers its 15th. A period that starts on April 10 includes April; one that starts on April 20 begins in May
- A column with no amount and no period yet gets a suggestion: the item's **Effective start** and **End of validity**, limited to the year. An investment that starts on April 1 suggests April to December
- A column that already holds amounts and has no period reads as the whole year, so existing data behaves as before

**Flat vs Monthly**:

- **Flat**: Enter one total per column. The total is spread evenly over the months of the column's period, and the months outside it are set to zero. The period shows under each total before you type, for example "9 months, April to December". Only the total you edit is saved. The other columns keep their monthly amounts.
- Click the pencil icon next to the period under a total (**Change period**) to open the spread panel on that column, with its current total. If the item's dates leave no month in the year, the total is disabled and reads "No month of 2026 is within the item's dates." Click the pencil icon next to it (**Choose the period**) to set one yourself.
- **Monthly**: Enter amounts per month (Jan through Dec) for granular project spend tracking, plus a **Forecast** column. Quarter subtotals and a yearly total are shown. Only the months you change are saved.
- Switch between modes with the **Flat** and **Monthly** tabs
- Switching modes does not change your amounts: it only changes the view. Flat shows the yearly total of the stored months, and Monthly shows the stored months.

**Freeze behavior**:

- If a year's budget is frozen (via Budget Administration), inputs are read-only and show a lock icon
- Each column can be frozen independently (Budget, Revision, Forecast, Actuals, Expected landing)
- You can still view frozen data; admins can unfreeze via **Budget Management > Budget Administration > Freeze/Unfreeze**

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

**Monthly tools** (Monthly mode only):

- **Clear column**: the icon next to a column header sets every month of that column to zero
- Useful for entering a cash-out plan by hand, for example the whole amount in a single month
- Clearing this way counts as an edit by hand. To remove both the amounts and the period of a column for every investment, use **Reset budget column** in Budget Administration

**Multi-year trend**:

- A chart below the table shows the item's budget columns across years and updates as you type

**How to use it**:

1. Select the year you are planning for
2. Choose the **Flat** or **Monthly** tab
3. Fill in the relevant columns (Budget for initial planning, Actuals for tracking, Expected landing for the year-end figure)
4. Your changes save automatically; a **Saving...** / **Saved** hint shows next to the year tabs

**Tip**: For most items, Flat mode is faster. Use Monthly mode when you need to track project spend timing or phased rollouts.

---

### Allocations

The Allocations tab distributes the capital expenditure across your companies and departments. This drives chargeback reports and helps allocate asset costs.

**Year selection**:

- Works the same as Budget: use year tabs to switch between Y-2, Y-1, Y, Y+1, Y+2
- Each year can have a different allocation method
- The **Year budget** of the selected year shows on the right

**Allocation methods**:

1. **Headcount (default)**: Splits capital spend proportionally by each company's headcount for the selected year. Percentages update automatically when you edit company metrics. This is the standard default.

2. **IT users**: Splits spend proportionally by each company's IT user count for the selected year. Useful for IT infrastructure investments that scale with IT staff.

3. **Turnover**: Splits spend proportionally by each company's turnover (revenue) for the selected year. Useful for business-wide platforms or infrastructure.

4. **Manual by company**: You select which companies receive this capital investment. Choose a driver in **Allocate by** (Headcount, IT users, or Turnover) to calculate percentages among the selected companies. Only the selected companies are included in the split.

5. **Manual by department**: You select specific company/department pairs. Percentages are calculated from each department's headcount. Useful when a capital investment benefits only certain departments (e.g., manufacturing equipment).

6. **Manual percentages**: You pick the companies and type each percentage yourself. The percentages must add up to 100%.

**Default vs pinned methods**:

- The **default** entry -- shown as *Headcount (default)* until your organisation configures another method -- follows the setting in **Budget Management > Administration > Default Allocation Method**. Every investment left on the default is re-driven when an admin changes that setting.
- That setting can also restrict the default to a **selection of companies** (for example the entity that carries the IT budget): the driver then applies to those companies only, and the option reads *Default (n companies)*.
- **Headcount**, **IT users** and **Turnover** pin that method on the investment: a pinned method keeps working even if the organisation default changes later.
- Investments with a manual allocation are never affected by the default setting.

**How percentages work**:

- For **auto methods** (Headcount, IT users, Turnover): percentages are computed from the latest company metrics across your enabled companies. You do not edit them directly.
- For **Manual by company** and **Manual by department**: you pick the companies or departments, and the system calculates percentages from your chosen driver and the current metrics.
- For **Manual percentages**: typing a percentage pins that row, and the remaining rows share what is left. **Split equally** gives every row the same share; **Clear manual pins** releases the pinned rows.
- Percentages reflect live data. If you update a company's headcount, allocations recalculate.

**Viewing allocations**:

- The table shows the company (or company / department), the driver value, the percentage, and the amount, with a total row
- The total percentage should equal 100%; for Manual percentages a warning appears until it does

**How to use it**:

1. Select the year
2. Choose an allocation method in **Method**
3. For a manual method, use **Add row** to add companies (or company/department pairs) and the remove icon to drop any that do not benefit from this investment
4. Changes save automatically

**Common issues**:

- **Missing metrics**: One or more companies have zero or missing headcount/IT users/turnover for the selected year. Fill in the metrics in **Master Data > Companies** (Details tab).
- **"Manual percentages must sum to 100%."**: Adjust the rows, or click **Split equally**.

**Tip**: Use Headcount for most items (it is simplest and updates automatically). Reserve Manual by company for investments that benefit only specific entities (e.g., regional data center). Use Manual by department for highly targeted investments.

---

### Relations

The Relations tab links this CAPEX item to related objects: Projects, Contracts, Contacts, Relevant websites, and Attachments. Everything on this tab saves automatically.

**Projects**:

- Use the autocomplete to link one or more projects
- This helps group capital spend by project in reports and enables project accounting
- The project names appear in the CAPEX list **Project** column, and the quick search finds them
- Remove a project by clicking the X on its chip

**Contracts**:

- Use the autocomplete to link one or more contracts
- When linked, the contract name appears in the CAPEX list **Contract** column for quick reference
- Contracts can also link to multiple CAPEX items (many-to-many relationship)
- Remove a contract by clicking the X on its chip

**Contacts**:

- Link contacts to this CAPEX item: pick a contact, then pick its role (**Commercial**, **Technical**, **Support**, or **Other**). Choosing the role adds the contact
- The table shows the role, first name, last name, job title, email, and mobile. Hover the role to see whether the contact comes from the supplier or was added manually
- Remove a contact with the remove icon

**Relevant websites**:

- Click **Add URL** to add a link (e.g., vendor product pages, technical documentation, internal wikis). Each link has a **Name** and a **URL**
- Click a link row to edit it, or use the delete icon to remove it

**Attachments**:

- Upload files related to this capital item (e.g., quotes, vendor proposals, technical specs, approval memos)
- Drag and drop files into the attachment area, or click **Select files** to browse
- Click a file chip to download the file
- Delete an attachment with the delete icon on its chip (you confirm first; requires `capex:manager` permission)

**Why link?**:

- **Projects**: Roll up capital spend by project for project accounting and reporting
- **Contracts**: Track which capital items are covered by purchase agreements or service contracts
- **Contacts**: Keep vendor and stakeholder contact details associated with the investment
- **Websites & Attachments**: Centralize all investment-related documentation and references for easy access

**Tip**: Upload vendor quotes, approval memos, and technical specs as attachments. Link contracts for procurement tracking. Use contacts to keep vendor representatives associated with each capital item.

---

## CSV import/export

You can bulk-load CAPEX items via CSV to speed up initial setup or sync with external systems.

**Export**:

1. Click **Export CSV** in the CAPEX list
2. Choose:
   - **Template**: Headers only (use this to create a blank CSV to fill in)
   - **Data**: Every CAPEX item, including ended ones, with budgets for Y-1 to Y+2

**CSV structure**:

- Delimiter: semicolon `;` (not comma)
- Encoding: UTF-8 (save as "CSV UTF-8" in Excel)
- Headers: `item_number;description;ppe_type;investment_type;priority;currency;effective_start;status;disabled_at;notes;company_name;owner_it_email;owner_business_email;analytics_category;y_minus1_budget;y_minus1_landing;y_budget;y_follow_up;y_landing;y_revision;y_plus1_budget;y_plus1_revision;y_plus2_budget`
- `disabled_at` is the end of validity: the date the item stops. Use a date (`2026-12-31`) or a full date and time. Leave it empty if there is no end
- Older files with an `effective_end` column still import: its date fills the end of validity when `disabled_at` is empty

**Import**:

1. Click **Import CSV** in the CAPEX list
2. Upload your CSV file (drag-and-drop or file picker)
3. Click **Preflight** to validate:
   - Headers match exactly
   - Companies and users exist in your workspace
   - Required fields (description, ppe_type, investment_type, priority) are present. A new item also needs company_name and currency
   - Currencies are allowed in your workspace currency settings
   - Owners are active users
   - An `item_number` matches an existing CAPEX item
4. Review the preflight report (shows counts and up to 5 sample errors)
5. If OK, click **Load** to import

**Important notes**:

- **Matching**: A row with an `item_number` updates that CAPEX item; the preflight reports a number that matches no item. A row without one is matched by `description`: a match updates the item, otherwise the row creates a new item. When several rows match the same item, the first one counts.
- **New items**: `company_name` and `currency` are required for a new item. The currency must be allowed in your workspace currency settings. On an existing item, an empty currency cell keeps its currency.
- **References**: `company_name` must match a Company by name (case-insensitive). `owner_it_email` and `owner_business_email` must match active users by email: an invited user or a contact without an account is refused.
- **PP&E Type**: Must be `hardware` or `software` (case-insensitive).
- **Investment Type**: Must be one of: `replacement`, `capacity`, `productivity`, `security`, `conformity`, `business_growth`, `other` (case-insensitive).
- **Priority**: Must be `mandatory`, `high`, `medium`, or `low` (case-insensitive).
- **Budgets**: Budget columns populate Y-1, Y, and Y+1 versions. Amounts are spread evenly across 12 months (Flat mode) and the column's period becomes the whole year. An empty cell leaves the column as it is; `0` clears it.
- **Monthly amounts**: to load or review amounts month by month, with the period of each column, use the **Budget rows file** in Budget Administration.

**Common errors**:

- **"Company not found"**: Create the company in **Master Data > Companies** first, then re-import.
- **"Invalid ppe_type"**: Use `hardware` or `software` exactly.
- **"Invalid investment_type"**: Use one of the 7 valid investment types (see list above).
- **"Invalid priority"**: Use `mandatory`, `high`, `medium`, or `low`.
- **"Invalid currency"**: Use 3-letter ISO codes (USD, EUR, GBP) that are allowed in your workspace currency settings.
- **"Header mismatch"**: Download a fresh template; headers must match exactly (including order).

**Tip**: Start with the template export, fill in a few rows, and run a preflight to catch issues early. Fix errors in the CSV and re-upload until preflight passes, then load.

---

## Status and lifecycle

Every CAPEX item has a **status** (Enabled or Disabled) and an optional **End of validity** that controls when it appears in reports and selection lists. It is the only end date of an item.

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
- You can schedule a future end of validity (useful for planned asset disposals or end-of-life dates)

**Viewing disabled items**:

- By default, the CAPEX list shows only **Enabled** items
- Use the **Show: Enabled / Disabled / All** toggle to change the scope

**When to disable vs delete**:

- **Prefer disabling**: Keeps history intact, ensures reports remain consistent, and supports audit trails
- **Delete only if**: The item was created by mistake and has no budgets, allocations, or tasks
- Deletion is guarded: you cannot delete an item that has budget data, allocations, tasks, or is referenced by contracts

**Tip**: Use the End of validity to mark assets that have been fully depreciated, disposed of, or projects that have completed. Do not delete unless it is a true mistake.

---

## Permissions

CAPEX access is controlled by three levels:

- `capex:reader` -- View CAPEX list, open items, see budgets and allocations (read-only)
- `capex:manager` -- Create and edit CAPEX items, update budgets and allocations, upload attachments, manage links and contacts
- `capex:admin` -- All manager rights plus CSV import, budget operations (freeze, copy, reset), and bulk delete

Additionally:

- Tasks have separate permissions (`tasks:member` to create/edit tasks on CAPEX items)
- Users with `tasks:reader` can view tasks but not create or edit them

If you cannot perform an action (e.g., the **Import CSV** button is missing), check with your workspace admin to review your role permissions.

---

## Tips

- **Start simple**: Create items with just the essentials (description, PP&E type, investment type, company), then add budgets and allocations as you plan.
- **Use Headcount allocation**: For most capital investments, Headcount is enough. Reserve manual allocations for investments that benefit specific companies or departments only.
- **Link contracts**: If you manage capital purchases via contracts, link them in the Relations tab for procurement tracking.
- **Upload documentation**: Use the attachments feature to store vendor quotes, approval memos, and technical specs alongside the item.
- **Classify accurately**: Use Investment Type and Priority consistently to enable meaningful capital spend analysis and prioritization.
- **Keep company metrics current**: Allocations depend on company headcount, IT users, and turnover. Outdated metrics cause allocation errors.
- **Use CSV for bulk setup**: If you are migrating from another system or have many capital items, start with CSV import.
- **Disable, do not delete**: Preserve history by disabling items when assets are disposed of or projects complete.
- **Review the totals row**: Before finalizing capital budgets, check the pinned totals row to ensure your capital spend adds up as expected.
- **Use deep linking**: Click directly on a budget or allocation column in the list to jump straight to that tab and year.
- **Track spend timing**: For large projects with phased spending, use Monthly mode to track spend against project milestones.
- **Freeze after year-end**: Use Budget Administration to freeze prior year budgets once actuals are finalized, preventing accidental edits.
