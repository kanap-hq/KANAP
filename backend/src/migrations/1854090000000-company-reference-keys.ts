import { MigrationInterface, QueryRunner } from 'typeorm';
import { withRlsDisabled } from '../common/migration-rls';

/**
 * Every reference to a company is ON DELETE RESTRICT: a company still used cannot be deleted,
 * and deleting one no longer cascades to departments, application and interface links, nor clears
 * users, locations, tasks or budget lines. Its own yearly metrics (`company_metrics`) still go
 * with it. Contracts and cost centers already restrict; `spend_allocations` has NO ACTION, which
 * refuses the same way. The dormant `capex_*` tables are left as they are.
 *
 * Per column: the keys it has into companies are dropped (users carries two identical ones) and
 * one key `fk_<table>_<column>` is added. The portfolio columns had no key at all.
 *
 * Before changing anything, the migration looks for rows that name a company missing in their
 * tenant, across every tenant, and fails when it finds one, listing tenant, table, row id and
 * column, with no key changed. A reference to another tenant's company counts as missing: the
 * application never shows it. Fix those rows (choose an existing company or clear it), then
 * deploy again. A rerun changes only the columns not done yet.
 *
 * Read-only check to run on a server before the deploy, in psql as a superuser (RLS does not
 * apply to it; as the table owner, run it once per tenant after
 * `SELECT set_config('app.current_tenant', '<tenant uuid>', true)`):
 *
 *   BEGIN READ ONLY;
 *   WITH refs AS (
 *     SELECT 'departments' AS tbl, 'company_id' AS col, tenant_id, id, company_id AS company FROM departments
 *     UNION ALL SELECT 'users', 'company_id', tenant_id, id, company_id FROM users
 *     UNION ALL SELECT 'locations', 'operating_company_id', tenant_id, id, operating_company_id FROM locations
 *     UNION ALL SELECT 'tasks', 'company_id', tenant_id, id, company_id FROM tasks
 *     UNION ALL SELECT 'spend_items', 'paying_company_id', tenant_id, id, paying_company_id FROM spend_items
 *     UNION ALL SELECT 'application_companies', 'company_id', tenant_id, id, company_id FROM application_companies
 *     UNION ALL SELECT 'interface_companies', 'company_id', tenant_id, id, company_id FROM interface_companies
 *     UNION ALL SELECT 'portfolio_projects', 'company_id', tenant_id, id, company_id FROM portfolio_projects
 *     UNION ALL SELECT 'portfolio_requests', 'company_id', tenant_id, id, company_id FROM portfolio_requests
 *     UNION ALL SELECT 'portfolio_team_member_configs', 'default_company_id', tenant_id, id, default_company_id
 *                 FROM portfolio_team_member_configs
 *   )
 *   SELECT t.slug, r.tenant_id, r.tbl, r.id, r.col, r.company
 *     FROM refs r LEFT JOIN tenants t ON t.id = r.tenant_id
 *    WHERE r.company IS NOT NULL
 *      AND NOT EXISTS (SELECT 1 FROM companies c WHERE c.id = r.company AND c.tenant_id = r.tenant_id)
 *    ORDER BY t.slug, r.tbl, r.id;
 *   ROLLBACK;
 *
 * Any row it returns stops this migration.
 *
 * Migrations run without app.current_tenant and FORCE RLS applies to the owner, so RLS is
 * disabled on the tables read around the check, then put back as found (`common/migration-rls.ts`).
 */

type Ref = { table: string; column: string };

const COMPANY_REFERENCES: readonly Ref[] = [
  { table: 'departments', column: 'company_id' },
  { table: 'users', column: 'company_id' },
  { table: 'locations', column: 'operating_company_id' },
  { table: 'tasks', column: 'company_id' },
  { table: 'spend_items', column: 'paying_company_id' },
  { table: 'application_companies', column: 'company_id' },
  { table: 'interface_companies', column: 'company_id' },
  { table: 'portfolio_projects', column: 'company_id' },
  { table: 'portfolio_requests', column: 'company_id' },
  { table: 'portfolio_team_member_configs', column: 'default_company_id' },
];

const PREFIX = '[Migration] CompanyReferenceKeys:';

type Orphan = { slug: string | null; tenant_id: string; table_name: string; id: string; column_name: string };

