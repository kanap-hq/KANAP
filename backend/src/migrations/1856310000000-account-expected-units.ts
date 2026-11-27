import { MigrationInterface, QueryRunner } from 'typeorm';
import { dropUpdatedAtTriggers, syncUpdatedAtTrigger } from '../common/updated-at-trigger';

const CONSTRAINT = 'accounts_expected_units_check';

/**
 * The units an account expects its budget lines' calculation lines in, an option of the
 * "quantity and price entry" setting (`quantity_price_expected`, migration 1856280000000):
 * `accounts.expected_units text[] NULL`, the codes of the calculation lines' units
 * (`spend_round_input_lines.quantity_unit`: `people`, `days`, `pieces`), in the budget tab's order.
 * `NULL` is no unit set: the check reads the entry mode alone. Never an empty list, and never a unit
 * on an account without the setting: unticking the setting clears its units. The check
 * `accounts_expected_units_check` holds both in the database.
 *
 * Text rather than the units' enum: the rule compares it to `quantity_unit::text` and the screens,
 * the import and Kad read plain codes. Every account starts without units: nothing is written, no
 * row can break the check (the column is new). `accounts` is already under tenant isolation; the
 * column and the check change no policy.
 *
 * `accounts` keeps its modification date by trigger (migration 1856270000000): the trigger is
 * placed again so that its `WHEN` compares the new column, and a change of the units dates the
 * account. Rerun-safe (`IF NOT EXISTS`, the check added once); down() drops the trigger, the check
 * and the column, then places the trigger again on the columns left when it was there.
 */
export class AccountExpectedUnits1856310000000 implements MigrationInterface {
  name = 'AccountExpectedUnits1856310000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS expected_units text[] NULL`);
    await queryRunner.query(`DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'accounts'::regclass AND conname = '${CONSTRAINT}') THEN
          ALTER TABLE accounts ADD CONSTRAINT ${CONSTRAINT} CHECK (
            expected_units IS NULL
            OR (quantity_price_expected IS TRUE AND cardinality(expected_units) > 0
              AND expected_units <@ ARRAY['people', 'days', 'pieces']::text[])
          );
        END IF;
      END $$`);
    await syncUpdatedAtTrigger(queryRunner, 'accounts');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE accounts DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`);
    // The trigger's WHEN names the column: PostgreSQL refuses to drop it while the trigger stands.
    const dropped = await dropUpdatedAtTriggers(queryRunner, ['accounts']);
    await queryRunner.query(`ALTER TABLE accounts DROP COLUMN IF EXISTS expected_units`);
    if (dropped.length > 0) await syncUpdatedAtTrigger(queryRunner, 'accounts');
  }
}
