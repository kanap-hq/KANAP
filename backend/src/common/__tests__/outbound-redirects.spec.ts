import * as assert from 'node:assert/strict';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { Features } from '../../config/features';
import { GlpiService } from '../../ai/glpi/glpi.service';
import { PrtgService } from '../../ai/prtg/prtg.service';
import { AnthropicAiProviderAdapter } from '../../ai/providers/anthropic-ai-provider.adapter';
import { openaiCompatibleStream } from '../../ai/providers/openai-stream.util';
import { NetboxClient } from '../../netbox/netbox.client';
import { MAX_SAME_ORIGIN_REDIRECTS, sameOriginRedirectFetch, sameOriginRedirectTarget } from '../outbound-redirects';

// Outbound calls that carry a secret (GLPI, PRTG, Netbox, model providers) against two
// local servers on two ports, so two origins. The first one redirects either to the
// second (another origin) or to itself (same origin). In both modes no request, and so
// no secret, reaches the other origin, and the call fails with a sentence that names the
// redirect. On-premise, a redirect on the same origin is still followed.

// Both servers listen on 127.0.0.1, which the request-time check blocks in
// multi-tenant mode: allowlisted here, so the redirect rule is what is tested.
process.env.SSRF_ALLOWED_HOSTS = '127.0.0.1';

type Seen = { path: string; headers: http.IncomingHttpHeaders };

const homeSeen: Seen[] = [];
const otherSeen: Seen[] = [];
let otherBase = '';

const OPENAI_SSE_OK = [
  'data: {"id":"c1","object":"chat.completion.chunk","created":0,"model":"m",'
    + '"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}',
  '',
  'data: [DONE]',
  '',
  '',
].join('\n');

// The answer of a server that speaks every protocol of this spec, by path.
function answer(path: string, res: http.ServerResponse) {
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (path.includes('/apirest.php/initSession')) return json(200, { session_token: 'session-1' });
  if (path.includes('/apirest.php/getFullSession')) return json(200, { session: { glpiID: 7 } });
  if (path.includes('/apirest.php/killSession')) return json(200, true);
  if (path.includes('/api/table.json')) return json(200, { 'prtg-version': '24.1', treesize: 0, sensors: [] });
  if (path.includes('/api/status/')) return json(200, { 'netbox-version': '4.1' });
  if (path.includes('/chat/completions')) {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(OPENAI_SSE_OK);
    return;
  }
  if (path.includes('/v1/messages')) {
    return json(400, { type: 'error', error: { type: 'invalid_request_error', message: 'target reached' } });
  }
  return json(404, { message: 'not found' });
}

