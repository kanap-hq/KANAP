// The translation status of the user manual comes from git history alone
// (scripts/docs/translation-status.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { translationStatus } from '../translation-status.mjs';

function repo(t) {
  const dir = mkdtempSync(join(tmpdir(), 'translation-status-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com' };
  const git = (...args) => execFileSync('git', args, { cwd: dir, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  // Fixed clock, one minute per commit, so a side committed second is strictly newer.
  let stamp = Date.parse('2026-01-01T00:00:00Z');
  const commitIndex = (message) => {
    const when = new Date(stamp += 60_000).toISOString();
    env.GIT_COMMITTER_DATE = when;
    git('commit', '--quiet', '--date', when, '-m', message);
    delete env.GIT_COMMITTER_DATE;
  };
  const write = (files) => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), typeof text === 'string' ? text : JSON.stringify(text));
    }
  };
  const commit = (files, message = 'change') => {
    write(files);
    git('add', '-A');
    commitIndex(message);
  };
  git('init', '--quiet', '--initial-branch=main');
  const page = (locale, text) => ({ [`doc/help/docs/${locale}/a.md`]: text });
  commit({
    ...page('en', 'Open Overview.'), ...page('fr', 'Ouvrez Vue.'), ...page('de', 'Öffnen.'), ...page('es', 'Abra.'),
    'frontend/src/locales/glossary.json': { entities: { request: { fr: 'demande', de: 'Anfrage', es: 'solicitud' } } },
    'frontend/src/locales/fr/nav.json': { sidebar: { overview: 'Vue' } },
    'frontend/src/locales/de/nav.json': {},
    'frontend/src/locales/es/nav.json': {},
  }, 'base');
  return { dir, write, commit, commitIndex, page, git, status: () => translationStatus(dir) };
}

// `git merge` exits non-zero when a file conflicts. The index then holds the conflict.
function mergeAllowingConflicts(git, ...args) {
  try {
    git('merge', ...args);
  } catch (error) {
    if (!git('diff', '--name-only', '--diff-filter=U').trim()) throw error;
  }
}

const stale = (status) => status.stale.map(({ locale, page }) => `${locale}/${page}`).sort();

test('a translation is stale when its English page changed in a later commit', (t) => {
  const r = repo(t);
  assert.deepEqual(r.status().stale, []);
  r.commit(r.page('en', 'Open the overview.'));
  assert.deepEqual(stale(r.status()), ['de/a.md', 'es/a.md', 'fr/a.md']);
  r.commit(r.page('fr', 'Ouvrez la vue.'));
  assert.deepEqual(stale(r.status()), ['de/a.md', 'es/a.md']);
});

test('one commit that changes the English page and its translations leaves them up to date', (t) => {
  const r = repo(t);
  r.commit({ ...r.page('en', 'New.'), ...r.page('fr', 'Nouveau.'), ...r.page('de', 'Neu.'), ...r.page('es', 'Nuevo.') });
  assert.deepEqual(r.status().stale, []);
});

test('uncommitted changes: an English edit is stale, a translation being written is not', (t) => {
  const r = repo(t);
  r.write({ ...r.page('en', 'Edited.'), ...r.page('fr', 'Modifié.') });
  assert.deepEqual(stale(r.status()), ['de/a.md', 'es/a.md']);
  assert.deepEqual(r.status().stale[0].commits, ['uncommitted']);
});

test('missing and orphan translations', (t) => {
  const r = repo(t);
  r.commit({ 'doc/help/docs/en/b.md': 'B.', 'doc/help/docs/fr/b.md': 'B.', 'doc/help/docs/de/gone.md': 'Weg.' });
  const status = r.status();
  assert.deepEqual(status.missing, [{ locale: 'de', page: 'b.md' }, { locale: 'es', page: 'b.md' }]);
  assert.deepEqual(status.orphans, [{ locale: 'de', page: 'gone.md' }]);
});

test('a renamed term is listed only for the pages that still use the former wording', (t) => {
  const r = repo(t);
  r.commit({ 'frontend/src/locales/fr/nav.json': { sidebar: { overview: 'Aperçu', added: 'Nouveau' } } });
  assert.deepEqual(r.status().terms, [{ locale: 'fr', page: 'a.md', source: 'nav',
    terms: [{ key: 'sidebar.overview', from: 'Vue', to: 'Aperçu' }] }]);
  r.commit(r.page('fr', 'Ouvrez Aperçu.'));
  assert.deepEqual(r.status().terms, []);
});

