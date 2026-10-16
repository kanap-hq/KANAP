import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Search index for the technologies (lot S, plan planning/cartographie-technologies.md).
 *
 * Adds the `technologies` type to the unified `search_index` (1853000000000), with the shape of
 * 1853450000000 (incidents): a refresh function and an AFTER ROW trigger, so TEC-N, the name, the
 * editor and the CPE identifiers are reachable from the global search and the chat. No trigger on
 * the versions or the links: they do not change the indexed text. The backfill runs per tenant
 * with app.current_tenant set (the search_index policy checks it); the table is new, so it finds
 * nothing on an existing installation and is there for a rerun.
 */

function tsv(weight: 'A' | 'B' | 'C', expr: string): string {
  return `search_index_tsv('${weight}', ${expr})`;
}

const VECTOR = [
  tsv('A', `CONCAT_WS(' ', 'TEC-' || t.item_number::text, t.name, t.editor)`),
  tsv('B', `CONCAT_WS(' ', t.description, t.family)`),
  tsv('C', `CONCAT_WS(' ', t.notes, array_to_string(t.cpe_products, ' '))`),
].join(' || ');

const REFRESH_FUNCTION = `
  CREATE OR REPLACE FUNCTION search_index_refresh_technologies(p_tenant uuid, p_ids uuid[] DEFAULT NULL)
  RETURNS void AS $fn$
    DELETE FROM search_index si_del
    WHERE si_del.tenant_id = p_tenant
      AND si_del.entity_type = 'technologies'
      AND (p_ids IS NULL OR si_del.entity_id = ANY(p_ids))
      AND NOT EXISTS (
        SELECT 1 FROM technologies src
        WHERE src.id = si_del.entity_id AND src.tenant_id = p_tenant
      );
    INSERT INTO search_index (
      tenant_id, entity_type, entity_id, ref_prefix, ref_number,
      label, summary, status, extra_json, search_vector, source_updated_at, indexed_at
    )
    SELECT t.tenant_id,
           'technologies',
           t.id,
           'TEC',
           t.item_number,
           t.name,
           t.description,
           t.lifecycle,
           jsonb_build_object('family', t.family, 'editor', t.editor, 'mode', t.mode),
           ${VECTOR},
           t.updated_at,
           now()
    FROM technologies t
    WHERE t.tenant_id = p_tenant
      AND (p_ids IS NULL OR t.id = ANY(p_ids))
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
  $fn$ LANGUAGE sql;
`;

const SYNC_TRIGGER = `
  CREATE OR REPLACE FUNCTION search_index_sync_technologies()
  RETURNS trigger AS $fn$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      PERFORM search_index_delete(OLD.tenant_id, 'technologies', OLD.id);
      RETURN OLD;
    END IF;
    PERFORM search_index_refresh_technologies(NEW.tenant_id, ARRAY[NEW.id]);
    RETURN NEW;
  END
  $fn$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS trg_search_index_technologies ON technologies;
  CREATE TRIGGER trg_search_index_technologies
  AFTER INSERT OR UPDATE OR DELETE ON technologies
  FOR EACH ROW
  EXECUTE FUNCTION search_index_sync_technologies();
`;

// Per-tenant loop: set_config(..., true) is transaction-local and keeps the search_index RLS
// WITH CHECK satisfied for each tenant in turn.
const BACKFILL_ALL_TENANTS = `
  DO $do$
  DECLARE
    t RECORD;
  BEGIN
    FOR t IN SELECT id FROM tenants ORDER BY created_at ASC, id ASC LOOP
      PERFORM set_config('app.current_tenant', t.id::text, true);
      PERFORM search_index_refresh_technologies(t.id);
    END LOOP;
  END
  $do$
`;

const DELETE_ALL_TENANTS = `
  DO $do$
  DECLARE
    t RECORD;
  BEGIN
    FOR t IN SELECT id FROM tenants ORDER BY created_at ASC, id ASC LOOP
      PERFORM set_config('app.current_tenant', t.id::text, true);
      DELETE FROM search_index WHERE tenant_id = t.id AND entity_type = 'technologies';
    END LOOP;
  END
  $do$
`;

export class TechnologySearchIndex1854200000000 implements MigrationInterface {
  name = 'TechnologySearchIndex1854200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(REFRESH_FUNCTION);
    await queryRunner.query(SYNC_TRIGGER);
    await queryRunner.query(BACKFILL_ALL_TENANTS);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(DELETE_ALL_TENANTS);
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_search_index_technologies ON technologies`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS search_index_sync_technologies()`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS search_index_refresh_technologies(uuid, uuid[])`);
  }
}
