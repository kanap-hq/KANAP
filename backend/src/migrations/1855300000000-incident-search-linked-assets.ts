import { MigrationInterface, QueryRunner } from 'typeorm';

const LOG_PREFIX = '[Migration] IncidentSearchLinkedAssets:';

/**
 * Global search finds an incident by the name, hostname or FQDN of its linked assets
 * (report: incidents-avant-article-2026-10-25.md, B1; registry search parity,
 * incidents.service.ts).
 *
 * 1. `search_index_refresh_incidents` (body of 1853490000000, with the review document)
 *    adds the linked assets' name, hostname and FQDN at weight C, next to the external
 *    reference and the review body. One correlated `string_agg` over
 *    `incident_assets`/`assets`, both tenants pinned; no row is duplicated.
 * 2. Freshness:
 *    - `incident_assets` INSERT / UPDATE / DELETE: statement triggers with transition
 *      tables (as 1853940000000), one refresh call per tenant with the distinct incident
 *      ids of the statement, never one call per link.
 *    - `assets` UPDATE OF name, hostname, fqdn: one row trigger, one refresh call with
 *      the array of every incident linked to that asset. A statement renaming several
 *      assets refreshes each asset's incidents once.
 *    Both trigger functions are SECURITY DEFINER with search_path pinned: they maintain
 *    `search_index`, a table derived from data-scoped rows (AGENTS.md, "Multi-tenant
 *    safety").
 * 3. Initial reindex per tenant with `app.current_tenant` set: every table this function
 *    reads or writes is FORCE RLS, so a global statement would touch zero rows. Counts
 *    and duration are logged.
 *
 * Idempotent: functions are created or replaced, triggers dropped and created, and the
 * reindex rewrites the same entries. down() restores the 1853490000000 body (with the
 * SECURITY DEFINER and search_path of 1854500000000), drops the triggers and functions,
 * and reindexes so the entries lose the linked assets' text.
 *
 * Consequence for later migrations: writing `assets.name`, `assets.hostname`,
 * `assets.fqdn` or `incident_assets` fires these triggers, which write `search_index`.
 * Such a migration runs per tenant with `app.current_tenant` set (as the reindex above),
 * or disables the trigger around a global repair.
 */

/** Linked assets of the incident, as one text for weight C. NULL when it has none. */
const INCIDENT_ASSET_TEXT = `(
        SELECT string_agg(CONCAT_WS(' ', a.name, a.hostname, a.fqdn), ' ' ORDER BY a.id)
        FROM incident_assets ia
        JOIN assets a
          ON a.id = ia.asset_id
         AND a.tenant_id = ia.tenant_id
        WHERE ia.tenant_id = i.tenant_id
          AND ia.incident_id = i.id
      )`;

const INCIDENTS_REFRESH_WITH_ASSETS = `
  CREATE OR REPLACE FUNCTION search_index_refresh_incidents(p_tenant uuid, p_ids uuid[] DEFAULT NULL)
  RETURNS void AS $fn$
    DELETE FROM search_index si_del
    WHERE si_del.tenant_id = p_tenant
      AND si_del.entity_type = 'incidents'
      AND (p_ids IS NULL OR si_del.entity_id = ANY(p_ids))
      AND NOT EXISTS (
        SELECT 1 FROM incidents src
        WHERE src.id = si_del.entity_id AND src.tenant_id = p_tenant
      );
    INSERT INTO search_index (
      tenant_id, entity_type, entity_id, ref_prefix, ref_number,
      label, summary, status, extra_json, search_vector, source_updated_at, indexed_at
    )
    SELECT i.tenant_id,
           'incidents',
           i.id,
           'INC',
           i.item_number,
           i.title,
           i.description,
           i.status,
           jsonb_build_object('severity', i.severity, 'category', i.category),
           search_index_tsv('A', CONCAT_WS(' ', 'INC-' || i.item_number::text, i.title))
             || search_index_tsv('B', CONCAT_WS(' ', i.description))
             || search_index_tsv('C', CONCAT_WS(' ', i.source_ref, d.content_plain, ${INCIDENT_ASSET_TEXT})),
           i.updated_at,
           now()
    FROM incidents i
    LEFT JOIN integrated_document_bindings b
      ON b.tenant_id = i.tenant_id
     AND b.source_entity_type = 'incidents'
     AND b.source_entity_id = i.id
     AND b.slot_key = 'review'
    LEFT JOIN documents d
      ON d.id = b.document_id
     AND d.tenant_id = b.tenant_id
    WHERE i.tenant_id = p_tenant
      AND (p_ids IS NULL OR i.id = ANY(p_ids))
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
  $fn$ LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp;
`;

