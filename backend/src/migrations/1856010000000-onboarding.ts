import { MigrationInterface, QueryRunner } from 'typeorm';

const LOG_PREFIX = '[Migration] Onboarding:';

/**
 * The onboarding of a workspace (`doc/onboarding.md`), three tenant tables:
 * - `tenant_onboarding`: the angle and the mode the workspace chose, one row per tenant;
 * - `onboarding_steps`: the steps each user has done, per angle and mode;
 * - `onboarding_dismissals`: the users who hid the list of first steps.
 *
 * The per-user tables reference the user by `(tenant_id, user_id)`, as `user_data_access_nodes`
 * does (foreign-key checks bypass row level security, the composite key keeps a row in its
 * user's tenant); `users_tenant_id_id_key` comes from 1854400000000. `chosen_by` is a plain
 * reference, set to NULL when the user goes, with its own index (the per-user keys lead the
 * unique key and the primary key).
 *
 * RLS enabled and forced on the three, with the policy `<table>_tenant_isolation` (USING and WITH
 * CHECK). The tables are new and hold nothing: no backfill. Every statement uses IF NOT EXISTS or
 * drops the policy first: a second run changes nothing. down() drops the three tables.
 */
export class Onboarding1856010000000 implements MigrationInterface {
  name = 'Onboarding1856010000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS tenant_onboarding (
        tenant_id uuid PRIMARY KEY DEFAULT app_current_tenant() REFERENCES tenants(id) ON DELETE CASCADE,
        angle text NULL,
        mode text NULL,
        chosen_at timestamptz NULL,
        chosen_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT tenant_onboarding_angle_check CHECK (angle IN ('budget', 'cartography', 'portfolio')),
        CONSTRAINT tenant_onboarding_mode_check CHECK (mode IN ('example', 'own_data'))
      )`);
    // Deleting a user clears `chosen_by`: the lookup goes through this index.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_tenant_onboarding_chosen_by ON tenant_onboarding (chosen_by)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS onboarding_steps (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants(id) ON DELETE CASCADE,
        user_id uuid NOT NULL,
        angle text NOT NULL,
        mode text NOT NULL,
        step_key text NOT NULL,
        done_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT onboarding_steps_angle_check CHECK (angle IN ('budget', 'cartography', 'portfolio')),
        CONSTRAINT onboarding_steps_mode_check CHECK (mode IN ('example', 'own_data')),
        CONSTRAINT onboarding_steps_key UNIQUE (tenant_id, user_id, angle, mode, step_key),
        CONSTRAINT onboarding_steps_user_fk FOREIGN KEY (tenant_id, user_id)
          REFERENCES users (tenant_id, id) ON DELETE CASCADE
      )`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS onboarding_dismissals (
        tenant_id uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants(id) ON DELETE CASCADE,
        user_id uuid NOT NULL,
        dismissed_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT onboarding_dismissals_pkey PRIMARY KEY (tenant_id, user_id),
        CONSTRAINT onboarding_dismissals_user_fk FOREIGN KEY (tenant_id, user_id)
          REFERENCES users (tenant_id, id) ON DELETE CASCADE
      )`);

    for (const table of ['tenant_onboarding', 'onboarding_steps', 'onboarding_dismissals']) {
      await queryRunner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await queryRunner.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      await queryRunner.query(`DROP POLICY IF EXISTS ${table}_tenant_isolation ON ${table}`);
      await queryRunner.query(`
        CREATE POLICY ${table}_tenant_isolation ON ${table}
          USING (tenant_id = app_current_tenant())
          WITH CHECK (tenant_id = app_current_tenant())
      `);
    }

    console.log(`${LOG_PREFIX} tenant_onboarding, onboarding_steps and onboarding_dismissals ready`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS onboarding_dismissals`);
    await queryRunner.query(`DROP TABLE IF EXISTS onboarding_steps`);
    await queryRunner.query(`DROP TABLE IF EXISTS tenant_onboarding`);
  }
}
