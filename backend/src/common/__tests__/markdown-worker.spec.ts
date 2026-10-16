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
  QUEUE_WAIT_MS,
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
//
// No assertion depends on the speed or the load of the machine: outcomes, the order in
// which calls end, and lower bounds set by the pool's own timers (a timer never fires
// early). Upper bounds on elapsed time made the spec fail on a loaded machine.

/**
 * The installed parser is the one of the lockfile. An older `marked` (a stale
 * `node_modules`) parses image openers in quadratic time: the texts below are then
 * refused as too complex, which reads like a bug of the pool.
 */
function assertLockfileParser() {
  const lock = JSON.parse(fs.readFileSync(backendPath('package-lock.json'), 'utf8'));
  const locked = lock.packages?.['node_modules/marked']?.version;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const installed = require('marked/package.json').version;
  assert.equal(installed, locked, `marked ${installed} is installed, package-lock.json has ${locked}: run npm ci in backend/`);
}

function fill(unit: string, bytes: number): string {
  return unit.repeat(Math.ceil(bytes / unit.length)).slice(0, bytes);
}

/**
 * Runs `fn` and counts the turns the main thread gave to a 5 ms interval meanwhile.
 * Work held on the main thread lets the interval run once at most, after it: two turns
 * or more mean the main thread served while the text was processed.
 */
async function withMainThreadProbe<T>(fn: () => Promise<T>): Promise<{ result: T; ticks: number }> {
  let ticks = 0;
  const timer = setInterval(() => { ticks += 1; }, 5);
  try {
    return { result: await fn(), ticks };
  } finally {
    clearInterval(timer);
  }
}

/** The main thread served while the text was processed (see withMainThreadProbe). */
function assertMainThreadServed(ticks: number, label: string) {
  assert.ok(ticks >= 2, `${label}: the main thread ran ${ticks} interval turn(s) during the work`);
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
    const { result, ticks } = await withMainThreadProbe(() => outcomeOf(() => normalizeMarkdownRichText(text)));
    const elapsedMs = performance.now() - startedAt;
    assert.equal(result, MARKDOWN_TOO_COMPLEX, label);
    // Refused by the time budget, not before.
    assert.ok(elapsedMs >= MARKDOWN_WORK_TIMEOUT_MS - 1, `${label}: refused after ${elapsedMs.toFixed(0)} ms`);
    assertMainThreadServed(ticks, label);
  }
  // Image openers parse in linear time: accepted.
  assert.equal(await outcomeOf(() => normalizeMarkdownRichText(fill('![](', MARKDOWN_MAX_BYTES))), 'ok', 'image openers');
  // The worker stopped over the budget was replaced.
  assert.equal(await normalizeMarkdownRichText('After a refusal, **still** fine.'), 'After a refusal, **still** fine.');
}

async function testLongTaskListsAreAccepted() {
  const items = Array.from({ length: 4000 }, (_, index) => `- [${index % 2 ? 'x' : ' '}] Item ${index} of the list`).join('\n');
  const text = items.slice(0, MARKDOWN_MAX_BYTES);
  // Within the time budget: a slower parse would be refused as too complex.
  assert.equal(await normalizeMarkdownRichText(text), text.trim());
}

