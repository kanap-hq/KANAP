-- agg_consolidation
-- group: agg_consolidation
-- family: report_aggregate
-- endpoint: POST /spend-items/summary/aggregate (consolidation)
-- source: backend/src/spend/spend-items.controller.ts (summaryAggregate) -> backend/src/spend/budget-list/budget-list.service.ts (budgetListAggregate)
-- captured on appdb_perf10k (tenant perf, admin) on 2026-10-23, 34.01 ms in the API.
WITH cons_labels AS (SELECT k.key, min(k.label COLLATE "und-x-icu") AS label
	      FROM (SELECT (CASE WHEN NOT ca.id IS NOT NULL THEN NULL
	    WHEN ca.consolidation_account_number IS NOT NULL THEN 'c_' || ca.consolidation_account_number::text
	    WHEN NULLIF(btrim(ca.consolidation_account_name, E'\u0009\u000A\u000B\u000C\u000D\u0020\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF'), '') IS NOT NULL THEN 'c_' || lower(regexp_replace(regexp_replace(NULLIF(btrim(ca.consolidation_account_name, E'\u0009\u000A\u000B\u000C\u000D\u0020\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF'), ''), '[\U00010000-\U0010FFFF]', '__', 'g'), '[^A-Za-z0-9]', '_', 'g')) END) AS key, (CASE WHEN ca.consolidation_account_number IS NOT NULL AND NULLIF(btrim(ca.consolidation_account_name, E'\u0009\u000A\u000B\u000C\u000D\u0020\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF'), '') IS NOT NULL THEN '[' || ca.consolidation_account_number::text || '] ' || NULLIF(btrim(ca.consolidation_account_name, E'\u0009\u000A\u000B\u000C\u000D\u0020\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF'), '')
	    WHEN NULLIF(btrim(ca.consolidation_account_name, E'\u0009\u000A\u000B\u000C\u000D\u0020\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF'), '') IS NOT NULL THEN NULLIF(btrim(ca.consolidation_account_name, E'\u0009\u000A\u000B\u000C\u000D\u0020\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF'), '')
	    WHEN ca.consolidation_account_number IS NOT NULL THEN '[' || ca.consolidation_account_number::text || ']' END) AS label FROM accounts ca
	        WHERE ca.tenant_id = '{{tenant_id}}'
	          AND EXISTS (SELECT 1 FROM spend_items li WHERE li.tenant_id = '{{tenant_id}}' AND li.nature = 'opex' AND li.account_id = ca.id)) k
	      WHERE k.key IS NOT NULL
	      GROUP BY k.key),
	agg_lines AS (SELECT NULLIF(((CASE WHEN NOT acc.id IS NOT NULL THEN NULL
	    WHEN acc.consolidation_account_number IS NOT NULL THEN 'c_' || acc.consolidation_account_number::text
	    WHEN NULLIF(btrim(acc.consolidation_account_name, E'\u0009\u000A\u000B\u000C\u000D\u0020\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF'), '') IS NOT NULL THEN 'c_' || lower(regexp_replace(regexp_replace(NULLIF(btrim(acc.consolidation_account_name, E'\u0009\u000A\u000B\u000C\u000D\u0020\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF'), ''), '[\U00010000-\U0010FFFF]', '__', 'g'), '[^A-Za-z0-9]', '_', 'g')) END))::text, '') AS k0, NULLIF((consl.label)::text, '') AS k1, (CASE WHEN am.y2026_fx_missing THEN NULL ELSE coalesce(am.y2026_planned, 0::float8) END) AS v0
	FROM spend_items i
	LEFT JOIN accounts acc ON acc.tenant_id = '{{tenant_id}}' AND acc.id = i.account_id
	LEFT JOIN cons_labels consl ON consl.key = (CASE WHEN NOT acc.id IS NOT NULL THEN NULL
	    WHEN acc.consolidation_account_number IS NOT NULL THEN 'c_' || acc.consolidation_account_number::text
	    WHEN NULLIF(btrim(acc.consolidation_account_name, E'\u0009\u000A\u000B\u000C\u000D\u0020\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF'), '') IS NOT NULL THEN 'c_' || lower(regexp_replace(regexp_replace(NULLIF(btrim(acc.consolidation_account_name, E'\u0009\u000A\u000B\u000C\u000D\u0020\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF'), ''), '[\U00010000-\U0010FFFF]', '__', 'g'), '[^A-Za-z0-9]', '_', 'g')) END)
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
	          LEFT JOIN unnest('{{fx_keys:2026}}'::text[], '{{fx_years:2026}}'::int[], '{{fx_curs:2026}}'::text[], '{{fx_rates:2026}}'::float8[]) AS fx(set_key, yr, cur, rate) ON fx.yr = av.budget_year AND fx.cur = ai.currency::text AND fx.set_key = CASE WHEN av.fx_rate_set_id = ANY('{{fx_known_sets}}'::uuid[]) THEN av.fx_rate_set_id::text ELSE 'live' END
	          WHERE av.tenant_id = '{{tenant_id}}' AND av.budget_year = ANY('{2026}'::int[])
	            AND (ai.disabled_at IS NULL OR av.budget_year <= extract(year FROM ai.disabled_at AT TIME ZONE 'UTC'))
	          OFFSET 0
	        ) x
	        GROUP BY x.item_id
	      ) am ON am.item_id = i.id
	WHERE (i.tenant_id = '{{tenant_id}}' AND i.nature = 'opex')
	  AND ((i.disabled_at IS NULL OR i.disabled_at >= '2025-01-01 00:00:00+00'::timestamptz))),
	agg_groups AS (SELECT k0, k1, count(*) AS n, round(coalesce(sum((agg_lines.v0)::bigint) FILTER (WHERE abs(agg_lines.v0) < 1e15), 0)
	    + coalesce(sum(round(((agg_lines.v0) / 100)::text::numeric, 2) * 100) FILTER (WHERE abs(agg_lines.v0) >= 1e15), 0)) AS s0, count(agg_lines.v0) AS c0, min(agg_lines.v0) AS lo0, max(agg_lines.v0) AS hi0
	FROM agg_lines
	GROUP BY k0, k1
	HAVING count(*) > 0),
	agg_ranked AS (SELECT g.*, row_number() OVER (ORDER BY coalesce(g.s0, 0) DESC NULLS LAST, g.k0 COLLATE "und-x-icu" ASC NULLS FIRST, g.k1 COLLATE "und-x-icu" ASC NULLS FIRST) AS rn
	FROM agg_groups g)
	(SELECT 'g' AS part, x.rn, x.k0, x.k1, x.n, (coalesce(x.s0, 0))::text AS m0, (x.n - coalesce(x.c0, 0))::int AS u0, NULL::bigint AS gc FROM agg_ranked x)
	UNION ALL
	(SELECT 't' AS part, NULL::bigint AS rn, NULL::text AS k0, NULL::text AS k1, x.n, (coalesce(x.s0, 0))::text AS m0, (x.n - coalesce(x.c0, 0))::int AS u0, (SELECT count(*) FROM agg_ranked) AS gc FROM (SELECT coalesce(sum(r.n), 0)::bigint AS n, sum(r.s0) AS s0, sum(r.c0) AS c0, min(r.lo0) AS lo0, max(r.hi0) AS hi0 FROM agg_groups r) x)
	ORDER BY 1, 2;
