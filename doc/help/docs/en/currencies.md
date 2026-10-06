# Currency Settings

The Currency Settings page (**Budget management > Administration > Currencies**) is where you configure how currencies are stored, displayed, and converted across your workspace. It controls the tenant-wide reporting currency, default currencies for new items, and optional restrictions on which currencies can be used.

## Who can see and change it

Currencies are a budget setting. The page sits with the other budget settings in [Budget Administration](budget-operations.md).

- **Read only**: anyone with reader access to Budget administration, OPEX or CAPEX. The fields cannot be edited, the **Save**, **Reset** and **Force FX rates sync** buttons are hidden, and a message says that only budget administrators can change the page. The FX rate table is visible.
- **Change settings and run the FX rates sync**: Budget administration at admin level.

The **Settings** permission of the IT landscape does not give access to currencies. It covers the IT landscape settings only.

For background on currency concepts and conversion mechanics, see the Currency Management guide.

## The Currency Settings form

### Reporting Currency
The **tenant-wide currency** used for all reports, totals, and list displays. When you change this currency:
  - All OPEX and CAPEX yearly columns convert to the new reporting currency
  - Totals in reports recalculate using the new base
  - **Your stored item data remains unchanged**—only display and conversion are affected

**Example**: If you switch from EUR to USD, your OPEX list totals will show in USD, but each item's stored currency (EUR, GBP, etc.) stays the same.

**Tip**: Choose a reporting currency that matches your group's financial reporting standard (e.g., EUR for European headquarters, USD for US-based groups).

### Default OPEX Currency
The currency that **prefills** when you create a new OPEX (spend) item. This doesn't restrict what currencies you can select—it just saves time by offering a sensible default.

**Example**: If most of your recurring spend is in EUR, set this to EUR. Users can still manually select GBP, USD, or any other allowed currency.

### Default CAPEX Currency
The currency that **prefills** when you create a new CAPEX item. Works the same as Default OPEX Currency, but for capital expenditure.

**Tip**: If your CAPEX is mostly procured in a different currency than daily OPEX (e.g., USD for hardware purchases), set a different default here.

### Allowed Currencies (optional)
A **comma-separated list** of ISO codes that restricts which currencies users can select when creating or editing OPEX and CAPEX items.

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
  3. Automatically trigger a background FX rate refresh for the current year and any years with budget data
  4. Show a success message

Click **Reset** to discard unsaved changes and revert to the last saved values.

**Important**: Changing the reporting currency immediately affects how lists and reports display values. Plan this change during a maintenance window if you need consistent reporting periods.

## Force FX rates sync

The **Force FX rates sync** button manually triggers a background refresh of exchange rates for all relevant fiscal years (current year plus any years with OPEX or CAPEX data).

**When to use it**:
  - After adding new allowed currencies
  - When you need up-to-date spot rates for the current year
  - If you suspect rates are stale or missing
  - Before generating reports for stakeholders

**What happens**:
  - The system queues a background job to fetch FX rates
  - A success message shows which fiscal years are being refreshed
  - Rates update within a few seconds
  - The FX Rate Snapshots table refreshes automatically

**Automatic refresh**: The system also refreshes rates automatically every 30 days when a user logs in (covers Y-1, Y, Y+1). Manual sync gives you control when you need immediate updates.

**Tip**: If you add a new currency to Allowed Currencies, run Force FX sync immediately to populate rates before users start creating items in that currency.

## FX Rate Snapshots table

Below the settings form, the **Latest FX Rate Snapshots** table shows the most recent exchange rates captured for each fiscal year.

**Columns**:
  - **Currency**: The ISO 3-letter code
  - **Fiscal year columns**: One column per year with data (e.g., 2023, 2024, 2025)
  - **Rate values**: Exchange rate to your reporting currency (6 decimal precision)
  - **Source label**: Shows the data source for each year:
      - **Annual avg**: World Bank annual average (historical years)
      - **Quarterly avg**: World Bank quarterly average (if available)
      - **Live spot**: Current spot rate from ExchangeRate-API (current year)
      - **Forward estimate**: Current year's rate reused for future years

**Example**:
If your reporting currency is EUR:

| Currency | 2024 (Annual avg) | 2025 (Live spot) | 2026 (Forward estimate) |
|----------|-------------------|------------------|-------------------------|
| USD      | 0.925820          | 0.931200         | 0.931200                |
| GBP      | 1.175300          | 1.182000         | 1.182000                |
| CHF      | 0.962100          | 0.965500         | 0.965500                |

**Reading the table**:
  - Rates show how many units of your reporting currency equal 1 unit of the listed currency
  - If a rate shows `—`, no data is available (fallback conversion of 1.00 is used)
  - Rates are captured at the time of sync and remain stable until the next refresh

**Tip**: If you see missing rates (`—`), check that the currency code is valid and commonly published. Consider limiting Allowed Currencies to avoid exotic codes without data.

## CSV import and export

### Export
OPEX and CAPEX exports include item data and yearly amounts in each item's **own currency**—not the reporting currency. This preserves the original data for reimport or external analysis.

**Example CSV row** (OPEX):
```
Item Name;Company;Account;Currency;Y-1;Y;Y+1;Y+2
SaaS License;Acme UK;6200;GBP;10000;12000;12000;12000
```

### Import
When importing OPEX or CAPEX items, the `Currency` column must contain **standard ISO 3-letter codes**.

**Validation**:
  - If **Allowed Currencies** are configured, imports using unlisted codes are rejected
  - The error response includes the `allowedCurrencies` list for clarity
  - Reporting currency and default currencies are always accepted

