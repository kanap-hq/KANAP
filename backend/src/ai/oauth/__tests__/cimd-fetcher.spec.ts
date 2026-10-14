import * as assert from 'node:assert/strict';
import { Logger } from '@nestjs/common';
import {
  CIMD_FAILURE_TTL_MS,
  CIMD_MAX_BYTES,
  CIMD_MAX_IN_FLIGHT,
  CIMD_PUBLIC_ERROR,
  CimdError,
  CimdFetcherService,
  cleanClientName,
  isCimdClientId,
} from '../cimd-fetcher.service';
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
import { CHATGPT_CIMD, CHATGPT_CLIENT_METADATA, CHATGPT_REDIRECT } from './chatgpt-client-metadata.fixture';

// Client ID Metadata Documents are fetched from a URL a third party chooses: the SSRF rules,
// the size and time limits and the document checks, plus the URL helpers of the flow.

// Every refusal logs a warning: expected here.
Logger.overrideLogger(['error']);

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

/** A refused document: the reason is kept for the log, the caller only sees the generic message. */
async function assertCimdError(promise: Promise<unknown>, reason: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof CimdError, `expected a CimdError, got ${String(error)}`);
    assert.equal((error as CimdError).reason, reason, (error as CimdError).detail);
    assert.equal((error as Error).message, CIMD_PUBLIC_ERROR, 'no upstream detail reaches the caller');
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
  assert.equal(isCimdClientId('https://client.example.com:8443/m'), false, 'port 443 only');
  assert.equal(isCimdClientId('https://client.example.com:443/m'), true, 'the default port, written out');
  assert.equal(isCimdClientId(`https://client.example.com/${'a'.repeat(520)}`), false, '512 characters at most');
  assert.equal(isCimdClientId(CLIENT_ID), true);
  let fetched = false;
  const service = fetcher({ fetchImpl: async () => { fetched = true; return jsonResponse(doc()); } });
  await assertCimdError(service.fetch('http://client.example.com/metadata.json'), 'invalid_client_id');
  assert.equal(fetched, false);
}

async function testPrivateAddressesAreRefusedBeforeAnyRequest() {
  for (const address of ['10.0.0.5', '127.0.0.1', '169.254.169.254', '100.64.0.1', '192.168.1.1', 'fd00::1', '::ffff:10.0.0.1']) {
    let fetched = false;
    const service = new CimdFetcherService().configure({
      lookupFn: async () => [{ address }],
      fetchImpl: async () => { fetched = true; return jsonResponse(doc()); },
    });
    await assertCimdError(service.fetch(CLIENT_ID), 'unreachable');
    assert.equal(fetched, false, `no request to ${address}`);
  }
  // A mix of public and private addresses is refused too.
  const mixed = new CimdFetcherService().configure({
    lookupFn: async () => [{ address: '93.184.216.34' }, { address: '10.1.2.3' }],
    fetchImpl: async () => jsonResponse(doc()),
  });
  await assertCimdError(mixed.fetch(CLIENT_ID), 'unreachable');
  // An IP literal in the URL.
  const literal = fetcher({ fetchImpl: async () => jsonResponse(doc({ client_id: 'https://127.0.0.1/m' })) });
  await assertCimdError(literal.fetch('https://127.0.0.1/m'), 'unreachable');
}

async function testRedirectIsRefused() {
  const service = fetcher({
    fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'http://10.0.0.1/metadata.json' } }),
  });
  await assertCimdError(service.fetch(CLIENT_ID), 'redirect');
}

async function testOversizedDocumentIsRefused() {
  const big = JSON.stringify(doc({ padding: 'x'.repeat(CIMD_MAX_BYTES) }));
  const declared = fetcher({ fetchImpl: async () => new Response(big, { status: 200, headers: { 'content-length': String(big.length) } }) });
  await assertCimdError(declared.fetch(CLIENT_ID), 'too_large');
  // Streamed without a length: cut at the limit.
  const streamed = fetcher({
    fetchImpl: async () => new Response(new ReadableStream({
      start(controller) {
        for (let i = 0; i < 20; i += 1) controller.enqueue(new TextEncoder().encode('x'.repeat(1024)));
        controller.close();
      },
    }), { status: 200 }),
  });
  await assertCimdError(streamed.fetch(CLIENT_ID), 'too_large');
}

async function testOtherClientIdIsRefused() {
  const service = fetcher({ fetchImpl: async () => jsonResponse(doc({ client_id: 'https://evil.example.com/m' })) });
  await assertCimdError(service.fetch(CLIENT_ID), 'client_id_mismatch');
}

async function testSlowServerTimesOut() {
  const service = fetcher({
    timeoutMs: 50,
    fetchImpl: (_url: URL, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }),
  });
  await assertCimdError(service.fetch(CLIENT_ID), 'timeout');
}

