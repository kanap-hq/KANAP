-- fiche_yearly_6
-- group: fiche
-- family: fiche
-- endpoint: GET /spend-items/:id/yearly-totals?from=2023&to=2027 (workspace of line BL-2500)
-- source: backend/src/spend/spend-items.controller.ts, backend/src/spend/spend-items.service.ts, backend/src/spend/spend-versions.* 
-- captured on appdb_perf10k (tenant perf, admin) on 2026-10-23, 0.08 ms in the API.
SELECT v.budget_year AS year,
	              COALESCE(SUM(t.planned), 0) AS budget,
	              COALESCE(SUM(t.committed), 0) AS revision,
	              COALESCE(SUM(t.forecast), 0) AS forecast,
	              COALESCE(SUM(t.actual), 0) AS actual,
	              COALESCE(SUM(t.expected_landing), 0) AS landing
	       FROM spend_versions v
	       JOIN spend_items i ON i.tenant_id = v.tenant_id AND i.id = v.spend_item_id AND i.nature = 'opex'
	       LEFT JOIN spend_version_totals t ON t.tenant_id = v.tenant_id AND t.version_id = v.id
	       WHERE v.tenant_id = app_current_tenant() AND v.spend_item_id = '{{item_id}}' AND v.budget_year BETWEEN '2023' AND '2027'
	       GROUP BY v.budget_year
	       ORDER BY v.budget_year;
