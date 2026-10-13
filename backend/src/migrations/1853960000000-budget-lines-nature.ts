import { MigrationInterface, QueryRunner } from 'typeorm';

const LOG_PREFIX = '[Migration] BudgetLinesNature:';

/**
 * Pinned on the functions that had it (1853850000000, 1853940000000; rules in doc/architecture.md,
 * "Budget statement triggers and stale statistics"). The refresh functions of a line type, the line
 * trigger function and the analytics helper never had it and keep none: the helper stays inlinable
 * and the PL/pgSQL refresh functions keep each path's plan for the session (1853940000000).
 */
const FUNCTION_SETTINGS = 'SET search_path = public, pg_temp SET plan_cache_mode = force_custom_plan';

/** The CAPEX columns `spend_items` takes, nullable, on the existing enum types (until lot C1). */
const CAPEX_COLUMNS = [
  { name: 'ppe_type', type: 'ppe_type' },
  { name: 'investment_type', type: 'capex_investment_type' },
  { name: 'priority', type: 'priority_level' },
] as const;

/**
 * The three `ON DELETE RESTRICT` keys of the dormant `capex_*` tables (G.10): once the lines live in
 * `spend_*`, a cost center, an analytics value or a calendar only a dormant row still names would
 * be "free" for the application and refused by the database. down() puts them back.
 */
export const DORMANT_RESTRICT_KEYS = [
  {
    table: 'capex_items',
    name: 'capex_items_cost_center_fk',
    definition: 'FOREIGN KEY (tenant_id, cost_center_id) REFERENCES cost_centers(tenant_id, id) ON DELETE RESTRICT',
  },
  {
    table: 'capex_item_analytics_values',
    name: 'capex_item_analytics_values_category_fk',
    definition: 'FOREIGN KEY (tenant_id, category_id, axis_id) REFERENCES analytics_categories(tenant_id, id, axis_id) ON DELETE RESTRICT',
  },
  {
    table: 'capex_round_input_lines',
    name: 'capex_round_input_lines_working_day_profile_fk',
    definition: 'FOREIGN KEY (tenant_id, working_day_profile_id) REFERENCES working_day_profiles(tenant_id, id) ON DELETE RESTRICT',
  },
] as const;

/** The search triggers of the dormant tables (G.10): a cascade on a dormant row would bring back a stale entry. */
const DORMANT_SEARCH_TRIGGERS = [
  { table: 'capex_items', name: 'trg_search_index_capex_items' },
  { table: 'capex_item_analytics_values', name: 'capex_item_analytics_values_search_index_insert' },
  { table: 'capex_item_analytics_values', name: 'capex_item_analytics_values_search_index_update' },
  { table: 'capex_item_analytics_values', name: 'capex_item_analytics_values_search_index_delete' },
] as const;
const DORMANT_SEARCH_FUNCTIONS = ['search_index_sync_capex_items()', 'capex_item_analytics_values_search_index()'] as const;

/* ---- Shared parts of the line entries (1853940000000) ---- */

const AXIS_ORDER = `a.sort_order, lower(coalesce(a.name, '')), a.code, a.id`;
const ANALYTICS_EXTRA = `CASE WHEN la.analytics_display IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('analytics', la.analytics_display) END`;
const ANALYTICS_VECTOR = `search_index_tsv('B', la.analytics_text)`;
const UPSERT = `ON CONFLICT (tenant_id, entity_type, entity_id) DO UPDATE SET
        ref_prefix = EXCLUDED.ref_prefix,
        ref_number = EXCLUDED.ref_number,
        label = EXCLUDED.label,
        summary = EXCLUDED.summary,
        status = EXCLUDED.status,
        extra_json = EXCLUDED.extra_json,
        search_vector = EXCLUDED.search_vector,
        source_updated_at = EXCLUDED.source_updated_at,
        indexed_at = EXCLUDED.indexed_at`;

/**
 * The CAPEX number of a line of `spend_items` (its legacy `CPX-n`), the number the CAPEX entry, the
 * CAPEX API and the old screens show; the line's own number when it has none (never the case for a
 * line moved or created as CAPEX).
 */
