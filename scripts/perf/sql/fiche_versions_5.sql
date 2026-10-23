-- fiche_versions_5
-- group: fiche
-- family: fiche
-- endpoint: GET /spend-items/:id/versions (workspace of line BL-2500)
-- source: backend/src/spend/spend-items.controller.ts, backend/src/spend/spend-items.service.ts, backend/src/spend/spend-versions.* 
-- captured on appdb_perf10k (tenant perf, admin) on 2026-10-23, 0.01 ms in the API.
SELECT 1 FROM spend_items WHERE tenant_id = app_current_tenant() AND id = '{{item_id}}' AND nature <> 'opex' LIMIT 1;
