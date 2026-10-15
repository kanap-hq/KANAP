import { MigrationInterface, QueryRunner } from 'typeorm';
import { withRlsDisabled } from '../common/migration-rls';

/**
 * A foreign key on `supplier_contacts.supplier_id`, which had none: deleting a supplier deletes its
 * contact links (ON DELETE CASCADE); the contacts themselves stay. A simple key on `suppliers(id)`,
 * since suppliers has no unique `(tenant_id, id)` for a composite one.
 *
 * Links whose supplier is already gone, or belongs to another tenant, carry nothing worth keeping:
 * they are deleted first, in one statement across tenants with RLS disabled on both tables (the
 * table has no trigger), and counted per tenant in the log. A rerun finds the key and does nothing.
 */

const KEY = 'fk_supplier_contacts_supplier';
const PREFIX = '[Migration] SupplierContactsSupplierKey:';

export class SupplierContactsSupplierKey1854080000000 implements MigrationInterface {
  name = 'SupplierContactsSupplierKey1854080000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const [existing] = await queryRunner.query(
      `SELECT 1 FROM pg_constraint WHERE conrelid = 'supplier_contacts'::regclass AND conname = $1`,
      [KEY],
    );
    if (existing) {
      console.log(`${PREFIX} ${KEY} exists, nothing to do`);
      return;
    }

    const deleted: Array<{ tenant_id: string; slug: string | null; n: number }> = await withRlsDisabled(
      queryRunner,
      ['supplier_contacts', 'suppliers'],
      () =>
        queryRunner.query(`
          WITH gone AS (
            DELETE FROM supplier_contacts sc
             WHERE NOT EXISTS (SELECT 1 FROM suppliers s WHERE s.id = sc.supplier_id AND s.tenant_id = sc.tenant_id)
            RETURNING sc.tenant_id
          )
          SELECT g.tenant_id, t.slug, count(*)::int AS n
            FROM gone g LEFT JOIN tenants t ON t.id = g.tenant_id
           GROUP BY g.tenant_id, t.slug
           ORDER BY t.slug NULLS LAST, g.tenant_id
        `),
    );
    if (deleted.length === 0) console.log(`${PREFIX} no orphaned contact link`);
    for (const row of deleted) {
      console.log(`${PREFIX} tenant ${row.slug ?? '(unknown)'} (${row.tenant_id}): ${row.n} contact link(s) without their supplier deleted`);
    }

    await queryRunner.query(
      `ALTER TABLE supplier_contacts ADD CONSTRAINT ${KEY} FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE`,
    );
    console.log(`${PREFIX} added ${KEY} (supplier_contacts.supplier_id -> suppliers, ON DELETE CASCADE)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE supplier_contacts DROP CONSTRAINT IF EXISTS ${KEY}`);
  }
}
