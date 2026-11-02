import { MigrationInterface, QueryRunner } from 'typeorm';

const LOG_PREFIX = '[Migration] IncidentSearchLinkedApplicationsTechnologies:';

/**
 * Global search finds an incident by the name and reference of its linked
 * applications (`APP-n`) and technologies (`TEC-n`), the same way
 * 1855300000000 finds it by a linked asset. The text stays at weight C, next
 * to the asset text, so a result still names the incident (title and `INC-n`).
 *
 * 1. `search_index_refresh_incidents` keeps the linked-asset text and adds one
 *    correlated `string_agg` for applications (name, `sequential_id`) and one
 *    for technologies (name, `TEC-` || item_number). Both tenants are pinned;
 *    no row is duplicated.
 * 2. Freshness, the same shape as the asset triggers:
 *    - `incident_applications` and `incident_technologies` INSERT / UPDATE /
 *      DELETE: statement triggers with transition tables, one refresh call per
 *      tenant with the distinct incident ids of the statement.
 *    - `applications` UPDATE OF name, sequential_id and `technologies` UPDATE
 *      OF name, item_number: one row trigger, one refresh call with every
 *      incident linked to that record. A no-op write is skipped.
 *    The trigger functions are SECURITY DEFINER with search_path pinned: they
 *    maintain `search_index`, derived from tenant rows.
 * 3. Initial reindex per tenant with `app.current_tenant` set. Every table this
 *    function reads or writes is FORCE RLS, so a global statement would touch
 *    zero rows. Counts and duration are logged.
 *
 * Idempotent: functions are created or replaced, triggers dropped and created,
 * and the reindex rewrites the same entries. down() restores the
 * 1855300000000 body (assets only), drops these triggers and functions, and
 * reindexes so the entries lose the application and technology text.
 *
 * Consequence for later migrations: writing `applications.name`,
 * `applications.sequential_id`, `technologies.name`, `technologies.item_number`,
 * `incident_applications` or `incident_technologies` fires these triggers,
 * which write `search_index`. Such a migration runs per tenant with
 * `app.current_tenant` set, or disables the trigger around a global repair.
 *
 * A renamed application or technology holds its own row, then its search entry,
 * before these triggers touch the incident entries. A transaction that already
 * holds an incident entry and then updates the application or technology can
 * wait the other way. The asset trigger of 1855300000000 has the same shape.
 * Review both lock orders together if either path changes.
 */

/** Linked assets of the incident, as one text for weight C. NULL when it has none. */
const INCIDENT_ASSET_TEXT = `(
        SELECT string_agg(CONCAT_WS(' ', a.name, a.asset_reference, a.hostname, a.fqdn), ' ' ORDER BY a.id)
        FROM incident_assets ia
        JOIN assets a
          ON a.id = ia.asset_id
         AND a.tenant_id = ia.tenant_id
        WHERE ia.tenant_id = i.tenant_id
          AND ia.incident_id = i.id
      )`;

/** Linked applications: name and APP-n. NULL when the incident has none. */
const INCIDENT_APPLICATION_TEXT = `(
        SELECT string_agg(CONCAT_WS(' ', app.name, app.sequential_id), ' ' ORDER BY app.id)
        FROM incident_applications iap
        JOIN applications app
          ON app.id = iap.application_id
         AND app.tenant_id = iap.tenant_id
        WHERE iap.tenant_id = i.tenant_id
          AND iap.incident_id = i.id
      )`;

/** Linked technologies: name and TEC-n. NULL when the incident has none. */
const INCIDENT_TECHNOLOGY_TEXT = `(
        SELECT string_agg(CONCAT_WS(' ', tec.name, 'TEC-' || tec.item_number::text), ' ' ORDER BY tec.id)
        FROM incident_technologies it
        JOIN technologies tec
          ON tec.id = it.technology_id
         AND tec.tenant_id = it.tenant_id
        WHERE it.tenant_id = i.tenant_id
          AND it.incident_id = i.id
      )`;

const LINKED_RECORD_TEXT = `${INCIDENT_ASSET_TEXT}, ${INCIDENT_APPLICATION_TEXT}, ${INCIDENT_TECHNOLOGY_TEXT}`;

function refreshSql(weightC: string): string {
  return `
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
             || search_index_tsv('C', CONCAT_WS(' ', i.source_ref, d.content_plain, ${weightC})),
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
}

/**
 * One refresh call per tenant and statement. The transition tables exist for one
 * statement only; UPDATE refreshes both the old and the new incident (a moved link).
 * The same body serves both link tables: each trigger names its own transition
 * tables, and both tables expose tenant_id and incident_id.
 */
function linkSyncFunction(functionName: string): string {
  return `
  CREATE OR REPLACE FUNCTION ${functionName}()
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
}

