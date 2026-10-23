-- chargeback_company_10
-- group: chargeback
-- family: chargeback
-- endpoint: GET /reports/chargeback/company?companyId=<company>&year=2026&metric=budget&scope=opex
-- source: backend/src/spend/chargeback-report.controller.ts -> backend/src/spend/chargeback-report.service.ts (generateCompany)
-- captured on appdb_perf10k (tenant perf, admin) on 2026-10-23, 6.44 ms in the API.
SELECT t.version_id, t.planned::text AS total
	       FROM spend_version_totals t
	       WHERE t.tenant_id = '{{tenant_id}}' AND t.version_id = ANY('{{version_ids_2026_arr}}'::uuid[]);
