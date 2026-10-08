import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import express = require('express');
import { createBodyParsers, URLENCODED_BODY_LIMIT } from '../body-parsers';
import { backendPath } from './backend-root';

// The API's body parsers: JSON keeps its 20 MB limit; form-encoded bodies,
// which no route takes, are limited to a small size and parsed flat.

function testMainUsesTheseParsers() {
  // main.ts mounts the HTTP wiring of http-app.ts.
  const main = fs.readFileSync(backendPath('src', 'main.ts'), 'utf8');
  const wiring = fs.readFileSync(backendPath('src', 'http-app.ts'), 'utf8');
  assert.match(main, /applyHttpMiddleware\(app\)/, 'main.ts mounts the HTTP middleware of http-app.ts');
  assert.match(wiring, /app\.use\(\.\.\.createBodyParsers\(rawBodySaver\)\)/, 'http-app.ts installs these parsers');
  for (const [name, source] of [['main.ts', main], ['http-app.ts', wiring]]) {
    assert.doesNotMatch(source, /express\.(json|urlencoded)\(/, `${name} installs no other JSON or form parser`);
  }
}

async function run() {
  testMainUsesTheseParsers();
  const app = express();
  const seenRaw: number[] = [];
  app.use(...createBodyParsers((req, _res, buffer) => { seenRaw.push(buffer.length); (req as any).rawBody = buffer; }));
  app.post('/echo', (req, res) => res.json({ body: req.body }));
  app.use((error: any, _req: any, res: any, _next: any) => res.status(error.status || 500).json({ type: error.type }));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = async (contentType: string, body: string) => {
    const res = await fetch(`${base}/echo`, { method: 'POST', headers: { 'content-type': contentType }, body });
    return { status: res.status, json: await res.json() as any };
  };
  try {
    assert.equal(URLENCODED_BODY_LIMIT, '64kb');

    // A small form body is parsed, without nesting.
    const small = await post('application/x-www-form-urlencoded', 'a=1&b%5Bc%5D=2');
    assert.equal(small.status, 200);
    assert.deepEqual(small.json.body, { a: '1', 'b[c]': '2' });

    // A form body over the limit is refused with 413.
    const large = await post('application/x-www-form-urlencoded', `a=${'x'.repeat(100 * 1024)}`);
    assert.equal(large.status, 413);
    assert.equal(large.json.type, 'entity.too.large');

    // JSON is unchanged: a 1 MB body is accepted, and the raw body is still kept.
    const json = await post('application/json', JSON.stringify({ text: 'y'.repeat(1024 * 1024) }));
    assert.equal(json.status, 200);
    assert.equal(json.json.body.text.length, 1024 * 1024);
    assert.ok(seenRaw.at(-1)! > 1024 * 1024);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  console.log('body-parsers.spec: all assertions passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