function linkTriggers(table: string, functionName: string): string {
  const trigger = `trg_search_index_link_${table}`;
  return `
  DROP TRIGGER IF EXISTS ${trigger}_insert ON ${table};
  CREATE TRIGGER ${trigger}_insert
  AFTER INSERT ON ${table}
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION ${functionName}();

  DROP TRIGGER IF EXISTS ${trigger}_update ON ${table};
  CREATE TRIGGER ${trigger}_update
  AFTER UPDATE ON ${table}
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION ${functionName}();

  DROP TRIGGER IF EXISTS ${trigger}_delete ON ${table};
  CREATE TRIGGER ${trigger}_delete
  AFTER DELETE ON ${table}
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION ${functionName}();
`;
}

/**
 * One row trigger: PostgreSQL refuses transition tables on a trigger with a
 * column list (`UPDATE OF`), and the column list keeps unrelated writes out.
 * A renamed record refreshes every incident linked to it in one call.
 */
function renameSyncFunction(spec: {
  functionName: string;
  unchanged: string;
  linkTable: string;
  foreignKey: string;
}): string {
  return `
  CREATE OR REPLACE FUNCTION ${spec.functionName}()
  RETURNS trigger AS $fn$
  DECLARE
    k_incidents uuid[];
  BEGIN
    IF ${spec.unchanged} THEN
      RETURN NULL;
    END IF;

    SELECT array_agg(DISTINCT link.incident_id)
      INTO k_incidents
    FROM ${spec.linkTable} link
    WHERE link.tenant_id = NEW.tenant_id
      AND link.${spec.foreignKey} = NEW.id;

    IF k_incidents IS NOT NULL THEN
      PERFORM search_index_refresh_incidents(NEW.tenant_id, k_incidents);
    END IF;
    RETURN NULL;
  END
  $fn$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
`;
}

function renameTrigger(table: string, triggerName: string, columns: string, functionName: string): string {
  return `
  DROP TRIGGER IF EXISTS ${triggerName} ON ${table};
  CREATE TRIGGER ${triggerName}
  AFTER UPDATE OF ${columns} ON ${table}
  FOR EACH ROW
  EXECUTE FUNCTION ${functionName}();
`;
}

const APPLICATION_LINK_FUNCTION = 'search_index_sync_link_incident_applications';
const TECHNOLOGY_LINK_FUNCTION = 'search_index_sync_link_incident_technologies';
const APPLICATION_RENAME_FUNCTION = 'search_index_sync_incident_applications_on_application';
const TECHNOLOGY_RENAME_FUNCTION = 'search_index_sync_incident_technologies_on_technology';
const APPLICATION_RENAME_TRIGGER = 'trg_search_index_incident_applications_on_application';
const TECHNOLOGY_RENAME_TRIGGER = 'trg_search_index_incident_technologies_on_technology';

const COUNTS_TEMP_TABLE = 'pg_temp._incident_search_linked_catalog_counts';

const REINDEX_ALL_TENANTS = `
  DO $do$
  DECLARE
    t RECORD;
    k_before text := current_setting('app.current_tenant', true);
    k_tenants int := 0;
    k_incidents int := 0;
    k_application_links int := 0;
    k_technology_links int := 0;
    k_entries int := 0;
    k_count int;
  BEGIN
    FOR t IN SELECT id FROM tenants ORDER BY created_at ASC, id ASC LOOP
      k_tenants := k_tenants + 1;
      PERFORM set_config('app.current_tenant', t.id::text, true);

      SELECT count(*) INTO k_count FROM incidents WHERE tenant_id = t.id;
      k_incidents := k_incidents + k_count;

      SELECT count(*) INTO k_count FROM incident_applications WHERE tenant_id = t.id;
      k_application_links := k_application_links + k_count;

      SELECT count(*) INTO k_count FROM incident_technologies WHERE tenant_id = t.id;
      k_technology_links := k_technology_links + k_count;

      PERFORM search_index_refresh_incidents(t.id);

      SELECT count(*) INTO k_count FROM search_index
       WHERE tenant_id = t.id AND entity_type = 'incidents';
      k_entries := k_entries + k_count;
    END LOOP;

    PERFORM set_config('app.current_tenant', coalesce(k_before, ''), true);
    INSERT INTO ${COUNTS_TEMP_TABLE}
      (tenants, incidents, application_links, technology_links, entries)
    VALUES (k_tenants, k_incidents, k_application_links, k_technology_links, k_entries);
  END
  $do$;
`;

