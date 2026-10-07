import * as assert from 'node:assert/strict';
import { backgroundWorkCount, trackBackgroundWork, waitForBackgroundWork } from '../background-work';
import { EmailService } from '../../email/email.service';

/**
 * A stop waits for the work the last requests left behind (main.ts, graceful-shutdown.ts), within
 * the drain time: tracked background work (notification chains, queued FX refreshes), work it
 * starts meanwhile, and the email queue. Past the deadline it gives up and says how much is left.
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function testBackgroundWorkIsWaitedFor() {
  const done: string[] = [];
  void trackBackgroundWork(sleep(100).then(() => { done.push('a'); }));
  // A chain that starts more work while it runs: that work is waited for too.
  void trackBackgroundWork(sleep(50).then(() => {
    done.push('b');
    void trackBackgroundWork(sleep(100).then(() => { done.push('c'); }));
  }));
  assert.equal(backgroundWorkCount(), 2);
  const left = await waitForBackgroundWork(Date.now() + 2_000);
  assert.equal(left, 0);
  assert.deepEqual(done.sort(), ['a', 'b', 'c']);

  // A rejection does not escape and does not hold the wait.
  void trackBackgroundWork(Promise.reject(new Error('boom'))).catch(() => undefined);
  assert.equal(await waitForBackgroundWork(Date.now() + 500), 0);
}

async function testDeadlineIsKept() {
  let release!: () => void;
  void trackBackgroundWork(new Promise<void>((resolve) => { release = resolve; }));
  const deadlineAt = Date.now() + 150;
  const wait = waitForBackgroundWork(deadlineAt);
  // Timers fire in the order they expire, however late a loaded machine runs them: the wait
  // must end before a timer set well past its deadline, not when the job ends.
  let lateTimer: NodeJS.Timeout | undefined;
  const late = new Promise<'late'>((resolve) => { lateTimer = setTimeout(() => resolve('late'), 1_000); });
  const left = await Promise.race([wait, late]);
  clearTimeout(lateTimer);
  assert.notEqual(left, 'late', 'the wait ends at the deadline');
  assert.equal(left, 1, 'one job still running at the deadline');
  assert.ok(Date.now() >= deadlineAt, 'the wait lasted until the deadline');
  release();
  assert.equal(await waitForBackgroundWork(Date.now() + 500), 0);
}

function emailService(sendMs: number) {
  process.env.EMAIL_QUEUE_MIN_INTERVAL_MS = '20';
  const svc = new EmailService();
  const sent: string[] = [];
  (svc as any).transport = {
    name: 'spec',
    defaultMinIntervalMs: 20,
    send: async (options: { to: string }) => { await sleep(sendMs); sent.push(String(options.to)); },
    getRetryDelayMs: () => null,
  };
  (svc as any).logger = { warn: () => undefined, log: () => undefined, debug: () => undefined, error: () => undefined };
  return { svc, sent };
}

async function testEmailQueueIsDrained() {
  const { svc, sent } = emailService(30);
  for (const to of ['a@x.test', 'b@x.test', 'c@x.test', 'd@x.test']) void svc.send({ to, subject: 's', html: 'h', text: 't' });
  assert.equal(svc.pendingCount(), 4);
  const left = await svc.drain(Date.now() + 3_000);
  assert.equal(left, 0, 'every queued email went out');
  assert.deepEqual(sent, ['a@x.test', 'b@x.test', 'c@x.test', 'd@x.test']);
  assert.equal(await svc.drain(Date.now() + 100), 0, 'an empty queue returns at once');
}

async function testEmailDrainStopsAtTheDeadline() {
  const { svc, sent } = emailService(200);
  for (const to of ['a@x.test', 'b@x.test', 'c@x.test']) void svc.send({ to, subject: 's', html: 'h', text: 't' }).catch(() => undefined);
  const warnings: string[] = [];
  (svc as any).logger.warn = (line: string) => warnings.push(line);
  const left = await svc.drain(Date.now() + 300);
  assert.ok(left >= 1, `emails left at the deadline (${left})`);
  assert.ok(sent.length < 3);
  assert.match(warnings[0] ?? '', /email\(s\) not sent/);
  await svc.drain(Date.now() + 2_000);
}

async function run() {
  await testBackgroundWorkIsWaitedFor();
  await testDeadlineIsKept();
  await testEmailQueueIsDrained();
  await testEmailDrainStopsAtTheDeadline();
  console.log('background-drain.spec: ok');
}

run().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
