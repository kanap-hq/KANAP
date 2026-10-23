-- chargeback_company_5
-- group: chargeback
-- family: chargeback
-- endpoint: GET /reports/chargeback/company?companyId=<company>&year=2026&metric=budget&scope=opex
-- source: backend/src/spend/chargeback-report.controller.ts -> backend/src/spend/chargeback-report.service.ts (generateCompany)
-- captured on appdb_perf10k (tenant perf, admin) on 2026-10-23, 12.73 ms in the API.
SELECT "v"."id" AS id, "v"."spend_item_id" AS spend_item_id FROM "spend_versions" "v" INNER JOIN "spend_items" "item" ON "item"."id" = "v"."spend_item_id" AND "item"."tenant_id" = "v"."tenant_id" AND "item"."nature" IN ('opex') AND ("item"."disabled_at" IS NULL OR "item"."disabled_at" >= '2026-01-01 00:00:00+00') WHERE "v"."tenant_id" = '{{tenant_id}}' AND "v"."budget_year" = '2026';
