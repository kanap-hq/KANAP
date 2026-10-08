import { MigrationInterface, QueryRunner } from 'typeorm';

const LOG_PREFIX = '[Migration] AiIncludedModelConfirmation:';

/** The provider and region the included model has when it calls the Anthropic API directly. */
const ANTHROPIC_DIRECT = { name: 'Anthropic', location: 'US', host: 'api.anthropic.com' } as const;

const DISCLOSURE_WARNING = 'included model disclosure not set: fill it in the platform console; workspaces will be asked to confirm';

type PlatformRow = {
  id: string;
  provider: string;
  endpoint_url: string | null;
  disclosure_name: string | null;
  disclosure_location: string | null;
};

/**
 * Confirmation of the KANAP included model by each workspace.
 *
 * 1. Columns, nullable, no constraint: platform_ai_config.disclosure_name and
 *    disclosure_location (the provider name and processing location shown to
 *    customers), ai_settings.builtin_accepted_key, builtin_accepted_at and
 *    builtin_accepted_by (a workspace's confirmation).
 * 2. When the platform row has no provider name yet and calls the Anthropic API
 *    directly (provider anthropic, no endpoint or the api.anthropic.com host), it is
 *    shown as Anthropic, processed in the US. Any other platform setup is left empty
 *    with a warning: the platform console fills it in, and until then the included
 *    model is unavailable.
 *
 * No workspace is marked as confirmed: an administrator of each workspace confirms the
 * included model in the application before its data reaches it. The migration writes
 * nothing in tenant tables.
 *
 * Idempotent: a second run finds the columns and the provider name in place and changes
 * nothing. In single-tenant installations the platform table is empty: step 2 does
 * nothing and the columns stay empty. down() drops the columns.
 */
export class AiIncludedModelConfirmation1853880000000 implements MigrationInterface {
  name = 'AiIncludedModelConfirmation1853880000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE platform_ai_config ADD COLUMN IF NOT EXISTS disclosure_name text`);
    await queryRunner.query(`ALTER TABLE platform_ai_config ADD COLUMN IF NOT EXISTS disclosure_location text`);
    await queryRunner.query(`ALTER TABLE ai_settings ADD COLUMN IF NOT EXISTS builtin_accepted_key text`);
    await queryRunner.query(`ALTER TABLE ai_settings ADD COLUMN IF NOT EXISTS builtin_accepted_at timestamptz`);
    await queryRunner.query(`ALTER TABLE ai_settings ADD COLUMN IF NOT EXISTS builtin_accepted_by uuid`);

    const [platform]: PlatformRow[] = await queryRunner.query(
      `SELECT id, provider, endpoint_url, disclosure_name, disclosure_location
         FROM platform_ai_config
        WHERE singleton = true`,
    );
    if (!platform) {
      console.log(`${LOG_PREFIX} no included model is configured, nothing to do`);
      return;
    }
    if (!platform.disclosure_name?.trim()) {
      if (!callsAnthropicDirectly(platform)) {
        console.warn(`${LOG_PREFIX} ${DISCLOSURE_WARNING}`);
        return;
      }
      await queryRunner.query(
        `UPDATE platform_ai_config SET disclosure_name = $1, disclosure_location = $2 WHERE id = $3`,
        [ANTHROPIC_DIRECT.name, ANTHROPIC_DIRECT.location, platform.id],
      );
      console.log(`${LOG_PREFIX} included model shown as ${ANTHROPIC_DIRECT.name}, processed in ${ANTHROPIC_DIRECT.location}`);
      return;
    }
    // Same rule as the platform console: a region code in upper case, or EU.
    if (!/^[A-Z]{2}$/.test(platform.disclosure_location ?? '')) {
      console.warn(`${LOG_PREFIX} ${DISCLOSURE_WARNING}`);
      return;
    }
    console.log(`${LOG_PREFIX} included model disclosure already set, nothing to do`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE ai_settings DROP COLUMN IF EXISTS builtin_accepted_by`);
    await queryRunner.query(`ALTER TABLE ai_settings DROP COLUMN IF EXISTS builtin_accepted_at`);
    await queryRunner.query(`ALTER TABLE ai_settings DROP COLUMN IF EXISTS builtin_accepted_key`);
    await queryRunner.query(`ALTER TABLE platform_ai_config DROP COLUMN IF EXISTS disclosure_location`);
    await queryRunner.query(`ALTER TABLE platform_ai_config DROP COLUMN IF EXISTS disclosure_name`);
  }
}

/** Same rule as endpointHostOf in ai/platform/platform-ai-config.service.ts. */
function endpointHostOf(endpointUrl: string | null): string {
  const raw = endpointUrl?.trim() ?? '';
  if (!raw) return '';
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

function callsAnthropicDirectly(platform: PlatformRow): boolean {
  if (platform.provider !== 'anthropic') return false;
  const host = endpointHostOf(platform.endpoint_url);
  return host === '' || host === ANTHROPIC_DIRECT.host;
}
