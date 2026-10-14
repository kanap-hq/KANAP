import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import { BadRequestException, HttpException, Logger } from '@nestjs/common';
import { renderCommentForEmail } from '../../notifications/comment-email-renderer';
import { runWithRequestTenant } from '../tenancy/request-tenant-context';
import { backendPath } from './backend-root';
import { htmlToMarkdown as htmlToMarkdownInProcess } from '../html-to-markdown';
import { MARKDOWN_MAX_BYTES } from '../markdown-limits';
import { normalizeMarkdownRichText as normalizeInProcess } from '../markdown-rich-text';
import { markdownToSearchText as searchTextInProcess } from '../markdown-search-text';
import { renderMarkdownToHtml as emailHtmlInProcess } from '../markdown-to-html';
import {
  closeMarkdownWorkers,
  htmlToMarkdown,
  idleMarkdownWorkersForTests,
  MARKDOWN_BUSY,
  MARKDOWN_TOO_COMPLEX,
  MARKDOWN_UNAVAILABLE,
  MARKDOWN_WORK_TIMEOUT_MS,
  markdownQueueLimit,
  markdownToSearchText,
  markdownWorkBudget,
  MARKDOWN_BUSY_RETRY_AFTER_SECONDS,
  MarkdownBusyException,
  markdownWorkersStatus,
  markdownWorkerThreadsForTests,
  normalizeMarkdownRichText,
  normalizeMarkdownWithSearchText,
  renderCommentEmail,
  renderMarkdownEmailHtml,
  renderPlainTextEmailHtml,
  reopenMarkdownWorkersForTests,
  startMarkdownWorkers,
} from '../markdown-worker';

// Rich text is processed in worker threads: the main thread keeps serving while a
// text takes long, a text over the time budget is refused (400 MARKDOWN_TOO_COMPLEX),
// and normal texts give the same result as when processed in process.

/**
 * Longest pause of the main thread allowed while a text is processed. Measured
 * pauses stay under 10 ms; the margin absorbs a loaded CI machine. Processed on
 * the main thread, these texts would hold it for seconds.
 */
const MAX_MAIN_THREAD_LAG_MS = 100;

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

