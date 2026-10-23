-- fiche_rel_applications_8
-- group: fiche
-- family: fiche
-- endpoint: GET /spend-items/:id/applications (workspace of line BL-2500)
-- source: backend/src/spend/spend-items.controller.ts, backend/src/spend/spend-items.service.ts, backend/src/spend/spend-versions.* 
-- captured on appdb_perf10k (tenant perf, admin) on 2026-10-23, 0.01 ms in the API.
SELECT l.application_id AS id, a.name
	     FROM application_spend_items l
	     JOIN applications a ON a.id = l.application_id AND a.tenant_id = l.tenant_id
	     WHERE l.tenant_id = '{{tenant_id}}' AND l.spend_item_id = '{{item_id}}'
	     ORDER BY a.name ASC, l.application_id ASC;
