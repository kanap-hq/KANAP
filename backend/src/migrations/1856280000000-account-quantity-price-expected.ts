import { MigrationInterface, QueryRunner } from 'typeorm';

const CONSTRAINT = 'accounts_quantity_price_expected_check';

/**
 * Whether an account expects its budget lines to be entered as quantity and price:
 * `accounts.quantity_price_expected boolean NULL`. Two states only: `true` (expected) and `NULL`
 * (not set). Nothing writes `false`, so that a later "not expected" setting would find no stored
 * `false` to misread; the check `accounts_quantity_price_expected_check` holds it in the database.
 * The setting is read on demand (the line's account, else its consolidation account): the chart
 * templates do not carry it and no budget line is rewritten.
 *
 * Every account starts unset. Before the check is added, a stored `false` (none is expected) is
 * set back to `NULL`, with row level security off around the repair (migrations run without a
 * tenant, so a forced policy would hide every row) and put back as found; the count is logged.
 * `accounts` is already under tenant isolation; the column and the check change no policy.
 * Rerun-safe (`IF NOT EXISTS`, the check added once); down() drops the check and the column.
 */
export class AccountQuantityPriceExpected1856280000000 implements MigrationInterface {
  name = 'AccountQuantityPriceExpected1856280000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS quantity_price_expected boolean NULL`);

    const [security] = await queryRunner.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'accounts'::regclass`);
    await queryRunner.query(`ALTER TABLE accounts DISABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE accounts NO FORCE ROW LEVEL SECURITY`);
    const [repaired] = await queryRunner.query(
      `WITH changed AS (UPDATE accounts SET quantity_price_expected = NULL WHERE quantity_price_expected = false RETURNING 1)
       SELECT count(*)::int AS count FROM changed`,
    );
    if (security.relrowsecurity) await queryRunner.query(`ALTER TABLE accounts ENABLE ROW LEVEL SECURITY`);
    if (security.relforcerowsecurity) await queryRunner.query(`ALTER TABLE accounts FORCE ROW LEVEL SECURITY`);
    console.log(`[1856280000000] accounts.quantity_price_expected: ${repaired.count} stored false set back to NULL`);

    await queryRunner.query(`DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'accounts'::regclass AND conname = '${CONSTRAINT}') THEN
          ALTER TABLE accounts ADD CONSTRAINT ${CONSTRAINT} CHECK (quantity_price_expected IS NULL OR quantity_price_expected);
        END IF;
      END $$`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE accounts DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`);
    await queryRunner.query(`ALTER TABLE accounts DROP COLUMN IF EXISTS quantity_price_expected`);
  }
}
