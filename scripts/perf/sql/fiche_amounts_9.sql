-- fiche_amounts_9
-- group: fiche
-- family: fiche
-- endpoint: GET /spend-versions/:id/amounts?year=2026 (workspace of line BL-2500)
-- source: backend/src/spend/spend-items.controller.ts, backend/src/spend/spend-items.service.ts, backend/src/spend/spend-versions.* 
-- captured on appdb_perf10k (tenant perf, admin) on 2026-10-23, 0.04 ms in the API.
SELECT l.id, l.round_input_id, l.sort, l.label, l.quantity_unit::text AS quantity_unit,
	            l.quantity::text AS quantity, l.unit_price::text AS unit_price, l.price_basis::text AS price_basis,
	            l.frequency::text AS frequency, l.days_per_month::text AS days_per_month,
	            to_char(l.period_start, 'YYYY-MM-DD') AS period_start, to_char(l.period_end, 'YYYY-MM-DD') AS period_end,
	            l.working_day_profile_id, w.code AS working_day_profile_code, w.name AS working_day_profile_name
	     FROM spend_round_input_lines l
	     LEFT JOIN working_day_profiles w ON w.tenant_id = '{{tenant_id}}' AND w.id = l.working_day_profile_id
	     WHERE l.tenant_id = '{{tenant_id}}' AND l.round_input_id = ANY('{{version_round_input_ids}}'::uuid[])
	     ORDER BY l.round_input_id, l.sort;
