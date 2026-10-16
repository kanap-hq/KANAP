import { MigrationInterface, QueryRunner } from 'typeorm';

const FUNCTION = 'search_index_refresh_locations(uuid,uuid[])';
export const OLD_SEPARATOR = "CONCAT_WS(' — ', l.location_reference, l.name)";
export const NEW_SEPARATOR = "CONCAT_WS(' · ', l.location_reference, l.name)";

/**
 * The search label of a location joins its reference and its name with a middle dot,
 * like the other code and name pairs in the app ("PAR-DC1 · Paris DC 1").
 *
 * Only the deployed function body changes: the migration reads it back with
 * pg_get_functiondef, swaps the separator and replaces the function, so every other
 * part of the body stays as deployed. No backfill: index rows take the new label when
 * their location is updated or at the daily reindex. Idempotent, and a no-op when the
 * function is missing or already carries the new separator. down() puts the old one back.
 */
export class LocationSearchLabelSeparator1854170000000 implements MigrationInterface {
  name = 'LocationSearchLabelSeparator1854170000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await swapSeparator(queryRunner, OLD_SEPARATOR, NEW_SEPARATOR);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await swapSeparator(queryRunner, NEW_SEPARATOR, OLD_SEPARATOR);
  }
}

async function swapSeparator(queryRunner: QueryRunner, from: string, to: string): Promise<void> {
  const rows: Array<{ body: string | null }> = await queryRunner.query(
    `SELECT CASE WHEN to_regprocedure($1) IS NULL THEN NULL ELSE pg_get_functiondef(to_regprocedure($1)) END AS body`,
    [FUNCTION],
  );
  const body = rows[0]?.body;
  if (!body || !body.includes(from)) {
    console.log(`[1854170000000] ${FUNCTION}: nothing to change`);
    return;
  }
  await queryRunner.query(body.split(from).join(to));
  console.log(`[1854170000000] ${FUNCTION}: label separator updated`);
}
