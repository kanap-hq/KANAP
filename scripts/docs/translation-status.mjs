#!/usr/bin/env node
// Says which translated pages of the user manual (doc/help/docs/{fr,de,es}) need work, from git
// history alone. The translate-docs skill reads it; nothing is stored in the repository.
//
//   node scripts/docs/translation-status.mjs          print the report
//   node scripts/docs/translation-status.mjs --json   print it as JSON
//
// A translated page is stale when its English page changed in a commit after the last commit
// that touched the translated page, or has uncommitted changes while the translated page has
// none. The repository squashes, so a pull request that updates an English page and its
// translations leaves one commit: up to date. A translated page with uncommitted changes counts
// as being written and is never stale.
//
// Glossary and nav labels: a translated page is listed when a term of its language changed since
// its last commit (glossary.json, or the language's nav.json) and the page still contains the
// former wording. Added and removed terms need no work, nor a wording another term still uses.
//
// Not covered: a translated page edited alone (a typo) after an English change that was never
// translated counts as up to date.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LOCALES = ['fr', 'de', 'es'];
const DOCS = 'doc/help/docs';
const GLOSSARY = 'frontend/src/locales/glossary.json';
const nav = (locale) => `frontend/src/locales/${locale}/nav.json`;

const markdown = (dir) =>
  !existsSync(dir)
    ? []
    : readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return markdown(path).map((p) => `${name}/${p}`);
        return name.endsWith('.md') ? [name] : [];
      });

// Glossary terms of one language, by key: { "entities.request": "demande", ... }.
function glossaryTerms(json, locale) {
  const terms = {};
  for (const [category, entries] of Object.entries(json)) {
    if (!entries || typeof entries !== 'object') continue;
    for (const [term, value] of Object.entries(entries)) {
      if (value && typeof value[locale] === 'string') terms[`${category}.${term}`] = value[locale];
    }
  }
  return terms;
}

// Every string of a nav.json, by key path.
function navLabels(json, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(json)) {
    if (typeof value === 'string') out[prefix + key] = value;
    else if (value && typeof value === 'object') navLabels(value, `${prefix}${key}.`, out);
  }
  return out;
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const contains = (page, term) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(term)}(?![\\p{L}\\p{N}])`, 'iu').test(page);

export function translationStatus(root) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });
  if (git('rev-parse', '--is-shallow-repository').trim() === 'true') {
    throw new Error('This clone is shallow: the translation status needs the full history (git fetch --unshallow).');
  }

  // Last commit that touched each file of the manual (git log lists the newest first).
  const last = new Map();
  let commit = null;
  for (const line of git('log', '--format=%x00%H', '--name-only', '--', DOCS).split('\n')) {
    if (line.startsWith('\0')) commit = line.slice(1);
    else if (line && !last.has(line)) last.set(line, commit);
  }
  const dirty = new Set(
    git('status', '--porcelain', '--untracked-files=all', '--no-renames', '--', DOCS, GLOSSARY, 'frontend/src/locales')
      .split('\n')
      .filter(Boolean)
      .map((line) => line.slice(3)),
  );
  const changedSince = (from, path) => git('log', '--format=%h', `${from}..HEAD`, '--', path).split('\n').filter(Boolean);

  // Terms of a language as they were at a commit, and as they are now on disk.
  const cache = new Map();
  const read = (rev, path) => {
    const key = `${rev}:${path}`;
    if (!cache.has(key)) {
      let text = null;
      try {
        text = rev ? git('show', key) : readFileSync(join(root, path), 'utf8');
      } catch {}
      cache.set(key, text === null ? null : JSON.parse(text));
    }
    return cache.get(key);
  };
  const sources = (locale) => [
    { source: 'glossary', path: GLOSSARY, terms: (json) => glossaryTerms(json, locale) },
    { source: 'nav', path: nav(locale), terms: (json) => navLabels(json) },
  ];
  const changedTerms = (from, { path, terms }) => {
    if (changedSince(from, path).length === 0 && !dirty.has(path)) return [];
    const before = read(from, path);
    const now = read(null, path);
    if (!before || !now) return [];
    const old = terms(before);
    const current = terms(now);
    const wordings = new Set(Object.values(current));
    return Object.keys(old)
      .filter((key) => key in current && old[key] !== current[key] && !wordings.has(old[key]))
      .map((key) => ({ key, from: old[key], to: current[key] }));
  };

  const pages = markdown(join(root, DOCS, 'en')).sort();
  const status = { pages: pages.length, missing: [], orphans: [], stale: [], terms: [] };
  for (const locale of LOCALES) {
    const translated = new Set(markdown(join(root, DOCS, locale)));
    for (const page of translated) if (!pages.includes(page)) status.orphans.push({ locale, page });
    for (const page of pages) {
      const english = `${DOCS}/en/${page}`;
      const target = `${DOCS}/${locale}/${page}`;
      if (!translated.has(page)) {
        status.missing.push({ locale, page });
        continue;
      }
      if (dirty.has(target) || !last.has(target)) continue;
      const from = last.get(target);
      const commits = changedSince(from, english);
      if (commits.length > 0 || dirty.has(english)) {
        status.stale.push({ locale, page, commits: dirty.has(english) ? ['uncommitted', ...commits] : commits });
      }
      const text = readFileSync(join(root, target), 'utf8');
      for (const source of sources(locale)) {
        const terms = changedTerms(from, source).filter((term) => contains(text, term.from));
        if (terms.length > 0) status.terms.push({ locale, page, source: source.source, terms });
      }
    }
  }
  return status;
}

function report(status) {
  const lines = [`English pages: ${status.pages}`];
  const section = (title, items, line) => {
    lines.push(`${title}: ${items.length}`);
    for (const item of items) lines.push(`  ${line(item)}`);
  };
  section('Missing translations', status.missing, ({ locale, page }) => `${locale}/${page}`);
  section('Stale translations (English changed since)', status.stale,
    ({ locale, page, commits }) => `${locale}/${page}  (${commits.join(' ')})`);
  section('Changed terms still in the page', status.terms, ({ locale, page, source, terms }) =>
    `${locale}/${page}  ${source}: ${terms.map((t) => `"${t.from}" -> "${t.to}"`).join(', ')}`);
  section('Orphans (no English page)', status.orphans, ({ locale, page }) => `${locale}/${page}`);
  return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const status = translationStatus(root);
  console.log(process.argv.includes('--json') ? JSON.stringify(status, null, 2) : report(status));
}
