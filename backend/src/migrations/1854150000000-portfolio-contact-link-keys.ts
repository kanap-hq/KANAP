import { MigrationInterface, QueryRunner } from 'typeorm';
import { ensureReferenceKey, type ReferenceKey } from '../common/migration-reference-keys';

/**
 * Foreign keys on `portfolio_project_contacts.contact_id` and `portfolio_request_contacts.contact_id`,
 * which had none: deleting a contact deletes its project and request links (ON DELETE CASCADE); the
 * projects and requests stay. Their `project_id` and `request_id` already cascade.
 *
 * Links whose contact is missing in their tenant (left behind by contact deletes before this key)
 * carry nothing worth keeping: they are deleted first, counted per tenant in the log, then the keys
 * are validated (`common/migration-reference-keys.ts`). A rerun finds the keys in place and does nothing.
 */

const KEYS: ReferenceKey[] = [
  {
    table: 'portfolio_project_contacts',
    column: 'contact_id',
    refTable: 'contacts',
    name: 'fk_portfolio_project_contacts_contact',
    onDelete: 'CASCADE',
    orphans: 'delete',
  },
  {
    table: 'portfolio_request_contacts',
    column: 'contact_id',
    refTable: 'contacts',
    name: 'fk_portfolio_request_contacts_contact',
    onDelete: 'CASCADE',
    orphans: 'delete',
  },
];
const PREFIX = '[Migration] PortfolioContactLinkKeys:';

export class PortfolioContactLinkKeys1854150000000 implements MigrationInterface {
  name = 'PortfolioContactLinkKeys1854150000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const key of KEYS) await ensureReferenceKey(queryRunner, key, (line) => console.log(`${PREFIX} ${line}`));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const key of KEYS) await queryRunner.query(`ALTER TABLE ${key.table} DROP CONSTRAINT IF EXISTS ${key.name}`);
  }
}
