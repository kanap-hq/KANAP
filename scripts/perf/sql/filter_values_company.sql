-- filter_values_company
-- group: filter_values
-- family: filter_values
-- endpoint: GET /spend-items/summary/filter-values?fields=paying_company_name&status=enabled
-- source: backend/src/spend/spend-items.controller.ts (summary/filter-values) -> backend/src/common/list-engine/*
-- captured on appdb_perf10k (tenant perf, admin) on 2026-10-23, 6.10 ms in the API.
(SELECT DISTINCT 0 AS f, NULLIF((pc.name)::text, '') AS v
	FROM spend_items i
	LEFT JOIN companies pc ON pc.tenant_id = '{{tenant_id}}' AND pc.id = i.paying_company_id
	WHERE (i.tenant_id = '{{tenant_id}}' AND i.nature = 'opex')
	  AND ((i.disabled_at IS NULL OR i.disabled_at >= '2026-01-01 00:00:00+00'::timestamptz)));
