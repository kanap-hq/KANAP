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
  const git = (...args) => execFileSync('git', args, { cwd: dir, env, encoding: 'utf8' });
  const write = (files) => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), typeof text === 'string' ? text : JSON.stringify(text));
    }
  };
  const commit = (files, message = 'change') => {
    write(files);
    git('add', '-A');
    git('commit', '--quiet', '-m', message);
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
  return { dir, write, commit, page, status: () => translationStatus(dir) };
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
