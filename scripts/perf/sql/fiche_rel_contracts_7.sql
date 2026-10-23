-- fiche_rel_contracts_7
-- group: fiche
-- family: fiche
-- endpoint: GET /spend-items/:id/contracts (workspace of line BL-2500)
-- source: backend/src/spend/spend-items.controller.ts, backend/src/spend/spend-items.service.ts, backend/src/spend/spend-versions.* 
-- captured on appdb_perf10k (tenant perf, admin) on 2026-10-23, 0.03 ms in the API.
SELECT "ContractSpendItem"."id" AS "ContractSpendItem_id", "ContractSpendItem"."tenant_id" AS "ContractSpendItem_tenant_id", "ContractSpendItem"."contract_id" AS "ContractSpendItem_contract_id", "ContractSpendItem"."spend_item_id" AS "ContractSpendItem_spend_item_id", "ContractSpendItem"."created_at" AS "ContractSpendItem_created_at" FROM "contract_spend_items" "ContractSpendItem" WHERE (("ContractSpendItem"."tenant_id" = app_current_tenant()) AND ("ContractSpendItem"."spend_item_id" = '{{item_id}}'));
