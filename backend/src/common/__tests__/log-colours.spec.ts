import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { ConsoleLogger } from '@nestjs/common';
import { shouldColourLogs } from '../log-colours';
import { backendPath } from './backend-root';

// API logs (main.ts): colours only on a terminal, and only when NO_COLOR is
// absent or empty. A pipe, a file and `docker compose logs` stay plain text.
// The level set is untouched: ConsoleLogger's own defaults.

function testColoursOnATerminalWithoutNoColor() {
  assert.equal(shouldColourLogs(true, {}), true);
  assert.equal(shouldColourLogs(true, { PATH: '/usr/bin' }), true);
  // https://no-color.org/: an empty value does not disable colour. Nest's
  // `isColorAllowed` (`!process.env.NO_COLOR`) agrees.
  assert.equal(shouldColourLogs(true, { NO_COLOR: '' }), true);
}

function testNoColoursWithoutATerminal() {
  assert.equal(shouldColourLogs(false, {}), false);
  assert.equal(shouldColourLogs(undefined, {}), false);
  assert.equal(shouldColourLogs(false, { NO_COLOR: '1' }), false);
  assert.equal(shouldColourLogs(undefined, { NO_COLOR: '1' }), false);
}

function testNoColoursWhenNoColorIsSet() {
  for (const value of ['1', '0', 'true', ' ']) {
    assert.equal(shouldColourLogs(true, { NO_COLOR: value }), false, `NO_COLOR=${JSON.stringify(value)}`);
  }
}

/** Nest still wraps each colour in `isColorAllowed()`, which reads the live environment. */
function withoutNoColor<T>(fn: () => T): T {
  const previous = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = previous;
  }
}

function captureLogger(colors: boolean): string {
  const chunks: string[] = [];
  const record = (chunk: unknown) => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8'));
    return true;
  };
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  process.stdout.write = record as typeof process.stdout.write;
  process.stderr.write = record as typeof process.stderr.write;
  try {
    const logger = new ConsoleLogger({ colors });
    logger.log('Nest application successfully started');
    logger.error('startup failed');
    logger.log({ ready: true });
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
  return chunks.join('');
}

function testConsoleLoggerFollowsTheDecision() {
  // NO_COLOR is unset for this block, so a remaining escape would come from
  // the logger itself (the piped-stdout case, where the terminal check is false).
  withoutNoColor(() => {
    const plain = captureLogger(shouldColourLogs(false, {}));
    assert.doesNotMatch(plain, /\x1b\[/, `plain log still coloured:\n${plain}`);
    assert.match(plain, /Nest application successfully started/);
    assert.match(plain, /startup failed/);

    const coloured = captureLogger(shouldColourLogs(true, {}));
    assert.match(coloured, /\x1b\[/, 'a terminal with no NO_COLOR stays coloured');

    const blocked = captureLogger(shouldColourLogs(true, { NO_COLOR: '1' }));
    assert.doesNotMatch(blocked, /\x1b\[/, `NO_COLOR log still coloured:\n${blocked}`);
  });
}

function testBootstrapPassesTheDecision() {
  const main = fs.readFileSync(backendPath('src', 'main.ts'), 'utf8');
  assert.match(main, /import \{ shouldColourLogs \} from '\.\/common\/log-colours'/);
  assert.match(main, /import \{ ConsoleLogger \} from '@nestjs\/common'/);
  assert.match(main, /bufferLogs:\s*true/);
  assert.match(
    main,
    /new ConsoleLogger\(\{\s*colors:\s*shouldColourLogs\(process\.stdout\.isTTY,\s*process\.env\)\s*\}\)/,
  );
}

function run() {
  testColoursOnATerminalWithoutNoColor();
  testNoColoursWithoutATerminal();
  testNoColoursWhenNoColorIsSet();
  testConsoleLoggerFollowsTheDecision();
  testBootstrapPassesTheDecision();
  console.log('log-colours.spec: ok');
}

run();
