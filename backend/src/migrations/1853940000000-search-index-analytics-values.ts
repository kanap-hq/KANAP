import { MigrationInterface, QueryRunner } from 'typeorm';

const LOG_PREFIX = '[Migration] SearchIndexAnalyticsValues:';

/**
 * Pinned on the trigger functions below and on the function they share, as on the budget
 * statement triggers (1853850000000; rules in doc/architecture.md, "Budget statement triggers and
 * stale statistics"): public first, pg_temp last; each statement that reads a variable of the
 * function planned again on every call, with the arrays as constants. SECURITY INVOKER (the
 * default): they run as the writer, under its row level security.
 */
const FUNCTION_SETTINGS = 'SET search_path = public, pg_temp SET plan_cache_mode = force_custom_plan';

const SCOPES = [
  { scope: 'opex', items: 'spend_items', links: 'spend_item_analytics_values', refresh: 'search_index_refresh_spend_items' },
  { scope: 'capex', items: 'capex_items', links: 'capex_item_analytics_values', refresh: 'search_index_refresh_capex_items' },
] as const;

type Scope = (typeof SCOPES)[number];

const EVENTS = ['insert', 'update', 'delete'] as const;
type Event = (typeof EVENTS)[number];

/** The analytics part of a line's index entry, shared by both refresh functions. */
const LINE_ANALYTICS = 'search_index_line_analytics';
/** Refreshes the given lines of one tenant and type, the ones that still exist. */
const REFRESH_LINES = 'search_index_refresh_budget_lines';

/* ---- The index entry of a line ---- */

/** A line's dimensions in display order, as loadAnalyticsAxes and loadItemAnalyticsValues read them. */
const AXIS_ORDER = `a.sort_order, lower(coalesce(a.name, '')), a.code, a.id`;

/**
 * The values a line holds on the dimensions its drawer shows: enabled (stored status not
 * disabled, end of validity empty or ahead: `isAnalyticsActive`) and applying to the line's type.
 * The value's own state does not matter: a disabled value, or one for the other type, that the
 * line still holds is shown and indexed. One row: `analytics_text`, the value names (the vector,
 * weight B; dimension names are never indexed, or "Nature" would return every line), and
 * `analytics_display`, "Nature de coût: Matériel; Récurrence: Récurrent" (extra_json.analytics,
 * the dimension's name or the default's label as `analyticsAxisLabel` gives it); both NULL when
 * the line holds no such value.
 *
 * Called once per line through `LEFT JOIN LATERAL` (an index probe on the line's values), and
 * kept inlinable (one SELECT, STABLE, not STRICT, no SET clause): the planner folds the scope
 * constant and drops the other type's table.
 */
const LINE_ANALYTICS_SQL = `
  CREATE OR REPLACE FUNCTION ${LINE_ANALYTICS}(p_tenant uuid, p_scope text, p_item_id uuid)
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

/** The line's values, joined after the line's other joins (alias `la`). */
const analyticsJoin = (alias: string, scope: Scope['scope']) =>
  `LEFT JOIN LATERAL ${LINE_ANALYTICS}(${alias}.tenant_id, '${scope}', ${alias}.id) la ON true`;
/** extra_json gets `analytics` only when the line holds an indexed value. */
const ANALYTICS_EXTRA = `CASE WHEN la.analytics_display IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('analytics', la.analytics_display) END`;
/** The value names, weight B, next to the line's other B terms. */
const ANALYTICS_VECTOR = `search_index_tsv('B', la.analytics_text)`;

/** ON CONFLICT part of both refresh functions (as in 1853000000000). */
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
 * The deletion of entries whose line is gone, then the upsert of the lines (as in 1853000000000),
 * on two paths with plans of their own: the tenant's lines (`p_ids` NULL: the reindex, the
 * migrations) and the lines given (a line's own trigger, the values' triggers), found through the
 * primary keys of the lines and of their entries. The SQL bodies before read
 * `p_ids IS NULL OR id = ANY(p_ids)`, which PostgreSQL plans for any `p_ids`: each refresh of one
 * line read the tenant's lines and entries. PL/pgSQL plans each path apart (and keeps the plans
 * of a session), so the id path reads its lines only.
 */
function refreshFunctionSql(type: 'spend_items' | 'capex_items', alias: string, select: string, from: string): string {
  const byIds = (ids: boolean, column: string) => (ids ? `\n           AND ${column} = ANY (p_ids)` : '');
  const purge = (ids: boolean) => `DELETE FROM search_index si_del
         WHERE si_del.tenant_id = p_tenant
           AND si_del.entity_type = '${type}'${byIds(ids, 'si_del.entity_id')}
           AND NOT EXISTS (
             SELECT 1 FROM ${type} src
             WHERE src.id = si_del.entity_id AND src.tenant_id = p_tenant
           );`;
  const upsert = (ids: boolean) => `INSERT INTO search_index (
          tenant_id, entity_type, entity_id, ref_prefix, ref_number,
          label, summary, status, extra_json, search_vector, source_updated_at, indexed_at
        )
        ${select}
        ${from}
         WHERE ${alias}.tenant_id = p_tenant${byIds(ids, `${alias}.id`)}
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

