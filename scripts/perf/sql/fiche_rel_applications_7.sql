-- fiche_rel_applications_7
-- group: fiche
-- family: fiche
-- endpoint: GET /spend-items/:id/applications (workspace of line BL-2500)
-- source: backend/src/spend/spend-items.controller.ts, backend/src/spend/spend-items.service.ts, backend/src/spend/spend-versions.* 
-- captured on appdb_perf10k (tenant perf, admin) on 2026-10-23, 0.02 ms in the API.
SELECT "i"."id" AS "i_id", "i"."tenant_id" AS "i_tenant_id", "i"."item_number" AS "i_item_number", "i"."nature" AS "i_nature", "i"."paying_company_id" AS "i_paying_company_id", "i"."product_name" AS "i_product_name", "i"."description" AS "i_description", "i"."supplier_id" AS "i_supplier_id", "i"."account_id" AS "i_account_id", "i"."currency" AS "i_currency", "i"."effective_start" AS "i_effective_start", "i"."status" AS "i_status", "i"."disabled_at" AS "i_disabled_at", "i"."owner_it_id" AS "i_owner_it_id", "i"."owner_business_id" AS "i_owner_business_id", "i"."project_id" AS "i_project_id", "i"."contract_id" AS "i_contract_id", "i"."cost_center_id" AS "i_cost_center_id", "i"."run_build" AS "i_run_build", "i"."notes" AS "i_notes", "i"."created_at" AS "i_created_at", "i"."updated_at" AS "i_updated_at", "i"."row_version" AS "i_row_version" FROM "spend_items" "i" WHERE "i"."tenant_id" = '{{tenant_id}}' AND "i"."id" = '{{item_id}}' AND "i"."nature" = 'opex';
