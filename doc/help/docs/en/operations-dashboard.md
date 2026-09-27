# Budget management overview

The Budget Management Dashboard is the first page you see after signing in. It gives you a high-level view of where your IT spend stands right now -- OPEX and CAPEX snapshots, upcoming deadlines, data quality indicators, and the items that deserve your attention most -- all in one place.

## Where to find it

- Path: **Operations > Overview** (`/ops`)
- This is also the default landing page after login.

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

Click **View All** to open the Tasks page.

### Next renewals

Lists the next five contract cancellation deadlines that are still in the future. Past deadlines are automatically filtered out so you only see what is coming up.

Click **View All** to open the Contracts page.

### Data hygiene (OPEX)

Four indicator chips that help you spot incomplete OPEX records at a glance:

- **No IT owner** -- items missing an IT owner assignment
- **No Biz owner** -- items missing a Business owner assignment
- **No Paying Company** -- items without a paying company set
- **CoA mismatches** -- items where the selected account does not belong to the paying company's chart of accounts

Chips turn orange (or red for CoA mismatches) when the count is above zero. Click any chip to jump to the OPEX list.

### Quick actions

Shortcut buttons to create a new OPEX or CAPEX item directly from the dashboard. These buttons are only visible if your role grants you at least `opex:manager` or `capex:manager` permissions.

Below the buttons, a **Recent OPEX updates** section lists the five most recently changed OPEX items with their last-modified date.

### Top OPEX (Y)

The five largest OPEX items for the current year, ranked by budget amount. Amounts are rounded to thousands with a "k" suffix.

Click **Open** to view the full Top OPEX report.

### Top increases (Y vs Y-1)

The five OPEX items with the largest budget increase compared to the previous year. Amounts are rounded to thousands with a "k" suffix.

Click **Open** to view the full OPEX Delta report.

## Tips

- **Rounded numbers**: Every amount on the dashboard is rounded to thousands for a compact view. Open the OPEX or CAPEX list -- or the Reports section -- when you need exact figures.
- **Missing buttons**: If you do not see the **New OPEX** or **New CAPEX** buttons, your current role does not include the required manager permission. Ask your administrator to check your access.
- **Empty tiles**: A tile that shows "No data" simply means there are no records of that type yet. Once you or your team start entering data, the tile will populate automatically.