const CPX_NUMBER = (alias: string) => `COALESCE((substring(${alias}.legacy_number FROM '^CPX-([0-9]+)$'))::int, ${alias}.item_number)`;

/**
 * `search_index_line_analytics` on the one table of values (lot Z1): the values of the line, on the
 * enabled dimensions that apply to `p_scope`, the line's nature. One SELECT, STABLE, not STRICT, no
 * SET clause: still inlined by the planner (1853940000000).
 */
const LINE_ANALYTICS_SQL = `
  CREATE OR REPLACE FUNCTION search_index_line_analytics(p_tenant uuid, p_scope text, p_item_id uuid)
  RETURNS TABLE (analytics_text text, analytics_display text)
  LANGUAGE sql STABLE AS $fn$
    SELECT string_agg(c.name, ' ' ORDER BY ${AXIS_ORDER}),
           string_agg(COALESCE(NULLIF(btrim(a.name), ''), 'Analytics dimension') || ': ' || c.name, '; ' ORDER BY ${AXIS_ORDER})
      FROM spend_item_analytics_values v
      JOIN analytics_axes a ON a.id = v.axis_id AND a.tenant_id = p_tenant
      JOIN analytics_categories c ON c.id = v.category_id AND c.tenant_id = p_tenant
     WHERE v.tenant_id = p_tenant AND v.item_id = p_item_id
       AND a.status <> 'disabled'
       AND (a.disabled_at IS NULL OR a.disabled_at > now())
       AND (a.applies_to IS NULL OR a.applies_to = p_scope)
  $fn$
`;

/** 1853940000000's body (down()). */
const LINE_ANALYTICS_PREVIOUS = `
  CREATE OR REPLACE FUNCTION search_index_line_analytics(p_tenant uuid, p_scope text, p_item_id uuid)
  RETURNS TABLE (analytics_text text, analytics_display text)
  LANGUAGE sql STABLE AS $fn$
    SELECT string_agg(c.name, ' ' ORDER BY ${AXIS_ORDER}),
           string_agg(COALESCE(NULLIF(btrim(a.name), ''), 'Analytics dimension') || ': ' || c.name, '; ' ORDER BY ${AXIS_ORDER})
      FROM (SELECT v.axis_id, v.category_id FROM spend_item_analytics_values v
             WHERE p_scope = 'opex' AND v.tenant_id = p_tenant AND v.item_id = p_item_id
            UNION ALL
            SELECT v.axis_id, v.category_id FROM capex_item_analytics_values v
             WHERE p_scope = 'capex' AND v.tenant_id = p_tenant AND v.item_id = p_item_id) v
      JOIN analytics_axes a ON a.id = v.axis_id AND a.tenant_id = p_tenant
      JOIN analytics_categories c ON c.id = v.category_id AND c.tenant_id = p_tenant
     WHERE a.status <> 'disabled'
       AND (a.disabled_at IS NULL OR a.disabled_at > now())
       AND (a.applies_to IS NULL OR a.applies_to = p_scope)
  $fn$
`;

/**
 * A refresh function of one line type (1853940000000's two paths): the purge of the entries whose
 * line is gone (or, with `lineWhere`, no longer of the type), then the upsert of the lines.
 */
function refreshFunctionSql(type: 'capex_items', table: string, lineWhere: string, alias: string, select: string, from: string): string {
  const byIds = (ids: boolean, column: string) => (ids ? `\n           AND ${column} = ANY (p_ids)` : '');
  const purge = (ids: boolean) => `DELETE FROM search_index si_del
         WHERE si_del.tenant_id = p_tenant
           AND si_del.entity_type = '${type}'${byIds(ids, 'si_del.entity_id')}
           AND NOT EXISTS (
             SELECT 1 FROM ${table} src
             WHERE src.id = si_del.entity_id AND src.tenant_id = p_tenant${lineWhere ? ` AND src.${lineWhere}` : ''}
           );`;
  const upsert = (ids: boolean) => `INSERT INTO search_index (
          tenant_id, entity_type, entity_id, ref_prefix, ref_number,
          label, summary, status, extra_json, search_vector, source_updated_at, indexed_at
        )
        ${select}
        ${from}
         WHERE ${alias}.tenant_id = p_tenant${lineWhere ? ` AND ${alias}.${lineWhere}` : ''}${byIds(ids, `${alias}.id`)}
        ${UPSERT};`;
  return `
    CREATE OR REPLACE FUNCTION search_index_refresh_${type}(p_tenant uuid, p_ids uuid[] DEFAULT NULL)
    RETURNS void LANGUAGE plpgsql AS $fn$
    BEGIN
      IF p_ids IS NULL THEN
        ${purge(false)}
        ${upsert(false)}
      ELSE
        ${purge(true)}
        ${upsert(true)}
      END IF;
    END
    $fn$
  `;
}

