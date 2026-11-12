// The bench set: hand-written tickets (data/tickets.json) and bench articles (data/articles/*.md,
// Markdown with a small front matter). Pure functions: no network, no database.
import * as fs from 'node:fs';
import * as path from 'node:path';

export const FAMILIES = [
  'same_language',
  'cross_language',
  'paraphrase',
  'exact_code',
  'deep_passage',
  'no_answer',
  'stale_doc',
];

export const FAMILY_LABELS = {
  same_language: 'Same language',
  cross_language: 'Cross-language',
  paraphrase: 'Paraphrase',
  exact_code: 'Exact code or product name',
  deep_passage: 'Passage deep in a long document',
  no_answer: 'No answer in the base',
  stale_doc: 'Only a draft or obsolete document answers',
};

export const ARTICLE_STATUSES = ['published', 'draft', 'obsolete'];
export const LANGUAGES = ['en', 'fr', 'de', 'es'];

/** Title prefix of every bench article in the tenant: bench objects carry "R2" in their name. */
export const BENCH_TITLE_PREFIX = '[R2] ';

/**
 * Splits `---\nkey: value\n---\nbody`. Values are single-line strings; no YAML beyond that.
 * Throws on a missing or malformed front matter.
 */
export function parseFrontMatter(text, source = 'article') {
  const normalized = String(text).replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) throw new Error(`${source}: missing front matter`);
  const meta = {};
  for (const line of match[1].split('\n')) {
    if (!line.trim()) continue;
    const kv = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!kv) throw new Error(`${source}: malformed front matter line "${line}"`);
    const value = kv[2].trim();
    meta[kv[1]] = /^".*"$/.test(value) ? value.slice(1, -1) : value;
  }
  return { meta, body: match[2].trim() };
}

export function validateArticle(article, source = article?.key ?? 'article') {
  const errors = [];
  if (!/^[a-z0-9-]+$/.test(article.key ?? '')) errors.push(`${source}: key must be lowercase words joined by dashes`);
  if (!article.title) errors.push(`${source}: title is required`);
  if (!ARTICLE_STATUSES.includes(article.status)) errors.push(`${source}: status must be one of ${ARTICLE_STATUSES.join(', ')}`);
  if (!LANGUAGES.includes(article.lang)) errors.push(`${source}: lang must be one of ${LANGUAGES.join(', ')}`);
  if (!article.body && article.source === 'bench') errors.push(`${source}: body is empty`);
  return errors;
}

export function validateTicket(ticket, articleKeys) {
  const errors = [];
  const where = `ticket ${ticket?.n ?? '?'}`;
  if (!Number.isInteger(ticket.n) || ticket.n < 1 || ticket.n > 99) errors.push(`${where}: n must be an integer from 1 to 99`);
  if (!FAMILIES.includes(ticket.family)) errors.push(`${where}: unknown family "${ticket.family}"`);
  if (!LANGUAGES.includes(ticket.lang)) errors.push(`${where}: unknown lang "${ticket.lang}"`);
  if (!ticket.title || !ticket.description) errors.push(`${where}: title and description are required`);
  if (!Array.isArray(ticket.expected)) errors.push(`${where}: expected must be a list (empty = no document answers)`);
  for (const key of [...(ticket.expected ?? []), ...(ticket.forbidden ?? []), ...(ticket.acceptable ?? [])]) {
    if (!articleKeys.has(key)) errors.push(`${where}: unknown article key "${key}"`);
  }
  if ((ticket.family === 'no_answer' || ticket.family === 'stale_doc') && ticket.expected?.length) {
    errors.push(`${where}: a ${ticket.family} ticket expects no document`);
  }
  if (ticket.family === 'stale_doc' && !(ticket.forbidden ?? []).length) {
    errors.push(`${where}: a stale_doc ticket names the draft or obsolete document it must not cite`);
  }
  if (ticket.followups !== undefined && !Array.isArray(ticket.followups)) errors.push(`${where}: followups must be a list of texts`);
  return errors;
}

/** Loads and checks the whole set. Returns { articles, tickets, articleByKey }. */
export function loadDataset(dataDir) {
  const raw = JSON.parse(fs.readFileSync(path.join(dataDir, 'tickets.json'), 'utf8'));
  const articles = [];
  for (const fixture of raw.fixture_articles ?? []) {
    articles.push({ ...fixture, source: 'fixture', status: fixture.status ?? 'published' });
  }
  const articleDir = path.join(dataDir, 'articles');
  for (const file of fs.readdirSync(articleDir).filter((name) => name.endsWith('.md')).sort()) {
    const { meta, body } = parseFrontMatter(fs.readFileSync(path.join(articleDir, file), 'utf8'), file);
    const key = path.basename(file, '.md');
    articles.push({ key, title: meta.title, summary: meta.summary || null, status: meta.status, lang: meta.lang, body, source: 'bench' });
  }
  const errors = articles.flatMap((article) => validateArticle(article));
  const articleByKey = new Map();
  for (const article of articles) {
    if (articleByKey.has(article.key)) errors.push(`duplicate article key "${article.key}"`);
    articleByKey.set(article.key, article);
  }
  const tickets = raw.tickets ?? [];
  const numbers = new Set();
  for (const ticket of tickets) {
    errors.push(...validateTicket(ticket, articleByKey));
    if (numbers.has(ticket.n)) errors.push(`duplicate ticket number ${ticket.n}`);
    numbers.add(ticket.n);
  }
  if (errors.length) throw new Error(`invalid bench set:\n- ${errors.join('\n- ')}`);
  return { articles, tickets, articleByKey };
}

/** The title an article carries in the tenant: bench articles get the R2 prefix. */
export function tenantTitle(article) {
  return article.source === 'bench' ? `${BENCH_TITLE_PREFIX}${article.title}` : article.title;
}

/** Picks tickets by `--only 3,7,12-15` and `--family a,b`. */
export function selectTickets(tickets, { only = null, families = null } = {}) {
  let selected = tickets;
  if (only) {
    const wanted = new Set();
    for (const part of String(only).split(',').map((s) => s.trim()).filter(Boolean)) {
      const range = part.match(/^(\d+)-(\d+)$/);
      if (range) for (let n = Number(range[1]); n <= Number(range[2]); n++) wanted.add(n);
      else wanted.add(Number(part));
    }
    selected = selected.filter((ticket) => wanted.has(ticket.n));
  }
  if (families) {
    const wanted = new Set(String(families).split(',').map((s) => s.trim()));
    selected = selected.filter((ticket) => wanted.has(ticket.family));
  }
  return selected;
}
