# Currency Management

> Introduced in Q4 2024 – all spend reporting now runs in a tenant-defined reporting currency with automatic FX handling.

## Concepts at a Glance

- **Reporting currency** – the canonical currency for budgets, CAPEX, reports, and dashboards. Every tenant must pick one.
- **Entry defaults** – separate defaults for new OPEX and CAPEX items. Editors preload this value but users can pick any authorised currency.
- **Allowed currencies** – optional whitelist restricting the selectors shown in OPEX/CAPEX editors and CSV imports. The reporting + default currencies are always allowed even if you leave the list empty.
- **Annual FX rate sets** – one JSON snapshot per tenant, per fiscal year. Rates come from the World Bank series `PA.NUS.FCRF` (domestic currency per USD) and a live spot quote for the current year. Each currency in the snapshot records the source of its value in `rate_sources`. The chain is described under "How FX rates are stored".
- **Manual rate** – one currency and one year, stored on that year's rate set with source `manual`. It outranks every automatic source while it is stored. See [Manual rates](#manual-rates).
- **Freeze integration** – when you freeze the OPEX/CAPEX budget column for a year we capture the current rate set and pin it to the approved versions. Draft years continue to look up the latest live average until they are frozen.

## Currency Settings (UI)

Path: **Budget management → Administration → Settings → Currencies** (`/ops/operations/currency`; the old `/master-data/currency` redirects there)

The page exposes three inputs and an optional list:

| Field | Description |
|-------|-------------|
| Reporting currency | Three-letter ISO code used everywhere we display totals (reports, chargeback, OPEX/CAPEX lists, CSV exports). |
| Default OPEX currency | Pre-filled in the OPEX editor when you create a new spend item. |
| Default CAPEX currency | Pre-filled in the CAPEX editor. |
| Allowed currencies (optional) | Comma-separated ISO codes. The OPEX and CAPEX selectors will limit their dropdown to this set plus the reporting/default currencies. Leave blank for the full list of ISO currencies. |

