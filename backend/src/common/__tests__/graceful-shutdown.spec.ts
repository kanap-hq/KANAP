import * as assert from 'node:assert/strict';
import { createServer, request, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { installGracefulShutdown, readDrainTimeoutMs } from '../graceful-shutdown';

/**
 * Stop of an API process (graceful-shutdown.ts): the server stops accepting at once, the
 * requests in flight finish and get their answer, keep-alive connections do not hold the stop,
 * then the app closes and the process exits 0. A request still running past the drain time is
 * cut: exit 1.
 */

function startServer(handlerDelayMs: number): Promise<Server> {
  const server = createServer((req, res) => {
    setTimeout(() => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('done'); }, req.url === '/slow' ? handlerDelayMs : 0);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function get(port: number, path: string, agent?: any): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, agent }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function testInFlightRequestFinishesThenExit0() {
  const server = await startServer(300);
  const port = (server.address() as AddressInfo).port;
  const exits: number[] = [];
  let closed = false;
  let beforeDrain = false;
  const { shutdown } = installGracefulShutdown({
    server,
    signals: [],
    drainTimeoutMs: 5_000,
    log: () => undefined,
    exit: (code) => exits.push(code),
    beforeDrain: () => { beforeDrain = true; },
    close: async () => { closed = true; },
  });
  // A keep-alive client holding an idle connection must not hold the stop.
  const { Agent } = await import('node:http');
  const keepAlive = new Agent({ keepAlive: true });
  assert.equal((await get(port, '/fast', keepAlive)).status, 200);

  const inFlight = get(port, '/slow');
  await new Promise((resolve) => setTimeout(resolve, 50));
  const stopping = shutdown('SIGTERM');
  assert.equal(beforeDrain, true, 'background work is stopped at the signal');
  await assert.rejects(() => get(port, '/fast'), /ECONNREFUSED|ECONNRESET|socket hang up/, 'no new connection once the stop started');
  const answer = await inFlight;
  assert.deepEqual(answer, { status: 200, body: 'done' }, 'the request in flight got its answer');
  await stopping;
  assert.equal(closed, true, 'the app is closed after the drain');
  assert.deepEqual(exits, [0]);
  keepAlive.destroy();
}

/**
 * A large body still in the process's write buffer when its response has ended: Node already
 * counts the connection as idle. Closing idle connections then cut it (seen on a 16 MB CSV export
 * during `docker stop`). The client here reads slowly, through a keep-alive agent.
 */
async function testLargeResponseIsNotCut() {
  const big = 'x'.repeat(16 * 1024 * 1024);
  const server = createServer((_req, res) => {
    setTimeout(() => { res.setHeader('content-type', 'text/plain'); res.end(big); }, 300);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  const exits: number[] = [];
  const { shutdown } = installGracefulShutdown({
    server, signals: [], drainTimeoutMs: 10_000, log: () => undefined,
    exit: (code) => exits.push(code), close: async () => undefined,
  });
  const { Agent } = await import('node:http');
  const agent = new Agent({ keepAlive: true });
  const received = new Promise<{ bytes: number; complete: boolean }>((resolve) => {
    const req = request({ host: '127.0.0.1', port, path: '/', agent }, (res) => {
      let bytes = 0;
      res.pause();
      setTimeout(() => res.resume(), 800);
      res.on('data', (chunk) => { bytes += chunk.length; });
      res.on('close', () => resolve({ bytes, complete: res.complete }));
    });
    req.on('error', () => resolve({ bytes: -1, complete: false }));
    req.end();
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const stopping = shutdown('SIGTERM');
  const got = await received;
  await stopping;
  assert.deepEqual(got, { bytes: big.length, complete: true }, 'the whole body arrived');
  assert.deepEqual(exits, [0]);
  agent.destroy();
}

/**
 * After the last response, a short grace lets the work it started without awaiting get going
 * (a notification chain); `close` then gets the deadline for the work left, 2 s before the end of
 * the drain time. With no recent response there is no grace.
 */
async function testGraceAfterLastResponseThenDeadline() {
  const server = await startServer(100);
  const port = (server.address() as AddressInfo).port;
  let closeAt = 0;
  let deadline = 0;
  const { shutdown } = installGracefulShutdown({
    server, signals: [], drainTimeoutMs: 10_000, graceMs: 400, log: () => undefined,
    exit: () => undefined,
    close: async (deadlineAt) => { closeAt = Date.now(); deadline = deadlineAt; },
  });
  const inFlight = get(port, '/slow');
  await new Promise((resolve) => setTimeout(resolve, 20));
  const t0 = Date.now();
  const stopping = shutdown('SIGTERM');
  const t0After = Date.now();
  await stopping;
  await inFlight;
  assert.ok(closeAt - t0 >= 450, `close waits the grace after the last response (${closeAt - t0} ms)`);
  assert.ok(deadline >= t0 + 8_000 && deadline <= t0After + 8_000, 'close gets the drain time minus 2 s as its deadline');

  const idle = await startServer(0);
  let idleCloseAt = 0;
  const idleStop = installGracefulShutdown({
    server: idle, signals: [], drainTimeoutMs: 10_000, graceMs: 2_000, log: () => undefined,
    exit: () => undefined, close: async () => { idleCloseAt = Date.now(); },
  });
  // Timers fire in the order they expire, however late a loaded machine runs them: a stop that
  // waited the 2 s grace would end after this 1 s timer.
  const stopped = idleStop.shutdown('SIGTERM').then(() => 'stopped' as const);
  let lateTimer: NodeJS.Timeout | undefined;
  const late = new Promise<'late'>((resolve) => { lateTimer = setTimeout(() => resolve('late'), 1_000); });
  const first = await Promise.race([stopped, late]);
  clearTimeout(lateTimer);
  assert.equal(first, 'stopped', 'no request: no grace');
  assert.ok(idleCloseAt > 0, 'close was called');
}

async function testDrainTimeoutExits1() {
  const server = await startServer(2_000);
  const port = (server.address() as AddressInfo).port;
  const exits: number[] = [];
  const { shutdown } = installGracefulShutdown({
    server,
    signals: [],
    drainTimeoutMs: 200,
    log: () => undefined,
    exit: (code) => exits.push(code),
    close: async () => undefined,
  });
  const inFlight = get(port, '/slow').catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 50));
  void shutdown('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.deepEqual(exits, [1], 'a request past the drain time is cut: exit 1');
  server.closeAllConnections();
  await inFlight;
}

function testDrainTimeoutSetting() {
  assert.equal(readDrainTimeoutMs({} as NodeJS.ProcessEnv), 20_000);
  assert.equal(readDrainTimeoutMs({ SHUTDOWN_DRAIN_TIMEOUT_MS: '5000' } as NodeJS.ProcessEnv), 5_000);
  assert.equal(readDrainTimeoutMs({ SHUTDOWN_DRAIN_TIMEOUT_MS: 'abc' } as NodeJS.ProcessEnv), 20_000);
  assert.equal(readDrainTimeoutMs({ SHUTDOWN_DRAIN_TIMEOUT_MS: '999999' } as NodeJS.ProcessEnv), 120_000);
}

async function run() {
  testDrainTimeoutSetting();
  await testInFlightRequestFinishesThenExit0();
  await testLargeResponseIsNotCut();
  await testGraceAfterLastResponseThenDeadline();
  await testDrainTimeoutExits1();
  console.log('graceful-shutdown.spec: ok');
}

run().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
