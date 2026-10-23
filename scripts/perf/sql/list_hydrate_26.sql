-- list_hydrate_26
-- group: list_page
-- family: list_page
-- endpoint: GET /spend-items/summary?page=1&limit=50&sort=yBudget:DESC&shape=grid&status=enabled
-- source: backend/src/spend/spend-items.controller.ts (summary) -> backend/src/spend/budget-list/*, backend/src/common/list-engine/*
-- captured on appdb_perf10k (tenant perf, admin) on 2026-10-23, 2.88 ms in the API.
SELECT DISTINCT v.spend_item_id AS item_id
	     FROM spend_versions v
	     JOIN spend_round_inputs r ON r.tenant_id = v.tenant_id AND r.version_id = v.id AND r.fte IS NOT NULL
	     WHERE v.tenant_id = '{{tenant_id}}' AND v.spend_item_id = ANY('{{page_item_ids}}'::uuid[]);
