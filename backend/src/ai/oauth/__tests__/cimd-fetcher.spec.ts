import * as assert from 'node:assert/strict';
import { CIMD_MAX_BYTES, CimdError, CimdFetcherService, isCimdClientId } from '../cimd-fetcher.service';
import {
  canonicalResource,
  isAcceptableRedirectUri,
  isThisMcpResource,
  mcpBearerChallenge,
  normalizeScope,
  pkceVerifierMatches,
  redirectUriMatches,
  s256Challenge,
} from '../mcp-oauth.util';

// Client ID Metadata Documents are fetched from a URL a third party chooses: the SSRF rules,
// the size and time limits and the document checks, plus the URL helpers of the flow.

const CLIENT_ID = 'https://client.example.com/oauth/metadata.json';
const PUBLIC_ADDRESS = [{ address: '93.184.216.34' }];

function doc(overrides: Record<string, unknown> = {}) {
  return {
    client_id: CLIENT_ID,
    client_name: 'Example client',
    redirect_uris: ['https://client.example.com/callback', 'http://localhost/callback'],
    token_endpoint_auth_method: 'none',
    ...overrides,
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
}

function fetcher(options: Record<string, unknown>) {
  return new CimdFetcherService().configure({ lookupFn: async () => PUBLIC_ADDRESS, ...options } as any);
}

async function assertCimdError(promise: Promise<unknown>, pattern: RegExp) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof CimdError, `expected a CimdError, got ${String(error)}`);
    assert.match((error as Error).message, pattern);
    return true;
  });
}

async function testValidDocumentIsParsedAndCached() {
  let calls = 0;
  const seen: Array<{ url: string; redirect: unknown }> = [];
  const service = fetcher({
    fetchImpl: async (url: URL, init: RequestInit) => {
      calls += 1;
      seen.push({ url: url.toString(), redirect: init.redirect });
      return jsonResponse(doc());
    },
  });
  const metadata = await service.fetch(CLIENT_ID);
  assert.equal(metadata.client_name, 'Example client');
  assert.deepEqual(metadata.redirect_uris, ['https://client.example.com/callback', 'http://localhost/callback']);
  await service.fetch(CLIENT_ID);
  assert.equal(calls, 1, 'the document is cached');
  assert.equal(seen[0].redirect, 'manual', 'redirects are never followed');
}

async function testCacheExpiresAfterAnHour() {
  let now = 1_000_000;
  let calls = 0;
  const service = fetcher({ now: () => now, fetchImpl: async () => { calls += 1; return jsonResponse(doc()); } });
  await service.fetch(CLIENT_ID);
  now += 59 * 60_000;
  await service.fetch(CLIENT_ID);
  now += 2 * 60_000;
  await service.fetch(CLIENT_ID);
  assert.equal(calls, 2);
}

async function testClientIdMustBeHttps() {
  assert.equal(isCimdClientId('http://client.example.com/metadata.json'), false);
  assert.equal(isCimdClientId('https://client.example.com/'), false, 'a path is required');
  assert.equal(isCimdClientId('https://user:pw@client.example.com/m'), false);
  assert.equal(isCimdClientId('https://client.example.com/m#x'), false);
  assert.equal(isCimdClientId('client-123'), false);
  assert.equal(isCimdClientId(CLIENT_ID), true);
  let fetched = false;
  const service = fetcher({ fetchImpl: async () => { fetched = true; return jsonResponse(doc()); } });
  await assertCimdError(service.fetch('http://client.example.com/metadata.json'), /https URL/);
  assert.equal(fetched, false);
}

async function testPrivateAddressesAreRefusedBeforeAnyRequest() {
  for (const address of ['10.0.0.5', '127.0.0.1', '169.254.169.254', '100.64.0.1', '192.168.1.1', 'fd00::1', '::ffff:10.0.0.1']) {
    let fetched = false;
    const service = new CimdFetcherService().configure({
      lookupFn: async () => [{ address }],
      fetchImpl: async () => { fetched = true; return jsonResponse(doc()); },
    });
    await assertCimdError(service.fetch(CLIENT_ID), /Private or internal/);
    assert.equal(fetched, false, `no request to ${address}`);
  }
  // A mix of public and private addresses is refused too.
  const mixed = new CimdFetcherService().configure({
    lookupFn: async () => [{ address: '93.184.216.34' }, { address: '10.1.2.3' }],
    fetchImpl: async () => jsonResponse(doc()),
  });
  await assertCimdError(mixed.fetch(CLIENT_ID), /Private or internal/);
  // An IP literal in the URL.
  const literal = fetcher({ fetchImpl: async () => jsonResponse(doc({ client_id: 'https://127.0.0.1/m' })) });
  await assertCimdError(literal.fetch('https://127.0.0.1/m'), /Private or internal/);
}

async function testRedirectIsRefused() {
  const service = fetcher({
    fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'http://10.0.0.1/metadata.json' } }),
  });
  await assertCimdError(service.fetch(CLIENT_ID), /redirects/);
}

