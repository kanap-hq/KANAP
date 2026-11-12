import assert from 'node:assert/strict';
import * as path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { FAMILIES, loadDataset, parseFrontMatter, selectTickets, tenantTitle, validateTicket } from '../lib/dataset.mjs';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

test('the front matter is read, quotes around a value are dropped', () => {
  const { meta, body } = parseFrontMatter('---\ntitle: "Teams: no sound"\nstatus: published\n---\nBody text.\n');
  assert.equal(meta.title, 'Teams: no sound');
  assert.equal(meta.status, 'published');
  assert.equal(body, 'Body text.');
  assert.throws(() => parseFrontMatter('no front matter'), /missing front matter/);
});

test('the bench set loads and covers every family', () => {
  const { articles, tickets } = loadDataset(DATA_DIR);
  assert.ok(tickets.length >= 40 && tickets.length <= 60, `${tickets.length} tickets`);
  for (const family of FAMILIES) assert.ok(tickets.some((t) => t.family === family), family);
  const bench = articles.filter((a) => a.source === 'bench');
  assert.ok(bench.some((a) => a.status === 'draft'));
  assert.ok(bench.some((a) => a.status === 'obsolete'));
  assert.ok(bench.filter((a) => a.body.length > 4500).length >= 2, 'two long articles');
  assert.ok(new Set(bench.map((a) => a.lang)).size === 4, 'articles in the four languages');
  const crossLanguage = tickets.filter((t) => t.family === 'cross_language');
  const langOf = new Map(articles.map((a) => [a.key, a.lang]));
  assert.ok(crossLanguage.every((t) => t.expected.every((key) => langOf.get(key) !== t.lang)));
});

test('a ticket names known articles, and no-answer families expect none', () => {
  const keys = new Map([['a', {}]]);
  const base = { n: 1, family: 'same_language', lang: 'en', title: 't', description: 'd', expected: ['a'] };
  assert.deepEqual(validateTicket(base, keys), []);
  assert.match(validateTicket({ ...base, expected: ['b'] }, keys)[0], /unknown article key "b"/);
  assert.match(validateTicket({ ...base, family: 'no_answer' }, keys)[0], /expects no document/);
  assert.match(validateTicket({ ...base, family: 'stale_doc', expected: [] }, keys)[0], /names the draft or obsolete document/);
});

test('bench articles carry the R2 prefix in the tenant, fixture articles keep their title', () => {
  assert.equal(tenantTitle({ source: 'bench', title: 'X' }), '[R2] X');
  assert.equal(tenantTitle({ source: 'fixture', title: 'X' }), 'X');
});

test('tickets are picked by number ranges and families', () => {
  const tickets = [1, 2, 3, 4, 5].map((n) => ({ n, family: n % 2 ? 'paraphrase' : 'no_answer' }));
  assert.deepEqual(selectTickets(tickets, { only: '1,3-4' }).map((t) => t.n), [1, 3, 4]);
  assert.deepEqual(selectTickets(tickets, { families: 'no_answer' }).map((t) => t.n), [2, 4]);
});
