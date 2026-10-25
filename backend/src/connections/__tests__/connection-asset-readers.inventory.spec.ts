import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { backendPath } from '../../common/__tests__/backend-root';
import { CONNECTION_ASSET_READERS } from '../connection-asset-readers.inventory';

// Every source file that reads the assets a connection carries (names the stored server or hop
// tables, the hop equipment column, or reads through `effectiveConnectionAssetsSql`) is in the
// readers inventory, with its status (effective, direct with a reason), and every entry still reads
// them. Tests, migrations and fixtures aside.

const TOKENS = ['connection_servers', 'connection_legs', 'equipment_asset_id'];
const EFFECTIVE = 'effectiveConnectionAssetsSql';
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
    return TOKENS.some((token) => text.includes(token)) || text.includes(EFFECTIVE);
  })
  .map(relative)
  .sort();

assert.ok(naming.length > 5, `the scan finds the readers of the connection assets (found ${naming.length})`);

const missing = naming.filter((file) => !(file in CONNECTION_ASSET_READERS));
assert.deepEqual(missing, [], 'files that read the connection assets without an entry in connection-asset-readers.inventory.ts');

const stale = Object.keys(CONNECTION_ASSET_READERS).filter((file) => !naming.includes(file));
assert.deepEqual(stale, [], 'inventory entries that no longer read the connection assets (or no longer exist)');

for (const [file, entry] of Object.entries(CONNECTION_ASSET_READERS)) {
  assert.ok(['effective', 'direct'].includes(entry.status), `${file}: a known status`);
  assert.ok(entry.reason.trim().length > 0, `${file}: a reason`);
  if (entry.status === 'effective') {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.ok(
      text.includes(EFFECTIVE),
      `${file}: an effective reader goes through effectiveConnectionAssetsSql`,
    );
  }
}

console.log(`connection asset readers inventory: ${naming.length} files, all listed`);
