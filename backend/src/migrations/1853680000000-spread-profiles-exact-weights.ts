import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The two system spread profiles store exact weights: flat is twelve 1s and
 * 4-4-5 is 4, 4, 5 per quarter. A spread divides by the sum of the weights,
 * so these give exactly 1/12, and 4/52 or 5/52, of a yearly total.
 *
 * The init migration stored 10-decimal approximations (0.0769230769 and
 * 0.0961538462 are a hair off 4:4:5). With each month rounded toward zero, a
 * 4-week month of 52 000 came out at 3 999.99 instead of 4 000.00.
 *
 * Only the rows named flat and 4-4-5 of type 'system' are changed; a profile
 * of another type is left alone. Each row is compared first and written only
 * when its weights differ, so running it again changes nothing. spread_profiles
 * is a global table (no tenant_id, no row-level security). down() restores the
 * init migration's decimals.
 */

type SystemProfile = 'flat' | '4-4-5';

const EXACT_WEIGHTS: Record<SystemProfile, number[]> = {
  flat: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  '4-4-5': [4, 4, 5, 4, 4, 5, 4, 4, 5, 4, 4, 5],
};

// As seeded by 1756684800000-init.
const INIT_WEIGHTS: Record<SystemProfile, number[]> = {
  flat: [0.0833333333, 0.0833333333, 0.0833333333, 0.0833333333, 0.0833333333, 0.0833333333, 0.0833333333, 0.0833333333, 0.0833333333, 0.0833333333, 0.0833333333, 0.0833333333],
  '4-4-5': [0.0769230769, 0.0769230769, 0.0961538462, 0.0769230769, 0.0769230769, 0.0961538462, 0.0769230769, 0.0769230769, 0.0961538462, 0.0769230769, 0.0769230769, 0.0961538462],
};

/** Store `weights` on the system profiles whose stored weights differ; returns the names changed. */
async function storeWeights(queryRunner: QueryRunner, weights: Record<SystemProfile, number[]>): Promise<string[]> {
  const changed: string[] = [];
  for (const name of ['flat', '4-4-5'] as const) {
    const value = JSON.stringify(weights[name]);
    const [{ differs }]: Array<{ differs: number }> = await queryRunner.query(
      `SELECT count(*)::int AS differs FROM spread_profiles
       WHERE name = $1 AND type = 'system' AND weights_json IS DISTINCT FROM $2::jsonb`,
      [name, value],
    );
    if (differs === 0) continue;
    await queryRunner.query(`UPDATE spread_profiles SET weights_json = $2::jsonb WHERE name = $1 AND type = 'system'`, [name, value]);
    changed.push(name);
  }
  return changed;
}

export class SpreadProfilesExactWeights1853680000000 implements MigrationInterface {
  name = 'SpreadProfilesExactWeights1853680000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const changed = await storeWeights(queryRunner, EXACT_WEIGHTS);
    if (changed.length > 0) {
      console.log(`[Migration] SpreadProfilesExactWeights: ${changed.length} row(s) changed to exact weights (${changed.join(', ')})`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await storeWeights(queryRunner, INIT_WEIGHTS);
  }
}
