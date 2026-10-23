-- contracts_page_15
-- group: contracts_page
-- family: contracts_page
-- endpoint: GET /contracts?page=1&limit=50&sort=name:ASC
-- source: backend/src/contracts/contracts.controller.ts (list)
-- captured on appdb_perf10k (tenant perf, admin) on 2026-10-23, 0.62 ms in the API.
SELECT COUNT(DISTINCT("c"."id")) AS "cnt" FROM "contracts" "c" LEFT JOIN "companies" "comp" ON "comp"."id" = "c"."company_id" AND "comp"."tenant_id" = "c"."tenant_id"  LEFT JOIN "suppliers" "sup" ON "sup"."id" = "c"."supplier_id" AND "sup"."tenant_id" = "c"."tenant_id" WHERE "c"."tenant_id" = app_current_tenant() AND (("c"."disabled_at" IS NULL OR "c"."disabled_at" > '2026-10-23 16:20:12.594+00'));