/** 1853000000000's OPEX line entry, with the analytics part. */
const SPEND_REFRESH = refreshFunctionSql('spend_items', 'si', `SELECT si.tenant_id,
             'spend_items',
             si.id,
             'OPX',
             si.item_number,
             si.product_name,
             COALESCE(
               NULLIF(si.description, ''),
               NULLIF(CONCAT_WS(' | ', sup.name, comp.name, NULLIF(TRIM(CONCAT_WS(' ', acc.account_number::text, acc.account_name)), '')), '')
             ),
             si.status::text,
             jsonb_build_object(
               'supplier', sup.name,
               'paying_company', comp.name,
               'account', NULLIF(TRIM(CONCAT_WS(' ', acc.account_number::text, acc.account_name)), ''),
               'contract', (
                 SELECT c.name
                 FROM contract_spend_items csi
                 JOIN contracts c ON c.id = csi.contract_id AND c.tenant_id = si.tenant_id
                 WHERE csi.spend_item_id = si.id
                 ORDER BY csi.created_at DESC
                 LIMIT 1
               )
             ) || ${ANALYTICS_EXTRA},
             search_index_tsv('A', CONCAT_WS(' ', 'OPX-' || si.item_number::text, si.product_name))
               || search_index_tsv('B', si.currency)
               || ${ANALYTICS_VECTOR}
               || search_index_tsv('C', CONCAT_WS(' ', si.description, sup.name, comp.name, acc.account_name, acc.account_number::text, si.notes, (
                 SELECT string_agg(c.name, ' ')
                 FROM contract_spend_items csi
                 JOIN contracts c ON c.id = csi.contract_id AND c.tenant_id = si.tenant_id
                 WHERE csi.spend_item_id = si.id
               ))),
             si.updated_at,
             now()`, `FROM spend_items si
        LEFT JOIN suppliers sup ON sup.id = si.supplier_id AND sup.tenant_id = si.tenant_id
        LEFT JOIN companies comp ON comp.id = si.paying_company_id AND comp.tenant_id = si.tenant_id
        LEFT JOIN accounts acc ON acc.id = si.account_id AND acc.tenant_id = si.tenant_id
        ${analyticsJoin('si', 'opex')}`);

/**
 * 1853220000000's CAPEX line entry, with the analytics part. Lot C1 removes the CAPEX enums
 * (`ppe_type`, `investment_type`, `priority`) from the summary and the B terms only: they become
 * dimension values, indexed by the analytics part.
 */
const CAPEX_REFRESH = refreshFunctionSql('capex_items', 'ci', `SELECT ci.tenant_id,
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
        ${analyticsJoin('ci', 'capex')}`);

