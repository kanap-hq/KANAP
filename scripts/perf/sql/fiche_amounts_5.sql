-- fiche_amounts_5
-- group: fiche
-- family: fiche
-- endpoint: GET /spend-versions/:id/amounts?year=2026 (workspace of line BL-2500)
-- source: backend/src/spend/spend-items.controller.ts, backend/src/spend/spend-items.service.ts, backend/src/spend/spend-versions.* 
-- captured on appdb_perf10k (tenant perf, admin) on 2026-10-23, 0.03 ms in the API.
SELECT c.spend_item_id AS item_id, i.nature AS nature
	       FROM spend_versions c
	       JOIN spend_items i ON i.tenant_id = c.tenant_id AND i.id = c.spend_item_id
	      WHERE c.tenant_id = '{{tenant_id}}' AND c.id = '{{version_id}}';
