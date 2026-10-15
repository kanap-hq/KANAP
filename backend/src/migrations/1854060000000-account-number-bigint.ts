import { MigrationInterface, QueryRunner } from 'typeorm';

const COLUMNS = ['account_number', 'consolidation_account_number'] as const;

/**
 * Account numbers of up to 15 digits (`backend/src/accounts/account-number.ts`): ERP charts
 * use 10 digits and more, above the `integer` range. `accounts.account_number` and
 * `accounts.consolidation_account_number` become `bigint`.
 *
 * A type change only: every stored value fits, no row is repaired. PostgreSQL rewrites the
 * table and rebuilds its indexes (`uq_accounts_tenant_coa_number` among them) whatever the
 * row level security, and fires no row trigger (the search index is left as it is). No view
 * depends on the columns; the search index functions read them as text.
 *
 * Idempotent: a column already `bigint` is left alone. down() goes back to `integer` and fails
 * on a number above the integer range, which an `integer` column cannot hold.
 */
export class AccountNumberBigint1854060000000 implements MigrationInterface {
  name = 'AccountNumberBigint1854060000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const changed = await this.setType(queryRunner, 'integer', 'bigint');
    console.log(`[Migration] AccountNumberBigint: ${changed.length} column(s) changed to bigint${changed.length ? ` (${changed.join(', ')})` : ''}.`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.setType(queryRunner, 'bigint', 'integer');
  }

  /** Changes the columns still of type `from` to `to`, in one statement; returns their names. */
  private async setType(queryRunner: QueryRunner, from: string, to: string): Promise<string[]> {
    const rows: Array<{ column_name: string }> = await queryRunner.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'accounts'
         AND column_name = ANY($1::text[]) AND data_type = $2
       ORDER BY column_name`,
      [COLUMNS, from],
    );
    const columns = rows.map((row) => row.column_name);
    if (columns.length === 0) return [];
    await queryRunner.query(
      `ALTER TABLE accounts ${columns.map((column) => `ALTER COLUMN ${column} TYPE ${to}`).join(', ')}`,
    );
    return columns;
  }
}
