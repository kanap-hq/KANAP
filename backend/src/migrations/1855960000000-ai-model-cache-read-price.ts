import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The price of a prompt token read from the provider's cache, per AI model (€ per million tokens,
 * "cached input" on most pricing pages). Nullable, no default: an empty price falls back to the
 * input price times the provider's cache read factor (`ai-llm-cost.util.ts`).
 *
 * Idempotent: `ADD COLUMN IF NOT EXISTS`, so a second run changes nothing. `down()` drops it.
 */
export class AiModelCacheReadPrice1855960000000 implements MigrationInterface {
  name = 'AiModelCacheReadPrice1855960000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE ai_model_configs ADD COLUMN IF NOT EXISTS price_cache_read_eur_per_mtok numeric(12,4)`,
    );
    console.log('[Migration] AI models: cache read price column ready');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE ai_model_configs DROP COLUMN IF EXISTS price_cache_read_eur_per_mtok`);
  }
}
