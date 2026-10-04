# Working-day calendars

A working-day calendar holds the number of working days of each month, year by year. Budget lines priced per day use it: a person full time works every working day of the month, and days and days per month turn into FTE against it. For example, a consultant full time at 400 a day on a calendar with 20 working days in March costs 8,000 in March.

A calendar is one of two kinds:

- **Standard**: created from a country, and a region when the country has them. The working days of any year are the weekdays of each month minus the country's public holidays. There is nothing to type, and you can still change any month of any year
- **Custom**: you enter the working days of each year yourself, for example for a working time agreement with its own days off

On the budget tab of an OPEX or CAPEX item, every line priced per day uses one calendar. Lines priced per month or per piece need none. See [Quantity and price](opex.md#quantity-and-price).

---

## Getting started

Navigate to **Master data > Working-day calendars** (in the **Finance** section) to open the list.

The quickest start is a standard calendar for each country where your companies are:

- **When you create a company** with a country, KANAP creates the standard calendar of that country for you, unless the workspace already has one for the whole country
- **For the companies you already have**, the list page shows one line above the grid, for example "Your companies are in France, Netherlands and Italy. Create their standard calendars." Click **Create 3 calendars** to create them in one go

To create a calendar yourself, click **New**.

**Required fields**:

- **Code**: a short code your team recognizes. Import files use it to find the calendar
- **Name**: the name people pick in the budget tab, for example "Head office staff"

**Optional but useful**:

- **Country** and **Region**: make the calendar standard. Without a country, the calendar is custom
- **Description**: who the calendar applies to, for example "Working days of salaried staff, public holidays excluded"

**Tip**: If your finance team already keeps working days in a spreadsheet, import them from a CSV file. One row holds one calendar and one year.

---

## Working with the list

When the workspace has no calendar yet, one line under the title says so: "A calendar holds the working days of each month, for lines priced per day. Create one, or import a file."

**Columns**:

- **Code**: the calendar code
- **Name**: the calendar name
- **Country**: the country of a standard calendar, with the region in parentheses, for example "France (Département Moselle)". Empty for a custom calendar
- **Years**: "All years" for a standard calendar, followed by the years you changed, for example "All years, 2026 edited". For a custom calendar, the years it holds, for example "2026, 2027"
- **Status**: **Enabled** or **Disabled** (hidden by default, add it from the column chooser)
- **Updated**: the date and time of the last change

Click any cell to open the workspace.

**Sorting**: The list opens sorted by name. Click a column header to sort by that column instead.

**Filtering**:

- **Quick search**: searches the code, the name, the description, and the country and region of a standard calendar
- **Status**: the column filter offers **Enabled** and **Disabled**. Clicking **Clear** in it, or unticking both values, lists nothing, whatever **Show** says
- **Status scope**: the **Show: All / Enabled / Disabled** toggle above the list. The list shows enabled calendars by default

**Suggested calendars**: for users who can create calendars, a line above the grid lists the countries of your enabled companies that have no standard calendar yet, with one button that creates them. Each calendar takes the country code as its code and the country name, in your language, as its name. The line disappears once every country has its calendar.

**Actions**:

- **New**: create a calendar (requires `working_day_profiles:member`)
- **Import CSV**: load calendars and their working days from a file (requires `working_day_profiles:admin`)
- **Export CSV**: download every calendar (requires `working_day_profiles:admin`)
- **Delete selected**: delete the selected calendars (requires `working_day_profiles:admin`). Calendars that cannot be deleted are kept and listed with the reason

---

## Creating a calendar

Click **New**, then:

1. **Country** (optional): type to search, by name or by two-letter code. With a country, the calendar is standard
2. **Region**: shown when the country has regions, for example the German states or the French departments with their own holidays. Keep **Whole country**, or pick a region
3. **Code** and **Name**: choosing a country fills them, for example `FR-57` and "France (Département Moselle)". Change them if you wish
4. **Description**: optional
5. Click **Create**

A new calendar is enabled, and its workspace opens. A standard calendar already holds the working days of every year. For a custom one, enter them year by year.

The country and region are set once, at creation. To follow another country, create another calendar.

---

## The calendar workspace

Click any row in the list to open the workspace.

- **Header**: the code as reference, with a copy button, and the name. Click the name to rename it. **Prev** / **Next** move through the list in its current order and filters, and the close button returns to the list
- **Main area**: a line such as "Used by 3 OPEX lines and 1 CAPEX line." when budget lines use the calendar, the **Description**, then the **Working days** section
- **Properties panel** on the right: **Code**, **Source** (standard calendars only, for example "France (Département Moselle)", read only) and **Lifecycle**

**Autosave**: Every change saves on its own. There is no Save button. Text fields and months save when you leave them (press Enter in **Code** or in a month to save at once); the lifecycle saves as soon as you change it. When a change is refused, the reason shows under the field that caused it, for example a duplicate code under **Code**.

### Fields

| Field | What to enter | Where to find this value |
|---|---|---|
| **Code** | Up to 50 characters. Codes are unique regardless of case: `CAL-01` and `cal-01` are the same code | The code your finance team uses for this set of working days, for example in its budget workbook. For a standard calendar, the country code is a good choice |
| **Name** | Up to 200 characters. Names are unique regardless of case | The name your team knows the calendar by. It is the name shown in the budget tab |
| **Description** | Free text | Who the calendar applies to and what it leaves out |
| **Country** / **Region** | On creation only. The region list follows the country | The country, and the region when its public holidays differ, where the people or services of the calendar work |
| **Lifecycle** | The status switch, labelled with the current state (**Enabled** or **Disabled**), and the **End of validity** date | Set a future date to schedule the end, or switch it off to disable it today |

### Working days of a standard calendar

The **Working days** section shows one year at a time, with the same year tabs as the budget tab: five years around the current one, and arrows to move one year at a time, from 2000 to 2100. Every year is there: nothing needs to be added.

- **Twelve months**: each month shows its working days, the weekdays (Monday to Friday) that are not a public holiday
- **Yearly total**: the line under the months, for example "252 days in 2026"
- **Public holidays**: one line lists the holidays of the year with their dates, for example "Public holidays: 1 Jan New Year's Day, 6 Apr Easter Monday, …". A holiday that falls on a Saturday or a Sunday is listed with "(weekend)": it removes no working day, which explains the count

**Changing a month**: type the value you need, for example to remove a company closing day. The year becomes an edited year: its twelve months are kept as they are now, and the other years keep following the public holidays.

- Under the total of an edited year, a line gives the standard values, for example "Standard values: 252 days"
- **Reset to standard** brings the year back to the public holidays at once. There is no confirmation: the values you typed are replaced by the standard ones

**Where the standard values come from**: the public holiday rules come from [`date-holidays`](https://github.com/commenthol/date-holidays), an open-source library bundled in KANAP. The rules ship with the application, so standard calendars work without any internet access. The holiday data is published under the Creative Commons Attribution-ShareAlike 3.0 licence (CC BY-SA 3.0), and KANAP uses it unchanged. Only public holidays count: bank holidays, school holidays and observances do not. A public holiday that starts in the evening (6 pm or later), such as Christmas Eve in the Northern Territory of Australia, does not remove the day; one that starts earlier in the day removes the whole day.

### Working days of a custom calendar

The **Working days** section shows one year at a time.

- **Year tabs**: every year the calendar holds, the years around the current one, and one empty year before and after the stored ones, so the next year can always be added
- **Twelve months**: one field per month. Enter the working days of that month
- **Yearly total**: the line under the months, for example "218 days in 2026". It adds up the months as you type, with at most 2 decimals, for example "229 days in 2026" for twelve months of 19.083333
- **Copy from 2025**: shown when the year is empty and the previous year has working days. It fills the twelve months with the previous year's values and saves them. Adjust the months that differ afterwards
- **Remove 2026**: shown on a year the calendar holds. When no budget line uses the calendar, it removes that year at once. When lines use it, a dialog asks first: "Remove the working days of 2026?" It gives the number of lines and explains the effect. The lines keep their amounts, but lines priced per day on this calendar cannot be saved for that year until the days are entered again. Click **Remove anyway** to confirm

**A new year** is saved once all twelve months are filled. Until then, a hint says "Fill the twelve months to save 2027." After that, each change saves as soon as you leave the month.

### Rules for the months

These rules apply to both kinds of calendar:

- **At most the month's calendar days**: 31 for March, 30 for April, 28 for February, 29 for February in a leap year. A larger value is refused: "March 2027 has 31 days: enter 31 or less."
- **Zero or more**: a negative value is refused.
- **Up to 6 decimals**: working days can be fractions, for example `19.083333` for a yearly total spread over twelve months. More decimals are refused: "Use at most 6 decimals."
- **All twelve months**: a year holds twelve values. Leaving a month of a stored year empty is refused: "Enter the working days of all twelve months of 2027." Write `0` for a month without working days.

### When working days change

**Changing working days never changes a budget line on its own.** The amounts already saved on a budget line stay as they are. When you open the line's budget tab, the **Quantity and price** tab says so, for example "Working days changed since the last computation: March: 20 days, now 19." Click **Use the lines again** there to apply the new days.

---

## Disabled calendars

Disable a calendar when it should no longer be used, for example after a change of working time agreement.

- A disabled calendar stays on the budget lines that already use it. Their amounts do not change.
- It cannot be chosen for another line. The budget tab offers enabled calendars only, plus the calendar a line already uses, marked "(disabled)".
- Lines that already use it can still be saved. The panel then warns, for example: "Head office staff is disabled. The lines still use it."

---

## Deleting

The **Delete** button in the header deletes the calendar at once (requires `working_day_profiles:admin`). It is disabled, with the reason on one line, while budget lines use the calendar, for example "Used by 3 OPEX lines and 1 CAPEX line. Disable it instead."

The same rule applies to **Delete selected** in the list: a calendar used by budget lines is kept, with a reason such as "Head office staff is used by 3 OPEX lines and 1 CAPEX line. Disable it instead."

A budget line uses a calendar when one of its columns, in any year, has a line priced per day on it. Removing that line in the budget tab, or **Reset budget column** in Budget Administration, removes the link. See [Reset budget column](budget-operations.md#reset-budget-column).

---

## CSV import/export

Load or update calendars and their working days from a file.

**Export**: click **Export CSV**, then **Export data**. The file lists every calendar, enabled or disabled, sorted by code. For an empty file with the headers only, use **Download template** in the import dialog.

**CSV structure**:

- Headers: `code`, `name`, `description`, `country`, `region`, `status`, `disabled_at`, `year`, `jan`, `feb`, `mar`, `apr`, `may`, `jun`, `jul`, `aug`, `sep`, `oct`, `nov`, `dec`
- The export writes the separator of the screen language. See [CSV files](master-data-operations.md#csv-files) for the encoding, the separator, the date forms and the two import steps
- One row per calendar and year. A calendar with three years takes three rows. A calendar without any year is exported as one row with the year and the months empty
- A standard calendar exports the years you edited only. The other years follow the public holidays and need no row
- The `country`, `region` and `disabled_at` columns are optional on import. A file without `country` and `region` creates custom calendars

| Column | Content |
|---|---|
| `code` | Required. The code of the calendar. Rows are matched to existing calendars by code, regardless of case |
| `name` | Required |
| `description` | Free text |
| `country` | Optional. The two-letter country code of a standard calendar, for example `FR`. Empty for a custom calendar |
| `region` | Optional. The region code, for example `57` for Moselle or `BY` for Bavaria. Needs a country. Empty for the whole country |
| `status` | `enabled` or `disabled`. Empty means `enabled` |
| `disabled_at` | Optional column. The end of validity: a date (`2026-12-31`) or a full date and time. Empty if there is no end |
| `year` | Four digits, from 2000 to 2100. Empty on a row that only sets the calendar's fields |
| `jan` to `dec` | The working days of each month, with a dot as decimal separator (a comma is accepted too). Required on a row with a year |

**Import**:

1. Click **Import CSV** in the list
2. Choose your file
3. Click **Preflight check**. The report gives the number of rows, the inserts and updates, and the rows that change nothing
4. If the preflight is clean, click **Load**

**How the import works**:

- **The whole file is checked before anything is written.** A file with any error loads nothing: fix the rows and run the preflight again.
- **Rows of one code describe one calendar.** They must agree on the name, the description, the country, the region, the status and the end of validity.
- **The country and region apply when the file creates a calendar.** On an existing calendar, leave them empty or give the calendar's own values. A different value is refused.
- **Years of a standard calendar become edited years.** The other years keep following the public holidays.
- **Months follow the rules of the workspace**: all twelve months, each at most the month's calendar days, up to 6 decimals.
- **Years missing from the file are kept.** An import adds or replaces years. It never removes one. To remove a year, use its **Remove** link in the workspace, or **Reset to standard** on a standard calendar.
- **Counts**: a new calendar or a new year counts as an insert. A changed year, or a change of name, description or lifecycle, counts as an update. A row identical to what is stored counts as unchanged. Exporting and importing the same file reports every row as unchanged.
- **Calendars missing from the file** are left as they are. The import never deletes.

**Common errors**:

- **"Rows of CAL-01 disagree on the name."** (or the description, the country, the region, the status, the end of validity): make the rows of that code identical on these fields.
- **"CAL-01 has 2027 twice (rows 3 and 5)."**: keep one row per calendar and year.
- **"Enter the working days of all twelve months of 2027."**: fill every month of the row. Write `0` for a month without working days.
- **"March 2027 has 31 days: enter 31 or less."**: fix the month.
- **"Use at most 6 decimals."**: round the value.
- **"Give the year of these working days."**: the row has months but no year.
- **"Country XX is not in the list."**: use a two-letter country code, for example `FR` or `DE`.
- **"BY is not a region of France."**: the region does not belong to the country. Fix the region, or leave it empty for the whole country.
- **"Give the country of region BY."**: a region needs its country.
- **"The country of a calendar cannot be changed. Create another calendar."**: the row gives another country or region than the stored calendar. Leave both cells empty, or give the calendar's own values.
- **"A calendar named ... already exists."**: another calendar already uses this name. Names are unique regardless of case.
- **"Header mismatch"**: download a fresh template.

---

## Permissions

| Level | What it allows |
|---|---|
| `working_day_profiles:reader` | View the list and open calendars |
| `working_day_profiles:member` | Create calendars, edit them and their working days |
| `working_day_profiles:admin` | Everything above, plus CSV import and export, and deletion |

Budget administrators are calendar administrators: the built-in Budget Administrator role gets admin. Every other role starts with the level it has on departments, so Master Data Administrator is admin, Budget Member and Master Data Member are members, and the reader roles can read.

Anyone who can read OPEX or CAPEX can pick a calendar in the budget tab without access to this page.

---

## Tips

- **Start from the standard calendars**: one per country covers most budgets. Add a region only when its public holidays differ, for example Moselle in France or Bavaria in Germany.
- **One calendar per working time agreement**: when people have days off of their own, create a custom calendar for their agreement, not one per person.
- **Name it for the people it covers**: the budget tab shows the name, so "Head office staff" says more than a code.
- **Prepare next year early on a custom calendar**: use **Copy from** on the new year, then adjust the months that differ. A line priced per day cannot be saved for a year its calendar does not hold. Standard calendars need nothing: every year is already there.
- **Disable, do not delete**: when a calendar is no longer used for new lines, disable it. The lines that use it keep their amounts and can still be saved.
