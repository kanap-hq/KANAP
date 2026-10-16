import {
  BadRequestException,
  HttpException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import { Features } from '../config/features';
import { renderCommentForEmail, RenderedCommentForEmail } from '../notifications/comment-email-renderer';
import { readPoolMax } from './db-pool-budget';
import type { ImportedImageReference } from './document-import-markdown';
import { sanitizeRichHtmlForEmail } from './html-sanitizer';
import { assertMarkdownSize } from './markdown-limits';
import { currentRequestContext } from './tenancy/request-tenant-context';
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
 * - Each call has a key: the user of the request (tenant and user id), else
 *   its tenant, else `system`. Users share the workers fairly, within a tenant
 *   too (a single-tenant server has one tenant).
 * - A key has `KEY_RUNNING_MAX` calls running at most (the workers less one),
 *   so one user never holds every worker: a worker that frees up skips the
 *   calls of a key at that cap, and takes the call of another key or stays
 *   free for the next one. Among the calls it may take, it takes the one whose
 *   key has the fewest calls running, the oldest at equal count. Two users
 *   with heavy texts can still use every worker. The key `system` has no cap.
 * - Only a call that cannot start at once meets the caps of the queue:
 *   `KEY_WAITING_MAX` calls of one key waiting, and `queueLimit()` calls of
 *   requests waiting in all (a request holds its database connection while it
 *   waits). Past them, and past `QUEUE_WAIT_MS` of waiting, a call is refused
 *   with a 503 `MARKDOWN_BUSY` (with Retry-After).
 * - Emails and background tasks (no request waits on them, they hold no
 *   connection of a request) have the key `system`, are free of the caps of a
 *   key and wait up to `SYSTEM_WAIT_MS`; an email then falls back to plain text.
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
/** How long a call of a request may wait for a free worker while the workers are running. */
export const QUEUE_WAIT_MS = 1000;
/** How long an email or a background task may wait for a free worker. */
const SYSTEM_WAIT_MS = 5000;
/** Calls of one key (a user, else a tenant) running at most: one worker always stays for the other keys. */
const KEY_RUNNING_MAX = Math.max(1, WORKER_COUNT - 1);
/** Calls of one key (a user, else a tenant) waiting at most. */
const KEY_WAITING_MAX = 2;
/** Emails and background tasks waiting at most: a burst of them cannot grow the queue without end. */
const SYSTEM_WAITING_MAX = 32;
/** Key of the calls sent outside a request, and of emails. */
const SYSTEM_KEY = 'system';
/** Seconds the client waits before sending again a call refused for a busy pool. */
export const MARKDOWN_BUSY_RETRY_AFTER_SECONDS = 1;
/** Refusals for a busy pool are logged once per window, with their count. */
const BUSY_LOG_WINDOW_MS = 60_000;
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
  /** Sent as the Retry-After header (release-tenant-runner.filter.ts). */
  readonly retryAfterSeconds = MARKDOWN_BUSY_RETRY_AFTER_SECONDS;

  constructor() {
    super({
      code: MARKDOWN_BUSY,
      message: 'The server is busy with other texts. Try again in a moment.',
    });
  }
}

