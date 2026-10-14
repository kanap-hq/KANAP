import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import { BadRequestException, HttpException } from '@nestjs/common';
import { backendPath } from './backend-root';
import { htmlToMarkdown as htmlToMarkdownInProcess } from '../html-to-markdown';
import { MARKDOWN_MAX_BYTES } from '../markdown-limits';
import { normalizeMarkdownRichText as normalizeInProcess } from '../markdown-rich-text';
import { markdownToSearchText as searchTextInProcess } from '../markdown-search-text';
import { renderMarkdownToHtml as emailHtmlInProcess } from '../markdown-to-html';
import {
  closeMarkdownWorkers,
  htmlToMarkdown,
  MARKDOWN_BUSY,
  MARKDOWN_TOO_COMPLEX,
  MARKDOWN_UNAVAILABLE,
  MARKDOWN_WORK_TIMEOUT_MS,
  markdownToSearchText,
  markdownWorkBudget,
  markdownWorkerThreadsForTests,
  normalizeMarkdownRichText,
  renderMarkdownEmailHtml,
  renderPlainTextEmailHtml,
  reopenMarkdownWorkersForTests,
  startMarkdownWorkers,
} from '../markdown-worker';

// Rich text is processed in worker threads: the main thread keeps serving while a
// text takes long, a text over the time budget is refused (400 MARKDOWN_TOO_COMPLEX),
// and normal texts give the same result as when processed in process.

/** Longest pause of the main thread allowed while a text is processed. */
const MAX_MAIN_THREAD_LAG_MS = 50;

function fill(unit: string, bytes: number): string {
  return unit.repeat(Math.ceil(bytes / unit.length)).slice(0, bytes);
}

async function withMainThreadProbe<T>(fn: () => Promise<T>): Promise<{ result: T; maxLagMs: number; ticks: number }> {
  let maxLagMs = 0;
  let ticks = 0;
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    maxLagMs = Math.max(maxLagMs, now - last - 5);
    last = now;
    ticks += 1;
  }, 5);
  try {
    return { result: await fn(), maxLagMs, ticks };
  } finally {
    clearInterval(timer);
  }
}

async function outcomeOf(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
    return 'ok';
  } catch (error) {
    if (error instanceof HttpException) {
      const response = error.getResponse() as { code?: string } | string;
      return typeof response === 'object' && response.code ? response.code : `HTTP_${error.getStatus()}`;
    }
    throw error;
  }
}

function userManualPages(): string[] {
  const dir = backendPath('..', 'doc', 'help', 'docs', 'en');
  if (!fs.existsSync(dir)) return [];
  const files: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.md')) files.push(full);
    }
  };
  walk(dir);
  return files.sort();
}

async function testNormalContentsGiveTheSameResultAsInProcess() {
  const samples = [
    '# Title\n\nSome *emphasis*, a [link](https://example.com) and `code`.\n\n- [ ] task\n- [x] done',
    'Text with an image ![alt](/api/knowledge/inline/x/y) and <img src="https://example.com/a.png" alt="a">',
    '```html\n<div>kept in code</div>\n```\n\nSetext title\n============\n\nline<br>next',
  ];
  const pages = userManualPages().map((file) => fs.readFileSync(file, 'utf8'));
  for (const text of [...samples, ...pages]) {
    let expected: unknown;
    try {
      expected = normalizeInProcess(text, { fieldName: 'content', enforceSizeLimit: false });
    } catch (error) {
      expected = (error as BadRequestException).getResponse();
    }
    let actual: unknown;
    try {
      actual = await normalizeMarkdownRichText(text, { fieldName: 'content', enforceSizeLimit: false });
    } catch (error) {
      actual = (error as BadRequestException).getResponse();
    }
    assert.deepEqual(actual, expected);
    assert.equal(await markdownToSearchText(text), searchTextInProcess(text));
    assert.equal(await renderMarkdownEmailHtml(text), emailHtmlInProcess(text));
  }
  const html = '<p>Some <strong>bold</strong> text</p><ul><li data-type="taskItem" data-checked="true">done</li></ul>';
  assert.equal(await htmlToMarkdown(html), htmlToMarkdownInProcess(html));
}

async function testContentRulesAreTheSame() {
  assert.equal(await outcomeOf(() => normalizeMarkdownRichText('<div>raw</div>')), 'HTTP_400');
  assert.equal(
    await outcomeOf(() => normalizeMarkdownRichText(fill('Une phrase. ', MARKDOWN_MAX_BYTES + 1))),
    'MARKDOWN_TOO_LARGE',
  );
  await assert.rejects(
    normalizeMarkdownRichText('<div>raw</div>', { fieldName: 'comment' }),
    (error: unknown) => error instanceof BadRequestException && /^comment must be Markdown/.test(error.message),
  );
  assert.equal(await normalizeMarkdownRichText('   '), null);
  assert.equal(await normalizeMarkdownRichText(null), null);
}

