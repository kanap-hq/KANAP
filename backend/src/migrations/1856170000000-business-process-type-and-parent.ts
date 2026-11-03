import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Business processes (26.11 H1): the ISO 9001 type and a parent process, in place of the
 * categories.
 *
 * - `process_type`: management, core or support, one per process, optional.
 * - `parent_id`: the parent process, optional, in the same tenant (composite key, as
 *   `cost_centers.parent_id`); a process is never its own parent. Cycles are refused by the
 *   service under a tenant lock. A process that has sub-processes cannot be deleted (NO ACTION).
 * - The categories go, with their links and the search trigger of the links: no data is kept
 *   (Fried, 3/11). Existing processes start with no type and no parent.
 * - The search entry of a process no longer reads the categories: the function is defined again,
 *   SECURITY DEFINER with its search_path pinned as every search index function (1854500000000),
 *   then the entries are refreshed tenant by tenant (search_index is under FORCE RLS).
 *
 * Idempotent: every step checks what exists. down() removes the columns and gives back empty
 * category tables; the search function keeps its new body, and the (tenant_id, id) key stays
 * (1854190000000 owns it).
 */
export class BusinessProcessTypeAndParent1856170000000 implements MigrationInterface {
  name = 'BusinessProcessTypeAndParent1856170000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE business_processes ADD COLUMN IF NOT EXISTS process_type text NULL`);
    await queryRunner.query(`ALTER TABLE business_processes ADD COLUMN IF NOT EXISTS parent_id uuid NULL`);
    await addConstraint(queryRunner, 'business_processes_process_type_check',
      `CHECK (process_type IS NULL OR process_type IN ('management', 'core', 'support'))`);
    // Present since 1854190000000 (the application links reference it); added if missing.
    await addConstraint(queryRunner, 'business_processes_tenant_id_id_key', `UNIQUE (tenant_id, id)`);
    await addConstraint(queryRunner, 'business_processes_not_own_parent_check', `CHECK (parent_id IS NULL OR parent_id <> id)`);
    await addConstraint(queryRunner, 'business_processes_parent_fk',
      `FOREIGN KEY (tenant_id, parent_id) REFERENCES business_processes (tenant_id, id) ON DELETE NO ACTION`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_business_processes_tenant_parent ON business_processes (tenant_id, parent_id)`,
    );

    await queryRunner.query(REFRESH_FUNCTION);
    await queryRunner.query(`DROP TABLE IF EXISTS business_process_category_links`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS search_index_sync_link_business_process_category_links()`);
    await queryRunner.query(`DROP TABLE IF EXISTS business_process_categories`);

