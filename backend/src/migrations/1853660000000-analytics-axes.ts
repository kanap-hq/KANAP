import { MigrationInterface, QueryRunner } from 'typeorm';

const LINKS = [
  { table: 'spend_item_analytics_values', items: 'spend_items' },
  { table: 'capex_item_analytics_values', items: 'capex_items' },
] as const;

/**
 * Analytics axes (step C of professional budgeting): a tenant classifies its
 * budget lines along several dimensions, one value per line and dimension.
 *
 * - analytics_axes: the tenant's dimensions. Every tenant gets one default
 *   dimension (code `default`, name NULL until someone renames it, sort 0);
 *   the legacy API field, the legacy CSV header and the AI key address it
 *   through `is_default`, never through a position, a code or a name.
 * - analytics_categories (the values) gain axis_id, backfilled to the
 *   tenant's default dimension; names become unique per dimension.
 * - spend_item_analytics_values / capex_item_analytics_values: one row per
 *   line and dimension, backfilled from the item's analytics_category_id.
 *
 * Foreign-key checks bypass RLS, so the tenant rides in every new key: a
 * value references its dimension by (tenant_id, axis_id), a line's value
 * references (tenant_id, category_id, axis_id), so a link can only name a
 * value of its own tenant that belongs to the named dimension, raw SQL
 * included. The item reference stays single-column (the service resolves the
 * item under the tenant); an index on item_id serves its ON DELETE CASCADE.
 *
 * The item columns analytics_category_id, their SET NULL keys and indexes
 * stay for one release, unread and unwritten; a later migration drops them.
 *
 * Migrations run without app.current_tenant and every table here is FORCE
 * ROW LEVEL SECURITY (the owner is bound too), so each data step disables RLS
 * around itself and restores ENABLE + FORCE, the state found. The category
 * UPDATE runs per tenant with a transaction-local app.current_tenant: its
 * search-index trigger writes search_index (FORCE RLS). The link inserts fire
 * no row trigger and no item row is updated. Item rows pointing at another
 * tenant's category are skipped (RAISE NOTICE with the count); the
 * verification script (scripts/verify-analytics-axes.ts) lists them.
 *
 * down() refuses while any value belongs to a non-default dimension (those
 * values would merge into one list or be lost). Otherwise it writes the
 * default-dimension links back to the item columns (per tenant: the item
 * search-index triggers write search_index) and drops everything up() added.
 */
