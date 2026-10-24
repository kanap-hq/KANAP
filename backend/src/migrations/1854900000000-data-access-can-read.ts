import { MigrationInterface, QueryRunner } from 'typeorm';

const LOG_PREFIX = '[Migration] DataAccessCanRead:';
const LIMITED_ROLE = 'kanap_data_limited';
const SIGNATURE = 'data_access_can_read(uuid, text, uuid)';

/*
 * Data-scoped access, lot 4 (planning/data-scoped-access/spec.md §5.6, §6.6, §6.7):
 * `data_access_can_read(p_user, p_type, p_id)` tells whether another person could read an object,
 * for the notifications (a recipient who is not named on the object) and the warning of "Send the
 * link". Types: `spend_item` (a budget line, either nature), `task` (participations included),
 * `contract`.
 *
 * - SECURITY DEFINER (it reads the whole tenant), tenant predicate on every table, search_path
 *   pinned; it never changes role.
 * - The limited role taken without context: NULL, like the other disclosure functions.
 * - The starting object must exist in the tenant and, when the caller is limited, be visible to the
 *   caller (spec §6.6: a disclosure starts from a visible object); otherwise NULL, so the function
 *   tells nothing about an object out of the caller's access.
 * - `p_user` not found in the tenant: false. Mode `all` or the Administrator role (by name, as
 *   `data_access_apply`): true. Otherwise the person's nodes are unfolded as `data_access_apply`
 *   does (step 5) and the predicates of the policies are applied with them instead of the
 *   transaction's settings.
 * - Contracts are not scoped before lot 5: a contract is readable by everyone (CONTRACT_READABLE).
 *   A contract task follows the policy of `tasks` in force today (lisible_contrat through
 *   `data_access_contract_visible`), with the person's values. Lot 5 replaces CONTRACT_READABLE by
 *   `readableContract` and checks the caller's visibility of a contract.
 *
 * The unfolding is copied from `data_access_apply` (migration 1854400000000, step 5): sharing one
 * SQL definition would mean replacing `data_access_apply` itself (the per-request hot path, the
 * only function allowed to take the role, whose down() would then restore the lot 1 body). The
 * spec `data-access-can-read.spec.ts` compares both on the cases of `data-access-apply.spec.ts`.
 * The predicates are copied from the builders of migration 1854500000000, with the person's values
 * in place of the settings (`Who`).
 *
 * EXECUTE: revoked from PUBLIC, granted to the application role and, when it exists, to the limited
 * role (a limited sender's warning); the start of the API grants it again when it is missing
 * (`data-access-availability.ts`, DIRECT_CALL_FUNCTIONS). Idempotent (CREATE OR REPLACE); down()
 * drops the function.
 */

const setting = (name: string) => `NULLIF(current_setting('app.da_${name}', true), '')`;
const MODE_LIMITED = `(SELECT 1 WHERE current_setting('app.da_mode', true) = 'limited') IS NOT NULL`;
const ROLE_TAKEN = `coalesce(current_setting('role', true), '') = '${LIMITED_ROLE}'`;
const IN_TENANT = (p: string) => `${p}tenant_id = app_current_tenant()`;
const LINE_TASK_TYPES = `('spend_item', 'capex_item')`;
const SCOPED_TASK_TYPES = `('spend_item', 'capex_item', 'contract')`;

/** Whose access a predicate tests: SQL expressions for the person's values. */
type Who = { readAll: string; readCompanies: string; readNodes: string; user: string; userText: string };

/** The caller, from the settings of the transaction (as the policies read them). */
const CALLER: Who = {
  readAll: `coalesce((SELECT ${setting('read_all')}::boolean), false)`,
  readCompanies: `(SELECT ${setting('read_companies')}::uuid[])::uuid[]`,
  readNodes: `(SELECT ${setting('read_nodes')}::uuid[])::uuid[]`,
  user: `(SELECT ${setting('user')}::uuid)`,
  userText: `(SELECT ${setting('user')})`,
};

/** The person asked about, from the variables the function computes. */
const PERSON: Who = {
  readAll: 'v_read_all',
  readCompanies: 'v_read_companies',
  readNodes: 'v_read_nodes',
  user: 'p_user',
  userText: 'p_user::text',
};