async function timedOutcome(work: () => Promise<unknown>): Promise<{ outcome: string; ms: number }> {
  const startedAt = performance.now();
  const outcome = await outcomeOf(work);
  return { outcome, ms: performance.now() - startedAt };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs `work` as a request of `user` in `tenant` (the key of its calls). */
function asUser<T>(tenant: string, user: string, work: () => T): T {
  return runWithRequestTenant(tenant, work, { user: { sub: user } });
}

async function testAUserNeverHoldsEveryWorker() {
  const slow = fill('_a ', 100 * 1024);
  // One tenant, as on a single-tenant server: a slow call of a user holds one worker.
  const running = asUser('tenant-a', 'user-1', () => timedOutcome(() => normalizeMarkdownRichText(slow)));
  await sleep(100);
  // The next call of the same user waits for its first one: the other worker stays for the others.
  const sameUser = asUser('tenant-a', 'user-1', () => timedOutcome(() => normalizeMarkdownRichText('**same user**')));
  await sleep(50);
  const others = [
    await asUser('tenant-a', 'user-2', () => timedOutcome(() => normalizeMarkdownRichText('**other user**'))),
    await runWithRequestTenant('tenant-a', () => timedOutcome(() => normalizeMarkdownRichText('**tenant**'))),
  ];
  for (const call of others) {
    assert.equal(call.outcome, 'ok');
    assert.ok(call.ms < 300, `served by the free worker in ${call.ms.toFixed(0)} ms`);
  }
  // The first call holds its worker past the wait of the second one.
  const second = await sameUser;
  assert.equal(second.outcome, MARKDOWN_BUSY);
  assert.ok(second.ms >= 900 && second.ms < 1800, `waited ${second.ms.toFixed(0)} ms`);
  assert.equal((await running).outcome, MARKDOWN_TOO_COMPLEX);
}

async function testTwoUsersMayUseEveryWorker() {
  const slow = fill('_a ', 100 * 1024);
  const callOfA = asUser('tenant-a', 'user-a', () => timedOutcome(() => normalizeMarkdownRichText(slow)));
  const callOfB = asUser('tenant-b', 'user-b', () => timedOutcome(() => normalizeMarkdownRichText(slow)));
  await sleep(50);
  // Both workers run the slow calls: a third user waits, and is refused after the wait.
  const callOfC = await asUser('tenant-c', 'user-c', () => timedOutcome(() => normalizeMarkdownRichText('**C**')));
  assert.equal(callOfC.outcome, MARKDOWN_BUSY);
  assert.ok(callOfC.ms >= 900 && callOfC.ms < 1800, `waited ${callOfC.ms.toFixed(0)} ms`);
  assert.equal((await callOfA).outcome, MARKDOWN_TOO_COMPLEX);
  assert.equal((await callOfB).outcome, MARKDOWN_TOO_COMPLEX);
}

async function testAFreeWorkerSkipsAKeyAtItsCap() {
  const slow = fill('_a ', 100 * 1024);
  const order: string[] = [];
  const tracked = (label: string, work: () => Promise<unknown>) => timedOutcome(work).then((call) => {
    order.push(label);
    return call;
  });
  // A user sends two calls: the second waits for the first, although a worker is free.
  const texts = [slow, '**A2**'];
  const callsOfA = [1, 2].map((index) => asUser('tenant-a', 'user-a', () => tracked(`A${index}`, () => normalizeMarkdownRichText(texts[index - 1]))));
  await sleep(20);
  // Another user's call, sent later, takes the free worker at once.
  const callOfN = await asUser('tenant-b', 'normal', () => tracked('N', () => normalizeMarkdownRichText('**N**')));
  assert.equal(callOfN.outcome, 'ok');
  assert.ok(callOfN.ms < 200, `served in ${callOfN.ms.toFixed(0)} ms`);
  // The first call ends when the spec stops its worker, whatever the load of the machine:
  // the second one then starts on the free worker, well within its wait.
  const [busy] = markdownWorkerThreadsForTests();
  await busy.terminate();
  const [first, second] = await Promise.all(callsOfA);
  assert.deepEqual([first.outcome, second.outcome], [MARKDOWN_TOO_COMPLEX, 'ok']);
  assert.deepEqual(order, ['N', 'A1', 'A2']);
}

async function testCapsApplyOnlyToWaitingCalls() {
  const slow = fill('_a ', 100 * 1024);
  const base = 'https://acme.example.com';
  const comment = '**Done**, see [the plan](/portfolio/projects/PRJ-3).';
  // A user: one call running, two waiting; a fourth is refused at once.
  const callsOfH = [0, 1, 2].map(() => asUser('tenant-a', 'heavy', () => timedOutcome(() => normalizeMarkdownRichText(slow))));
  await sleep(50);
  const refused = await asUser('tenant-a', 'heavy', () => timedOutcome(() => normalizeMarkdownRichText('one more')));
  assert.equal(refused.outcome, MARKDOWN_BUSY);
  assert.ok(refused.ms < 50, `refused in ${refused.ms.toFixed(0)} ms`);
  assert.equal(new MarkdownBusyException().retryAfterSeconds, MARKDOWN_BUSY_RETRY_AFTER_SECONDS);
  // Another user takes the other worker.
  const callOfG = asUser('tenant-b', 'other-heavy', () => timedOutcome(() => normalizeMarkdownRichText(slow)));
  await sleep(50);
  // An email sent by the first user's request is free of its caps: it waits for a worker and is rendered.
  const email = asUser('tenant-a', 'heavy', () => timedOutcome(() => renderCommentEmail(comment, base, 'acme')));
  // A third user still gets a place in the queue; both workers stay busy past its wait.
  const other = await asUser('tenant-a', 'other', () => timedOutcome(() => normalizeMarkdownRichText('**other**')));
  assert.equal(other.outcome, MARKDOWN_BUSY);
  assert.ok(other.ms >= 900 && other.ms < 1800, `waited ${other.ms.toFixed(0)} ms`);
  const outcomesOfH = await Promise.all(callsOfH);
  assert.deepEqual(outcomesOfH.map((call) => call.outcome), [MARKDOWN_TOO_COMPLEX, MARKDOWN_BUSY, MARKDOWN_BUSY]);
  assert.equal((await callOfG).outcome, MARKDOWN_TOO_COMPLEX);
  const rendered = await email;
  assert.equal(rendered.outcome, 'ok');
  assert.ok(rendered.ms > MARKDOWN_WORK_TIMEOUT_MS - 300 && rendered.ms < 5000, `email rendered after ${rendered.ms.toFixed(0)} ms`);
  const expected = renderCommentForEmail({ commentHtml: emailHtmlInProcess(comment), tenantBaseUrl: base, tenantSlug: 'acme' });
  assert.deepEqual(await asUser('tenant-a', 'heavy', () => renderCommentEmail(comment, base, 'acme')), expected);
  assert.notDeepEqual(expected, renderCommentForEmail({ commentHtml: renderPlainTextEmailHtml(comment), tenantBaseUrl: base, tenantSlug: 'acme' }));
  // The queue holds the calls of two keys at least, whatever the database pool.
  for (const poolMax of [2, 5, 9, 20, 40]) {
    assert.ok(markdownQueueLimit(poolMax) >= 4, `pool ${poolMax}: ${markdownQueueLimit(poolMax)} calls waiting`);
  }
  assert.equal(markdownQueueLimit(5), 4);
  assert.equal(markdownQueueLimit(20), 8);
}

async function testAFullQueueAnswersBusy() {
  const slow = fill('_a ', 100 * 1024);
  const limit = markdownQueueLimit();
  // Calls of as many users: two run, `limit` wait and are refused after the wait, the last two at once.
  const calls = await Promise.all(Array.from(
    { length: 2 + limit + 2 },
    (_, index) => asUser('tenant-c', `user-${index}`, () => timedOutcome(() => normalizeMarkdownRichText(slow))),
  ));
  const outcomes = calls.map((call) => call.outcome);
  assert.equal(outcomes.filter((outcome) => outcome === MARKDOWN_TOO_COMPLEX).length, 2, outcomes.join());
  assert.equal(outcomes.filter((outcome) => outcome === MARKDOWN_BUSY).length, limit + 2, outcomes.join());
  assert.equal(calls.filter((call) => call.outcome === MARKDOWN_BUSY && call.ms < 50).length, 2);
  assert.equal(await normalizeMarkdownRichText('Served again.'), 'Served again.');
}

async function testOneCallPerDocumentSave() {
  for (const page of userManualPages().slice(0, 40)) {
    const normalized = normalizeInProcess(page);
    assert.deepEqual(await normalizeMarkdownWithSearchText(page), { content: normalized, searchText: searchTextInProcess(normalized || '') });
  }
  assert.equal(searchTextInProcess(''), '');
  assert.deepEqual(await normalizeMarkdownWithSearchText('  '), { content: null, searchText: '' });
  const items = Array.from({ length: 4000 }, (_, index) => `- [${index % 2 ? 'x' : ' '}] Item ${index} of the list`).join('\n');
  const text = items.slice(0, MARKDOWN_MAX_BYTES);
  const startedAt = performance.now();
  const saved = await normalizeMarkdownWithSearchText(text);
  const elapsedMs = performance.now() - startedAt;
  assert.equal(saved.content, text.trim());
  assert.ok(elapsedMs < MARKDOWN_WORK_TIMEOUT_MS * 0.75, `4000 task items saved in ${elapsedMs.toFixed(0)} ms`);
  const slow = fill('_a ', 250 * 1024);
  assert.deepEqual(await normalizeMarkdownWithSearchText(slow, { enforceSizeLimit: false }), { content: slow.trim(), searchText: slow.replace(/\s+/g, ' ').trim() });
  // The save does the work of two calls, with the budget of two.
  const refused = await timedOutcome(() => normalizeMarkdownWithSearchText(fill('_a ', 100 * 1024)));
  assert.equal(refused.outcome, MARKDOWN_TOO_COMPLEX);
  assert.ok(
    refused.ms > 2 * MARKDOWN_WORK_TIMEOUT_MS - 100 && refused.ms < 2 * MARKDOWN_WORK_TIMEOUT_MS + 1000,
    `refused after ${refused.ms.toFixed(0)} ms`,
  );
}

async function testCommentEmailsAreRenderedInTheWorkers() {
  const base = 'https://acme.example.com';
  for (const page of userManualPages().slice(0, 20)) {
    const expected = renderCommentForEmail({ commentHtml: emailHtmlInProcess(page), tenantBaseUrl: base, tenantSlug: 'acme' });
    assert.deepEqual(await renderCommentEmail(page, base, 'acme'), expected);
  }
  assert.deepEqual(await renderCommentEmail('  ', base, 'acme'), renderCommentForEmail({ commentHtml: '', tenantBaseUrl: base, tenantSlug: 'acme' }));
  const slow = fill('_a ', 150 * 1024);
  const { result, maxLagMs } = await withMainThreadProbe(() => renderCommentEmail(slow, base, 'acme'));
  assert.deepEqual(result, renderCommentForEmail({ commentHtml: renderPlainTextEmailHtml(slow), tenantBaseUrl: base, tenantSlug: 'acme' }));
  assert.ok(maxLagMs < MAX_MAIN_THREAD_LAG_MS, `plain-text email: main thread busy ${maxLagMs.toFixed(0)} ms`);
}

async function testStoppedPool() {
  assert.equal(markdownWorkersStatus(), 'ready');
  await closeMarkdownWorkers();
  assert.equal(markdownWorkersStatus(), 'unavailable');
  assert.equal(await outcomeOf(() => normalizeMarkdownRichText('text')), MARKDOWN_UNAVAILABLE);
  assert.equal(await renderMarkdownEmailHtml('**text**'), renderPlainTextEmailHtml('**text**'));
  reopenMarkdownWorkersForTests();
  assert.equal(await startMarkdownWorkers(), true);
  assert.equal(await normalizeMarkdownRichText('**text**'), '**text**');
}

const busyLines: string[] = [];

async function run() {
  const warn = Logger.prototype.warn;
  Logger.prototype.warn = function captureBusy(this: Logger, message: unknown, ...rest: unknown[]) {
    if (String(message).includes('reason=busy')) busyLines.push(String(message));
    return (warn as (...args: unknown[]) => void).call(this, message, ...rest);
  } as typeof Logger.prototype.warn;
  assert.equal(await startMarkdownWorkers(), true);
  await testNormalContentsGiveTheSameResultAsInProcess();
  await testContentRulesAreTheSame();
  await testSlowTextsAreRefusedWhileTheMainThreadServes();
  await testLongTaskListsAreAccepted();
  await testStoredContentsFallBackToReadableText();
  await testSharedBudget();
  await testAStoppedWorkerIsRefusedAndReplaced();
  await idleMarkdownWorkersForTests();
  await testAUserNeverHoldsEveryWorker();
  await idleMarkdownWorkersForTests();
  await testTwoUsersMayUseEveryWorker();
  await idleMarkdownWorkersForTests();
  await testAFreeWorkerSkipsAKeyAtItsCap();
  await idleMarkdownWorkersForTests();
  await testCapsApplyOnlyToWaitingCalls();
  await idleMarkdownWorkersForTests();
  await testAFullQueueAnswersBusy();
  await testOneCallPerDocumentSave();
  await testCommentEmailsAreRenderedInTheWorkers();
  await testStoppedPool();
  // Refusals for a busy pool are logged once per minute, with their count.
  assert.equal(busyLines.length, 1, busyLines.join('\n'));
  await closeMarkdownWorkers();
}

run().catch(async (error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  await closeMarkdownWorkers();
  process.exit(1);
});