    await queryRunner.query(`
      DO $do$
      DECLARE
        t RECORD;
        previous text := current_setting('app.current_tenant', true);
      BEGIN
        FOR t IN SELECT id FROM tenants ORDER BY created_at ASC, id ASC LOOP
          PERFORM set_config('app.current_tenant', t.id::text, true);
          PERFORM search_index_refresh_business_processes(t.id);
        END LOOP;
        -- The migrations of a run share one transaction: the next one starts with the setting it had.
        PERFORM set_config('app.current_tenant', COALESCE(previous, ''), true);
      END
      $do$
    `);
    console.log('[1856170000000] business processes: type and parent added, categories removed, search entries refreshed');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS business_process_categories (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants(id) ON DELETE CASCADE,
        name text NOT NULL,
        is_default boolean NOT NULL DEFAULT false,
        is_active boolean NOT NULL DEFAULT true,
        sort_order integer NOT NULL DEFAULT 100,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_business_process_categories_unique_name
      ON business_process_categories (tenant_id, lower(name))
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS business_process_category_links (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants(id) ON DELETE CASCADE,
        process_id uuid NOT NULL REFERENCES business_processes(id) ON DELETE CASCADE,
        category_id uuid NOT NULL REFERENCES business_process_categories(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_business_process_category_links_unique
      ON business_process_category_links (tenant_id, process_id, category_id)
    `);
    for (const table of ['business_process_categories', 'business_process_category_links']) {
      await queryRunner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await queryRunner.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      await queryRunner.query(`DROP POLICY IF EXISTS ${table}_tenant_isolation ON ${table}`);
      await queryRunner.query(`
        CREATE POLICY ${table}_tenant_isolation ON ${table}
          USING (tenant_id = app_current_tenant())
          WITH CHECK (tenant_id = app_current_tenant())
      `);
    }
    // The search entry and the link trigger as they were (1853000000000, definer since 1854500000000).
    await queryRunner.query(PREVIOUS_REFRESH_FUNCTION);
    await queryRunner.query(PREVIOUS_LINK_TRIGGER);
    await queryRunner.query(`ALTER TABLE business_processes DROP CONSTRAINT IF EXISTS business_processes_parent_fk`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_business_processes_tenant_parent`);
    await queryRunner.query(`ALTER TABLE business_processes DROP CONSTRAINT IF EXISTS business_processes_not_own_parent_check`);
    await queryRunner.query(`ALTER TABLE business_processes DROP CONSTRAINT IF EXISTS business_processes_process_type_check`);
    await queryRunner.query(`ALTER TABLE business_processes DROP COLUMN IF EXISTS parent_id`);
    await queryRunner.query(`ALTER TABLE business_processes DROP COLUMN IF EXISTS process_type`);
  }
}

async function addConstraint(queryRunner: QueryRunner, name: string, definition: string): Promise<void> {
  const rows: unknown[] = await queryRunner.query(
    `SELECT 1 FROM pg_constraint WHERE conrelid = 'business_processes'::regclass AND conname = $1`,
    [name],
  );
  if (rows.length === 0) await queryRunner.query(`ALTER TABLE business_processes ADD CONSTRAINT ${name} ${definition}`);
}

/** The search entry of a process: its name, its status and type, its description and notes. */
const REFRESH_FUNCTION = `
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
             || search_index_tsv('B', CONCAT_WS(' ', bp.status::text, bp.process_type))
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

/** The search entry of a process before 26.11: the first category by name stood in for the summary. */
const PREVIOUS_REFRESH_FUNCTION = `
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
           COALESCE(NULLIF(bp.description, ''), NULLIF(bp.notes, ''), (
             SELECT c.name
             FROM business_process_category_links l
             JOIN business_process_categories c ON c.id = l.category_id AND c.tenant_id = bp.tenant_id
             WHERE l.process_id = bp.id AND l.tenant_id = bp.tenant_id
             ORDER BY c.name ASC
             LIMIT 1
           )),
           bp.status::text,
           jsonb_build_object('primary_category', (
             SELECT c.name
             FROM business_process_category_links l
             JOIN business_process_categories c ON c.id = l.category_id AND c.tenant_id = bp.tenant_id
             WHERE l.process_id = bp.id AND l.tenant_id = bp.tenant_id
             ORDER BY c.name ASC
             LIMIT 1
           )),
           search_index_tsv('A', bp.name)
             || search_index_tsv('B', bp.status::text)
             || search_index_tsv('C', CONCAT_WS(' ', bp.description, bp.notes, (
               SELECT string_agg(c.name, ' ' ORDER BY c.name)
               FROM business_process_category_links l
               JOIN business_process_categories c ON c.id = l.category_id AND c.tenant_id = bp.tenant_id
               WHERE l.process_id = bp.id AND l.tenant_id = bp.tenant_id
             ))),
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

/** The trigger of the category links before 26.11: a link change refreshes its process. */
const PREVIOUS_LINK_TRIGGER = `
  CREATE OR REPLACE FUNCTION search_index_sync_link_business_process_category_links()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $fn$
  BEGIN
    IF TG_OP IN ('DELETE', 'UPDATE') THEN
      PERFORM search_index_refresh_business_processes(OLD.tenant_id, ARRAY[OLD.process_id]);
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE')
       AND (TG_OP = 'INSERT' OR NEW.process_id IS DISTINCT FROM OLD.process_id) THEN
      PERFORM search_index_refresh_business_processes(NEW.tenant_id, ARRAY[NEW.process_id]);
    END IF;
    RETURN COALESCE(NEW, OLD);
  END
  $fn$;

  DROP TRIGGER IF EXISTS trg_search_index_link_business_process_category_links ON business_process_category_links;
  CREATE TRIGGER trg_search_index_link_business_process_category_links
  AFTER INSERT OR UPDATE OR DELETE ON business_process_category_links
  FOR EACH ROW
  EXECUTE FUNCTION search_index_sync_link_business_process_category_links();
`;
