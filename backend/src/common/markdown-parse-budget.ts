import { BadRequestException, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';

/**
 * Time budget of the Markdown parser.
 *
 * `marked` runs synchronously: some texts of a few kilobytes keep it busy for
 * seconds (many formatting marks left open in one paragraph, very deep nesting).
 * Before such a text reaches the parser on the main thread, a worker thread
 * parses it once and measures the CPU time it took:
 *
 * - at the entry of a write (HTTP body, AI tool input, CSV, imported files,
 *   GLPI tickets), each text is measured; a text over the budget is remembered,
 *   and the parser refuses it with a 400 `MARKDOWN_TOO_COMPLEX` when a write
 *   asks for it (`assertWithinMarkdownParseBudget`), so a field that is never
 *   read as Markdown is never refused;
 * - a stored content read later (copies, recovery, emails) is measured the same
 *   way and falls back to its plain text when it is over the budget.
 *
 * The workers parse with the same options as the main thread. A worker over the
 * budget, or still busy at the wall-clock deadline, is terminated and replaced.
 */

export const MARKDOWN_TOO_COMPLEX = 'MARKDOWN_TOO_COMPLEX';

/** CPU time the parser may spend on one text, measured in a worker. */
export const MARKDOWN_PARSE_BUDGET_MS = 100;

/** Texts shorter than this parse fast whatever they hold: they are not measured. */
export const MARKDOWN_PARSE_CHECK_MIN_CHARS = 1024;

/** CPU time the parser may spend on all the long cells of one CSV file together. */
export const CSV_MARKDOWN_PARSE_BUDGET_MS = 250;

/** Longer texts are not measured by the HTTP check: the size limit refuses them as Markdown. */
export const MARKDOWN_PARSE_CHECK_MAX_CHARS = 200 * 1024;

const WORKER_COUNT = 2;
const WALL_BUDGET_MS = 2000;
const RENDER_CPU_BUDGET_MS = 2000;
const CPU_POLL_MS = 20;
const REMEMBERED_KEYS = 512;
const PARSE_OPTIONS = { gfm: true, breaks: true } as const;

const logger = new Logger('MarkdownParseBudget');

const DATA_IMAGE_PAYLOAD_REGEX = /(data:image\/[a-z0-9.+-]+;base64,)[a-z0-9+/=]+/gi;

/**
 * The text with each base64 run after a `data:image/...;base64,` prefix cut to one
 * character, as the parser sees it: an inline image payload is not parsed. The cut
 * keeps the prefix, so the URI is still recognised as an inline image. It changes
 * no Markdown structure: the payload alphabet (letters, digits, "+", "/" and "=")
 * holds no delimiter that acts in the middle of a line. It can shorten an
 * unquoted HTML attribute value, which only leads to more refusals of raw HTML.
 */
export function withoutDataImagePayloads(content: string): string {
  return String(content || '').replace(DATA_IMAGE_PAYLOAD_REGEX, '$1A');
}

/** The text the parser is given for a content: trimmed, inline image payloads cut. */
export function markdownParseText(value: unknown): string {
  return withoutDataImagePayloads(String(value ?? '').trim());
}

// ---------------------------------------------------------------------------
// Texts measured over the budget, by digest of their parse text.

const overBudgetKeys = new Map<string, true>();

function keyOf(parseText: string): string {
  return createHash('sha256').update(parseText).digest('base64');
}

function rememberOverBudget(parseText: string): void {
  const key = keyOf(parseText);
  overBudgetKeys.delete(key);
  overBudgetKeys.set(key, true);
  while (overBudgetKeys.size > REMEMBERED_KEYS) {
    const oldest = overBudgetKeys.keys().next().value;
    if (oldest === undefined) break;
    overBudgetKeys.delete(oldest);
  }
}

/** Whether this parse text (see `markdownParseText`) was measured over the budget. */
export function isOverMarkdownParseBudget(parseText: string): boolean {
  if (parseText.length < MARKDOWN_PARSE_CHECK_MIN_CHARS || overBudgetKeys.size === 0) return false;
  return overBudgetKeys.has(keyOf(parseText));
}

export function markdownTooComplexError(fieldName = 'content'): BadRequestException {
  return new BadRequestException({
    code: MARKDOWN_TOO_COMPLEX,
    message:
      `${fieldName} is too complex to process as Markdown. ` +
      'Put pasted logs or code in a code block, close the formatting marks or reduce the nesting.',
    field: fieldName,
  });
}

/** Refuses, before the parser runs, a parse text measured over the budget. */
export function assertWithinMarkdownParseBudget(parseText: string, fieldName = 'content'): void {
  if (isOverMarkdownParseBudget(parseText)) {
    logger.warn(`Markdown content refused, over the parse budget: field=${fieldName} size=${Math.ceil(parseText.length / 1024)}KB`);
    throw markdownTooComplexError(fieldName);
  }
}

// ---------------------------------------------------------------------------
// Worker pool.

type MeasureTask = { op: 'measure'; texts: string[]; budgetMs: number };
type RenderTask = { op: 'render'; text: string };
type Task = MeasureTask | RenderTask;

export type MarkdownWorkerOutcome = {
  /** ok, time (over the budget or the deadline), stack (nesting too deep), error, unavailable */
  status: 'ok' | 'time' | 'stack' | 'error' | 'unavailable';
  cpuMs: number;
  html?: string;
};

type Slot = {
  worker: Worker;
  ready: Promise<void>;
  busy: boolean;
  /** Cumulated CPU time of the worker thread when its last task ended (ms). */
  baselineCpuMs: number;
  /** Whether the worker measures its thread CPU time (else only the wall-clock deadline applies). */
  cpuClock: boolean;
};

type WorkerWithCpuUsage = Worker & { cpuUsage?: () => Promise<{ user: number; system: number }> };

type Pending = { task: Task; resolve: (outcome: MarkdownWorkerOutcome) => void };

const WORKER_SOURCE = `
'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const { marked } = require(workerData.markedPath);
const OPTIONS = workerData.options;
const cpuClock = typeof process.threadCpuUsage === 'function';
const threadCpuMs = cpuClock
  ? () => { const u = process.threadCpuUsage(); return (u.user + u.system) / 1000; }
  : () => performance.now();
for (let i = 0; i < 5; i += 1) marked.parse(workerData.warmup, Object.assign({ async: false }, OPTIONS));
parentPort.on('message', (task) => {
  const start = threadCpuMs();
  const reply = { status: 'ok', cpuMs: 0, threadCpuMs: 0 };
  try {
    if (task.op === 'render') {
      reply.html = String(marked.parse(task.text, Object.assign({ async: false }, OPTIONS)));
    } else {
      for (const text of task.texts) {
        marked.lexer(text, OPTIONS);
        if (threadCpuMs() - start > task.budgetMs) { reply.status = 'time'; break; }
      }
    }
  } catch (error) {
    reply.status = error instanceof RangeError ? 'stack' : 'error';
    reply.html = undefined;
  }
  const end = threadCpuMs();
  reply.cpuMs = end - start;
  reply.threadCpuMs = end;
  parentPort.postMessage(reply);
});
parentPort.postMessage({ ready: true, cpuClock, threadCpuMs: threadCpuMs() });
`;

const WARMUP_MARKDOWN = [
  '# Title', '', 'Some *emphasis*, **strong**, _under_ and `code`, a [link](https://example.com/a_b) and ~~strike~~.', '',
  '- item one', '  - nested **item**', '1. first', '2. second', '', '> quoted _text_', '',
  '| a | b |', '| - | - |', '| *x* | [y](z) |', '', '```js', 'const a = 1 * 2;', '```', '',
  '![alt](https://example.com/i.png) <https://example.com> text<br>line', '',
  'Setext', '======', '', '---', '', '- [ ] task', '- [x] done', '',
].join('\n').repeat(8);

let slots: Slot[] = [];
const queue: Pending[] = [];
let closed = false;
let spawnFailureLogged = false;

function spawnSlot(): Slot | null {
  let worker: Worker;
  try {
    worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { markedPath: require.resolve('marked'), options: PARSE_OPTIONS, warmup: WARMUP_MARKDOWN },
    });
  } catch (error) {
    if (!spawnFailureLogged) {
      spawnFailureLogged = true;
      logger.error(`Markdown parse worker unavailable: ${(error as Error)?.message ?? error}`);
    }
    return null;
  }
  worker.unref();
  let markReady: () => void = () => undefined;
  const slot: Slot = {
    worker,
    busy: false,
    baselineCpuMs: 0,
    cpuClock: false,
    ready: new Promise<void>((resolve) => { markReady = resolve; }),
  };
  const onReady = (message: { ready?: boolean; cpuClock?: boolean; threadCpuMs?: number }) => {
    if (!message?.ready) return;
    slot.baselineCpuMs = Number(message.threadCpuMs) || 0;
    slot.cpuClock = message.cpuClock === true;
    worker.off('message', onReady);
    markReady();
  };
  worker.on('message', onReady);
  worker.on('error', (error) => {
    logger.warn(`Markdown parse worker stopped: ${error?.message ?? error}`);
  });
  worker.on('exit', () => {
    slots = slots.filter((candidate) => candidate !== slot);
    markReady();
  });
  slots.push(slot);
  return slot;
}

