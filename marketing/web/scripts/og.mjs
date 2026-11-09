#!/usr/bin/env node
/**
 * Open Graph card generator (puppeteer-core + system chromium).
 *
 * Renders a branded 1200×630 social card per page into public/og/<name>.png.
 * Run after editing the CARDS config below:
 *
 *   node scripts/og.mjs            # generate every page card
 *   node scripts/og.mjs agents     # only the named card(s)
 *   node scripts/og.mjs blog       # one card per blog article → public/og/blog/<slug>.png
 *   node scripts/og.mjs blog my-article   # only that article
 *
 * Blog cards are read from the article frontmatter (title, description, date)
 * under src/content/blog/<locale>/<slug>.md; the English file wins when the
 * same slug exists in several languages. Commit the PNGs with the article.
 *
 * Requirements:
 *   - chromium at /usr/bin/chromium (override with CHROMIUM_PATH)
 */

import puppeteer from 'puppeteer-core';
import { mkdirSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, basename } from 'node:path';

const CHROME_PATH = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'public/og');
const blogDir = resolve(root, 'src/content/blog');
const BLOG_LOCALES = ['en', 'fr', 'de', 'es'];

/** Minimal frontmatter reader: `key: value` lines between the `---` fences. */
function readFrontmatter(file) {
  const src = readFileSync(file, 'utf8');
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].replace(/\s+#.*$/, '').trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[kv[1]] = v;
  }
  return out;
}

/** One card per slug, English first. Drafts are skipped. */
function blogCards(only) {
  const cards = {};
  for (const locale of BLOG_LOCALES) {
    const dir = resolve(blogDir, locale);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.md') || f.startsWith('_')) continue;
      const slug = basename(f, '.md');
      if (only.length && !only.includes(slug)) continue;
      if (cards[slug]) continue;
      const fm = readFrontmatter(resolve(dir, f));
      if (fm.draft === 'true') continue;
      const date = fm.date
        ? new Date(fm.date).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
        : '';
      cards[slug] = {
        eyebrow: date ? `Blog · ${date}` : 'Blog',
        title: fm.title ?? slug,
        sub: fm.description ?? '',
        url: `kadratis.com${locale === 'en' ? '' : '/' + locale}/blog/${slug}`,
      };
    }
  }
  return cards;
}

// Brand tokens (dark theme — best contrast for social cards).
const BG = '#0F1117';
const FG = '#E5E7EB';
const MUTED = '#9CA3AF';
const FAINT = '#6B7280';
const TEAL = '#4DB8C9';

// Full logo, light version: the card background is dark.
const logoDataUri =
  'data:image/svg+xml;base64,' +
  readFileSync(resolve(root, 'public/brand/kadratis-logo-inverse.svg')).toString('base64');

/** One entry per OG card. Keep copy in sync with the page header. */
const CARDS = {
  agents: {
    eyebrow: 'Autonomous agents for IT',
    title: 'AI agents that take work off your team.',
    sub: 'Open-source and self-hosted. One service-desk agent live in production, the runtime built to extend.',
    url: 'kadratis.com/features/agents',
  },
};

const esc = (v) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function cardHtml(c) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { margin:0; padding:0; box-sizing:border-box; }
    html, body { width:1200px; height:630px; }
    body {
      background:${BG}; color:${FG};
      font-family:'Inter Variable','Inter','Helvetica Neue',Arial,sans-serif;
      -webkit-font-smoothing:antialiased;
    }
    .card { position:relative; width:1200px; height:630px; padding:80px;
      display:flex; flex-direction:column; justify-content:space-between; overflow:hidden; }
    .glow { position:absolute; right:-220px; top:-220px; width:760px; height:760px; border-radius:50%;
      background:radial-gradient(closest-side, rgba(77,184,201,0.20), transparent); }
    .z { position:relative; z-index:1; }
    .brand { display:flex; align-items:center; gap:18px; }
    .brand img { height:56px; width:auto; }
    .eyebrow { color:${TEAL}; font-size:22px; font-weight:500; letter-spacing:0.14em; text-transform:uppercase; }
    .title { font-size:66px; line-height:1.08; font-weight:500; letter-spacing:-0.02em; max-width:1000px; margin-top:16px; }
    .sub { color:${MUTED}; font-size:27px; line-height:1.5; max-width:940px; margin-top:26px; }
    .foot { display:flex; align-items:center; justify-content:space-between; }
    .foot .url { color:${TEAL}; font-size:24px; font-weight:500; }
    .foot .tag { color:${FAINT}; font-size:20px; }
  </style></head>
  <body><div class="card">
    <div class="glow"></div>
    <div class="brand z"><img src="${logoDataUri}" alt="Kadratis"/></div>
    <div class="z">
      <div class="eyebrow">${esc(c.eyebrow)}</div>
      <div class="title">${esc(c.title)}</div>
      <div class="sub">${esc(c.sub)}</div>
    </div>
    <div class="foot z"><span class="url">${esc(c.url)}</span><span class="tag">AGPL v3 · self-host free</span></div>
  </div></body></html>`;
}

const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const isBlog = positional[0] === 'blog';
const cards = isBlog ? blogCards(positional.slice(1)) : CARDS;
const targetDir = isBlog ? resolve(outDir, 'blog') : outDir;
const names = isBlog
  ? Object.keys(cards)
  : positional.length
    ? positional.filter((n) => CARDS[n])
    : Object.keys(CARDS);

if (!names.length) {
  console.log(isBlog ? 'no published blog article found' : 'no card matched');
  process.exit(0);
}

mkdirSync(targetDir, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
});
try {
  for (const name of names) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
    await page.setContent(cardHtml(cards[name]), { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 150));
    const out = resolve(targetDir, `${name}.png`);
    await page.screenshot({ path: out });
    console.log('wrote', out);
    await page.close();
  }
} finally {
  await browser.close();
}