/** 1853490000000's body, plus the SECURITY DEFINER and search_path set by 1854500000000. */
const INCIDENTS_REFRESH_WITHOUT_ASSETS = `
  CREATE OR REPLACE FUNCTION search_index_refresh_incidents(p_tenant uuid, p_ids uuid[] DEFAULT NULL)
  RETURNS void AS $fn$
    DELETE FROM search_index si_del
    WHERE si_del.tenant_id = p_tenant
      AND si_del.entity_type = 'incidents'
      AND (p_ids IS NULL OR si_del.entity_id = ANY(p_ids))
      AND NOT EXISTS (
        SELECT 1 FROM incidents src
        WHERE src.id = si_del.entity_id AND src.tenant_id = p_tenant
      );
    INSERT INTO search_index (
      tenant_id, entity_type, entity_id, ref_prefix, ref_number,
      label, summary, status, extra_json, search_vector, source_updated_at, indexed_at
    )
    SELECT i.tenant_id,
           'incidents',
           i.id,
           'INC',
           i.item_number,
           i.title,
           i.description,
           i.status,
           jsonb_build_object('severity', i.severity, 'category', i.category),
           search_index_tsv('A', CONCAT_WS(' ', 'INC-' || i.item_number::text, i.title))
             || search_index_tsv('B', CONCAT_WS(' ', i.description))
             || search_index_tsv('C', CONCAT_WS(' ', i.source_ref, d.content_plain)),
           i.updated_at,
           now()
    FROM incidents i
    LEFT JOIN integrated_document_bindings b
      ON b.tenant_id = i.tenant_id
     AND b.source_entity_type = 'incidents'
     AND b.source_entity_id = i.id
     AND b.slot_key = 'review'
    LEFT JOIN documents d
      ON d.id = b.document_id
     AND d.tenant_id = b.tenant_id
    WHERE i.tenant_id = p_tenant
      AND (p_ids IS NULL OR i.id = ANY(p_ids))
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
  $fn$ LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp;
`;

/**
 * One refresh call per tenant and statement. The transition tables exist for one
 * statement only; UPDATE refreshes both the old and the new incident (a moved link).
 */
const INCIDENT_ASSETS_SYNC_FUNCTION = `
  CREATE OR REPLACE FUNCTION search_index_sync_link_incident_assets()
  RETURNS trigger AS $fn$
  DECLARE
    k_tenant uuid;
    k_incidents uuid[];
  BEGIN
    IF TG_OP = 'INSERT' THEN
      FOR k_tenant, k_incidents IN
        SELECT x.tenant_id, array_agg(DISTINCT x.incident_id)
        FROM new_rows x
        GROUP BY x.tenant_id
        ORDER BY x.tenant_id
      LOOP
        PERFORM search_index_refresh_incidents(k_tenant, k_incidents);
      END LOOP;
    ELSIF TG_OP = 'DELETE' THEN
      FOR k_tenant, k_incidents IN
        SELECT x.tenant_id, array_agg(DISTINCT x.incident_id)
        FROM old_rows x
        GROUP BY x.tenant_id
        ORDER BY x.tenant_id
      LOOP
        PERFORM search_index_refresh_incidents(k_tenant, k_incidents);
      END LOOP;
    ELSE
      FOR k_tenant, k_incidents IN
        SELECT x.tenant_id, array_agg(DISTINCT x.incident_id)
        FROM (
          SELECT tenant_id, incident_id FROM old_rows
          UNION ALL
          SELECT tenant_id, incident_id FROM new_rows
        ) x
        GROUP BY x.tenant_id
        ORDER BY x.tenant_id
      LOOP
        PERFORM search_index_refresh_incidents(k_tenant, k_incidents);
      END LOOP;
    END IF;
    RETURN NULL;
  END
  $fn$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
`;

