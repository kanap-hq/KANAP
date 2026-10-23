-- list_hydrate_23
-- group: list_page
-- family: list_page
-- endpoint: GET /spend-items/summary?page=1&limit=50&sort=yBudget:DESC&shape=grid&status=enabled
-- source: backend/src/spend/spend-items.controller.ts (summary) -> backend/src/spend/budget-list/*, backend/src/common/list-engine/*
-- captured on appdb_perf10k (tenant perf, admin) on 2026-10-23, 1.84 ms in the API.
SELECT ax.id AS axis_id, ax.is_default,
	              (ax.status <> 'disabled' AND (ax.disabled_at IS NULL OR ax.disabled_at > now())) AS active,
	              v.item_id, v.category_id, c.name AS category_name
	       FROM analytics_axes ax
	       LEFT JOIN spend_item_analytics_values v
	         ON v.tenant_id = '{{tenant_id}}' AND v.axis_id = ax.id AND v.item_id = ANY('{{page_item_ids}}'::uuid[])
	       LEFT JOIN analytics_categories c ON c.id = v.category_id AND c.tenant_id = '{{tenant_id}}'
	       WHERE ax.tenant_id = '{{tenant_id}}' AND (ax.applies_to IS NULL OR ax.applies_to = ANY('{opex}'::text[]))
	       ORDER BY ax.sort_order, lower(coalesce(ax.name, '')), ax.code, ax.id;