export class AnalyticsAxes1853660000000 implements MigrationInterface {
  name = 'AnalyticsAxes1853660000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE analytics_axes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants(id) ON DELETE CASCADE,
        code text NOT NULL,
        name text NULL,
        description text NULL,
        sort_order int NOT NULL DEFAULT 0,
        is_default boolean NOT NULL DEFAULT false,
        status status_state NOT NULL DEFAULT 'enabled',
        disabled_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT analytics_axes_tenant_id_id_key UNIQUE (tenant_id, id),
        CONSTRAINT analytics_axes_code_check CHECK (code ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
        CONSTRAINT analytics_axes_name_check CHECK (name IS NULL OR (name = btrim(name) AND name <> '')),
        CONSTRAINT analytics_axes_name_required_check CHECK (name IS NOT NULL OR is_default),
        CONSTRAINT analytics_axes_default_enabled_check
          CHECK (NOT is_default OR (status = 'enabled' AND disabled_at IS NULL))
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX uniq_analytics_axes_tenant_code ON analytics_axes (tenant_id, lower(code))`);
    await queryRunner.query(`CREATE UNIQUE INDEX uniq_analytics_axes_tenant_name ON analytics_axes (tenant_id, lower(name))`);
    await queryRunner.query(`CREATE UNIQUE INDEX uniq_analytics_axes_tenant_default ON analytics_axes (tenant_id) WHERE is_default`);
    await queryRunner.query(`CREATE INDEX idx_analytics_axes_tenant_sort ON analytics_axes (tenant_id, sort_order)`);
    await enableRls(queryRunner, 'analytics_axes');
    await queryRunner.query(`DROP POLICY IF EXISTS analytics_axes_tenant_isolation ON analytics_axes`);
    await queryRunner.query(`
      CREATE POLICY analytics_axes_tenant_isolation ON analytics_axes
      FOR ALL
      USING (tenant_id = app_current_tenant())
      WITH CHECK (tenant_id = app_current_tenant())
    `);

    // One default dimension per tenant, platform-admin included.
    await queryRunner.query(`ALTER TABLE analytics_axes DISABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      INSERT INTO analytics_axes (tenant_id, code, name, is_default, sort_order)
      SELECT t.id, 'default', NULL, true, 0 FROM tenants t
    `);
    await enableRls(queryRunner, 'analytics_axes');

    // Every value joins its tenant's default dimension (updated_at untouched).
    await queryRunner.query(`ALTER TABLE analytics_categories ADD COLUMN axis_id uuid NULL`);
    await queryRunner.query(`ALTER TABLE analytics_categories DISABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      DO $do$
      DECLARE
        t RECORD;
      BEGIN
        FOR t IN SELECT id FROM tenants ORDER BY created_at ASC, id ASC LOOP
          PERFORM set_config('app.current_tenant', t.id::text, true);
          UPDATE analytics_categories c
             SET axis_id = a.id
            FROM analytics_axes a
           WHERE a.tenant_id = t.id AND a.is_default
             AND c.tenant_id = t.id AND c.axis_id IS NULL;
        END LOOP;
        PERFORM set_config('app.current_tenant', '', true);
      END
      $do$
    `);
    await enableRls(queryRunner, 'analytics_categories');
    await queryRunner.query(`ALTER TABLE analytics_categories ALTER COLUMN axis_id SET NOT NULL`);
    await queryRunner.query(`
      ALTER TABLE analytics_categories
      ADD CONSTRAINT analytics_categories_axis_fk FOREIGN KEY (tenant_id, axis_id)
      REFERENCES analytics_axes (tenant_id, id) ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      ALTER TABLE analytics_categories
      ADD CONSTRAINT analytics_categories_tenant_id_id_axis_id_key UNIQUE (tenant_id, id, axis_id)
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_analytics_categories_unique_name`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uniq_analytics_categories_tenant_axis_name ON analytics_categories (tenant_id, axis_id, lower(name))`,
    );
    await queryRunner.query(`CREATE INDEX idx_analytics_categories_tenant_axis ON analytics_categories (tenant_id, axis_id)`);

    for (const { table, items } of LINKS) {
      await queryRunner.query(`
        CREATE TABLE ${table} (
          tenant_id uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants(id) ON DELETE CASCADE,
          item_id uuid NOT NULL REFERENCES ${items}(id) ON DELETE CASCADE,
          axis_id uuid NOT NULL,
          category_id uuid NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT ${table}_pkey PRIMARY KEY (tenant_id, item_id, axis_id),
          CONSTRAINT ${table}_category_fk FOREIGN KEY (tenant_id, category_id, axis_id)
            REFERENCES analytics_categories (tenant_id, id, axis_id) ON DELETE RESTRICT
        )
      `);
      await queryRunner.query(`CREATE INDEX idx_${table}_tenant_category ON ${table} (tenant_id, category_id)`);
      await queryRunner.query(`CREATE INDEX idx_${table}_tenant_axis_category ON ${table} (tenant_id, axis_id, category_id)`);
      await queryRunner.query(`CREATE INDEX idx_${table}_item ON ${table} (item_id)`);
      await enableRls(queryRunner, table);
      await queryRunner.query(`DROP POLICY IF EXISTS ${table}_tenant_isolation ON ${table}`);
      await queryRunner.query(`
        CREATE POLICY ${table}_tenant_isolation ON ${table}
        FOR ALL
        USING (tenant_id = app_current_tenant())
        WITH CHECK (tenant_id = app_current_tenant())
      `);
    }

