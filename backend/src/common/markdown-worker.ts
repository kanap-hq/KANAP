import {
  BadRequestException,
  HttpException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import type { ImportedImageReference } from './document-import-markdown';
import { sanitizeRichHtmlForEmail } from './html-sanitizer';
import { assertMarkdownSize } from './markdown-limits';
import type {
  MarkdownWorkerOperation,
  MarkdownWorkerOperations,
  MarkdownWorkerReply,
} from './markdown-worker.thread';
import type { InlineImageReference } from '../knowledge/integrated-document-markdown';
import {
  buildInterfaceSpecificationMarkdown,
  InterfaceSpecificationSource,
} from '../knowledge/interface-specification-markdown';

/**
 * Markdown and HTML processing of texts written by users or read from external
 * sources, run off the main thread of the API.
 *
 * The parser (`marked`), turndown and the regular expressions of the imports can
 * take seconds on some texts of a few kilobytes. They run in a small pool of
 * worker threads (markdown-worker.thread.ts); the main thread only sends the
 * text and waits for the answer, so it keeps serving other requests.
 *
 * - Each call has a wall-clock budget (`MARKDOWN_WORK_TIMEOUT_MS`). Past it, the
 *   worker is stopped and replaced, and the call is refused with a 400
 *   `MARKDOWN_TOO_COMPLEX`; so is a call whose worker overflows its stack, runs
 *   out of memory or stops. A task that processes several texts sends them in
 *   one call, or shares one budget across its calls (`markdownWorkBudget`).
 * - Calls wait in a queue for a free worker. A call that waits longer than
 *   `QUEUE_WAIT_MS` while workers are running is refused with a 503
 *   `MARKDOWN_BUSY`, so a request never holds its database connection long on a
 *   busy pool.
 * - When no worker can start, calls are refused with a 503 `MARKDOWN_UNAVAILABLE`
 *   and emails fall back to plain text. The main thread never parses in their
 *   place.
 * - A stored content (copies, recovery of a legacy text, emails) the workers
 *   cannot process in time is kept readable as plain text; a busy or missing
 *   pool is refused (503) and nothing is stored, so a later read tries again.
 */

export const MARKDOWN_WORK_TIMEOUT_MS = 2000;

export const MARKDOWN_TOO_COMPLEX = 'MARKDOWN_TOO_COMPLEX';
export const MARKDOWN_BUSY = 'MARKDOWN_BUSY';
export const MARKDOWN_UNAVAILABLE = 'MARKDOWN_UNAVAILABLE';

/** Workers per API process. */
const WORKER_COUNT = 2;
/** How long a call may wait for a free worker while the workers are running. */
const QUEUE_WAIT_MS = 3000;
/** Calls waiting at most, per process (memory bound). */
const QUEUE_MAX = 256;
/** How long a worker may take to start (loading the modules, warm-up). */
const START_TIMEOUT_MS = 30_000;
/** Delay before a new start after a worker could not start. */
const RESTART_DELAY_MS = 5000;
/** Heap of a worker. */
const WORKER_HEAP_MB = 256;

const logger = new Logger('MarkdownWorker');

export class MarkdownTooComplexException extends BadRequestException {
  constructor(fieldName = 'content') {
    super({
      code: MARKDOWN_TOO_COMPLEX,
      message:
        `${fieldName} is too complex to process as Markdown. ` +
        'Put pasted logs or code in a code block, close the formatting marks or reduce the nesting.',
      field: fieldName,
    });
  }
}

export class MarkdownBusyException extends ServiceUnavailableException {
  constructor() {
    super({
      code: MARKDOWN_BUSY,
      message: 'The server is busy processing other texts. Try again in a moment.',
    });
  }
}

export class MarkdownUnavailableException extends ServiceUnavailableException {
  constructor() {
    super({
      code: MARKDOWN_UNAVAILABLE,
      message: 'Text processing is not available on this server. Contact your administrator.',
    });
  }
}

/** Whether the error says the text took too long or nested too deeply to process (400 `MARKDOWN_TOO_COMPLEX`). */
export function isMarkdownTooComplex(error: unknown): boolean {
  return error instanceof MarkdownTooComplexException;
}

/** Whether the error is a refusal of the Markdown workers (time, busy, unavailable), not of the content rules. */
export function isMarkdownWorkFailure(error: unknown): boolean {
  return error instanceof MarkdownTooComplexException
    || error instanceof MarkdownBusyException
    || error instanceof MarkdownUnavailableException;
}

/** Time budget shared by the calls of one task that processes several texts. */
export type MarkdownWorkBudget = {
  remainingMs: number;
  /** Set once a call was refused for this budget: later refusals are not logged again. */
  refused?: boolean;
};

export function markdownWorkBudget(): MarkdownWorkBudget {
  return { remainingMs: MARKDOWN_WORK_TIMEOUT_MS };
}

export type MarkdownWorkOptions = {
  /** Name of the field in the messages of a refusal. */
  fieldName?: string;
  /** Budget shared with other calls of the same task. */
  budget?: MarkdownWorkBudget;
};

// ---------------------------------------------------------------------------
// Pool.

type Task = {
  op: MarkdownWorkerOperation;
  args: unknown[];
  fieldName: string;
  chars: number;
  timeoutMs: number;
  budget?: MarkdownWorkBudget;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  waitTimer: NodeJS.Timeout | null;
};

type Slot = {
  worker: Worker;
  ready: boolean;
  /** Stopped by the pool (time over, shutdown): its exit needs no handling. */
  stopped: boolean;
  task: Task | null;
  startedAt: number;
  runTimer: NodeJS.Timeout | null;
  startTimer: NodeJS.Timeout | null;
  lastError: string | null;
};

const BOOTSTRAP = `
const { workerData } = require('node:worker_threads');
if (workerData.tsNode) {
  require(workerData.tsNode).register({ transpileOnly: true, project: workerData.tsProject });
}
require(workerData.entry);
`;

let slots: Slot[] = [];
const queue: Task[] = [];
let closed = false;
let restartAt = 0;
let unavailable = false;
let readyWaiters: Array<(ready: boolean) => void> = [];

function workerData(): Record<string, unknown> {
  const extension = path.extname(__filename);
  const source = extension === '.ts';
  return {
    kanapMarkdownWorker: true,
    entry: path.join(__dirname, `markdown-worker.thread${extension}`),
    // Run from the TypeScript sources (development, single specs): the worker compiles them too.
    tsNode: source ? require.resolve('ts-node') : null,
    tsProject: source ? path.resolve(__dirname, '..', '..', 'tsconfig.json') : null,
  };
}

function notifyReady(ready: boolean): void {
  const waiters = readyWaiters;
  readyWaiters = [];
  for (const resolve of waiters) resolve(ready);
}

function removeSlot(slot: Slot): void {
  slots = slots.filter((candidate) => candidate !== slot);
  if (slot.runTimer) clearTimeout(slot.runTimer);
  if (slot.startTimer) clearTimeout(slot.startTimer);
  slot.runTimer = null;
  slot.startTimer = null;
}

function stopSlot(slot: Slot): void {
  slot.stopped = true;
  removeSlot(slot);
  void slot.worker.terminate().catch(() => undefined);
}

function spawnSlot(): void {
  let worker: Worker;
  try {
    worker = new Worker(BOOTSTRAP, {
      eval: true,
      workerData: workerData(),
      resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB },
    });
  } catch (error) {
    onStartFailure(String((error as Error)?.message ?? error));
    return;
  }
  const slot: Slot = {
    worker,
    ready: false,
    stopped: false,
    task: null,
    startedAt: 0,
    runTimer: null,
    startTimer: null,
    lastError: null,
  };
  slot.startTimer = setTimeout(() => {
    if (slot.ready || slot.stopped) return;
    stopSlot(slot);
    onStartFailure('the worker did not start in time');
  }, START_TIMEOUT_MS);
  slot.startTimer.unref();
  worker.on('message', (message: MarkdownWorkerReply | { ready: true }) => onMessage(slot, message));
  worker.on('error', (error) => {
    slot.lastError = String(error?.message ?? error);
  });
  worker.on('exit', () => onExit(slot));
  slots.push(slot);
}

