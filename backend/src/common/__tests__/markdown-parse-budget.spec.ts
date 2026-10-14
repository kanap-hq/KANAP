import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import * as path from 'node:path';
import { BadRequestException } from '@nestjs/common';
import * as express from 'express';
import { backendPath } from './backend-root';
import { createBodyParsers } from '../body-parsers';
import {
  closeMarkdownParseWorkers,
  MARKDOWN_TOO_COMPLEX,
  noteMarkdownParseBudget,
  resetMarkdownParseBudgetForTests,
} from '../markdown-parse-budget';
import { createMarkdownParseBudgetMiddleware } from '../markdown-parse-budget.middleware';
import { MARKDOWN_MAX_BYTES, normalizeMarkdownRichText } from '../markdown-rich-text';
import { renderMarkdownToHtml, renderMarkdownToHtmlBounded } from '../markdown-to-html';

function fill(unit: string, bytes: number): string {
  return unit.repeat(Math.ceil(bytes / unit.length)).slice(0, bytes);
}

// Texts the parser cannot handle within its budget, at the size limit.
const OVER_BUDGET: Record<string, string> = {
  'open "_" marks': fill('_a', MARKDOWN_MAX_BYTES),
  'open "_" marks between spaces': fill('_a ', MARKDOWN_MAX_BYTES),
  'open "*_" marks': fill('*_a', MARKDOWN_MAX_BYTES),
  'nested quotes': `${fill('> ', MARKDOWN_MAX_BYTES - 1)}a`,
  'nested lists': `${fill('- ', MARKDOWN_MAX_BYTES - 1)}a`,
};

function markdownFiles(): Array<{ name: string; text: string }> {
  const roots = [backendPath('fixtures', 'fromage-co'), backendPath('..', 'doc'), backendPath('..', '.agents')];
  const files: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.md')) files.push(full);
    }
  };
  roots.forEach(walk);
  return files.map((file) => ({ name: path.relative(backendPath('..'), file), text: fs.readFileSync(file, 'utf8') }));
}

function errorCode(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    if (!(error instanceof BadRequestException)) throw error;
    const response = error.getResponse() as { code?: string } | string;
    return typeof response === 'object' ? response.code ?? 'BAD_REQUEST' : 'BAD_REQUEST';
  }
}

/** Runs `fn` while a 5 ms timer measures how long the main thread stays busy at once. */
async function withMainThreadProbe<T>(fn: () => Promise<T>): Promise<{ result: T; maxLagMs: number; elapsedMs: number }> {
  let maxLagMs = 0;
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    maxLagMs = Math.max(maxLagMs, now - last - 5);
    last = now;
  }, 5);
  const start = performance.now();
  try {
    const result = await fn();
    return { result, maxLagMs, elapsedMs: performance.now() - start };
  } finally {
    clearInterval(timer);
  }
}

async function testNormalContentsStayWithinTheBudgetAndRenderTheSame() {
  const documents = markdownFiles();
  assert.ok(documents.length >= 20, `Markdown files found: ${documents.length}`);
  for (const { name, text } of documents) {
    assert.equal(await noteMarkdownParseBudget([text]), true, name);
    if (Buffer.byteLength(text) <= MARKDOWN_MAX_BYTES) {
      assert.notEqual(errorCode(() => normalizeMarkdownRichText(text)), MARKDOWN_TOO_COMPLEX, name);
    }
    // Emails: the worker renders exactly what the main thread rendered.
    assert.equal(await renderMarkdownToHtmlBounded(text), renderMarkdownToHtml(text), name);
  }
  // A document of 200 KB made of real documents is within the budget too.
  let large = documents.map((document) => document.text).join('\n\n');
  while (large.length < MARKDOWN_MAX_BYTES) large += `\n\n${large}`;
  large = large.slice(0, MARKDOWN_MAX_BYTES - 1024);
  assert.equal(await noteMarkdownParseBudget([large]), true);
}

async function testTextsOverTheBudgetAreRefusedWithoutHoldingTheMainThread() {
  for (const [name, text] of Object.entries(OVER_BUDGET)) {
    const { result, maxLagMs, elapsedMs } = await withMainThreadProbe(() => noteMarkdownParseBudget([text]));
    assert.equal(result, false, name);
    assert.ok(elapsedMs < 2500, `${name}: measured in ${elapsedMs.toFixed(0)} ms`);
    assert.ok(maxLagMs < 100, `${name}: main thread busy ${maxLagMs.toFixed(0)} ms at once`);
    const start = performance.now();
    assert.equal(errorCode(() => normalizeMarkdownRichText(text, { fieldName: 'content' })), MARKDOWN_TOO_COMPLEX, name);
    assert.ok(performance.now() - start < 100, `${name}: refused without parsing`);
    // A stored content over the budget stays as it is, without the parser.
    assert.equal(normalizeMarkdownRichText(text, { enforceSizeLimit: false }), text.trim(), name);
  }
  // The workers stopped on the way are replaced: a normal text is measured again.
  assert.equal(await noteMarkdownParseBudget([fill('Un paragraphe *normal* avec un [lien](https://example.com). ', 50 * 1024)]), true);
}

