# Currency Management

> Introduced in Q4 2024 – all spend reporting now runs in a tenant-defined reporting currency with automatic FX handling.

## Concepts at a Glance

- **Reporting currency** – the canonical currency for budgets, CAPEX, reports, and dashboards. Every tenant must pick one.
- **Entry defaults** – separate defaults for new OPEX and CAPEX items. Editors preload this value but users can pick any authorised currency.
- **Allowed currencies** – optional whitelist restricting the selectors shown in OPEX/CAPEX editors and CSV imports. The reporting + default currencies are always allowed even if you leave the list empty.
- **Annual FX rate sets** – one JSON snapshot per tenant, per fiscal year. Rates now come from the World Bank data API (`PA.NUS.FCRF`, domestic currency per USD). Historic years use the published annual average, the current fiscal year blends the available quarterly averages derived from monthly observations, and forward years reuse the latest quarterly average.
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

1. **Save** – persists the settings to `tenants.metadata`, upserts any missing ISO codes into the shared `currencies` table, and refreshes totals that depend on the reporting currency.
2. **Force FX rates sync** – downloads the latest World Bank FX dataset (`PA.NUS.FCRF`) for historical averages, fetches a live spot quote for the current year (via `FX_SPOT_BASE_URL`/`FX_SPOT_API_KEY`), computes cross‑rates for every tenant currency (plus the reporting currency, EUR, and USD), and stores them in `currency_rate_sets`. Historic fiscal years use the published annual average; the current year uses the live spot rate and falls back to the latest annual value; future years reuse the current‑year value and mark the snapshot as a forward estimate. Run this after changing the reporting currency or before freezing a new budget year. The sync automatically backfills the earliest budget year with non‑zero spend/CAPEX data alongside the requested horizon. If upstream feeds do not return a value we log a warning and capture `null` for that currency so downstream conversions fall back to identity until data is available.
   - Environment overrides: set `WB_BASE_URL` to route through a proxy and `WB_CACHE_TTL_MS` (milliseconds) to adjust the in-memory cache window (defaults to 6 hours).
   - CSV cache overrides: `WB_CSV_URL` (alternate download host), `WB_CSV_CACHE_TTL_MS` (milliseconds, defaults to 30 days), `WB_CACHE_DIR` (directory for the extracted CSV).
   - Spot rate overrides: `FX_SPOT_BASE_URL`, `FX_SPOT_API_KEY`, and `FX_SPOT_CACHE_TTL_MS` (milliseconds, defaults to 30 days).
   - Login‑triggered refresh: every tenant login checks `tenants.metadata.fx_last_login_refresh_at` and, at most once per interval (default 30 days, tune via `FX_LOGIN_REFRESH_INTERVAL_MS`), silently queues the same FX sync for `[currentYear-1, currentYear, currentYear+1]`. The timestamp and years are recorded back into tenant metadata for auditing.
   - Manual refresh scope: UI/API triggers are tenant‑scoped.
   - Caching: responses from the World Bank API are cached in-memory for the configured TTL. Back-to-back refreshes within that window reuse the cached payload, keeping the job fast and friendly to upstream rate limits.

> ⚠️ Saving does *not* retroactively convert transaction values; it changes how we display and aggregate them going forward. Always communicate the switch to stakeholders.

## How FX Rates Are Stored

1. We download the World Bank CSV bundle for `PA.NUS.FCRF`, extract it once, and cache the annual averages in memory. Every fiscal year up to `currentYear - 1` is read from that dataset.
2. For the current fiscal year we fetch a live spot quote (domestic currency per USD). If the spot feed does not return a value, we fall back to the latest annual average from the CSV cache. Future years reuse the current‑year value and mark the snapshot as a forward estimate so downstream consumers know the number is projected.
3. We derive cross rates via USD: `tenant_base_per_source = (base_per_USD) / (source_per_USD)`. When neither dataset yields a quote we store `null` so downstream code can warn and fall back to identity conversions.
4. The values are stored in `currency_rate_sets` (tenant-scoped, JSON column keyed by ISO code). Conversion multiplies spend/CAPEX amounts by the relevant rate and rounds to 2 decimals.

Snapshot rules:

