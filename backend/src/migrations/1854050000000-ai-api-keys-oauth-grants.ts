import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * MCP OAuth connections (ai/oauth): each grant an MCP client receives is a row of `ai_api_keys`,
 * next to the API keys. `key_hash` holds the hash of the grant's current refresh token.
 *
 * Columns only, every one nullable or with a default: no existing row is rewritten, existing keys
 * read as `credential_kind = 'api_key'`. The partial unique index makes an authorization code
 * single-use: the first exchange writes its `jti`, a replay collides with it.
 */
export class AiApiKeysOauthGrants1854050000000 implements MigrationInterface {
  name = 'AiApiKeysOauthGrants1854050000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE ai_api_keys
        ADD COLUMN IF NOT EXISTS credential_kind text NOT NULL DEFAULT 'api_key',
        ADD COLUMN IF NOT EXISTS oauth_client_id text NULL,
        ADD COLUMN IF NOT EXISTS oauth_client_name text NULL,
        ADD COLUMN IF NOT EXISTS oauth_redirect_uri text NULL,
        ADD COLUMN IF NOT EXISTS oauth_code_jti uuid NULL,
        ADD COLUMN IF NOT EXISTS refresh_rotated_at timestamptz NULL,
        ADD COLUMN IF NOT EXISTS oauth_remember boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'ai_api_keys_credential_kind_check'
            AND conrelid = 'ai_api_keys'::regclass
        ) THEN
          ALTER TABLE ai_api_keys
            ADD CONSTRAINT ai_api_keys_credential_kind_check
            CHECK (credential_kind IN ('api_key', 'oauth'));
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ai_api_keys_tenant_oauth_code_jti_uq
        ON ai_api_keys (tenant_id, oauth_code_jti)
        WHERE oauth_code_jti IS NOT NULL
    `);
    // Remembered consent: the grants of one user for one client.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS ai_api_keys_tenant_user_oauth_client_idx
        ON ai_api_keys (tenant_id, user_id, oauth_client_id)
        WHERE credential_kind = 'oauth'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS ai_api_keys_tenant_user_oauth_client_idx`);
    await queryRunner.query(`DROP INDEX IF EXISTS ai_api_keys_tenant_oauth_code_jti_uq`);
    await queryRunner.query(`ALTER TABLE ai_api_keys DROP CONSTRAINT IF EXISTS ai_api_keys_credential_kind_check`);
    await queryRunner.query(`
      ALTER TABLE ai_api_keys
        DROP COLUMN IF EXISTS oauth_remember,
        DROP COLUMN IF EXISTS refresh_rotated_at,
        DROP COLUMN IF EXISTS oauth_code_jti,
        DROP COLUMN IF EXISTS oauth_redirect_uri,
        DROP COLUMN IF EXISTS oauth_client_name,
        DROP COLUMN IF EXISTS oauth_client_id,
        DROP COLUMN IF EXISTS credential_kind
    `);
  }
}
