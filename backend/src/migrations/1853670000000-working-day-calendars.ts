import { MigrationInterface, QueryRunner } from 'typeorm';

const ROUND_TABLES = ['spend_round_inputs', 'capex_round_inputs'] as const;
const LINE_TABLES: Record<(typeof ROUND_TABLES)[number], string> = {
  spend_round_inputs: 'spend_round_input_lines',
  capex_round_inputs: 'capex_round_input_lines',
};

/**
 * Quantity × price lines and working-day calendars (step D of professional
 * budgeting).
 *
 * - working_day_profiles: a tenant's calendars, each holding per year the
 *   working days of the twelve months as decimal strings (`days_by_year`).
 *   The database only checks that it is an object; the shape (years 2000 to
 *   2100, twelve values, at most 6 decimals, none above the month's calendar
 *   days) is validated by `normalizeDaysByYear`, shared by the API, the CSV
 *   and the computation. A standard calendar names a country (`country_iso`,
 *   two upper-case letters) and maybe a region (`region_code`, the public
 *   holiday package's code of a state): its years follow that country's public
 *   holidays and `days_by_year` holds the edited years only. Both are set at
 *   creation and never change; a custom calendar has neither.
 * - spend_round_input_lines / capex_round_input_lines: the lines a budget
 *   column is computed from, each a quantity (people, days or units) times a
 *   unit price (per day, per month or once) over its own period, in `sort`
 *   order. They belong to the column's round and survive the writes that
 *   replace its explanation (a hand edit, a spread): the lines stay as the
 *   reference the budget tab shows.
 * - spend_round_inputs / capex_round_inputs gain `fte` (the column's yearly
 *   FTE from its lines, null without lines), `method` gains `computed`, and
 *   UNIQUE (tenant_id, id) backs the lines' composite key.
 *
 * The line CHECKs make a bad line unstorable, raw SQL included: a unit and
 * its price basis go together (people per day or per month, days per day,
 * units per month or once), a calendar exactly for a price per day, a
 * quantity of 0 or more, a period inside one year, a description of 200
 * characters at most.
 *
 * Foreign-key checks bypass RLS, so a line references its round by
 * (tenant_id, round_input_id) and its calendar by (tenant_id,
 * working_day_profile_id), both backed by UNIQUE (tenant_id, id): a line
 * naming another tenant's round or calendar fails in the database. Deleting
 * a round deletes its lines (CASCADE); ON DELETE RESTRICT keeps a calendar in
 * use from being deleted, and its index serves that check and the in-use
 * counts. The unique (tenant_id, round_input_id, sort) serves the reads of a
 * round's lines. No row is updated: the new column starts NULL.
 *
 * role_permissions: every role gets on working_day_profiles the level it has
 * on departments, except the built-in Budget Administrator, which gets admin
 * (budget administrators manage calendars). Rows that already exist are kept.
 * Migrations run without app.current_tenant and every table read or written
 * here is FORCE ROW LEVEL SECURITY, so each data step disables RLS around
 * itself and restores ENABLE + FORCE, the state found.
 *
 * down() refuses while any tenant has a calendar, a line or a computed round:
 * reverting would lose them. Otherwise it drops everything up() added and
 * restores the three-value method check.
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
        country_iso text NULL,
        region_code text NULL,
        status status_state NOT NULL DEFAULT 'enabled',
        disabled_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT working_day_profiles_tenant_id_id_key UNIQUE (tenant_id, id),
        CONSTRAINT working_day_profiles_code_check CHECK (btrim(code) <> '' AND code = btrim(code)),
        CONSTRAINT working_day_profiles_name_check CHECK (btrim(name) <> '' AND name = btrim(name)),
        CONSTRAINT working_day_profiles_days_by_year_check CHECK (jsonb_typeof(days_by_year) = 'object'),
        CONSTRAINT working_day_profiles_country_iso_check CHECK (country_iso IS NULL OR country_iso ~ '^[A-Z]{2}$'),
        CONSTRAINT working_day_profiles_region_country_check CHECK (region_code IS NULL OR country_iso IS NOT NULL),
        CONSTRAINT working_day_profiles_region_code_check CHECK (region_code IS NULL OR char_length(region_code) BETWEEN 1 AND 10)
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
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'line_quantity_unit') THEN
          CREATE TYPE line_quantity_unit AS ENUM ('people', 'days', 'units');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'line_price_basis') THEN
          CREATE TYPE line_price_basis AS ENUM ('per_day', 'per_month', 'once');
        END IF;
      END
      $$;
    `);

    for (const table of ROUND_TABLES) {
      await queryRunner.query(`ALTER TABLE ${table} ADD COLUMN fte numeric(9,2) NULL`);
      await queryRunner.query(`ALTER TABLE ${table} ADD CONSTRAINT ${table}_fte_check CHECK (fte >= 0)`);
      await queryRunner.query(`ALTER TABLE ${table} ADD CONSTRAINT ${table}_tenant_id_id_key UNIQUE (tenant_id, id)`);
      await queryRunner.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_method_check`);
      await queryRunner.query(`
        ALTER TABLE ${table}
        ADD CONSTRAINT ${table}_method_check CHECK (method IN ('spread', 'copied', 'manual', 'computed'))
      `);

      const lines = LINE_TABLES[table];
      await queryRunner.query(`
        CREATE TABLE ${lines} (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants(id) ON DELETE CASCADE,
          round_input_id uuid NOT NULL,
          sort integer NOT NULL,
          label text NOT NULL DEFAULT '',
          quantity_unit line_quantity_unit NOT NULL,
          quantity numeric(12,3) NOT NULL,
          unit_price numeric(18,4) NOT NULL,
          price_basis line_price_basis NOT NULL,
          working_day_profile_id uuid NULL,
          period_start date NOT NULL,
          period_end date NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT ${lines}_round_sort_key UNIQUE (tenant_id, round_input_id, sort),
          CONSTRAINT ${lines}_round_input_fk FOREIGN KEY (tenant_id, round_input_id)
            REFERENCES ${table} (tenant_id, id) ON DELETE CASCADE,
          CONSTRAINT ${lines}_working_day_profile_fk FOREIGN KEY (tenant_id, working_day_profile_id)
            REFERENCES working_day_profiles (tenant_id, id) ON DELETE RESTRICT,
          CONSTRAINT ${lines}_label_check CHECK (char_length(label) <= 200),
          CONSTRAINT ${lines}_quantity_check CHECK (quantity >= 0),
          CONSTRAINT ${lines}_period_check
            CHECK (period_start <= period_end AND date_trunc('year', period_start) = date_trunc('year', period_end)),
          CONSTRAINT ${lines}_basis_check CHECK (
            (quantity_unit = 'people' AND price_basis IN ('per_day', 'per_month'))
            OR (quantity_unit = 'days' AND price_basis = 'per_day')
            OR (quantity_unit = 'units' AND price_basis IN ('per_month', 'once'))
          ),
          CONSTRAINT ${lines}_calendar_check CHECK ((price_basis = 'per_day') = (working_day_profile_id IS NOT NULL))
        )
      `);
      await queryRunner.query(
        `CREATE INDEX idx_${lines}_tenant_working_day_profile ON ${lines} (tenant_id, working_day_profile_id)`,
      );
      await enableRls(queryRunner, lines);
      await queryRunner.query(`DROP POLICY IF EXISTS ${lines}_tenant_isolation ON ${lines}`);
      await queryRunner.query(`
        CREATE POLICY ${lines}_tenant_isolation ON ${lines}
        FOR ALL
        USING (tenant_id = app_current_tenant())
        WITH CHECK (tenant_id = app_current_tenant())
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
    const window = ['working_day_profiles', ...ROUND_TABLES, ...ROUND_TABLES.map((table) => LINE_TABLES[table])];
    for (const table of window) {
      await queryRunner.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
    }
    // The transaction rolls back on this exception: RLS and data stay as they were.
    await queryRunner.query(`
      DO $do$
      DECLARE
        offenders text;
      BEGIN
        SELECT string_agg(label, ', ' ORDER BY label) INTO offenders FROM (
          SELECT DISTINCT COALESCE(t.slug, s.tenant_id::text) AS label
            FROM (
              SELECT tenant_id FROM working_day_profiles
              UNION SELECT tenant_id FROM spend_round_inputs WHERE method = 'computed'
              UNION SELECT tenant_id FROM capex_round_inputs WHERE method = 'computed'
              UNION SELECT tenant_id FROM spend_round_input_lines
              UNION SELECT tenant_id FROM capex_round_input_lines
            ) s LEFT JOIN tenants t ON t.id = s.tenant_id
        ) o;
        IF offenders IS NOT NULL THEN
          RAISE EXCEPTION 'Cannot revert the working-day calendars: tenant(s) % still have calendars or budget columns computed from quantity and price. Delete those calendars and clear those columns first.', offenders;
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
      // Its policy, keys and index go with it.
      await queryRunner.query(`DROP TABLE IF EXISTS ${LINE_TABLES[table]}`);
      await queryRunner.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_tenant_id_id_key`);
      await queryRunner.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_fte_check`);
      await queryRunner.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_method_check`);
      await queryRunner.query(`
        ALTER TABLE ${table}
        ADD CONSTRAINT ${table}_method_check CHECK (method IN ('spread', 'copied', 'manual'))
      `);
      await queryRunner.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS fte`);
    }
    await queryRunner.query(`DROP TYPE IF EXISTS line_price_basis`);
    await queryRunner.query(`DROP TYPE IF EXISTS line_quantity_unit`);

    await queryRunner.query(`DROP POLICY IF EXISTS working_day_profiles_tenant_isolation ON working_day_profiles`);
    await queryRunner.query(`DROP TABLE IF EXISTS working_day_profiles`);
  }
}

async function enableRls(queryRunner: QueryRunner, table: string): Promise<void> {
  await queryRunner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
  await queryRunner.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
}
