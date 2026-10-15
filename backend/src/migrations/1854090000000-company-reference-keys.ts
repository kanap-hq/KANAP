import { MigrationInterface, QueryRunner } from 'typeorm';
import { ensureReferenceKey, type ReferenceKey } from '../common/migration-reference-keys';

/**
 * Every reference to a company is ON DELETE RESTRICT: a company still used cannot be deleted,
 * and deleting one no longer cascades to departments, application and interface links, nor clears
 * users, locations, tasks or budget lines. Its own yearly metrics (`company_metrics`) still go
 * with it. Contracts and cost centers already restrict; `spend_allocations` has NO ACTION, which
 * refuses the same way. The dormant `capex_*` tables are left as they are.
 *
 * Per column, the keys it has into companies are replaced by one key `fk_<table>_<column>`
 * (users carried two identical ones; the portfolio columns had none).
 *
 * The migration succeeds on any data (`common/migration-reference-keys.ts`). Rows that name a
 * company missing in their tenant are counted per tenant in the log and
 * - `departments.company_id` (NOT NULL): kept; the key is added NOT VALID, so every new write is
 *   checked at once, and validated once no such department is left;
 * - users, locations, tasks, budget lines and the portfolio columns (nullable): the company is
 *   cleared, then the key is validated;
 * - application and interface links: deleted, then the key is validated.
 * A rerun validates a key left NOT VALID once its rows are fixed.
 */

const restrict = (table: string, column: string, orphans: ReferenceKey['orphans']): ReferenceKey => ({
  table,
  column,
  refTable: 'companies',
  name: `fk_${table}_${column}`,
  onDelete: 'RESTRICT',
  orphans,
});

const KEYS: readonly ReferenceKey[] = [
  restrict('departments', 'company_id', 'keep'),
  restrict('users', 'company_id', 'clear'),
  restrict('locations', 'operating_company_id', 'clear'),
  restrict('tasks', 'company_id', 'clear'),
  restrict('spend_items', 'paying_company_id', 'clear'),
  restrict('application_companies', 'company_id', 'delete'),
  restrict('interface_companies', 'company_id', 'delete'),
  restrict('portfolio_projects', 'company_id', 'clear'),
  restrict('portfolio_requests', 'company_id', 'clear'),
  restrict('portfolio_team_member_configs', 'default_company_id', 'clear'),
];

const PREFIX = '[Migration] CompanyReferenceKeys:';

export class CompanyReferenceKeys1854090000000 implements MigrationInterface {
  name = 'CompanyReferenceKeys1854090000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const key of KEYS) await ensureReferenceKey(queryRunner, key, (line) => console.log(`${PREFIX} ${line}`));
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
    for (const key of KEYS) {
      await queryRunner.query(`ALTER TABLE ${key.table} DROP CONSTRAINT IF EXISTS ${key.name}`);
      const action = former[key.table];
      if (action) {
        await queryRunner.query(
          `ALTER TABLE ${key.table} ADD CONSTRAINT ${key.name} FOREIGN KEY (${key.column}) REFERENCES companies(id) ON DELETE ${action}`,
        );
      }
    }
  }
}