async function testSlowTextsAreRefusedWhileTheMainThreadServes() {
  const texts = {
    'open underscores': fill('_a', MARKDOWN_MAX_BYTES),
    'open underscores and spaces': fill('_a ', MARKDOWN_MAX_BYTES),
    'mixed marks': fill('*_a', MARKDOWN_MAX_BYTES),
    'deep quotes': `${fill('> ', MARKDOWN_MAX_BYTES - 1)}a`,
  };
  for (const [label, text] of Object.entries(texts)) {
    const startedAt = performance.now();
    const { result, maxLagMs, ticks } = await withMainThreadProbe(() => outcomeOf(() => normalizeMarkdownRichText(text)));
    const elapsedMs = performance.now() - startedAt;
    assert.equal(result, MARKDOWN_TOO_COMPLEX, label);
    assert.ok(elapsedMs < MARKDOWN_WORK_TIMEOUT_MS + 1000, `${label}: answered in ${elapsedMs.toFixed(0)} ms`);
    assert.ok(maxLagMs < MAX_MAIN_THREAD_LAG_MS, `${label}: main thread busy ${maxLagMs.toFixed(0)} ms at once`);
    assert.ok(ticks > 0, `${label}: main thread served`);
  }
  // Image openers parse in linear time: answered at once.
  const { result, maxLagMs } = await withMainThreadProbe(() => outcomeOf(() => normalizeMarkdownRichText(fill('![](', MARKDOWN_MAX_BYTES))));
  assert.equal(result, 'ok');
  assert.ok(maxLagMs < MAX_MAIN_THREAD_LAG_MS);
  // The worker stopped over the budget was replaced.
  assert.equal(await normalizeMarkdownRichText('After a refusal, **still** fine.'), 'After a refusal, **still** fine.');
}

async function testLongTaskListsAreAccepted() {
  const items = Array.from({ length: 4000 }, (_, index) => `- [${index % 2 ? 'x' : ' '}] Item ${index} of the list`).join('\n');
  const text = items.slice(0, MARKDOWN_MAX_BYTES);
  const startedAt = performance.now();
  assert.equal(await normalizeMarkdownRichText(text), text.trim());
  const elapsedMs = performance.now() - startedAt;
  assert.ok(elapsedMs < MARKDOWN_WORK_TIMEOUT_MS / 2, `4000 task items in ${elapsedMs.toFixed(0)} ms`);
}

async function testStoredContentsFallBackToReadableText() {
  const slow = fill('_a ', 250 * 1024);
  // A stored content (no size limit) the workers cannot read in time is kept as it is.
  assert.equal(await normalizeMarkdownRichText(slow, { enforceSizeLimit: false }), slow.trim());
  // An email of such a content shows it as plain text.
  const { result, maxLagMs } = await withMainThreadProbe(() => renderMarkdownEmailHtml(slow));
  assert.equal(result, renderPlainTextEmailHtml(slow));
  assert.ok(maxLagMs < MAX_MAIN_THREAD_LAG_MS);
}

async function testSharedBudget() {
  const budget = markdownWorkBudget();
  assert.equal(await normalizeMarkdownRichText('first text', { budget }), 'first text');
  assert.ok(budget.remainingMs > 0 && budget.remainingMs < MARKDOWN_WORK_TIMEOUT_MS);
  budget.remainingMs = 0;
  assert.equal(await outcomeOf(() => normalizeMarkdownRichText('next text', { budget })), MARKDOWN_TOO_COMPLEX);
}

async function testAStoppedWorkerIsRefusedAndReplaced() {
  const pending = outcomeOf(() => normalizeMarkdownRichText(fill('_a ', 100 * 1024)));
  await new Promise((resolve) => setTimeout(resolve, 200));
  const [busy] = markdownWorkerThreadsForTests();
  await busy.terminate();
  assert.equal(await pending, MARKDOWN_TOO_COMPLEX);
  assert.equal(await normalizeMarkdownRichText('Replaced.'), 'Replaced.');
}

async function testAFullPoolAnswersBusy() {
  const slow = fill('_a ', 100 * 1024);
  const outcomes = await Promise.all(Array.from({ length: 8 }, () => outcomeOf(() => normalizeMarkdownRichText(slow))));
  assert.ok(outcomes.every((outcome) => outcome === MARKDOWN_TOO_COMPLEX || outcome === MARKDOWN_BUSY), outcomes.join());
  assert.ok(outcomes.includes(MARKDOWN_BUSY), 'calls waiting past the queue time are refused as busy');
  assert.equal(await normalizeMarkdownRichText('Served again.'), 'Served again.');
}

async function testStoppedPool() {
  await closeMarkdownWorkers();
  assert.equal(await outcomeOf(() => normalizeMarkdownRichText('text')), MARKDOWN_UNAVAILABLE);
  assert.equal(await renderMarkdownEmailHtml('**text**'), renderPlainTextEmailHtml('**text**'));
  reopenMarkdownWorkersForTests();
  assert.equal(await startMarkdownWorkers(), true);
  assert.equal(await normalizeMarkdownRichText('**text**'), '**text**');
}

async function run() {
  assert.equal(await startMarkdownWorkers(), true);
  await testNormalContentsGiveTheSameResultAsInProcess();
  await testContentRulesAreTheSame();
  await testSlowTextsAreRefusedWhileTheMainThreadServes();
  await testLongTaskListsAreAccepted();
  await testStoredContentsFallBackToReadableText();
  await testSharedBudget();
  await testAStoppedWorkerIsRefusedAndReplaced();
  await testAFullPoolAnswersBusy();
  await testStoppedPool();
  await closeMarkdownWorkers();
}

run().catch(async (error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  await closeMarkdownWorkers();
  process.exit(1);
});
