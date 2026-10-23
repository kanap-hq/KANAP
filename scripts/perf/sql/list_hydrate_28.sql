-- list_hydrate_28
-- group: list_page
-- family: list_page
-- endpoint: GET /spend-items/summary?page=1&limit=50&sort=yBudget:DESC&shape=grid&status=enabled
-- source: backend/src/spend/spend-items.controller.ts (summary) -> backend/src/spend/budget-list/*, backend/src/common/list-engine/*
-- captured on appdb_perf10k (tenant perf, admin) on 2026-10-23, 0.20 ms in the API.
SELECT DISTINCT ON (related_object_id) id, related_object_id, title, description, status, created_at
	       FROM tasks
	       WHERE tenant_id = '{{tenant_id}}'
	         AND related_object_type = ANY('{spend_item}'::text[])
	         AND related_object_id = ANY('{{page_item_ids}}'::uuid[])
	         AND status = ANY('{open,in_progress,pending,in_testing}')
	       ORDER BY related_object_id, created_at DESC, id DESC;
