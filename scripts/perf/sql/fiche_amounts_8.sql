-- fiche_amounts_8
-- group: fiche
-- family: fiche
-- endpoint: GET /spend-versions/:id/amounts?year=2026 (workspace of line BL-2500)
-- source: backend/src/spend/spend-items.controller.ts, backend/src/spend/spend-items.service.ts, backend/src/spend/spend-versions.* 
-- captured on appdb_perf10k (tenant perf, admin) on 2026-10-23, 0.08 ms in the API.
SELECT id, tenant_id, version_id, measure,
	  to_char(period_start, 'YYYY-MM-DD') AS period_start, to_char(period_end, 'YYYY-MM-DD') AS period_end,
	  method, spread_profile_name, last_calculation, fte, created_at, updated_at, updated_by FROM spend_round_inputs WHERE tenant_id = '{{tenant_id}}' AND version_id = ANY('{ {{version_id}} }'::uuid[]);
