# Currency Settings

The Currency Settings page (**Budget management > Administration > Currencies**) is where you configure how currencies are stored, displayed, and converted across your workspace. It controls the tenant-wide reporting currency, default currencies for new lines, and optional restrictions on which currencies can be used.

## Who can see and change it

Currencies are a budget setting. The page sits with the other budget settings in [Budget Administration](budget-operations.md).

- **Open the page, change settings, run the FX rates sync and enter manual rates**: Budget administration at admin level. The card is hidden from other users.
- **Use currencies on items**: OPEX and CAPEX users pick from the allowed currencies in their line forms, without opening this page.

The **Settings** permission of the IT landscape does not give access to currencies. It covers the IT landscape settings only.

For background on currency concepts and conversion mechanics, see the Currency Management guide.

## The Currency Settings form

### Reporting Currency
The **tenant-wide currency** used for all reports, totals, and list displays. When you change this currency:
  - All OPEX and CAPEX yearly columns convert to the new reporting currency
  - Totals in reports recalculate using the new base
  - **Your stored item data remains unchanged**: only display and conversion are affected

**Example**: If you switch from EUR to USD, your OPEX list totals will show in USD, but each line's stored currency (EUR, GBP, etc.) stays the same.

**Tip**: Choose a reporting currency that matches your group's financial reporting standard (e.g., EUR for European headquarters, USD for US-based groups).

### Default OPEX Currency
The currency that **prefills** when you create a new OPEX (spend) line. This doesn't restrict what currencies you can select. It just saves time by offering a sensible default.

**Example**: If most of your recurring spend is in EUR, set this to EUR. Users can still manually select GBP, USD, or any other allowed currency.

### Default CAPEX Currency
The currency that **prefills** when you create a new CAPEX line. Works the same as Default OPEX Currency, but for capital expenditure.

**Tip**: If your CAPEX is mostly procured in a different currency than daily OPEX (e.g., USD for hardware purchases), set a different default here.

### Allowed Currencies (optional)
A **comma-separated list** of ISO codes that restricts which currencies users can select when creating or editing OPEX and CAPEX lines.

  - **Empty (default)**: Users can select any valid ISO 3-letter currency code
  - **Specified list** (e.g., `EUR, USD, GBP`): Only these currencies appear in dropdowns
  - **Reporting currency is always allowed**: Even if not listed, the reporting currency is always available
  - **Default currencies are always allowed**: Default OPEX and CAPEX currencies are always available

**Why use this?**
Limiting allowed currencies helps when:
  - Your FX data source doesn't cover exotic currencies
  - You want to enforce standardization across teams
  - You need to prevent errors from mistyped or outdated codes

**Tip**: Leave this empty unless you have a specific reason to restrict. If you do restrict, include all currencies your teams actively use (e.g., `EUR, USD, GBP, CHF, PLN`).

## Saving changes

