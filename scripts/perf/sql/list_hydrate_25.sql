-- list_hydrate_25
-- group: list_page
-- family: list_page
-- endpoint: GET /spend-items/summary?page=1&limit=50&sort=yBudget:DESC&shape=grid&status=enabled
-- source: backend/src/spend/spend-items.controller.ts (summary) -> backend/src/spend/budget-list/*, backend/src/common/list-engine/*
-- captured on appdb_perf10k (tenant perf, admin) on 2026-10-23, 0.69 ms in the API.
SELECT DISTINCT ON (l.spend_item_id)
	            l.spend_item_id AS item_id, c.id AS contract_id, c.name AS contract_name
	     FROM contract_spend_items l
	     JOIN contracts c ON c.id = l.contract_id AND c.tenant_id = l.tenant_id
	     WHERE l.tenant_id = '{{tenant_id}}' AND l.spend_item_id = ANY('{{page_item_ids}}'::uuid[])
	     ORDER BY l.spend_item_id, l.created_at DESC, l.id DESC;