/**
 * The CAPEX line entry read from `spend_items` (lot Z1): type `capex_items`, the same columns as
 * 1853940000000's, the line's title in `product_name`, its legacy CPX number as the reference.
 */
const CAPEX_REFRESH = refreshFunctionSql('capex_items', 'spend_items', `nature = 'capex'`, 'ci', `SELECT ci.tenant_id,
             'capex_items',
             ci.id,
             'CPX',
             ${CPX_NUMBER('ci')},
             ci.product_name,
             NULLIF(CONCAT_WS(' | ', comp.name, sup.name, ci.ppe_type::text, ci.investment_type), ''),
             ci.status::text,
             jsonb_build_object('paying_company', comp.name, 'supplier', sup.name) || ${ANALYTICS_EXTRA},
             search_index_tsv('A', CONCAT_WS(' ', 'CPX-' || ${CPX_NUMBER('ci')}::text, ci.product_name))
               || search_index_tsv('B', CONCAT_WS(' ', ci.ppe_type::text, ci.investment_type, ci.priority, ci.currency))
               || ${ANALYTICS_VECTOR}
               || search_index_tsv('C', CONCAT_WS(' ', ci.notes, comp.name, sup.name)),
             ci.updated_at,
             now()`, `FROM spend_items ci
        LEFT JOIN companies comp ON comp.id = ci.paying_company_id AND comp.tenant_id = ci.tenant_id
        LEFT JOIN suppliers sup ON sup.id = ci.supplier_id AND sup.tenant_id = ci.tenant_id
        LEFT JOIN LATERAL search_index_line_analytics(ci.tenant_id, 'capex', ci.id) la ON true`);

/** 1853940000000's CAPEX body, on `capex_items` (down()). */
const CAPEX_REFRESH_PREVIOUS = refreshFunctionSql('capex_items', 'capex_items', '', 'ci', `SELECT ci.tenant_id,
             'capex_items',
             ci.id,
             'CPX',
             ci.item_number,
             ci.description,
             NULLIF(CONCAT_WS(' | ', comp.name, sup.name, ci.ppe_type::text, ci.investment_type), ''),
             ci.status::text,
             jsonb_build_object('paying_company', comp.name, 'supplier', sup.name) || ${ANALYTICS_EXTRA},
             search_index_tsv('A', CONCAT_WS(' ', 'CPX-' || ci.item_number::text, ci.description))
               || search_index_tsv('B', CONCAT_WS(' ', ci.ppe_type::text, ci.investment_type, ci.priority, ci.currency))
               || ${ANALYTICS_VECTOR}
               || search_index_tsv('C', CONCAT_WS(' ', ci.notes, comp.name, sup.name)),
             ci.updated_at,
             now()`, `FROM capex_items ci
        LEFT JOIN companies comp ON comp.id = ci.paying_company_id AND comp.tenant_id = ci.tenant_id
        LEFT JOIN suppliers sup ON sup.id = ci.supplier_id AND sup.tenant_id = ci.tenant_id
        LEFT JOIN LATERAL search_index_line_analytics(ci.tenant_id, 'capex', ci.id) la ON true`);

/**
 * Refreshes given lines of one tenant (the trigger of the analytics values, 1853940000000): the
 * lines that still exist, each through the refresh of its nature. `p_scope` is the caller's type
 * and no longer decides: the one table of values holds both natures, and the trigger function of
 * `spend_item_analytics_values` passes `opex` for every line.
 */
