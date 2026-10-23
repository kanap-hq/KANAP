-- contracts_page_22
-- group: contracts_page
-- family: contracts_page
-- endpoint: GET /contracts?page=1&limit=50&sort=name:ASC
-- source: backend/src/contracts/contracts.controller.ts (list)
-- captured on appdb_perf10k (tenant perf, admin) on 2026-10-23, 0.21 ms in the API.
SELECT cs.* FROM (SELECT c.id AS contract_id,
	           count(e.requirement)::int AS expected,
	           count(e.requirement) FILTER (WHERE i.state = 'absent')::int AS missing,
	           count(e.requirement) FILTER (WHERE i.state IS NULL)::int AS to_check,
	           CASE WHEN count(e.requirement) = 0 THEN 'none'
	                WHEN count(e.requirement) FILTER (WHERE i.state = 'absent') > 0 THEN 'missing'
	                WHEN count(e.requirement) FILTER (WHERE i.state IS NULL) > 0 THEN 'to_check'
	                ELSE 'complete' END AS state
	      FROM contracts c
	      LEFT JOIN (SELECT DISTINCT rr.contract_id, rr.requirement FROM (SELECT DISTINCT cov.contract_id, rq.requirement, r.rule, cov.application_id, a.name AS application_name,
	           cov.asset_id, ast.name AS asset_name, r.level_code
	      FROM (
	        SELECT DISTINCT ON (x.contract_id, x.application_id) x.contract_id, x.application_id, x.asset_id
	          FROM (
	            SELECT l.contract_id, l.application_id, NULL::uuid AS asset_id
	              FROM application_contracts l
	             WHERE l.tenant_id = app_current_tenant()
	            UNION ALL
	            SELECT ca.contract_id, ai.application_id, ca.asset_id
	              FROM (
	                SELECT l.contract_id, l.asset_id FROM asset_contracts l WHERE l.tenant_id = app_current_tenant()
	                UNION
	                SELECT s.support_contract_id, s.asset_id FROM asset_support_info s
	                 WHERE s.tenant_id = app_current_tenant() AND s.support_contract_id IS NOT NULL
	              ) ca
	              JOIN app_asset_assignments aaa ON aaa.tenant_id = app_current_tenant() AND aaa.asset_id = ca.asset_id
	              JOIN app_instances ai ON ai.tenant_id = aaa.tenant_id AND ai.id = aaa.app_instance_id
	          ) x
	          WHERE x.contract_id = ANY(CAST('{{page_contract_ids}}' AS uuid[]))
	         ORDER BY x.contract_id, x.application_id, x.asset_id NULLS FIRST
	      ) cov
	      JOIN applications a ON a.tenant_id = app_current_tenant() AND a.id = cov.application_id
	                         AND (a.disabled_at IS NULL OR a.disabled_at > now())
	      LEFT JOIN assets ast ON ast.tenant_id = app_current_tenant() AND ast.id = cov.asset_id
	      CROSS JOIN LATERAL (
	        SELECT 'personal_data'::text AS rule, NULL::text AS level_code WHERE a.contains_pii
	        UNION ALL
	        SELECT 'business_criticality', a.criticality WHERE a.criticality = ANY(CAST('{business_critical,high}' AS text[]))
	        UNION ALL
	        SELECT 'cyber_criticality', a.cyber_criticality WHERE a.cyber_criticality = ANY(CAST('{critical,high}' AS text[]))
	        UNION ALL
	        SELECT DISTINCT 'cloud_hosting', loc.hosting_type
	          FROM app_instances hi
	          JOIN app_asset_assignments ha ON ha.tenant_id = hi.tenant_id AND ha.app_instance_id = hi.id
	          JOIN assets hs ON hs.tenant_id = hi.tenant_id AND hs.id = ha.asset_id
	          JOIN locations loc ON loc.tenant_id = hi.tenant_id AND loc.id = hs.location_id
	         WHERE hi.tenant_id = a.tenant_id AND hi.application_id = a.id
	           AND loc.hosting_type = ANY(CAST('{public_cloud,private_cloud,saas}' AS text[]))
	      ) r
	      JOIN unnest(CAST('{personal_data,personal_data,business_criticality,business_criticality,business_criticality,cyber_criticality,cyber_criticality,cyber_criticality,cloud_hosting}' AS text[]), CAST('{gdpr_dpa,data_location,reversibility,exit_plan,audit_security,reversibility,exit_plan,audit_security,data_location}' AS text[])) AS rq(rule, requirement)
	        ON rq.rule = r.rule) rr) e
	        ON e.contract_id = c.id
	      LEFT JOIN contract_compliance_items i
	        ON i.tenant_id = c.tenant_id AND i.contract_id = c.id AND i.requirement = e.requirement
	     WHERE c.tenant_id = app_current_tenant() AND c.id = ANY(CAST('{{page_contract_ids}}' AS uuid[]))
	     GROUP BY c.id) "cs";
