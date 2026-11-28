import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The AI settings of the installation set on the screen (Paramétrage, lot S3): one row
 * (`singleton`), without `tenant_id` or row level security, like `platform_ai_config`. Every
 * column is null until it is set; the configuration file still wins over it. No trigger: the
 * service dates the row. Creates the table only, writes no row: rerun-safe.
 */
export class InstallationAiSettings1856320000000 implements MigrationInterface {
  name = 'InstallationAiSettings1856320000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS installation_ai_settings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        singleton boolean NOT NULL DEFAULT true UNIQUE CHECK (singleton = true),
        web_search_api_key_encrypted text,
        chat_max_tokens integer CHECK (chat_max_tokens > 0),
        ticket_max_images integer CHECK (ticket_max_images BETWEEN 1 AND 10),
        ticket_max_image_bytes integer CHECK (ticket_max_image_bytes > 0),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS installation_ai_settings`);
  }
}
