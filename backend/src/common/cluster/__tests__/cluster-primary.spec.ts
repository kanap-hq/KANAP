import * as assert from 'node:assert/strict';
import type { Cluster, Worker } from 'node:cluster';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runClusterPrimary } from '../cluster-primary';
import { apiProcessCount, clusterWorkerId, isLeadProcess, parseApiWorkers, processLabel } from '../process-role';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const cluster: Cluster = require('node:cluster');

/**
 * API_WORKERS > 1 (plan planning/perf-scale lot 4A): the entrypoint becomes a cluster primary.
 * It forks one worker per slot with its id, forks a dead worker again in the same slot, stops
 * after a crash loop so the container restart policy takes over, and on a stop forwards SIGTERM
 * and waits for the workers to drain (killing one that does not stop in time).
 */

const dir = mkdtempSync(join(tmpdir(), 'kanap-cluster-spec-'));
const exec = join(dir, 'worker.js');
/**
 * Each worker that finished its drain appends its slot id here, synchronously, before it exits.
 * Node does not promise to deliver an IPC message sent right before process.exit; a file write
 * that returned is there.
 */
const drainLog = join(dir, 'drained.log');

/**
 * The worker says it is ready only once its handlers are installed: the primary can read the
 * message before the worker runs its next line, and a SIGTERM that arrives before the handler
 * kills the worker without a drain.
 */
const WORKER = `
const fs = require('node:fs');
const id = process.env.KANAP_WORKER_ID;
let ignoreTerm = false;
process.on('message', (m) => {
  if (m === 'crash') process.exit(3);
  if (m === 'ignore-term') { ignoreTerm = true; process.send({ type: 'ignoring-term', id }); }
});
process.on('SIGTERM', () => {
  if (ignoreTerm) return;
  setTimeout(() => { fs.appendFileSync(${JSON.stringify(drainLog)}, id + '\\n'); process.exit(0); }, 150);
});
setInterval(() => {}, 1000);
process.send({ type: 'ready', id, count: process.env.KANAP_WORKER_COUNT, startedAt: process.env.KANAP_CLUSTER_STARTED_AT });
`;
writeFileSync(exec, WORKER);

type Event = { type: string; id: string; count?: string; startedAt?: string; workerId: number };
const events: Event[] = [];
cluster.on('message', (worker: Worker, message: any) => events.push({ ...message, workerId: worker.id }));
type Exit = { workerId: number; code: number | null; signal: string | null };
const exits: Exit[] = [];
cluster.on('exit', (worker: Worker, code: number | null, signal: string | null) => exits.push({ workerId: worker.id, code, signal }));

function drained(): string[] {
  return readFileSync(drainLog, 'utf8').split('\n').filter(Boolean).sort();
}