function ensurePool(): void {
  if (closed || Date.now() < restartAt) return;
  while (slots.length < WORKER_COUNT) {
    const before = slots.length;
    spawnSlot();
    if (slots.length === before) return;
  }
}

function onStartFailure(reason: string): void {
  restartAt = Date.now() + RESTART_DELAY_MS;
  if (slots.length > 0) return;
  if (!unavailable) {
    unavailable = true;
    logger.error(
      `Markdown workers could not start (${reason}). Until they start, writes of rich text are refused ` +
      '(503 MARKDOWN_UNAVAILABLE) and emails show comments as plain text. Next try in a few seconds.',
    );
  }
  for (const task of queue.splice(0)) {
    if (task.waitTimer) clearTimeout(task.waitTimer);
    task.reject(new MarkdownUnavailableException());
  }
  notifyReady(false);
}

function onExit(slot: Slot): void {
  if (slot.stopped) return;
  const wasReady = slot.ready;
  const task = slot.task;
  slot.task = null;
  removeSlot(slot);
  if (task) {
    chargeBudget(task, performance.now() - slot.startedAt);
    logStopped(task, slot.lastError ? `stopped: ${slot.lastError}` : 'stopped');
    task.reject(new MarkdownTooComplexException(task.fieldName));
  }
  if (!wasReady && !closed) {
    onStartFailure(slot.lastError ?? 'the worker stopped while starting');
    return;
  }
  ensurePool();
  dispatch();
}