/** down(): the body 1853000000000 generated for OPEX lines, as it stands in the catalog. */
const SPEND_REFRESH_PREVIOUS = `
    CREATE OR REPLACE FUNCTION search_index_refresh_spend_items(p_tenant uuid, p_ids uuid[] DEFAULT NULL)
    RETURNS void AS $fn$
      DELETE FROM search_index si_del
      WHERE si_del.tenant_id = p_tenant
        AND si_del.entity_type = 'spend_items'
        AND (p_ids IS NULL OR si_del.entity_id = ANY(p_ids))
        AND NOT EXISTS (
          SELECT 1 FROM spend_items src
          WHERE src.id = si_del.entity_id AND src.tenant_id = p_tenant
        );
      INSERT INTO search_index (
        tenant_id, entity_type, entity_id, ref_prefix, ref_number,
        label, summary, status, extra_json, search_vector, source_updated_at, indexed_at
      )
      SELECT si.tenant_id,
             'spend_items',
             si.id,
             'OPX',
             si.item_number,
             si.product_name,
             COALESCE(
      NULLIF(si.description, ''),
      NULLIF(CONCAT_WS(' | ', sup.name, comp.name, NULLIF(TRIM(CONCAT_WS(' ', acc.account_number::text, acc.account_name)), '')), '')
    ),
             si.status::text,
             jsonb_build_object(
      'supplier', sup.name,
      'paying_company', comp.name,
      'account', NULLIF(TRIM(CONCAT_WS(' ', acc.account_number::text, acc.account_name)), ''),
      'contract', (
        SELECT c.name
        FROM contract_spend_items csi
        JOIN contracts c ON c.id = csi.contract_id AND c.tenant_id = si.tenant_id
        WHERE csi.spend_item_id = si.id
        ORDER BY csi.created_at DESC
        LIMIT 1
      )
    ),
             search_index_tsv('A', CONCAT_WS(' ', 'OPX-' || si.item_number::text, si.product_name)) || search_index_tsv('B', si.currency) || search_index_tsv('C', CONCAT_WS(' ', si.description, sup.name, comp.name, acc.account_name, acc.account_number::text, si.notes, (
        SELECT string_agg(c.name, ' ')
        FROM contract_spend_items csi
        JOIN contracts c ON c.id = csi.contract_id AND c.tenant_id = si.tenant_id
        WHERE csi.spend_item_id = si.id
      ))),
             si.updated_at,
             now()
      FROM spend_items si
      LEFT JOIN suppliers sup ON sup.id = si.supplier_id AND sup.tenant_id = si.tenant_id
       LEFT JOIN companies comp ON comp.id = si.paying_company_id AND comp.tenant_id = si.tenant_id
       LEFT JOIN accounts acc ON acc.id = si.account_id AND acc.tenant_id = si.tenant_id
      WHERE si.tenant_id = p_tenant
        AND (p_ids IS NULL OR si.id = ANY(p_ids))
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

/** down(): the body of 1853220000000 (CAPEX_REFRESH_WITH_REF) for CAPEX lines. */
const CAPEX_REFRESH_PREVIOUS = `
  CREATE OR REPLACE FUNCTION search_index_refresh_capex_items(p_tenant uuid, p_ids uuid[] DEFAULT NULL)
  RETURNS void AS $fn$
    DELETE FROM search_index si_del
    WHERE si_del.tenant_id = p_tenant
      AND si_del.entity_type = 'capex_items'
      AND (p_ids IS NULL OR si_del.entity_id = ANY(p_ids))
      AND NOT EXISTS (
        SELECT 1 FROM capex_items src
        WHERE src.id = si_del.entity_id AND src.tenant_id = p_tenant
      );
    INSERT INTO search_index (
      tenant_id, entity_type, entity_id, ref_prefix, ref_number,
      label, summary, status, extra_json, search_vector, source_updated_at, indexed_at
    )
    SELECT ci.tenant_id,
           'capex_items',
           ci.id,
           'CPX',
           ci.item_number,
           ci.description,
           NULLIF(CONCAT_WS(' | ', comp.name, sup.name, ci.ppe_type::text, ci.investment_type), ''),
           ci.status::text,
           jsonb_build_object('paying_company', comp.name, 'supplier', sup.name),
           search_index_tsv('A', CONCAT_WS(' ', 'CPX-' || ci.item_number::text, ci.description))
             || search_index_tsv('B', CONCAT_WS(' ', ci.ppe_type::text, ci.investment_type, ci.priority, ci.currency))
             || search_index_tsv('C', CONCAT_WS(' ', ci.notes, comp.name, sup.name)),
           ci.updated_at,
           now()
    FROM capex_items ci
    LEFT JOIN companies comp ON comp.id = ci.paying_company_id AND comp.tenant_id = ci.tenant_id
    LEFT JOIN suppliers sup ON sup.id = ci.supplier_id AND sup.tenant_id = ci.tenant_id
    WHERE ci.tenant_id = p_tenant
      AND (p_ids IS NULL OR ci.id = ANY(p_ids))
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