export class MarkdownUnavailableException extends ServiceUnavailableException {
  constructor() {
    // On-premise, the administrator of the server can act on it; in the cloud, the service restarts its workers.
    const onPremise = Features.SINGLE_TENANT;
    super({
      code: MARKDOWN_UNAVAILABLE,
      message: onPremise
        ? 'Formatted texts cannot be saved on this server right now. Ask your administrator to check the API logs.'
        : 'Formatted texts cannot be saved right now. Try again in a few minutes.',
      ...(onPremise ? { variant: 'onprem' } : {}),
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

type SubmitOptions = MarkdownWorkOptions & {
  /** Time budget of the call, when it does the work of several calls (default `MARKDOWN_WORK_TIMEOUT_MS`). */
  timeoutMs?: number;
  /** An email: key `system`, free of the caps of a key, even when sent during a request. */
  background?: boolean;
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
  /** Fair-share key: the user of the request (tenant and user id), else its tenant, else `system`. */
  key: string;
  /** A call of a request: it holds the request's database connection while it waits, the caps apply. */
  capped: boolean;
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
/** Calls waiting for a worker, oldest first. */
const queue: Task[] = [];
/** Calls of requests waiting, per key and in all; calls running per key. */
const waitingByKey = new Map<string, number>();
const runningByKey = new Map<string, number>();
let cappedWaiting = 0;
let systemWaiting = 0;
let queueMax = 0;
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

/**
 * Calls of requests waiting at most. A request holds its database connection
 * while it waits: with the calls running, half the database pool of the
 * process, and never fewer than the workers plus 2, so that the calls of
 * several keys can wait with a small pool (each key waits `KEY_WAITING_MAX`
 * at most).
 */
export function markdownQueueLimit(poolMax: number = readPoolMax()): number {
  return Math.max(WORKER_COUNT + 2, Math.floor(poolMax / 2) - WORKER_COUNT);
}

function queueLimit(): number {
  if (!queueMax) queueMax = markdownQueueLimit();
  return queueMax;
}

/** The fair-share key of a call, and whether it is a call of a request (the caps apply). */
function shareKeyOf(background: boolean): { key: string; capped: boolean } {
  const context = background ? null : currentRequestContext();
  if (!context) return { key: SYSTEM_KEY, capped: false };
  if (context.userId) return { key: `user:${context.tenantId ?? ''}:${context.userId}`, capped: true };
  if (context.tenantId) return { key: `tenant:${context.tenantId}`, capped: true };
  return { key: SYSTEM_KEY, capped: true };
}

function addCount(counts: Map<string, number>, key: string, delta: number): void {
  const next = (counts.get(key) ?? 0) + delta;
  if (next > 0) counts.set(key, next);
  else counts.delete(key);
}

function enqueue(task: Task): void {
  queue.push(task);
  if (task.capped) {
    addCount(waitingByKey, task.key, 1);
    cappedWaiting += 1;
  } else {
    systemWaiting += 1;
  }
}

function takeFromQueue(index: number): Task {
  const [task] = queue.splice(index, 1);
  if (task.waitTimer) clearTimeout(task.waitTimer);
  task.waitTimer = null;
  if (task.capped) {
    addCount(waitingByKey, task.key, -1);
    cappedWaiting -= 1;
  } else {
    systemWaiting -= 1;
  }
  return task;
}

/** Empties the queue (no worker can start, shutdown) and refuses its calls. */
function refuseQueue(error: () => unknown): void {
  while (queue.length > 0) takeFromQueue(0).reject(error());
}

/** A running call is over (answered, stopped or refused). */
function endRun(task: Task): void {
  addCount(runningByKey, task.key, -1);
}

let busyWindowStart = 0;
let busyCount = 0;

/** Logs a refusal for a busy pool: the first of a 60 s window, then their count at its end. */
function logBusy(op: string, fieldName: string, reason: 'key' | 'queue' | 'wait'): void {
  const now = Date.now();
  if (busyWindowStart && now - busyWindowStart < BUSY_LOG_WINDOW_MS) {
    busyCount += 1;
    return;
  }
  busyWindowStart = now;
  busyCount = 0;
  logger.warn(`Text not processed: op=${op} field=${fieldName} reason=busy (${reason}); further refusals are counted for 60 s.`);
  setTimeout(() => {
    if (busyCount > 0) logger.warn(`Texts not processed for a busy pool in the last 60 s: ${busyCount} more.`);
    busyCount = 0;
  }, BUSY_LOG_WINDOW_MS).unref();
}

/**
 * Node options of a worker: those of the process, without the compile hook the
 * development server (ts-node-dev) preloads. That hook compiles through the
 * server's process and waits for it, which a worker thread cannot do: the
 * worker registers ts-node itself (BOOTSTRAP).
 */
function workerExecArgv(): string[] | undefined {
  const args = process.execArgv;
  const kept: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if ((arg === '-r' || arg === '--require') && /ts-node-dev/.test(args[index + 1] ?? '')) {
      index += 1;
      continue;
    }
    if (/^(?:-r|--require)=.*ts-node-dev/.test(arg)) continue;
    kept.push(arg);
  }
  return kept.length === args.length ? undefined : kept;
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
      execArgv: workerExecArgv(),
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
  worker.on('message', (message: MarkdownWorkerReply | { ready: true; sources?: string[] }) => onMessage(slot, message));
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
  refuseQueue(() => new MarkdownUnavailableException());
  notifyReady(false);
}

function onExit(slot: Slot): void {
  if (slot.stopped) return;
  const wasReady = slot.ready;
  const task = slot.task;
  slot.task = null;
  removeSlot(slot);
  if (task) {
    endRun(task);
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

/**
 * Development server (ts-node-dev): it restarts when a module the API loaded
 * changes, and learns of them from the API process. The modules only the workers
 * load are reported to it the same way, so a change there restarts it too.
 */
function watchWorkerSources(sources: string[] | undefined): void {
  if (!sources?.length || !process.env.TS_NODE_DEV || typeof process.send !== 'function') return;
  for (const file of sources) {
    if (!require.cache[file]) process.send({ cmd: 'NODE_DEV', required: file });
  }
}

function onMessage(slot: Slot, message: MarkdownWorkerReply | { ready: true; sources?: string[] }): void {
  if (!slot.ready) {
    if (!('ready' in message) || message.ready !== true) return;
    slot.ready = true;
    watchWorkerSources(message.sources);
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
  endRun(task);
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
  addCount(runningByKey, task.key, 1);
  slot.startedAt = performance.now();
  slot.worker.ref();
  slot.runTimer = setTimeout(() => {
    if (slot.task !== task) return;
    slot.task = null;
    endRun(task);
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
    endRun(task);
    task.reject(error);
    // The worker is free again: it takes the next call.
    setImmediate(dispatch);
  }
}

/** Whether a call may start now: its key is under its cap of calls running (`system` has none). */
function mayStart(task: Task): boolean {
  return task.key === SYSTEM_KEY || (runningByKey.get(task.key) ?? 0) < KEY_RUNNING_MAX;
}

/**
 * The waiting call a free worker takes, or -1: among the calls that may start, the one of the
 * key with the fewest calls running, the oldest at equal count.
 */
function nextTaskIndex(): number {
  let best = -1;
  let bestRunning = Number.POSITIVE_INFINITY;
  for (let index = 0; index < queue.length; index += 1) {
    if (!mayStart(queue[index])) continue;
    const running = runningByKey.get(queue[index].key) ?? 0;
    if (running < bestRunning) {
      best = index;
      bestRunning = running;
      if (running === 0) break;
    }
  }
  return best;
}

/** Gives every free worker a waiting call that may start. Afterwards, a free worker means no such call waits. */
function dispatch(): void {
  if (closed) return;
  for (const slot of slots) {
    if (queue.length === 0) return;
    if (!slot.ready || slot.task) continue;
    const index = nextTaskIndex();
    if (index === -1) return;
    runOnSlot(slot, takeFromQueue(index));
  }
}

function hasFreeWorker(): boolean {
  return slots.some((slot) => slot.ready && !slot.task);
}

function armWaitTimer(task: Task, delayMs: number): void {
  task.waitTimer = setTimeout(() => onWaitTimeout(task), delayMs);
}

function onWaitTimeout(task: Task): void {
  if (!queue.includes(task)) return;
  if (!slots.some((slot) => slot.ready)) {
    // The workers are starting: the start timeout bounds this wait.
    armWaitTimer(task, QUEUE_WAIT_MS);
    return;
  }
  dispatch();
  if (!queue.includes(task)) return;
  takeFromQueue(queue.indexOf(task));
  logBusy(task.op, task.fieldName, 'wait');
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
  opts?: SubmitOptions,
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
    const timeoutMs = Math.min(
      opts?.timeoutMs ?? MARKDOWN_WORK_TIMEOUT_MS,
      opts?.budget ? opts.budget.remainingMs : Number.POSITIVE_INFINITY,
    );
    const { key, capped } = shareKeyOf(opts?.background === true);
    const task: Task = {
      op,
      args,
      fieldName,
      chars: textLength(args),
      timeoutMs,
      budget: opts?.budget,
      key,
      capped,
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
    if (!hasFreeWorker() || !mayStart(task)) {
      // The call has to wait (no free worker, or its key at its cap of calls running): the caps apply.
      const overCap = capped
        ? ((waitingByKey.get(key) ?? 0) >= KEY_WAITING_MAX ? 'key' : cappedWaiting >= queueLimit() ? 'queue' : null)
        : (systemWaiting >= SYSTEM_WAITING_MAX ? 'queue' : null);
      if (overCap) {
        logBusy(op, fieldName, overCap);
        refuse(new MarkdownBusyException());
        return;
      }
    }
    enqueue(task);
    dispatch();
    if (queue.includes(task)) armWaitTimer(task, capped ? QUEUE_WAIT_MS : SYSTEM_WAIT_MS);
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
  refuseQueue(() => new MarkdownUnavailableException());
  const stopping = slots.map((slot) => {
    const task = slot.task;
    slot.task = null;
    if (task) {
      endRun(task);
      task.reject(new MarkdownUnavailableException());
    }
    slot.stopped = true;
    if (slot.runTimer) clearTimeout(slot.runTimer);
    if (slot.startTimer) clearTimeout(slot.startTimer);
    return slot.worker.terminate().catch(() => undefined);
  });
  slots = [];
  notifyReady(false);
  await Promise.all(stopping);
}

/**
 * State of the workers for the health route: `ready` (at least one worker
 * answers), `starting`, or `unavailable` (none could start, or the API stops).
 */
export function markdownWorkersStatus(): 'ready' | 'starting' | 'unavailable' {
  if (closed || unavailable) return 'unavailable';
  return slots.some((slot) => slot.ready) ? 'ready' : 'starting';
}

/** For specs: a pool that may start again after `closeMarkdownWorkers`. */
export function reopenMarkdownWorkersForTests(): void {
  closed = false;
  restartAt = 0;
}

/** For specs: resolves once every worker of the pool has started and none runs a call. */
export async function idleMarkdownWorkersForTests(): Promise<void> {
  for (let waited = 0; waited < 30_000; waited += 20) {
    ensurePool();
    if (slots.length === WORKER_COUNT && slots.every((slot) => slot.ready && !slot.task) && queue.length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('The Markdown workers did not become idle');
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

/**
 * `normalizeMarkdownRichText` and the search text of the result, in one call of
 * the workers (a document save). A stored content the workers cannot process in
 * time is kept as it is, and indexed with its spaces collapsed.
 */
export async function normalizeMarkdownWithSearchText(
  value: unknown,
  opts?: NormalizeOptions,
): Promise<{ content: string | null; searchText: string }> {
  const text = value == null ? '' : String(value).trim();
  if (!text) return { content: null, searchText: '' };
  const fieldName = opts?.fieldName || 'content';
  const enforceSizeLimit = opts?.enforceSizeLimit !== false;
  if (enforceSizeLimit) assertMarkdownSize(text, fieldName);
  try {
    // The work of two calls (normalization, then search text), with the budget of two: a document
    // accepted when they were two calls is accepted still.
    return await submit(
      'normalizeWithSearchText',
      [text, { fieldName, enforceSizeLimit }],
      { ...opts, fieldName, timeoutMs: 2 * MARKDOWN_WORK_TIMEOUT_MS },
    );
  } catch (error) {
    if (!enforceSizeLimit && isMarkdownTooComplex(error)) {
      return { content: text, searchText: text.replace(/\s+/g, ' ').trim() };
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
    return await submit('emailHtml', [text], { fieldName: 'email', background: true });
  } catch {
    return renderPlainTextEmailHtml(text);
  }
}

/**
 * A stored comment as the HTML and the text preview of an email, with links made
 * absolute. Never rejects: a comment the workers cannot render is shown as plain text.
 */
export async function renderCommentEmail(
  content: string,
  tenantBaseUrl: string,
  tenantSlug: string | null,
): Promise<RenderedCommentForEmail> {
  const text = String(content || '').trim();
  if (text) {
    try {
      return await submit('commentEmail', [text, tenantBaseUrl, tenantSlug], { fieldName: 'email', background: true });
    } catch {
      // Plain text below.
    }
  }
  return renderCommentForEmail({
    commentHtml: renderPlainTextEmailHtml(text),
    tenantBaseUrl,
    tenantSlug,
    sanitized: true,
  });
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
