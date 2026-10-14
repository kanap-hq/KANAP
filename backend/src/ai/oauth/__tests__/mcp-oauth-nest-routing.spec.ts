import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import * as http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { SecurityEventsService } from '../../../audit/security-events.service';
import { buildAccessTokenPayload } from '../../../auth/auth.service';
import { ISSUED_TOKEN_ALGORITHM } from '../../../auth/jwt-algorithms';
import { createBodyParsers } from '../../../common/body-parsers';
import { RATE_LIMITS } from '../../../common/rate-limit';
import { Features } from '../../../config/features';
import { CimdFetcherService } from '../cimd-fetcher.service';
import { McpOAuthController, McpOAuthMetadataController } from '../mcp-oauth.controller';
import { McpOAuthService } from '../mcp-oauth.service';
import { s256Challenge } from '../mcp-oauth.util';

// The OAuth controllers inside a real Nest application: routing of the dotted /.well-known
// paths, guards (JwtAuthGuard, the throttler and its per-tenant tracker on /token), body parsers
// (form-encoded token requests), status codes, and the authorization endpoint that never sends
// the browser to the client, whatever the client's metadata document lists. The database side is
// stubbed: the flow spec covers it.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'mcp-oauth-nest-spec-secret';
process.env.RATE_LIMIT_ENABLED = 'true';
// A configured deployment: without any origin configured, development opens every origin.
process.env.CORS_ORIGINS = 'https://*.kanap.test';
Logger.overrideLogger(['error']);

const EVIL = 'https://evil.example/cimd.json';
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const USER = randomUUID();
const HOSTS: Record<string, string> = { 'acme.kanap.test': TENANT_A, 'beta.kanap.test': TENANT_B };

let port = 0;

