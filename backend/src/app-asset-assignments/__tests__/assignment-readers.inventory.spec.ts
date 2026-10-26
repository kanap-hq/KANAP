import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { backendPath } from '../../common/__tests__/backend-root';
import { ASSIGNMENT_READERS } from '../assignment-readers.inventory';

// Every source file that reads the assignments (names the table, reads through
// `effectiveAssignmentsSql`, or uses the entity `AppAssetAssignment` other than to register it in
// a Nest module) is in the readers inventory, with its status (effective, direct with a
// reason), and every entry still reads them. Tests, migrations and fixtures
// aside.

const TABLE = 'app_asset_assignments';
const EFFECTIVE = 'effectiveAssignmentsSql';
const ENTITY = /\bAppAssetAssignment\b/;
const ROOT = backendPath();

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'migrations' || entry.name === 'fixtures') continue;
      sourceFiles(full, out);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') && !entry.name.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

const relative = (file: string) => path.relative(ROOT, file).split(path.sep).join('/');

const naming = sourceFiles(backendPath('src'))
  .filter((file) => {
    const text = fs.readFileSync(file, 'utf8');
    return text.includes(TABLE) || text.includes(EFFECTIVE) || (ENTITY.test(text) && !file.endsWith('.module.ts'));
  })
  .map(relative)
  .sort();

assert.ok(naming.length > 10, `the scan finds the readers of ${TABLE} (found ${naming.length})`);

const missing = naming.filter((file) => !(file in ASSIGNMENT_READERS));
assert.deepEqual(missing, [], `files that name ${TABLE} without an entry in assignment-readers.inventory.ts`);

const stale = Object.keys(ASSIGNMENT_READERS).filter((file) => !naming.includes(file));
assert.deepEqual(stale, [], 'inventory entries that no longer read the assignments (or no longer exist)');

for (const [file, entry] of Object.entries(ASSIGNMENT_READERS)) {
  assert.ok(['effective', 'direct'].includes(entry.status), `${file}: a known status`);
  assert.ok(entry.reason.trim().length > 0, `${file}: a reason`);
  if (entry.status === 'effective') {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.ok(
      text.includes(EFFECTIVE),
      `${file}: an effective reader goes through effectiveAssignmentsSql`,
    );
  }
}

console.log(`assignment readers inventory: ${naming.length} files, all listed`);
