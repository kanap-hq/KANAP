-- agg_trend
-- group: agg_trend
-- family: report_aggregate
-- endpoint: POST /spend-items/summary/aggregate (trend)
-- source: backend/src/spend/spend-items.controller.ts (summaryAggregate) -> backend/src/spend/budget-list/budget-list.service.ts (budgetListAggregate)
-- captured on appdb_perf10k (tenant perf, admin) on 2026-10-23, 52.84 ms in the API.
WITH agg_lines AS (SELECT (CASE WHEN am.y2025_fx_missing THEN NULL ELSE coalesce(am.y2025_planned, 0::float8) END) AS v0, (CASE WHEN am.y2026_fx_missing THEN NULL ELSE coalesce(am.y2026_planned, 0::float8) END) AS v1, (CASE WHEN am.y2027_fx_missing THEN NULL ELSE coalesce(am.y2027_planned, 0::float8) END) AS v2, (CASE WHEN am.y2026_fx_missing THEN NULL ELSE coalesce(am.y2026_expected_landing, 0::float8) END) AS v3
	FROM spend_items i
	LEFT JOIN (
	        SELECT x.item_id,
	          (floor(max(x.planned) FILTER (WHERE x.yr = 2025)) + CASE WHEN (max(x.planned) FILTER (WHERE x.yr = 2025)) - floor(max(x.planned) FILTER (WHERE x.yr = 2025)) >= 0.5 THEN 1 ELSE 0 END) AS y2025_planned,
	          bool_or(x.fx_missing) FILTER (WHERE x.yr = 2025) AS y2025_fx_missing,
	          (floor(max(x.expected_landing) FILTER (WHERE x.yr = 2026)) + CASE WHEN (max(x.expected_landing) FILTER (WHERE x.yr = 2026)) - floor(max(x.expected_landing) FILTER (WHERE x.yr = 2026)) >= 0.5 THEN 1 ELSE 0 END) AS y2026_expected_landing,
	          (floor(max(x.planned) FILTER (WHERE x.yr = 2026)) + CASE WHEN (max(x.planned) FILTER (WHERE x.yr = 2026)) - floor(max(x.planned) FILTER (WHERE x.yr = 2026)) >= 0.5 THEN 1 ELSE 0 END) AS y2026_planned,
	          bool_or(x.fx_missing) FILTER (WHERE x.yr = 2026) AS y2026_fx_missing,
	          (floor(max(x.planned) FILTER (WHERE x.yr = 2027)) + CASE WHEN (max(x.planned) FILTER (WHERE x.yr = 2027)) - floor(max(x.planned) FILTER (WHERE x.yr = 2027)) >= 0.5 THEN 1 ELSE 0 END) AS y2027_planned,
	          bool_or(x.fx_missing) FILTER (WHERE x.yr = 2027) AS y2027_fx_missing
	        FROM (
	          SELECT av.spend_item_id AS item_id, av.budget_year AS yr, fx.rate IS NULL AS fx_missing,
	            (CASE WHEN abs(at.expected_landing) < 90071992547409.92 THEN ((at.expected_landing) * 100)::bigint::float8 / 100 ELSE (at.expected_landing)::float8 END) * fx.rate * 100 AS expected_landing,
	            (CASE WHEN abs(at.planned) < 90071992547409.92 THEN ((at.planned) * 100)::bigint::float8 / 100 ELSE (at.planned)::float8 END) * fx.rate * 100 AS planned
	          FROM spend_versions av
	          JOIN spend_items ai ON ai.tenant_id = '{{tenant_id}}' AND ai.id = av.spend_item_id AND ai.nature = 'opex'
	          JOIN spend_version_totals at ON at.tenant_id = '{{tenant_id}}' AND at.version_id = av.id
	          LEFT JOIN unnest('{{fx_keys:2025,2026,2027}}'::text[], '{{fx_years:2025,2026,2027}}'::int[], '{{fx_curs:2025,2026,2027}}'::text[], '{{fx_rates:2025,2026,2027}}'::float8[]) AS fx(set_key, yr, cur, rate) ON fx.yr = av.budget_year AND fx.cur = ai.currency::text AND fx.set_key = CASE WHEN av.fx_rate_set_id = ANY('{{fx_known_sets}}'::uuid[]) THEN av.fx_rate_set_id::text ELSE 'live' END
	          WHERE av.tenant_id = '{{tenant_id}}' AND av.budget_year = ANY('{2025,2026,2027}'::int[])
	            AND (ai.disabled_at IS NULL OR av.budget_year <= extract(year FROM ai.disabled_at AT TIME ZONE 'UTC'))
	          OFFSET 0
	        ) x
	        GROUP BY x.item_id
	      ) am ON am.item_id = i.id
	WHERE (i.tenant_id = '{{tenant_id}}' AND i.nature = 'opex')
	  AND ((i.disabled_at IS NULL OR i.disabled_at >= '2025-01-01 00:00:00+00'::timestamptz))),
	agg_groups AS (SELECT count(*) AS n, round(coalesce(sum((agg_lines.v0)::bigint) FILTER (WHERE abs(agg_lines.v0) < 1e15), 0)
	    + coalesce(sum(round(((agg_lines.v0) / 100)::text::numeric, 2) * 100) FILTER (WHERE abs(agg_lines.v0) >= 1e15), 0)) AS s0, count(agg_lines.v0) AS c0, min(agg_lines.v0) AS lo0, max(agg_lines.v0) AS hi0, round(coalesce(sum((agg_lines.v1)::bigint) FILTER (WHERE abs(agg_lines.v1) < 1e15), 0)
	    + coalesce(sum(round(((agg_lines.v1) / 100)::text::numeric, 2) * 100) FILTER (WHERE abs(agg_lines.v1) >= 1e15), 0)) AS s1, count(agg_lines.v1) AS c1, min(agg_lines.v1) AS lo1, max(agg_lines.v1) AS hi1, round(coalesce(sum((agg_lines.v2)::bigint) FILTER (WHERE abs(agg_lines.v2) < 1e15), 0)
	    + coalesce(sum(round(((agg_lines.v2) / 100)::text::numeric, 2) * 100) FILTER (WHERE abs(agg_lines.v2) >= 1e15), 0)) AS s2, count(agg_lines.v2) AS c2, min(agg_lines.v2) AS lo2, max(agg_lines.v2) AS hi2, round(coalesce(sum((agg_lines.v3)::bigint) FILTER (WHERE abs(agg_lines.v3) < 1e15), 0)
	    + coalesce(sum(round(((agg_lines.v3) / 100)::text::numeric, 2) * 100) FILTER (WHERE abs(agg_lines.v3) >= 1e15), 0)) AS s3, count(agg_lines.v3) AS c3, min(agg_lines.v3) AS lo3, max(agg_lines.v3) AS hi3
	FROM agg_lines
	HAVING count(*) > 0),
	agg_ranked AS (SELECT g.*, row_number() OVER (ORDER BY g.n DESC) AS rn
	FROM agg_groups g)
	(SELECT 'g' AS part, x.rn, x.n, (coalesce(x.s0, 0))::text AS m0, (x.n - coalesce(x.c0, 0))::int AS u0, (coalesce(x.s1, 0))::text AS m1, (x.n - coalesce(x.c1, 0))::int AS u1, (coalesce(x.s2, 0))::text AS m2, (x.n - coalesce(x.c2, 0))::int AS u2, (coalesce(x.s3, 0))::text AS m3, (x.n - coalesce(x.c3, 0))::int AS u3, NULL::bigint AS gc FROM agg_ranked x)
	UNION ALL
	(SELECT 't' AS part, NULL::bigint AS rn, x.n, (coalesce(x.s0, 0))::text AS m0, (x.n - coalesce(x.c0, 0))::int AS u0, (coalesce(x.s1, 0))::text AS m1, (x.n - coalesce(x.c1, 0))::int AS u1, (coalesce(x.s2, 0))::text AS m2, (x.n - coalesce(x.c2, 0))::int AS u2, (coalesce(x.s3, 0))::text AS m3, (x.n - coalesce(x.c3, 0))::int AS u3, (SELECT count(*) FROM agg_ranked) AS gc FROM (SELECT coalesce(sum(r.n), 0)::bigint AS n, sum(r.s0) AS s0, sum(r.c0) AS c0, min(r.lo0) AS lo0, max(r.hi0) AS hi0, sum(r.s1) AS s1, sum(r.c1) AS c1, min(r.lo1) AS lo1, max(r.hi1) AS hi1, sum(r.s2) AS s2, sum(r.c2) AS c2, min(r.lo2) AS lo2, max(r.hi2) AS hi2, sum(r.s3) AS s3, sum(r.c3) AS c3, min(r.lo3) AS lo3, max(r.hi3) AS hi3 FROM agg_groups r) x)
	ORDER BY 1, 2;
