import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cost centers and run/build (step B of professional budgeting).
 *
 * cost_centers is a tenant's tree of groups and cost centers. The per-row
 * rules are enforced here (a cost center has a company, a group has none, a
 * node is not its own parent, code and name trimmed and non-empty); the tree
 * rules (only groups are parents, no cycle, in-use nodes) live in the service.
 *
 * Foreign-key checks bypass RLS, so a single-column key cannot stop a write
 * from pointing at another tenant's node. The parent and the item lines
 * reference the node by (tenant_id, id) instead, backed by UNIQUE (tenant_id,
 * id): a mismatched tenant fails in the database, raw SQL included. The self
 * reference is NO ACTION (checked at the end of the statement) because the
 * tenant purge deletes every node of a tenant in one statement.
 *
 * spend_items and capex_items gain cost_center_id and run_build, both
 * nullable. No item row is updated: their search-index triggers write a
 * forced-RLS table and adding a column fires no row trigger.
 *
 * role_permissions: every role gets on cost_centers the level it has on
 * departments, except the built-in Budget Administrator, which gets admin
 * (budget administrators manage cost centers). Rows that already exist are
 * kept. Migrations run without app.current_tenant and roles and
 * role_permissions are both FORCE ROW LEVEL SECURITY, so RLS is disabled on
 * both around the seed and restored to ENABLE + FORCE, the state found.
 */
export class CostCenters1853650000000 implements MigrationInterface {
  name = 'CostCenters1853650000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE cost_centers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants(id) ON DELETE CASCADE,
        code text NOT NULL,
        kind text NOT NULL,
        name text NOT NULL,
        description text NULL,
        parent_id uuid NULL,
        company_id uuid NULL REFERENCES companies(id) ON DELETE RESTRICT,
        owner_user_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
        status status_state NOT NULL DEFAULT 'enabled',
        disabled_at timestamptz NULL,
        sort_order int NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT cost_centers_tenant_id_id_key UNIQUE (tenant_id, id),
        CONSTRAINT cost_centers_kind_check CHECK (kind IN ('group', 'cost_center')),
        CONSTRAINT cost_centers_company_by_kind_check CHECK ((kind = 'cost_center') = (company_id IS NOT NULL)),
        CONSTRAINT cost_centers_not_own_parent_check CHECK (parent_id IS NULL OR parent_id <> id),
        CONSTRAINT cost_centers_code_check CHECK (btrim(code) <> '' AND code = btrim(code)),
        CONSTRAINT cost_centers_name_check CHECK (btrim(name) <> '' AND name = btrim(name)),
        CONSTRAINT cost_centers_parent_fk FOREIGN KEY (tenant_id, parent_id)
          REFERENCES cost_centers (tenant_id, id) ON DELETE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uniq_cost_centers_tenant_code ON cost_centers (tenant_id, lower(code))`,
    );
    await queryRunner.query(`CREATE INDEX idx_cost_centers_tenant_parent ON cost_centers (tenant_id, parent_id)`);
    await queryRunner.query(`CREATE INDEX idx_cost_centers_tenant_company ON cost_centers (tenant_id, company_id)`);
    await queryRunner.query(`CREATE INDEX idx_cost_centers_tenant_status ON cost_centers (tenant_id, status)`);

    await queryRunner.query(`ALTER TABLE cost_centers ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE cost_centers FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`DROP POLICY IF EXISTS cost_centers_tenant_isolation ON cost_centers`);
    await queryRunner.query(`
      CREATE POLICY cost_centers_tenant_isolation ON cost_centers
      FOR ALL
      USING (tenant_id = app_current_tenant())
      WITH CHECK (tenant_id = app_current_tenant())
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'run_build') THEN
          CREATE TYPE run_build AS ENUM ('run', 'build');
        END IF;
      END
      $$;
    `);

    for (const table of ITEM_TABLES) {
      await queryRunner.query(`ALTER TABLE ${table} ADD COLUMN cost_center_id uuid NULL`);
      await queryRunner.query(`ALTER TABLE ${table} ADD COLUMN run_build run_build NULL`);
      await queryRunner.query(`
        ALTER TABLE ${table}
        ADD CONSTRAINT ${table}_cost_center_fk FOREIGN KEY (tenant_id, cost_center_id)
        REFERENCES cost_centers (tenant_id, id) ON DELETE RESTRICT
      `);
      await queryRunner.query(`CREATE INDEX idx_${table}_tenant_cost_center ON ${table} (tenant_id, cost_center_id)`);
    }

    await queryRunner.query(`ALTER TABLE roles DISABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE role_permissions DISABLE ROW LEVEL SECURITY`);
    // The built-in Budget Administrator first: admin whatever its departments level.
    await queryRunner.query(`
      INSERT INTO role_permissions (tenant_id, role_id, resource, level)
      SELECT r.tenant_id, r.id, 'cost_centers', 'admin'
      FROM roles r
      WHERE r.is_built_in = true
        AND LOWER(TRIM(r.role_name)) = 'budget administrator'
        AND NOT EXISTS (
          SELECT 1 FROM role_permissions rp
          WHERE rp.role_id = r.id AND rp.resource = 'cost_centers'
        )
    `);
    await queryRunner.query(`
      INSERT INTO role_permissions (tenant_id, role_id, resource, level)
      SELECT src.tenant_id, src.role_id, 'cost_centers', src.level
      FROM role_permissions src
      WHERE src.resource = 'departments'
        AND NOT EXISTS (
          SELECT 1 FROM role_permissions rp
          WHERE rp.role_id = src.role_id AND rp.resource = 'cost_centers'
        )
    `);
    await queryRunner.query(`ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE roles ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE roles FORCE ROW LEVEL SECURITY`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE roles DISABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE role_permissions DISABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`DELETE FROM role_permissions WHERE resource = 'cost_centers'`);
    await queryRunner.query(`ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE roles ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE roles FORCE ROW LEVEL SECURITY`);

    for (const table of ITEM_TABLES) {
      await queryRunner.query(`DROP INDEX IF EXISTS idx_${table}_tenant_cost_center`);
      await queryRunner.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_cost_center_fk`);
      await queryRunner.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS run_build`);
      await queryRunner.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS cost_center_id`);
    }
    await queryRunner.query(`DROP TYPE IF EXISTS run_build`);

    await queryRunner.query(`DROP POLICY IF EXISTS cost_centers_tenant_isolation ON cost_centers`);
    await queryRunner.query(`DROP TABLE IF EXISTS cost_centers`);
  }
}

const ITEM_TABLES = ['spend_items', 'capex_items'] as const;