const REFRESH_LINES_SQL = `
  CREATE OR REPLACE FUNCTION search_index_refresh_budget_lines(p_scope text, p_tenant uuid, p_items uuid[]) RETURNS void
  LANGUAGE plpgsql ${FUNCTION_SETTINGS} AS $fn$
  DECLARE
    k_opex uuid[];
    k_capex uuid[];
  BEGIN
    IF p_items IS NULL THEN
      RETURN;
    END IF;
    SELECT array_agg(l.id) FILTER (WHERE l.nature = 'opex'), array_agg(l.id) FILTER (WHERE l.nature = 'capex')
      INTO k_opex, k_capex
      FROM spend_items l
     WHERE l.id = ANY (p_items) AND l.tenant_id = p_tenant;
    IF k_opex IS NOT NULL THEN
      PERFORM search_index_refresh_spend_items(p_tenant, k_opex);
    END IF;
    IF k_capex IS NOT NULL THEN
      PERFORM search_index_refresh_capex_items(p_tenant, k_capex);
    END IF;
  END
  $fn$
`;

/** 1853940000000's body (down()). */
const REFRESH_LINES_PREVIOUS = `
  CREATE OR REPLACE FUNCTION search_index_refresh_budget_lines(p_scope text, p_tenant uuid, p_items uuid[]) RETURNS void
  LANGUAGE plpgsql ${FUNCTION_SETTINGS} AS $fn$
  DECLARE
    k_kept uuid[];
  BEGIN
    IF p_items IS NULL THEN
      RETURN;
    END IF;
    IF p_scope = 'opex' THEN
      SELECT array_agg(l.id) INTO k_kept
        FROM spend_items l
       WHERE l.id = ANY (p_items) AND l.tenant_id = p_tenant;
      IF k_kept IS NOT NULL THEN
        PERFORM search_index_refresh_spend_items(p_tenant, k_kept);
      END IF;
    ELSIF p_scope = 'capex' THEN
      SELECT array_agg(l.id) INTO k_kept
        FROM capex_items l
       WHERE l.id = ANY (p_items) AND l.tenant_id = p_tenant;
      IF k_kept IS NOT NULL THEN
        PERFORM search_index_refresh_capex_items(p_tenant, k_kept);
      END IF;
    END IF;
  END
  $fn$
`;

/**
 * The one line trigger of `spend_items` (lot Z1): the line's entry is of the type of its nature,
 * and the entry of the other type is removed (a line whose nature changes, lot M). An update that
 * changed `row_version` alone refreshes nothing (1853740000000).
 */
const SPEND_SYNC_SQL = `
    CREATE OR REPLACE FUNCTION search_index_sync_spend_items()
    RETURNS trigger AS $fn$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        PERFORM search_index_delete(OLD.tenant_id, 'spend_items', OLD.id);
        PERFORM search_index_delete(OLD.tenant_id, 'capex_items', OLD.id);
        RETURN OLD;
      END IF;
      IF TG_OP = 'UPDATE' THEN
        IF NEW.row_version IS DISTINCT FROM OLD.row_version
           AND (to_jsonb(NEW) - 'row_version') = (to_jsonb(OLD) - 'row_version') THEN
          RETURN NEW;
        END IF;
      END IF;
      IF NEW.nature = 'capex' THEN
        PERFORM search_index_delete(NEW.tenant_id, 'spend_items', NEW.id);
        PERFORM search_index_refresh_capex_items(NEW.tenant_id, ARRAY[NEW.id]);
      ELSE
        PERFORM search_index_delete(NEW.tenant_id, 'capex_items', NEW.id);
        PERFORM search_index_refresh_spend_items(NEW.tenant_id, ARRAY[NEW.id]);
      END IF;
      RETURN NEW;
    END
    $fn$ LANGUAGE plpgsql
  `;

