# Budget management overview

The budget management overview gives you a high-level view of where your IT spend stands right now: OPEX and CAPEX snapshots, upcoming deadlines, data quality indicators, and the items that deserve your attention most, all in one place.

## Where to find it

- Path: **Budget management > Overview** (`/ops`)
- The page you land on after login is your personal [dashboard](my-dashboard.md). Open this overview from the **Budget management** workspace.

## Layout

The dashboard is built from tiles arranged in a responsive grid: three columns on a wide screen, two on a tablet, and a single column on mobile. Each tile has an icon, a title, and usually a **View** button that takes you straight to the full page behind the data.

## Tiles

### OPEX snapshot

A compact table covering three fiscal years: last year (Y-1), current year (Y), and next year (Y+1). Up to five value columns appear: **Budget**, **Revision**, **Forecast**, **Actuals**, and **Expected landing**. A column shows when it holds an amount for at least one of the three years. The OPEX and CAPEX tiles show the same columns. All amounts are rounded to the nearest thousand and displayed with a "k" suffix (for example, `7 846k`).

Click **View** to open the OPEX list.

### CAPEX snapshot

Same layout and formatting as the OPEX snapshot, but drawn from your capital expenditure data.

Click **View** to open the CAPEX list.

### My tasks

Displays the total number of open tasks assigned to you (tasks marked "done" are excluded), followed by the five tasks whose due dates are closest. Overdue tasks are highlighted in red. Tasks that have no due date set do not appear here.

Click **View all** to open the Tasks page.

### Next renewals

Lists the next five contract cancellation deadlines that are still in the future. Past deadlines are automatically filtered out so you only see what is coming up.

Click **View all** to open the Contracts page.

### Data hygiene

Four checks that help you spot incomplete records at a glance. The tile shows one column of counts per item type you can read: **OPEX** and **CAPEX** side by side.

- **No IT owner**: items missing an IT owner
- **No business owner**: items missing a business owner
- **No paying company**: items without a paying company
- **Account not in the company's chart**: items whose account does not belong to the paying company's chart of accounts

A count turns orange (red for the chart check) when it is above zero. Click a count to open the list of that type.

### Quick actions

Shortcut buttons to create a new OPEX or CAPEX item directly from the dashboard. These buttons are only visible if your role grants you at least `opex:manager` or `capex:manager` permissions.

Below the buttons, a **Recent updates** section lists the five most recently edited items, OPEX and CAPEX together. Each row shows the date of the last edit, the item name and its type. Click a row to open the item.

### Top items (Y)

The five largest items for the current year, ranked by budget amount. Amounts are rounded to thousands with a "k" suffix.

Use the **OPEX** / **CAPEX** tabs in the tile header to choose the item type. The tile remembers your choice. Click **Open** to view the full Top items report on the same type.

### Top increases (Y vs Y-1)

The five items with the largest budget increase compared to the previous year, computed over every item of the type. Items whose budget stayed flat or went down do not appear. Amounts are rounded to thousands with a "k" suffix.

Use the **OPEX** / **CAPEX** tabs in the tile header to choose the item type. The tile remembers your choice. Click **Open** to view the full Top increase / decrease report on the same type.

A type you cannot read is disabled in the tabs and has no column in **Data hygiene**. If you can read neither OPEX nor CAPEX, these tiles are hidden.

## Tips

- **Rounded numbers**: Every amount on the dashboard is rounded to thousands for a compact view. Open the OPEX or CAPEX list, or the reports, when you need exact figures.
- **Missing buttons**: If you do not see the **New OPEX** or **New CAPEX** buttons, your current role does not include the required manager permission. Ask your administrator to check your access.
- **Empty tiles**: A tile that shows "No data" simply means there are no records of that type yet. Once you or your team start entering data, the tile will populate automatically.