/* ---- Freshness: statement triggers ---- */

/**
 * Refreshes lines of one tenant and type: one call of the type's refresh function with every line
 * given that still exists, read by one statement over all the ids (rule 2 of the budget statement
 * triggers; the tenant is a constant of the statement, the primary key serves it). A line deleted
 * with its values (ON DELETE CASCADE) has had its entry removed by its own trigger: it is left
 * out, and a statement that only deleted lines makes no call.
 *
 * No lock is taken on the lines: every writer of a line's values already holds the line (lock
 * order of `spend/budget-locks.ts`: the line first). A new line is its creator's until it
 * commits, an update locks it (`updateItemUnderLock`), the imports lock their lines in id order
 * before writing any, and a line's delete removes its values with it. A lock taken here would
 * come after the values were written, too late to order anything, and cost a row lock write on a
 * line the transaction has just written.
 */
const REFRESH_LINES_SQL = `
  CREATE OR REPLACE FUNCTION ${REFRESH_LINES}(p_scope text, p_tenant uuid, p_items uuid[]) RETURNS void
  LANGUAGE plpgsql ${FUNCTION_SETTINGS} AS $fn$
  DECLARE
    k_kept uuid[];
  BEGIN
    IF p_items IS NULL THEN
      RETURN;
    END IF;
    ${SCOPES.map((scope, index) => `${index === 0 ? 'IF' : 'ELSIF'} p_scope = '${scope.scope}' THEN
      SELECT array_agg(l.id) INTO k_kept
        FROM ${scope.items} l
       WHERE l.id = ANY (p_items) AND l.tenant_id = p_tenant;
      IF k_kept IS NOT NULL THEN
        PERFORM ${scope.refresh}(p_tenant, k_kept);
      END IF;`).join('\n    ')}
    END IF;
  END
  $fn$
`;

/**
 * The rows of an UPDATE statement that really changed, both sides, paired by grouping them on
 * their identity and the compared columns, never by a join of the two transition tables (rule 1;
 * as in 1853850000000): a pair whose compared columns are equal makes a group of two.
 */
function changedRows(columns: string, compared: string, out: string): string {
  return `SELECT ${out}
            FROM (SELECT ${columns} FROM new_rows r UNION ALL SELECT ${columns} FROM old_rows r) s
           GROUP BY ${compared}
          HAVING count(*) = 1`;
}

/** The distinct lines of `rows` (`tenant_id`, `item_id`) refreshed once per tenant. */
function refreshPerTenant(scope: Scope, rows: string): string {
  return `FOR k_tenant, k_items IN
          SELECT x.tenant_id, array_agg(DISTINCT x.item_id)
            FROM (${rows}) x
           GROUP BY x.tenant_id
           ORDER BY x.tenant_id
        LOOP
          PERFORM ${REFRESH_LINES}('${scope.scope}', k_tenant, k_items);
        END LOOP;`;
}

/**
 * The statement trigger function of a line's values: the lines with a value set, cleared or
 * changed (another value, or a row moved to another line or dimension), each refreshed once per
 * statement, whatever the number of its values the statement wrote. An update that changes none
 * of those columns (updated_at alone) refreshes nothing, nor does an upsert that wrote nothing.
 */