const keyName = (ref: Ref) => `fk_${ref.table}_${ref.column}`;

export class CompanyReferenceKeys1854090000000 implements MigrationInterface {
  name = 'CompanyReferenceKeys1854090000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const keys: Array<{ tbl: string; col: string; conname: string; action: string }> = await queryRunner.query(
      `SELECT c.conrelid::regclass::text AS tbl, a.attname AS col, c.conname, c.confdeltype AS action
         FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.contype = 'f' AND c.confrelid = 'companies'::regclass AND array_length(c.conkey, 1) = 1`,
    );
    const keysOf = (ref: Ref) => keys.filter((key) => key.tbl === ref.table && key.col === ref.column);
    const todo = COMPANY_REFERENCES.filter((ref) => {
      const current = keysOf(ref);
      return !(current.length === 1 && current[0].conname === keyName(ref) && current[0].action === 'r');
    });
    if (todo.length === 0) {
      console.log(`${PREFIX} every key restricts, nothing to do`);
      return;
    }

    const orphans: Orphan[] = await withRlsDisabled(
      queryRunner,
      [...todo.map((ref) => ref.table), 'companies'],
      () =>
        queryRunner.query(`
          SELECT t.slug, o.tenant_id, o.table_name, o.id, o.column_name
            FROM (${todo
              .map(
                (ref) => `SELECT x.tenant_id, '${ref.table}' AS table_name, x.id, '${ref.column}' AS column_name
                            FROM ${ref.table} x
                           WHERE x.${ref.column} IS NOT NULL
                             AND NOT EXISTS (SELECT 1 FROM companies c WHERE c.id = x.${ref.column} AND c.tenant_id = x.tenant_id)`,
              )
              .join('\n UNION ALL ')}) o
            LEFT JOIN tenants t ON t.id = o.tenant_id
           ORDER BY t.slug NULLS LAST, o.tenant_id, o.table_name, o.id
        `),
    );
    if (orphans.length > 0) throw new Error(orphanReport(orphans));
    console.log(`${PREFIX} every reference names an existing company of its tenant`);

    for (const ref of todo) {
      for (const key of keysOf(ref)) {
        await queryRunner.query(`ALTER TABLE ${ref.table} DROP CONSTRAINT ${key.conname}`);
      }
      await queryRunner.query(
        `ALTER TABLE ${ref.table} ADD CONSTRAINT ${keyName(ref)} FOREIGN KEY (${ref.column}) REFERENCES companies(id) ON DELETE RESTRICT`,
      );
      const was = keysOf(ref).map((key) => `${key.conname} (${key.action})`).join(', ') || 'no key';
      console.log(`${PREFIX} ${ref.table}.${ref.column}: ${keyName(ref)} ON DELETE RESTRICT, replacing ${was}`);
    }
  }

  /** Back to one key per column with the former delete action; the portfolio columns lose theirs. */
  public async down(queryRunner: QueryRunner): Promise<void> {
    const former: Record<string, string> = {
      departments: 'CASCADE',
      users: 'SET NULL',
      locations: 'SET NULL',
      tasks: 'SET NULL',
      spend_items: 'SET NULL',
      application_companies: 'CASCADE',
      interface_companies: 'CASCADE',
    };
    for (const ref of COMPANY_REFERENCES) {
      await queryRunner.query(`ALTER TABLE ${ref.table} DROP CONSTRAINT IF EXISTS ${keyName(ref)}`);
      const action = former[ref.table];
      if (action) {
        await queryRunner.query(
          `ALTER TABLE ${ref.table} ADD CONSTRAINT ${keyName(ref)} FOREIGN KEY (${ref.column}) REFERENCES companies(id) ON DELETE ${action}`,
        );
      }
    }
  }
}

function orphanReport(orphans: Orphan[]): string {
  return [
    `${PREFIX} ${orphans.length} row(s) name a company that does not exist in their tenant. ` +
      'No key was changed. Choose an existing company on these rows or clear it, then run the migrations again:',
    ...orphans.map(
      (row) => `  tenant ${row.slug ?? '(unknown)'} (${row.tenant_id}): ${row.table_name} ${row.id}: ${row.column_name} missing`,
    ),
  ].join('\n');
}