function request(method: string, path: string, headers: Record<string, string> = {}, body?: string) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string; json: any }>((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path, headers: { host: 'acme.kanap.test', 'x-forwarded-proto': 'https', ...headers } },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          let json: any = null;
          try { json = data ? JSON.parse(data) : null; } catch { json = null; }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data, json });
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  const mcpFlag = Features.AI_MCP_ENABLED;
  (Features as any).AI_MCP_ENABLED = true;
  const cimd = new CimdFetcherService().configure({
    lookupFn: async () => [{ address: '93.184.216.34' }],
    fetchImpl: async () => new Response(JSON.stringify({
      client_id: EVIL,
      client_name: 'Claude',
      redirect_uris: ['https://evil.example/login'],
    }), { status: 200 }),
  });
  const oauth = new McpOAuthService(
    { ownerMayAuthenticate: () => true, logAudit: async () => undefined } as any,
    { findById: async () => ({ id: USER, status: 'enabled', role: { role_name: 'Custom', is_system: false } }) } as any,
    { assertSurfaceAccess: async () => undefined } as any,
    { find: async () => null } as any,
    { run: async (_tenant: string, fn: any) => fn({ query: async () => [] }) } as any,
    cimd,
  );
  const events: any[] = [];

  @Module({
    imports: [ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 1000 }] })],
    controllers: [McpOAuthMetadataController, McpOAuthController],
    providers: [
      { provide: McpOAuthService, useValue: oauth },
      { provide: SecurityEventsService, useValue: { recordAuthEvent: async (tenantId: string, event: any) => { events.push({ tenantId, ...event }); } } },
    ],
  })
  class RoutingModule {}

  const app = await NestFactory.create(RoutingModule, { bodyParser: false, logger: false });
  app.use((req: any, _res: any, next: any) => {
    const tenantId = HOSTS[String(req.headers.host)];
    req.tenant = tenantId ? { id: tenantId, slug: String(req.headers.host).split('.')[0] } : null;
    next();
  });
  app.use(...createBodyParsers());
  await app.listen(0, '127.0.0.1');
  port = (app.getHttpServer().address() as any).port;

  try {
    // Discovery under its dotted paths.
    const prm = await request('GET', '/.well-known/oauth-protected-resource/api/ai/mcp');
    assert.equal(prm.status, 200, prm.body);
    assert.equal(prm.json.resource, 'https://acme.kanap.test/api/ai/mcp');
    assert.equal((await request('GET', '/.well-known/oauth-protected-resource')).status, 200);
    const as = await request('GET', '/.well-known/oauth-authorization-server');
    assert.equal(as.json.issuer, 'https://acme.kanap.test');
    assert.equal((await request('GET', '/.well-known/oauth-authorization-server', { host: 'nobody.kanap.test' })).status, 404);

    // The authorization endpoint sends every usable request to KANAP's page, never to the client.
    const verifier = randomBytes(32).toString('base64url');
    const base = {
      client_id: EVIL,
      redirect_uri: 'https://evil.example/login',
      state: 's',
      code_challenge: s256Challenge(verifier),
      code_challenge_method: 'S256',
      resource: 'https://acme.kanap.test/api/ai/mcp',
    };
    for (const responseType of ['code', 'x']) {
      const query = new URLSearchParams({ ...base, response_type: responseType }).toString();
      const authorize = await request('GET', `/oauth/authorize?${query}`);
      assert.equal(authorize.status, 302, authorize.body);
      assert.equal(authorize.headers.location, `https://acme.kanap.test/oauth/authorize?${query}`);
      assert.equal(authorize.headers['cache-control'], 'no-store');
    }
    const malformed = await request('GET', `/oauth/authorize?${new URLSearchParams({ client_id: EVIL })}`);
    assert.equal(malformed.status, 400);
    assert.equal(malformed.json.error, 'invalid_request');

    // The consent routes need the web session.
    const query = new URLSearchParams({ ...base, response_type: 'code' }).toString();
    assert.equal((await request('GET', `/oauth/authorize/request?${query}`)).status, 401);
    const session = jwt.sign(buildAccessTokenPayload({ id: USER, email: 'u@example.invalid', tenant_id: TENANT_A }), process.env.JWT_SECRET!, {
      algorithm: ISSUED_TOKEN_ALGORITHM,
      expiresIn: 600,
    });
    const described = await request('GET', `/oauth/authorize/request?${query}`, { authorization: `Bearer ${session}` });
    assert.equal(described.status, 200, described.body);
    const shownError = await request('GET', `/oauth/authorize/request?${new URLSearchParams({ ...base, response_type: 'x' })}`, { authorization: `Bearer ${session}` });
    assert.equal(shownError.status, 400);
    assert.equal(shownError.json.error, 'unsupported_response_type');

    // The decision: 200, from the app's origin only; a refusal is a security event.
    const decisionBody = (approve: boolean) => JSON.stringify({ ...base, response_type: 'code', approve, remember: false });
    const json = { authorization: `Bearer ${session}`, 'content-type': 'application/json' };
    const foreign = await request('POST', '/oauth/authorize/decision', { ...json, origin: 'https://evil.example' }, decisionBody(true));
    assert.equal(foreign.status, 403);
    const approved = await request('POST', '/oauth/authorize/decision', json, decisionBody(true));
    assert.equal(approved.status, 200, approved.body);
    assert.ok(new URL(approved.json.redirect_to).searchParams.get('code'));
    const refused = await request('POST', '/oauth/authorize/decision', json, decisionBody(false));
    assert.equal(refused.status, 200);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(events, [{ tenantId: TENANT_A, action: 'mcp_connection_refused', userId: USER }]);

    // The token endpoint reads form-encoded bodies and answers OAuth errors as JSON.
    const form = { 'content-type': 'application/x-www-form-urlencoded' };
    const token = await request('POST', '/oauth/token', form, 'grant_type=authorization_code&code=x');
    assert.equal(token.status, 400);
    assert.equal(token.json.error, 'invalid_grant');
    assert.equal(token.headers['cache-control'], 'no-store');

    // Its budget is counted per address and tenant: one tenant's traffic leaves the other's alone.
    let last = token;
    for (let i = 1; i < RATE_LIMITS.mcpOAuthToken.limit + 1; i += 1) {
      last = await request('POST', '/oauth/token', form, 'grant_type=refresh_token&refresh_token=x');
    }
    assert.equal(last.status, 429, 'tenant A is over its budget');
    const otherTenant = await request('POST', '/oauth/token', { ...form, host: 'beta.kanap.test' }, 'grant_type=refresh_token&refresh_token=x');
    assert.equal(otherTenant.status, 400, 'tenant B, same address, still has its own');

    // The authorization routes are limited per address.
    let authorize = await request('GET', `/oauth/authorize?${query}`);
    for (let i = 0; i < RATE_LIMITS.mcpOAuthAuthorize.limit; i += 1) {
      authorize = await request('GET', `/oauth/authorize?${query}`);
    }
    assert.equal(authorize.status, 429);
    // eslint-disable-next-line no-console
    console.log('mcp-oauth-nest-routing.spec: OK');
  } finally {
    await app.close();
    (Features as any).AI_MCP_ENABLED = mcpFlag;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