async function testImageOpenersParseWithinTheBudget() {
  // marked 18 reads runs of "![](" and "[](" in linear time.
  for (const unit of ['![](', '[](']) {
    const text = fill(unit, MARKDOWN_MAX_BYTES);
    assert.equal(await noteMarkdownParseBudget([text]), true, unit);
    const start = performance.now();
    normalizeMarkdownRichText(text);
    assert.ok(performance.now() - start < 250, `${unit}: ${(performance.now() - start).toFixed(0)} ms`);
  }
}

async function testEmailOfAStoredContentOverTheBudgetFallsBackToPlainText() {
  const text = `Bonjour <équipe>,\n\n${fill('_a ', MARKDOWN_MAX_BYTES)}`;
  const { result: html, maxLagMs } = await withMainThreadProbe(() => renderMarkdownToHtmlBounded(text));
  assert.match(html, /^<p>Bonjour &lt;équipe&gt;,<\/p>/);
  assert.ok(html.includes('_a _a _a'));
  assert.ok(maxLagMs < 100, `main thread busy ${maxLagMs.toFixed(0)} ms at once`);
}

async function testHttpRequestsAreServedWhileATextIsMeasured() {
  const app = express();
  app.use(...createBodyParsers());
  app.use(createMarkdownParseBudgetMiddleware());
  app.get('/ping', (_req, res) => { res.json({ ok: true }); });
  app.post('/comments', (req, res) => {
    res.status(201).json({ content: normalizeMarkdownRichText(req.body?.content, { fieldName: 'content' }) });
  });
  // A route that never reads its text as Markdown.
  app.post('/notes', (req, res) => { res.status(201).json({ length: String(req.body?.text || '').length }); });
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof BadRequestException) {
      res.status(400).json(error.getResponse());
      return;
    }
    res.status(500).json({ message: String(error) });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (route: string, body: unknown) => fetch(`${base}${route}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    for (const [name, text] of Object.entries(OVER_BUDGET)) {
      resetMarkdownParseBudgetForTests();
      const started = performance.now();
      const pending = post('/comments', { content: text });
      const pings: number[] = [];
      let done = false;
      void pending.finally(() => { done = true; });
      while (!done) {
        const pingStart = performance.now();
        const ping = await fetch(`${base}/ping`);
        assert.equal(ping.status, 200);
        pings.push(performance.now() - pingStart);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const response = await pending;
      assert.equal(response.status, 400, name);
      assert.equal((await response.json()).code, MARKDOWN_TOO_COMPLEX, name);
      assert.ok(performance.now() - started < 2500, `${name}: answered in ${(performance.now() - started).toFixed(0)} ms`);
      assert.ok(Math.max(...pings) < 100, `${name}: slowest parallel request ${Math.max(...pings).toFixed(0)} ms`);
      // The same text in a field that is not Markdown goes through.
      assert.equal((await post('/notes', { text })).status, 201, name);
    }
    const normal = fill('Une ligne de commentaire avec **du gras** et un [lien](https://example.com).\n\n', 150 * 1024);
    const accepted = await post('/comments', { content: normal });
    assert.equal(accepted.status, 201);
    assert.equal((await accepted.json()).content, normal.trim());
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function testWorkersStopOnShutdown() {
  await closeMarkdownParseWorkers();
  const start = performance.now();
  // No worker any more: nothing is measured, the request keeps going as before.
  assert.equal(await noteMarkdownParseBudget([fill('_a ', 8 * 1024)]), true);
  assert.ok(performance.now() - start < 50);
  resetMarkdownParseBudgetForTests();
}

async function run() {
  await testNormalContentsStayWithinTheBudgetAndRenderTheSame();
  await testTextsOverTheBudgetAreRefusedWithoutHoldingTheMainThread();
  await testImageOpenersParseWithinTheBudget();
  await testEmailOfAStoredContentOverTheBudgetFallsBackToPlainText();
  await testHttpRequestsAreServedWhileATextIsMeasured();
  await testWorkersStopOnShutdown();
  await closeMarkdownParseWorkers();
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
