import { MigrationInterface, QueryRunner } from 'typeorm';

const LOG_PREFIX = '[Migration] DataAccessLineEditable:';
const LIMITED_ROLE = 'kanap_data_limited';

/**
 * Data-scoped access, lot 3 (planning/data-scoped-access/spec.md §6.4, §6.7): the line editable
 * for the person of the transaction, for the application's write checks and the budget list's
 * "editable" column.
 *
 * `data_access_line_editable(company, cost_center, owner_it, owner_business)` is modifiable_ligne
 * of spec §6.4 on the values of a line: the placement allowed by an edit node
 * (`data_access_placable_line`, the single definition of placable_ligne, lot 2) or the person
 * responsible (IT or business owner). Outside the limited mode it returns true (as
 * `data_access_ctx()` reports mode "all"); under the limited role taken without context it returns
 * false, like the access functions of lot 2.
 *
 * SECURITY INVOKER, no SET clause, no table read: PostgreSQL may inline it into a list query, and
 * it reads the settings of the transaction. The caller reads the line under its own policies
 * (`spend_items` SELECT), so a line out of read access has no row at all. EXECUTE stays with
 * PUBLIC, like `data_access_placable_line`. Idempotent (CREATE OR REPLACE); down() drops it.
 */
export class DataAccessLineEditable1854600000000 implements MigrationInterface {
  name = 'DataAccessLineEditable1854600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION data_access_line_editable(
        p_company uuid, p_cost_center uuid, p_owner_it uuid, p_owner_business uuid)
      RETURNS boolean
      LANGUAGE sql
      STABLE
      AS $fn$
        SELECT CASE
          WHEN NULLIF(current_setting('app.da_mode', true), '') IS DISTINCT FROM 'limited'
            THEN coalesce(current_setting('role', true), '') <> '${LIMITED_ROLE}'
          ELSE coalesce(
            p_owner_it = NULLIF(current_setting('app.da_user', true), '')::uuid
            OR p_owner_business = NULLIF(current_setting('app.da_user', true), '')::uuid
            OR public.data_access_placable_line(p_company, p_cost_center),
            false)
        END
      $fn$
    `);
    console.log(`${LOG_PREFIX} data_access_line_editable ready`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP FUNCTION IF EXISTS data_access_line_editable(uuid, uuid, uuid, uuid)`);
  }
}
