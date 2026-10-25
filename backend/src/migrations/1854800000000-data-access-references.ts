import { MigrationInterface, QueryRunner } from 'typeorm';

const LOG_PREFIX = '[Migration] DataAccessReferences:';
const LIMITED_ROLE = 'kanap_data_limited';

/*
 * Data-scoped access, lot 4 (planning/data-scoped-access/spec.md §5.4 "Champ simple", §6.6):
 * `data_access_reference(type, id)` gives the business reference of a line linked to a visible
 * object, without its name, so the screen shows `BL-12` without a link.
 *
 * - The reference of a line is `BL-<item_number>` (`spend/budget-nature.ts`, `budgetLineReference`),
 *   whatever its nature: the function of migration 1854500000000 answered `OPX-<item_number>` or
 *   `CPX-<item_number>`, a form the product shows nowhere and that names another line's legacy
 *   number (`spend_items.legacy_number`, resolved by `common/resolve-item-id.ts`).
 * - Two new starting objects, a line, for its lineage (lot M, `spend/budget-line-lineage.ts`):
 *   `line_predecessor` (the line it continues) and `line_successor` (the line that continues it).
 *
 * Same contract as before (run 2B): (p_type, p_id) is the starting object; it must be visible to
 * the person, otherwise (and when it does not exist) NULL; an unknown type raises 22023; under the
 * limited role taken without context, NULL. The settings are read with the same expressions as the
 * policies (copied from the builders of migration 1854500000000). EXECUTE stays as it was granted:
 * CREATE OR REPLACE keeps the privileges of the function.
 */

const setting = (name: string) => `NULLIF(current_setting('app.da_${name}', true), '')`;
const MODE_LIMITED = `(SELECT 1 WHERE current_setting('app.da_mode', true) = 'limited') IS NOT NULL`;
const ROLE_TAKEN = `coalesce(current_setting('role', true), '') = '${LIMITED_ROLE}'`;
const USER = `(SELECT ${setting('user')}::uuid)`;
const READ_ALL = `coalesce((SELECT ${setting('read_all')}::boolean), false)`;
const uuidList = (name: string) => `(SELECT ${setting(name)}::uuid[])::uuid[]`;
const READ_COMPANIES = uuidList('read_companies');
const READ_NODES = uuidList('read_nodes');
const IN_TENANT = (p: string) => `${p}tenant_id = app_current_tenant()`;
const LINE_TASK_TYPES = `('spend_item', 'capex_item')`;

/** lisible_ligne (spec §6.4) on the line `p`. */
const readableLine = (p: string) => `(${READ_ALL}
      OR ${p}paying_company_id = ANY (${READ_COMPANIES})
      OR ${p}cost_center_id = ANY (${READ_NODES})
      OR ${p}owner_it_id = ${USER}
      OR ${p}owner_business_id = ${USER})`;

const DEFINER = `STABLE
    SECURITY DEFINER
    SET search_path = public, pg_temp`;

const REFERENCE_FUNCTION = `
    CREATE OR REPLACE FUNCTION data_access_reference(p_type text, p_id uuid)
    RETURNS text
    LANGUAGE plpgsql
    ${DEFINER}
    AS $fn$
    DECLARE
      v_type text;
      v_object uuid;
      v_reference text;
    BEGIN
      IF p_type IS NULL OR p_type NOT IN ('task', 'line_predecessor', 'line_successor') THEN
        RAISE EXCEPTION 'data_access_reference: unknown type %', p_type USING ERRCODE = '22023';
      END IF;
      IF NOT (${MODE_LIMITED}) AND ${ROLE_TAKEN} THEN
        RETURN NULL;
      END IF;
      IF p_type = 'task' THEN
        SELECT t.related_object_type, t.related_object_id INTO v_type, v_object
        FROM public.tasks t WHERE t.id = p_id AND ${IN_TENANT('t.')};
        IF NOT FOUND THEN
          RETURN NULL;
        END IF;
        IF (${MODE_LIMITED}) AND NOT data_access_task_visible(p_id) THEN
          RETURN NULL;
        END IF;
        IF v_type IN ${LINE_TASK_TYPES} THEN
          SELECT 'BL-' || i.item_number INTO v_reference
          FROM public.spend_items i WHERE i.id = v_object AND ${IN_TENANT('i.')};
          RETURN v_reference;
        END IF;
        RETURN NULL;
      END IF;
      -- A line's lineage: the line must be readable.
      IF NOT EXISTS (
        SELECT 1 FROM public.spend_items i
        WHERE i.id = p_id AND ${IN_TENANT('i.')}
          AND (NOT (${MODE_LIMITED}) OR ${readableLine('i.')})
      ) THEN
        RETURN NULL;
      END IF;
      IF p_type = 'line_predecessor' THEN
        SELECT 'BL-' || p.item_number INTO v_reference
        FROM public.spend_items i
        JOIN public.spend_items p ON p.tenant_id = i.tenant_id AND p.id = i.predecessor_id
        WHERE i.id = p_id AND ${IN_TENANT('i.')};
        RETURN v_reference;
      END IF;
      SELECT 'BL-' || s.item_number INTO v_reference
      FROM public.spend_items s
      WHERE s.predecessor_id = p_id AND ${IN_TENANT('s.')};
      RETURN v_reference;
    END
    $fn$
  `;

/** The function as migration 1854500000000 created it (`down`). */
const PREVIOUS_REFERENCE_FUNCTION = `
    CREATE OR REPLACE FUNCTION data_access_reference(p_type text, p_id uuid)
    RETURNS text
    LANGUAGE plpgsql
    ${DEFINER}
    AS $fn$
    DECLARE
      v_type text;
      v_object uuid;
      v_reference text;
    BEGIN
      IF p_type IS DISTINCT FROM 'task' THEN
        RAISE EXCEPTION 'data_access_reference: unknown type %', p_type USING ERRCODE = '22023';
      END IF;
      IF NOT (${MODE_LIMITED}) AND ${ROLE_TAKEN} THEN
        RETURN NULL;
      END IF;
      SELECT t.related_object_type, t.related_object_id INTO v_type, v_object
      FROM public.tasks t WHERE t.id = p_id AND ${IN_TENANT('t.')};
      IF NOT FOUND THEN
        RETURN NULL;
      END IF;
      IF (${MODE_LIMITED}) AND NOT data_access_task_visible(p_id) THEN
        RETURN NULL;
      END IF;
      IF v_type IN ${LINE_TASK_TYPES} THEN
        SELECT CASE WHEN i.nature = 'capex' THEN 'CPX' ELSE 'OPX' END || '-' || i.item_number
        INTO v_reference
        FROM public.spend_items i WHERE i.id = v_object AND ${IN_TENANT('i.')};
        RETURN v_reference;
      END IF;
      RETURN NULL;
    END
    $fn$
  `;

export class DataAccessReferences1854800000000 implements MigrationInterface {
  name = 'DataAccessReferences1854800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(REFERENCE_FUNCTION);
    console.log(`${LOG_PREFIX} data_access_reference gives BL-n, for a task's line and a line's lineage`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(PREVIOUS_REFERENCE_FUNCTION);
  }
}
