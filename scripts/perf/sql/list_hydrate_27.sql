-- list_hydrate_27
-- group: list_page
-- family: list_page
-- endpoint: GET /spend-items/summary?page=1&limit=50&sort=yBudget:DESC&shape=grid&status=enabled
-- source: backend/src/spend/spend-items.controller.ts (summary) -> backend/src/spend/budget-list/*, backend/src/common/list-engine/*
-- captured on appdb_perf10k (tenant perf, admin) on 2026-10-23, 0.31 ms in the API.
SELECT l.item_id, p.name, pst.name AS stream_name, pc.name AS category_name
	     FROM (
	       SELECT pl.opex_id AS item_id, pl.project_id
	       FROM portfolio_project_opex pl
	       WHERE pl.tenant_id = '{{tenant_id}}' AND pl.opex_id = ANY('{{page_item_ids}}'::uuid[])
	       UNION
	       SELECT i.id AS item_id, i.project_id
	       FROM spend_items i
	       WHERE i.tenant_id = '{{tenant_id}}' AND i.id = ANY('{{page_item_ids}}'::uuid[]) AND i.nature = 'opex' AND i.project_id IS NOT NULL
	     ) l
	     JOIN portfolio_projects p ON p.id = l.project_id AND p.tenant_id = '{{tenant_id}}'
	     LEFT JOIN portfolio_streams pst ON pst.id = p.stream_id AND pst.tenant_id = p.tenant_id
	     LEFT JOIN portfolio_categories pc ON pc.id = p.category_id AND pc.tenant_id = p.tenant_id;
