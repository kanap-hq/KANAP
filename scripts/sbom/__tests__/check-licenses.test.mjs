// node --test scripts/sbom/__tests__/*.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { evaluateLicense, productionPackages } from '../lib.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'check-licenses.mjs');
const work = mkdtempSync(path.join(tmpdir(), 'kanap-licenses-'));
after(() => rmSync(work, { recursive: true, force: true }));

let counter = 0;
function lockfile(packages) {
  const file = path.join(work, `lock-${(counter += 1)}.json`);
  const entries = { '': { name: 'fixture', version: '1.0.0', license: 'AGPL-3.0-only' } };
  for (const [name, fields] of Object.entries(packages)) entries[`node_modules/${name}`] = { version: '1.0.0', ...fields };
  writeFileSync(file, JSON.stringify({ name: 'fixture', version: '1.0.0', lockfileVersion: 3, packages: entries }));
  return file;
}

function exceptionsFile(exceptions) {
  const file = path.join(work, `exceptions-${(counter += 1)}.json`);
  writeFileSync(file, JSON.stringify({ exceptions }));
  return file;
}

function check(lock, exceptions = []) {
  const result = spawnSync(process.execPath, [SCRIPT, '--exceptions', exceptionsFile(exceptions), lock], { encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe('license expressions', () => {
  it('accepts permissive and weak copyleft licenses', () => {
    for (const value of ['MIT', 'Apache-2.0', '(MIT OR Apache-2.0)', 'Apache-2.0 WITH LLVM-exception', 'LGPL-3.0-or-later', 'MPL-2.0', 'Unlicense', '(ISC AND CC-BY-3.0)']) {
      assert.deepEqual(evaluateLicense(value), { ok: true }, value);
    }
  });

  it('accepts a choice when one of its options is accepted', () => {
    assert.equal(evaluateLicense('(GPL-3.0-only OR MIT)').ok, true);
  });

  it('refuses the GPL, AGPL and SSPL families, alone or required by AND', () => {
    for (const value of ['GPL-3.0-only', 'GPL-2.0+', 'AGPL-3.0-or-later', 'SSPL-1.0', '(MIT AND GPL-2.0-only)', 'GPL-2.0-only WITH Classpath-exception-2.0']) {
      const result = evaluateLicense(value);
      assert.equal(result.ok, false, value);
      assert.match(result.problem, /refused license/, value);
    }
  });

  it('refuses a missing, custom or unreadable license', () => {
    for (const value of [undefined, null, '', '   ', 'UNLICENSED', 'SEE LICENSE IN LICENSE', 'LicenseRef-Proprietary', '(MIT', 'MIT OR', { type: 'MIT' }]) {
      assert.equal(evaluateLicense(value).ok, false, JSON.stringify(value));
    }
  });
});

describe('production packages of a lockfile', () => {
  it('keeps every entry but the root, dev-only entries and links, once per name and version', () => {
    const packages = productionPackages({
      packages: {
        '': { name: 'root', version: '1.0.0' },
        'node_modules/a': { version: '1.0.0' },
        'node_modules/b/node_modules/a': { version: '1.0.0' },
        'node_modules/c/node_modules/a': { version: '2.0.0' },
        'node_modules/dev-only': { version: '1.0.0', dev: true },
        'node_modules/optional-for-dev-or-prod': { version: '1.0.0', devOptional: true },
        'node_modules/platform-binary': { version: '1.0.0', optional: true },
        'node_modules/alias': { name: 'real-name', version: '3.0.0' },
        'node_modules/local': { resolved: 'packages/local', link: true },
      },
    });
    assert.deepEqual(packages.map((p) => p.id), ['a@1.0.0', 'a@2.0.0', 'optional-for-dev-or-prod@1.0.0', 'platform-binary@1.0.0', 'real-name@3.0.0']);
  });
});

describe('check-licenses.mjs', () => {
  it('passes when every production license is accepted and ignores development packages', () => {
    const { status, output } = check(lockfile({
      a: { license: 'MIT' },
      b: { license: '(MIT OR Apache-2.0)' },
      tool: { license: 'GPL-3.0-only', dev: true },
    }));
    assert.equal(status, 0, output);
    assert.match(output, /2 production packages, 0 accepted by an exception/);
  });

  it('fails on a refused license and names the package', () => {
    const { status, output } = check(lockfile({ a: { license: 'MIT' }, copyleft: { license: 'GPL-3.0-only' } }));
    assert.equal(status, 1, output);
    assert.match(output, /copyleft@1\.0\.0 \(node_modules\/copyleft\): refused license: GPL-3\.0-only/);
  });

  it('fails on a missing or unreadable license', () => {
    const { status, output } = check(lockfile({ bare: {}, custom: { license: 'SEE LICENSE IN ./LICENSE' } }));
    assert.equal(status, 1, output);
    assert.match(output, /bare@1\.0\.0 \(node_modules\/bare\): no license in the lockfile/);
    assert.match(output, /custom@1\.0\.0 \(node_modules\/custom\): license is not an SPDX expression/);
  });

  it('passes when a written exception with its reason covers the package and version', () => {
    const lock = lockfile({ bare: {}, copyleft: { license: 'GPL-3.0-only' } });
    const { status, output } = check(lock, [
      { name: 'bare', version: '1.0.0', license: 'MIT', reason: 'MIT in the package files' },
      { name: 'copyleft', version: '1.0.0', license: 'GPL-3.0-only', reason: 'build tool output only' },
    ]);
    assert.equal(status, 0, output);
    assert.match(output, /2 accepted by an exception/);
    assert.match(output, /Exception used: bare@1\.0\.0 \(MIT\): MIT in the package files/);
  });

  it('checks a new version again: an exception covers one exact version', () => {
    const { status, output } = check(lockfile({ bare: { version: '1.0.1' } }), [
      { name: 'bare', version: '1.0.0', license: 'MIT', reason: 'MIT in the package files' },
    ]);
    assert.equal(status, 1, output);
    assert.match(output, /bare@1\.0\.1/);
    assert.match(output, /Exceptions no longer needed .*bare@1\.0\.0/);
  });

  it('refuses an exception without a reason', () => {
    const { status, output } = check(lockfile({ bare: {} }), [{ name: 'bare', version: '1.0.0', license: 'MIT', reason: ' ' }]);
    assert.equal(status, 2, output);
    assert.match(output, /exception 1 needs a non-empty "reason"/);
  });

  it('stops on a lockfile it cannot read', () => {
    const { status, output } = check(path.join(work, 'missing.json'));
    assert.equal(status, 2, output);
    assert.match(output, /missing file/);
  });
});
