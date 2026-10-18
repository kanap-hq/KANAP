import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The living catalog of technologies (lot C4).
 *
 * - `technology_catalog_products`: the platform cache of the release cycles endoflife.date
 *   publishes for the catalog entries some tenant has adopted, refreshed by the scheduled task
 *   `technology-catalog` (`technologies/catalog/technology-catalog-sync.service.ts`). No
 *   `tenant_id`, shared by the whole installation like `vulnerability_cves`: nothing in it names a
 *   tenant. `versions` holds the versions as the catalog keeps them (`CatalogVersion[]`).
 * - `technologies.catalog_state`: what the catalog has given the technology, so that the sync
 *   never overwrites a value the tenant typed and never brings back what the tenant deleted: the
 *   CPE identifiers offered, and per version key the values last written (end of standard and
 *   extended support, `cpe_version`). A version key present there was offered once. Null until
 *   the first sync, which starts from the shipped catalog.
 *
 * Idempotent; down() drops both.
 */
export class TechnologyCatalogSync1854320000000 implements MigrationInterface {
  name = 'TechnologyCatalogSync1854320000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS technology_catalog_products (
        catalog_key text PRIMARY KEY,
        versions jsonb NOT NULL DEFAULT '[]'::jsonb,
        last_success_at timestamptz NULL,
        last_attempt_at timestamptz NULL,
        last_error text NULL,
        CONSTRAINT technology_catalog_products_versions_check CHECK (jsonb_typeof(versions) = 'array')
      )`);
    await queryRunner.query(`ALTER TABLE technologies ADD COLUMN IF NOT EXISTS catalog_state jsonb NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE technologies DROP COLUMN IF EXISTS catalog_state`);
    await queryRunner.query(`DROP TABLE IF EXISTS technology_catalog_products`);
  }
}