async function testOversizedDocumentIsRefused() {
  const big = JSON.stringify(doc({ padding: 'x'.repeat(CIMD_MAX_BYTES) }));
  const declared = fetcher({ fetchImpl: async () => new Response(big, { status: 200, headers: { 'content-length': String(big.length) } }) });
  await assertCimdError(declared.fetch(CLIENT_ID), /too large/);
  // Streamed without a length: cut at the limit.
  const streamed = fetcher({
    fetchImpl: async () => new Response(new ReadableStream({
      start(controller) {
        for (let i = 0; i < 20; i += 1) controller.enqueue(new TextEncoder().encode('x'.repeat(1024)));
        controller.close();
      },
    }), { status: 200 }),
  });
  await assertCimdError(streamed.fetch(CLIENT_ID), /too large/);
}

async function testOtherClientIdIsRefused() {
  const service = fetcher({ fetchImpl: async () => jsonResponse(doc({ client_id: 'https://evil.example.com/m' })) });
  await assertCimdError(service.fetch(CLIENT_ID), /another client_id/);
}

async function testSlowServerTimesOut() {
  const service = fetcher({
    timeoutMs: 50,
    fetchImpl: (_url: URL, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }),
  });
  await assertCimdError(service.fetch(CLIENT_ID), /too long/);
}

async function testDocumentRules() {
  const cases: Array<[Record<string, unknown>, RegExp]> = [
    [{ redirect_uris: [] }, /redirect_uris/],
    [{ redirect_uris: ['http://client.example.com/callback'] }, /redirect_uris/],
    [{ redirect_uris: ['https://client.example.com/cb#frag'] }, /redirect_uris/],
    [{ token_endpoint_auth_method: 'client_secret_basic' }, /public clients/],
  ];
  for (const [overrides, pattern] of cases) {
    const service = fetcher({ fetchImpl: async () => jsonResponse(doc(overrides)) });
    await assertCimdError(service.fetch(CLIENT_ID), pattern);
  }
  const notJson = fetcher({ fetchImpl: async () => new Response('<html>', { status: 200 }) });
  await assertCimdError(notJson.fetch(CLIENT_ID), /not valid JSON/);
  const notFound = fetcher({ fetchImpl: async () => new Response('', { status: 404 }) });
  await assertCimdError(notFound.fetch(CLIENT_ID), /HTTP 404/);
}

function testUrlHelpers() {
  const origin = 'https://acme.kanap.net';
  assert.equal(canonicalResource('HTTPS://ACME.kanap.net:443/api/ai/mcp/'), 'https://acme.kanap.net/api/ai/mcp');
  assert.equal(isThisMcpResource('https://acme.kanap.net/api/ai/mcp', origin), true);
  assert.equal(isThisMcpResource('https://acme.kanap.net/api/ai/mcp/', origin), true, 'trailing slash tolerated');
  assert.equal(isThisMcpResource('https://other.kanap.net/api/ai/mcp', origin), false);
  assert.equal(isThisMcpResource('https://acme.kanap.net/api/ai/mcp?x=1', origin), false);
  assert.equal(isThisMcpResource(undefined, origin), false);

  // Loopback redirects match on any port; everything else exactly.
  assert.equal(redirectUriMatches('http://localhost/callback', 'http://localhost:53123/callback'), true);
  assert.equal(redirectUriMatches('http://127.0.0.1/callback', 'http://127.0.0.1:8080/callback'), true);
  assert.equal(redirectUriMatches('http://localhost/callback', 'http://127.0.0.1:8080/callback'), false);
  assert.equal(redirectUriMatches('http://localhost/callback', 'http://localhost:8080/other'), false);
  assert.equal(redirectUriMatches('https://claude.ai/api/mcp/auth_callback', 'https://claude.ai/api/mcp/auth_callback'), true);
  assert.equal(redirectUriMatches('https://claude.ai/api/mcp/auth_callback', 'https://claude.ai:444/api/mcp/auth_callback'), false);
  assert.equal(redirectUriMatches('https://claude.ai/api/mcp/auth_callback', 'https://claude.ai/api/mcp/auth_callback/'), false);
  assert.equal(isAcceptableRedirectUri('http://example.com/cb'), false);
  assert.equal(isAcceptableRedirectUri('http://[::1]/cb'), true);

  const verifier = 'a'.repeat(43);
  assert.equal(pkceVerifierMatches(verifier, s256Challenge(verifier)), true);
  assert.equal(pkceVerifierMatches('b'.repeat(43), s256Challenge(verifier)), false);
  assert.equal(pkceVerifierMatches('short', s256Challenge('short')), false);

  assert.equal(normalizeScope(undefined), 'mcp:read');
  assert.equal(normalizeScope('mcp:read'), 'mcp:read');
  assert.equal(normalizeScope('mcp:read mcp:write'), null);

  assert.equal(
    mcpBearerChallenge(origin),
    'Bearer resource_metadata="https://acme.kanap.net/.well-known/oauth-protected-resource/api/ai/mcp", scope="mcp:read"',
  );
}

async function run() {
  await testValidDocumentIsParsedAndCached();
  await testCacheExpiresAfterAnHour();
  await testClientIdMustBeHttps();
  await testPrivateAddressesAreRefusedBeforeAnyRequest();
  await testRedirectIsRefused();
  await testOversizedDocumentIsRefused();
  await testOtherClientIdIsRefused();
  await testSlowServerTimesOut();
  await testDocumentRules();
  testUrlHelpers();
  // eslint-disable-next-line no-console
  console.log('cimd-fetcher.spec: OK');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
