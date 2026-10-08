import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { backendPath } from './backend-root';

/**
 * The helpers of the demo data loader (`backend/scripts/lib/*.mjs`: budget file conversion, the
 * fixture's year shift, the HTTP client) are plain ES modules tested with `node --test`. This
 * spec runs those tests, so CI runs them with the backend specs.
 */

const TEST_DIR = backendPath('scripts', 'lib', '__tests__');
const files = fs.readdirSync(TEST_DIR).filter((name) => name.endsWith('.test.mjs')).sort();
assert.deepEqual(files, ['budget-file.test.mjs', 'fixture-csv.test.mjs', 'http-client.test.mjs']);

const run = spawnSync(process.execPath, ['--test', ...files.map((name) => `${TEST_DIR}/${name}`)], {
  encoding: 'utf8',
  timeout: 120_000,
});
if (run.status !== 0) {
  console.error(run.stdout);
  console.error(run.stderr);
}
assert.equal(run.status, 0, 'node --test backend/scripts/lib/__tests__ passes');
console.log(`script-lib-node-tests.spec: ok (${files.length} files)`);