Click **Save** to apply your updates. The system will:
  1. Validate all currency codes (must be 3-letter ISO codes)
  2. Update your tenant settings
  3. Refresh the rates of the current year. A change of reporting currency refreshes every year in use instead (see [Changing the reporting currency](#changing-the-reporting-currency))
  4. Show a success message

Click **Reset** to discard unsaved changes and revert to the last saved values.

**Important**: Changing the reporting currency immediately affects how lists and reports display values. Plan this change during a maintenance window if you need consistent reporting periods.

### Changing the reporting currency

When you save a new reporting currency, a confirmation dialog opens first, for example **Change the reporting currency to USD?**. It lists what the change does:

  - Every amount is converted to the new currency at that year's rate. Rates are fetched for the years in use.
  - The manual rates entered against the current reporting currency no longer apply. The dialog lists them by currency, year and rate. They apply again if you choose the current currency again later.
  - For each year with frozen budget versions: these versions keep the rates from when they were frozen, converted to the new currency at that year's rate (see [Frozen years](#frozen-years)).
  - The new currency will be added to the allowed currencies, when the list does not hold it yet.

The last three points show only when they apply. Click **Change the currency** to save, or **Cancel** to keep the current settings.

KANAP then fetches the rates of the new currency for every year in use: the budget years (frozen ones included), the years with a company turnover, the years the contracts page shows, and the current calendar year with the year before and the year after. The page waits for the result and reports it as for a [forced sync](#force-fx-rates-sync).

## Force FX rates sync

The **Force FX rates sync** button fetches the rates at once for the previous, current and next calendar years, every year of the missing rates block, and every year that already has budget amounts.

**When to use it**:
  - After adding new allowed currencies
  - When you need up-to-date spot rates for the current year
  - If you suspect rates are stale or missing
  - Before generating reports for stakeholders

**What happens**:
  - The button stays busy while KANAP fetches the rates, for up to 20 seconds
  - A message above the table then gives the result: the number of rates fetched, for example **12 rates fetched.**, followed by the pairs still without a rate, for example **Still missing: BRL 2026.**, or by **Every currency in use has a rate.**
  - When the fetch brings in no new rate and every currency in use already has one, the message says **Exchange rates are up to date.** When some pairs are still missing, it says **No new rate was fetched.** and names them.
  - When the sources did not answer, the message says so, and the rates already stored stay in place
  - When the fetch takes longer, the message reads **Synchronisation continues in the background.** The table and the missing rates block update once it ends
  - When a refresh is already running, KANAP adds your years to it, so no request is lost

**Automatic refresh**: The system also refreshes rates automatically every 30 days when a user logs in (covers Y-1, Y, Y+1). When a list, a report or the contracts page needs a rate that the snapshot of its year does not have (a currency first used since, or a year without a snapshot), the system fetches that year in the background as soon as it is read, and the next display uses the new rate. Manual sync gives you control when you need immediate updates.

**Which currencies are fetched**: the currencies of budget lines, companies and contracts, plus the reporting, default and allowed currencies.

**Rates already known are kept**: when a source no longer returns a currency on a later refresh, the rate stored for that year stays in place.

**Years not yet published**: the World Bank publishes the average of a year some months after it ends (the year just ended usually around mid-year). Until then, a past year uses the nearest published year, and the table marks that rate as an **estimate**. The real value replaces it on the first refresh after publication. The current year uses the live rate. When the live rate is unavailable, it uses the latest published year, also marked as an estimate.

**Tip**: If you add a new currency to Allowed Currencies, run **Force FX rates sync** immediately to populate rates before users start creating lines in that currency.

## FX Rate Snapshots table

Below the settings form, the **Latest FX rate snapshots** table shows the most recent exchange rates captured for each fiscal year, in the current reporting currency. The reporting currency comes first, then the other currencies in alphabetical order. A row is a currency in use: a default currency, an allowed currency, or a currency of a budget line, a company or a contract. A currency with a manual rate stays in the table even when it is no longer in use. After a change of reporting currency, the former one also shows for the years of frozen versions, since they convert through it. Rates stored for a previous reporting currency are not shown.

**Columns**:
  - **Currency**: The ISO 3-letter code
  - **Fiscal year columns**: One column per year with data (e.g., 2023, 2024, 2025)
  - **Rate values**: Exchange rate to your reporting currency, in the number format of your language, with up to 6 decimals and no trailing zeros
  - **Source label**: Shows the data source for each year:
      - **Annual avg**: World Bank annual average (historical years)
      - **Quarterly avg**: World Bank quarterly average (if available)
      - **Live spot**: Current spot rate from ExchangeRate-API (current year)
      - **Forward estimate**: Current year's rate reused for future years
  - **Marks in the cells**: an asterisk (*) after a rate entered by hand, explained by the note **Rate entered manually** under the table (shown only when the table has such a rate); **estimate** next to a rate taken from the nearest published year (hover the mark for the reason)
  - **Missing rate**: a pair with no rate shows `—` in the warning colour

**Example**:
If your reporting currency is EUR:

| Currency | 2024 (Annual avg) | 2025 (Live spot) | 2026 (Forward estimate) |
|----------|-------------------|------------------|-------------------------|
| EUR      | 1                 | 1                | 1                       |
| CHF      | 0.9621            | 0.9655           | 0.9655                  |
| GBP      | 1.1753            | 1.182            | 1.182                   |
| USD      | 0.92582           | 0.9312           | 0.9312                  |

**Reading the table**:
  - Rates show how many units of your reporting currency equal 1 unit of the listed currency
  - If a rate shows `—`, no data is available. Budget line amounts in that currency are left out of totals for that year (see [Conversion mechanics](#conversion-mechanics-quick-reference))
  - Rates are captured at the time of sync and remain stable until the next refresh

**Tip**: If you see missing rates (`—`), check that the currency code is valid and commonly published. Consider limiting Allowed Currencies to avoid exotic codes without data. You can also enter the rate yourself (see [Manual rates](#manual-rates)).

### Missing rates

Above the table, a block lists every currency and year in use that has no rate, under a title such as **2 exchange rates missing**. Each line explains that no source publishes this rate yet, so amounts in this currency are left out of totals until it has one. When nothing is missing, the block reads **Every currency in use has a rate.**

A pair counts as in use when a budget line, a company's figures or a contract needs it. For a contract, that is each year the contracts page shows (the current year, the two that follow, and the previous year when the budget has lines for it) in which the contract runs. The contracts page and this block therefore name the same missing years. Opening the page also asks the sources again for the years in the list.

### Manual rates

When no source publishes a rate, or when your finance team uses its own rates, you can enter a rate for one currency and one year.

  1. Click the cell of the currency and year in the table, or click **Enter a rate** next to a line of the missing rates block. The **Enter a rate** link of a warning elsewhere in KANAP also leads here: it opens the dialog directly when the warning names a single currency and year, and otherwise highlights the missing rates block for a few seconds.
  2. In the **Manual exchange rate** dialog, type the rate in your reporting currency for 1 unit of the selected currency (for example **Rate in EUR for 1 USD**), with the decimal mark of your language. When the year before or after has an automatic rate, the field shows it as a guide, for example **Automatic rate for 2025: 0.9312**. Otherwise it suggests the average rate of the year published by your central bank or your treasury.
  3. Click **Save**. The cell then shows the rate followed by an asterisk (*).

The dialog checks the value before saving: a rate is required, must be a number greater than 0, cannot exceed 1,000,000,000, and must not round to 0 at 6 decimals. The message under the field says which rule applies.

A manual rate replaces the automatic rate for this year until you remove it. Later refreshes do not overwrite it. To go back to the automatic rate, open the cell and click **Remove manual rate**: the automatic rate will be fetched again.

When the year has frozen budget versions, a new or removed manual rate does not reach them, and the page says so, for example **The 2 frozen versions of 2026 keep the rate from when they were frozen.**

Good to know:
  - Only Budget administration users at admin level can enter, change or remove a manual rate.
  - Each entry, change and removal is recorded in the audit log.
  - A frozen year keeps the rates captured when it was frozen, manual and estimated ones included (see [Frozen years](#frozen-years)).
  - A manual rate is entered against the current reporting currency. After a change of reporting currency, manual rates entered for the old one no longer apply. They apply again if you change the reporting currency back to that one.
  - The reporting currency always has a rate of 1 and takes no manual rate.

## CSV import and export

### Export
OPEX and CAPEX exports include line data and yearly amounts in each line's **own currency**, not the reporting currency. This preserves the original data for reimport or external analysis.

**Example CSV row** (OPEX):
```
Item Name;Company;Account;Currency;Y-1;Y;Y+1;Y+2
SaaS License;Acme UK;6200;GBP;10000;12000;12000;12000
```

### Import
When importing OPEX or CAPEX lines, the `Currency` column must contain **standard ISO 3-letter codes**.

**Validation**:
  - If **Allowed Currencies** are configured, imports using unlisted codes are rejected
  - The error response includes the `allowedCurrencies` list for clarity
  - Reporting currency and default currencies are always accepted

**Example**:
If Allowed Currencies = `EUR, USD, GBP` and you import a line with `Currency=CHF`, the import fails with:
```
Currency "CHF" is not allowed. Allowed currencies: EUR, USD, GBP
```

**Tip**: Export a template, check the allowed currencies list, and ensure your import file uses only those codes.

## Status and historical data

When you change settings:
  - **Reporting currency**: Affects display immediately; stored amounts do not change, and each year is converted to the new currency with the rates described in [Conversion mechanics](#conversion-mechanics-quick-reference)
  - **Default currencies**: Only affect new lines; existing lines keep their currencies
  - **Allowed currencies**: Existing lines are not validated retroactively. Restrictions apply only to new or edited lines

## Conversion mechanics (quick reference)

Amounts are stored in their own currency and converted when they are displayed. Each year uses the latest rates captured for that year, whatever the date the amounts were entered. When a sync captures new rates for a year, the amounts of that year are converted with them from then on, unless the year is frozen (see [Frozen years](#frozen-years)).

### Past years
World Bank annual average rates are used. These are stable and don't change once published. Until the World Bank publishes a year, the nearest published year stands in, marked as an estimate.

### Current year
Live spot rate from ExchangeRate-API is used (falls back to the latest annual rate, marked as an estimate, if unavailable). Refreshes when you run **Force FX rates sync** or during automatic 30-day refresh.

### Future years
Reuse the current year's rate as a forward estimate. This provides budget planning guidance but should be reviewed as those years approach.

### Frozen years
Freezing the default budget column of a year fixes that year's rates for the type you freeze (OPEX or CAPEX): KANAP refreshes the year's rates, then keeps that set for every amount of the year, even when newer rates arrive. If the reporting currency changes later, these amounts keep the frozen rates and then convert into the new reporting currency at that year's rate of the former one. Without that rate, they are left out of the totals and named like any missing rate: the former reporting currency then shows in the missing rates block for that year, and a manual rate fills it. Unfreezing the default column releases them. See [Freezing the default column fixes the exchange rates](budget-operations.md#freezing-the-default-column-fixes-the-exchange-rates).

**Missing rate**: When a year has no rate for a currency in use, the budget line amounts in that currency are left out of every total in the reporting currency for that year. This covers the budget lines list, the budget management overview, the budget and chargeback reports, the contracts and the Relations tabs of applications and technologies. The screen says so where it matters:

- A one-line warning names what is left out, for example "Excluding 3 lines with no exchange rate: USD 2026." It shows under the totals of the budget lines list, on the overview tiles, at the top of each budget and chargeback report, and under the budget figures of contracts, applications and technologies. Budget administration users at admin level also see **Enter a rate**, which opens this page on the missing rate.
- On the line itself, the amount shows in its own currency with a small orange mark. Hover the mark to read, for example, "No USD exchange rate for 2026: left out of totals."

KANAP fetches the rates of that year in the background (at most once every six hours per year), so the next display uses the new rate once the source publishes it. To spot missing rates, check the missing rates block above the FX Rate Snapshots table, and run **Force FX rates sync** to fetch the rates at once. Entering a [manual rate](#manual-rates) fixes it immediately.

## Ask the assistant

[Plaid](ai-assistant.md#tool-calls) reads the currencies and the rates of this page for anyone with read access to the budget. Ask, for example: "What is the USD rate for 2026?"

## Tips

  - **Set reporting currency once**: Changing it mid-year affects all reports. If you must change it, do so at year-end.
  - **Default currencies save time**: Set them to the currencies your teams use most frequently.
  - **Restrict currencies intentionally**: Only use Allowed Currencies if you have a clear reason (e.g., FX data coverage, compliance, standardization).
  - **Run Force FX rates sync proactively**: After adding currencies, before generating reports, or when rates seem stale.
  - **Check the FX snapshots table**: Use it to verify rates are reasonable and complete before finalizing reports.
  - **Use consistent ISO codes**: Always use 3-letter codes (EUR, USD, GBP), never symbols (€, $, £) or numeric codes.

## Common scenarios

### Scenario 1: Changing the reporting currency
Your group switches from EUR-based to USD-based reporting.

**Steps**:
  1. Go to **Budget management > Administration > Currencies**
  2. Change Reporting Currency from `EUR` to `USD`
  3. Click **Save**, read the confirmation dialog (manual rates that stop applying, frozen versions), then click **Change the currency**
  4. Read the result of the rate fetch. For each pair still missing, enter a manual rate or run **Force FX rates sync** later
  5. Verify that the FX Rate Snapshots table now shows rates in USD (every rate is relative to USD)
  6. Check OPEX and CAPEX lists: totals and yearly columns now display in USD

**Result**: All reports, dashboards, and lists show USD. Your stored line data (each line's own currency) remains unchanged.

### Scenario 2: Restricting currencies for compliance
Your finance team requires all spend to be recorded in EUR, USD, or GBP only.

**Steps**:
  1. Go to **Budget management > Administration > Currencies**
  2. Set Allowed Currencies to `EUR, USD, GBP`
  3. Click **Save**
  4. Run **Force FX rates sync** to ensure rates are available for all three currencies

**Result**: Users can only select EUR, USD, or GBP when creating or editing lines. Attempts to import other currencies will fail with a clear error message.

### Scenario 3: Adding a new currency mid-year
Your company starts operations in Switzerland and needs to track CHF spend.

**Steps**:
  1. Go to **Budget management > Administration > Currencies**
  2. Add `CHF` to Allowed Currencies (e.g., `EUR, USD, GBP, CHF`)
  3. Click **Save**
  4. Click **Force FX rates sync** to fetch CHF rates immediately
  5. Verify CHF appears in the FX Rate Snapshots table with valid rates

**Result**: Users can now select CHF for new lines. The FX rates table includes CHF with current and historical rates for accurate conversions.

### Scenario 4: Preparing for annual budget cycles
It's December, and you're preparing for next year's budget planning.

**Steps**:
  1. Go to **Budget management > Administration > Currencies**
  2. Click **Force FX rates sync** to refresh rates for the upcoming year
  3. Check the FX Rate Snapshots table to see the forward estimates for the next year
  4. Note that future year rates are forward estimates (reusing current year's rate). Review them as the year approaches

**Result**: Your budget forecasts for the next year use the latest available rates. Teams can plan CAPEX and OPEX with reasonable currency assumptions.

## Frequently asked questions

**Q: What happens if I change the reporting currency mid-year?**
A: All reports and lists immediately convert to the new currency. Historical data remains intact: only the display currency changes. Frozen budget versions keep their frozen rates, converted at each year's rate, and manual rates entered for the former currency stop applying until you choose it again. Plan this change carefully to avoid confusion during active reporting periods.

**Q: Can I set different reporting currencies for different companies?**
A: No. The reporting currency is tenant-wide. All companies, reports, and totals use the same reporting currency. Individual lines store their own currency, but conversions always target the tenant's reporting currency.

**Q: Why don't I see rates for a specific currency?**
A: The data source (World Bank or ExchangeRate-API) may not publish that currency. Check the ISO code is correct and commonly published. If needed, limit Allowed Currencies to codes with reliable data coverage.

**Q: How often do FX rates refresh automatically?**
A: Every 30 days, when any user logs in, the system refreshes rates for Y-1, Y, and Y+1. A year that lacks the rate of a currency in use is also fetched as soon as a list, a report or the contracts page needs it, and when you open this page. You can also trigger a refresh at any time with **Force FX rates sync**.

**Q: Do FX rate changes affect my stored data?**
A: No. Exchange rates only affect **conversion and display**. Each OPEX and CAPEX line stores its own currency and amounts, which never change when rates update. Only the displayed converted values in reports and lists change.

**Q: Can I import historical rates manually?**
A: Importing rates from a file is not available. You can enter a manual rate for each currency and year on this page (see [Manual rates](#manual-rates)). A manual rate replaces the automatic rate until you remove it.

**Q: What if I need to use a currency not in the allowed list?**
A: Either add it to Allowed Currencies or leave the list empty (which allows all currencies). Remember to run **Force FX rates sync** after adding new currencies to populate rates.

**Q: Are forward estimates for future years accurate?**
A: Forward estimates reuse the current year's rate and should be treated as **planning assumptions**, not forecasts. Review them as future years approach and rates become available from official sources.
