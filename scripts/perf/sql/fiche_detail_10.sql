-- fiche_detail_10
-- group: fiche
-- family: fiche
-- endpoint: GET /spend-items/BL-2500 (workspace of line BL-2500)
-- source: backend/src/spend/spend-items.controller.ts, backend/src/spend/spend-items.service.ts, backend/src/spend/spend-versions.* 
-- captured on appdb_perf10k (tenant perf, admin) on 2026-10-23, 0.01 ms in the API.
SELECT p.id, p.item_number, p.nature
	       FROM spend_items i
	       JOIN spend_items p ON p.tenant_id = i.tenant_id AND p.id = i.predecessor_id AND p.nature IN ('opex', 'capex')
	      WHERE i.tenant_id = '{{tenant_id}}' AND i.id = '{{item_id}}' AND i.nature IN ('opex', 'capex');
