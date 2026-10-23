-- fiche_rel_projects_8
-- group: fiche
-- family: fiche
-- endpoint: GET /spend-items/:id/projects (workspace of line BL-2500)
-- source: backend/src/spend/spend-items.controller.ts, backend/src/spend/spend-items.service.ts, backend/src/spend/spend-versions.* 
-- captured on appdb_perf10k (tenant perf, admin) on 2026-10-23, 0.03 ms in the API.
SELECT l.project_id as id, p.name
	       FROM portfolio_project_opex l
	       JOIN portfolio_projects p ON p.id = l.project_id AND p.tenant_id = l.tenant_id
	       WHERE l.tenant_id = '{{tenant_id}}' AND l.opex_id = '{{item_id}}'
	       ORDER BY p.name ASC;
