import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { backendPath } from '../../common/__tests__/backend-root';
import { withImportXlsx } from '../../common/__tests__/import-xlsx-flag';
import { ConfigController } from '../config.controller';

// IMPORT_XLSX: on unless the variable says otherwise, and GET /config/public carries it as
// `features.importXlsx`, for the import dialogs to offer .xlsx.

/** `Features.IMPORT_XLSX` as a fresh process computes it with this value of the variable (unset: undefined). */
function computed(value: string | undefined): boolean {
  const env = { ...process.env };
  delete env.IMPORT_XLSX;
  if (value !== undefined) env.IMPORT_XLSX = value;
  const script = `process.stdout.write(String(require(${JSON.stringify(backendPath('src/config/features'))}).Features.IMPORT_XLSX))`;
  const run = spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', '-e', script], { env, encoding: 'utf8', cwd: backendPath('.') });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout === 'true';
}

async function main() {
  assert.equal(computed(undefined), true, 'unset: on');
  assert.equal(computed(''), true, 'empty: on');
  assert.equal(computed('false'), false);
  assert.equal(computed('0'), false);
  assert.equal(computed('true'), true);

  const controller = new ConfigController();
  for (const enabled of [true, false]) {
    await withImportXlsx(enabled, () => assert.equal(controller.getPublicConfig().features.importXlsx, enabled));
  }
  console.log('import-xlsx.spec: all assertions passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
