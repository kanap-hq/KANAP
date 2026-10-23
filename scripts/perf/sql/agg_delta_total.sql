-- agg_delta_total
-- group: agg_delta
-- family: report_aggregate
-- endpoint: POST /spend-items/summary/aggregate (delta)
-- source: backend/src/spend/spend-items.controller.ts (summaryAggregate) -> backend/src/spend/budget-list/budget-list.service.ts (budgetListAggregate)
-- captured on appdb_perf10k (tenant perf, admin) on 2026-10-23, 15.46 ms in the API.
WITH core AS (SELECT i.id, i.currency, i.disabled_at
	FROM spend_items i
	
	WHERE (i.tenant_id = '{{tenant_id}}' AND i.nature = 'opex')
	  AND ((i.disabled_at IS NULL OR i.disabled_at >= '2025-01-01 00:00:00+00'::timestamptz)))
	SELECT (SELECT coalesce(json_agg(m ORDER BY m.currency COLLATE "C", m.year), '[]'::json) FROM (
	      SELECT upper((btrim(c.currency::text, E'\u0009\u000A\u000B\u000C\u000D\u0020\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF')) COLLATE "und-x-icu") AS currency, v.budget_year AS year, count(DISTINCT c.id)::int AS lines
	      FROM core c
	      JOIN spend_versions v ON v.tenant_id = '{{tenant_id}}' AND v.spend_item_id = c.id
	        AND v.budget_year = ANY('{2025,2026}'::int[])
	        AND (c.disabled_at IS NULL OR v.budget_year <= extract(year FROM c.disabled_at AT TIME ZONE 'UTC'))
	      JOIN spend_version_totals t ON t.tenant_id = '{{tenant_id}}' AND t.version_id = v.id
	      LEFT JOIN unnest('{{fx_keys:2025,2026}}'::text[], '{{fx_years:2025,2026}}'::int[], '{{fx_curs:2025,2026}}'::text[], '{{fx_rates:2025,2026}}'::float8[]) AS fxm(set_key, yr, cur, rate) ON fxm.yr = v.budget_year AND fxm.cur = c.currency::text AND fxm.set_key = CASE WHEN v.fx_rate_set_id = ANY('{{fx_known_sets}}'::uuid[]) THEN v.fx_rate_set_id::text ELSE 'live' END
	      WHERE fxm.rate IS NULL
	      GROUP BY 1, 2
	    ) m) AS fx_missing;
