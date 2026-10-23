-- contracts_page_18
-- group: contracts_page
-- family: contracts_page
-- endpoint: GET /contracts?page=1&limit=50&sort=name:ASC
-- source: backend/src/contracts/contracts.controller.ts (list)
-- captured on appdb_perf10k (tenant perf, admin) on 2026-10-23, 0.47 ms in the API.
SELECT id, name FROM suppliers WHERE tenant_id = app_current_tenant() AND id = ANY('{{page_supplier_ids}}');
