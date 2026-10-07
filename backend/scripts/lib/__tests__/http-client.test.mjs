// Unit tests of the fixture loader's HTTP client (node --test).
//
//   node --test backend/scripts/lib/__tests__/http-client.test.mjs
//
// Against a local server: the explicit Host header, the hand-built multipart
// body, and the retry rule (a GET may be sent twice; a request that may have
// reached the server is never sent again).

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { createHttpClient, mayRetry } from '../http-client.mjs';

/** A server answering with `handler(req, body, count)`; resolves to { url, seen, close }. */
async function startServer(handler) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      handler(req, res, body, seen.length);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    seen,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }),
  };
}

const json = (res, status, payload) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
};

test('sends the Host it is given, and the multipart file with its fields', async () => {
  const server = await startServer((req, res) => json(res, 200, { ok: true }));
  const client = createHttpClient({ baseUrl: server.url, host: 'acme.lvh.me' });
  try {
    const answer = await client.request('POST', '/spend-items/budget-file/import?language=en', {
      headers: { Authorization: 'Bearer test' },
      form: { bytes: Buffer.from('a,b\n1,2\n'), filename: '14-spend-items.csv', fields: { snapshot: '{"rows":1}' } },
    });
    assert.equal(answer.status, 200);
    assert.deepEqual(JSON.parse(answer.text), { ok: true });
    const [request] = server.seen;
    assert.equal(request.headers.host, 'acme.lvh.me');
    assert.equal(request.headers.authorization, 'Bearer test');
    assert.equal(request.url, '/spend-items/budget-file/import?language=en');
    const boundary = /boundary=(.+)$/.exec(request.headers['content-type'])[1];
    assert.ok(request.body.includes(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="14-spend-items.csv"\r\nContent-Type: text/csv; charset=utf-8\r\n\r\na,b\n1,2\n\r\n`));
    assert.ok(request.body.includes(`--${boundary}\r\nContent-Disposition: form-data; name="snapshot"\r\n\r\n{"rows":1}\r\n--${boundary}--\r\n`));
  } finally {
    client.close();
    await server.close();
  }
});

test('without a host, the URL gives it; JSON bodies are sent as JSON', async () => {
  const server = await startServer((req, res, body) => json(res, 201, JSON.parse(body)));
  const client = createHttpClient({ baseUrl: `${server.url}/api` });
  try {
    const answer = await client.request('PATCH', '/currency/settings', { json: { reportingCurrency: 'EUR' } });
    assert.equal(answer.status, 201);
    assert.equal(server.seen[0].url, '/api/currency/settings', 'the base path is kept as a prefix');
    assert.equal(server.seen[0].headers.host, new URL(server.url).host);
    assert.equal(server.seen[0].headers['content-type'], 'application/json');
  } finally {
    client.close();
    await server.close();
  }
});

test('a GET answered 503 is sent once more', async () => {
  const server = await startServer((req, res, body, count) => json(res, count === 1 ? 503 : 200, { count }));
  const client = createHttpClient({ baseUrl: server.url });
  try {
    const answer = await client.request('GET', '/companies');
    assert.equal(answer.status, 200);
    assert.equal(server.seen.length, 2);
    assert.deepEqual(client.stats, { requests: 2, retries: 1 });
  } finally {
    client.close();
    await server.close();
  }
});

// The dropped write goes out on the socket kept alive by the first one: the
// client sees exactly what it would see if the server had closed that socket
// while idle, yet the server did read the write.
test('a write is not sent again once the server may have read it', async () => {
  const server = await startServer((req, res, body, count) => {
    if (req.url === '/drop') req.socket.destroy();
    else json(res, 500, { count });
  });
  const client = createHttpClient({ baseUrl: server.url });
  try {
    const failed = await client.request('POST', '/fail', { json: {} });
    assert.equal(failed.status, 500, 'an error answer is returned, not retried');
    await assert.rejects(client.request('POST', '/drop', { json: {} }), /no answer/);
    assert.equal(server.seen.length, 2, 'each write reached the server once');
    assert.equal(client.stats.retries, 0);
  } finally {
    client.close();
    await server.close();
  }
});

test('a refused connection is tried once more, then fails', async () => {
  const port = await new Promise((resolve) => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => {
      const { port: free } = probe.address();
      probe.close(() => resolve(free));
    });
  });
  const client = createHttpClient({ baseUrl: `http://127.0.0.1:${port}` });
  try {
    await assert.rejects(client.request('POST', '/companies/import', { json: {} }), /no answer .*ECONNREFUSED/);
    assert.deepEqual(client.stats, { requests: 2, retries: 1 });
  } finally {
    client.close();
  }
});

test('the retry rule', () => {
  assert.equal(mayRetry('GET', { status: 0, responseBytes: 10 }), true, 'a GET cut short');
  assert.equal(mayRetry('GET', { status: 502 }), true);
  assert.equal(mayRetry('GET', { status: 404 }), false);
  assert.equal(mayRetry('POST', { status: 503 }), false, 'a write answered by the server');
  assert.equal(mayRetry('POST', { status: 0, responseBytes: 0, error: 'ECONNREFUSED' }), true);
  assert.equal(mayRetry('POST', { status: 0, responseBytes: 0, error: 'ECONNRESET', reusedSocket: true }), false, 'a reset socket: the server may have read the write');
  assert.equal(mayRetry('PATCH', { status: 0, responseBytes: 5, error: 'ECONNRESET' }), false, 'part of the answer arrived');
});
