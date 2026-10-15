import { MigrationInterface, QueryRunner } from 'typeorm';
import { ensureReferenceKey, type ReferenceKey } from '../common/migration-reference-keys';

/**
 * A foreign key on `supplier_contacts.supplier_id`, which had none: deleting a supplier deletes its
 * contact links (ON DELETE CASCADE); the contacts themselves stay. A simple key on `suppliers(id)`,
 * since suppliers has no unique `(tenant_id, id)` for a composite one.
 *
 * Links whose supplier is missing in their tenant carry nothing worth keeping: they are deleted
 * first, counted per tenant in the log, then the key is validated
 * (`common/migration-reference-keys.ts`). A rerun finds the key in place and does nothing.
 */

const KEY: ReferenceKey = {
  table: 'supplier_contacts',
  column: 'supplier_id',
  refTable: 'suppliers',
  name: 'fk_supplier_contacts_supplier',
  onDelete: 'CASCADE',
  orphans: 'delete',
};
const PREFIX = '[Migration] SupplierContactsSupplierKey:';

export class SupplierContactsSupplierKey1854080000000 implements MigrationInterface {
  name = 'SupplierContactsSupplierKey1854080000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await ensureReferenceKey(queryRunner, KEY, (line) => console.log(`${PREFIX} ${line}`));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE supplier_contacts DROP CONSTRAINT IF EXISTS ${KEY.name}`);
  }
}