/** lisible_ligne (spec §6.4) on the line `p`. */
const readableLine = (p: string, w: Who) => `(${w.readAll}
        OR ${p}paying_company_id = ANY (${w.readCompanies})
        OR ${p}cost_center_id = ANY (${w.readNodes})
        OR ${p}owner_it_id = ${w.user}
        OR ${p}owner_business_id = ${w.user})`;

/** lisible_contrat (spec §6.4) on the contract `p`: direct, or through a readable line that names it. */
const readableContract = (p: string, w: Who) => `(${w.readAll}
        OR ${p}company_id = ANY (${w.readCompanies})
        OR ${p}cost_center_id = ANY (${w.readNodes})
        OR ${p}owner_user_id = ${w.user}
        OR EXISTS (SELECT 1 FROM public.contract_spend_items l JOIN public.spend_items i ON i.id = l.spend_item_id
                   WHERE l.contract_id = ${p}id AND ${IN_TENANT('l.')} AND ${IN_TENANT('i.')} AND ${readableLine('i.', w)})
        OR EXISTS (SELECT 1 FROM public.spend_items i
                   WHERE i.contract_id = ${p}id AND ${IN_TENANT('i.')} AND ${readableLine('i.', w)}))`;

/** A contract readable by the person: every contract until lot 5 scopes them. */
const CONTRACT_READABLE = 'true';

/** Participant of the task `p` (spec §2.5, §4.4): assignee, owner or observer. The creator is not one. */
const taskParticipant = (p: string, w: Who) => `(${p}assignee_user_id = ${w.user}
        OR ${p}owner_ids ? ${w.userText}
        OR ${p}viewer_ids ? ${w.userText})`;

/** Task visible (spec §4.4): not scoped, participant, or its line or contract readable. */
const readableTask = (p: string, w: Who) => `(${w.readAll}
        OR ${p}related_object_type IS NULL OR ${p}related_object_type NOT IN ${SCOPED_TASK_TYPES}
        OR ${taskParticipant(p, w)}
        OR (${p}related_object_type IN ${LINE_TASK_TYPES} AND EXISTS (
              SELECT 1 FROM public.spend_items i
              WHERE i.id = ${p}related_object_id AND ${IN_TENANT('i.')} AND ${readableLine('i.', w)}))
        OR (${p}related_object_type = 'contract' AND EXISTS (
              SELECT 1 FROM public.contracts c
              WHERE c.id = ${p}related_object_id AND ${IN_TENANT('c.')} AND ${readableContract('c.', w)})))`;

/**
 * Step 5 of data_access_apply (1854400000000): the person's nodes, the tree unfolded, kept to the
 * read lists (every edit node is also a read node). A company node brings the company and the
 * centres whose company it is; a group brings itself, its subgroups and their centres; a centre
 * brings itself; disabled nodes count.
 */
const UNFOLD_NODES = `
      WITH RECURSIVE seeds AS (
        SELECT n.node_type, n.company_id, n.cost_center_id, n.access
        FROM public.user_data_access_nodes n
        WHERE n.tenant_id = v_tenant AND n.user_id = p_user
      ),
      subtree (id, company_id, access) AS (
        SELECT c.id, c.company_id, s.access
        FROM seeds s
        JOIN public.cost_centers c ON c.tenant_id = v_tenant AND c.id = s.cost_center_id
        WHERE s.node_type = 'cost_center'
        UNION
        SELECT ch.id, ch.company_id, t.access
        FROM subtree t
        JOIN public.cost_centers ch ON ch.tenant_id = v_tenant AND ch.parent_id = t.id
      ),
      tree (id, company_id, access) AS (
        SELECT id, company_id, access FROM subtree
        UNION
        SELECT c.id, c.company_id, s.access
        FROM seeds s
        JOIN public.cost_centers c ON c.tenant_id = v_tenant AND c.company_id = s.company_id
        WHERE s.node_type = 'company'
      )
      SELECT
        EXISTS (SELECT 1 FROM seeds WHERE node_type = 'all'),
        coalesce((SELECT array_agg(DISTINCT company_id ORDER BY company_id) FROM seeds
                  WHERE node_type = 'company'), '{}'::uuid[]),
        coalesce((SELECT array_agg(DISTINCT id ORDER BY id) FROM tree), '{}'::uuid[])
      INTO v_read_all, v_read_companies, v_read_nodes`;