    // One link per line holding a value of its own tenant, on that tenant's default dimension.
    const window = ['analytics_categories', ...LINKS.flatMap(({ table, items }) => [table, items])];
    for (const table of window) {
      await queryRunner.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
    }
    for (const { table, items } of LINKS) {
      await queryRunner.query(`
        INSERT INTO ${table} (tenant_id, item_id, axis_id, category_id)
        SELECT i.tenant_id, i.id, c.axis_id, c.id
          FROM ${items} i
          JOIN analytics_categories c ON c.id = i.analytics_category_id AND c.tenant_id = i.tenant_id
      `);
      await queryRunner.query(`
        DO $do$
        DECLARE
          skipped int;
        BEGIN
          SELECT count(*) INTO skipped
            FROM ${items} i
            JOIN analytics_categories c ON c.id = i.analytics_category_id
           WHERE c.tenant_id <> i.tenant_id;
          IF skipped > 0 THEN
            RAISE NOTICE '${items}: % line(s) point at another tenant''s analytics category and got no link.', skipped;
          END IF;
        END
        $do$
      `);
    }
    for (const table of window) {
      await enableRls(queryRunner, table);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const window = ['analytics_axes', 'analytics_categories', ...LINKS.flatMap(({ table, items }) => [table, items])];
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
            SELECT DISTINCT COALESCE(t.slug, c.tenant_id::text) AS label
              FROM analytics_categories c
              JOIN analytics_axes a ON a.id = c.axis_id AND a.tenant_id = c.tenant_id
              LEFT JOIN tenants t ON t.id = c.tenant_id
             WHERE NOT a.is_default
          ) s;
        IF offenders IS NOT NULL THEN
          RAISE EXCEPTION 'Cannot revert the analytics dimensions: tenant(s) % have values in a dimension other than the default one. Delete those values and dimensions first.', offenders;
        END IF;
      END
      $do$
    `);

    await queryRunner.query(`
      DO $do$
      DECLARE
        t RECORD;
      BEGIN
        FOR t IN SELECT id FROM tenants ORDER BY created_at ASC, id ASC LOOP
          PERFORM set_config('app.current_tenant', t.id::text, true);
          ${LINKS.map(({ table, items }) => `
          UPDATE ${items} i
             SET analytics_category_id = d.category_id
            FROM (
              SELECT s.id, l.category_id
                FROM ${items} s
                LEFT JOIN (${table} l JOIN analytics_axes a ON a.id = l.axis_id AND a.tenant_id = l.tenant_id AND a.is_default)
                  ON l.item_id = s.id AND l.tenant_id = s.tenant_id
               WHERE s.tenant_id = t.id
            ) d
           WHERE i.id = d.id AND i.tenant_id = t.id
             AND i.analytics_category_id IS DISTINCT FROM d.category_id;`).join('\n')}
        END LOOP;
        PERFORM set_config('app.current_tenant', '', true);
      END
      $do$
    `);

    for (const { table } of LINKS) {
      await queryRunner.query(`DROP POLICY IF EXISTS ${table}_tenant_isolation ON ${table}`);
      await queryRunner.query(`DROP TABLE IF EXISTS ${table}`);
    }
    await queryRunner.query(`DROP INDEX IF EXISTS idx_analytics_categories_tenant_axis`);
    await queryRunner.query(`DROP INDEX IF EXISTS uniq_analytics_categories_tenant_axis_name`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX idx_analytics_categories_unique_name ON analytics_categories (tenant_id, lower(name))`,
    );
    await queryRunner.query(`ALTER TABLE analytics_categories DROP CONSTRAINT IF EXISTS analytics_categories_tenant_id_id_axis_id_key`);
    await queryRunner.query(`ALTER TABLE analytics_categories DROP CONSTRAINT IF EXISTS analytics_categories_axis_fk`);
    await queryRunner.query(`ALTER TABLE analytics_categories DROP COLUMN IF EXISTS axis_id`);
    await queryRunner.query(`DROP POLICY IF EXISTS analytics_axes_tenant_isolation ON analytics_axes`);
    await queryRunner.query(`DROP TABLE IF EXISTS analytics_axes`);

    for (const table of ['analytics_categories', ...LINKS.map(({ items }) => items)]) {
      await enableRls(queryRunner, table);
    }
  }
}

async function enableRls(queryRunner: QueryRunner, table: string): Promise<void> {
  await queryRunner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
  await queryRunner.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
}
