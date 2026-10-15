// The docs translation manifest stays in the form that lets git merge two pull requests updating
// neighbouring pages (scripts/docs/format-translation-manifest.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatManifest, MANIFEST } from '../format-translation-manifest.mjs';

test('the committed manifest is in its canonical form', () => {
  const text = readFileSync(MANIFEST, 'utf8');
  assert.equal(text, formatManifest(JSON.parse(text)),
    'run node scripts/docs/format-translation-manifest.mjs and commit the result');
});

test('the canonical form is valid JSON, stable, and keeps every value', () => {
  const manifest = { nav_hashes: { fr: '1', de: '2' }, glossary_hash: 'g', files: { 'b.md': 'x', 'a.md': 'y' } };
  const text = formatManifest(manifest);
  assert.deepEqual(JSON.parse(text), manifest);
  assert.equal(formatManifest(JSON.parse(text)), text);
  assert.match(text, /"a\.md": "y",\n\n {4}"b\.md": "x"/);
  assert.equal(formatManifest({ files: {}, glossary_hash: '', nav_hashes: {} }),
    '{\n  "files": {},\n\n  "glossary_hash": "",\n\n  "nav_hashes": {}\n}\n');
});

test('git merges two branches that update neighbouring keys', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'manifest-merge-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com' };
  const git = (...args) => execFileSync('git', args, { cwd: dir, env, encoding: 'utf8' }).trim();
  const files = { 'a.md': '0', 'b.md': '0', 'c.md': '0' };
  const write = (over) => writeFileSync(join(dir, 'm.json'),
    formatManifest({ files: { ...files, ...over }, glossary_hash: 'g', nav_hashes: { fr: 'n' } }));
  git('init', '--quiet', '--initial-branch=main');
  write({});
  git('add', 'm.json');
  git('commit', '--quiet', '-m', 'base');
  git('checkout', '--quiet', '-b', 'one');
  write({ 'a.md': '1' });
  git('commit', '--quiet', '-am', 'a');
  git('checkout', '--quiet', 'main');
  write({ 'b.md': '2' });
  git('commit', '--quiet', '-am', 'b');
  const merge = spawnSync('git', ['merge', '--quiet', '-m', 'merge', 'one'], { cwd: dir, env, encoding: 'utf8' });
  assert.equal(merge.status, 0, merge.stdout + merge.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'm.json'), 'utf8')).files, { 'a.md': '1', 'b.md': '2', 'c.md': '0' });
});