const INCIDENT_ASSETS_TRIGGERS = `
  DROP TRIGGER IF EXISTS trg_search_index_link_incident_assets_insert ON incident_assets;
  CREATE TRIGGER trg_search_index_link_incident_assets_insert
  AFTER INSERT ON incident_assets
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION search_index_sync_link_incident_assets();

  DROP TRIGGER IF EXISTS trg_search_index_link_incident_assets_update ON incident_assets;
  CREATE TRIGGER trg_search_index_link_incident_assets_update
  AFTER UPDATE ON incident_assets
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION search_index_sync_link_incident_assets();

  DROP TRIGGER IF EXISTS trg_search_index_link_incident_assets_delete ON incident_assets;
  CREATE TRIGGER trg_search_index_link_incident_assets_delete
  AFTER DELETE ON incident_assets
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION search_index_sync_link_incident_assets();
`;

/**
 * A renamed asset refreshes every incident linked to it in one call: the ids are
 * gathered in one statement, never one refresh per incident. `AFTER UPDATE OF` already
 * limits the firing to the indexed columns; the IS DISTINCT test skips a no-op write.
 */
const ASSET_SYNC_FUNCTION = `
  CREATE OR REPLACE FUNCTION search_index_sync_incident_assets_on_asset()
  RETURNS trigger AS $fn$
  DECLARE
    k_incidents uuid[];
  BEGIN
    IF NEW.name IS NOT DISTINCT FROM OLD.name
       AND NEW.hostname IS NOT DISTINCT FROM OLD.hostname
       AND NEW.fqdn IS NOT DISTINCT FROM OLD.fqdn THEN
      RETURN NULL;
    END IF;

    SELECT array_agg(DISTINCT ia.incident_id)
      INTO k_incidents
    FROM incident_assets ia
    WHERE ia.tenant_id = NEW.tenant_id
      AND ia.asset_id = NEW.id;

    IF k_incidents IS NOT NULL THEN
      PERFORM search_index_refresh_incidents(NEW.tenant_id, k_incidents);
    END IF;
    RETURN NULL;
  END
  $fn$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
`;

const ASSET_TRIGGER = `
  DROP TRIGGER IF EXISTS trg_search_index_incident_assets_on_asset ON assets;
  CREATE TRIGGER trg_search_index_incident_assets_on_asset
  AFTER UPDATE OF name, hostname, fqdn ON assets
  FOR EACH ROW
  EXECUTE FUNCTION search_index_sync_incident_assets_on_asset();
`;

/**
 * Every tenant's incidents reindexed with its `app.current_tenant` (every table read or
 * written here is FORCE RLS), in one DO block. `set_config(..., true)` is
 * transaction-local: splitting the loop into separate statements would lose the setting
 * when the migration runs outside a transaction, and a global statement would touch zero
 * rows. The counts are left in a temporary table for the caller to log.
 */
const COUNTS_TEMP_TABLE = 'pg_temp._incident_search_linked_assets_counts';