function linkFunctionSql(scope: Scope): string {
  const rows = {
    insert: 'SELECT r.tenant_id, r.item_id FROM new_rows r',
    delete: 'SELECT r.tenant_id, r.item_id FROM old_rows r',
    update: changedRows(
      'r.tenant_id, r.item_id, r.axis_id, r.category_id',
      's.tenant_id, s.item_id, s.axis_id, s.category_id',
      's.tenant_id, s.item_id',
    ),
  };
  return `
    CREATE OR REPLACE FUNCTION ${scope.links}_search_index() RETURNS trigger
    LANGUAGE plpgsql ${FUNCTION_SETTINGS} AS $fn$
    DECLARE
      k_tenant uuid;
      k_items uuid[];
    BEGIN
      IF TG_OP = 'INSERT' THEN
        ${refreshPerTenant(scope, rows.insert)}
      ELSIF TG_OP = 'DELETE' THEN
        ${refreshPerTenant(scope, rows.delete)}
      ELSE
        ${refreshPerTenant(scope, rows.update)}
      END IF;
      RETURN NULL;
    END
    $fn$
  `;
}

type TriggerSpec = { table: string; name: string; event: Event; fn: string };

/** Every trigger this migration creates. */
export const SEARCH_INDEX_ANALYTICS_TRIGGERS: TriggerSpec[] = SCOPES.flatMap((scope) => EVENTS.map((event) => ({
  table: scope.links, name: `${scope.links}_search_index_${event}`, event, fn: `${scope.links}_search_index`,
})));

/** Every function this migration creates, with its arguments (the refresh functions are replaced, not created). */
export const SEARCH_INDEX_ANALYTICS_FUNCTIONS = [
  `${LINE_ANALYTICS}(uuid, text, uuid)`,
  `${REFRESH_LINES}(text, uuid, uuid[])`,
  ...SCOPES.map((scope) => `${scope.links}_search_index()`),
];

const transition = (event: Event) => (event === 'insert' ? 'NEW TABLE AS new_rows'
  : event === 'delete' ? 'OLD TABLE AS old_rows'
    : 'OLD TABLE AS old_rows NEW TABLE AS new_rows');

/**
 * Every tenant's OPEX and CAPEX lines indexed again, one tenant at a time with its
 * app.current_tenant (search_index's RLS checks every written row; precedent 1853220000000), the
 * setting found before put back afterwards: all pending migrations share one transaction.
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

async function reindexLines(queryRunner: QueryRunner): Promise<number> {
  const started = Date.now();
  await queryRunner.query(REINDEX_LINES);
  return Date.now() - started;
}

/**
 * Global search (Plaid's `search_all`, the @-mention search) finds an OPEX or CAPEX line by the
 * names of its analytics values (plan planning/opex-capex-transfer.md §14.1 point 4, decision F2,
 * §15.1 point 1; lot S).
 *
 * 1. `search_index_line_analytics(tenant, scope, line)`: the values a line holds on the enabled
 *    dimensions that apply to its type (what its drawer shows), as the value names and as a display
 *    string. The value's own state does not matter; dimension names are not indexed.
 * 2. `search_index_refresh_spend_items` and `search_index_refresh_capex_items` redefined with it:
 *    the value names in the vector at weight B, and `extra_json.analytics`
 *    ("Nature de coût: Matériel; Récurrence: Récurrent", in dimension order; absent when the line
 *    holds no indexed value). Label, summary and the other vector parts are unchanged. Both become
 *    PL/pgSQL with two paths, the tenant's lines and the lines given: a refresh of one line reads
 *    that line through the primary keys, never the tenant's table.
 * 3. Freshness.
 *    - At once: the values a line holds. They are the line's own data (written with the line,
 *      under its lock), so writing them refreshes the line: statement triggers with transition
 *      tables on `*_item_analytics_values` (`<table>_search_index_<event>`), INSERT, UPDATE (a
 *      changed value, line or dimension) and DELETE, each line refreshed once per (tenant, type)
 *      and statement by one call with the ids. PostgreSQL refuses a column list (`UPDATE OF ...`)
 *      on a trigger with transition tables, so the UPDATE trigger compares the old and new rows
 *      itself: `updated_at` alone refreshes nothing. Every writer of a line's values holds the
 *      line already, so these triggers only write the entries of lines their writer holds. They
 *      follow the rules of the budget statement triggers (1853850000000): no join of the
 *      transition tables, one read over all the keys, keys de-duplicated, SET search_path =
 *      public, pg_temp and plan_cache_mode = force_custom_plan, SECURITY INVOKER under the
 *      writer's row level security. A line's `row_version` bump by its values (1853740000000)
 *      still skips the line's own search trigger: the values' trigger refreshes the line itself.
 *    - At the daily reindex (`cleanup/search-index-reindex.service.ts`, 03:00), at the line's
 *      next write, or at once through the admin rebuild (`POST /ai/admin/search-index/reindex`):
 *      what the entry reads from the values and dimensions themselves: a value renamed; a
 *      dimension renamed, disabled, past its end of validity, restricted to one line type
 *      (`applies_to`) or reordered. This is the index's contract for related records
 *      (1853000000000), as for a supplier or a company renamed. A first version of this
 *      migration cascaded these changes to the lines holding the value or dimension and was
 *      dropped: it wrote the entries of lines its writer did not hold, so a value or dimension
 *      edit, which locks its own row first, waited for the lines an import held while the import
 *      could ask for that row (the value it links, FOR KEY SHARE), a deadlock.
 * 4. Every tenant's OPEX and CAPEX lines reindexed (the time is logged).
 *
 * Consequence for later migrations: a write of a line's values (`*_item_analytics_values`) fires
 * these triggers, which read the lines, their values and what their entries name, and write
 * `search_index`. Such a migration runs per tenant with app.current_tenant set (as the reindex
 * of step 4). With row level security lifted only on the tables it writes, the triggers see no line
 * and the entries stay stale until the daily reindex; with the lines visible and search_index
 * still under RLS, the write into search_index is refused. An update of analytics values or
 * dimensions fires none of these triggers.
 *
 * Idempotent: every function is created or replaced, every trigger dropped and created again, the
 * reindex rewrites the same entries. down() drops the triggers and the new functions, puts back
 * the refresh bodies of 1853000000000 (OPEX) and 1853220000000 (CAPEX) and reindexes.
 */