function onMessage(slot: Slot, message: MarkdownWorkerReply | { ready: true }): void {
  if (!slot.ready) {
    if (!('ready' in message) || message.ready !== true) return;
    slot.ready = true;
    if (slot.startTimer) clearTimeout(slot.startTimer);
    slot.startTimer = null;
    // A worker keeps the process alive while it starts or runs a call, never when idle.
    slot.worker.unref();
    restartAt = 0;
    if (unavailable) {
      unavailable = false;
      logger.log('Markdown workers started.');
    }
    notifyReady(true);
    dispatch();
    return;
  }
  const task = slot.task;
  if (!task || !('ok' in message)) return;
  slot.task = null;
  if (slot.runTimer) clearTimeout(slot.runTimer);
  slot.runTimer = null;
  slot.worker.unref();
  chargeBudget(task, performance.now() - slot.startedAt);
  settle(task, message);
  dispatch();
}

function chargeBudget(task: Task, elapsedMs: number): void {
  if (task.budget) task.budget.remainingMs -= elapsedMs;
}

function settle(task: Task, reply: MarkdownWorkerReply): void {
  if (reply.ok) {
    task.resolve(reply.value);
    return;
  }
  const error = reply.error;
  if (error.kind === 'http') {
    task.reject(error.status === 400
      ? new BadRequestException(error.response)
      : new HttpException(error.response, error.status));
    return;
  }
  if (error.kind === 'stack') {
    logStopped(task, 'nesting');
    task.reject(new MarkdownTooComplexException(task.fieldName));
    return;
  }
  task.reject(new Error(error.message));
}

function logStopped(task: Task, reason: string): void {
  logger.warn(
    `Text not processed: op=${task.op} field=${task.fieldName} size=${Math.ceil(task.chars / 1024)}KB reason=${reason}`,
  );
}

