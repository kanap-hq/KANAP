import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The administration zone of an asset (lot A1b, administration view of the ANSSI mapping
 * guide): `assets.admin_zone`, a code of the tenant's "Administration zones" catalog
 * (`it_ops.admin_zones` in the tenant metadata), nullable text like `domain`.
 *
 * Idempotent and self-healing. When the column is already there (a rerun, or a database that got
 * it another way), it is brought to the expected shape: text, nullable, no default. A blank value
 * means "no zone" and becomes NULL. The assets carry a search index trigger that writes
 * `search_index` under its policy, so that repair runs per tenant with `app.current_tenant` set.
 */
export class AssetAdminZone1854340000000 implements MigrationInterface {
  name = 'AssetAdminZone1854340000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE assets ADD COLUMN IF NOT EXISTS admin_zone text NULL`);
    await queryRunner.query(`ALTER TABLE assets ALTER COLUMN admin_zone TYPE text`);
    await queryRunner.query(`ALTER TABLE assets ALTER COLUMN admin_zone DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE assets ALTER COLUMN admin_zone DROP DEFAULT`);

    const tenants: Array<{ id: string }> = await queryRunner.query(`SELECT id FROM tenants ORDER BY id`);
    let repaired = 0;
    for (const { id } of tenants) {
      await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [id]);
      const [{ count }]: Array<{ count: number }> = await queryRunner.query(
        `WITH changed AS (
           UPDATE assets SET admin_zone = NULL
            WHERE tenant_id = $1 AND admin_zone IS NOT NULL AND btrim(admin_zone) = ''
           RETURNING 1
         )
         SELECT count(*)::int AS count FROM changed`,
        [id],
      );
      repaired += Number(count);
    }
    await queryRunner.query(`SELECT set_config('app.current_tenant', '', true)`);
    if (repaired > 0) console.log(`[migration 1854340000000] assets.admin_zone: ${repaired} blank value(s) set to NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE IF EXISTS assets DROP COLUMN IF EXISTS admin_zone`);
  }
}