Permissions: budget readers (`budget_ops:reader`) see the page read-only; budget administrators (`budget_ops:admin`) change the settings and run the FX sync. The API also lets OPEX and CAPEX readers read the settings and rates (their forms' currency picker), and the page opens for them read-only. The empty FX rates table suggests the sync only to budget administrators.

The panel also contains two actions:

1. **Save** – persists the settings to `tenants.metadata` and upserts any missing ISO codes into the shared `currencies` table, in the request transaction. The new reporting currency must be a key of `ISO_CURRENCIES` (400 `currency_invalid` otherwise). The save does not wait for any fetch: it queues a refresh that starts once the request has committed and the follow-up `POST /currency/rates/refresh` has read the pairs already stored, so that call's `fetched` counts the rates the run brings in. If that call never comes, the run starts on its own after a short wait. The save answers the settings plus `refreshYears`. When `reportingCurrency` changes, `refreshYears` is every year in use for the new base: budget version years (frozen versions included), company metric years with a turnover, the years contract amounts are read for, and the current calendar year with the year before and the year after it. Otherwise it is the current year. The page then calls `POST /currency/rates/refresh` with those years to wait for the result.
2. **Force FX rates sync** – downloads the World Bank FX dataset (`PA.NUS.FCRF`), fetches a live spot quote for the current year (via `FX_SPOT_BASE_URL`/`FX_SPOT_API_KEY`), computes cross rates for every tenant currency (the reporting currency, the defaults, the allowed list, EUR, USD, and the currencies used by budget lines, companies and contracts), and stores them in `currency_rate_sets`. The per-year chain and `rate_sources` are described under "How FX rates are stored". Run this before freezing a new budget year, or when a rate is still missing after a change of reporting currency (that save already refreshes every year in use). The sync automatically backfills the earliest budget year with non-zero spend/CAPEX data alongside the requested horizon. If upstream feeds do not return a value we log a warning. A currency the latest set of that year already rates keeps that rate and the source that produced it; a currency with no stored rate is captured as `null`, and downstream conversions fall back to identity until data is available.
   - Environment overrides: set `WB_BASE_URL` to route through a proxy and `WB_CACHE_TTL_MS` (milliseconds) to adjust the in-memory cache window (defaults to 6 hours).
   - CSV cache overrides: `WB_CSV_URL` (alternate download host), `WB_CSV_CACHE_TTL_MS` (milliseconds, defaults to 30 days), `WB_CACHE_DIR` (directory for the extracted CSV).
   - Spot rate overrides: `FX_SPOT_BASE_URL`, `FX_SPOT_API_KEY`, and `FX_SPOT_CACHE_TTL_MS` (milliseconds, defaults to 30 days).
   - Login‑triggered refresh: every tenant login checks `tenants.metadata.fx_last_login_refresh_at` and, at most once per interval (default 30 days, tune via `FX_LOGIN_REFRESH_INTERVAL_MS`), silently queues the same FX sync for `[currentYear-1, currentYear, currentYear+1]`. The timestamp and years are recorded back into tenant metadata for auditing.
   - Missing-rate refresh: when `FxRateService.resolveRates` finds no rate for a currency in a year (no snapshot for the year, or the latest one lacks the currency), the lookup answers 1 with the source `missing` and the year goes to `FxIngestionService.refreshMissingYears`, which queues the same FX sync for those years in the background. `contractFxRates` does the same for a year in which a contract currency of the tenant has no rate (`FxRateService.reportMissingYears`). Each tenant year at most once every 6 hours per process, so a currency the sources do not publish (or a server without internet) does not call them on every read.
   - Manual refresh scope: UI/API triggers are tenant‑scoped.
   - Caching: responses from the World Bank API are cached in-memory for the configured TTL. Back-to-back refreshes within that window reuse the cached payload, keeping the job fast and friendly to upstream rate limits.

> ⚠️ Saving does *not* retroactively convert transaction values; it changes how we display and aggregate them going forward. Always communicate the switch to stakeholders.

## How FX Rates Are Stored

1. We download the World Bank CSV bundle for `PA.NUS.FCRF`, extract it once, and cache the annual averages in memory. The series holds every published year. When a past year is missing from a copy older than 24 hours, that copy is reloaded once, bypassing the memory cache and the CSV file, and the year is looked up again. A process reloads at most once every 24 hours.
2. Each currency is quoted in USD, then crossed into the reporting currency: `reporting_per_source = (reporting_per_USD) / (source_per_USD)`. The value for one currency and year follows this chain. USD is 1. A currency with no World Bank code stays empty.
   - A past year (up to `currentYear - 1`) uses the published annual average, source `world-bank-annual`. When that year is not in the series, the nearest published year of the same currency is used: the closest earlier year, otherwise the closest later year. That value's source is `estimate`.
   - The current year uses the live spot quote, source `exchangerateapi-spot`. When the spot feed has no quote, the World Bank annual of the current year is used (`world-bank-annual`). When that is not published either, the latest published annual of the currency is used (`world-bank-forward`). A refresh that asked for past years reuses the series it already loaded. A refresh of the current year alone reads `currentYear - 10` through `currentYear - 1`.
   - A future year reuses the current-year value, or that latest published annual, with source `world-bank-forward`. A future year requested on its own reads the same window.
   - The reporting currency follows the same chain. An estimate for it still lets the year be stored.
3. The cross rates are stored in `currency_rate_sets.rates` (units of the reporting currency for 1 unit of the currency). `rate_sources` maps each currency code to the source of its value: `world-bank-annual`, `exchangerateapi-spot`, `world-bank-forward`, `estimate`, `identity` (the reporting currency, and USD when USD is the reporting currency), or `manual` (see [Manual rates](#manual-rates)). The set-level `source` remains the source computed for the year as a whole. Readers take the latest set of the year (`captured_at` descending). A set captured before `rate_sources` existed lends its set-level `source` to each of its values.
4. A refresh merges with that latest set before inserting. For each currency the order is: a stored `manual` value, then a fresh real value, then the stored real value, then a fresh estimate, then the stored estimate. A fetch writes the automatic sources (`world-bank-annual`, `exchangerateapi-spot`, `world-bank-forward`, `estimate`, `identity`). Among those, every source other than `estimate` is real, including a value whose source was not recorded. A currency this fetch does not rate, including one that is no longer in the fetch list, keeps its stored value and source. The "unchanged, skip insert" check runs on the merged rates. A published World Bank value replaces an estimate and a rate captured earlier for that year. A stored `manual` value stays. Conversion multiplies amounts by the rate and rounds to 2 decimals.

Snapshot rules:

- Freeze OPEX or CAPEX `budget` column → freeze service grabs/creates a rate set for that year and references it from the affected spend or capex versions.
- Unfreeze → clears the `fx_rate_set_id` so draft calculations fall back to the latest live average.
- A currency no source and no previous set can rate is stored as `null` and logged. Conversions fall back to `1.0` in the app so the UI remains usable while you adjust allowed currencies or wait for data to publish.

## Manual rates

A manual rate is a value on the year's rate set, with `rate_sources[currency] = 'manual'`. Lists, reports, chargeback and contracts read the latest set of the year, so they use that value on the same path as a fetched rate. A freeze pins the set, and the manual value with it.

The rate is units of the reporting currency of that set for 1 unit of the currency, rounded to 6 decimals (`Number(rate.toFixed(6))`, the same rounding as a fetched cross rate). The currency is three letters, stored uppercased, and distinct from the reporting currency. The year is an integer from 1990 to 2100. The rate is finite, greater than 0, and at most 1000000000 after rounding. A code absent from `currencies` is inserted there (`CurrencySettingsService.ensureCurrencyRecords`: the ISO name, or the code when the ISO list has none).

Writing a rate inserts a new row in `currency_rate_sets`. The previous rows stay.

- When the year already has a set whose base is the reporting currency, the new row copies its `rates`, `rate_sources`, `source` and `rate_basis`, then sets `rates[currency]` to the rate and `rate_sources[currency]` to `manual`.
- When the year has no such set, the new row stores `{ [reporting]: 1, [currency]: rate }`, sources `{ [reporting]: 'identity', [currency]: 'manual' }`, `source: 'manual'` and `rate_basis: 'manual'`.

`captured_at` is then set to `clock_timestamp()`. `now()` is the start of the transaction, so two inserts in one transaction would otherwise tie, and readers that order by `captured_at` descending would not see a stable latest set.

Removing a rate inserts another new row: a copy of the latest set in which that currency's rate is `null` and its entry is dropped from `rate_sources`. The set-level `source` and `rate_basis` stay as they were. The removal then calls `FxIngestionService.queueManualRefresh(tenantId, [year], { label: 'manual-rate-removed' })`, so the automatic chain can fill the pair again. When that queue returns `skipped` (a refresh for the tenant is already running), the year goes to `FxRateService.reportMissingYears`, which waits for the running job and then refreshes the year. The response is `{ ok: true, refreshQueued }`, and `refreshQueued` is true when this call queued the job.

Removing a currency whose latest value is missing, unusable, or recorded under another source answers 404: `No manual rate is stored for GBP in 2024.`

### Precedence

`ratePrecedence` ranks a stored `manual` value at 5. Below it: a fresh real value (4), a stored real value (3), a fresh estimate (2), a stored estimate (1). A fetch writes `world-bank-annual`, `exchangerateapi-spot`, `world-bank-forward`, `estimate` or `identity`. While the manual value is on the latest set, a refresh keeps that value and the `manual` source. After a removal, the next refresh applies the automatic chain.

### Lock

`saveRateSet` and both manual writes call `lockRateSetWrite` before they read the latest set. The statement is `SELECT pg_advisory_xact_lock(hashtext($1))` with key `fx-rate-set:<tenantId>:<year>`. The lock is held until the transaction commits. The second writer of the same tenant and year reads the set the first writer has committed.

Both callers already run inside a transaction. A refresh with no request manager uses `withTenantExecution(..., { transaction: true })`. A refresh started from the API uses the request transaction. A manual write uses that same request transaction: `TenantInitGuard` opens it and `TenantInterceptor` commits it after the handler returns. The refresh queued by a removal opens its own transaction. It takes the same lock, waits until the removal commits, and then reads the set in which the currency is null. The request returns before that job finishes. Waiting for it while the request still holds the lock deadlocks.

### Audit

Each entry, change and removal is written to `audit_log` in the same transaction (`AuditService.log`, `table: 'currency_rate_sets'`, `recordId` the new set id, `userId` from `req.user.sub`).

| Action | When | `before` | `after` |
|--------|------|----------|---------|
| `create` | the year had no set | `{ fiscal_year, currency, rate: null, source: null }` | `{ fiscal_year, currency, rate, source: 'manual' }` |
| `update` | the year had a set | the previous usable rate and its source, or nulls when the previous value is missing or unusable | `{ fiscal_year, currency, rate, source: 'manual' }` |
| `delete` | removal | `{ fiscal_year, currency, rate, source: 'manual' }` | `null` |

On an update, the previous source is the per-currency `rate_sources` entry. A set captured before `rate_sources` existed lends its set-level `source`.

### Missing pairs

`GET /currency/rates/missing` lists the pairs in use that the latest set of the year, for the current reporting currency, does not rate with a finite value above 0. The reporting currency is rated at 1 and is left out. Pairs are deduped and sorted by year, then currency. The body is `{ items: [{ currency, year }, ...] }`.

One query per source:

- Budget lines, both natures: `UPPER(TRIM(spend_items.currency))` with `spend_versions.budget_year`. The tenant is named on both tables.
- Companies: `UPPER(TRIM(companies.base_currency))` with each `company_metrics.fiscal_year` whose `turnover` is non-null.
- Contracts: the contract currency (a blank one counts as EUR, as the conversion does) with each year the contract pages read (`contractBudgetYears`: the current year, the two after it, and the previous year when a budget version exists for it) in which the contract runs (from its start date to the end of its first term or its end of validity; a renewing contract runs on).
- Pinned sets of an older base: the `base_currency` of the set each `spend_versions.fx_rate_set_id` names, with the version's `budget_year`, when it differs from the reporting currency. Such a version converts through the live rate of that old base, so the refresh also fetches it, and the matrix shows it for manual entry.

A rate of 0, a null, or a year with no set leaves the pair in the list. Storing a manual rate for the pair takes it out. After the list is built, the years of those pairs go to `FxRateService.reportMissingYears`, so opening the list also tries the sources.

A manual rate belongs to the reporting currency of the set it was written on. After the reporting currency changes, new sets use the new base. The old manual value stays on the sets of the previous base, and the pair shows as missing until a rate is stored for the new base. Switching the reporting currency back to that base makes the stored manual rate apply again.

### API

Readers are `budget_ops:reader` or `budget:reader` (`CURRENCY_READERS`). Writers are `budget_ops:admin`.

- `GET /currency/rates` returns `{ currencies, rates }`. `rates` is the latest set of each fiscal year whose `base_currency` is the current reporting currency (one object per year: `{ fiscalYear, baseCurrency, rates, rateSources, capturedAt, source }`). A set stored for a previous reporting currency is not read. `rateSources` is `rate_sources`, or `{}` when the column is null. `baseCurrency` is the stored code, trimmed. Each year's `rates` and `rateSources` keep the currencies in use (the reporting currency, the default currencies, the allowed list, and every currency of a budget line, a company turnover or a contract) plus any currency whose source on that set is `manual`. `currencies` is that row list, the reporting currency first and the rest in alphabetical order, including a currency in use that no set rates yet and a manual rate for a currency no longer in use. Example: `{ "currencies": ["EUR", "GBP", "USD"], "rates": [{ "fiscalYear": 2024, "baseCurrency": "EUR", "rates": { "EUR": 1, "USD": 1.08 }, "rateSources": { "EUR": "identity", "USD": "world-bank-annual" }, "capturedAt": "2024-06-01T00:00:00.000Z", "source": "world-bank-annual" }] }`.
- `GET /currency/rates/missing` returns `{ items: Array<{ currency: string, year: number }> }`. Declared before the parameterised delete route.
- `PUT /currency/rates/manual` with `{ currency: string, year: number, rate: number }` returns the new set as `{ fiscalYear, baseCurrency, rates, rateSources, capturedAt, source, frozenVersions }`. `frozenVersions` is the number of versions of that budget year the new rate does not reach: their `fx_rate_set_id` names a set in the current reporting currency that rates this currency itself. A version pinned to a set of an older base, or to a set without the currency, reads the live set and follows the manual rate. `baseCurrency` is trimmed. The currency must be a key of `ISO_CURRENCIES` (the same list as currency settings). Invalid input answers 400 `{ code, message }`. `error.message` is the English `message`. Codes: `currency_invalid` (`Currency must be a 3-letter ISO code.`), `currency_reporting` (`A manual rate cannot be set for the reporting currency.`), `year_out_of_range` (`Year must be an integer between 1990 and 2100.`), `rate_out_of_range` (`Rate must be a finite number greater than 0 and at most 1000000000.`), `rate_too_small` (`Rate rounds to 0 at 6 decimal places and cannot be stored.`). A finite rate above 0 that rounds to 0 at 6 decimals is `rate_too_small`.
- `DELETE /currency/rates/manual/:year/:currency` returns `{ ok: true, refreshQueued: boolean, frozenVersions: number }`. `frozenVersions` counts the same versions as the PUT. Unknown currency or year uses the same 400 codes. A year that has no manual value for that currency answers 404 `{ code: 'manual_rate_not_found', message }`.
- `GET /currency/reporting-change-impact?to=CHF` (`budget_ops:admin`) describes a change to that reporting currency before it is saved. `manualRates` is `[{ currency, year, rate }]`: every manual rate on the latest set of each year whose base is the current reporting currency (a usable rate whose `rate_sources` entry is `manual`). Those rates stop applying while the other currency is current. `frozenVersions` is `[{ year, count }]`, the versions of each budget year that keep a pinned rate set. `allowedAdded` is true when `allowedCurrencies` is a list and `to` is not in it: the save will add it. A tenant with no allowed list (any ISO code is accepted) answers `allowedAdded: false`. `to` is a key of `ISO_CURRENCIES`; anything else is 400 `{ code: "currency_invalid", message: "Currency must be a 3-letter ISO code." }`. Example: `{ "manualRates": [{ "currency": "USD", "year": 2024, "rate": 1.7 }], "frozenVersions": [{ "year": 2024, "count": 2 }], "allowedAdded": true }`.
- `POST /currency/rates/refresh` with an optional `{ years: number[] }` (or `{ year }`) queues the fetch for the current reporting currency and waits up to 20 seconds for the run that covers those years. Each tenant has one refresh queue: a run already going answers the request when it covers its years and base; otherwise the years are merged into the next run, which starts when the running one ends. No request is dropped. The fetch commits on its own connection; the request transaction only reads and holds no row lock while it waits (the route is marked `OUTSIDE_WORK_TIMEOUTS`). Without years, the set is the previous, current and next calendar years, every year of a missing currency pair, and every year that already has a non-zero budget amount. With years, it is the requested years plus those budget-amount years. A finished run answers `{ ok: true, completed: true, failed, years, fetched, stillMissing }`. `failed` is true when that run captured nothing (source unreachable, job error); `fetched` is then 0. `fetched` counts the currency-year pairs of the current reporting currency that gained a usable rate (finite and above 0), keys uppercased. A refresh queued by a settings save does not start until this request has read the pairs already stored, so the count includes the rates that save brings in. `stillMissing` is `[{ currency, year }, ...]`, the pairs still without one. If the wait ends first, the answer is `{ ok: true, completed: false, years }` and the run continues. Example: `{ "ok": true, "completed": true, "failed": false, "years": [2024, 2025, 2026, 2027], "fetched": 6, "stillMissing": [{ "currency": "XOF", "year": 2027 }] }`.
- `PATCH /currency/settings` with `{ reportingCurrency, defaultSpendCurrency, defaultCapexCurrency, allowedCurrencies }` saves and answers at once with the settings plus `refreshYears`, the years of the refresh it queued (to start after the commit, once the follow-up has read the pairs already stored). When `reportingCurrency` changes, they are every year in use for the new base (budget version years, company metric years with a turnover, the years contract amounts are read for, the current year ± 1, and frozen years, which are version years); otherwise the current year. `reportingCurrency` outside `ISO_CURRENCIES` answers 400 `{ code: "currency_invalid", message: "Currency must be a 3-letter ISO code." }`. Example: `{ "reportingCurrency": "CHF", "defaultSpendCurrency": "EUR", "defaultCapexCurrency": "EUR", "allowedCurrencies": ["CHF", "EUR"], "refreshYears": [2019, 2024, 2025, 2026, 2027, 2028] }`. `POST /currency/rates/refresh` with `{ years: refreshYears }` then waits for that run.

## Editors and Validation

- OPEX & CAPEX editors now use an autocomplete with ISO metadata, filtered by the allowed list. Users can still type to search, but they cannot submit an invalid code.
- Legacy items that carry a currency outside the whitelist remain editable – we display the code with a “Unknown currency code” tag and let you save it again, though conversions will fall back to `1.0`.
- CSV import/export continues to enforce 3-letter ISO codes. When a tenant limits allowed currencies, we validate against that list as well. The import API now returns `allowedCurrencies` in its error payload so you can respond with better UX.

## Reporting & Totals

- A frozen version keeps the rate set pinned at freeze time. When that set's base is still the reporting currency, its rates apply as stored. When the reporting currency has since changed, each amount is converted with `pinned[source → old base] × live[old base → reporting]` for the same year. An amount already in the old base takes the live rate alone. An amount in the new reporting currency still goes through the pinned rate (that frozen rate stays the anchor). If the live rate of the old base is missing, the amount is left out and the year is fetched, the same way as any other missing rate. The resolved rate names the current reporting currency and records the old base in `via`.
- Every backend aggregation (`/spend-items/summary`, `/capex-items/summary`, report endpoints, chargeback) now emits converted values alongside the original sums.
- Frontend totals, charts, and pinned rows show the reporting currency in headers and labels (e.g., “Y Budget (2026) [USD]”).
- API consumers can still access raw amounts in the `totals` structure; converted values live under a matching `reporting` object.

## Operational Checklist

| Task | Command/UI |
|------|------------|
| Change reporting/default currencies | Budget management → Administration → Currencies → Save |
| Force refresh FX rates | Budget Management → Currency Settings → Force FX rates sync <br> *(backend: `POST /currency/rates/refresh` with optional `{ "years": [2026, 2027] }`)* |
| Set a manual rate | `PUT /currency/rates/manual` with `{ "currency": "GBP", "year": 2024, "rate": 1.17 }` (`budget_ops:admin`) |
| Remove a manual rate | `DELETE /currency/rates/manual/2024/GBP` |
| List pairs with no rate | `GET /currency/rates/missing` |
| Verify rate sets | `SET LOCAL app.current_tenant = '<tenant_id>'; SELECT fiscal_year, base_currency, rates, rate_sources FROM currency_rate_sets ORDER BY captured_at DESC;` *(Basis of the table shown on the Currency Settings page)* |
| Freeze workflow | 1. Force sync (optional). <br> 2. Freeze year via Budget Management → Freeze Data or API. <br> 3. Confirm `spend_versions.fx_rate_set_id` (or `capex_versions`) is populated for the frozen year. |
| Monitor ingestion | Logs tagged with `FxIngestionService` and `FxRateService`. Look for WARN messages indicating missing currencies. |

## Testing Tips

- Unit: stub `FxRateService.resolveRates` to return deterministic rates when testing spend/capex summaries.
- Integration: run `POST /currency/settings` followed by `POST /currency/rates/refresh` in Supertest before freezing to ensure snapshots exist.
- Frontend: mock the `GET /currency/settings` payload in Storybook or component tests to check that the selectors honour allowed lists and helper text.
- CSV flows: add regression cases for currencies outside the allowed set to ensure the API returns a validation error with the allowed list in the message.

## Frequently Asked Questions

**What happens if the World Bank feed does not publish a code I use?**  
A past year takes the nearest published year of that currency and records the source `estimate`. A rate already stored for that year (for example the spot captured while the year was current) is kept until the World Bank publishes the year, which then replaces it. A currency with no published year and no stored rate is captured as `null` and logged. Conversions default to `1.0` until a rate is stored. A budget administrator can store a manual rate for that currency and year (see [Manual rates](#manual-rates)). While that value is on the latest set, it is the rate the year uses, ahead of every automatic source.

**Do I have to re-freeze a year after changing reporting currency?**  
No. A frozen version keeps the rate set from its freeze. Its amounts are converted from that currency into the current reporting currency at the live rate of the year. Re-freezing pins a new set captured in the reporting currency of that moment.

**Can I force-sync older fiscal years?**  
Use `POST /currency/rates/refresh` with the `years` array (e.g., `[2023, 2024]`). Without `years`, the sync covers the previous, current and next calendar years, the years of missing pairs, and the years that already have amounts. The answer's `completed` says whether the fetch finished within 20 seconds.

**Is UTC relevant?**  
Yes – the ingestion job timestamps snapshots in UTC. If you schedule anything externally, run it after the World Bank publishes the refreshed annual CSV (usually early in the new year) so Y-1 values are available, and be mindful of your spot-rate provider’s update cadence.

---

See also:

- [`doc/reporting-guidelines.md`](./reporting-guidelines.md) – how the reporting layer consumes converted totals.
- [`doc/steps/05-spend-core.md`](./steps/05-spend-core.md) and [`doc/steps/06-csv-import-export.md`](./steps/06-csv-import-export.md) – entity and CSV field definitions.
- [`doc/reporting-guidelines.md`](./reporting-guidelines.md#currency) for UI conventions.
