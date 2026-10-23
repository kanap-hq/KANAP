-- fiche_amounts_7
-- group: fiche
-- family: fiche
-- endpoint: GET /spend-versions/:id/amounts?year=2026 (workspace of line BL-2500)
-- source: backend/src/spend/spend-items.controller.ts, backend/src/spend/spend-items.service.ts, backend/src/spend/spend-versions.* 
-- captured on appdb_perf10k (tenant perf, admin) on 2026-10-23, 0.05 ms in the API.
SELECT "SpendAmount"."id" AS "SpendAmount_id", "SpendAmount"."tenant_id" AS "SpendAmount_tenant_id", "SpendAmount"."version_id" AS "SpendAmount_version_id", "SpendAmount"."period" AS "SpendAmount_period", "SpendAmount"."planned" AS "SpendAmount_planned", "SpendAmount"."forecast" AS "SpendAmount_forecast", "SpendAmount"."committed" AS "SpendAmount_committed", "SpendAmount"."actual" AS "SpendAmount_actual", "SpendAmount"."expected_landing" AS "SpendAmount_expected_landing", "SpendAmount"."created_at" AS "SpendAmount_created_at", "SpendAmount"."updated_at" AS "SpendAmount_updated_at" FROM "spend_amounts" "SpendAmount" WHERE (("SpendAmount"."version_id" = '{{version_id}}') AND ("SpendAmount"."period" BETWEEN '2026-01-01' AND '2026-12-31')) ORDER BY "SpendAmount"."period" ASC;
