import { MigrationInterface, QueryRunner } from 'typeorm';
import { ensureReferenceKey, type ReferenceKey } from '../common/migration-reference-keys';

/**
 * Foreign keys on the references of a contract, which had none: a supplier or a company that a
 * contract names can no longer be deleted (ON DELETE RESTRICT), and a deleted owner leaves the
 * contract without one (ON DELETE SET NULL, like the owners of cost centers, business processes,
 * incidents and budget lines).
 *
 * The migration succeeds on any data (`common/migration-reference-keys.ts`):
 * - `supplier_id` and `company_id` are NOT NULL. A contract whose supplier or company is missing
 *   in its tenant is kept: its key is added NOT VALID, so every new write is checked at once, and
 *   validated once no such contract is left. The contract still opens, and choosing an existing
 *   supplier or company repairs it. The log counts those contracts per tenant, with their ids.
 * - `owner_user_id` is nullable: an owner missing in the tenant is cleared, then the key is
 *   validated.
 * A rerun validates a key left NOT VALID once its contracts are fixed.
 */

const KEYS: readonly ReferenceKey[] = [
  { table: 'contracts', column: 'supplier_id', refTable: 'suppliers', name: 'fk_contracts_supplier', onDelete: 'RESTRICT', orphans: 'keep' },
  { table: 'contracts', column: 'company_id', refTable: 'companies', name: 'fk_contracts_company', onDelete: 'RESTRICT', orphans: 'keep' },
  { table: 'contracts', column: 'owner_user_id', refTable: 'users', name: 'fk_contracts_owner_user', onDelete: 'SET NULL', orphans: 'clear' },
];

const PREFIX = '[Migration] ContractsReferenceKeys:';

export class ContractsReferenceKeys1854070000000 implements MigrationInterface {
  name = 'ContractsReferenceKeys1854070000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const key of KEYS) await ensureReferenceKey(queryRunner, key, (line) => console.log(`${PREFIX} ${line}`));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const key of KEYS) {
      await queryRunner.query(`ALTER TABLE contracts DROP CONSTRAINT IF EXISTS ${key.name}`);
    }
  }
}
