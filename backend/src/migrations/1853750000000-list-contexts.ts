import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Saved list states (lot 2B, PR B2): `list_contexts`, one row per tenant and
 * content-addressed id (`common/list-context/list-context.ts`). A list whose
 * state is too large for a URL (31 KB for "every supplier but one") travels
 * as `ctx=<id>` in API calls, page URLs and links. Rows unused for 90 days are
 * purged by the `list-context-purge` scheduled task.
 *
 * Idempotent and self-healing: every step can run again on any database,
 * including one where an earlier run stopped half way (a column, the checks,
 * the index, RLS or the policy missing).
 */
export class ListContexts1853750000000 implements MigrationInterface {
  name = 'ListContexts1853750000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS list_contexts (
        tenant_id uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants(id) ON DELETE CASCADE,
        id text NOT NULL,
        list_key text NOT NULL,
        state jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_used_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT list_contexts_pkey PRIMARY KEY (tenant_id, id)
      )
    `);
    // A table left by an earlier, partial run gets what it misses.
    await queryRunner.query(`ALTER TABLE list_contexts ADD COLUMN IF NOT EXISTS list_key text`);
    await queryRunner.query(`ALTER TABLE list_contexts ADD COLUMN IF NOT EXISTS state jsonb`);
    await queryRunner.query(`ALTER TABLE list_contexts ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()`);
    await queryRunner.query(`ALTER TABLE list_contexts ADD COLUMN IF NOT EXISTS last_used_at timestamptz NOT NULL DEFAULT now()`);
    const checks: Array<[string, string]> = [
      ['chk_list_contexts_id', `id ~ '^[A-Za-z0-9_-]{22}$'`],
      ['chk_list_contexts_list_key', `list_key IS NOT NULL AND length(list_key) BETWEEN 1 AND 128`],
      ['chk_list_contexts_state', `state IS NOT NULL AND jsonb_typeof(state) = 'object'`],
    ];
    for (const [name, check] of checks) {
      await queryRunner.query(`ALTER TABLE list_contexts DROP CONSTRAINT IF EXISTS ${name}`);
      await queryRunner.query(`ALTER TABLE list_contexts ADD CONSTRAINT ${name} CHECK (${check}) NOT VALID`);
    }
    // The purge reads one tenant's rows by use date.
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_list_contexts_tenant_last_used ON list_contexts (tenant_id, last_used_at)`);

    await queryRunner.query(`ALTER TABLE list_contexts ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE list_contexts FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`DROP POLICY IF EXISTS list_contexts_tenant_isolation ON list_contexts`);
    await queryRunner.query(`
      CREATE POLICY list_contexts_tenant_isolation ON list_contexts FOR ALL
      USING (tenant_id = app_current_tenant())
      WITH CHECK (tenant_id = app_current_tenant())
    `);
    console.log('[Migration] ListContexts: list_contexts ready (RLS forced, tenant policy, purge index).');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS list_contexts`);
  }
}
