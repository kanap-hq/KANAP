import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { WorldBankClient } from '../world-bank-client';

/**
 * WB_RETRY_DELAY_MS, a positive number of milliseconds, is the base delay of
 * every retry. The wait is that base times the attempt number. Unset, or not
 * a positive number, the spot quote keeps 1.5 s, the CSV download 2 s and any
 * other request 1 s. Short timers are fired at once, so the spec does not wait.
 */

const ENV_KEYS = ['WB_RETRY_DELAY_MS', 'WB_CSV_URL', 'WB_CACHE_DIR', 'FX_SPOT_BASE_URL'] as const;

const delays: number[] = [];
const originalSetTimeout = global.setTimeout;
global.setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
  const delay = typeof ms === 'number' ? ms : 0;
  // The request timeouts are 15 s and 60 s. A retry wait is shorter, and the
  // spec records it and lets it elapse immediately.
  if (typeof fn === 'function' && delay > 0 && delay < 10000) {
    delays.push(delay);
    return originalSetTimeout(fn, 0, ...args);
  }
  return originalSetTimeout(fn as any, ms as any, ...args);
}) as typeof setTimeout;

function restoreEnv(snapshot: Map<string, string | undefined>) {
  for (const key of ENV_KEYS) {
    const value = snapshot.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function silent(client: WorldBankClient) {
  (client as any).logger = { warn() {}, log() {}, debug() {}, error() {}, verbose() {}, fatal() {} };
}

async function refusedOrigin(): Promise<string> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await new Promise<void>((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      reject(new Error(`127.0.0.1:${port} accepted a connection`));
    });
    socket.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ECONNREFUSED') resolve();
      else reject(err);
    });
  });
  return `http://127.0.0.1:${port}`;
}

async function withClient(retryDelay: string | undefined, origin: string, cacheDir: string, run: (client: WorldBankClient) => Promise<void>) {
  const snapshot = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  if (retryDelay === undefined) delete process.env.WB_RETRY_DELAY_MS;
  else process.env.WB_RETRY_DELAY_MS = retryDelay;
  process.env.FX_SPOT_BASE_URL = `${origin}/latest`;
  process.env.WB_CSV_URL = `${origin}/wb.csv`;
  process.env.WB_CACHE_DIR = cacheDir;
  try {
    const client = new WorldBankClient();
    silent(client);
    await run(client);
  } finally {
    restoreEnv(snapshot);
  }
}

function takenSince(mark: number): number[] {
  return delays.slice(mark);
}

async function spotDelays(retryDelay: string | undefined, origin: string, cacheDir: string): Promise<number[]> {
  let seen: number[] = [];
  await withClient(retryDelay, origin, cacheDir, async (client) => {
    const mark = delays.length;
    const rate = await client.fetchSpotRate('EUR');
    assert.equal(rate, null, 'a refused spot source yields no rate');
    seen = takenSince(mark);
  });
  return seen;
}

async function csvDelays(retryDelay: string | undefined, origin: string, cacheDir: string): Promise<number[]> {
  let seen: number[] = [];
  await withClient(retryDelay, origin, cacheDir, async (client) => {
    const mark = delays.length;
    await assert.rejects(() => (client as any).ensureAnnualCsvFile(), /ECONNREFUSED/);
    seen = takenSince(mark);
  });
  return seen;
}

async function requestDelays(
  retryDelay: string | undefined,
  origin: string,
  cacheDir: string,
  method: 'requestWithRetry' | 'requestBinaryWithRetry',
  options: { retries: number; timeoutMs: number; skipCache?: boolean; retryDelayMs?: number },
): Promise<number[]> {
  let seen: number[] = [];
  await withClient(retryDelay, origin, cacheDir, async (client) => {
    const mark = delays.length;
    await assert.rejects(() => (client as any)[method](`${origin}/refused`, options), /ECONNREFUSED/);
    seen = takenSince(mark);
  });
  return seen;
}

async function testDefaultDelays(origin: string, cacheDir: string) {
  assert.deepEqual(await spotDelays(undefined, origin, cacheDir), [1500], 'spot quote: 1.5 s, one wait for two attempts');
  assert.deepEqual(await csvDelays(undefined, origin, cacheDir), [2000, 4000], 'CSV download: 2 s, then 4 s');
  assert.deepEqual(
    await requestDelays(undefined, origin, cacheDir, 'requestWithRetry', { retries: 3, timeoutMs: 1000, skipCache: true }),
    [1000, 2000],
    'a JSON request with no delay of its own waits 1 s times the attempt',
  );
  assert.deepEqual(
    await requestDelays(undefined, origin, cacheDir, 'requestBinaryWithRetry', { retries: 3, timeoutMs: 1000 }),
    [1000, 2000],
    'a binary request with no delay of its own waits 1 s times the attempt',
  );
}

async function testConfiguredDelay(origin: string, cacheDir: string) {
  assert.deepEqual(await spotDelays('40', origin, cacheDir), [40], 'the spot quote uses WB_RETRY_DELAY_MS');
  assert.deepEqual(await csvDelays('40', origin, cacheDir), [40, 80], 'the CSV download uses WB_RETRY_DELAY_MS');
  assert.deepEqual(
    await requestDelays('40', origin, cacheDir, 'requestWithRetry', {
      retries: 3,
      timeoutMs: 1000,
      skipCache: true,
      retryDelayMs: 1500,
    }),
    [40, 80],
    'WB_RETRY_DELAY_MS replaces a delay passed by the caller',
  );
  assert.deepEqual(
    await requestDelays('40', origin, cacheDir, 'requestBinaryWithRetry', {
      retries: 3,
      timeoutMs: 1000,
      retryDelayMs: 2000,
    }),
    [40, 80],
    'WB_RETRY_DELAY_MS replaces the CSV base as well',
  );
}

async function testNonPositiveValuesKeepTheDefaults(origin: string, cacheDir: string) {
  for (const value of ['0', '-5', 'nope', '']) {
    assert.deepEqual(await spotDelays(value, origin, cacheDir), [1500], `${JSON.stringify(value)} is not a positive delay`);
  }
}

(async () => {
  const origin = await refusedOrigin();
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-retry-'));
  try {
    await testDefaultDelays(origin, cacheDir);
    await testConfiguredDelay(origin, cacheDir);
    await testNonPositiveValuesKeepTheDefaults(origin, cacheDir);
    console.log('World Bank retry delays follow WB_RETRY_DELAY_MS.');
  } finally {
    global.setTimeout = originalSetTimeout;
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
