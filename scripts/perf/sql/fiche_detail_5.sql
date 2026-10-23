-- fiche_detail_5
-- group: fiche
-- family: fiche
-- endpoint: GET /spend-items/BL-2500 (workspace of line BL-2500)
-- source: backend/src/spend/spend-items.controller.ts, backend/src/spend/spend-items.service.ts, backend/src/spend/spend-versions.* 
-- captured on appdb_perf10k (tenant perf, admin) on 2026-10-23, 0.07 ms in the API.
SELECT id FROM spend_items
	  WHERE tenant_id = app_current_tenant() AND nature = 'opex' AND (item_number = '2500' OR legacy_number = NULL)
	  ORDER BY (item_number = '2500') DESC
	  LIMIT 1;
