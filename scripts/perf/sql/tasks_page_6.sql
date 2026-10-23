-- tasks_page_6
-- group: tasks_page
-- family: tasks_page
-- endpoint: GET /tasks?page=1&limit=50&sort=priority_score:DESC
-- source: backend/src/spend/tasks.controller.ts (list) -> backend/src/spend/tasks-unified.service.ts / backend/src/tasks/tasks-unified.service.ts
-- captured on appdb_perf10k (tenant perf, admin) on 2026-10-23, 8.11 ms in the API.
SELECT
	        t.id,
	        t.tenant_id,
	        t.item_number,
	        t.title,
	        t.description,
	        t.status,
	        t.due_date,
	        t.start_date,
	        t.created_at,
	        t.updated_at,
	        t.assignee_user_id,
	        COALESCE(u.first_name || ' ' || u.last_name, u.email) as assignee_name,
	        COALESCE(uc.first_name || ' ' || uc.last_name, uc.email) as creator_name,
	        t.related_object_type,
	        t.related_object_id,
	        CASE
	          WHEN t.related_object_type IS NULL THEN NULL
	          WHEN t.related_object_type = 'spend_item' THEN si.product_name
	          WHEN t.related_object_type = 'contract' THEN c.name
	          WHEN t.related_object_type = 'capex_item' THEN ci.product_name
	          WHEN t.related_object_type = 'incident' THEN CASE WHEN inc.id IS NULL THEN NULL WHEN inc.confidential THEN 'INC-' || inc.item_number::text ELSE 'INC-' || inc.item_number::text || ' · ' || inc.title END
	          WHEN t.related_object_type = 'project' THEN pp.name
	          ELSE ''
	        END as related_object_name,
	        t.task_type_id,
	        tt.name as task_type_name,
	        tt.code as task_type_code,
	        t.phase_id,
	        phase.name as phase_name,
	        t.priority_level,
	        CASE
	  WHEN t.related_object_type = 'project' AND pp.priority_score IS NOT NULL THEN
	    ROUND(LEAST(GREATEST(
	      pp.priority_score +
	      CASE t.priority_level
	        WHEN 'blocker' THEN 10
	        WHEN 'high' THEN 5
	        WHEN 'normal' THEN 0
	        WHEN 'low' THEN -5
	        WHEN 'optional' THEN -10
	        ELSE 0
	      END, 0), 100))
	  ELSE
	    CASE t.priority_level
	      WHEN 'blocker' THEN 110
	      WHEN 'high' THEN 90
	      WHEN 'normal' THEN 70
	      WHEN 'low' THEN 50
	      WHEN 'optional' THEN 30
	      ELSE 70
	    END
	END as priority_score,
	        t.labels,
	        pp.name as project_name,
	        project_pst.name as project_stream_name,
	        project_pc.name as project_category_name,
	        -- Classification (task value wins, falls back to project)
	        COALESCE(t.source_id, pp.source_id) as source_id,
	        COALESCE(t.category_id, pp.category_id) as category_id,
	        COALESCE(t.stream_id, pp.stream_id) as stream_id,
	        COALESCE(t.company_id, pp.company_id) as company_id,
	        -- Resolved classification names
	        ps.name as source_name,
	        pc.name as category_name,
	        pst.name as stream_name,
	        comp.name as company_name,
	        t.creator_id,
	        t.owner_ids,
	        t.viewer_ids,
	        
	  COALESCE((
	    SELECT jsonb_agg(app_link.application_id ORDER BY app.name ASC NULLS LAST, app_link.application_id)
	    FROM task_applications app_link
	    JOIN applications app ON app.id = app_link.application_id AND app.tenant_id = app_link.tenant_id
	    WHERE app_link.task_id = t.id
	      AND app_link.tenant_id = t.tenant_id
	  ), '[]'::jsonb) AS application_ids,
	        
	  COALESCE((
	    SELECT jsonb_agg(asset_link.asset_id ORDER BY asset.name ASC NULLS LAST, asset_link.asset_id)
	    FROM task_assets asset_link
	    JOIN assets asset ON asset.id = asset_link.asset_id AND asset.tenant_id = asset_link.tenant_id
	    WHERE asset_link.task_id = t.id
	      AND asset_link.tenant_id = t.tenant_id
	  ), '[]'::jsonb) AS asset_ids,
	        
	  COALESCE((
	    SELECT jsonb_agg(jsonb_build_object(
	      'id', app.id,
	      'name', app.name,
	      'sequential_id', app.sequential_id
	    ) ORDER BY app.name ASC NULLS LAST, app.id)
	    FROM task_applications app_link
	    JOIN applications app ON app.id = app_link.application_id AND app.tenant_id = app_link.tenant_id
	    WHERE app_link.task_id = t.id
	      AND app_link.tenant_id = t.tenant_id
	  ), '[]'::jsonb) AS applications,
	        
	  COALESCE((
	    SELECT jsonb_agg(jsonb_build_object(
	      'id', asset.id,
	      'name', asset.name,
	      'asset_reference', asset.asset_reference,
	      'hostname', asset.hostname
	    ) ORDER BY asset.name ASC NULLS LAST, asset.id)
	    FROM task_assets asset_link
	    JOIN assets asset ON asset.id = asset_link.asset_id AND asset.tenant_id = asset_link.tenant_id
	    WHERE asset_link.task_id = t.id
	      AND asset_link.tenant_id = t.tenant_id
	  ), '[]'::jsonb) AS assets,
	        pr_origin.id as converted_request_id,
	        pr_origin.item_number as converted_request_item_number
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
	      WHERE t.tenant_id = '{{tenant_id}}'
	      ORDER BY priority_score DESC, t.id ASC
	      LIMIT 50 OFFSET 0;
