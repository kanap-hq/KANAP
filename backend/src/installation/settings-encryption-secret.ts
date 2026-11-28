import type { DataSource } from 'typeorm';
import { INSTALLATION_DOMAINS } from './installation-domains';
import type { InstallationDomain } from './installation-settings';

/**
 * The key that encrypts the secrets Kadratis stores (AI provider keys, connection tokens, the
 * installation settings that are secrets): `SETTINGS_ENCRYPTION_SECRET`, or its former name
 * `AI_SETTINGS_ENCRYPTION_SECRET`. A value that is empty or made of spaces counts as absent.
 *
 * Both names set to different values refuse the start: the secrets already stored were encrypted
 * with the former one, and letting the new name win would make them unreadable without a word.
 * Both set to the same value, or one of them only: nothing to say.
 */
export const SETTINGS_ENCRYPTION_SECRET_VARIABLE = 'SETTINGS_ENCRYPTION_SECRET';
export const SETTINGS_ENCRYPTION_SECRET_FORMER_VARIABLE = 'AI_SETTINGS_ENCRYPTION_SECRET';

export class SettingsEncryptionSecretConflictError extends Error {
  constructor() {
    super(
      `FATAL: ${SETTINGS_ENCRYPTION_SECRET_VARIABLE} and ${SETTINGS_ENCRYPTION_SECRET_FORMER_VARIABLE} are both set, to different values. `
      + `The stored secrets were encrypted with ${SETTINGS_ENCRYPTION_SECRET_FORMER_VARIABLE}: keep one of the two names, with that value.`,
    );
    this.name = 'SettingsEncryptionSecretConflictError';
  }
}

function present(value: string | undefined): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** The encryption key, or null when neither name is set. Throws when the two names disagree. */
export function settingsEncryptionSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const current = present(env[SETTINGS_ENCRYPTION_SECRET_VARIABLE]);
  const former = present(env[SETTINGS_ENCRYPTION_SECRET_FORMER_VARIABLE]);
  if (current !== null && former !== null && current !== former) throw new SettingsEncryptionSecretConflictError();
  return current ?? former;
}

/** One condition per secret setting of the installation domains: a stored cipher text. */
function installationSecretsStored(domains: readonly InstallationDomain[]): string[] {
  return domains.flatMap((domain) => domain.settings
    .filter((setting) => setting.type === 'secret')
    .map((setting) => `EXISTS (SELECT 1 FROM ${domain.table} WHERE ${setting.column} IS NOT NULL)`));
}

/**
 * Start-up warning (lead process, after the connection): the key is missing while encrypted
 * secrets are stored, so none of them can be read. Reads the installation tables in both modes
 * (the secret settings of every installation domain, and `platform_ai_config`);
 * on-premise, also the secret tables of the single workspace, with its tenant set (in the cloud the
 * workspaces' tables are under forced row level security: a read without a tenant finds nothing).
 * Null when the key is set or nothing is stored. Never throws: a failed read is a null.
 */
export async function missingEncryptionSecretWarning(
  dataSource: DataSource,
  options: { singleTenant: boolean; tenantSlug?: string | null; env?: NodeJS.ProcessEnv; domains?: readonly InstallationDomain[] },
): Promise<string | null> {
  const env = options.env ?? process.env;
  const installationStored = [...installationSecretsStored(options.domains ?? INSTALLATION_DOMAINS), 'EXISTS (SELECT 1 FROM platform_ai_config)'];
  try {
    if (settingsEncryptionSecret(env) !== null) return null;
  } catch {
    return null; // The conflict already refused the start.
  }
  const runner = dataSource.createQueryRunner();
  try {
    await runner.connect();
    await runner.startTransaction();
    try {
      const [installation] = await runner.query(`SELECT ${installationStored.join(' OR ')} AS stored`);
      let stored = installation?.stored === true;
      if (!stored && options.singleTenant) {
        const [tenant] = await runner.query(`SELECT id FROM tenants WHERE slug = $1 LIMIT 1`, [options.tenantSlug || 'default']);
        if (tenant?.id) {
          await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant.id]);
          const [workspace] = await runner.query(
            `
              SELECT EXISTS (
                       SELECT 1 FROM ai_settings
                        WHERE tenant_id = $1
                          AND (llm_api_key_encrypted IS NOT NULL OR glpi_user_token_encrypted IS NOT NULL OR glpi_app_token_encrypted IS NOT NULL)
                     )
                  OR EXISTS (SELECT 1 FROM ai_model_configs WHERE tenant_id = $1 AND api_key_encrypted IS NOT NULL)
                  OR EXISTS (SELECT 1 FROM ai_adapter_configs WHERE tenant_id = $1 AND credential_ref_json->>'kind' = 'encrypted')
                  AS stored
            `,
            [tenant.id],
          );
          stored = workspace?.stored === true;
        }
      }
      if (!stored) return null;
      return `[SECRETS] ${SETTINGS_ENCRYPTION_SECRET_VARIABLE} is not set while encrypted secrets are stored: `
        + 'the AI provider keys, connection tokens and installation secrets cannot be read. '
        + `Set ${SETTINGS_ENCRYPTION_SECRET_VARIABLE} (or ${SETTINGS_ENCRYPTION_SECRET_FORMER_VARIABLE}) to the value they were stored with.`;
    } finally {
      await runner.rollbackTransaction();
    }
  } catch {
    return null;
  } finally {
    await runner.release();
  }
}