**Example**:
If Allowed Currencies = `EUR, USD, GBP` and you import an item with `Currency=CHF`, the import fails with:
```
Currency "CHF" is not allowed. Allowed currencies: EUR, USD, GBP
```

**Tip**: Export a template, check the allowed currencies list, and ensure your import file uses only those codes.

## Status and historical data

When you change settings:
  - **Reporting currency**: Affects display immediately; historical data remains intact and is converted using the rates that were active when the data was entered
  - **Default currencies**: Only affect new items; existing items keep their currencies
  - **Allowed currencies**: Existing items are not validated retroactively—restrictions apply only to new or edited items

## Conversion mechanics (quick reference)

### Past years
World Bank annual average rates are used. These are stable and don't change once published.

### Current year
Live spot rate from ExchangeRate-API is used (falls back to latest annual rate if unavailable). Refreshes when you run Force FX sync or during automatic 30-day refresh.

### Future years
Reuse the current year's rate as a forward estimate. This provides budget planning guidance but should be reviewed as those years approach.

**Fallback**: If no rate is found for a currency, the system uses **1.00** until data becomes available. This prevents errors but may produce inaccurate conversions—run Force FX sync to populate missing rates.

## Tips

  - **Set reporting currency once**: Changing it mid-year affects all reports. If you must change it, do so at year-end.
  - **Default currencies save time**: Set them to the currencies your teams use most frequently.
  - **Restrict currencies intentionally**: Only use Allowed Currencies if you have a clear reason (e.g., FX data coverage, compliance, standardization).
  - **Run Force FX sync proactively**: After adding currencies, before generating reports, or when rates seem stale.
  - **Check the FX snapshots table**: Use it to verify rates are reasonable and complete before finalizing reports.
  - **Use consistent ISO codes**: Always use 3-letter codes (EUR, USD, GBP)—never symbols (€, $, £) or numeric codes.

## Common scenarios

### Scenario 1: Changing the reporting currency
Your group switches from EUR-based to USD-based reporting.

**Steps**:
  1. Go to **Budget management > Administration > Currencies**
  2. Change Reporting Currency from `EUR` to `USD`
  3. Click **Save** (automatically triggers FX refresh)
  4. Verify the FX Rate Snapshots table shows USD as the base (all rates should now be relative to USD)
  5. Check OPEX and CAPEX lists—totals and yearly columns now display in USD

**Result**: All reports, dashboards, and lists show USD. Your stored item data (each item's own currency) remains unchanged.

### Scenario 2: Restricting currencies for compliance
Your finance team requires all spend to be recorded in EUR, USD, or GBP only.

**Steps**:
  1. Go to **Budget management > Administration > Currencies**
  2. Set Allowed Currencies to `EUR, USD, GBP`
  3. Click **Save**
  4. Run **Force FX sync** to ensure rates are available for all three currencies

**Result**: Users can only select EUR, USD, or GBP when creating or editing items. Attempts to import other currencies will fail with a clear error message.

### Scenario 3: Adding a new currency mid-year
Your company starts operations in Switzerland and needs to track CHF spend.

**Steps**:
  1. Go to **Budget management > Administration > Currencies**
  2. Add `CHF` to Allowed Currencies (e.g., `EUR, USD, GBP, CHF`)
  3. Click **Save**
  4. Click **Force FX sync** to fetch CHF rates immediately
  5. Verify CHF appears in the FX Rate Snapshots table with valid rates

**Result**: Users can now select CHF for new items. The FX rates table includes CHF with current and historical rates for accurate conversions.

### Scenario 4: Preparing for annual budget cycles
It's December, and you're preparing for next year's budget planning.

**Steps**:
  1. Go to **Budget management > Administration > Currencies**
  2. Click **Force FX sync** to refresh rates for the upcoming year
  3. Check the FX Rate Snapshots table to see the forward estimates for the next year
  4. Note that future year rates are forward estimates (reusing current year's rate)—review them as the year approaches

**Result**: Your budget forecasts for the next year use the latest available rates. Teams can plan CAPEX and OPEX with reasonable currency assumptions.

## Frequently asked questions

**Q: What happens if I change the reporting currency mid-year?**
A: All reports and lists immediately convert to the new currency. Historical data remains intact—only the display currency changes. Plan this change carefully to avoid confusion during active reporting periods.

**Q: Can I set different reporting currencies for different companies?**
A: No. The reporting currency is tenant-wide. All companies, reports, and totals use the same reporting currency. Individual items store their own currency, but conversions always target the tenant's reporting currency.

**Q: Why don't I see rates for a specific currency?**
A: The data source (World Bank or ExchangeRate-API) may not publish that currency. Check the ISO code is correct and commonly published. If needed, limit Allowed Currencies to codes with reliable data coverage.

**Q: How often do FX rates refresh automatically?**
A: Every 30 days, when any user logs in, the system refreshes rates for Y-1, Y, and Y+1. You can also manually trigger a refresh anytime using Force FX sync.

**Q: Do FX rate changes affect my stored data?**
A: No. Exchange rates only affect **conversion and display**. Each OPEX and CAPEX item stores its own currency and amounts, which never change when rates update. Only the displayed converted values in reports and lists change.

**Q: Can I import historical rates manually?**
A: No. The system fetches rates automatically from external sources (World Bank, ExchangeRate-API). If you need custom rates, contact support or consider using a currency where you can accept the published rates.

**Q: What if I need to use a currency not in the allowed list?**
A: Either add it to Allowed Currencies or leave the list empty (which allows all currencies). Remember to run Force FX sync after adding new currencies to populate rates.

**Q: Are forward estimates for future years accurate?**
A: Forward estimates reuse the current year's rate and should be treated as **planning assumptions**, not forecasts. Review them as future years approach and rates become available from official sources.