test('glossary changes count per language', (t) => {
  const r = repo(t);
  r.commit({ ...r.page('es', 'Cree una solicitud.') });
  r.commit({ 'frontend/src/locales/glossary.json': { entities: { request: { fr: 'demande', de: 'Antrag', es: 'petición' } } } });
  assert.deepEqual(r.status().terms.map(({ locale, source }) => `${locale}:${source}`), ['es:glossary']);
});

test('a translation resolved in a merge, after the last English change, is not stale', (t) => {
  const r = repo(t);
  // b.md stays on the branch, so the merged manual matches neither parent and both sides are walked.
  r.commit({
    'doc/help/docs/en/b.md': 'B.', 'doc/help/docs/fr/b.md': 'B.',
    'doc/help/docs/de/b.md': 'B.', 'doc/help/docs/es/b.md': 'B.',
  });
  r.git('checkout', '--quiet', '-b', 'topic');
  r.git('checkout', '--quiet', 'main');
  r.commit({
    ...r.page('en', 'Open the overview.'), ...r.page('fr', 'Ouvrez la vue.'),
    'doc/help/docs/en/b.md': 'Main B.', 'doc/help/docs/fr/b.md': 'B du tronc.',
  });
  r.git('checkout', '--quiet', 'topic');
  r.commit({
    ...r.page('en', 'Open Overview now.'), ...r.page('fr', 'Ouvrez la vue maintenant.'),
    'doc/help/docs/en/b.md': 'Topic B.', 'doc/help/docs/fr/b.md': 'B de la branche.',
  });
  mergeAllowingConflicts(r.git, '--no-commit', 'main');
  r.git('checkout', 'main', '--', 'doc/help/docs/en/a.md', 'doc/help/docs/fr/a.md');
  r.git('checkout', '--ours', '--', 'doc/help/docs/en/b.md', 'doc/help/docs/fr/b.md');
  r.git('add', '-A');
  r.commitIndex('merge');
  assert.deepEqual(stale(r.status()), ['de/a.md', 'de/b.md', 'es/a.md', 'es/b.md']);
});

test('a translation written in the merge, together with its English page, is up to date', (t) => {
  const r = repo(t);
  r.git('checkout', '--quiet', '-b', 'topic');
  r.commit({ ...r.page('en', 'Branch.'), ...r.page('fr', 'Branche.') });
  r.git('checkout', '--quiet', 'main');
  r.commit({ ...r.page('en', 'Main.'), ...r.page('fr', 'Tronc.') });
  r.git('checkout', '--quiet', 'topic');
  mergeAllowingConflicts(r.git, '--no-commit', 'main');
  r.write({ ...r.page('en', 'Merged.'), ...r.page('fr', 'Fusion.') });
  r.git('add', '-A');
  r.commitIndex('merge');
  assert.deepEqual(stale(r.status()), ['de/a.md', 'es/a.md']);
});

test('an English page changed only in a merge resolution makes its translations stale', (t) => {
  const r = repo(t);
  r.git('checkout', '--quiet', '-b', 'topic');
  r.commit({ 'doc/help/docs/en/b.md': 'Topic.', 'doc/help/docs/fr/b.md': 'Branche.' });
  r.git('checkout', '--quiet', 'main');
  r.commit({ 'doc/help/docs/en/b.md': 'Main.', 'doc/help/docs/fr/b.md': 'Tronc.' });
  r.git('checkout', '--quiet', 'topic');
  mergeAllowingConflicts(r.git, '--no-commit', 'main');
  r.git('checkout', '--ours', '--', 'doc/help/docs/en/b.md', 'doc/help/docs/fr/b.md');
  r.write(r.page('en', 'Open the overview.'));
  r.git('add', '-A');
  r.commitIndex('merge');
  const status = r.status();
  assert.deepEqual(stale(status), ['de/a.md', 'es/a.md', 'fr/a.md']);
  assert.deepEqual(status.stale.map(({ commits }) => commits.length), [1, 1, 1]);
});

test('a stale translation stays stale when a branch that did not touch it merges main', (t) => {
  const r = repo(t);
  r.git('checkout', '--quiet', '-b', 'topic');
  r.git('checkout', '--quiet', 'main');
  r.commit({ ...r.page('en', 'Open the overview.'), ...r.page('fr', 'Ouvrez la vue.') });
  r.commit(r.page('en', 'Open the overview now.'));
  assert.deepEqual(stale(r.status()), ['de/a.md', 'es/a.md', 'fr/a.md']);
  r.git('checkout', '--quiet', 'topic');
  r.git('merge', '--no-ff', '--no-commit', '--quiet', 'main');
  r.commitIndex('merge main');
  assert.deepEqual(stale(r.status()), ['de/a.md', 'es/a.md', 'fr/a.md']);
});
