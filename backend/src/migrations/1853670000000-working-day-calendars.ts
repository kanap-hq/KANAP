import { MigrationInterface, QueryRunner } from 'typeorm';

const ROUND_TABLES = ['spend_round_inputs', 'capex_round_inputs'] as const;

/**
 * Costed lines and working-day calendars (step D of professional budgeting).
 *
 * - working_day_profiles: a tenant's calendars, each holding per year the
 *   working days of the twelve months as decimal strings (`days_by_year`).
 *   The database only checks that it is an object; the shape (years 2000 to
 *   2100, twelve values, at most 6 decimals, none above the month's calendar
 *   days) is validated by `normalizeDaysByYear`, shared by the API, the CSV
 *   and the computation.
 * - spend_round_inputs / capex_round_inputs gain the recipe of a costed
 *   round (pricing basis, quantity, unit price, price index, calendar, counts
 *   as FTE) next to `last_calculation`: the recipe survives writes that
 *   replace or clear the explanation. `method` gains `computed`.
 *
 * The costing CHECKs make a bad recipe unstorable, raw SQL included: all or
 * nothing, a calendar exactly for a price per day, a quantity of 0 or more,
 * an index of -100 % or more, and no `computed` round without a recipe.
 *
 * Foreign-key checks bypass RLS, so a round references its calendar by
 * (tenant_id, working_day_profile_id), backed by UNIQUE (tenant_id, id): a
 * round naming another tenant's calendar fails in the database. ON DELETE
 * RESTRICT keeps a calendar in use from being deleted; the index serves that
 * check and the in-use counts. No row is updated: the round tables have no
 * trigger and the new columns start NULL / false.
 *
 * role_permissions: every role gets on working_day_profiles the level it has
 * on departments, except the built-in Budget Administrator, which gets admin
 * (budget administrators manage calendars). Rows that already exist are kept.
 * Migrations run without app.current_tenant and every table read or written
 * here is FORCE ROW LEVEL SECURITY, so each data step disables RLS around
 * itself and restores ENABLE + FORCE, the state found.
 *
 * down() refuses while any tenant has a calendar or a round with a recipe
 * (or a computed round): reverting would lose them. Otherwise it drops
 * everything up() added and restores the three-value method check.
 */
