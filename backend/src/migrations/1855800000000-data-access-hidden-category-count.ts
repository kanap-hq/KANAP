import { MigrationInterface, QueryRunner } from 'typeorm';

const LOG_PREFIX = '[Migration] DataAccessHiddenCategoryCount:';
const LIMITED_ROLE = 'kanap_data_limited';

/*
 * Data-scoped access (spec §6.6): the lines a limited person cannot read on one
 * dimension value. `data_access_hidden_count(type, id)` counts the lines linked
 * to a visible object; no function counted lines by analytics value, so the
 * analytics report could not say how many lines of a value it left out without
 * naming them.
 *
 * The guards are those of data_access_hidden_count (1855400000000): 0 outside
 * limited mode, no answer when the limited role is taken without
 * data_access_apply(), the tenant predicate everywhere, and readableLine()
 * read from the app.da_* settings of the transaction. For a dimension that
 * applies to one nature only, the lines of the other nature are left out: a
 * value held on the wrong nature reads as blank in the list engine, and the
 * report must count what the list would show.
 *
 * A set-returning function has no scalar NULL: the refusal without
 * data_access_apply() answers one row whose columns are NULL, as
 * data_access_hidden_count answers NULL. Outside limited mode it answers one
 * row per requested value with 0. The migration is idempotent
 * (CREATE OR REPLACE) and its down() drops the function.
 *
 * `p_active_from` is the report's lifecycle window, exactly as `windowScope`
 * reads it (`spend/budget-list/budget-list.service.ts`): a line with no end of
 * validity, or one ending on or after that day, is counted; NULL counts every
 * line. It is read in UTC (`p_active_from::timestamp AT TIME ZONE 'UTC'`), as
 * the engine binds `...T00:00:00.000Z::timestamptz`: the session time zone
 * must not move the window. The previous signatures are dropped first: a
 * development database still holds them, and `CREATE OR REPLACE` would add an
 * overload the older calls could not resolve.
 *
 * Disclosure guard (review B1): a value is answered only when at least one
 * line the reader may read holds it, in the same tenant, dimension, window and
 * nature. Without it, a limited reader could ask for the hidden count of any
 * value they can list in master data, including values none of their lines
 * carry. The outer count stays the lines they cannot read.
 *
 * `p_nature` is the report's tab: `opex`, `capex` or NULL for both. It is
 * intersected with the dimension's `applies_to`, so a value held by both
 * natures counts only the hidden lines of the tab the person reads.
 *
 * Defence in depth: only values that belong to the requested dimension and to
 * the current tenant are answered, in both modes (analytics_categories joined
 * on id, tenant and axis). A value id of another dimension, or of another
 * tenant, answers no row, which the caller reads as 0.
 */

/** The settings of data_access_apply() (spec §6.3), read once per statement through an InitPlan. */
const setting = (name: string) => `NULLIF(current_setting('app.da_${name}', true), '')`;
const MODE_LIMITED = `(SELECT 1 WHERE current_setting('app.da_mode', true) = 'limited') IS NOT NULL`;
/** The limited role taken without data_access_apply() (mode not limited): the functions refuse. */
const ROLE_TAKEN = `coalesce(current_setting('role', true), '') = '${LIMITED_ROLE}'`;
const USER = `(SELECT ${setting('user')}::uuid)`;
const READ_ALL = `coalesce((SELECT ${setting('read_all')}::boolean), false)`;
const uuidList = (name: string) => `(SELECT ${setting(name)}::uuid[])::uuid[]`;
const READ_COMPANIES = uuidList('read_companies');
const READ_NODES = uuidList('read_nodes');

/** lisible_ligne (spec §6.4) on the line `p` (a column prefix: `i.`). */
const readableLine = (p: string) => `(${READ_ALL}
      OR ${p}paying_company_id = ANY (${READ_COMPANIES})
      OR ${p}cost_center_id = ANY (${READ_NODES})
      OR ${p}owner_it_id = ${USER}
      OR ${p}owner_business_id = ${USER})`;

