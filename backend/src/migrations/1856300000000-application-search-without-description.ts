import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Applications: the search entry no longer carries the description (decision P14 of 26.12.1). The
 * description is the text of the application's overview document, indexed under its own name
 * ("APP-4 - Name - Overview") as every document, as a project's purpose has always been; the column
 * `applications.description` is its seed only, and an edit of the document on the page leaves it
 * behind. The entry keeps the reference, the name, the classification, the publisher, the notes, the
 * supplier and the owners. The search reads the description from the document when it shows an
 * application (`AiEntityService.runSearchIndexQuery`).
 *
 * The function is defined again, SECURITY DEFINER with its search_path pinned as every search index
 * function (1854500000000), then the entries are refreshed tenant by tenant (search_index is under
 * FORCE RLS), as 1856180000000 does. The triggers name no column of the description: they stay.
 *
 * Idempotent: CREATE OR REPLACE and a refresh. down() gives back the body of 1853000000000 and
 * refreshes again.
 */
export class ApplicationSearchWithoutDescription1856300000000 implements MigrationInterface {
  name = 'ApplicationSearchWithoutDescription1856300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(refreshFunction(false));
    await refreshAllTenants(queryRunner, 'the description left the application search entries');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(refreshFunction(true));
    await refreshAllTenants(queryRunner, 'the description back in the application search entries');
  }
}

/** The names of the application's owners of one type, joined by `separator`. */
function owners(type: 'business' | 'it', separator: string): string {
  return `(
    SELECT string_agg(name, '${separator}' ORDER BY name)
    FROM (
      SELECT DISTINCT COALESCE(NULLIF(TRIM(CONCAT(u_owner.first_name, ' ', u_owner.last_name)), ''), u_owner.email) AS name
      FROM application_owners ao
      JOIN users u_owner ON u_owner.id = ao.user_id AND u_owner.tenant_id = a.tenant_id
      WHERE ao.application_id = a.id
        AND ao.tenant_id = a.tenant_id
        AND ao.owner_type = '${type}'
    ) owner
  )`;
}

/** The search entry of an application, with its description (`withDescription`, before P14) or without. */
function refreshFunction(withDescription: boolean): string {
  return `
  CREATE OR REPLACE FUNCTION search_index_refresh_applications(p_tenant uuid, p_ids uuid[] DEFAULT NULL)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $fn$
    DELETE FROM search_index si_del
    WHERE si_del.tenant_id = p_tenant
      AND si_del.entity_type = 'applications'
      AND (p_ids IS NULL OR si_del.entity_id = ANY(p_ids))
      AND NOT EXISTS (
        SELECT 1 FROM applications src
        WHERE src.id = si_del.entity_id AND src.tenant_id = p_tenant
      );
    INSERT INTO search_index (
      tenant_id, entity_type, entity_id, ref_prefix, ref_number,
      label, summary, status, extra_json, search_vector, source_updated_at, indexed_at
    )
    SELECT a.tenant_id,
           'applications',
           a.id,
           CASE WHEN a.sequential_id ~* '^APP-[0-9]+$' THEN 'APP' ELSE NULL END,
           CASE WHEN a.sequential_id ~* '^APP-[0-9]+$' THEN NULLIF(regexp_replace(a.sequential_id, '^APP-', '', 'i'), '')::int ELSE NULL END,
           a.name,
           ${withDescription ? 'a.description' : 'NULL'},
           a.status::text,
           jsonb_build_object(
             'item_ref', a.sequential_id,
             'lifecycle', a.lifecycle,
             'criticality', a.criticality,
             'category', a.category,
             'hosting_model', a.hosting_model,
             'data_class', a.data_class,
             'version', a.version,
             'supplier', s.name,
             'business_owner', NULLIF(${owners('business', ', ')}, ''),
             'it_owner', NULLIF(${owners('it', ', ')}, '')
           ),
           search_index_tsv('A', CONCAT_WS(' ', a.sequential_id, a.name))
             || search_index_tsv('B', CONCAT_WS(' ', a.category, a.lifecycle, a.criticality, a.status::text, a.data_class, a.hosting_model, a.version, a.licensing))
             || search_index_tsv('C', CONCAT_WS(' ', ${withDescription ? 'a.description, ' : ''}a.editor, a.notes, a.support_notes, s.name, ${owners('business', ' ')}, ${owners('it', ' ')})),
           a.updated_at,
           now()
    FROM applications a
    LEFT JOIN suppliers s ON s.id = a.supplier_id AND s.tenant_id = a.tenant_id
    WHERE a.tenant_id = p_tenant
      AND (p_ids IS NULL OR a.id = ANY(p_ids))
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

/**
 * Refreshes every tenant's application entries, each under its own tenant setting (FORCE RLS), then
 * gives the next migration of the run the setting it had; logs how many tenants and entries.
 */
async function refreshAllTenants(queryRunner: QueryRunner, what: string): Promise<void> {
  const [{ previous }] = await queryRunner.query(`SELECT current_setting('app.current_tenant', true) AS previous`);
  const tenants: Array<{ id: string }> = await queryRunner.query(`SELECT id FROM tenants ORDER BY created_at ASC, id ASC`);
  let entries = 0;
  let withSummary = 0;
  for (const tenant of tenants) {
    await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant.id]);
    const [before] = await queryRunner.query(
      `SELECT count(*) FILTER (WHERE summary IS NOT NULL)::int AS n FROM search_index WHERE tenant_id = $1 AND entity_type = 'applications'`,
      [tenant.id],
    );
    withSummary += before?.n ?? 0;
    await queryRunner.query(`SELECT search_index_refresh_applications($1)`, [tenant.id]);
    const [after] = await queryRunner.query(
      `SELECT count(*)::int AS n FROM search_index WHERE tenant_id = $1 AND entity_type = 'applications'`,
      [tenant.id],
    );
    entries += after?.n ?? 0;
  }
  await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [previous ?? '']);
  console.log(`[1856300000000] applications: ${what}; ${tenants.length} tenants, ${entries} entries refreshed (${withSummary} carried a summary before)`);
}
