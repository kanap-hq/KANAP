import { MigrationInterface, QueryRunner } from 'typeorm';

const TABLES = [
  { table: 'spend_round_inputs', versions: 'spend_versions' },
  { table: 'capex_round_inputs', versions: 'capex_versions' },
] as const;

/**
 * Round inputs: one row per round (version × budget column) holding the
 * period that drove its last spread and how the column was produced
 * (spread, copied, edited by hand). Same shape on OPEX and CAPEX.
 *
 * - The five columns are equal: `measure` is a storage key, never a role.
 *   What a column means comes from the tenant's settings, not from here.
 * - The period stays inside one calendar year; that it is the version's year
 *   is checked by the services, which know the version.
 * - `updated_by` is a bare uuid like `freeze_states.frozen_by`: deleting a
 *   user must not delete or block the provenance of a budget column.
 * - The unique index leads with tenant_id and serves the per-version reads.
 *   A second index on version_id alone serves the ON DELETE CASCADE from the
 *   versions table, whose lookup names no tenant (PostgreSQL 15 has no skip
 *   scan to use the unique index for it).
 * - Versions without a row read as "whole year, origin unknown": nothing is
 *   backfilled.
 */
export class RoundInputs1853630000000 implements MigrationInterface {
  name = 'RoundInputs1853630000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const { table, versions } of TABLES) {
      await queryRunner.query(`
        CREATE TABLE ${table} (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants(id) ON DELETE CASCADE,
          version_id uuid NOT NULL REFERENCES ${versions}(id) ON DELETE CASCADE,
          measure text NOT NULL,
          period_start date NOT NULL,
          period_end date NOT NULL,
          method text NOT NULL,
          spread_profile_name text NULL,
          last_calculation jsonb NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          updated_by uuid NULL,
          CONSTRAINT ${table}_measure_check
            CHECK (measure IN ('planned', 'committed', 'forecast', 'actual', 'expected_landing')),
          CONSTRAINT ${table}_method_check
            CHECK (method IN ('spread', 'copied', 'manual')),
          CONSTRAINT ${table}_period_check
            CHECK (period_start <= period_end AND date_trunc('year', period_start) = date_trunc('year', period_end))
        )
      `);
      await queryRunner.query(`
        CREATE UNIQUE INDEX uq_${table}_tenant_version_measure
        ON ${table} (tenant_id, version_id, measure)
      `);
      await queryRunner.query(`CREATE INDEX idx_${table}_version ON ${table} (version_id)`);
      await queryRunner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await queryRunner.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      await queryRunner.query(`DROP POLICY IF EXISTS ${table}_tenant_isolation ON ${table}`);
      await queryRunner.query(`
        CREATE POLICY ${table}_tenant_isolation ON ${table} FOR ALL
        USING (tenant_id = app_current_tenant())
        WITH CHECK (tenant_id = app_current_tenant())
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const { table } of [...TABLES].reverse()) {
      await queryRunner.query(`DROP POLICY IF EXISTS ${table}_tenant_isolation ON ${table}`);
      await queryRunner.query(`DROP TABLE IF EXISTS ${table}`);
    }
  }
}
