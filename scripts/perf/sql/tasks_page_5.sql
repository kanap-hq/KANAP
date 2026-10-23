-- tasks_page_5
-- group: tasks_page
-- family: tasks_page
-- endpoint: GET /tasks?page=1&limit=50&sort=priority_score:DESC
-- source: backend/src/spend/tasks.controller.ts (list) -> backend/src/spend/tasks-unified.service.ts / backend/src/tasks/tasks-unified.service.ts
-- captured on appdb_perf10k (tenant perf, admin) on 2026-10-23, 0.33 ms in the API.
SELECT COUNT(*)::int as count
	      FROM tasks t
	      LEFT JOIN users u ON t.assignee_user_id = u.id AND u.tenant_id = t.tenant_id
	      LEFT JOIN users uc ON t.creator_id = uc.id AND uc.tenant_id = t.tenant_id
	      LEFT JOIN spend_items si ON (t.related_object_type = 'spend_item' AND t.related_object_id = si.id AND si.tenant_id = t.tenant_id AND si.nature = 'opex')
	      LEFT JOIN contracts c ON (t.related_object_type = 'contract' AND t.related_object_id = c.id AND c.tenant_id = t.tenant_id)
	      LEFT JOIN spend_items ci ON (t.related_object_type = 'capex_item' AND t.related_object_id = ci.id AND ci.tenant_id = t.tenant_id AND ci.nature = 'capex')
	      LEFT JOIN incidents inc ON (t.related_object_type = 'incident' AND t.related_object_id = inc.id AND inc.tenant_id = t.tenant_id)
	      LEFT JOIN portfolio_projects pp ON (t.related_object_type = 'project' AND t.related_object_id = pp.id AND pp.tenant_id = t.tenant_id)
	      LEFT JOIN portfolio_requests pr_origin ON pr_origin.origin_task_id = t.id AND pr_origin.tenant_id = t.tenant_id
	      LEFT JOIN portfolio_project_phases phase ON t.phase_id = phase.id AND phase.tenant_id = t.tenant_id
	      LEFT JOIN portfolio_task_types tt ON t.task_type_id = tt.id AND tt.tenant_id = t.tenant_id
	      -- Classification JOINs (COALESCE: task value wins, falls back to project)
	      LEFT JOIN portfolio_sources ps ON COALESCE(t.source_id, pp.source_id) = ps.id AND ps.tenant_id = t.tenant_id
	      LEFT JOIN portfolio_categories pc ON COALESCE(t.category_id, pp.category_id) = pc.id AND pc.tenant_id = t.tenant_id
	      LEFT JOIN portfolio_streams pst ON COALESCE(t.stream_id, pp.stream_id) = pst.id AND pst.tenant_id = t.tenant_id
	      LEFT JOIN companies comp ON COALESCE(t.company_id, pp.company_id) = comp.id AND comp.tenant_id = t.tenant_id
	      LEFT JOIN portfolio_streams project_pst ON project_pst.id = pp.stream_id AND project_pst.tenant_id = t.tenant_id
	      LEFT JOIN portfolio_categories project_pc ON project_pc.id = pp.category_id AND project_pc.tenant_id = t.tenant_id
	      WHERE t.tenant_id = '{{tenant_id}}';
