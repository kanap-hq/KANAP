-- search_103
-- group: search
-- family: search
-- endpoint: GET /ai/search/entities?q=Licences (mention picker)
-- source: backend/src/ai/ai-search.controller.ts -> backend/src/ai/ai-entity.service.ts (searchIndexRowToSummary and per-type searches)
-- captured on appdb_perf10k (tenant perf, admin) on 2026-10-23, 0.02 ms in the API.
SELECT entity_type, entity_id, ref_prefix, ref_number, label, summary, status,
	              extra_json, source_updated_at,
	              COUNT(*) OVER()::int AS total_count,
	              CASE
	                WHEN NULL::text IS NOT NULL AND extra_json->>'legacy_number' = NULL THEN 4
	                WHEN NULL::int IS NOT NULL AND ref_number = NULL
	                     AND (NULL::text IS NULL OR ref_prefix = NULL) THEN 4
	                WHEN LOWER(COALESCE(extra_json->>'email', '')) = LOWER('Licences') THEN 4
	                WHEN NULL::text IS NOT NULL
	                     AND ref_number::text LIKE NULL || '%' THEN 3.5
	                WHEN label ILIKE '%Licences%' THEN 3
	                WHEN similarity(label, 'Licences') > 0.35 THEN 2.5
	                ELSE 1 + LEAST(ts_rank(search_vector, (websearch_to_tsquery('kanap_fr', 'Licences') || websearch_to_tsquery('kanap_en', 'Licences'))), 0.99)
	              END AS score
	       FROM search_index
	       WHERE tenant_id = '{{tenant_id}}'
	         AND entity_type = ANY('{technologies}'::text[])
	         AND (
	               (NULL::text IS NOT NULL AND extra_json->>'legacy_number' = NULL)
	            OR (NULL::int IS NOT NULL AND ref_number = NULL)
	            OR (NULL::text IS NOT NULL AND ref_number::text LIKE NULL || '%')
	            OR label ILIKE '%Licences%'
	            OR similarity(label, 'Licences') > 0.35
	            OR search_vector @@ (websearch_to_tsquery('kanap_fr', 'Licences') || websearch_to_tsquery('kanap_en', 'Licences'))
	            OR ('Licences:*'::text IS NOT NULL AND search_vector @@ (to_tsquery('kanap_fr', 'Licences:*') || to_tsquery('kanap_en', 'Licences:*')))
	            OR LOWER(COALESCE(extra_json->>'email', '')) = LOWER('Licences')
	         )
	         
	       ORDER BY score DESC,
	                CASE WHEN NULL::text IS NOT NULL THEN ref_number END ASC NULLS LAST,
	                source_updated_at DESC NULLS LAST,
	                label ASC
	       LIMIT '200' OFFSET '0';