- Freeze OPEX or CAPEX `budget` column → freeze service grabs/creates a rate set for that year and references it from the affected spend or capex versions.
- Unfreeze → clears the `fx_rate_set_id` so draft calculations fall back to the latest live average.
- Missing rates (for example, when neither the CSV dataset nor the spot feed has a quote) are stored as `null` and logged. Conversions fall back to `1.0` in the app so the UI remains usable while you adjust allowed currencies or wait for data to publish.

## Editors and Validation

- OPEX & CAPEX editors now use an autocomplete with ISO metadata, filtered by the allowed list. Users can still type to search, but they cannot submit an invalid code.
- Legacy items that carry a currency outside the whitelist remain editable – we display the code with a “Unknown currency code” tag and let you save it again, though conversions will fall back to `1.0`.
- CSV import/export continues to enforce 3-letter ISO codes. When a tenant limits allowed currencies, we validate against that list as well. The import API now returns `allowedCurrencies` in its error payload so you can respond with better UX.

## Reporting & Totals

- Every backend aggregation (`/spend-items/summary`, `/capex-items/summary`, report endpoints, chargeback) now emits converted values alongside the original sums.
- Frontend totals, charts, and pinned rows show the reporting currency in headers and labels (e.g., “Y Budget (2026) [USD]”).
- API consumers can still access raw amounts in the `totals` structure; converted values live under a matching `reporting` object.

## Operational Checklist

| Task | Command/UI |
|------|------------|
| Change reporting/default currencies | Budget management → Administration → Currencies → Save |
| Force refresh FX rates | Budget Management → Currency Settings → Force FX rates sync <br> *(backend: `POST /currency/rates/refresh` with optional `{ "years": [2026, 2027] }`)* |
| Verify rate sets | `SET LOCAL app.current_tenant = '<tenant_id>'; SELECT fiscal_year, base_currency, rates FROM currency_rate_sets ORDER BY captured_at DESC;` *(Basis of the table shown on the Currency Settings page)* |
| Freeze workflow | 1. Force sync (optional). <br> 2. Freeze year via Budget Management → Freeze Data or API. <br> 3. Confirm `spend_versions.fx_rate_set_id` (or `capex_versions`) is populated for the frozen year. |
| Monitor ingestion | Logs tagged with `FxIngestionService` and `FxRateService`. Look for WARN messages indicating missing currencies. |

## Testing Tips

- Unit: stub `FxRateService.resolveRates` to return deterministic rates when testing spend/capex summaries.
- Integration: run `POST /currency/settings` followed by `POST /currency/rates/refresh` in Supertest before freezing to ensure snapshots exist.
- Frontend: mock the `GET /currency/settings` payload in Storybook or component tests to check that the selectors honour allowed lists and helper text.
- CSV flows: add regression cases for currencies outside the allowed set to ensure the API returns a validation error with the allowed list in the message.

## Frequently Asked Questions

**What happens if the World Bank feed doesn’t publish a code I use?**  
We capture a `null` rate and log a warning. Conversions default to `1.0` until data becomes available. Ideally adjust your allowed list to ISO currencies covered by the World Bank dataset. Custom/manual overrides are not supported yet.

**Do I have to re-freeze a year after changing reporting currency?**  
Yes. Existing frozen versions keep their original snapshot. If you change the reporting currency, force an FX rates sync, unfreeze, and then re-freeze to capture the updated rate set.

**Can I force-sync older fiscal years?**  
Use `POST /currency/rates/refresh` with the `years` array (e.g., `[2023, 2024]`). The UI defaults to current + next year because that’s what freeze operations need most often.

**Is UTC relevant?**  
Yes – the ingestion job timestamps snapshots in UTC. If you schedule anything externally, run it after the World Bank publishes the refreshed annual CSV (usually early in the new year) so Y-1 values are available, and be mindful of your spot-rate provider’s update cadence.

---

See also:

- [`doc/reporting-guidelines.md`](./reporting-guidelines.md) – how the reporting layer consumes converted totals.
- [`doc/steps/05-spend-core.md`](./steps/05-spend-core.md) and [`doc/steps/06-csv-import-export.md`](./steps/06-csv-import-export.md) – entity and CSV field definitions.
- [`doc/reporting-guidelines.md`](./reporting-guidelines.md#currency) for UI conventions.
