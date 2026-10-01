import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { SpreadProfilesExactWeights1853680000000 } from '../../migrations/1853680000000-spread-profiles-exact-weights';
import { resolveSpreadProfile } from '../amounts-write.util';
import { spreadAnnualToMonths } from '../spread.util';
import { assert, inRolledBackTransaction, runSpecs } from './round-inputs.fixtures';

// Migration 1853680000000 against the database behind `dataSource`, inside a
// transaction that is always rolled back: the init decimals become exact
// weights, a second run changes nothing, down() restores the decimals, and a
// profile of another type is left alone.

const INIT = {
  flat: Array.from({ length: 12 }, () => 0.0833333333),
  '4-4-5': Array.from({ length: 12 }, (_, i) => ((i + 1) % 3 === 0 ? 0.0961538462 : 0.0769230769)),
};
const EXACT = {
  flat: Array.from({ length: 12 }, () => 1),
  '4-4-5': Array.from({ length: 12 }, (_, i) => ((i + 1) % 3 === 0 ? 5 : 4)),
};

async function stored(runner: QueryRunner) {
  const rows: Array<{ name: string; type: string; weights_json: number[] }> = await runner.query(
    `SELECT name, type, weights_json FROM spread_profiles WHERE name IN ('flat', '4-4-5') ORDER BY name`,
  );
  return Object.fromEntries(rows.map((row) => [row.name, row.weights_json]));
}

async function setWeights(runner: QueryRunner, name: string, weights: number[]) {
  await runner.query(`UPDATE spread_profiles SET weights_json = $2::jsonb WHERE name = $1`, [name, JSON.stringify(weights)]);
}

/** The lines `fn` logs with console.log. */
async function logged(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines;
}

async function testUpTwiceAndDown() {
  await inRolledBackTransaction(async (runner) => {
    const migration = new SpreadProfilesExactWeights1853680000000();
    await setWeights(runner, 'flat', INIT.flat);
    await setWeights(runner, '4-4-5', INIT['4-4-5']);
    assert.deepEqual(await stored(runner), INIT, 'the init decimals to start from');

    const first = await logged(() => migration.up(runner));
    assert.deepEqual(await stored(runner), EXACT, 'up stores exact weights');
    assert.deepEqual(first, ['[Migration] SpreadProfilesExactWeights: 2 row(s) changed to exact weights (flat, 4-4-5)']);

    // What a spread reads now: 52 000 with 4-4-5 is 4 000 and 5 000 exactly.
    const profile = await resolveSpreadProfile(runner.manager, '4-4-5');
    const months = spreadAnnualToMonths(2031, { planned: 5_200_000n }, profile.weights).map((row) => row.planned);
    assert.deepEqual(months, EXACT['4-4-5'].map((w) => BigInt(w) * 100_000n));
    assert.deepEqual(profile.labels.slice(0, 3), ['4', '4', '5']);

    const second = await logged(() => migration.up(runner));
    assert.deepEqual(await stored(runner), EXACT, 'a second up changes nothing');
    assert.deepEqual(second, [], 'and logs nothing');

    await migration.down(runner);
    assert.deepEqual(await stored(runner), INIT, 'down restores the init decimals');
  });
}

async function testOtherTypesAreLeftAlone() {
  await inRolledBackTransaction(async (runner) => {
    const migration = new SpreadProfilesExactWeights1853680000000();
    await setWeights(runner, 'flat', INIT.flat);
    await setWeights(runner, '4-4-5', INIT['4-4-5']);
    await runner.query(`UPDATE spread_profiles SET type = 'custom' WHERE name = '4-4-5'`);
    const lines = await logged(() => migration.up(runner));
    assert.deepEqual(await stored(runner), { flat: EXACT.flat, '4-4-5': INIT['4-4-5'] }, 'a 4-4-5 row of another type keeps its weights');
    assert.deepEqual(lines, ['[Migration] SpreadProfilesExactWeights: 1 row(s) changed to exact weights (flat)']);
  });
}

void runSpecs('spread-profiles-exact-weights.integration.spec', [
  ['testUpTwiceAndDown', testUpTwiceAndDown],
  ['testOtherTypesAreLeftAlone', testOtherTypesAreLeftAlone],
]);

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