async function waitFor<T>(what: string, check: () => T | undefined | false, timeoutMs = 10_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function workerInSlot(slot: number): Worker {
  const found = Object.values(cluster.workers ?? {}).find((w) => w && !w.isDead() && readySlotOf(w) === slot);
  if (!found) throw new Error(`no live worker in slot ${slot}`);
  return found;
}

function readySlotOf(worker: Worker): number | null {
  const ready = events.filter((e) => e.type === 'ready' && e.workerId === worker.id).pop();
  return ready ? Number(ready.id) : null;
}

async function testForksSlotsRestartsAndDrains() {
  events.length = 0;
  exits.length = 0;
  writeFileSync(drainLog, '');
  const lines: string[] = [];
  let exitCode: number | null = null;
  const primary = runClusterPrimary({
    workers: 2, exec, restartDelayMs: 50, stopTimeoutMs: 3_000,
    log: (line) => lines.push(line), exit: (code) => { exitCode = code; }, handleSignals: false,
  });
  await waitFor('two workers ready', () => events.filter((e) => e.type === 'ready').length >= 2);
  const ready = events.filter((e) => e.type === 'ready');
  assert.deepEqual(ready.map((e) => e.id).sort(), ['1', '2'], 'one worker per slot, ids 1 and 2');
  assert.ok(ready.every((e) => e.count === '2'), 'every worker knows the worker count');
  assert.equal(new Set(ready.map((e) => e.startedAt)).size, 1, 'every worker gets the same cluster start');
  assert.deepEqual(primary.slots(), [1, 2]);

  workerInSlot(1).send('crash');
  await waitFor('slot 1 forked again', () => events.filter((e) => e.type === 'ready' && e.id === '1').length >= 2);
  assert.ok(lines.some((l) => /worker 1 .* exited \(code 3\)/.test(l)), 'the crash is logged');
  assert.deepEqual(primary.slots(), [1, 2], 'the dead worker is replaced in its slot');

  const exitsBeforeStop = exits.length;
  const stopStarted = Date.now();
  primary.stop('test stop');
  await waitFor('cluster stopped', () => exitCode !== null);
  assert.equal(exitCode, 0);
  // A worker that skipped its drain would die from the SIGTERM, or be killed at stopTimeoutMs.
  assert.deepEqual(exits.slice(exitsBeforeStop).map((e) => ({ code: e.code, signal: e.signal })),
    [{ code: 0, signal: null }, { code: 0, signal: null }], 'both workers exited on their own, none killed');
  assert.deepEqual(drained(), ['1', '2'], 'both workers finished their work before exiting');
  assert.ok(Date.now() - stopStarted >= 150, 'the primary waited for the drain');
  assert.deepEqual(primary.slots(), []);
}

async function testKillsAWorkerThatDoesNotStop() {
  events.length = 0;
  exits.length = 0;
  const lines: string[] = [];
  let exitCode: number | null = null;
  const primary = runClusterPrimary({
    workers: 1, exec, stopTimeoutMs: 300,
    log: (line) => lines.push(line), exit: (code) => { exitCode = code; }, handleSignals: false,
  });
  await waitFor('worker ready', () => events.some((e) => e.type === 'ready'));
  workerInSlot(1).send('ignore-term');
  await waitFor('worker ignores SIGTERM', () => events.some((e) => e.type === 'ignoring-term'));
  primary.stop('test stop');
  await waitFor('cluster stopped', () => exitCode !== null);
  assert.ok(lines.some((l) => /still running after .*: killed/.test(l)), 'a worker past the stop time is killed');
  assert.deepEqual(exits.map((e) => e.signal), ['SIGKILL'], 'the worker died from the kill');
}

async function testCrashLoopStopsTheCluster() {
  events.length = 0;
  let exitCode: number | null = null;
  runClusterPrimary({
    workers: 1, exec, restartDelayMs: 20, crashLimit: 2, crashWindowMs: 10_000, stopTimeoutMs: 1_000,
    log: () => undefined, exit: (code) => { exitCode = code; }, handleSignals: false,
  });
  await waitFor('worker ready', () => events.some((e) => e.type === 'ready'));
  workerInSlot(1).send('crash');
  await waitFor('worker forked again', () => events.filter((e) => e.type === 'ready').length >= 2);
  workerInSlot(1).send('crash');
  await waitFor('cluster stopped', () => exitCode !== null);
  assert.equal(exitCode, 1, 'a crash loop ends the cluster with exit code 1 (the container restarts it)');
}

function testProcessRole() {
  assert.equal(parseApiWorkers(undefined), 1);
  assert.equal(parseApiWorkers(''), 1);
  assert.equal(parseApiWorkers('0'), 1);
  assert.equal(parseApiWorkers('-2'), 1);
  assert.equal(parseApiWorkers('2.5'), 1);
  assert.equal(parseApiWorkers('abc'), 1);
  assert.equal(parseApiWorkers(' 4 '), 4);
  assert.equal(parseApiWorkers('99'), 16, 'capped at 16');
  const single = {} as NodeJS.ProcessEnv;
  assert.equal(clusterWorkerId(single), null);
  assert.equal(apiProcessCount(single), 1);
  assert.equal(isLeadProcess(single), true);
  assert.equal(processLabel(single), 'api');
  const second = { KANAP_WORKER_ID: '2', KANAP_WORKER_COUNT: '4' } as NodeJS.ProcessEnv;
  assert.equal(clusterWorkerId(second), 2);
  assert.equal(apiProcessCount(second), 4);
  assert.equal(isLeadProcess(second), false);
  assert.equal(processLabel(second), 'worker 2/4');
  assert.equal(isLeadProcess({ KANAP_WORKER_ID: '1', KANAP_WORKER_COUNT: '4' } as NodeJS.ProcessEnv), true);
  // API_WORKERS alone (the primary's setting) does not make this process a worker.
  assert.equal(apiProcessCount({ API_WORKERS: '4' } as NodeJS.ProcessEnv), 1);
}

async function run() {
  testProcessRole();
  await testForksSlotsRestartsAndDrains();
  await testKillsAWorkerThatDoesNotStop();
  await testCrashLoopStopsTheCluster();
  console.log('cluster-primary.spec: ok');
}

run()
  .then(() => {
    rmSync(dir, { recursive: true, force: true });
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    for (const worker of Object.values(cluster.workers ?? {})) worker?.process.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
    process.exit(1);
  });
