-- chargeback_company_11
-- group: chargeback
-- family: chargeback
-- endpoint: GET /reports/chargeback/company?companyId=<company>&year=2026&metric=budget&scope=opex
-- source: backend/src/spend/chargeback-report.controller.ts -> backend/src/spend/chargeback-report.service.ts (generateCompany)
-- captured on appdb_perf10k (tenant perf, admin) on 2026-10-23, 8.11 ms in the API.
SELECT "SpendAllocation"."id" AS "SpendAllocation_id", "SpendAllocation"."tenant_id" AS "SpendAllocation_tenant_id", "SpendAllocation"."version_id" AS "SpendAllocation_version_id", "SpendAllocation"."company_id" AS "SpendAllocation_company_id", "SpendAllocation"."department_id" AS "SpendAllocation_department_id", "SpendAllocation"."allocation_pct" AS "SpendAllocation_allocation_pct", "SpendAllocation"."is_system_generated" AS "SpendAllocation_is_system_generated", "SpendAllocation"."rule_id" AS "SpendAllocation_rule_id", "SpendAllocation"."materialized_from" AS "SpendAllocation_materialized_from", "SpendAllocation"."created_at" AS "SpendAllocation_created_at", "SpendAllocation"."updated_at" AS "SpendAllocation_updated_at" FROM "spend_allocations" "SpendAllocation" WHERE (("SpendAllocation"."tenant_id" = '{{tenant_id}}') AND ("SpendAllocation"."version_id" IN ({{chargeback_version_ids_in}})));