function runOnSlot(slot: Slot, task: Task): void {
  slot.task = task;
  slot.startedAt = performance.now();
  slot.worker.ref();
  slot.runTimer = setTimeout(() => {
    if (slot.task !== task) return;
    slot.task = null;
    chargeBudget(task, task.timeoutMs);
    logStopped(task, 'time');
    task.reject(new MarkdownTooComplexException(task.fieldName));
    stopSlot(slot);
    ensurePool();
    dispatch();
  }, task.timeoutMs);
  try {
    slot.worker.postMessage({ op: task.op, args: task.args });
  } catch (error) {
    slot.task = null;
    if (slot.runTimer) clearTimeout(slot.runTimer);
    slot.runTimer = null;
    slot.worker.unref();
    task.reject(error);
  }
}

function dispatch(): void {
  if (closed) return;
  for (const slot of slots) {
    if (queue.length === 0) return;
    if (!slot.ready || slot.task) continue;
    const task = queue.shift()!;
    if (task.waitTimer) clearTimeout(task.waitTimer);
    task.waitTimer = null;
    runOnSlot(slot, task);
  }
}

function onWaitTimeout(task: Task): void {
  if (!queue.includes(task)) return;
  if (!slots.some((slot) => slot.ready)) {
    // The workers are starting: the start timeout bounds this wait.
    task.waitTimer = setTimeout(() => onWaitTimeout(task), QUEUE_WAIT_MS);
    return;
  }
  queue.splice(queue.indexOf(task), 1);
  logger.warn(`Text not processed: op=${task.op} field=${task.fieldName} reason=busy`);
  task.reject(new MarkdownBusyException());
}

function textLength(args: unknown[]): number {
  let chars = 0;
  for (const arg of args) {
    if (typeof arg === 'string') chars += arg.length;
    else if (Array.isArray(arg)) chars += arg.reduce<number>((sum, item) => sum + (typeof item === 'string' ? item.length : 0), 0);
  }
  return chars;
}

function submit<K extends MarkdownWorkerOperation>(
  op: K,
  args: Parameters<MarkdownWorkerOperations[K]>,
  opts?: MarkdownWorkOptions,
): Promise<ReturnType<MarkdownWorkerOperations[K]>> {
  return new Promise((resolve, settleWithError) => {
    // A call refused before it reaches a worker settles on the next turn of the event loop: a
    // task that loops over many texts (CSV) then lets other requests run between its refusals.
    const refuse = (error: unknown) => setImmediate(() => settleWithError(error));
    const fieldName = opts?.fieldName || 'content';
    if (closed) {
      refuse(new MarkdownUnavailableException());
      return;
    }
    const timeoutMs = Math.min(MARKDOWN_WORK_TIMEOUT_MS, opts?.budget ? opts.budget.remainingMs : Number.POSITIVE_INFINITY);
    const task: Task = {
      op,
      args,
      fieldName,
      chars: textLength(args),
      timeoutMs,
      budget: opts?.budget,
      resolve: resolve as (value: unknown) => void,
      reject: settleWithError,
      waitTimer: null,
    };
    if (timeoutMs <= 0) {
      // The budget of the task is spent: refused at once, logged once per task.
      if (!opts?.budget?.refused) logStopped(task, 'time');
      if (opts?.budget) opts.budget.refused = true;
      refuse(new MarkdownTooComplexException(fieldName));
      return;
    }
    ensurePool();
    if (slots.length === 0) {
      refuse(new MarkdownUnavailableException());
      return;
    }
    if (queue.length >= QUEUE_MAX) {
      logger.warn(`Text not processed: op=${op} field=${fieldName} reason=busy`);
      refuse(new MarkdownBusyException());
      return;
    }
    task.waitTimer = setTimeout(() => onWaitTimeout(task), QUEUE_WAIT_MS);
    queue.push(task);
    dispatch();
  });
}

/**
 * Starts the workers and waits until one is ready (API start). Resolves false
 * when none can start; the pool tries again on the next call.
 */