/** 1853740000000's line trigger function of a line table (down()). */
function lineSyncPrevious(table: 'spend_items' | 'capex_items'): string {
  return `
    CREATE OR REPLACE FUNCTION search_index_sync_${table}()
    RETURNS trigger AS $fn$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        PERFORM search_index_delete(OLD.tenant_id, '${table}', OLD.id);
        RETURN OLD;
      END IF;
      IF TG_OP = 'UPDATE' THEN
        IF NEW.row_version IS DISTINCT FROM OLD.row_version
           AND (to_jsonb(NEW) - 'row_version') = (to_jsonb(OLD) - 'row_version') THEN
          RETURN NEW;
        END IF;
      END IF;
      PERFORM search_index_refresh_${table}(NEW.tenant_id, ARRAY[NEW.id]);
      RETURN NEW;
    END
    $fn$ LANGUAGE plpgsql
  `;
}

/** 1853940000000's statement trigger function of `capex_item_analytics_values` (down()). */
const CAPEX_VALUES_SEARCH_PREVIOUS = (() => {
  const changed = `SELECT s.tenant_id, s.item_id
            FROM (SELECT r.tenant_id, r.item_id, r.axis_id, r.category_id FROM new_rows r UNION ALL SELECT r.tenant_id, r.item_id, r.axis_id, r.category_id FROM old_rows r) s
           GROUP BY s.tenant_id, s.item_id, s.axis_id, s.category_id
          HAVING count(*) = 1`;
  const perTenant = (rows: string) => `FOR k_tenant, k_items IN
          SELECT x.tenant_id, array_agg(DISTINCT x.item_id)
            FROM (${rows}) x
           GROUP BY x.tenant_id
           ORDER BY x.tenant_id
        LOOP
          PERFORM search_index_refresh_budget_lines('capex', k_tenant, k_items);
        END LOOP;`;
  return `
    CREATE OR REPLACE FUNCTION capex_item_analytics_values_search_index() RETURNS trigger
    LANGUAGE plpgsql ${FUNCTION_SETTINGS} AS $fn$
    DECLARE
      k_tenant uuid;
      k_items uuid[];
    BEGIN
      IF TG_OP = 'INSERT' THEN
        ${perTenant('SELECT r.tenant_id, r.item_id FROM new_rows r')}
      ELSIF TG_OP = 'DELETE' THEN
        ${perTenant('SELECT r.tenant_id, r.item_id FROM old_rows r')}
      ELSE
        ${perTenant(changed)}
      END IF;
      RETURN NULL;
    END
    $fn$
  `;
})();

/** 1853940000000's triggers of the dormant tables (down()), with their transition tables. */
const DORMANT_TRIGGERS_PREVIOUS = [
  `CREATE TRIGGER trg_search_index_capex_items AFTER INSERT OR UPDATE OR DELETE ON capex_items FOR EACH ROW EXECUTE FUNCTION search_index_sync_capex_items()`,
  `CREATE TRIGGER capex_item_analytics_values_search_index_insert AFTER INSERT ON capex_item_analytics_values
     REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION capex_item_analytics_values_search_index()`,
  `CREATE TRIGGER capex_item_analytics_values_search_index_update AFTER UPDATE ON capex_item_analytics_values
     REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION capex_item_analytics_values_search_index()`,
  `CREATE TRIGGER capex_item_analytics_values_search_index_delete AFTER DELETE ON capex_item_analytics_values
     REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION capex_item_analytics_values_search_index()`,
];

/**
 * 1853470000000's task entry, with the two line joins given: the label of a task's line is its
 * title, read on the line of the nature its type names.
 */
