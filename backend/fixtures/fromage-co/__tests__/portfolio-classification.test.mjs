// Every sample project names a stream of its own category. The runner creates the streams
// (setup-tenant.mjs); the four project files name the pair. A stream of another category
// is offered nowhere on the project page.
//
//   node --test backend/fixtures/fromage-co/__tests__/portfolio-classification.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from '../../../scripts/lib/fixture-csv.mjs';
import { DATASET_LANGUAGES, datasetTranslator } from '../translations/translate.mjs';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The streams the runner creates, in English: name, description, category. */
function catalogueStreams(source) {
  const marker = 'for (const [name, description, category] of [';
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, 'stream catalogue not found in setup-tenant.mjs');
  const end = source.indexOf('\n  ]) {', start);
  assert.notEqual(end, -1, 'stream catalogue end not found in setup-tenant.mjs');
  const calls = [...source.slice(start, end).matchAll(/t\(\s*'((?:\\'|[^'])*)'\s*\)/g)].map((match) =>
    match[1].replace(/\\'/g, "'"),
  );
  assert.equal(calls.length % 3, 0, `stream catalogue has ${calls.length} texts`);
  const streams = [];
  for (let i = 0; i < calls.length; i += 3) {
    streams.push({ name: calls[i], description: calls[i + 1], category: calls[i + 2] });
  }
  return streams;
}

/** Category -> stream names, as the catalogue states them in English. */
const STREAMS_BY_CATEGORY = {
  'Digital Transformation': ['Cheese Production Excellence', 'Digital Commerce'],
  'Business Applications': ['Customer Experience', 'Core Business Systems'],
  Infrastructure: ['IT Foundation'],
  'Security & Compliance': ['Cyber Resilience'],
  'Data & Analytics': ['Data Platform'],
};

const DESCRIPTIONS = {
  'Cheese Production Excellence': 'Optimize production, aging and quality',
  'Digital Commerce': 'Online sales channels and the services behind them',
  'Customer Experience': 'Improve B2B and B2C customer interactions',
  'Core Business Systems': 'ERP, HR, finance and purchasing processes',
  'IT Foundation': 'Core IT infrastructure and shared services',
  'Cyber Resilience': 'Network, identity and endpoint protection',
  'Data Platform': 'Shared data, data contracts and analytics foundations',
};

/** English project name, category, stream. Categories stay as they are. */
const PAIRS = [
  ['Legacy CRM Decommission', 'Business Applications', 'Customer Experience'],
  ["Suivi connecté de l'affinage", 'Digital Transformation', 'Cheese Production Excellence'],
  ['Fromage-as-a-Service', 'Digital Transformation', 'Digital Commerce'],
  ['Zero Trust Fromage', 'Security & Compliance', 'Cyber Resilience'],
  ['Workday Global Rollout', 'Business Applications', 'Core Business Systems'],
  ['SAP Cheddar Migration', 'Business Applications', 'Core Business Systems'],
  ['Digital Cheese Passport', 'Digital Transformation', 'Cheese Production Excellence'],
  ['Project Fondue', 'Data & Analytics', 'Data Platform'],
  ['Territory Planning Cockpit', 'Business Applications', 'Customer Experience'],
  ['Espace contrats fournisseurs', 'Business Applications', 'Core Business Systems'],
  ['Pricing Rules API Refactor', 'Digital Transformation', 'Digital Commerce'],
  ['Customer 360 Data Contracts', 'Data & Analytics', 'Data Platform'],
  ['Branch Network Segmentation', 'Security & Compliance', 'Cyber Resilience'],
  ['Endpoint Compliance Automation', 'Security & Compliance', 'Cyber Resilience'],
  ['Facturation électronique 2026', 'Business Applications', 'Core Business Systems'],
];

const NEW_STREAMS = ['Digital Commerce', 'Core Business Systems', 'Cyber Resilience', 'Data Platform'];

test('the catalogue gives each category the streams its projects need, and keeps IT Foundation', () => {
  const source = readFileSync(path.join(DIR, 'setup-tenant.mjs'), 'utf8');
  const streams = catalogueStreams(source);
  const byCategory = new Map();
  for (const stream of streams) {
    const names = byCategory.get(stream.category) ?? [];
    names.push(stream.name);
    byCategory.set(stream.category, names);
    assert.equal(stream.description, DESCRIPTIONS[stream.name], stream.name);
  }
  assert.deepEqual(
    [...byCategory.keys()].sort(),
    Object.keys(STREAMS_BY_CATEGORY).sort(),
  );
  for (const [category, names] of Object.entries(STREAMS_BY_CATEGORY)) {
    assert.deepEqual([...(byCategory.get(category) ?? [])].sort(), [...names].sort(), category);
  }
});

test('every sample project names a stream of its category, in the four languages', () => {
  const source = readFileSync(path.join(DIR, 'setup-tenant.mjs'), 'utf8');
  const streams = catalogueStreams(source);
  for (const language of DATASET_LANGUAGES) {
    const t = datasetTranslator(language);
    const offered = new Map();
    for (const stream of streams) {
      const category = t(stream.category);
      const names = offered.get(category) ?? new Set();
      names.add(t(stream.name));
      offered.set(category, names);
    }
    if (language !== 'en') {
      for (const name of NEW_STREAMS) {
        assert.notEqual(t(name), name, `${language}: stream "${name}" is translated`);
        assert.notEqual(t(DESCRIPTIONS[name]), DESCRIPTIONS[name], `${language}: description of "${name}" is translated`);
      }
    }
    const rows = parseCsv(readFileSync(path.join(DIR, language === 'en' ? '' : language, '16-portfolio-projects.csv'), 'utf8'));
    assert.equal(rows.length, PAIRS.length, `${language}: ${rows.length} projects`);
    const byName = new Map(rows.map((row) => [row.name, row]));
    for (const [project, category, stream] of PAIRS) {
      const row = byName.get(t(project));
      assert.ok(row, `${language}: project "${t(project)}"`);
      assert.equal(row.category_name, t(category), `${language}: ${project} category`);
      assert.equal(row.stream_name, t(stream), `${language}: ${project} stream`);
      assert.ok(
        offered.get(t(category))?.has(t(stream)),
        `${language}: "${t(stream)}" is not a stream of "${t(category)}"`,
      );
    }
  }
});
