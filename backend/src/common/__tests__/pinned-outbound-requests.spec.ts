import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';
import * as path from 'node:path';
import { AddressInfo, Socket } from 'node:net';
import { Features } from '../../config/features';
import { openaiCompatibleStream } from '../../ai/providers/openai-stream.util';
import { GlpiService } from '../../ai/glpi/glpi.service';
import { PrtgService } from '../../ai/prtg/prtg.service';
import { NetboxClient } from '../../netbox/netbox.client';
import { RemoteInlineImageImportService } from '../remote-inline-image-import.service';
import { openValidatedFetch } from '../pinned-fetch';
import { backendPath } from './backend-root';

// Outbound requests to a host a tenant configured: once the request-time check
// has validated the addresses of the host (multi-tenant mode), the connection
// goes to one of them, never to an address a second resolution would give; TLS
// keeps the host name of the URL. The connection is released when the call ends,
// fails or is abandoned. Single-tenant installations (and allowlisted hosts) keep
// the global fetch, unchanged.
//
// The test host name is answered only by the request-time resolver below: the
// system resolver does not know it, so a request that reaches the local server
// can only have used the validated address. The loopback address stands in for a
// public one: it is allowlisted as an address, never as a host name.
process.env.SSRF_ALLOWED_HOSTS = '127.0.0.1';
const PINNED_HOST = 'pinned-host.example.test';

const dnsPromises: { lookup: (...args: any[]) => Promise<any> } = require('node:dns/promises');
const realLookup = dnsPromises.lookup;
const resolved: string[] = [];
dnsPromises.lookup = async (hostname: string, options: any) => {
  resolved.push(hostname);
  if (hostname === PINNED_HOST) return [{ address: '127.0.0.1', family: 4 }];
  return realLookup(hostname, options);
};

const originalFetch = globalThis.fetch;
let globalFetchCalls = 0;
globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
  globalFetchCalls += 1;
  return originalFetch(...args);
}) as typeof fetch;

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(56)]);
const SSE_CHUNK = (text: string, finish: string | null) => `data: ${JSON.stringify({
  id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'm',
  choices: [{ index: 0, delta: { content: text }, finish_reason: finish }],
})}\n\n`;

type Mode = 'ok' | 'error' | 'hang';
const state: { mode: Mode; hosts: string[]; connectionHeaders: string[] } = { mode: 'ok', hosts: [], connectionHeaders: [] };
let tracked: Set<Socket> | null = null;

function startServer(): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer((req, res) => {
    state.hosts.push(String(req.headers.host));
    state.connectionHeaders.push(String(req.headers.connection || ''));
    req.resume();
    req.on('end', () => {
      const url = req.url || '/';
      if (url.startsWith('/v1/chat/completions')) {
        if (state.mode === 'error') {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'model unavailable' } }));
          return;
        }
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        if (state.mode === 'hang') {
          res.write(SSE_CHUNK('partial', null));
          return; // kept open until the client leaves
        }
        res.end(`${SSE_CHUNK('ok', 'stop')}data: [DONE]\n\n`);
        return;
      }
      if (url.startsWith('/image.png')) {
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end(PNG);
        return;
      }
      if (url.startsWith('/api/table.json')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ sensors: [{ objid: 1001 }] }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ session_token: 's1', session: { glpiID: 7 }, 'netbox-version': '4.1.0' }));
    });
  });
  server.on('connection', (socket: Socket) => tracked?.add(socket));
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as AddressInfo).port })));
}

function setSingleTenant(value: boolean) {
  (Features as any).SINGLE_TENANT = value;
}

function reset(mode: Mode = 'ok') {
  state.mode = mode;
  state.hosts.length = 0;
  state.connectionHeaders.length = 0;
  resolved.length = 0;
  globalFetchCalls = 0;
  tracked = new Set();
}