function dispatch(): void {
  while (queue.length > 0 && !closed) {
    let slot = slots.find((candidate) => !candidate.busy) ?? null;
    if (!slot && slots.length < WORKER_COUNT) slot = spawnSlot();
    if (!slot) {
      if (slots.length === 0) {
        // No worker can start: the callers keep the behaviour they had without the check.
        for (const pending of queue.splice(0)) pending.resolve({ status: 'unavailable', cpuMs: 0 });
      }
      return;
    }
    const pending = queue.shift()!;
    slot.busy = true;
    void runOnSlot(slot, pending.task).then((outcome) => {
      slot!.busy = false;
      pending.resolve(outcome);
      dispatch();
    });
  }
}

async function runOnSlot(slot: Slot, task: Task): Promise<MarkdownWorkerOutcome> {
  await slot.ready;
  if (!slots.includes(slot)) return { status: 'error', cpuMs: 0 };
  const worker = slot.worker as WorkerWithCpuUsage;
  const cpuBudgetMs = task.op === 'measure' ? task.budgetMs : RENDER_CPU_BUDGET_MS;
  return new Promise<MarkdownWorkerOutcome>((resolve) => {
    let settled = false;
    const startedAt = Date.now();
    const finish = (outcome: MarkdownWorkerOutcome, stop: boolean) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      worker.off('message', onMessage);
      worker.off('exit', onExit);
      if (stop) {
        slots = slots.filter((candidate) => candidate !== slot);
        void worker.terminate().catch(() => undefined);
      }
      resolve(outcome);
    };
    const onMessage = (reply: { status: MarkdownWorkerOutcome['status']; cpuMs: number; threadCpuMs: number; html?: string }) => {
      slot.baselineCpuMs = Number(reply.threadCpuMs) || slot.baselineCpuMs;
      finish({ status: reply.status, cpuMs: Number(reply.cpuMs) || 0, html: reply.html }, false);
    };
    const onExit = () => finish({ status: 'error', cpuMs: Date.now() - startedAt }, false);
    const poll = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      if (elapsed > WALL_BUDGET_MS) {
        finish({ status: 'time', cpuMs: elapsed }, true);
        return;
      }
      if (!slot.cpuClock || typeof worker.cpuUsage !== 'function') return;
      worker.cpuUsage().then((usage) => {
        const cpuMs = (usage.user + usage.system) / 1000 - slot.baselineCpuMs;
        if (cpuMs > cpuBudgetMs) finish({ status: 'time', cpuMs }, true);
      }, () => undefined);
    }, CPU_POLL_MS);
    poll.unref();
    worker.on('message', onMessage);
    worker.on('exit', onExit);
    worker.postMessage(task);
  });
}

