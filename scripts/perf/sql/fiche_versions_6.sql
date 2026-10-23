-- fiche_versions_6
-- group: fiche
-- family: fiche
-- endpoint: GET /spend-items/:id/versions (workspace of line BL-2500)
-- source: backend/src/spend/spend-items.controller.ts, backend/src/spend/spend-items.service.ts, backend/src/spend/spend-versions.* 
-- captured on appdb_perf10k (tenant perf, admin) on 2026-10-23, 0.06 ms in the API.
SELECT "v"."id" AS "v_id", "v"."tenant_id" AS "v_tenant_id", "v"."spend_item_id" AS "v_spend_item_id", "v"."version_name" AS "v_version_name", "v"."input_grain" AS "v_input_grain", "v"."is_approved" AS "v_is_approved", "v"."as_of_date" AS "v_as_of_date", "v"."budget_year" AS "v_budget_year", "v"."allocation_method" AS "v_allocation_method", "v"."allocation_driver" AS "v_allocation_driver", "v"."notes" AS "v_notes", "v"."reporting_currency" AS "v_reporting_currency", "v"."fx_rate_set_id" AS "v_fx_rate_set_id", "v"."created_at" AS "v_created_at", "v"."updated_at" AS "v_updated_at", "v"."budget_rev" AS "v_budget_rev" FROM "spend_versions" "v" INNER JOIN "spend_items" "i" ON "i"."id" = "v"."spend_item_id" AND "i"."tenant_id" = "v"."tenant_id" AND "i"."nature" = 'opex' WHERE "v"."spend_item_id" = '{{item_id}}' ORDER BY "v"."created_at" DESC;