const REINDEX_ALL_TENANTS = `
  DO $do$
  DECLARE
    t RECORD;
    k_before text := current_setting('app.current_tenant', true);
    k_tenants int := 0;
    k_incidents int := 0;
    k_links int := 0;
    k_entries int := 0;
    k_count int;
  BEGIN
    FOR t IN SELECT id FROM tenants ORDER BY created_at ASC, id ASC LOOP
      k_tenants := k_tenants + 1;
      PERFORM set_config('app.current_tenant', t.id::text, true);

      SELECT count(*) INTO k_count FROM incidents WHERE tenant_id = t.id;
      k_incidents := k_incidents + k_count;

      SELECT count(*) INTO k_count FROM incident_assets WHERE tenant_id = t.id;
      k_links := k_links + k_count;

      PERFORM search_index_refresh_incidents(t.id);

      SELECT count(*) INTO k_count FROM search_index
       WHERE tenant_id = t.id AND entity_type = 'incidents';
      k_entries := k_entries + k_count;
    END LOOP;

    PERFORM set_config('app.current_tenant', coalesce(k_before, ''), true);
    INSERT INTO ${COUNTS_TEMP_TABLE} (tenants, incidents, links, entries)
    VALUES (k_tenants, k_incidents, k_links, k_entries);
  END
  $do$;
`;

async function reindexTenants(queryRunner: QueryRunner): Promise<{
  tenants: number;
  incidents: number;
  links: number;
  entries: number;
  ms: number;
}> {
  const started = Date.now();
  await queryRunner.query(`DROP TABLE IF EXISTS ${COUNTS_TEMP_TABLE}`);
  await queryRunner.query(`
    CREATE TEMP TABLE ${COUNTS_TEMP_TABLE} (
      tenants int NOT NULL,
      incidents int NOT NULL,
      links int NOT NULL,
      entries int NOT NULL
    )
  `);
  try {
    await queryRunner.query(REINDEX_ALL_TENANTS);
    const [counts] = await queryRunner.query(
      `SELECT tenants, incidents, links, entries FROM ${COUNTS_TEMP_TABLE}`,
    );
    return {
      tenants: Number(counts?.tenants ?? 0),
      incidents: Number(counts?.incidents ?? 0),
      links: Number(counts?.links ?? 0),
      entries: Number(counts?.entries ?? 0),
      ms: Date.now() - started,
    };
  } finally {
    await queryRunner.query(`DROP TABLE IF EXISTS ${COUNTS_TEMP_TABLE}`);
  }
}

export class IncidentSearchLinkedAssets1855300000000 implements MigrationInterface {
  name = 'IncidentSearchLinkedAssets1855300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(INCIDENTS_REFRESH_WITH_ASSETS);
    await queryRunner.query(INCIDENT_ASSETS_SYNC_FUNCTION);
    await queryRunner.query(ASSET_SYNC_FUNCTION);
    await queryRunner.query(INCIDENT_ASSETS_TRIGGERS);
    await queryRunner.query(ASSET_TRIGGER);

    const counts = await reindexTenants(queryRunner);
    console.log(
      `${LOG_PREFIX} linked asset names indexed on incidents; 4 triggers ready; `
      + `${counts.incidents} incident(s) and ${counts.links} link(s) in ${counts.tenants} tenant(s) reindexed, `
      + `${counts.entries} search entr${counts.entries === 1 ? 'y' : 'ies'} in ${counts.ms} ms`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_search_index_incident_assets_on_asset ON assets`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS search_index_sync_incident_assets_on_asset()`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_search_index_link_incident_assets_insert ON incident_assets`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_search_index_link_incident_assets_update ON incident_assets`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_search_index_link_incident_assets_delete ON incident_assets`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS search_index_sync_link_incident_assets()`);
    await queryRunner.query(INCIDENTS_REFRESH_WITHOUT_ASSETS);

    const counts = await reindexTenants(queryRunner);
    console.log(
      `${LOG_PREFIX} linked asset names removed from the incident entries; `
      + `${counts.incidents} incident(s) in ${counts.tenants} tenant(s) reindexed in ${counts.ms} ms`,
    );
  }
}
