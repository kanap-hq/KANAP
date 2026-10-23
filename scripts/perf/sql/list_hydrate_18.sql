-- list_hydrate_18
-- group: list_page
-- family: list_page
-- endpoint: GET /spend-items/summary?page=1&limit=50&sort=yBudget:DESC&shape=grid&status=enabled
-- source: backend/src/spend/spend-items.controller.ts (summary) -> backend/src/spend/budget-list/*, backend/src/common/list-engine/*
-- captured on appdb_perf10k (tenant perf, admin) on 2026-10-23, 1.26 ms in the API.
SELECT t.version_id, round(t.planned * 100)::text AS planned, round(t.committed * 100)::text AS committed, round(t.forecast * 100)::text AS forecast, round(t.actual * 100)::text AS actual, round(t.expected_landing * 100)::text AS expected_landing
	       FROM spend_version_totals t
	       WHERE t.tenant_id = '{{tenant_id}}' AND t.version_id = ANY('{{page_version_ids}}'::uuid[]);
