import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Whether an account expects its budget lines to be entered as quantity and price:
 * `accounts.quantity_price_expected boolean NULL`. Two states only: `true` (expected) and `NULL`
 * (not set). Nothing writes `false`, so that a later "not expected" setting would find no stored
 * `false` to misread. The setting is read on demand (the line's account, else its consolidation
 * account): the chart templates do not carry it and no budget line is rewritten.
 *
 * No data is written: every account starts unset. `accounts` is already under tenant isolation;
 * adding a nullable column changes no policy. Rerun-safe (`IF NOT EXISTS`); down() drops the column.
 */
export class AccountQuantityPriceExpected1856280000000 implements MigrationInterface {
  name = 'AccountQuantityPriceExpected1856280000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS quantity_price_expected boolean NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE accounts DROP COLUMN IF EXISTS quantity_price_expected`);
  }
}
