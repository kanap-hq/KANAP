-- fiche_detail_11
-- group: fiche
-- family: fiche
-- endpoint: GET /spend-items/BL-2500 (workspace of line BL-2500)
-- source: backend/src/spend/spend-items.controller.ts, backend/src/spend/spend-items.service.ts, backend/src/spend/spend-versions.* 
-- captured on appdb_perf10k (tenant perf, admin) on 2026-10-23, 0.02 ms in the API.
SELECT s.id, s.item_number, s.nature, EXTRACT(YEAR FROM s.effective_start)::int AS from_year
	       FROM spend_items s
	      WHERE s.tenant_id = '{{tenant_id}}' AND s.predecessor_id = '{{item_id}}' AND s.nature IN ('opex', 'capex');
