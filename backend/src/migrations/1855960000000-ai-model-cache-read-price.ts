import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The price of a prompt token read from the provider's cache, per AI model (€ per million tokens,
 * "cached input" on most pricing pages). Nullable, no default: an empty price falls back to the
 * input price times the provider's cache read factor (`ai-llm-cost.util.ts`).
 *
 * Like the input and output prices, it may not be negative. A rerun first clears a negative price
 * (set to NULL, so the input price applies again) before adding the check, with RLS disabled around
 * the repair: migrations run without app.current_tenant and FORCE applies to the owner. RLS is
 * restored to ENABLE + FORCE, the state found before.
 *
 * Idempotent: `ADD COLUMN IF NOT EXISTS` and a check added only when missing. `down()` drops both.
 */
export class AiModelCacheReadPrice1855960000000 implements MigrationInterface {
  name = 'AiModelCacheReadPrice1855960000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE ai_model_configs ADD COLUMN IF NOT EXISTS price_cache_read_eur_per_mtok numeric(12,4)`,
    );

    await queryRunner.query(`ALTER TABLE ai_model_configs DISABLE ROW LEVEL SECURITY`);
    const repaired: Array<{ count: string | number }> = await queryRunner.query(`
      WITH changed AS (
        UPDATE ai_model_configs
        SET price_cache_read_eur_per_mtok = NULL
        WHERE price_cache_read_eur_per_mtok < 0
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
          WHERE conname = 'chk_ai_model_configs_cache_read_price_non_negative'
            AND conrelid = 'ai_model_configs'::regclass
        ) THEN
          ALTER TABLE ai_model_configs
            ADD CONSTRAINT chk_ai_model_configs_cache_read_price_non_negative
            CHECK (price_cache_read_eur_per_mtok IS NULL OR price_cache_read_eur_per_mtok >= 0);
        END IF;
      END $$;
    `);
    console.log(
      `[Migration] AI models: cache read price column ready (${Number(repaired[0]?.count ?? 0)} negative price(s) cleared)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE ai_model_configs DROP CONSTRAINT IF EXISTS chk_ai_model_configs_cache_read_price_non_negative`,
    );
    await queryRunner.query(`ALTER TABLE ai_model_configs DROP COLUMN IF EXISTS price_cache_read_eur_per_mtok`);
  }
}
