import * as assert from 'node:assert/strict';
import * as workerThreads from 'node:worker_threads';
import { HttpException } from '@nestjs/common';
import {
  closeMarkdownWorkers,
  MARKDOWN_UNAVAILABLE,
  markdownWorkersStatus,
  normalizeMarkdownRichText,
  renderMarkdownEmailHtml,
  renderPlainTextEmailHtml,
  reopenMarkdownWorkersForTests,
  startMarkdownWorkers,
} from '../markdown-worker';

// When no Markdown worker can start, the API says so at start, refuses rich-text
// writes with a 503 MARKDOWN_UNAVAILABLE and never parses on its main thread;
// emails show the text as plain text. The pool starts again once workers can.

const RealWorker = workerThreads.Worker;

async function codeOf(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
    return 'ok';
  } catch (error) {
    assert.ok(error instanceof HttpException, String(error));
    const response = error.getResponse() as { code?: string };
    return `${error.getStatus()} ${response.code}`;
  }
}

async function run() {
  (workerThreads as { Worker: unknown }).Worker = class {
    constructor() {
      throw new Error('worker threads are not available');
    }
  };
  try {
    assert.equal(await startMarkdownWorkers(), false);
    assert.equal(markdownWorkersStatus(), 'unavailable');
    assert.equal(await codeOf(() => normalizeMarkdownRichText('**text**')), `503 ${MARKDOWN_UNAVAILABLE}`);
    assert.equal(
      await codeOf(() => normalizeMarkdownRichText('**stored**', { enforceSizeLimit: false })),
      `503 ${MARKDOWN_UNAVAILABLE}`,
    );
    assert.equal(await renderMarkdownEmailHtml('**text**'), renderPlainTextEmailHtml('**text**'));
  } finally {
    (workerThreads as { Worker: unknown }).Worker = RealWorker;
  }

  reopenMarkdownWorkersForTests();
  assert.equal(await startMarkdownWorkers(), true);
  assert.equal(await normalizeMarkdownRichText('**text**'), '**text**');
  await closeMarkdownWorkers();
}

run().catch(async (error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  await closeMarkdownWorkers();
  process.exit(1);
});
