-- contracts_page_21
-- group: contracts_page
-- family: contracts_page
-- endpoint: GET /contracts?page=1&limit=50&sort=name:ASC
-- source: backend/src/contracts/contracts.controller.ts (list)
-- captured on appdb_perf10k (tenant perf, admin) on 2026-10-23, 0.23 ms in the API.
SELECT DISTINCT ON (related_object_id) id, related_object_id, title, description, status, created_at
	           FROM tasks WHERE tenant_id = app_current_tenant() AND related_object_type = 'contract' AND related_object_id = ANY('{{page_contract_ids}}')
	           ORDER BY related_object_id, created_at DESC;
