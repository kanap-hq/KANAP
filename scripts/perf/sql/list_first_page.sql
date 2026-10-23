-- list_first_page
-- group: list_page
-- family: list_page
-- endpoint: GET /spend-items/summary?page=1&limit=50&sort=yBudget:DESC&shape=grid&status=enabled
-- source: backend/src/spend/spend-items.controller.ts (summary) -> backend/src/spend/budget-list/*, backend/src/common/list-engine/*
-- captured on appdb_perf10k (tenant perf, admin) on 2026-10-23, 72.29 ms in the API.
SELECT i.id, count(*) OVER () AS total, (CASE WHEN v2026.id IS NULL THEN NULL ELSE (CASE v2026.allocation_method WHEN 'manual_pct' THEN 'Manual %' WHEN 'manual_company' THEN 'Company' WHEN 'manual_department' THEN 'Department' WHEN 'headcount' THEN 'Headcount' WHEN 'it_users' THEN 'IT users' WHEN 'turnover' THEN 'Turnover' ELSE 'Headcount' END) END) AS allocation_label
	FROM spend_items i
	LEFT JOIN spend_versions v2026 ON v2026.tenant_id = '{{tenant_id}}' AND v2026.spend_item_id = i.id AND v2026.budget_year = 2026
	        AND (i.disabled_at IS NULL OR 2026 <= extract(year FROM i.disabled_at AT TIME ZONE 'UTC'))
	LEFT JOIN (
	        SELECT x.item_id,
	          (floor(max(x.planned) FILTER (WHERE x.yr = 2026)) + CASE WHEN (max(x.planned) FILTER (WHERE x.yr = 2026)) - floor(max(x.planned) FILTER (WHERE x.yr = 2026)) >= 0.5 THEN 1 ELSE 0 END) AS y2026_planned,
	          bool_or(x.fx_missing) FILTER (WHERE x.yr = 2026) AS y2026_fx_missing
	        FROM (
	          SELECT av.spend_item_id AS item_id, av.budget_year AS yr, fx.rate IS NULL AS fx_missing,
	            (CASE WHEN abs(at.planned) < 90071992547409.92 THEN ((at.planned) * 100)::bigint::float8 / 100 ELSE (at.planned)::float8 END) * fx.rate * 100 AS planned
	          FROM spend_versions av
	          JOIN spend_items ai ON ai.tenant_id = '{{tenant_id}}' AND ai.id = av.spend_item_id AND ai.nature = 'opex'
	          JOIN spend_version_totals at ON at.tenant_id = '{{tenant_id}}' AND at.version_id = av.id
	          LEFT JOIN unnest('{{fx_keys:2024,2025,2026,2027,2028}}'::text[], '{{fx_years:2024,2025,2026,2027,2028}}'::int[], '{{fx_curs:2024,2025,2026,2027,2028}}'::text[], '{{fx_rates:2024,2025,2026,2027,2028}}'::float8[]) AS fx(set_key, yr, cur, rate) ON fx.yr = av.budget_year AND fx.cur = ai.currency::text AND fx.set_key = CASE WHEN av.fx_rate_set_id = ANY('{{fx_known_sets}}'::uuid[]) THEN av.fx_rate_set_id::text ELSE 'live' END
	          WHERE av.tenant_id = '{{tenant_id}}' AND av.budget_year = ANY('{2026}'::int[])
	            AND (ai.disabled_at IS NULL OR av.budget_year <= extract(year FROM ai.disabled_at AT TIME ZONE 'UTC'))
	          OFFSET 0
	        ) x
	        GROUP BY x.item_id
	      ) am ON am.item_id = i.id
	WHERE (i.tenant_id = '{{tenant_id}}' AND i.nature = 'opex')
	  AND ((i.disabled_at IS NULL OR i.disabled_at >= '2026-01-01 00:00:00+00'::timestamptz))
	ORDER BY ((CASE WHEN am.y2026_fx_missing THEN NULL ELSE coalesce(am.y2026_planned, 0::float8) END)) DESC NULLS LAST, i.created_at DESC, i.id DESC
	LIMIT '50'::int OFFSET '0'::bigint;