export class SearchIndexAnalyticsValues1853940000000 implements MigrationInterface {
  name = 'SearchIndexAnalyticsValues1853940000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The refresh functions call the helper: it exists before them (their bodies are checked on creation).
    await queryRunner.query(LINE_ANALYTICS_SQL);
    await queryRunner.query(SPEND_REFRESH);
    await queryRunner.query(CAPEX_REFRESH);
    await queryRunner.query(REFRESH_LINES_SQL);
    for (const scope of SCOPES) await queryRunner.query(linkFunctionSql(scope));
    for (const trigger of SEARCH_INDEX_ANALYTICS_TRIGGERS) {
      await queryRunner.query(`DROP TRIGGER IF EXISTS ${trigger.name} ON ${trigger.table}`);
      await queryRunner.query(`
        CREATE TRIGGER ${trigger.name}
        AFTER ${trigger.event.toUpperCase()} ON ${trigger.table}
        REFERENCING ${transition(trigger.event)}
        FOR EACH STATEMENT EXECUTE FUNCTION ${trigger.fn}()
      `);
    }
    const ms = await reindexLines(queryRunner);
    console.log(
      `${LOG_PREFIX} analytics values indexed on OPEX and CAPEX lines, ${SEARCH_INDEX_ANALYTICS_TRIGGERS.length} triggers ready; `
        + `every tenant's lines reindexed in ${ms} ms`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const trigger of SEARCH_INDEX_ANALYTICS_TRIGGERS) {
      await queryRunner.query(`DROP TRIGGER IF EXISTS ${trigger.name} ON ${trigger.table}`);
    }
    await queryRunner.query(SPEND_REFRESH_PREVIOUS);
    await queryRunner.query(CAPEX_REFRESH_PREVIOUS);
    for (const fn of SEARCH_INDEX_ANALYTICS_FUNCTIONS) await queryRunner.query(`DROP FUNCTION IF EXISTS ${fn}`);
    const ms = await reindexLines(queryRunner);
    console.log(`${LOG_PREFIX} analytics values no longer indexed; every tenant's lines reindexed in ${ms} ms`);
  }
}
