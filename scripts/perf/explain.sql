-- EXPLAIN (ANALYZE, BUFFERS) of the OPEX list's main SQL and of the chargeback amounts query,
-- as the API runs them (role app, RLS on, tenant set in the transaction).
-- Read-only: every statement runs in a READ ONLY transaction.
--
--   PGPASSWORD=app psql -h 127.0.0.1 -U app -d appdb_perf -v tenant=perf -f scripts/perf/explain.sql
--
-- Sources: backend/src/spend/spend-summary.builder.ts (loadVersionTotals: versions read, amounts
-- aggregate per version until lot 2A, stored totals since), backend/src/spend/chargeback-report.service.ts
-- (totals per version). Sections 2b and 2c need migration 1853720000000.

\set ON_ERROR_STOP on
\pset pager off
BEGIN READ ONLY;
SELECT set_config('app.current_tenant', (SELECT id::text FROM tenants WHERE slug = :'tenant'), true) AS tenant_id \gset
SELECT array_agg(id)::text AS item_ids FROM spend_items WHERE tenant_id = :'tenant_id'::uuid \gset
SELECT array_agg(id)::text AS version_ids FROM spend_versions WHERE tenant_id = :'tenant_id'::uuid AND budget_year = ANY('{2025,2026,2027,2028}'::int[]) \gset
SELECT array_agg(id)::text AS version_ids_y FROM spend_versions WHERE tenant_id = :'tenant_id'::uuid AND budget_year = 2026 \gset
SELECT cardinality(:'item_ids'::uuid[]) AS items, cardinality(:'version_ids'::uuid[]) AS versions_2025_2028, cardinality(:'version_ids_y'::uuid[]) AS versions_2026;

\echo '=== 1. Versions read (loadVersionTotals, TypeORM getMany: every column of the versions of all items)'
EXPLAIN (ANALYZE, BUFFERS)
SELECT v.*
FROM spend_versions v
WHERE v.tenant_id = :'tenant_id'::uuid
  AND v.spend_item_id = ANY(:'item_ids'::uuid[])
  AND v.budget_year = ANY('{2025,2026,2027,2028}'::int[])
ORDER BY v.created_at DESC, v.id DESC;

\echo '=== 2. Amounts aggregate per version (loadVersionTotals)'
EXPLAIN (ANALYZE, BUFFERS)
SELECT a.version_id,
       COALESCE(SUM(a.planned), 0)::text AS planned,
       COALESCE(SUM(a.committed), 0)::text AS committed,
       COALESCE(SUM(a.forecast), 0)::text AS forecast,
       COALESCE(SUM(a.actual), 0)::text AS actual,
       COALESCE(SUM(a.expected_landing), 0)::text AS expected_landing
FROM spend_amounts a
JOIN spend_versions v ON v.id = a.version_id AND v.tenant_id = a.tenant_id
WHERE a.tenant_id = :'tenant_id'::uuid
  AND a.version_id = ANY(:'version_ids'::uuid[])
  AND EXTRACT(YEAR FROM a.period) = v.budget_year
GROUP BY a.version_id;

\echo '=== 2b. Totals read per version since lot 2A (loadVersionTotals reads the stored totals, migration 1853720000000)'
EXPLAIN (ANALYZE, BUFFERS)
SELECT t.version_id, t.planned::text AS planned, t.committed::text AS committed, t.forecast::text AS forecast,
       t.actual::text AS actual, t.expected_landing::text AS expected_landing
FROM spend_version_totals t
WHERE t.tenant_id = :'tenant_id'::uuid
  AND t.version_id = ANY(:'version_ids'::uuid[]);

\echo '=== 2c. Versions of one year joined to their totals (the join lot 2B builds on)'
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*), sum(t.planned), sum(t.forecast)
FROM spend_versions v
LEFT JOIN spend_version_totals t ON t.tenant_id = v.tenant_id AND t.version_id = v.id
WHERE v.tenant_id = :'tenant_id'::uuid
  AND v.budget_year = 2026;

\echo '=== 3. Chargeback amounts per version (no explicit tenant_id: RLS only)'
EXPLAIN (ANALYZE, BUFFERS)
SELECT amount.version_id AS version_id, SUM(COALESCE(amount.planned, 0)) AS total
FROM spend_amounts amount
WHERE amount.version_id = ANY(:'version_ids_y'::uuid[])
  AND EXTRACT(YEAR FROM amount.period) = 2026
GROUP BY amount.version_id;

\echo '=== 4. Same as 3 with an explicit tenant_id predicate (what plan step 1D proposes)'
EXPLAIN (ANALYZE, BUFFERS)
SELECT amount.version_id AS version_id, SUM(COALESCE(amount.planned, 0)) AS total
FROM spend_amounts amount
WHERE amount.tenant_id = :'tenant_id'::uuid
  AND amount.version_id = ANY(:'version_ids_y'::uuid[])
  AND EXTRACT(YEAR FROM amount.period) = 2026
GROUP BY amount.version_id;

\echo '=== 5. Items read of the memory path (all items of the tenant, enabled)'
EXPLAIN (ANALYZE, BUFFERS)
SELECT i.* FROM spend_items i WHERE i.tenant_id = :'tenant_id'::uuid AND i.status = 'enabled';
COMMIT;
