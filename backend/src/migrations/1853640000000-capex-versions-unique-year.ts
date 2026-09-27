import { MigrationInterface, QueryRunner } from 'typeorm';

type DeletedVersion = {
  tenant_id: string;
  slug: string | null;
  item_number: number | null;
  budget_year: number;
  id: string;
  kept_id: string;
};

/**
 * One CAPEX budget version per line and year, the mirror of OPEX's
 * `uniq_spend_item_budget_year`: UNIQUE (capex_item_id, budget_year).
 *
 * The duplicates of a line's year are deleted first, keeping the newest
 * (created_at DESC, id DESC): the version the budget tab and the budget
 * operations already show, so users see no change. Their amounts,
 * allocations and round-input records go with them (ON DELETE CASCADE).
 * What is deleted is logged per tenant (version ids, item number, year,
 * the version kept; no amounts).
 *
 * down() drops the index only. Deleted versions are not restored: the
 * pre-deploy snapshot or dump is the recovery.
 *
 * Migrations run without app.current_tenant and FORCE applies to the owner,
 * so RLS is disabled on capex_versions (the delete) and capex_items (item
 * numbers for the log) and restored to ENABLE + FORCE, the state found
 * before. One statement covers every tenant: the four tables carry no
 * trigger besides their foreign keys, and the cascade runs as the table
 * owner outside forced RLS. Duplicates are grouped by the index key, so the
 * index is created even if a version's tenant_id disagreed with its line's.
 */
export class CapexVersionsUniqueYear1853640000000 implements MigrationInterface {
  name = 'CapexVersionsUniqueYear1853640000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE capex_versions DISABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE capex_items DISABLE ROW LEVEL SECURITY`);
    const deleted: DeletedVersion[] = await queryRunner.query(`
      WITH ranked AS (
        SELECT id, row_number() OVER w AS rn, first_value(id) OVER w AS kept_id
        FROM capex_versions
        WINDOW w AS (PARTITION BY capex_item_id, budget_year ORDER BY created_at DESC, id DESC)
      ),
      deleted AS (
        DELETE FROM capex_versions v
        USING ranked r
        WHERE v.id = r.id AND r.rn > 1
        RETURNING v.id, v.tenant_id, v.capex_item_id, v.budget_year, r.kept_id
      )
      SELECT d.tenant_id, t.slug, i.item_number, d.budget_year, d.id, d.kept_id
      FROM deleted d
      LEFT JOIN tenants t ON t.id = d.tenant_id
      LEFT JOIN capex_items i ON i.id = d.capex_item_id
      ORDER BY t.slug NULLS LAST, d.tenant_id, i.item_number, d.budget_year, d.id
    `);
    await queryRunner.query(`ALTER TABLE capex_items ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE capex_items FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE capex_versions ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE capex_versions FORCE ROW LEVEL SECURITY`);

    logDeleted(deleted);

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uniq_capex_item_budget_year ON capex_versions (capex_item_id, budget_year)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS uniq_capex_item_budget_year`);
  }
}

function logDeleted(deleted: DeletedVersion[]) {
  const prefix = '[Migration] CapexVersionsUniqueYear:';
  if (deleted.length === 0) {
    console.log(`${prefix} no duplicate CAPEX version, nothing deleted`);
    return;
  }
  const byTenant = new Map<string, DeletedVersion[]>();
  for (const row of deleted) {
    const rows = byTenant.get(row.tenant_id) ?? [];
    rows.push(row);
    byTenant.set(row.tenant_id, rows);
  }
  for (const [tenantId, rows] of byTenant) {
    console.log(`${prefix} tenant ${rows[0].slug ?? '(unknown)'} (${tenantId}): ${rows.length} duplicate CAPEX version(s) deleted`);
    for (const row of rows) {
      console.log(`  CPX-${row.item_number ?? '?'} ${row.budget_year}: deleted ${row.id}, kept ${row.kept_id}`);
    }
  }
}
