-- fiche_rel_links_6
-- group: fiche
-- family: fiche
-- endpoint: GET /spend-items/:id/links (workspace of line BL-2500)
-- source: backend/src/spend/spend-items.controller.ts, backend/src/spend/spend-items.service.ts, backend/src/spend/spend-versions.* 
-- captured on appdb_perf10k (tenant perf, admin) on 2026-10-23, 0.02 ms in the API.
SELECT 1 AS "row_exists" FROM (SELECT 1 AS dummy_column) "dummy_table" WHERE EXISTS (SELECT 1 FROM "spend_items" "SpendItem" WHERE (("SpendItem"."id" = '{{item_id}}') AND ("SpendItem"."tenant_id" = '{{tenant_id}}') AND ("SpendItem"."nature" = 'opex'))) LIMIT 1;
