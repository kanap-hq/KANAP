-- fiche_rel_links_7
-- group: fiche
-- family: fiche
-- endpoint: GET /spend-items/:id/links (workspace of line BL-2500)
-- source: backend/src/spend/spend-items.controller.ts, backend/src/spend/spend-items.service.ts, backend/src/spend/spend-versions.* 
-- captured on appdb_perf10k (tenant perf, admin) on 2026-10-23, 0.01 ms in the API.
SELECT "SpendLink"."id" AS "SpendLink_id", "SpendLink"."tenant_id" AS "SpendLink_tenant_id", "SpendLink"."spend_item_id" AS "SpendLink_spend_item_id", "SpendLink"."description" AS "SpendLink_description", "SpendLink"."url" AS "SpendLink_url", "SpendLink"."created_at" AS "SpendLink_created_at" FROM "spend_links" "SpendLink" WHERE (("SpendLink"."tenant_id" = '{{tenant_id}}') AND ("SpendLink"."spend_item_id" = '{{item_id}}')) ORDER BY "SpendLink"."created_at" DESC;