export function startMarkdownWorkers(): Promise<boolean> {
  ensurePool();
  if (slots.some((slot) => slot.ready)) return Promise.resolve(true);
  if (slots.length === 0) return Promise.resolve(false);
  return new Promise((resolve) => readyWaiters.push(resolve));
}

/** Stops the workers (API shutdown). Calls still waiting or running are refused. */
export async function closeMarkdownWorkers(): Promise<void> {
  closed = true;
  for (const task of queue.splice(0)) {
    if (task.waitTimer) clearTimeout(task.waitTimer);
    task.reject(new MarkdownUnavailableException());
  }
  const stopping = slots.map((slot) => {
    const task = slot.task;
    slot.task = null;
    if (task) task.reject(new MarkdownUnavailableException());
    slot.stopped = true;
    if (slot.runTimer) clearTimeout(slot.runTimer);
    if (slot.startTimer) clearTimeout(slot.startTimer);
    return slot.worker.terminate().catch(() => undefined);
  });
  slots = [];
  notifyReady(false);
  await Promise.all(stopping);
}

/** For specs: a pool that may start again after `closeMarkdownWorkers`. */
export function reopenMarkdownWorkersForTests(): void {
  closed = false;
  restartAt = 0;
}

/** For specs: the worker threads of the pool, the one running a call first. */
export function markdownWorkerThreadsForTests(): Worker[] {
  return [...slots].sort((a, b) => Number(!!b.task) - Number(!!a.task)).map((slot) => slot.worker);
}

// ---------------------------------------------------------------------------
// Plain-text fallbacks (main thread, linear time).

/** The text as a fenced code block: shown as plain text, read by the parser in linear time. */
export function markdownCodeBlock(text: string): string {
  let longestRun = 0;
  let run = 0;
  for (const char of text) {
    run = char === '`' ? run + 1 : 0;
    if (run > longestRun) longestRun = run;
  }
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return `${fence}text\n${text.trim()}\n${fence}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The text as plain paragraphs: what an email shows when the Markdown cannot be rendered. */
export function renderPlainTextEmailHtml(content: string): string {
  const text = String(content || '').trim();
  if (!text) return '';
  const paragraphs = text.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
  return sanitizeRichHtmlForEmail(
    paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph).split('\n').join('<br>\n')}</p>`).join('\n'),
  );
}

// ---------------------------------------------------------------------------
// Operations.

type NormalizeOptions = MarkdownWorkOptions & {
  /**
   * False for server-side processing of contents already stored (copies,
   * backfills, repairs, verification): they keep whatever size they had, and a
   * content the workers cannot process in time is kept as it is.
   */
  enforceSizeLimit?: boolean;
};

/**
 * The Markdown content of a rich-text field, trimmed, or null when blank. Refuses
 * raw HTML outside code, inline base64 images and contents over the size limit
 * (400), and contents the workers cannot process (`MARKDOWN_TOO_COMPLEX`, ...).
 */
export async function normalizeMarkdownRichText(value: unknown, opts?: NormalizeOptions): Promise<string | null> {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const fieldName = opts?.fieldName || 'content';
  const enforceSizeLimit = opts?.enforceSizeLimit !== false;
  if (enforceSizeLimit) {
    // Checked here first: a text over the limit is never sent to a worker.
    assertMarkdownSize(text, fieldName);
  }
  try {
    return await submit('normalize', [text, { fieldName, enforceSizeLimit }], { ...opts, fieldName });
  } catch (error) {
    if (!enforceSizeLimit && isMarkdownTooComplex(error)) {
      // A stored content the workers cannot process in time stays as it is.
      return text;
    }
    throw error;
  }
}

export function isHtmlContent(content: string, opts?: MarkdownWorkOptions): Promise<boolean> {
  return submit('isHtml', [String(content ?? '')], opts);
}

export function containsInlineDataImage(content: string, opts?: MarkdownWorkOptions): Promise<boolean> {
  return submit('containsDataImage', [String(content ?? '')], opts);
}

