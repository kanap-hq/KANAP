import { MigrationInterface, QueryRunner } from 'typeorm';

/** The token hash prefix of a pending Microsoft link confirmation (`auth/entra-link-confirmation.ts`). */
const LINK_CONFIRMATION_PREFIX = 'entra-link:';
/** `source_ref` of the history entries this migration writes. */
const SOURCE_REF = 'migration:1856230000000-entra-disconnected-accounts-local';
const LOG_PREFIX = '[Migration] EntraDisconnectedAccountsLocal:';

/**
 * Removing a workspace's Microsoft connection now makes every linked account local
 * (`auth/entra-disconnect.service.ts`). A workspace disconnected before that kept the links on its
 * accounts: "Forgot password" still refused them and the sign-in page sent them to Microsoft. This
 * applies the same change to every workspace that is not connected now.
 *
 * Not connected: anything but `sso_provider = 'entra'` with an `entra_tenant_id`, the condition
 * under which Microsoft sign-in accepts the workspace (`lockTenantConnection`, `startLogin`, the
 * disconnect itself). A connected workspace whose `sso_enabled` is false (its directory sync off)
 * still signs its people in with Microsoft: its accounts are left alone.
 *
 * In each such workspace, every account linked to an identity provider gets its provider, subject
 * and last directory refresh cleared, as the disconnect does; a stored password stays. Each gets
 * one history entry (source `system`, `source_ref` naming this migration, no author), written by
 * the same statement. Pending link confirmations of the workspace are voided. Accounts of a
 * connected workspace and other password reset links are not touched.
 *
 * Row level security stays on: `users` carries the search index trigger
 * (`search_index_sync_users`), which writes `search_index` under its row level security, so the
 * writes run one workspace at a time with its app.current_tenant (as 1853940000000), and the
 * setting found before is put back: all pending migrations share one transaction. Counts are
 * logged per workspace changed, and in total. Rerun-safe: a second run finds no linked account in
 * these workspaces and no pending confirmation. down() restores nothing: the links of a workspace
 * without a connection lead nowhere.
 */
export class EntraDisconnectedAccountsLocal1856230000000 implements MigrationInterface {
  name = 'EntraDisconnectedAccountsLocal1856230000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const [{ found }] = await queryRunner.query(`SELECT current_setting('app.current_tenant', true) AS found`);
    const tenants: Array<{ id: string; slug: string | null }> = await queryRunner.query(
      `SELECT id, slug FROM tenants
        WHERE NOT (sso_provider = 'entra' AND entra_tenant_id IS NOT NULL)
        ORDER BY created_at ASC, id ASC`,
    );
    let accounts = 0;
    let confirmations = 0;
    let changedTenants = 0;
    for (const tenant of tenants) {
      await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant.id]);
      const [{ n: madeLocal }] = await queryRunner.query(
        `WITH linked AS (
           SELECT id, external_auth_provider, external_subject, external_synced_at
             FROM users
            WHERE tenant_id = $1 AND (external_auth_provider IS NOT NULL OR external_subject IS NOT NULL)
            ORDER BY id
              FOR UPDATE
         ),
         changed AS (
           UPDATE users u
              SET external_auth_provider = NULL, external_subject = NULL, external_synced_at = NULL
             FROM linked l
            WHERE u.tenant_id = $1 AND u.id = l.id
           RETURNING u.id
         ),
         history AS (
           INSERT INTO audit_log (tenant_id, table_name, record_id, action, before_json, after_json, user_id, source, source_ref, created_at)
           SELECT $1, 'users', l.id, 'update',
                  jsonb_build_object('external_auth_provider', l.external_auth_provider,
                                     'external_subject', l.external_subject,
                                     'external_synced_at', l.external_synced_at),
                  jsonb_build_object('external_auth_provider', NULL, 'external_subject', NULL, 'external_synced_at', NULL),
                  NULL, 'system', $2, clock_timestamp()
             FROM linked l
             JOIN changed c ON c.id = l.id
           RETURNING 1
         )
         SELECT count(*)::int AS n FROM history`,
        [tenant.id, SOURCE_REF],
      );
      const [{ n: voided }] = await queryRunner.query(
        `WITH voided AS (
           UPDATE password_reset_tokens SET used_at = now()
            WHERE tenant_id = $1 AND used_at IS NULL AND token_hash LIKE $2
           RETURNING 1
         )
         SELECT count(*)::int AS n FROM voided`,
        [tenant.id, `${LINK_CONFIRMATION_PREFIX}%`],
      );
      if (madeLocal > 0 || voided > 0) {
        changedTenants += 1;
        accounts += madeLocal;
        confirmations += voided;
        console.log(
          `${LOG_PREFIX} tenant ${tenant.slug ?? '(no slug)'} (${tenant.id}): ${madeLocal} account(s) made local, ${voided} pending link confirmation(s) voided`,
        );
      }
    }
    await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [found ?? '']);
    console.log(
      `${LOG_PREFIX} ${tenants.length} workspace(s) without a Microsoft connection, ${changedTenants} changed: ${accounts} account(s) made local, ${confirmations} pending link confirmation(s) voided`,
    );
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Nothing to restore: see up().
  }
}
