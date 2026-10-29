// Tests of .github/scripts/ci-changes.sh: which checks a merge queue run needs for the files it
// touches. Each case commits the files in a scratch repository and reads the step outputs.
//
//   node --test .github/scripts/__tests__/ci-changes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'ci-changes.sh');
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com' };

function needs(t, files) {
  const dir = mkdtempSync(join(tmpdir(), 'ci-changes-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: dir, env: ENV, encoding: 'utf8' }).trim();
  git('init', '--quiet', '--initial-branch=main');
  git('commit', '--quiet', '--allow-empty', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  for (const file of files) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), file);
    git('add', file);
  }
  git('commit', '--quiet', '-m', 'change');
  const out = execFileSync('bash', [SCRIPT, base, git('rev-parse', 'HEAD')], { cwd: dir, env: ENV, encoding: 'utf8' });
  return Object.fromEntries(out.trim().split('\n').map((line) => line.split('=')));
}

const all = { backend: 'full', frontend: 'true', builds: 'true', images: 'true' };

test('docs, marketing, release scripts and root files need no suite', (t) => {
  assert.deepEqual(needs(t, ['doc/architecture.md', 'marketing/web/src/content/blog/en/a.md',
    'scripts/release/release.mjs', 'translation-state/docs-source-hashes.json', 'AGENTS.md', 'CHANGELOG.md']),
  { backend: 'none', frontend: 'false', builds: 'false', images: 'false' });
});

test('the user manual needs the specs and the frontend tests that read it, not the builds', (t) => {
  assert.deepEqual(needs(t, ['doc/help/docs/en/suppliers.md', 'doc/help/docs/fr/suppliers.md']),
    { backend: 'docs', frontend: 'true', builds: 'false', images: 'false' });
});

test('the frontend alone needs the frontend suite and the builds', (t) => {
  assert.deepEqual(needs(t, ['frontend/src/pages/suppliers/SuppliersPage.tsx', 'doc/help/docs/en/suppliers.md']),
    { backend: 'docs', frontend: 'true', builds: 'true', images: 'false' });
  assert.deepEqual(needs(t, ['frontend/src/locales/fr/common.json']),
    { backend: 'none', frontend: 'true', builds: 'true', images: 'false' });
});

test('the backend alone needs every backend spec and the builds, not the frontend', (t) => {
  assert.deepEqual(needs(t, ['backend/src/suppliers/suppliers.service.ts']),
    { backend: 'full', frontend: 'false', builds: 'true', images: 'false' });
});

test('files read across the two trees bring the other suite', (t) => {
  for (const file of ['frontend/src/lib/audit/auditLogLabels.ts', 'frontend/src/components/history/recordHistoryTables.ts',
    'frontend/src/pages/contracts/contractTerms.ts',
    'frontend/src/pages/reports/reportAggregates.ts', 'frontend/src/pages/reports/reportTables.ts',
    'frontend/src/pages/operations/copyBudgetRows.ts', 'frontend/src/pages/admin/master-data/masterDataCopyRows.ts',
    // The rights of the Roles screen, which Plaid reads (`backend/src/ai/ai-role-labels.ts`).
    'frontend/src/pages/admin/rolePermissionGroups.ts',
    'frontend/src/pages/portfolio/contributorsOrdering.ts', 'frontend/src/pages/portfolio/skillsMatrix.ts',
    'frontend/src/pages/portfolio/roadmapOccupation.ts',
    // The label tables of the report exports are checked against these locale files.
    'frontend/src/locales/fr/portfolio.json', 'frontend/src/locales/de/it.json', 'frontend/src/locales/es/ops.json',
    'frontend/src/locales/de/master-data.json',
    // The menu words of the screens the assistant names (`backend/src/ai/ai-unread-families.ts`).
    'frontend/src/locales/fr/nav.json',
    // The record history labels are checked against the backend allow-lists.
    'frontend/src/locales/en/admin.json']) {
    assert.equal(needs(t, [file]).backend, 'full', file);
  }
  assert.equal(needs(t, ['backend/fixtures/fromage-co/setup-tenant.mjs']).frontend, 'true');
  assert.equal(needs(t, ['infra/compose.prod.yml']).backend, 'full');
  assert.equal(needs(t, ['marketing/Dockerfile']).backend, 'full');
});

test('a change of the CI runs everything', (t) => {
  assert.deepEqual(needs(t, ['.github/workflows/ci.yml']), all);
});

test('the images follow the files that reach them', (t) => {
  assert.equal(needs(t, ['marketing/web/package.json']).images, 'true');
  assert.equal(needs(t, ['frontend/nginx/default.conf']).images, 'true');
  assert.equal(needs(t, ['marketing/web/src/pages/index.astro']).images, 'false');
});

test('when the files cannot be listed, everything runs', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ci-changes-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet'], { cwd: dir, env: ENV });
  const out = execFileSync('bash', [SCRIPT, '0'.repeat(40), '1'.repeat(40)], { cwd: dir, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  assert.deepEqual(Object.fromEntries(out.trim().split('\n').map((l) => l.split('='))), all);
});
