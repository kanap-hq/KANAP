import { MigrationInterface, QueryRunner } from 'typeorm';

const LOG_PREFIX = '[Migration] AiIncludedModelConfirmation:';

/** The provider and region the included model has when it calls the Anthropic API directly. */
const ANTHROPIC_DIRECT = { name: 'Anthropic', location: 'US', host: 'api.anthropic.com' } as const;

/**
 * Agent definitions in this status run (manual runs and watching); `draft`, `disabled`
 * and `archived` never run. The run guards (AiAgentWorkQueueService
 * assertHelpdeskTicketingDefinitionRunnable / assertSreMonitoringDefinitionRunnable)
 * refuse any other status, and the scheduled pollers load `enabled` definitions only.
 */
const RUNNING_AGENT_STATUS = 'enabled';

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
 * 3. When the platform identity is filled, workspaces that already send data to the
 *    included model are marked as confirmed for it, with no author
 *    (builtin_accepted_by null, shown as "confirmed automatically"): those with the
 *    assistant turned on, or with at least one agent in the `enabled` status
 *    (RUNNING_AGENT_STATUS). MCP alone does not count: it sends nothing to the
 *    included model. A workspace with such an agent but no ai_settings row gets one,
 *    with the defaults of AiSettingsService.get plus the confirmation. Other
 *    workspaces confirm when they first turn AI on. ai_settings and
 *    ai_agent_definitions are under forced row level security and migrations run
 *    without app.current_tenant: RLS is off on both around the statements and
 *    restored to the state found, in the same transaction.
 *
 * The key written is builtinProviderKey({ provider, endpointHost, name, location }) of
 * ai/platform/platform-ai-config.service.ts, `${provider}|${endpointHost}|${name}|${location}`
 * with the endpoint host in lower case, empty without an endpoint (so `anthropic||Anthropic|US`
 * for the Anthropic API): keep both in step.
 *
 * Idempotent: a second run finds the identity filled and every marked workspace
 * already confirmed, and changes nothing. In single-tenant installations the
 * platform table is empty: steps 2 and 3 do nothing and the columns stay empty.
 * down() drops the columns.
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

    let name = platform.disclosure_name?.trim() || null;
    let location = platform.disclosure_location;
    if (name == null) {
      if (callsAnthropicDirectly(platform)) {
        await queryRunner.query(
          `UPDATE platform_ai_config SET disclosure_name = $1, disclosure_location = $2 WHERE id = $3`,
          [ANTHROPIC_DIRECT.name, ANTHROPIC_DIRECT.location, platform.id],
        );
        name = ANTHROPIC_DIRECT.name;
        location = ANTHROPIC_DIRECT.location;
        console.log(`${LOG_PREFIX} included model shown as ${name}, processed in ${location}`);
      } else {
        console.warn(
          `${LOG_PREFIX} included model disclosure not set: fill it in the platform console; workspaces will be asked to confirm`,
        );
        return;
      }
    }
    if (!location || !/^[A-Z]{2}$/.test(location)) {
      console.warn(
        `${LOG_PREFIX} included model disclosure not set: fill it in the platform console; workspaces will be asked to confirm`,
      );
      return;
    }

    // Same value as builtinProviderKey({ provider, endpointHost, name, location }) in
    // ai/platform/platform-ai-config.service.ts.
    const key = `${platform.provider}|${endpointHostOf(platform.endpoint_url)}|${name}|${location}`;
    const { updated, created } = await withoutRowSecurity(queryRunner, ['ai_settings', 'ai_agent_definitions'], async () => {
      // Each write is wrapped in a SELECT so the rows it returns are what the query returns.
      const updatedRows: Array<{ tenant_id: string }> = await queryRunner.query(
        `WITH marked AS (
           UPDATE ai_settings s
              SET builtin_accepted_key = $1,
                  builtin_accepted_at = now(),
                  builtin_accepted_by = NULL
            WHERE s.builtin_accepted_key IS NULL
              AND (
                s.chat_enabled = true
                OR EXISTS (
                  SELECT 1 FROM ai_agent_definitions d
                   WHERE d.tenant_id = s.tenant_id AND d.status = $2
                )
              )
            RETURNING s.tenant_id
         )
         SELECT tenant_id FROM marked`,
        [key, RUNNING_AGENT_STATUS],
      );
      const createdRows: Array<{ tenant_id: string }> = await queryRunner.query(
        `WITH created AS (
           INSERT INTO ai_settings (
             tenant_id, chat_enabled, mcp_enabled, provider_source, web_search_enabled,
             llm_supports_vision, glpi_enabled, glpi_url,
             builtin_accepted_key, builtin_accepted_at, builtin_accepted_by
           )
           SELECT DISTINCT d.tenant_id, false, false, 'builtin', false, true, false, NULL::text, $1, now(), NULL::uuid
             FROM ai_agent_definitions d
            WHERE d.status = $2
              AND NOT EXISTS (SELECT 1 FROM ai_settings s WHERE s.tenant_id = d.tenant_id)
           ON CONFLICT (tenant_id) DO NOTHING
           RETURNING tenant_id
         )
         SELECT tenant_id FROM created`,
        [key, RUNNING_AGENT_STATUS],
      );
      return { updated: updatedRows.length, created: createdRows.length };
    });

    if (updated + created === 0) {
      console.log(`${LOG_PREFIX} no workspace to mark as confirmed for ${key}`);
      return;
    }
    console.log(
      `${LOG_PREFIX} ${updated + created} workspace(s) already using AI marked as confirmed for ${key}`
      + ` (${created} AI settings row(s) created)`,
    );
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

/**
 * Runs `fn` with row level security off on the tables, then restores what was found,
 * also when `fn` fails. After a failed statement the transaction is aborted and refuses
 * the restore: its rollback restores the state then, and the error of `fn` is the one
 * reported.
 */
async function withoutRowSecurity<T>(queryRunner: QueryRunner, tables: string[], fn: () => Promise<T>): Promise<T> {
  const states: Array<{ table: string; enabled: boolean; forced: boolean }> = [];
  for (const table of tables) {
    const [state] = await queryRunner.query(
      `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE oid = $1::regclass`,
      [table],
    );
    states.push({ table, enabled: !!state?.enabled, forced: !!state?.forced });
    if (state?.enabled) await queryRunner.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
  }
  let failed = false;
  try {
    return await fn();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      for (const state of states) {
        if (state.enabled) await queryRunner.query(`ALTER TABLE ${state.table} ENABLE ROW LEVEL SECURITY`);
        if (state.forced) await queryRunner.query(`ALTER TABLE ${state.table} FORCE ROW LEVEL SECURITY`);
      }
    } catch (restoreError) {
      if (!failed) throw restoreError;
    }
  }
}
