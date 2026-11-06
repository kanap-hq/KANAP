import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Business processes: the search entry carries the label of the type in the four languages of the
 * interface (`businessProcesses.types` in `frontend/src/locales/{en,fr,de,es}/master-data.json`),
 * next to its code, so "Réalisation", "Kernprozess" or "Operativo" find the core processes.
 *
 * The function is defined again, SECURITY DEFINER with its search_path pinned as every search
 * index function (1854500000000), then the entries are refreshed tenant by tenant (search_index
 * is under FORCE RLS), as 1856170000000 does.
 *
 * Idempotent: CREATE OR REPLACE and a refresh. down() gives back the body of 1856170000000 and
 * refreshes again.
 */
export class BusinessProcessTypeSearchLabels1856180000000 implements MigrationInterface {
  name = 'BusinessProcessTypeSearchLabels1856180000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(refreshFunction(TYPE_TEXT));
    await queryRunner.query(REFRESH_ALL_TENANTS);
    console.log('[1856180000000] business processes: type labels added to the search entries');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(refreshFunction('bp.process_type'));
    await queryRunner.query(REFRESH_ALL_TENANTS);
  }
}

/** The code of the type and its label in en, fr, de and es. */
const TYPE_TEXT = `bp.process_type,
               CASE bp.process_type
                 WHEN 'management' THEN 'Management Pilotage Führungsprozess Estratégico'
                 WHEN 'core' THEN 'Core Réalisation Kernprozess Operativo'
                 WHEN 'support' THEN 'Support Unterstützungsprozess Apoyo'
               END`;

/** The search entry of a process: its name, its status and type, its description and notes. */
function refreshFunction(typeText: string): string {
  return `
  CREATE OR REPLACE FUNCTION search_index_refresh_business_processes(p_tenant uuid, p_ids uuid[] DEFAULT NULL)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $fn$
    DELETE FROM search_index si_del
    WHERE si_del.tenant_id = p_tenant
      AND si_del.entity_type = 'business_processes'
      AND (p_ids IS NULL OR si_del.entity_id = ANY(p_ids))
      AND NOT EXISTS (
        SELECT 1 FROM business_processes src
        WHERE src.id = si_del.entity_id AND src.tenant_id = p_tenant
      );
    INSERT INTO search_index (
      tenant_id, entity_type, entity_id, ref_prefix, ref_number,
      label, summary, status, extra_json, search_vector, source_updated_at, indexed_at
    )
    SELECT bp.tenant_id,
           'business_processes',
           bp.id,
           NULL,
           NULL,
           bp.name,
           COALESCE(NULLIF(bp.description, ''), NULLIF(bp.notes, '')),
           bp.status::text,
           jsonb_build_object('process_type', bp.process_type),
           search_index_tsv('A', bp.name)
             || search_index_tsv('B', CONCAT_WS(' ', bp.status::text, ${typeText}))
             || search_index_tsv('C', CONCAT_WS(' ', bp.description, bp.notes)),
           bp.updated_at,
           now()
    FROM business_processes bp
    WHERE bp.tenant_id = p_tenant
      AND (p_ids IS NULL OR bp.id = ANY(p_ids))
    ON CONFLICT (tenant_id, entity_type, entity_id) DO UPDATE SET
      ref_prefix = EXCLUDED.ref_prefix,
      ref_number = EXCLUDED.ref_number,
      label = EXCLUDED.label,
      summary = EXCLUDED.summary,
      status = EXCLUDED.status,
      extra_json = EXCLUDED.extra_json,
      search_vector = EXCLUDED.search_vector,
      source_updated_at = EXCLUDED.source_updated_at,
      indexed_at = EXCLUDED.indexed_at;
  $fn$
`;
}

/** Refreshes every tenant's entries, then gives the next migration of the run the tenant setting it had. */
const REFRESH_ALL_TENANTS = `
  DO $do$
  DECLARE
    t RECORD;
    previous text := current_setting('app.current_tenant', true);
  BEGIN
    FOR t IN SELECT id FROM tenants ORDER BY created_at ASC, id ASC LOOP
      PERFORM set_config('app.current_tenant', t.id::text, true);
      PERFORM search_index_refresh_business_processes(t.id);
    END LOOP;
    PERFORM set_config('app.current_tenant', COALESCE(previous, ''), true);
  END
  $do$
`;
