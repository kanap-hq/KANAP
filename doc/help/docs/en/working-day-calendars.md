# Working-day calendars

A working-day calendar holds the number of working days of each month, year by year. It is what a budget line priced per day is multiplied by. For example, a consultant at 400 a day on a calendar with 20 working days in March costs 8,000 in March.

Each OPEX and CAPEX column computed with a price per day uses one calendar. The other ways of computing a line (per month, or for the whole period) need no calendar. See [Compute from quantity and price](opex.md#compute-from-quantity-and-price).

---

## Getting started

Navigate to **Master data > Working-day calendars** (in the **Finance** section) to open the list. Click **New** to create your first calendar.

**Required fields**:

- **Code**: a short code your team recognizes. Import files use it to find the calendar
- **Name**: the name people pick in the budget tab, for example "Head office staff"

**Optional but useful**:

- **Description**: who the calendar applies to, for example "Working days of salaried staff, public holidays excluded"

Once the calendar is created, enter the working days of each year in its workspace.

**Tip**: If your finance team already keeps working days in a spreadsheet, import them from a CSV file. One row holds one calendar and one year.

---

## Working with the list

When the workspace has no calendar yet, one line under the title says so: "A calendar holds the working days of each month, for lines priced per day. Create one, or import a file."

**Columns**:

- **Code**: the calendar code
- **Name**: the calendar name
- **Years**: the years the calendar holds, for example "2026, 2027"
- **Status**: **Enabled** or **Disabled** (hidden by default, add it from the column chooser)
- **Updated**: the date and time of the last change

Click any cell to open the workspace.

**Sorting**: The list opens sorted by name. Click a column header to sort by that column instead.

**Filtering**:

- **Quick search**: searches the code, the name and the description
- **Status**: the column filter offers **Enabled** and **Disabled**
- **Status scope**: the **All / Enabled / Disabled** toggle above the list. The list shows enabled calendars by default

**Actions**:

- **New**: create a calendar (requires `working_day_profiles:member`)
- **Import CSV**: load calendars and their working days from a file (requires `working_day_profiles:admin`)
- **Export CSV**: download every calendar (requires `working_day_profiles:admin`)
- **Delete selected**: delete the selected calendars (requires `working_day_profiles:admin`). Calendars that cannot be deleted are kept and listed with the reason

---

## Creating a calendar

Click **New**. Fill in **Code**, **Name** and, if you wish, **Description**, then click **Create**. A new calendar is enabled.

After **Create**, the workspace of the new calendar opens, ready for its working days.

---

## The calendar workspace

Click any row in the list to open the workspace.

- **Header**: the code as reference, with a copy button, and the name. Click the name to rename it. **Prev** / **Next** move through the list in its current order and filters, and the close button returns to the list
- **Main area**: a line such as "Used by 3 OPEX lines and 1 CAPEX line." when budget lines use the calendar, the **Description**, then the **Working days** section
- **Properties panel** on the right: **Code** and **Lifecycle**

**Autosave**: Every change saves on its own. There is no Save button. Text fields and months save when you leave them (press Enter in **Code** or in a month to save at once); the lifecycle saves as soon as you change it. When a change is refused, the reason shows under the field that caused it, for example a duplicate code under **Code**.

### Fields

| Field | What to enter | Where to find this value |
|---|---|---|
| **Code** | Up to 50 characters. Codes are unique regardless of case: `CAL-01` and `cal-01` are the same code | The code your finance team uses for this set of working days, for example in its budget workbook |
| **Name** | Up to 200 characters. Names are unique regardless of case | The name your team knows the calendar by. It is the name shown in the budget tab |
| **Description** | Free text | Who the calendar applies to and what it leaves out |
| **Lifecycle** | The **Enabled** switch and the **End of validity** date | Set a future date to schedule the end, or switch it off to disable it today |

### Working days

The **Working days** section shows one year at a time.

- **Year tabs**: every year the calendar holds, the years around the current one, and one empty year before and after the stored ones, so the next year can always be added
- **Twelve months**: one field per month. Enter the working days of that month
- **Yearly total**: the line under the months, for example "218 days in 2026". It adds up the months as you type, with at most 2 decimals, for example "229 days in 2026" for twelve months of 19.083333
- **Copy from 2025**: shown when the year is empty and the previous year has working days. It fills the twelve months with the previous year's values and saves them. Adjust the months that differ afterwards
- **Remove 2026**: shown on a year the calendar holds. When no budget line uses the calendar, it removes that year at once. When lines use it, a dialog asks first: "Remove the working days of 2026?" It gives the number of lines and explains the effect. The lines keep their amounts and explanations, but none of them can be recomputed for that year, and the budget rows file cannot compute them, until the days are entered again. Click **Remove anyway** to confirm

**A new year** is saved once all twelve months are filled. Until then, a hint says "Fill the twelve months to save 2027." After that, each change saves as soon as you leave the month.

**Rules for the months**:

- **At most the month's calendar days**: 31 for March, 30 for April, 28 for February, 29 for February in a leap year. A larger value is refused: "March 2027 has 31 days: enter 31 or less."
- **Zero or more**: a negative value is refused.
- **Up to 6 decimals**: working days can be fractions, for example `19.083333` for a yearly total spread over twelve months. More decimals are refused: "Use at most 6 decimals."
- **All twelve months**: a year holds twelve values. Leaving a month of a stored year empty is refused: "Enter the working days of all twelve months of 2027." Write `0` for a month without working days.

**Changing working days never changes a budget line on its own.** The amounts of lines already computed stay as they are, and so does the explanation of how they were computed. Open a line's budget tab and click **Recompute** to apply the new days. The panel then lists the months whose days changed, for example "March: 20 days, now 19".

---

## Disabled calendars

Disable a calendar when it should no longer be used, for example after a change of working time agreement.

- A disabled calendar stays on the budget lines that already use it. Their amounts do not change.
- It cannot be chosen for another line. The budget tab offers enabled calendars only, plus the line's own calendar.
- A line that already uses it can still be recomputed. The panel then warns: "This calendar is disabled. The computation still uses it."
- In a budget rows file, a row that assigns a disabled calendar to a line that does not use it yet is refused: "Head office staff is disabled. Pick an enabled calendar."

---

## Deleting

The **Delete** button in the header deletes the calendar at once (requires `working_day_profiles:admin`). It is disabled, with the reason on one line, while budget lines use the calendar, for example "Used by 3 OPEX lines and 1 CAPEX line. Disable it instead."

The same rule applies to **Delete selected** in the list: a calendar used by budget lines is kept, with a reason such as "Head office staff is used by 3 OPEX lines and 1 CAPEX line. Disable it instead."

A line uses a calendar when one of its columns, in any year, is computed with a price per day on it. **Reset budget column** in Budget Administration removes that link for the reset column. See [Reset budget column](budget-operations.md#reset-budget-column).

---

## CSV import/export

Load or update calendars and their working days from a file.

**Export**: click **Export CSV**, then **Export data**. The file lists every calendar, enabled or disabled, sorted by code. For an empty file with the headers only, use **Download template** in the import dialog.

**CSV structure**:

- Delimiter: semicolon `;`
- Encoding: UTF-8 (save as "CSV UTF-8" in Excel)
- Headers: `code;name;description;status;disabled_at;year;jan;feb;mar;apr;may;jun;jul;aug;sep;oct;nov;dec`
- One row per calendar and year. A calendar with three years takes three rows. A calendar without any year is exported as one row with the year and the months empty

| Column | Content |
|---|---|
| `code` | Required. The code of the calendar. Rows are matched to existing calendars by code, regardless of case |
| `name` | Required |
| `description` | Free text |
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
- **Rows of one code describe one calendar.** They must agree on the name, the description, the status and the end of validity.
- **Months follow the rules of the workspace**: all twelve months, each at most the month's calendar days, up to 6 decimals.
- **Years missing from the file are kept.** An import adds or replaces years. It never removes one. To remove a year, use its **Remove** link in the workspace.
- **Counts**: a new calendar or a new year counts as an insert. A changed year, or a change of name, description or lifecycle, counts as an update. A row identical to what is stored counts as unchanged. Exporting and importing the same file reports every row as unchanged.
- **Calendars missing from the file** are left as they are. The import never deletes.

**Common errors**:

- **"Rows of CAL-01 disagree on the name."** (or the description, the status, the end of validity): make the rows of that code identical on these fields.
- **"CAL-01 has 2027 twice (rows 3 and 5)."**: keep one row per calendar and year.
- **"Enter the working days of all twelve months of 2027."**: fill every month of the row. Write `0` for a month without working days.
- **"March 2027 has 31 days: enter 31 or less."**: fix the month.
- **"Use at most 6 decimals."**: round the value.
- **"Give the year of these working days."**: the row has months but no year.
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

- **One calendar per working time agreement**: people on the same agreement share the same working days. Create one calendar for each, not one per person.
- **Name it for the people it covers**: the budget tab shows the name, so "Head office staff" says more than a code.
- **Prepare next year early**: use **Copy from** on the new year, then adjust the months that differ. A line computed per day cannot be recomputed for a year its calendar does not hold.
- **Disable, do not delete**: when a calendar is no longer used for new lines, disable it. The lines that use it keep their amounts and can still be recomputed.