function runTask(task: Task): Promise<MarkdownWorkerOutcome> {
  if (closed) return Promise.resolve({ status: 'unavailable', cpuMs: 0 });
  return new Promise((resolve) => {
    queue.push({ task, resolve });
    dispatch();
  });
}

/** Stops the workers (API shutdown). Pending checks resolve as unavailable. */
export async function closeMarkdownParseWorkers(): Promise<void> {
  closed = true;
  for (const pending of queue.splice(0)) pending.resolve({ status: 'unavailable', cpuMs: 0 });
  const stopping = slots.map((slot) => slot.worker.terminate().catch(() => undefined));
  slots = [];
  await Promise.all(stopping);
}

/** For specs: a fresh pool after `closeMarkdownParseWorkers`, and no remembered texts. */
export function resetMarkdownParseBudgetForTests(): void {
  closed = false;
  overBudgetKeys.clear();
}

// ---------------------------------------------------------------------------
// Checks.

function isOverBudget(outcome: MarkdownWorkerOutcome): boolean {
  return outcome.status === 'time' || outcome.status === 'stack';
}

function logOverBudget(fieldName: string, chars: number, outcome: MarkdownWorkerOutcome): void {
  logger.warn(
    `Markdown content over the parse budget: field=${fieldName} size=${Math.ceil(chars / 1024)}KB ` +
    `reason=${outcome.status === 'stack' ? 'nesting' : 'time'} cpu=${Math.round(outcome.cpuMs)}ms`,
  );
}

