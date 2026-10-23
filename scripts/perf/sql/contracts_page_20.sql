-- contracts_page_20
-- group: contracts_page
-- family: contracts_page
-- endpoint: GET /contracts?page=1&limit=50&sort=name:ASC
-- source: backend/src/contracts/contracts.controller.ts (list)
-- captured on appdb_perf10k (tenant perf, admin) on 2026-10-23, 1.18 ms in the API.
SELECT l.contract_id, COUNT(*)::text as c FROM contract_spend_items l
	            WHERE l.tenant_id = app_current_tenant() AND l.contract_id = ANY('{{page_contract_ids}}') AND EXISTS (SELECT 1 FROM spend_items nl WHERE nl.tenant_id = l.tenant_id AND nl.id = l.spend_item_id AND nl.nature IN ('opex', 'capex'))
	            GROUP BY l.contract_id;