function tasksRefreshSql(lineJoins: { opex: string; capex: string; capexLabel: string }): string {
  return `
  CREATE OR REPLACE FUNCTION search_index_refresh_tasks(p_tenant uuid, p_ids uuid[] DEFAULT NULL)
  RETURNS void AS $fn$
    DELETE FROM search_index si_del
    WHERE si_del.tenant_id = p_tenant
      AND si_del.entity_type = 'tasks'
      AND (p_ids IS NULL OR si_del.entity_id = ANY(p_ids))
      AND NOT EXISTS (
        SELECT 1 FROM tasks src
        WHERE src.id = si_del.entity_id AND src.tenant_id = p_tenant
      );
    INSERT INTO search_index (
      tenant_id, entity_type, entity_id, ref_prefix, ref_number,
      label, summary, status, extra_json, search_vector, source_updated_at, indexed_at
    )
    SELECT t.tenant_id,
           'tasks',
           t.id,
           'T',
           t.item_number,
           COALESCE(t.title, 'Untitled task'),
           t.description,
           t.status::text,
           jsonb_build_object(
      'assignee', NULLIF(COALESCE(NULLIF(TRIM(CONCAT(u_assign.first_name, ' ', u_assign.last_name)), ''), u_assign.email), ''),
      'creator', NULLIF(COALESCE(NULLIF(TRIM(CONCAT(u_creator.first_name, ' ', u_creator.last_name)), ''), u_creator.email), '')
    ),
           search_index_tsv('A', CONCAT_WS(' ', 'T-' || t.item_number::text, t.title))
             || search_index_tsv('B', CONCAT_WS(' ', t.status::text, t.priority_level, t.related_object_type, tt.name, pc.name, ps.name))
             || search_index_tsv('C', CONCAT_WS(' ', t.description, COALESCE(NULLIF(TRIM(CONCAT(u_assign.first_name, ' ', u_assign.last_name)), ''), u_assign.email), COALESCE(NULLIF(TRIM(CONCAT(u_creator.first_name, ' ', u_creator.last_name)), ''), u_creator.email), co.name, rel_proj.name, rel_si.product_name, rel_ct.name, ${lineJoins.capexLabel}, CASE WHEN rel_inc.confidential THEN NULL ELSE rel_inc.title END, (
        SELECT string_agg(lbl, ' ')
        FROM jsonb_array_elements_text(COALESCE(t.labels, '[]'::jsonb)) lbl
      ))),
           t.updated_at,
           now()
    FROM tasks t
    LEFT JOIN users u_assign ON u_assign.id = t.assignee_user_id AND u_assign.tenant_id = t.tenant_id
     LEFT JOIN users u_creator ON u_creator.id = t.creator_id AND u_creator.tenant_id = t.tenant_id
     LEFT JOIN portfolio_task_types tt ON tt.id = t.task_type_id AND tt.tenant_id = t.tenant_id
     LEFT JOIN companies co ON co.id = t.company_id AND co.tenant_id = t.tenant_id
     LEFT JOIN portfolio_categories pc ON pc.id = t.category_id AND pc.tenant_id = t.tenant_id
     LEFT JOIN portfolio_streams ps ON ps.id = t.stream_id AND ps.tenant_id = t.tenant_id
     LEFT JOIN portfolio_projects rel_proj ON rel_proj.id = t.related_object_id AND t.related_object_type = 'project' AND rel_proj.tenant_id = t.tenant_id
     ${lineJoins.opex}
     LEFT JOIN contracts rel_ct ON rel_ct.id = t.related_object_id AND t.related_object_type = 'contract' AND rel_ct.tenant_id = t.tenant_id
     ${lineJoins.capex}
     LEFT JOIN incidents rel_inc ON rel_inc.id = t.related_object_id AND t.related_object_type = 'incident' AND rel_inc.tenant_id = t.tenant_id
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
}

/** A task of type `spend_item` names an OPEX line, one of type `capex_item` a CAPEX line, both in `spend_items`. */
const TASKS_REFRESH = tasksRefreshSql({
  opex: `LEFT JOIN spend_items rel_si ON rel_si.id = t.related_object_id AND t.related_object_type = 'spend_item' AND rel_si.tenant_id = t.tenant_id AND rel_si.nature = 'opex'`,
  capex: `LEFT JOIN spend_items rel_cx ON rel_cx.id = t.related_object_id AND t.related_object_type = 'capex_item' AND rel_cx.tenant_id = t.tenant_id AND rel_cx.nature = 'capex'`,
  capexLabel: 'rel_cx.product_name',
});

/** 1853470000000's body (down()). */
const TASKS_REFRESH_PREVIOUS = tasksRefreshSql({
  opex: `LEFT JOIN spend_items rel_si ON rel_si.id = t.related_object_id AND t.related_object_type = 'spend_item' AND rel_si.tenant_id = t.tenant_id`,
  capex: `LEFT JOIN capex_items rel_cx ON rel_cx.id = t.related_object_id AND t.related_object_type = 'capex_item' AND rel_cx.tenant_id = t.tenant_id`,
  capexLabel: 'rel_cx.description',
});

/**
 * Every tenant's OPEX and CAPEX lines indexed again, one tenant at a time with its
 * app.current_tenant, the setting found put back afterwards (1853940000000).
 */
const REINDEX_LINES = `
  DO $do$
  DECLARE
    t RECORD;
    found_tenant text := current_setting('app.current_tenant', true);
  BEGIN
    FOR t IN SELECT id FROM tenants ORDER BY created_at ASC, id ASC LOOP
      PERFORM set_config('app.current_tenant', t.id::text, true);
      PERFORM search_index_refresh_spend_items(t.id);
      PERFORM search_index_refresh_capex_items(t.id);
    END LOOP;
    PERFORM set_config('app.current_tenant', coalesce(found_tenant, ''), true);
  END
  $do$
`;

/**
 * The single family of budget lines, schema part (plan planning/budget-unifie.md, lot Z1; the data
 * moves in 1853970000000, in the same transaction).
 *
 * 1. `spend_items.ppe_type`, `investment_type`, `priority`: nullable, on the existing enum types,
 *    without a "required when CAPEX" check (lot C1 turns them into dimensions, lot M moves lines
 *    between natures). The CAPEX API keeps them required.
 * 2. Search index, one line family, entity types per nature (`spend_items` OPX, `capex_items` CPX):
 *    - `search_index_refresh_capex_items` reads the lines of nature `capex` of `spend_items` (same
 *      columns as before; title `product_name`; reference: the legacy CPX number); its purge
 *      removes an entry whose line is gone or not CAPEX;
 *    - `search_index_line_analytics` reads the one table of values;
 *    - `search_index_refresh_budget_lines` refreshes each line given through its own nature;
 *    - `search_index_sync_spend_items`, the one line trigger, refreshes the entry of the line's
 *      nature and removes the other type's;
 *    - `search_index_refresh_tasks` reads a task's line in `spend_items`, of the nature its type
 *      names (`spend_item`: OPEX, `capex_item`: CAPEX).
 *    No reindex here: 1853970000000 reindexes once the lines are in.
 * 3. The dormant `capex_*` tables lose their three RESTRICT keys and their search triggers and
 *    functions (G.10). Their other triggers stay (they write the dormant rows only).
 *
 * Every step is idempotent (IF NOT EXISTS, CREATE OR REPLACE, DROP IF EXISTS). down() refuses while
 * a line of nature `capex` is in `spend_items` (1853970000000's down() moves them back first), then
 * puts back the previous function bodies, triggers and keys, reindexes, and drops the three columns.
 */
export class BudgetLinesNature1853960000000 implements MigrationInterface {
  name = 'BudgetLinesNature1853960000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const column of CAPEX_COLUMNS) {
      await queryRunner.query(`ALTER TABLE spend_items ADD COLUMN IF NOT EXISTS ${column.name} ${column.type}`);
    }
    // The helper first: the refresh function of CAPEX lines calls it.
    await queryRunner.query(LINE_ANALYTICS_SQL);
    await queryRunner.query(CAPEX_REFRESH);
    await queryRunner.query(REFRESH_LINES_SQL);
    await queryRunner.query(SPEND_SYNC_SQL);
    await queryRunner.query(TASKS_REFRESH);
    for (const trigger of DORMANT_SEARCH_TRIGGERS) {
      await queryRunner.query(`DROP TRIGGER IF EXISTS ${trigger.name} ON ${trigger.table}`);
    }
    for (const fn of DORMANT_SEARCH_FUNCTIONS) await queryRunner.query(`DROP FUNCTION IF EXISTS ${fn}`);
    for (const key of DORMANT_RESTRICT_KEYS) {
      await queryRunner.query(`ALTER TABLE ${key.table} DROP CONSTRAINT IF EXISTS ${key.name}`);
    }
    console.log(
      `${LOG_PREFIX} spend_items has ${CAPEX_COLUMNS.map((c) => c.name).join(', ')}; the search index reads both natures from spend_items; `
        + `the capex_* tables lost their search triggers and ${DORMANT_RESTRICT_KEYS.length} RESTRICT keys`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const capexLines = await withoutRowSecurity(queryRunner, ['spend_items'], async () => {
      const [{ n }]: Array<{ n: number }> = await queryRunner.query(`SELECT count(*)::int AS n FROM spend_items WHERE nature = 'capex'`);
      return n;
    });
    if (capexLines > 0) {
      throw new Error(
        `${LOG_PREFIX} ${capexLines} line(s) of nature capex are in spend_items; the CAPEX search entries and columns cannot go before them. `
          + 'Revert 1853970000000 (BudgetLinesMerge) first: its down() moves them back to the capex_* tables.',
      );
    }
    for (const key of DORMANT_RESTRICT_KEYS) {
      const [existing] = await queryRunner.query(
        `SELECT 1 FROM pg_constraint c JOIN pg_class t ON c.conrelid = t.oid WHERE t.relname = $1 AND c.conname = $2`,
        [key.table, key.name],
      );
      if (!existing) await queryRunner.query(`ALTER TABLE ${key.table} ADD CONSTRAINT ${key.name} ${key.definition}`);
    }
    await queryRunner.query(LINE_ANALYTICS_PREVIOUS);
    await queryRunner.query(CAPEX_REFRESH_PREVIOUS);
    await queryRunner.query(REFRESH_LINES_PREVIOUS);
    await queryRunner.query(lineSyncPrevious('spend_items'));
    await queryRunner.query(lineSyncPrevious('capex_items'));
    await queryRunner.query(CAPEX_VALUES_SEARCH_PREVIOUS);
    for (const trigger of DORMANT_SEARCH_TRIGGERS) {
      await queryRunner.query(`DROP TRIGGER IF EXISTS ${trigger.name} ON ${trigger.table}`);
    }
    for (const sql of DORMANT_TRIGGERS_PREVIOUS) await queryRunner.query(sql);
    await queryRunner.query(TASKS_REFRESH_PREVIOUS);
    const started = Date.now();
    await queryRunner.query(REINDEX_LINES);
    for (const column of CAPEX_COLUMNS) {
      await queryRunner.query(`ALTER TABLE spend_items DROP COLUMN IF EXISTS ${column.name}`);
    }
    console.log(`${LOG_PREFIX} reverted; every tenant's lines reindexed in ${Date.now() - started} ms`);
  }
}