async function testDocumentRules() {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ redirect_uris: [] }, 'no_redirect_uris'],
    [{ redirect_uris: ['http://client.example.com/callback'] }, 'no_redirect_uris'],
    [{ redirect_uris: ['https://client.example.com/cb#frag', 42] }, 'no_redirect_uris'],
    [{ token_endpoint_auth_method: 'client_secret_basic' }, 'not_public_client'],
    // Authentication declared with no public fallback: CIMD §8.2 requires it, this server has none.
    [{ token_endpoint_auth_method: 'private_key_jwt', jwks_uri: 'https://client.example.com/jwks.json' }, 'not_public_client'],
    [{ token_endpoint_auth_method: 'private_key_jwt', token_endpoint_auth_methods_supported: ['private_key_jwt'] }, 'not_public_client'],
    [{ token_endpoint_auth_method: 'client_secret_post', token_endpoint_auth_methods_supported: 'none' }, 'not_public_client'],
  ];
  for (const [overrides, pattern] of cases) {
    const service = fetcher({ fetchImpl: async () => jsonResponse(doc(overrides)) });
    await assertCimdError(service.fetch(CLIENT_ID), pattern);
  }
  const notJson = fetcher({ fetchImpl: async () => new Response('<html>', { status: 200 }) });
  await assertCimdError(notJson.fetch(CLIENT_ID), 'not_json');
  const notFound = fetcher({ fetchImpl: async () => new Response('', { status: 404 }) });
  await assertCimdError(notFound.fetch(CLIENT_ID), 'http_status');

  // Unusable redirect URIs are left out, the usable ones kept.
  const mixed = fetcher({
    fetchImpl: async () => jsonResponse(doc({ redirect_uris: ['http://client.example.com/cb', 'https://client.example.com/cb', `https://x.example/${'a'.repeat(600)}`] })),
  });
  assert.deepEqual((await mixed.fetch(CLIENT_ID)).redirect_uris, ['https://client.example.com/cb']);

  // Names cannot hide behind control or bidirectional characters.
  assert.equal(cleanClientName('Cla\u202eude\u0000 Code\n', 'x'), 'Claude Code');
  assert.equal(cleanClientName('\u200f\u2066', 'client.example.com'), 'client.example.com');
}

async function testClientsThatCanBePublic() {
  // ChatGPT declares private_key_jwt but also supports none: it is a public client here.
  const chatgpt = fetcher({ fetchImpl: async () => jsonResponse(CHATGPT_CLIENT_METADATA) });
  const metadata = await chatgpt.fetch(CHATGPT_CIMD);
  assert.equal(metadata.client_name, 'ChatGPT');
  assert.deepEqual(metadata.redirect_uris, [CHATGPT_REDIRECT]);
  for (const overrides of [
    { token_endpoint_auth_method: undefined },
    { token_endpoint_auth_method: 'client_secret_basic', token_endpoint_auth_methods_supported: ['client_secret_basic', 'none'] },
  ]) {
    const service = fetcher({ fetchImpl: async () => jsonResponse(doc(overrides)) });
    assert.equal((await service.fetch(CLIENT_ID)).client_id, CLIENT_ID, JSON.stringify(overrides));
  }
}

async function testOperatorAllowlistDoesNotApply() {
  const previous = process.env.SSRF_ALLOWED_HOSTS;
  process.env.SSRF_ALLOWED_HOSTS = 'client.example.com,10.0.0.5';
  try {
    let fetched = false;
    const service = new CimdFetcherService().configure({
      lookupFn: async () => [{ address: '10.0.0.5' }],
      fetchImpl: async () => { fetched = true; return jsonResponse(doc()); },
    });
    await assertCimdError(service.fetch(CLIENT_ID), 'unreachable');
    assert.equal(fetched, false, 'SSRF_ALLOWED_HOSTS opens nothing to a client metadata document');
  } finally {
    if (previous === undefined) delete process.env.SSRF_ALLOWED_HOSTS;
    else process.env.SSRF_ALLOWED_HOSTS = previous;
  }
}

async function testFailuresAreCachedForAMinute() {
  let now = 5_000_000;
  let calls = 0;
  const service = fetcher({ now: () => now, fetchImpl: async () => { calls += 1; return new Response('', { status: 500 }); } });
  await assertCimdError(service.fetch(CLIENT_ID), 'http_status');
  await assertCimdError(service.fetch(CLIENT_ID), 'http_status');
  assert.equal(calls, 1, 'the failure is remembered');
  now += CIMD_FAILURE_TTL_MS + 1;
  await assertCimdError(service.fetch(CLIENT_ID), 'http_status');
  assert.equal(calls, 2);
}

async function testFetchesInFlightAreCappedAndShared() {
  const release: Array<() => void> = [];
  let calls = 0;
  const service = fetcher({
    fetchImpl: (url: URL) => new Promise<Response>((resolve) => {
      calls += 1;
      release.push(() => resolve(jsonResponse(doc({ client_id: url.toString() }))));
    }),
  });
  const ids = Array.from({ length: CIMD_MAX_IN_FLIGHT }, (_, i) => `https://client${i}.example.com/m`);
  const running = ids.map((id) => service.fetch(id));
  // The same document asked again while it loads: one fetch for both.
  const shared = service.fetch(ids[0]);
  // One more document beyond the cap: refused at once, nothing fetched.
  await assertCimdError(service.fetch('https://one-too-many.example.com/m'), 'busy');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, CIMD_MAX_IN_FLIGHT);
  release.forEach((fn) => fn());
  const results = await Promise.all([...running, shared]);
  assert.equal(results[CIMD_MAX_IN_FLIGHT].client_id, ids[0]);
  // Slots free again.
  release.length = 0;
  const later = service.fetch('https://one-too-many.example.com/m');
  await new Promise((resolve) => setImmediate(resolve));
  release.forEach((fn) => fn());
  assert.equal((await later).client_id, 'https://one-too-many.example.com/m');
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
  assert.equal(normalizeScope('mcp:read offline_access'), 'mcp:read', 'offline_access is accepted and ignored');

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
  await testClientsThatCanBePublic();
  await testOperatorAllowlistDoesNotApply();
  await testFailuresAreCachedForAMinute();
  await testFetchesInFlightAreCappedAndShared();
  testUrlHelpers();
  // eslint-disable-next-line no-console
  console.log('cimd-fetcher.spec: OK');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