const CAN_READ_FUNCTION = `
    CREATE OR REPLACE FUNCTION data_access_can_read(p_user uuid, p_type text, p_id uuid)
    RETURNS boolean
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $fn$
    DECLARE
      v_tenant uuid := app_current_tenant();
      v_mode text;
      v_read_all boolean;
      v_read_companies uuid[];
      v_read_nodes uuid[];
    BEGIN
      IF p_type IS NULL OR p_type NOT IN ('spend_item', 'task', 'contract') THEN
        RAISE EXCEPTION 'data_access_can_read: unknown type %', p_type USING ERRCODE = '22023';
      END IF;
      IF NOT (${MODE_LIMITED}) AND ${ROLE_TAKEN} THEN
        RETURN NULL;
      END IF;

      -- The starting object: in the tenant, and visible to a limited caller.
      IF p_type = 'spend_item' THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.spend_items i
          WHERE i.id = p_id AND ${IN_TENANT('i.')}
            AND (NOT (${MODE_LIMITED}) OR ${readableLine('i.', CALLER)})
        ) THEN
          RETURN NULL;
        END IF;
      ELSIF p_type = 'task' THEN
        IF NOT EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = p_id AND ${IN_TENANT('t.')})
           OR ((${MODE_LIMITED}) AND NOT data_access_task_visible(p_id)) THEN
          RETURN NULL;
        END IF;
      ELSE
        IF NOT EXISTS (SELECT 1 FROM public.contracts c WHERE c.id = p_id AND ${IN_TENANT('c.')}) THEN
          RETURN NULL;
        END IF;
      END IF;

      -- The person: unknown, refused; all data or Administrator, everything (data_access_apply, steps 1-3).
      SELECT u.data_access_mode INTO v_mode
      FROM public.users u
      WHERE u.id = p_user AND u.tenant_id = v_tenant;
      IF NOT FOUND THEN
        RETURN false;
      END IF;
      IF v_mode = 'all' OR EXISTS (
        SELECT 1
        FROM (
          SELECT u.role_id FROM public.users u WHERE u.id = p_user AND u.tenant_id = v_tenant
          UNION
          SELECT ur.role_id FROM public.user_roles ur WHERE ur.user_id = p_user AND ur.tenant_id = v_tenant
        ) assigned
        JOIN public.roles r ON r.id = assigned.role_id AND r.tenant_id = v_tenant
        WHERE lower(trim(r.role_name)) = 'administrator'
      ) THEN
        RETURN true;
      END IF;

      -- Limited: the nodes unfolded (data_access_apply, step 5).
${UNFOLD_NODES};

      IF p_type = 'spend_item' THEN
        RETURN EXISTS (
          SELECT 1 FROM public.spend_items i
          WHERE i.id = p_id AND ${IN_TENANT('i.')} AND ${readableLine('i.', PERSON)});
      ELSIF p_type = 'task' THEN
        RETURN EXISTS (
          SELECT 1 FROM public.tasks t
          WHERE t.id = p_id AND ${IN_TENANT('t.')} AND ${readableTask('t.', PERSON)});
      END IF;
      RETURN ${CONTRACT_READABLE};
    END
    $fn$
  `;

export class DataAccessCanRead1854900000000 implements MigrationInterface {
  name = 'DataAccessCanRead1854900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(CAN_READ_FUNCTION);
    await queryRunner.query(`REVOKE EXECUTE ON FUNCTION ${SIGNATURE} FROM PUBLIC`);
    await queryRunner.query(`GRANT EXECUTE ON FUNCTION ${SIGNATURE} TO CURRENT_USER`);
    const [role] = await queryRunner.query(`SELECT to_regrole($1) IS NOT NULL AS present`, [LIMITED_ROLE]);
    if (role?.present) {
      await queryRunner.query(`GRANT EXECUTE ON FUNCTION ${SIGNATURE} TO ${LIMITED_ROLE}`);
    }
    console.log(`${LOG_PREFIX} data_access_can_read ready; limited role ${role?.present ? 'granted' : 'absent'}`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP FUNCTION IF EXISTS ${SIGNATURE}`);
  }
}
