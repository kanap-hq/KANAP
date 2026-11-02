import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The reasoning effort of an AI model: how much a reasoning model thinks before answering
 * (`low`, `medium`, `high`, `xhigh`, `max`). Nullable, no default: an empty value sends nothing,
 * so the provider's own default applies, as before this column.
 *
 * A check keeps the value in that list. A rerun first clears a value outside it (set to NULL,
 * back to the provider's default) before adding the check, with RLS disabled around the repair:
 * migrations run without app.current_tenant and FORCE applies to the owner. RLS is restored to
 * ENABLE + FORCE, the state found before.
 *
 * Idempotent: `ADD COLUMN IF NOT EXISTS` and a check added only when missing. `down()` drops both.
 */
export class AiModelReasoningEffort1855970000000 implements MigrationInterface {
  name = 'AiModelReasoningEffort1855970000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE ai_model_configs ADD COLUMN IF NOT EXISTS reasoning_effort varchar(10)`);

    await queryRunner.query(`ALTER TABLE ai_model_configs DISABLE ROW LEVEL SECURITY`);
    const repaired: Array<{ count: string | number }> = await queryRunner.query(`
      WITH changed AS (
        UPDATE ai_model_configs
        SET reasoning_effort = NULL
        WHERE reasoning_effort IS NOT NULL
          AND reasoning_effort NOT IN ('low', 'medium', 'high', 'xhigh', 'max')
        RETURNING 1
      )
      SELECT count(*) AS count FROM changed
    `);
    await queryRunner.query(`ALTER TABLE ai_model_configs ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE ai_model_configs FORCE ROW LEVEL SECURITY`);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'chk_ai_model_configs_reasoning_effort'
            AND conrelid = 'ai_model_configs'::regclass
        ) THEN
          ALTER TABLE ai_model_configs
            ADD CONSTRAINT chk_ai_model_configs_reasoning_effort
            CHECK (reasoning_effort IS NULL OR reasoning_effort IN ('low', 'medium', 'high', 'xhigh', 'max'));
        END IF;
      END $$;
    `);
    console.log(
      `[Migration] AI models: reasoning effort column ready (${Number(repaired[0]?.count ?? 0)} unknown value(s) cleared)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE ai_model_configs DROP CONSTRAINT IF EXISTS chk_ai_model_configs_reasoning_effort`);
    await queryRunner.query(`ALTER TABLE ai_model_configs DROP COLUMN IF EXISTS reasoning_effort`);
  }
}
