-- fiche_detail_9
-- group: fiche
-- family: fiche
-- endpoint: GET /spend-items/BL-2500 (workspace of line BL-2500)
-- source: backend/src/spend/spend-items.controller.ts, backend/src/spend/spend-items.service.ts, backend/src/spend/spend-versions.* 
-- captured on appdb_perf10k (tenant perf, admin) on 2026-10-23, 0.24 ms in the API.
SELECT
	       (SELECT json_build_object('id', s.id, 'name', s.name, 'erp_supplier_id', s.erp_supplier_id, 'status', s.status)
	          FROM suppliers s WHERE s.tenant_id = '{{tenant_id}}' AND s.id = '{{item_supplier_id}}') AS supplier,
	       (SELECT json_build_object('id', c.id, 'name', c.name)
	          FROM companies c WHERE c.tenant_id = '{{tenant_id}}' AND c.id = '{{company_id}}') AS paying_company,
	       (SELECT json_build_object('id', a.id, 'account_number', a.account_number, 'account_name', a.account_name,
	                                 'description', a.description, 'coa_id', a.coa_id)
	          FROM accounts a WHERE a.tenant_id = '{{tenant_id}}' AND a.id = '{{item_account_id}}') AS account,
	       (SELECT json_build_object(
	  'id', u.id, 'first_name', u.first_name, 'last_name', u.last_name,
	  'email', CASE WHEN btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) = '' THEN u.email END) FROM users u WHERE u.tenant_id = '{{tenant_id}}' AND u.id = '{{item_owner_it_id}}') AS owner_it,
	       (SELECT json_build_object(
	  'id', u.id, 'first_name', u.first_name, 'last_name', u.last_name,
	  'email', CASE WHEN btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) = '' THEN u.email END) FROM users u WHERE u.tenant_id = '{{tenant_id}}' AND u.id = '{{item_owner_business_id}}') AS owner_business,
	       (SELECT json_build_object('id', cc.id, 'code', cc.code, 'name', cc.name, 'kind', cc.kind,
	                                 'disabled_at', cc.disabled_at, 'company_id', cc.company_id, 'company_name', c.name,
	                                 'owner_user_id', cc.owner_user_id,
	                                 'owner_name', CASE WHEN u.id IS NULL THEN NULL
	                                   ELSE COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), u.email) END)
	          FROM cost_centers cc
	          LEFT JOIN companies c ON c.tenant_id = cc.tenant_id AND c.id = cc.company_id
	          LEFT JOIN users u ON u.tenant_id = cc.tenant_id AND u.id = cc.owner_user_id
	         WHERE cc.tenant_id = '{{tenant_id}}' AND cc.id = '{{item_cost_center_id}}') AS cost_center;
