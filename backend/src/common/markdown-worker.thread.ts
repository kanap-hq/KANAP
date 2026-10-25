import { HttpException } from '@nestjs/common';
import { marked } from 'marked';
import { parentPort, workerData } from 'node:worker_threads';
import {
  collectInlineImageOccurrences,
  interfaceSpecificationMarkdown,
  prepareRecoveredContent,
} from '../knowledge/integrated-document-markdown';
import { InterfaceSpecificationSource } from '../knowledge/interface-specification-markdown';
import { findImportedImageReferences, sanitizeForMdxEditor } from './document-import-markdown';
import { containsInlineDataImage, htmlToMarkdown, isHtmlContent, resolveHtmlContentSource } from './html-to-markdown';
import { normalizeMarkdownRichText } from './markdown-rich-text';
import { markdownToSearchText } from './markdown-search-text';
import { renderMarkdownToHtml } from './markdown-to-html';
import { renderCommentForEmail } from '../notifications/comment-email-renderer';

/**
 * Entry of a Markdown worker thread (markdown-worker.ts starts it). Each message
 * runs one operation of the table below and answers with its value or its error.
 * This module and the modules it imports are the only ones that parse Markdown
 * or convert HTML: the main thread of the API never loads them.
 */

export const MARKDOWN_WORKER_OPERATIONS = {
  normalize: (text: string, opts: { fieldName: string; enforceSizeLimit: boolean }) => normalizeMarkdownRichText(text, opts),
  normalizeWithSearchText: (text: string, opts: { fieldName: string; enforceSizeLimit: boolean }) => {
    const content = normalizeMarkdownRichText(text, opts);
    return { content, searchText: markdownToSearchText(content || '') };
  },
  isHtml: (text: string) => isHtmlContent(text),
  containsDataImage: (text: string) => containsInlineDataImage(text),
  htmlToMarkdown: (text: string) => htmlToMarkdown(text),
  resolveHtmlSources: (texts: string[]) => texts.map((text) => resolveHtmlContentSource(text)),
  searchText: (text: string) => markdownToSearchText(text),
  emailHtml: (text: string) => renderMarkdownToHtml(text),
  commentEmail: (text: string, tenantBaseUrl: string, tenantSlug: string | null) =>
    renderCommentForEmail({ commentHtml: renderMarkdownToHtml(text), tenantBaseUrl, tenantSlug }),
  importedMarkdown: (raw: string) => {
    const markdown = sanitizeForMdxEditor(raw);
    return { markdown, images: findImportedImageReferences(markdown) };
  },
  importedImages: (markdown: string) => findImportedImageReferences(markdown),
  recoveredContent: (text: string) => prepareRecoveredContent(text),
  inlineImages: (text: string) => collectInlineImageOccurrences(text),
  interfaceSpecification: (row: InterfaceSpecificationSource, language?: string | null) => interfaceSpecificationMarkdown(row, language),
};

export type MarkdownWorkerOperations = typeof MARKDOWN_WORKER_OPERATIONS;
export type MarkdownWorkerOperation = keyof MarkdownWorkerOperations;

export type MarkdownWorkerRequest = { op: MarkdownWorkerOperation; args: unknown[] };

export type MarkdownWorkerError =
  | { kind: 'http'; status: number; response: string | object }
  | { kind: 'stack' }
  | { kind: 'error'; message: string };

export type MarkdownWorkerReply =
  | { ok: true; value: unknown }
  | { ok: false; error: MarkdownWorkerError };

/**
 * A text nested too deeply for the parser overflows its stack. Some callers read
 * a failed parse as plain text: the overflow is noted here, and the operation is
 * answered as too complex, never with that reading.
 */
let stackOverflow = false;
const lexer = marked.lexer;
marked.lexer = ((src: string, options?: Parameters<typeof lexer>[1]) => {
  try {
    return lexer(src, options);
  } catch (error) {
    if (error instanceof RangeError) stackOverflow = true;
    throw error;
  }
}) as typeof marked.lexer;

function describeError(error: unknown): MarkdownWorkerError {
  if (error instanceof HttpException) {
    return { kind: 'http', status: error.getStatus(), response: error.getResponse() };
  }
  if (error instanceof RangeError) {
    return { kind: 'stack' };
  }
  return { kind: 'error', message: String((error as Error)?.message ?? error) };
}

export function runMarkdownWorkerOperation(request: MarkdownWorkerRequest): MarkdownWorkerReply {
  stackOverflow = false;
  try {
    const operation = MARKDOWN_WORKER_OPERATIONS[request.op] as (...args: unknown[]) => unknown;
    if (typeof operation !== 'function') {
      return { ok: false, error: { kind: 'error', message: `Unknown Markdown operation: ${String(request.op)}` } };
    }
    const value = operation(...request.args);
    return stackOverflow ? { ok: false, error: { kind: 'stack' } } : { ok: true, value };
  } catch (error) {
    return { ok: false, error: stackOverflow ? { kind: 'stack' } : describeError(error) };
  }
}

const WARMUP_MARKDOWN = [
  '# Title', '', 'Some *emphasis*, **strong**, _under_ and `code`, a [link](https://example.com/a_b) and ~~strike~~.', '',
  '- item one', '  - nested **item**', '1. first', '2. second', '', '> quoted _text_', '',
  '| a | b |', '| - | - |', '| *x* | [y](z) |', '', '```js', 'const a = 1 * 2;', '```', '',
  '![alt](https://example.com/i.png) <https://example.com> text<br>line', '',
  'Setext', '======', '', '---', '', '- [ ] task', '- [x] done', '',
].join('\n');
const WARMUP_HTML = '<p>Some <strong>bold</strong> text, a <a href="https://example.com">link</a></p><ul><li>one</li></ul>';

function warmUp(): void {
  for (let round = 0; round < 3; round += 1) {
    runMarkdownWorkerOperation({ op: 'normalize', args: [WARMUP_MARKDOWN, { fieldName: 'content', enforceSizeLimit: true }] });
    runMarkdownWorkerOperation({ op: 'searchText', args: [WARMUP_MARKDOWN] });
    runMarkdownWorkerOperation({ op: 'emailHtml', args: [WARMUP_MARKDOWN] });
    runMarkdownWorkerOperation({ op: 'htmlToMarkdown', args: [WARMUP_HTML] });
    runMarkdownWorkerOperation({ op: 'importedMarkdown', args: [`${WARMUP_MARKDOWN}\n<table><tr><td>a</td></tr></table>`] });
  }
}

if (parentPort && (workerData as { kanapMarkdownWorker?: boolean } | null)?.kanapMarkdownWorker === true) {
  const port = parentPort;
  warmUp();
  port.on('message', (request: MarkdownWorkerRequest) => {
    port.postMessage(runMarkdownWorkerOperation(request));
  });
  // From the TypeScript sources (development), the modules this thread loaded, so the
  // development server restarts when one of them changes (markdown-worker.ts).
  const sources = (workerData as { tsNode?: string | null }).tsNode
    ? Object.keys(require.cache).filter((file) => file.endsWith('.ts'))
    : undefined;
  port.postMessage({ ready: true, sources });
}