/** The connections opened since reset() are all closed (within a short wait: a kept-alive one lingers for seconds). */
async function expectConnectionsClosed(label: string) {
  const sockets = tracked!;
  assert.ok(sockets.size > 0, `${label}: a connection was made`);
  const deadline = Date.now() + 1500;
  while ([...sockets].some((socket) => !socket.destroyed) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok([...sockets].every((socket) => socket.destroyed), `${label}: the connection was released`);
}

function expectPinned(label: string, port: number) {
  assert.ok(resolved.includes(PINNED_HOST), `${label}: the host was checked`);
  assert.equal(globalFetchCalls, 0, `${label}: the global fetch is not used`);
  assert.ok(state.hosts.length > 0, `${label}: the request reached the validated address`);
  assert.ok(state.hosts.every((host) => host === `${PINNED_HOST}:${port}`), `${label}: the Host header keeps the name`);
}

function streamParams(endpointUrl: string, extra: Record<string, unknown> = {}) {
  return {
    providerId: 'custom' as const,
    model: 'm',
    apiKey: 'test-key',
    endpointUrl,
    systemPrompt: 'Reply with ok.',
    messages: [{ role: 'user' as const, content: 'Hello' }],
    tools: [],
    maxTokens: 16,
    timeoutMs: 5_000,
    maxRetries: 0,
    ...extra,
  };
}

async function collect(gen: AsyncGenerator<any>): Promise<{ events: any[]; error: unknown }> {
  const events: any[] = [];
  try {
    for await (const event of gen) events.push(event);
    return { events, error: null };
  } catch (error) {
    return { events, error };
  }
}

async function testTlsKeepsTheHostName() {
  // The certificate names localhost and 127.0.0.1, not the test host: the
  // client must refuse it, after sending the URL's host name as SNI.
  const fixtures = backendPath('src', 'netbox', '__tests__', 'fixtures');
  const serverNames: string[] = [];
  const server = https.createServer({
    key: fs.readFileSync(path.join(fixtures, 'netbox-test-key.pem')),
    cert: fs.readFileSync(path.join(fixtures, 'netbox-test-cert.pem')),
    SNICallback: (servername, callback) => { serverNames.push(servername); callback(null, undefined as any); },
  }, (_req, res) => res.end('ok'));
  server.on('tlsClientError', () => undefined);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  setSingleTenant(false);
  reset();
  const target = await openValidatedFetch(`https://${PINNED_HOST}:${port}/`);
  try {
    assert.ok(target.dispatcher, 'the connection is bound');
    await assert.rejects(target.fetch(`https://${PINNED_HOST}:${port}/`), (error: any) => /CERT|certificate/i.test(String(error?.cause?.code || error?.cause?.message || error)));
    assert.deepEqual(serverNames, [PINNED_HOST], 'SNI carries the host name of the URL');
  } finally {
    await target.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function testOpenAiCompatibleStream(port: number) {
  const pinnedEndpoint = `http://${PINNED_HOST}:${port}/v1`;
  setSingleTenant(false);

  reset('ok');
  const ok = await collect(openaiCompatibleStream(streamParams(pinnedEndpoint)));
  assert.equal(ok.error, null);
  assert.deepEqual(ok.events.find((event) => event.type === 'text_delta'), { type: 'text_delta', text: 'ok' });
  expectPinned('stream', port);
  await expectConnectionsClosed('stream success');

  reset('error');
  const failed = await collect(openaiCompatibleStream(streamParams(pinnedEndpoint)));
  assert.ok(failed.error instanceof Error);
  assert.match((failed.error as Error).message, /HTTP 500/);
  expectPinned('stream error', port);
  await expectConnectionsClosed('stream error');

  // Aborted by the caller's signal.
  reset('hang');
  const controller = new AbortController();
  const aborted: any[] = [];
  for await (const event of openaiCompatibleStream(streamParams(pinnedEndpoint, { signal: controller.signal }))) {
    aborted.push(event);
    if (event.type === 'text_delta') controller.abort();
  }
  assert.equal(aborted[0]?.type, 'text_delta');
  assert.ok(!aborted.some((event) => event.type === 'error'), 'an abort is not reported as an error');
  expectPinned('stream abort', port);
  await expectConnectionsClosed('stream abort');

  // Abandoned by the consumer (the generator is closed early).
  reset('hang');
  for await (const event of openaiCompatibleStream(streamParams(pinnedEndpoint))) {
    if (event.type === 'text_delta') break;
  }
  expectPinned('stream abandoned', port);
  await expectConnectionsClosed('stream abandoned');

  // The platform's own endpoint is used as configured (no check, global fetch).
  reset('ok');
  const platform = await collect(openaiCompatibleStream(streamParams(`http://127.0.0.1:${port}/v1`, { endpointSource: 'platform' })));
  assert.equal(platform.error, null);
  assert.equal(resolved.length, 0);
  assert.ok(globalFetchCalls > 0, 'platform endpoint: global fetch');

  // Single-tenant: unchanged (no resolution, global fetch).
  setSingleTenant(true);
  reset('ok');
  const onPrem = await collect(openaiCompatibleStream(streamParams(`http://127.0.0.1:${port}/v1`)));
  assert.equal(onPrem.error, null);
  assert.equal(resolved.length, 0);
  assert.ok(globalFetchCalls > 0, 'single-tenant: global fetch');
  setSingleTenant(false);
}

function glpiService(baseUrl: string) {
  return new GlpiService(
    { find: async () => ({ glpi_url: baseUrl, glpi_user_token_encrypted: 'enc:user', glpi_app_token_encrypted: 'enc:app' }) } as any,
    { decrypt: (value: string) => value.replace(/^enc:/, '') } as any,
  );
}

async function testGlpi(port: number) {
  setSingleTenant(false);
  reset();
  const session = await glpiService(`http://${PINNED_HOST}:${port}`).initSession('tenant-1', {} as any);
  assert.equal(session.sessionToken, 's1');
  assert.equal(session.agentUserId, 7, 'the body of the second call was read too');
  expectPinned('GLPI', port);
  await expectConnectionsClosed('GLPI');

  setSingleTenant(true);
  reset();
  const onPrem = await glpiService(`http://127.0.0.1:${port}`).initSession('tenant-1', {} as any);
  assert.equal(onPrem.sessionToken, 's1');
  assert.equal(resolved.length, 0);
  assert.ok(globalFetchCalls > 0, 'GLPI single-tenant: global fetch');
  setSingleTenant(false);
}

async function testPrtg(port: number) {
  const service = new PrtgService();
  const list = (baseUrl: string) => service.listObjects(
    { baseUrl, auth: { kind: 'api_token', apiToken: 'token' } } as any,
    { content: 'sensors', columns: ['objid'], count: 10, start: 0 },
  );
  setSingleTenant(false);
  reset();
  assert.deepEqual(await list(`http://${PINNED_HOST}:${port}`), [{ objid: 1001 }]);
  expectPinned('PRTG', port);
  await expectConnectionsClosed('PRTG');

  setSingleTenant(true);
  reset();
  assert.deepEqual(await list(`http://127.0.0.1:${port}`), [{ objid: 1001 }]);
  assert.equal(resolved.length, 0);
  assert.ok(globalFetchCalls > 0, 'PRTG single-tenant: global fetch');
  setSingleTenant(false);
}

async function testRemoteImage(port: number) {
  const service = new RemoteInlineImageImportService();
  // Bound in both modes: user-supplied image addresses are always checked.
  for (const singleTenant of [false, true]) {
    setSingleTenant(singleTenant);
    reset();
    const file = await service.importFromUrl(`http://${PINNED_HOST}:${port}/image.png`);
    assert.equal(file.size, PNG.length);
    assert.equal(file.mimetype, 'image/png');
    expectPinned(`remote image (single-tenant ${singleTenant})`, port);
    await expectConnectionsClosed(`remote image (single-tenant ${singleTenant})`);
  }
  setSingleTenant(false);
}

async function testNetbox(port: number) {
  setSingleTenant(false);
  reset();
  const client = new NetboxClient();
  const connection = { baseUrl: `http://${PINNED_HOST}:${port}`, token: 'token', insecureTls: false, requestTimeoutMs: 5000 };
  assert.equal(await client.getVersion(connection), '4.1.0');
  assert.equal(await client.getVersion(connection), '4.1.0');
  assert.ok(resolved.includes(PINNED_HOST));
  assert.deepEqual(state.hosts, [`${PINNED_HOST}:${port}`, `${PINNED_HOST}:${port}`]);
  // Each bound request has a connection of its own, closed after it (no shared keep-alive pool).
  assert.equal(tracked!.size, 2, 'one connection per bound request');
  assert.deepEqual(state.connectionHeaders, ['close', 'close']);
  await expectConnectionsClosed('Netbox');
}

async function run() {
  const originalSingleTenant = Features.SINGLE_TENANT;
  const { server, port } = await startServer();
  try {
    await testTlsKeepsTheHostName();
    await testOpenAiCompatibleStream(port);
    await testGlpi(port);
    await testPrtg(port);
    await testRemoteImage(port);
    await testNetbox(port);
  } finally {
    setSingleTenant(originalSingleTenant);
    dnsPromises.lookup = realLookup;
    globalThis.fetch = originalFetch;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  console.log('pinned-outbound-requests.spec: all assertions passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