export function htmlToMarkdown(content: string, opts?: MarkdownWorkOptions): Promise<string> {
  return submit('htmlToMarkdown', [String(content ?? '')], opts);
}

/** The text as it should be read: itself, or its entity-decoded form when that one is HTML. */
export async function resolveHtmlContentSource(content: string, opts?: MarkdownWorkOptions): Promise<string> {
  const [resolved] = await submit('resolveHtmlSources', [[String(content ?? '')]], opts);
  return resolved;
}

/** `resolveHtmlContentSource` of several texts, in one call. */
export function resolveHtmlContentSources(contents: string[], opts?: MarkdownWorkOptions): Promise<string[]> {
  if (contents.length === 0) return Promise.resolve([]);
  return submit('resolveHtmlSources', [contents.map((content) => String(content ?? ''))], opts);
}

/** Plain text of a Markdown content for the search index. */
export function markdownToSearchText(value: string | null | undefined, opts?: MarkdownWorkOptions): Promise<string> {
  return submit('searchText', [String(value || '')], opts);
}

/**
 * HTML of a stored Markdown content for an email. Never rejects: a content the
 * workers cannot render is shown as plain text.
 */
export async function renderMarkdownEmailHtml(content: string): Promise<string> {
  const text = String(content || '').trim();
  if (!text) return '';
  try {
    return await submit('emailHtml', [text], { fieldName: 'email' });
  } catch {
    return renderPlainTextEmailHtml(text);
  }
}

/** The Markdown of a document import (converter output) cleaned for the editor, and its images. */
export function sanitizeImportedMarkdown(
  raw: string,
  opts?: MarkdownWorkOptions,
): Promise<{ markdown: string; images: ImportedImageReference[] }> {
  return submit('importedMarkdown', [String(raw || '')], opts);
}

/** The images of an imported Markdown text, in text order. */
export function findImportedImageReferences(markdown: string, opts?: MarkdownWorkOptions): Promise<ImportedImageReference[]> {
  return submit('importedImages', [String(markdown || '')], opts);
}

/** The inline images (Markdown images and `<img>` tags) of a Markdown text. */
export function findInlineImageReferences(content: string | null | undefined, opts?: MarkdownWorkOptions): Promise<InlineImageReference[]> {
  return submit('inlineImages', [String(content || '')], opts);
}

/**
 * A legacy stored text (HTML or Markdown) as Markdown. A text the workers cannot
 * process in time is shown as a plain-text code block.
 */
export async function prepareRecoveredContent(content: string | null | undefined): Promise<string | null> {
  if (content == null) return null;
  const text = String(content);
  if (!text.trim()) return '';
  try {
    return await submit('recoveredContent', [text], { fieldName: 'description' });
  } catch (error) {
    if (isMarkdownTooComplex(error)) return markdownCodeBlock(text);
    throw error;
  }
}

/**
 * The specification document of an interface from its stored texts. When the
 * workers cannot build it in time, the texts are shown as a plain-text code block.
 */
export async function interfaceSpecificationMarkdown(row: InterfaceSpecificationSource): Promise<string> {
  const source: InterfaceSpecificationSource = {
    business_purpose: row.business_purpose,
    overview_notes: row.overview_notes,
    impact_of_failure: row.impact_of_failure,
    business_objects: row.business_objects,
    main_use_cases: row.main_use_cases,
    functional_rules: row.functional_rules,
    core_transformations_summary: row.core_transformations_summary,
    error_handling_summary: row.error_handling_summary,
    typical_data: row.typical_data,
    audit_logging: row.audit_logging,
    security_controls_summary: row.security_controls_summary,
  };
  try {
    return await submit('interfaceSpecification', [source], { fieldName: 'specification' });
  } catch (error) {
    if (!isMarkdownTooComplex(error)) throw error;
    const plain = buildInterfaceSpecificationMarkdown(source, (text) => text);
    return plain ? markdownCodeBlock(plain) : plain;
  }
}
