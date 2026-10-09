// node --test scripts/sbom/__tests__/*.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'generate.mjs');
const ROOT = path.resolve(HERE, '..', '..', '..');
const FOLDERS = { backend: 'sbom-backend.cdx.json', frontend: 'sbom-frontend.cdx.json', 'marketing/web': 'sbom-marketing-web.cdx.json' };
const work = mkdtempSync(path.join(tmpdir(), 'kanap-sbom-'));
after(() => rmSync(work, { recursive: true, force: true }));

function generate(args, env = process.env) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

// Production entries counted straight from the lockfile: every node_modules entry that is not
// dev-only or a link, one per name and version.
function productionIds(folder) {
  const lock = JSON.parse(readFileSync(path.join(ROOT, folder, 'package-lock.json'), 'utf8'));
  const ids = new Set();
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (!key.includes('node_modules/') || entry.dev || entry.link) continue;
    ids.add(`${entry.name ?? key.split('node_modules/').pop()}@${entry.version}`);
  }
  return ids;
}

describe('generate.mjs on the lockfiles of the repository', () => {
  const out = path.join(work, 'release');
  let run;
  before(() => {
    run = generate(['--out', out]);
  });

  it('runs without error', () => {
    assert.equal(run.status, 0, run.output);
  });

  for (const [folder, file] of Object.entries(FOLDERS)) {
    it(`writes a CycloneDX file for ${folder} with one component per production package`, () => {
      const bom = JSON.parse(readFileSync(path.join(out, file), 'utf8'));
      assert.equal(bom.bomFormat, 'CycloneDX');
      assert.equal(bom.specVersion, '1.5');
      assert.match(bom.serialNumber, /^urn:uuid:[0-9a-f-]{36}$/);
      assert.deepEqual(bom.metadata.component.licenses, [{ license: { id: 'AGPL-3.0-only' } }]);

      const expected = productionIds(folder);
      assert.ok(expected.size > 0);
      assert.equal(bom.components.length, expected.size);
      const ids = bom.components.map((c) => `${c.group ? `${c.group}/` : ''}${c.name}@${c.version}`);
      assert.deepEqual(new Set(ids), expected);
      const refs = bom.components.map((c) => c['bom-ref']);
      assert.equal(new Set(refs).size, refs.length, 'bom-ref values are unique');
      for (const c of bom.components) {
        assert.equal(c.type, 'library');
        assert.match(c.purl, /^pkg:npm\/.+@.+$/);
        assert.ok(c.licenses?.length, `${c.purl} has a license`);
      }
    });
  }

  it('leaves out development packages', () => {
    const bom = JSON.parse(readFileSync(path.join(out, FOLDERS.frontend), 'utf8'));
    assert.ok(!bom.components.some((c) => c.name === 'vitest'));
    assert.ok(bom.components.some((c) => c.name === 'react'));
  });

  it('writes the third-party notices of the three folders, licenses from exceptions included', () => {
    const text = readFileSync(path.join(out, 'THIRD-PARTY-NOTICES.txt'), 'utf8');
    for (const folder of Object.keys(FOLDERS)) {
      assert.match(text, new RegExp(`== ${folder.replace('/', '\\/')} \\(${productionIds(folder).size} packages\\) ==`));
    }
    assert.match(text, /\nreact 18\.\d+\.\d+\n {2}License: MIT\n/);
    assert.match(text, /\nbusboy 1\.6\.0\n {2}License: MIT\n/);
    assert.doesNotMatch(text, /License: none declared/);
  });

  it('writes no image file without --image', () => {
    assert.equal(existsSync(path.join(out, 'api-image-packages.txt')), false);
  });
});

describe('generate.mjs options', () => {
  it('lists the Alpine packages and the Node.js version of an image with --image', () => {
    const bin = path.join(work, 'bin');
    mkdirSync(bin, { recursive: true });
    const fake = path.join(bin, 'docker');
    writeFileSync(fake, '#!/bin/sh\ncase "$*" in\n  *"--entrypoint apk"*) printf "zlib-1.3.1-r2\\nmusl-1.2.5-r10\\n" ;;\n  *"--entrypoint node"*) echo v24.0.0 ;;\n  *) exit 3 ;;\nesac\n');
    chmodSync(fake, 0o755);
    const out = path.join(work, 'with-image');
    const run = generate(['--out', out, '--image', 'kanap-api:test'], { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` });
    assert.equal(run.status, 0, run.output);
    const lines = readFileSync(path.join(out, 'api-image-packages.txt'), 'utf8').trim().split('\n');
    assert.match(lines[0], /^# Alpine packages of the API image kanap-api:test \(apk info -v\): 2$/);
    assert.match(lines[1], /Node\.js v24\.0\.0/);
    assert.deepEqual(lines.slice(2), ['musl-1.2.5-r10', 'zlib-1.3.1-r2']);
  });

  it('writes nothing when the image cannot be read', () => {
    const bin = path.join(work, 'bin-failing');
    mkdirSync(bin, { recursive: true });
    const fake = path.join(bin, 'docker');
    writeFileSync(fake, '#!/bin/sh\necho "no such image" >&2\nexit 1\n');
    chmodSync(fake, 0o755);
    const out = path.join(work, 'failing-image');
    const run = generate(['--out', out, '--image', 'missing:tag'], { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` });
    assert.equal(run.status, 2, run.output);
    assert.match(run.output, /no such image/);
    assert.equal(existsSync(out), false);
  });

  it('refuses an output folder inside the repository', () => {
    const run = generate(['--out', path.join(ROOT, 'sbom-out')]);
    assert.equal(run.status, 2, run.output);
    assert.match(run.output, /outside the repository/);
    assert.equal(existsSync(path.join(ROOT, 'sbom-out')), false);
  });

  it('requires an output folder', () => {
    const run = generate([]);
    assert.equal(run.status, 2, run.output);
    assert.match(run.output, /usage/);
  });
});