function listen(handler: http.RequestListener): Promise<{ server: http.Server; base: string }> {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

function startHome() {
  return listen((req, res) => {
    const path = req.url || '/';
    homeSeen.push({ path, headers: req.headers });
    req.resume();
    req.on('end', () => {
      // /cross/<rest> answers with the same <rest> on the other server.
      if (path.startsWith('/cross/')) {
        res.writeHead(302, { location: `${otherBase}${path.slice('/cross'.length)}` });
        res.end();
        return;
      }
      // /same/<rest> answers with /final/<rest> on this server.
      if (path.startsWith('/same/')) {
        res.writeHead(307, { location: `/final${path.slice('/same'.length)}` });
        res.end();
        return;
      }
      // /loop/ redirects to itself, forever.
      if (path.startsWith('/loop/')) {
        res.writeHead(302, { location: path });
        res.end();
        return;
      }
      answer(path, res);
    });
  });
}

function startOther() {
  return listen((req, res) => {
    const path = req.url || '/';
    otherSeen.push({ path, headers: req.headers });
    req.resume();
    req.on('end', () => answer(path, res));
  });
}

function reset() {
  homeSeen.length = 0;
  otherSeen.length = 0;
}

function setSingleTenant(value: boolean) {
  (Features as any).SINGLE_TENANT = value;
}

function glpiService(baseUrl: string) {
  return new GlpiService(
    {
      find: async () => ({
        glpi_url: baseUrl,
        glpi_user_token_encrypted: 'enc:user-token',
        glpi_app_token_encrypted: 'enc:app-token',
      }),
    } as any,
    { decrypt: (value: string) => value.replace(/^enc:/, '') } as any,
  );
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

function openaiParams(endpointUrl: string) {
  return {
    providerId: 'custom' as const,
    model: 'm',
    apiKey: 'provider-key',
    endpointUrl,
    systemPrompt: 'Reply with ok.',
    messages: [{ role: 'user' as const, content: 'Hello' }],
    tools: [],
    maxTokens: 16,
    timeoutMs: 5_000,
    maxRetries: 0,
  };
}

function testRedirectTarget() {
  const from = new URL('http://glpi.example:8080/helpdesk/apirest.php/initSession');
  assert.equal(sameOriginRedirectTarget(from, '/helpdesk/x')?.toString(), 'http://glpi.example:8080/helpdesk/x');
  assert.equal(sameOriginRedirectTarget(from, 'http://GLPI.example:8080/y')?.toString(), 'http://glpi.example:8080/y');
  // Scheme, host and port each make another origin.
  assert.equal(sameOriginRedirectTarget(from, 'https://glpi.example:8080/y'), null);
  assert.equal(sameOriginRedirectTarget(from, 'http://other.example:8080/y'), null);
  assert.equal(sameOriginRedirectTarget(from, 'http://glpi.example/y'), null);
  assert.equal(sameOriginRedirectTarget(from, null), null);
  assert.equal(sameOriginRedirectTarget(new URL('https://a.example/'), 'https://a.example:443/z')?.toString(), 'https://a.example/z');
}

async function testGlpi(home: string) {
  for (const singleTenant of [true, false]) {
    setSingleTenant(singleTenant);
    reset();
    const crossResult = await glpiService(`${home}/cross`).testConnection('tenant-1', undefined, {} as any);
    assert.equal(crossResult.ok, false, `GLPI cross-origin redirect (single-tenant ${singleTenant})`);
    assert.match(crossResult.message, /redirect \(HTTP 302\), which is not followed/);
    assert.deepEqual(otherSeen, [], 'no GLPI request reaches another origin');
  }

  setSingleTenant(true);
  reset();
  const same = await glpiService(`${home}/same`).testConnection('tenant-1', undefined, {} as any);
  assert.equal(same.ok, true, `same-origin redirect on-premise: ${same.message}`);
  const followed = homeSeen.find((seen) => seen.path === '/final/apirest.php/initSession');
  assert.equal(followed?.headers['app-token'], 'app-token', 'the same origin keeps its headers');

  setSingleTenant(false);
  reset();
  const cloud = await glpiService(`${home}/same`).testConnection('tenant-1', undefined, {} as any);
  assert.equal(cloud.ok, false);
  assert.match(cloud.message, /redirect \(HTTP 307\), which is not followed/);
  assert.deepEqual(homeSeen.map((seen) => seen.path), ['/same/apirest.php/initSession']);
}

async function testPrtg(home: string) {
  const service = new PrtgService();
  const connection = (baseUrl: string) => ({ baseUrl, auth: { kind: 'api_token' as const, apiToken: 'prtg-token' } });
  for (const singleTenant of [true, false]) {
    setSingleTenant(singleTenant);
    reset();
    await assert.rejects(
      () => service.testConnection(connection(`${home}/cross`)),
      (error: any) => /redirect \(HTTP 302\), which is not followed/.test(String(error?.message)),
    );
    assert.deepEqual(otherSeen, [], 'no PRTG request reaches another origin');
  }

  setSingleTenant(true);
  reset();
  const result = await service.testConnection(connection(`${home}/same`));
  assert.equal(result.prtgVersion, '24.1');

  setSingleTenant(false);
  reset();
  await assert.rejects(
    () => service.testConnection(connection(`${home}/same`)),
    (error: any) => /redirect \(HTTP 307\)/.test(String(error?.message)),
  );
}

async function testNetbox(home: string) {
  const client = new NetboxClient();
  for (const singleTenant of [true, false]) {
    setSingleTenant(singleTenant);
    reset();
    await assert.rejects(
      () => client.getVersion({ baseUrl: `${home}/cross`, token: 'netbox-token' }),
      (error: any) => /redirects somewhere else/.test(String(error?.message)),
    );
    assert.deepEqual(otherSeen, [], 'no Netbox request reaches another origin');
  }
}

async function testOpenAiCompatible(home: string) {
  for (const singleTenant of [true, false]) {
    setSingleTenant(singleTenant);
    reset();
    const { error } = await collect(openaiCompatibleStream(openaiParams(`${home}/cross/v1`)));
    assert.ok(error instanceof Error, 'a cross-origin redirect is an error');
    assert.match((error as Error).message, /redirect \(HTTP 302\), which is not followed/);
    assert.deepEqual(otherSeen, [], 'no model request reaches another origin');
  }
  setSingleTenant(true);
  reset();
  const same = await collect(openaiCompatibleStream(openaiParams(`${home}/same/v1`)));
  assert.equal(same.error, null);
  const followed = homeSeen.find((seen) => seen.path === '/final/v1/chat/completions');
  assert.equal(followed?.headers.authorization, 'Bearer provider-key');
}

async function testAnthropic(home: string) {
  const previous = process.env.ANTHROPIC_BASE_URL;
  try {
    const adapter = new AnthropicAiProviderAdapter();
    const params = { ...openaiParams(''), providerId: 'anthropic' as const, endpointUrl: null };
    for (const singleTenant of [true, false]) {
      setSingleTenant(singleTenant);
      process.env.ANTHROPIC_BASE_URL = `${home}/cross`;
      reset();
      const { error } = await collect(adapter.createStream(params));
      assert.ok(error instanceof Error);
      assert.match((error as Error).message, /redirect \(HTTP 302\), which is not followed/);
      assert.deepEqual(otherSeen, [], 'the key never reaches another origin');
    }
    setSingleTenant(true);
    process.env.ANTHROPIC_BASE_URL = `${home}/same`;
    reset();
    const same = await collect(adapter.createStream(params));
    assert.match(String((same.error as Error)?.message), /target reached/);
    const followed = homeSeen.find((seen) => seen.path === '/final/v1/messages');
    assert.equal(followed?.headers['x-api-key'], 'provider-key');
  } finally {
    if (previous === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = previous;
  }
}

async function testHelperLimitsAndMethods(home: string) {
  setSingleTenant(true);
  const redirecting = sameOriginRedirectFetch(globalThis.fetch);

  reset();
  const loop = await redirecting(`${home}/loop/x`);
  assert.equal(loop.status, 302, 'a redirect loop stops and comes back as the redirect');
  assert.equal(homeSeen.length, MAX_SAME_ORIGIN_REDIRECTS + 1);

  // 307 keeps the method and the body.
  reset();
  const kept = await redirecting(`${home}/same/v1/messages`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
  assert.equal(kept.status, 400);
  assert.equal(homeSeen[1].path, '/final/v1/messages');
  assert.equal(homeSeen[1].headers['content-type'], 'application/json');

  // A cross-origin redirect is handed back, never sent.
  reset();
  const cross = await redirecting(`${home}/cross/api/status/`, { headers: { 'x-api-key': 'k' } });
  assert.equal(cross.status, 302);
  assert.deepEqual(otherSeen, []);
}

async function run() {
  const originalSingleTenant = Features.SINGLE_TENANT;
  const home = await startHome();
  const other = await startOther();
  otherBase = other.base;
  try {
    testRedirectTarget();
    await testGlpi(home.base);
    await testPrtg(home.base);
    await testNetbox(home.base);
    await testOpenAiCompatible(home.base);
    await testAnthropic(home.base);
    await testHelperLimitsAndMethods(home.base);
  } finally {
    setSingleTenant(originalSingleTenant);
    await new Promise<void>((resolve) => home.server.close(() => resolve()));
    await new Promise<void>((resolve) => other.server.close(() => resolve()));
  }
  console.log('outbound-redirects.spec: all assertions passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
