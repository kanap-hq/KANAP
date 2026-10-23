-- fiche_detail_8
-- group: fiche
-- family: fiche
-- endpoint: GET /spend-items/BL-2500 (workspace of line BL-2500)
-- source: backend/src/spend/spend-items.controller.ts, backend/src/spend/spend-items.service.ts, backend/src/spend/spend-versions.* 
-- captured on appdb_perf10k (tenant perf, admin) on 2026-10-23, 0.07 ms in the API.
SELECT v.item_id::text AS item_id, v.axis_id::text AS axis_id, ax.code AS axis_code, ax.name AS axis_name,
	            ax.is_default, v.category_id::text AS category_id, c.name AS category_name
	       FROM spend_item_analytics_values v
	       JOIN analytics_axes ax ON ax.tenant_id = v.tenant_id AND ax.id = v.axis_id
	       JOIN analytics_categories c ON c.tenant_id = v.tenant_id AND c.id = v.category_id
	      WHERE v.tenant_id = '{{tenant_id}}' AND v.item_id = ANY('{ {{item_id}} }'::uuid[])
	      ORDER BY ax.sort_order ASC, lower(coalesce(ax.name, '')) ASC, ax.code ASC, ax.id ASC;