export class WorkingDayCalendars1853670000000 implements MigrationInterface {
  name = 'WorkingDayCalendars1853670000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE working_day_profiles (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants(id) ON DELETE CASCADE,
        code text NOT NULL,
        name text NOT NULL,
        description text NULL,
        days_by_year jsonb NOT NULL DEFAULT '{}'::jsonb,
        status status_state NOT NULL DEFAULT 'enabled',
        disabled_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT working_day_profiles_tenant_id_id_key UNIQUE (tenant_id, id),
        CONSTRAINT working_day_profiles_code_check CHECK (btrim(code) <> '' AND code = btrim(code)),
        CONSTRAINT working_day_profiles_name_check CHECK (btrim(name) <> '' AND name = btrim(name)),
        CONSTRAINT working_day_profiles_days_by_year_check CHECK (jsonb_typeof(days_by_year) = 'object')
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uniq_working_day_profiles_tenant_code ON working_day_profiles (tenant_id, lower(code))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX uniq_working_day_profiles_tenant_name ON working_day_profiles (tenant_id, lower(name))`,
    );
    await enableRls(queryRunner, 'working_day_profiles');
    await queryRunner.query(`DROP POLICY IF EXISTS working_day_profiles_tenant_isolation ON working_day_profiles`);
    await queryRunner.query(`
      CREATE POLICY working_day_profiles_tenant_isolation ON working_day_profiles
      FOR ALL
      USING (tenant_id = app_current_tenant())
      WITH CHECK (tenant_id = app_current_tenant())
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pricing_basis') THEN
          CREATE TYPE pricing_basis AS ENUM ('per_day', 'per_month', 'per_period');
        END IF;
      END
      $$;
    `);

    for (const table of ROUND_TABLES) {
      await queryRunner.query(`
        ALTER TABLE ${table}
          ADD COLUMN pricing_basis pricing_basis NULL,
          ADD COLUMN quantity numeric(12,3) NULL,
          ADD COLUMN unit_price numeric(18,4) NULL,
          ADD COLUMN price_index_pct numeric(7,4) NULL,
          ADD COLUMN working_day_profile_id uuid NULL,
          ADD COLUMN counts_as_fte boolean NOT NULL DEFAULT false
      `);
      await queryRunner.query(`
        ALTER TABLE ${table}
        ADD CONSTRAINT ${table}_working_day_profile_fk FOREIGN KEY (tenant_id, working_day_profile_id)
        REFERENCES working_day_profiles (tenant_id, id) ON DELETE RESTRICT
      `);
      await queryRunner.query(
        `CREATE INDEX idx_${table}_tenant_working_day_profile ON ${table} (tenant_id, working_day_profile_id)`,
      );
      await queryRunner.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_method_check`);
      await queryRunner.query(`
        ALTER TABLE ${table}
        ADD CONSTRAINT ${table}_method_check CHECK (method IN ('spread', 'copied', 'manual', 'computed'))
      `);
      // The recipe is all or nothing.
      await queryRunner.query(`
        ALTER TABLE ${table}
        ADD CONSTRAINT ${table}_costing_check CHECK (
          (pricing_basis IS NULL AND quantity IS NULL AND unit_price IS NULL AND price_index_pct IS NULL
            AND working_day_profile_id IS NULL AND counts_as_fte = false)
          OR (pricing_basis IS NOT NULL AND quantity IS NOT NULL AND unit_price IS NOT NULL AND price_index_pct IS NOT NULL)
        )
      `);
      // A calendar exactly when the price is per day.
      await queryRunner.query(`
        ALTER TABLE ${table}
        ADD CONSTRAINT ${table}_costing_calendar_check CHECK (
          pricing_basis IS NULL OR ((pricing_basis = 'per_day') = (working_day_profile_id IS NOT NULL))
        )
      `);
      await queryRunner.query(`
        ALTER TABLE ${table}
        ADD CONSTRAINT ${table}_costing_values_check CHECK (
          (quantity IS NULL OR quantity >= 0) AND (price_index_pct IS NULL OR price_index_pct >= -100)
        )
      `);
      await queryRunner.query(`
        ALTER TABLE ${table}
        ADD CONSTRAINT ${table}_computed_check CHECK (method <> 'computed' OR pricing_basis IS NOT NULL)
      `);
    }

    await queryRunner.query(`ALTER TABLE roles DISABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE role_permissions DISABLE ROW LEVEL SECURITY`);
    // The built-in Budget Administrator first: admin whatever its departments level.
    await queryRunner.query(`
      INSERT INTO role_permissions (tenant_id, role_id, resource, level)
      SELECT r.tenant_id, r.id, 'working_day_profiles', 'admin'
      FROM roles r
      WHERE r.is_built_in = true
        AND LOWER(TRIM(r.role_name)) = 'budget administrator'
        AND NOT EXISTS (
          SELECT 1 FROM role_permissions rp
          WHERE rp.role_id = r.id AND rp.resource = 'working_day_profiles'
        )
    `);
    await queryRunner.query(`
      INSERT INTO role_permissions (tenant_id, role_id, resource, level)
      SELECT src.tenant_id, src.role_id, 'working_day_profiles', src.level
      FROM role_permissions src
      WHERE src.resource = 'departments'
        AND NOT EXISTS (
          SELECT 1 FROM role_permissions rp
          WHERE rp.role_id = src.role_id AND rp.resource = 'working_day_profiles'
        )
    `);
    await enableRls(queryRunner, 'role_permissions');
    await enableRls(queryRunner, 'roles');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const window = ['working_day_profiles', ...ROUND_TABLES];
    for (const table of window) {
      await queryRunner.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
    }
    // The transaction rolls back on this exception: RLS and data stay as they were.
    await queryRunner.query(`
      DO $do$
      DECLARE
        offenders text;
      BEGIN
        SELECT string_agg(label, ', ' ORDER BY label) INTO offenders
          FROM (
            SELECT DISTINCT COALESCE(t.slug, s.tenant_id::text) AS label
              FROM (
                SELECT tenant_id FROM working_day_profiles
                UNION
                SELECT tenant_id FROM spend_round_inputs WHERE pricing_basis IS NOT NULL OR method = 'computed'
                UNION
                SELECT tenant_id FROM capex_round_inputs WHERE pricing_basis IS NOT NULL OR method = 'computed'
              ) s
              LEFT JOIN tenants t ON t.id = s.tenant_id
          ) o;
        IF offenders IS NOT NULL THEN
          RAISE EXCEPTION 'Cannot revert the working-day calendars: tenant(s) % still have calendars or budget rounds computed from quantity and price. Delete those calendars and clear those rounds first.', offenders;
        END IF;
      END
      $do$
    `);
    for (const table of window) {
      await enableRls(queryRunner, table);
    }

    await queryRunner.query(`ALTER TABLE roles DISABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE role_permissions DISABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`DELETE FROM role_permissions WHERE resource = 'working_day_profiles'`);
    await enableRls(queryRunner, 'role_permissions');
    await enableRls(queryRunner, 'roles');

    for (const table of [...ROUND_TABLES].reverse()) {
      for (const check of ['computed_check', 'costing_values_check', 'costing_calendar_check', 'costing_check']) {
        await queryRunner.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_${check}`);
      }
      await queryRunner.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_method_check`);
      await queryRunner.query(`
        ALTER TABLE ${table}
        ADD CONSTRAINT ${table}_method_check CHECK (method IN ('spread', 'copied', 'manual'))
      `);
      await queryRunner.query(`DROP INDEX IF EXISTS idx_${table}_tenant_working_day_profile`);
      await queryRunner.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_working_day_profile_fk`);
      await queryRunner.query(`
        ALTER TABLE ${table}
          DROP COLUMN IF EXISTS counts_as_fte,
          DROP COLUMN IF EXISTS working_day_profile_id,
          DROP COLUMN IF EXISTS price_index_pct,
          DROP COLUMN IF EXISTS unit_price,
          DROP COLUMN IF EXISTS quantity,
          DROP COLUMN IF EXISTS pricing_basis
      `);
    }
    await queryRunner.query(`DROP TYPE IF EXISTS pricing_basis`);

    await queryRunner.query(`DROP POLICY IF EXISTS working_day_profiles_tenant_isolation ON working_day_profiles`);
    await queryRunner.query(`DROP TABLE IF EXISTS working_day_profiles`);
  }
}

async function enableRls(queryRunner: QueryRunner, table: string): Promise<void> {
  await queryRunner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
  await queryRunner.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
}