/**
 * Runs `fn` with row level security off on the tables, then restores what was found, also when
 * `fn` fails (1853910000000). After a failed statement the transaction is aborted and refuses the
 * restore: its rollback restores the state then, and the error of `fn` is the one reported.
 */
async function withoutRowSecurity<T>(queryRunner: QueryRunner, tables: string[], fn: () => Promise<T>): Promise<T> {
  const states: Array<{ table: string; enabled: boolean; forced: boolean }> = [];
  for (const table of tables) {
    const [state] = await queryRunner.query(
      `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE oid = to_regclass($1)`,
      [table],
    );
    states.push({ table, enabled: !!state?.enabled, forced: !!state?.forced });
  }
  for (const state of states) {
    if (state.enabled) await queryRunner.query(`ALTER TABLE ${state.table} DISABLE ROW LEVEL SECURITY`);
  }
  let failed = false;
  try {
    return await fn();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      for (const state of states) {
        if (state.enabled) await queryRunner.query(`ALTER TABLE ${state.table} ENABLE ROW LEVEL SECURITY`);
        if (state.forced) await queryRunner.query(`ALTER TABLE ${state.table} FORCE ROW LEVEL SECURITY`);
      }
    } catch (restoreError) {
      if (!failed) throw restoreError;
    }
  }
}