function collectParseTexts(
  values: unknown[],
  maxChars = Number.POSITIVE_INFINITY,
  minChars = MARKDOWN_PARSE_CHECK_MIN_CHARS,
): string[] {
  const texts: string[] = [];
  for (const value of values) {
    if (value == null) continue;
    const raw = String(value);
    if (raw.length < minChars) continue;
    const text = markdownParseText(raw);
    if (text.length < minChars || text.length > maxChars) continue;
    texts.push(text);
  }
  return texts;
}

/**
 * Measures each text in a worker and remembers those over the budget: the parser
 * then refuses them (`assertWithinMarkdownParseBudget`). Never throws. Returns
 * whether every text is within the budget.
 */
export async function noteMarkdownParseBudget(
  values: unknown[],
  opts?: { fieldName?: string; maxChars?: number },
): Promise<boolean> {
  const texts = collectParseTexts(values, opts?.maxChars);
  if (texts.length === 0) return true;
  const outcomes = await Promise.all(
    texts.map((text) => runTask({ op: 'measure', texts: [text], budgetMs: MARKDOWN_PARSE_BUDGET_MS })),
  );
  let allWithin = true;
  outcomes.forEach((outcome, index) => {
    if (!isOverBudget(outcome)) return;
    allWithin = false;
    rememberOverBudget(texts[index]);
    logger.debug(`Text over the Markdown parse budget: field=${opts?.fieldName ?? 'content'} size=${Math.ceil(texts[index].length / 1024)}KB`);
  });
  return allWithin;
}

/**
 * Refuses with a 400 `MARKDOWN_TOO_COMPLEX` texts the parser could not handle
 * within the budget, all of them together (`budgetMs`, by default one text's).
 */
export async function assertMarkdownParseBudget(
  values: unknown | unknown[],
  fieldName = 'content',
  opts?: { budgetMs?: number; minChars?: number },
): Promise<void> {
  const list = Array.isArray(values) ? values : [values];
  const texts = collectParseTexts(list, Number.POSITIVE_INFINITY, opts?.minChars);
  if (texts.length === 0) return;
  const outcome = await runTask({ op: 'measure', texts, budgetMs: opts?.budgetMs ?? MARKDOWN_PARSE_BUDGET_MS });
  if (!isOverBudget(outcome)) return;
  texts.forEach(rememberOverBudget);
  logOverBudget(fieldName, texts.reduce((sum, text) => sum + text.length, 0), outcome);
  throw markdownTooComplexError(fieldName);
}

/**
 * The HTML of a Markdown text, rendered in a worker with the options of the main
 * thread: `ok` with the HTML, `over_budget` when the parser does not finish within
 * the budget (or fails), `unavailable` when no worker can start.
 */
export async function renderMarkdownInWorker(
  text: string,
): Promise<{ status: 'ok'; html: string } | { status: 'over_budget' | 'unavailable' }> {
  const outcome = await runTask({ op: 'render', text });
  if (outcome.status === 'ok' && typeof outcome.html === 'string') return { status: 'ok', html: outcome.html };
  if (outcome.status === 'unavailable') return { status: 'unavailable' };
  logOverBudget('render', text.length, outcome);
  return { status: 'over_budget' };
}

/** Every string of a JSON value, without recursion (bodies can nest deeply). */
export function collectJsonStrings(value: unknown, minChars = MARKDOWN_PARSE_CHECK_MIN_CHARS): string[] {
  const found: string[] = [];
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current === 'string') {
      if (current.length >= minChars) found.push(current);
    } else if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index -= 1) stack.push(current[index]);
    } else if (current && typeof current === 'object') {
      const values = Object.values(current as Record<string, unknown>);
      for (let index = values.length - 1; index >= 0; index -= 1) stack.push(values[index]);
    }
  }
  return found;
}