async function reindexTenants(queryRunner: QueryRunner): Promise<{
  tenants: number;
  incidents: number;
  applicationLinks: number;
  technologyLinks: number;
  entries: number;
  ms: number;
}> {
  const started = Date.now();
  await queryRunner.query(`DROP TABLE IF EXISTS ${COUNTS_TEMP_TABLE}`);
  await queryRunner.query(`
    CREATE TEMP TABLE ${COUNTS_TEMP_TABLE} (
      tenants int NOT NULL,
      incidents int NOT NULL,
      application_links int NOT NULL,
      technology_links int NOT NULL,
      entries int NOT NULL
    )
  `);
  try {
    await queryRunner.query(REINDEX_ALL_TENANTS);
    const [counts] = await queryRunner.query(
      `SELECT tenants, incidents, application_links, technology_links, entries FROM ${COUNTS_TEMP_TABLE}`,
    );
    return {
      tenants: Number(counts?.tenants ?? 0),
      incidents: Number(counts?.incidents ?? 0),
      applicationLinks: Number(counts?.application_links ?? 0),
      technologyLinks: Number(counts?.technology_links ?? 0),
      entries: Number(counts?.entries ?? 0),
      ms: Date.now() - started,
    };
  } finally {
    await queryRunner.query(`DROP TABLE IF EXISTS ${COUNTS_TEMP_TABLE}`);
  }
}

export class IncidentSearchLinkedApplicationsTechnologies1856030000000 implements MigrationInterface {
  name = 'IncidentSearchLinkedApplicationsTechnologies1856030000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(refreshSql(LINKED_RECORD_TEXT));
    await queryRunner.query(linkSyncFunction(APPLICATION_LINK_FUNCTION));
    await queryRunner.query(linkSyncFunction(TECHNOLOGY_LINK_FUNCTION));
    await queryRunner.query(renameSyncFunction({
      functionName: APPLICATION_RENAME_FUNCTION,
      unchanged: `NEW.name IS NOT DISTINCT FROM OLD.name
       AND NEW.sequential_id IS NOT DISTINCT FROM OLD.sequential_id`,
      linkTable: 'incident_applications',
      foreignKey: 'application_id',
    }));
    await queryRunner.query(renameSyncFunction({
      functionName: TECHNOLOGY_RENAME_FUNCTION,
      unchanged: `NEW.name IS NOT DISTINCT FROM OLD.name
       AND NEW.item_number IS NOT DISTINCT FROM OLD.item_number`,
      linkTable: 'incident_technologies',
      foreignKey: 'technology_id',
    }));
    await queryRunner.query(linkTriggers('incident_applications', APPLICATION_LINK_FUNCTION));
    await queryRunner.query(linkTriggers('incident_technologies', TECHNOLOGY_LINK_FUNCTION));
    await queryRunner.query(renameTrigger(
      'applications',
      APPLICATION_RENAME_TRIGGER,
      'name, sequential_id',
      APPLICATION_RENAME_FUNCTION,
    ));
    await queryRunner.query(renameTrigger(
      'technologies',
      TECHNOLOGY_RENAME_TRIGGER,
      'name, item_number',
      TECHNOLOGY_RENAME_FUNCTION,
    ));

    const counts = await reindexTenants(queryRunner);
    console.log(
      `${LOG_PREFIX} linked application and technology names indexed on incidents; 8 triggers ready; `
      + `${counts.incidents} incident(s), ${counts.applicationLinks} application link(s) and `
      + `${counts.technologyLinks} technology link(s) in ${counts.tenants} tenant(s) reindexed, `
      + `${counts.entries} search entr${counts.entries === 1 ? 'y' : 'ies'} in ${counts.ms} ms`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS ${APPLICATION_RENAME_TRIGGER} ON applications`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS ${APPLICATION_RENAME_FUNCTION}()`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS ${TECHNOLOGY_RENAME_TRIGGER} ON technologies`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS ${TECHNOLOGY_RENAME_FUNCTION}()`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_search_index_link_incident_applications_insert ON incident_applications`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_search_index_link_incident_applications_update ON incident_applications`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_search_index_link_incident_applications_delete ON incident_applications`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS ${APPLICATION_LINK_FUNCTION}()`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_search_index_link_incident_technologies_insert ON incident_technologies`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_search_index_link_incident_technologies_update ON incident_technologies`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_search_index_link_incident_technologies_delete ON incident_technologies`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS ${TECHNOLOGY_LINK_FUNCTION}()`);
    await queryRunner.query(refreshSql(INCIDENT_ASSET_TEXT));

    const counts = await reindexTenants(queryRunner);
    console.log(
      `${LOG_PREFIX} incident entries reindexed with the linked asset text only; `
      + `${counts.incidents} incident(s) in ${counts.tenants} tenant(s) in ${counts.ms} ms`,
    );
  }
}