async function createFunction(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.query(`
    CREATE OR REPLACE FUNCTION data_access_hidden_category_count(p_axis_id uuid, p_category_ids uuid[], p_active_from date DEFAULT NULL, p_nature text DEFAULT NULL)
    RETURNS TABLE(category_id uuid, n integer)
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $fn$
    DECLARE
      v_nature text;
      v_active_from timestamptz;
    BEGIN
      IF p_nature IS NOT NULL AND p_nature NOT IN ('opex', 'capex') THEN
        RETURN;
      END IF;
      IF p_active_from IS NOT NULL THEN
        v_active_from := (p_active_from::timestamp AT TIME ZONE 'UTC');
      END IF;
      SELECT ax.applies_to INTO v_nature
        FROM public.analytics_axes ax
       WHERE ax.tenant_id = app_current_tenant() AND ax.id = p_axis_id;
      IF v_nature IS NOT NULL AND v_nature NOT IN ('opex', 'capex') THEN
        v_nature := NULL;
      END IF;
      IF NOT (${MODE_LIMITED}) THEN
        IF ${ROLE_TAKEN} THEN
          RETURN QUERY SELECT NULL::uuid, NULL::integer;
          RETURN;
        END IF;
        RETURN QUERY
          SELECT c.id, 0
          FROM (SELECT DISTINCT unnest(p_category_ids) AS id) req
          JOIN public.analytics_categories c
            ON c.id = req.id
           AND c.tenant_id = app_current_tenant()
           AND c.axis_id = p_axis_id
           AND EXISTS (
             SELECT 1
             FROM public.spend_items i2
             JOIN public.spend_item_analytics_values v2
               ON v2.tenant_id = i2.tenant_id AND v2.item_id = i2.id
             WHERE i2.tenant_id = app_current_tenant()
               AND v2.tenant_id = app_current_tenant()
               AND v2.axis_id = p_axis_id
               AND v2.category_id = c.id
               AND i2.nature IN ('opex', 'capex')
               AND (v_nature IS NULL OR i2.nature = v_nature)
               AND (p_nature IS NULL OR i2.nature = p_nature)
               AND (v_active_from IS NULL OR i2.disabled_at IS NULL OR i2.disabled_at >= v_active_from)
           );
        RETURN;
      END IF;
      RETURN QUERY
        SELECT c.id, count(*)::int
        FROM public.spend_items i
        JOIN public.spend_item_analytics_values v
          ON v.tenant_id = i.tenant_id AND v.item_id = i.id
        JOIN public.analytics_categories c
          ON c.id = v.category_id
         AND c.tenant_id = v.tenant_id
         AND c.axis_id = p_axis_id
        WHERE i.tenant_id = app_current_tenant()
          AND v.tenant_id = app_current_tenant()
          AND v.axis_id = p_axis_id
          AND v.category_id = ANY (p_category_ids)
          AND i.nature IN ('opex', 'capex')
          AND (v_nature IS NULL OR i.nature = v_nature)
          AND (p_nature IS NULL OR i.nature = p_nature)
          AND (v_active_from IS NULL OR i.disabled_at IS NULL OR i.disabled_at >= v_active_from)
          AND NOT coalesce(${readableLine('i.')}, false)
          AND EXISTS (
            SELECT 1
            FROM public.spend_items i2
            JOIN public.spend_item_analytics_values v2
              ON v2.tenant_id = i2.tenant_id AND v2.item_id = i2.id
            WHERE i2.tenant_id = app_current_tenant()
              AND v2.tenant_id = app_current_tenant()
              AND v2.axis_id = p_axis_id
              AND v2.category_id = c.id
              AND i2.nature IN ('opex', 'capex')
              AND (v_nature IS NULL OR i2.nature = v_nature)
              AND (p_nature IS NULL OR i2.nature = p_nature)
              AND (v_active_from IS NULL OR i2.disabled_at IS NULL OR i2.disabled_at >= v_active_from)
              AND coalesce(${readableLine('i2.')}, false)
          )
        GROUP BY c.id;
    END
    $fn$
  `);
  await queryRunner.query(`REVOKE EXECUTE ON FUNCTION data_access_hidden_category_count(uuid, uuid[], date, text) FROM PUBLIC`);
  await queryRunner.query(`GRANT EXECUTE ON FUNCTION data_access_hidden_category_count(uuid, uuid[], date, text) TO CURRENT_USER`);
  const [role] = await queryRunner.query(`SELECT to_regrole($1) IS NOT NULL AS present`, [LIMITED_ROLE]);
  if (role?.present) {
    await queryRunner.query(`GRANT EXECUTE ON FUNCTION data_access_hidden_category_count(uuid, uuid[], date, text) TO ${LIMITED_ROLE}`);
  }
}

export class DataAccessHiddenCategoryCount1855800000000 implements MigrationInterface {
  name = 'DataAccessHiddenCategoryCount1855800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // A development database holds the earlier signatures of this lot (the two-argument one and
    // the one with the window): drop them before the four-argument function replaces them.
    await queryRunner.query(`DROP FUNCTION IF EXISTS data_access_hidden_category_count(uuid, uuid[])`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS data_access_hidden_category_count(uuid, uuid[], date)`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS data_access_hidden_category_count(uuid, uuid[], date, text)`);
    await createFunction(queryRunner);
    console.log(`${LOG_PREFIX} data_access_hidden_category_count(axis, values): hidden lines by dimension value`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP FUNCTION IF EXISTS data_access_hidden_category_count(uuid, uuid[], date, text)`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS data_access_hidden_category_count(uuid, uuid[], date)`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS data_access_hidden_category_count(uuid, uuid[])`);
  }
}