async function testStoredContentsFallBackToReadableText() {
  const slow = fill('_a ', 250 * 1024);
  // A stored content (no size limit) the workers cannot read in time is kept as it is.
  assert.equal(await normalizeMarkdownRichText(slow, { enforceSizeLimit: false }), slow.trim());
  // An email of such a content shows it as plain text.
  const { result, ticks } = await withMainThreadProbe(() => renderMarkdownEmailHtml(slow));
  assert.equal(result, renderPlainTextEmailHtml(slow));
  assertMainThreadServed(ticks, 'stored content email');
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

/** A call whose end can be read without waiting for it: the order of the ends, not their times. */
function track<T>(promise: Promise<T>): { promise: Promise<T>; ended: () => boolean } {
  let ended = false;
  promise.then(() => { ended = true; }, () => { ended = true; });
  return { promise, ended: () => ended };
}

/** Refused after the queue wait: the wait timer never fires early. */
function assertWaited(call: { outcome: string; ms: number }) {
  assert.equal(call.outcome, MARKDOWN_BUSY);
  assert.ok(call.ms >= QUEUE_WAIT_MS - 1, `waited ${call.ms.toFixed(0)} ms`);
}

/** Runs `work` as a request of `user` in `tenant` (the key of its calls). */
function asUser<T>(tenant: string, user: string, work: () => T): T {
  return runWithRequestTenant(tenant, work, { user: { sub: user } });
}

async function testAUserNeverHoldsEveryWorker() {
  const slow = fill('_a ', 100 * 1024);
  // One tenant, as on a single-tenant server: a slow call of a user holds one worker.
  const running = track(asUser('tenant-a', 'user-1', () => timedOutcome(() => normalizeMarkdownRichText(slow))));
  await sleep(100);
  // The next call of the same user waits for its first one: the other worker stays for the others.
  const sameUser = asUser('tenant-a', 'user-1', () => timedOutcome(() => normalizeMarkdownRichText('**same user**')));
  await sleep(50);
  const others = [
    await asUser('tenant-a', 'user-2', () => timedOutcome(() => normalizeMarkdownRichText('**other user**'))),
    await runWithRequestTenant('tenant-a', () => timedOutcome(() => normalizeMarkdownRichText('**tenant**'))),
  ];
  for (const call of others) assert.equal(call.outcome, 'ok');
  // Served by the free worker while the slow call still holds the other one.
  assert.equal(running.ended(), false, 'the slow call still runs');
  // The first call holds its worker past the wait of the second one.
  assertWaited(await sameUser);
  assert.equal(running.ended(), false, 'refused before the slow call ended');
  assert.equal((await running.promise).outcome, MARKDOWN_TOO_COMPLEX);
}

async function testTwoUsersMayUseEveryWorker() {
  const slow = fill('_a ', 100 * 1024);
  const callOfA = track(asUser('tenant-a', 'user-a', () => timedOutcome(() => normalizeMarkdownRichText(slow))));
  const callOfB = track(asUser('tenant-b', 'user-b', () => timedOutcome(() => normalizeMarkdownRichText(slow))));
  await sleep(50);
  // Both workers run the slow calls: a third user waits, and is refused after the wait.
  assertWaited(await asUser('tenant-c', 'user-c', () => timedOutcome(() => normalizeMarkdownRichText('**C**'))));
  assert.deepEqual([callOfA.ended(), callOfB.ended()], [false, false], 'refused while both slow calls run');
  assert.equal((await callOfA.promise).outcome, MARKDOWN_TOO_COMPLEX);
  assert.equal((await callOfB.promise).outcome, MARKDOWN_TOO_COMPLEX);
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
  const callsOfH = [0, 1, 2].map(() => track(asUser('tenant-a', 'heavy', () => timedOutcome(() => normalizeMarkdownRichText(slow)))));
  await sleep(50);
  const refused = await asUser('tenant-a', 'heavy', () => timedOutcome(() => normalizeMarkdownRichText('one more')));
  assert.equal(refused.outcome, MARKDOWN_BUSY);
  // At once: before the calls waiting in the queue are refused after their wait.
  assert.deepEqual(callsOfH.map((call) => call.ended()), [false, false, false], 'refused before any call of the user ended');
  assert.equal(new MarkdownBusyException().retryAfterSeconds, MARKDOWN_BUSY_RETRY_AFTER_SECONDS);
  // Another user takes the other worker.
  const callOfG = track(asUser('tenant-b', 'other-heavy', () => timedOutcome(() => normalizeMarkdownRichText(slow))));
  await sleep(50);
  // An email sent by the first user's request is free of its caps: it waits for a worker and is rendered.
  const email = asUser('tenant-a', 'heavy', () => timedOutcome(() => renderCommentEmail(comment, base, 'acme')));
  // A third user still gets a place in the queue; both workers stay busy past its wait.
  assertWaited(await asUser('tenant-a', 'other', () => timedOutcome(() => normalizeMarkdownRichText('**other**'))));
  assert.deepEqual([callsOfH[0].ended(), callOfG.ended()], [false, false], 'refused while both slow calls run');
  const outcomesOfH = await Promise.all(callsOfH.map((call) => call.promise));
  assert.deepEqual(outcomesOfH.map((call) => call.outcome), [MARKDOWN_TOO_COMPLEX, MARKDOWN_BUSY, MARKDOWN_BUSY]);
  assert.equal((await callOfG.promise).outcome, MARKDOWN_TOO_COMPLEX);
  const rendered = await email;
  assert.equal(rendered.outcome, 'ok');
  // It waited for a worker freed by the time budget, past the wait of the other calls.
  assert.ok(rendered.ms > MARKDOWN_WORK_TIMEOUT_MS - 300, `email rendered after ${rendered.ms.toFixed(0)} ms`);
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
  // Two refused at once, the others after the queue wait.
  const busy = calls.filter((call) => call.outcome === MARKDOWN_BUSY);
  assert.equal(busy.filter((call) => call.ms < QUEUE_WAIT_MS - 1).length, 2, busy.map((call) => call.ms.toFixed(0)).join());
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
  // Within the time budget: a slower parse would be refused as too complex.
  const saved = await normalizeMarkdownWithSearchText(text);
  assert.equal(saved.content, text.trim());
  const slow = fill('_a ', 250 * 1024);
  assert.deepEqual(await normalizeMarkdownWithSearchText(slow, { enforceSizeLimit: false }), { content: slow.trim(), searchText: slow.replace(/\s+/g, ' ').trim() });
  // The save does the work of two calls, with the budget of two.
  const refused = await timedOutcome(() => normalizeMarkdownWithSearchText(fill('_a ', 100 * 1024)));
  assert.equal(refused.outcome, MARKDOWN_TOO_COMPLEX);
  assert.ok(refused.ms > 2 * MARKDOWN_WORK_TIMEOUT_MS - 100, `refused after ${refused.ms.toFixed(0)} ms`);
}

async function testCommentEmailsAreRenderedInTheWorkers() {
  const base = 'https://acme.example.com';
  for (const page of userManualPages().slice(0, 20)) {
    const expected = renderCommentForEmail({ commentHtml: emailHtmlInProcess(page), tenantBaseUrl: base, tenantSlug: 'acme' });
    assert.deepEqual(await renderCommentEmail(page, base, 'acme'), expected);
  }
  assert.deepEqual(await renderCommentEmail('  ', base, 'acme'), renderCommentForEmail({ commentHtml: '', tenantBaseUrl: base, tenantSlug: 'acme' }));
  const slow = fill('_a ', 150 * 1024);
  const { result, ticks } = await withMainThreadProbe(() => renderCommentEmail(slow, base, 'acme'));
  assert.deepEqual(result, renderCommentForEmail({ commentHtml: renderPlainTextEmailHtml(slow), tenantBaseUrl: base, tenantSlug: 'acme' }));
  assertMainThreadServed(ticks, 'plain-text email');
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
  assertLockfileParser();
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
