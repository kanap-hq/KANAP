import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import * as express from 'express';
import * as jwt from 'jsonwebtoken';
import { ForbiddenException, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import dataSource from '../../../data-source';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { buildAccessTokenPayload } from '../../../auth/auth.service';
import { ISSUED_TOKEN_ALGORITHM } from '../../../auth/jwt-algorithms';
import { createBodyParsers } from '../../../common/body-parsers';
import { Features } from '../../../config/features';
import { User } from '../../../users/user.entity';
import { AiApiKey } from '../../ai-api-key.entity';
import { AiApiKeysService } from '../../ai-api-keys.service';
import { AiMcpController } from '../../ai-mcp.controller';
import { McpApiKeyAuthGuard } from '../../auth/mcp-api-key-auth.guard';
import { McpApiKeyHashService } from '../../auth/mcp-api-key-hash.service';
import { parseMcpApiKeyPolicy } from '../../control-plane/mcp/ai-mcp-access-policy';
import { AiTenantExecutionService } from '../../execution/ai-tenant-execution.service';
import { CimdFetcherService } from '../cimd-fetcher.service';
import { McpOAuthController, McpOAuthMetadataController } from '../mcp-oauth.controller';
import { McpOAuthService } from '../mcp-oauth.service';
import { s256Challenge } from '../mcp-oauth.util';
import { signAccessToken } from '../mcp-oauth-tokens';

// The MCP OAuth connector end to end, over real HTTP and a real database (ai_api_keys under
// FORCE RLS): 401 + WWW-Authenticate → protected resource metadata → authorization server
// metadata → authorize → decision → token → tools/list with the token → rotating refresh, and
// the refusals around it (PKCE, resource, redirect, code and refresh replay, revocation, tenant
// isolation, token families, remembered consent). The controllers and guards are the real ones;
// the AI policy, settings and tool listing are stubbed, CIMD documents are served in memory.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'mcp-oauth-flow-spec-secret';

const TAG = randomBytes(4).toString('hex');
const CLAUDE_CIMD = 'https://claude.ai/oauth/claude-code-client-metadata';
const WEB_CIMD = 'https://client.example.com/oauth/metadata.json';
const WEB_REDIRECT = 'https://client.example.com/api/mcp/auth_callback';
const CIMD_DOCUMENTS: Record<string, unknown> = {
  [CLAUDE_CIMD]: {
    client_id: CLAUDE_CIMD,
    client_name: 'Claude Code',
    redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
    token_endpoint_auth_method: 'none',
  },
  [WEB_CIMD]: {
    client_id: WEB_CIMD,
    client_name: 'Web client',
    redirect_uris: [WEB_REDIRECT],
    token_endpoint_auth_method: 'none',
  },
};

type Seed = { tenantId: string; host: string; userId: string; email: string; roleId: string };

async function seedTenant(label: string): Promise<Seed> {
  const tenantId = randomUUID();
  const roleId = randomUUID();
  const userId = randomUUID();
  const slug = `oauth-${label}-${TAG}`;
  const email = `${slug}@example.invalid`;
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  try {
    await runner.startTransaction();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'OAuth spec', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, slug],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    await runner.query(
      `INSERT INTO roles (id, tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
       VALUES ($1, $2, $3, 'OAuth spec role', false, false, now(), now())`,
      [roleId, tenantId, `OAuth ${label} ${TAG}`],
    );
    await runner.query(
      `INSERT INTO users (id, tenant_id, email, role_id, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'enabled', now(), now())`,
      [userId, tenantId, email, roleId],
    );
    await runner.commitTransaction();
  } finally {
    await runner.release();
  }
  return { tenantId, host: `${slug}.kanap.test`, userId, email, roleId };
}

async function addUser(seed: Seed, label: string): Promise<string> {
  const userId = randomUUID();
  await new AiTenantExecutionService(dataSource).run(seed.tenantId, (manager) => manager.query(
    `INSERT INTO users (id, tenant_id, email, role_id, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'enabled', now(), now())`,
    [userId, seed.tenantId, `${label}-${seed.email}`, seed.roleId],
  ));
  return userId;
}

async function cleanup(seeds: Seed[]) {
  const executor = new AiTenantExecutionService(dataSource);
  for (const seed of seeds) {
    try {
      await executor.run(seed.tenantId, async (manager) => {
        await manager.query(`DELETE FROM ai_api_keys WHERE tenant_id = $1`, [seed.tenantId]);
        await manager.query(`DELETE FROM audit_log WHERE tenant_id = $1`, [seed.tenantId]).catch(() => undefined);
      });
    } catch {
      // best effort: the tag keeps the rows of this run apart
    }
  }
}

type Harness = {
  baseUrl: string;
  audits: any[];
  deniedUsers: Set<string>;
  settings: { mcp_key_max_lifetime_days: number | null };
  events: any[];
  close(): Promise<void>;
};

async function startHarness(seeds: Seed[]): Promise<Harness> {
  const executor = new AiTenantExecutionService(dataSource);
  const audits: any[] = [];
  const deniedUsers = new Set<string>();
  const users = {
    findById: (id: string, opts?: { manager?: any }) =>
      (opts?.manager ?? dataSource.manager).getRepository(User).findOne({ where: { id }, relations: ['role'] }),
  } as any;
  const settings = { mcp_key_max_lifetime_days: null as number | null };
  const aiSettings = { find: async () => ({ ...settings }) } as any;
  const events: any[] = [];
  const apiKeys = new AiApiKeysService(
    dataSource.getRepository(AiApiKey),
    users,
    new McpApiKeyHashService(),
    aiSettings,
    { log: async (params: any) => { audits.push(params); } } as any,
    executor,
  );
  const policy = {
    assertSurfaceAccess: async (context: any) => {
      if (deniedUsers.has(context.userId)) throw new ForbiddenException('AI MCP access is disabled for this tenant.');
    },
  } as any;
  const cimd = new CimdFetcherService().configure({
    lookupFn: async () => [{ address: '93.184.216.34' }],
    fetchImpl: async (url: URL) => {
      const body = CIMD_DOCUMENTS[url.toString()];
      return body ? new Response(JSON.stringify(body), { status: 200 }) : new Response('', { status: 404 });
    },
  });
  const oauth = new McpOAuthService(apiKeys, users, policy, aiSettings, executor, cimd);
  const metadata = new McpOAuthMetadataController();
  const controller = new McpOAuthController(oauth, {
    recordAuthEvent: async (tenantId: string, event: any) => { events.push({ tenantId, ...event }); },
  } as any);
  const mcpGuard = new McpApiKeyAuthGuard(apiKeys, executor, oauth);
  const sessionGuard = new JwtAuthGuard(new Reflector());
  const mcp = new AiMcpController(
    { execute: async () => ({ output: {} }) } as any,
    {
      parsePolicy: (apiKey: any) => parseMcpApiKeyPolicy({
        mcp_scopes_json: apiKey.mcp_scopes,
        mcp_capability_allowlist_json: apiKey.mcp_allowed_capabilities,
        mcp_capability_denylist_json: apiKey.mcp_denied_capabilities,
        mcp_max_effect: apiKey.mcp_max_effect,
        mcp_rate_limit_per_minute: apiKey.mcp_rate_limit_per_minute,
      }),
      assertPostAccess: async () => undefined,
      listToolJsonSchemas: async () => [{ name: 'search_all', description: 'Search KANAP.', parameters: { type: 'object' } }],
      assertCanExecute: async () => ({}),
    } as any,
    {} as any,
    { assertAllowed: () => undefined } as any,
    { runWithContext: async (context: any, fn: Function) => fn({ ...context, manager: {} }) } as any,
    {} as any,
    { tryResolve: async () => ({ source: 'registry' }) } as any,
    {} as any,
    {} as any,
  );

  const byHost = new Map(seeds.map((seed) => [seed.host, seed]));
  const app = express();
  // Node's fetch drops a custom Host header: the spec names the host in x-test-host.
  app.use((req: any, _res, next) => {
    const host = String(req.headers['x-test-host'] ?? '');
    req.headers.host = host;
    req.headers['x-forwarded-proto'] = 'https';
    const seed = byHost.get(host);
    req.tenant = seed ? { id: seed.tenantId, slug: host.split('.')[0], name: 'OAuth spec' } : null;
    next();
  });
  app.use(...createBodyParsers());
  const ctx = (req: any, res: any) => ({ switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }), getHandler: () => function handler() {}, getClass: () => class Route {} }) as any;
  const wrap = (fn: (req: any, res: any) => Promise<unknown> | unknown, opts: { session?: boolean; json?: boolean } = {}) =>
    async (req: any, res: any, next: any) => {
      try {
        if (opts.session) sessionGuard.canActivate(ctx(req, res));
        const result = await fn(req, res);
        if (opts.json && !res.headersSent) res.json(result);
      } catch (error) {
        next(error);
      }
    };
  app.get('/.well-known/oauth-protected-resource/api/ai/mcp', wrap((req) => metadata.protectedResourceForPath(req), { json: true }));
  app.get('/.well-known/oauth-protected-resource', wrap((req) => metadata.protectedResourceAtRoot(req), { json: true }));
  app.get('/.well-known/oauth-authorization-server', wrap((req) => metadata.authorizationServer(req), { json: true }));
  app.get('/oauth/authorize', wrap((req, res) => controller.authorize(req, req.query, res)));
  app.get('/oauth/authorize/request', wrap((req, res) => controller.describe(req, req.query, res), { session: true, json: true }));
  app.post('/oauth/authorize/decision', wrap((req, res) => controller.decide(req, req.body, res), { session: true, json: true }));
  app.post('/oauth/token', wrap((req, res) => controller.token(req, req.body, res)));
  app.post('/oauth/revoke', wrap((req, res) => controller.revoke(req, req.body, res)));
  app.post('/ai/mcp', wrap(async (req, res) => {
    await mcpGuard.canActivate(ctx(req, res));
    await mcp.handlePost(req, res);
  }));
  app.post('/session-only', wrap((req) => ({ sub: req.user.sub }), { session: true, json: true }));
  app.use((error: any, _req: any, res: any, _next: any) => {
    if (error instanceof HttpException) {
      const body = error.getResponse();
      res.status(error.getStatus()).json(typeof body === 'string' ? { message: body } : body);
      return;
    }
    console.error(error);
    res.status(500).json({ message: String(error?.message ?? error) });
  });

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    audits,
    deniedUsers,
    settings,
    events,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

let harness: Harness;

async function call(
  host: string,
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string; form?: Record<string, string>; json?: unknown } = {},
) {
  const headers: Record<string, string> = { 'x-test-host': host, ...(init.headers ?? {}) };
  let body = init.body;
  if (init.form) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(init.form).toString();
  } else if (init.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.json);
  }
  const response = await fetch(`${harness.baseUrl}${path}`, {
    method: init.method ?? (body ? 'POST' : 'GET'),
    headers,
    body,
    redirect: 'manual',
  });
  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, headers: response.headers, data, text };
}

function sessionToken(seed: Seed, userId = seed.userId) {
  return jwt.sign(buildAccessTokenPayload({ id: userId, email: seed.email, tenant_id: seed.tenantId }), process.env.JWT_SECRET!, {
    algorithm: ISSUED_TOKEN_ALGORITHM,
    expiresIn: 600,
  });
}

const origin = (seed: Seed) => `https://${seed.host}`;
const resource = (seed: Seed) => `${origin(seed)}/api/ai/mcp`;

function authorizationParams(seed: Seed, overrides: Record<string, string | undefined> = {}) {
  const verifier = randomBytes(32).toString('base64url');
  const params: Record<string, string> = {
    response_type: 'code',
    client_id: CLAUDE_CIMD,
    redirect_uri: 'http://localhost:53682/callback',
    code_challenge: s256Challenge(verifier),
    code_challenge_method: 'S256',
    state: `state-${randomBytes(4).toString('hex')}`,
    scope: 'mcp:read',
    resource: resource(seed),
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete params[key];
    else params[key] = value;
  }
  return { params, verifier };
}

/** Approves an authorization request as the user and returns the code from the redirect. */
async function approve(seed: Seed, params: Record<string, string>, opts: { remember?: boolean; userId?: string } = {}) {
  const decision = await call(seed.host, '/oauth/authorize/decision', {
    headers: { authorization: `Bearer ${sessionToken(seed, opts.userId)}` },
    json: { ...params, approve: true, remember: opts.remember ?? true },
  });
  assert.equal(decision.status, 200, decision.text);
  const redirect = new URL(decision.data.redirect_to);
  assert.equal(redirect.searchParams.get('state'), params.state);
  assert.equal(redirect.searchParams.get('iss'), origin(seed));
  const code = redirect.searchParams.get('code');
  assert.ok(code, decision.text);
  return code!;
}

async function exchange(seed: Seed, code: string, params: Record<string, string>, verifier: string, overrides: Record<string, string | undefined> = {}) {
  const form: Record<string, string> = {
    grant_type: 'authorization_code',
    code,
    redirect_uri: params.redirect_uri,
    client_id: params.client_id,
    code_verifier: verifier,
    resource: params.resource,
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete form[key];
    else form[key] = value;
  }
  return call(seed.host, '/oauth/token', { form });
}

async function connect(seed: Seed, opts: { remember?: boolean; userId?: string; clientId?: string; redirectUri?: string } = {}) {
  const { params, verifier } = authorizationParams(seed, {
    ...(opts.clientId ? { client_id: opts.clientId } : {}),
    ...(opts.redirectUri ? { redirect_uri: opts.redirectUri } : {}),
  });
  const code = await approve(seed, params, opts);
  const token = await exchange(seed, code, params, verifier);
  assert.equal(token.status, 200, token.text);
  return token.data as { access_token: string; refresh_token: string; expires_in: number; token_type: string; scope: string };
}

async function toolsList(seed: Seed, bearer: string | null, host = seed.host) {
  return call(host, '/ai/mcp', {
    headers: {
      accept: 'application/json, text/event-stream',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    json: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
  });
}

async function grantRow(seed: Seed, where: string, params: unknown[]): Promise<any> {
  return new AiTenantExecutionService(dataSource).run(seed.tenantId, async (manager) => {
    const [row] = await manager.query(`SELECT * FROM ai_api_keys WHERE tenant_id = $1 AND ${where}`, [seed.tenantId, ...params]);
    return row ?? null;
  });
}

// ---------------------------------------------------------------- cases

async function testFullFlow(a: Seed) {
  // 1. No credential: 401 and the challenge that starts the sign-in.
  const unauthenticated = await toolsList(a, null);
  assert.equal(unauthenticated.status, 401);
  assert.equal(
    unauthenticated.headers.get('www-authenticate'),
    `Bearer resource_metadata="${origin(a)}/.well-known/oauth-protected-resource/api/ai/mcp", scope="mcp:read"`,
  );

  // 2. Protected resource metadata, path and root forms.
  for (const path of ['/.well-known/oauth-protected-resource/api/ai/mcp', '/.well-known/oauth-protected-resource']) {
    const prm = await call(a.host, path);
    assert.equal(prm.status, 200, prm.text);
    assert.deepEqual(prm.data.resource, resource(a));
    assert.deepEqual(prm.data.authorization_servers, [origin(a)]);
    assert.deepEqual(prm.data.scopes_supported, ['mcp:read']);
  }

  // 3. Authorization server metadata.
  const as = await call(a.host, '/.well-known/oauth-authorization-server');
  assert.equal(as.status, 200);
  assert.equal(as.data.issuer, origin(a));
  assert.equal(as.data.authorization_endpoint, `${origin(a)}/api/oauth/authorize`);
  assert.equal(as.data.token_endpoint, `${origin(a)}/api/oauth/token`);
  assert.deepEqual(as.data.code_challenge_methods_supported, ['S256']);
  assert.deepEqual(as.data.token_endpoint_auth_methods_supported, ['none']);
  assert.equal(as.data.client_id_metadata_document_supported, true);
  assert.equal(as.data.authorization_response_iss_parameter_supported, true);

  // 4. Authorize: validated, then sent to the web app's consent page with the same parameters.
  const { params, verifier } = authorizationParams(a);
  const query = new URLSearchParams(params).toString();
  const authorize = await call(a.host, `/oauth/authorize?${query}`);
  assert.equal(authorize.status, 302, authorize.text);
  assert.equal(authorize.headers.get('location'), `${origin(a)}/oauth/authorize?${query}`);

  // 5. The consent screen's request: first connection, so no automatic approval.
  const described = await call(a.host, `/oauth/authorize/request?${query}`, { headers: { authorization: `Bearer ${sessionToken(a)}` } });
  assert.equal(described.status, 200, described.text);
  assert.equal(described.data.client.client_name, 'Claude Code');
  assert.equal(described.data.redirect_host, 'localhost');
  assert.equal(described.data.loopback_redirect, true);
  assert.equal(described.data.auto_approve, false);

  // 6. Decision, 7. token.
  const code = await approve(a, params, { remember: true });
  const token = await exchange(a, code, params, verifier);
  assert.equal(token.status, 200, token.text);
  assert.equal(token.headers.get('cache-control'), 'no-store');
  assert.equal(token.data.token_type, 'Bearer');
  assert.equal(token.data.expires_in, 900);
  assert.equal(token.data.scope, 'mcp:read');
  assert.match(token.data.refresh_token, /^kanap_mcprt_[a-f0-9]{12}_/);
  const claims = jwt.decode(token.data.access_token) as any;
  assert.equal(claims.aud, resource(a));
  assert.equal(claims.iss, origin(a));
  assert.equal(claims.tenant_id, a.tenantId);
  assert.equal(claims.sub, a.userId);

  const row = await grantRow(a, 'id = $2', [claims.grant]);
  assert.equal(row.credential_kind, 'oauth');
  assert.equal(row.oauth_client_id, CLAUDE_CIMD);
  assert.equal(row.oauth_client_name, 'Claude Code');
  const view = new AiApiKeysService({} as any, {} as any, new McpApiKeyHashService(), {} as any).toView(row);
  assert.equal(view.credential_kind, 'oauth');
  assert.equal(view.oauth_client_id, CLAUDE_CIMD);
  assert.equal(view.oauth_redirect_host, 'localhost');
  assert.equal('key_hash' in view, false);
  assert.equal(row.label, 'Claude Code');
  assert.equal(row.oauth_redirect_uri, params.redirect_uri);
  assert.equal(row.oauth_remember, true);
  assert.equal(row.user_id, a.userId);
  assert.ok(row.expires_at.getTime() > Date.now() + 89 * 86_400_000);
  assert.ok(harness.audits.some((entry) => entry.recordId === row.id && entry.action === 'create' && entry.after?.oauth === 'granted'));

  // 8. tools/list with the access token.
  const listed = await toolsList(a, token.data.access_token);
  assert.equal(listed.status, 200, listed.text);
  assert.match(listed.text, /search_all/);
  assert.match(listed.text, /"readOnlyHint":true/);

  // 9. Rotating refresh: a new pair, the old refresh token refused and the grant revoked.
  const refreshed = await call(a.host, '/oauth/token', {
    form: { grant_type: 'refresh_token', refresh_token: token.data.refresh_token, client_id: CLAUDE_CIMD, resource: resource(a) },
  });
  assert.equal(refreshed.status, 200, refreshed.text);
  assert.notEqual(refreshed.data.refresh_token, token.data.refresh_token);
  assert.equal(refreshed.data.refresh_token.slice(0, 25), token.data.refresh_token.slice(0, 25), 'the grant prefix stays');
  assert.equal((await toolsList(a, refreshed.data.access_token)).status, 200);
  const rotatedRow = await grantRow(a, 'id = $2', [claims.grant]);
  assert.ok(rotatedRow.refresh_rotated_at.getTime() >= row.refresh_rotated_at.getTime());

  // The same token again right away (a lost answer): the same successor, nothing revoked.
  const retried = await call(a.host, '/oauth/token', {
    form: { grant_type: 'refresh_token', refresh_token: token.data.refresh_token, client_id: CLAUDE_CIMD },
  });
  assert.equal(retried.status, 200, retried.text);
  assert.equal(retried.data.refresh_token, refreshed.data.refresh_token, 'a retry gets the same successor');
  assert.equal((await grantRow(a, 'id = $2', [claims.grant])).revoked_at, null);

  // One rotation further, the first token is two generations old: a replay.
  const third = await call(a.host, '/oauth/token', {
    form: { grant_type: 'refresh_token', refresh_token: refreshed.data.refresh_token },
  });
  assert.equal(third.status, 200, third.text);
  const replayed = await call(a.host, '/oauth/token', {
    form: { grant_type: 'refresh_token', refresh_token: token.data.refresh_token, client_id: CLAUDE_CIMD },
  });
  assert.equal(replayed.status, 400);
  assert.equal(replayed.data.error, 'invalid_grant');
  const revokedRow = await grantRow(a, 'id = $2', [claims.grant]);
  assert.ok(revokedRow.revoked_at, 'a replayed refresh token revokes the connection');
  assert.equal(revokedRow.revocation_reason, 'oauth_refresh_replayed');
  // Everything of that grant is dead now, the newest pair included.
  assert.equal((await toolsList(a, third.data.access_token)).status, 401);
  const afterReplay = await call(a.host, '/oauth/token', {
    form: { grant_type: 'refresh_token', refresh_token: third.data.refresh_token },
  });
  assert.equal(afterReplay.data.error, 'invalid_grant');
  // Rotations within the hour of the creation leave no "refreshed" audit row (see below).
  assert.equal(harness.audits.filter((entry) => entry.recordId === claims.grant && entry.after?.oauth === 'refreshed').length, 0);
}

async function testRefreshAuditIsAggregated(a: Seed) {
  const token = await connect(a);
  const grantId = (jwt.decode(token.access_token) as any).grant;
  const refreshedRows = () => harness.audits.filter((entry) => entry.recordId === grantId && entry.after?.oauth === 'refreshed').length;
  await new AiTenantExecutionService(dataSource).run(a.tenantId, (manager) => manager.query(
    `UPDATE ai_api_keys SET refresh_rotated_at = now() - interval '2 hours' WHERE tenant_id = $1 AND id = $2`,
    [a.tenantId, grantId],
  ));
  let current = token.refresh_token;
  for (let i = 0; i < 3; i += 1) {
    const next = await call(a.host, '/oauth/token', { form: { grant_type: 'refresh_token', refresh_token: current } });
    assert.equal(next.status, 200, next.text);
    current = next.data.refresh_token;
  }
  assert.equal(refreshedRows(), 1, 'one row for the rotations of an hour');
}

async function testRefreshRetriesAndRaces(a: Seed) {
  // Two refreshes with one token at the same time: both answered, with the same successor.
  for (let i = 0; i < 3; i += 1) {
    const token = await connect(a);
    const form = { grant_type: 'refresh_token', refresh_token: token.refresh_token };
    const [one, two] = await Promise.all([call(a.host, '/oauth/token', { form }), call(a.host, '/oauth/token', { form })]);
    assert.equal(one.status, 200, one.text);
    assert.equal(two.status, 200, two.text);
    assert.equal(one.data.refresh_token, two.data.refresh_token);
    const grantId = (jwt.decode(token.access_token) as any).grant;
    assert.equal((await grantRow(a, 'id = $2', [grantId])).revoked_at, null, 'a race revokes nothing');
    assert.equal((await call(a.host, '/oauth/token', { form: { grant_type: 'refresh_token', refresh_token: one.data.refresh_token } })).status, 200);
  }

  // A retry after the window is a replay.
  const token = await connect(a);
  const grantId = (jwt.decode(token.access_token) as any).grant;
  const next = await call(a.host, '/oauth/token', { form: { grant_type: 'refresh_token', refresh_token: token.refresh_token } });
  assert.equal(next.status, 200);
  await new AiTenantExecutionService(dataSource).run(a.tenantId, (manager) => manager.query(
    `UPDATE ai_api_keys SET refresh_rotated_at = now() - interval '2 minutes' WHERE tenant_id = $1 AND id = $2`,
    [a.tenantId, grantId],
  ));
  const late = await call(a.host, '/oauth/token', { form: { grant_type: 'refresh_token', refresh_token: token.refresh_token } });
  assert.equal(late.data.error, 'invalid_grant');
  assert.equal((await grantRow(a, 'id = $2', [grantId])).revocation_reason, 'oauth_refresh_replayed');
}

async function testRefreshChecksTheGrantAndItsOwnerOnly(a: Seed) {
  // A passing refusal of MCP access (provider being set up, MCP off for a while) does not end
  // the connection: the MCP endpoint refuses requests meanwhile, the refresh goes on.
  const token = await connect(a);
  harness.deniedUsers.add(a.userId);
  let refreshed: any;
  try {
    refreshed = await call(a.host, '/oauth/token', { form: { grant_type: 'refresh_token', refresh_token: token.refresh_token } });
    assert.equal(refreshed.status, 200, refreshed.text);
  } finally {
    harness.deniedUsers.delete(a.userId);
  }

  // A disabled owner: refused, and the grant stays (enabling the account again brings it back).
  const userId = await addUser(a, 'disabled');
  const owned = await connect(a, { userId });
  const executor = new AiTenantExecutionService(dataSource);
  await executor.run(a.tenantId, (manager) => manager.query(`UPDATE users SET status = 'disabled' WHERE tenant_id = $1 AND id = $2`, [a.tenantId, userId]));
  const refused = await call(a.host, '/oauth/token', { form: { grant_type: 'refresh_token', refresh_token: owned.refresh_token } });
  assert.equal(refused.data.error, 'invalid_grant');
  assert.equal((await toolsList(a, owned.access_token)).status, 401, 'nor does its access token open MCP');
  await executor.run(a.tenantId, (manager) => manager.query(`UPDATE users SET status = 'enabled' WHERE tenant_id = $1 AND id = $2`, [a.tenantId, userId]));
  assert.equal((await call(a.host, '/oauth/token', { form: { grant_type: 'refresh_token', refresh_token: owned.refresh_token } })).status, 200);

  // A refresh whose expiry would not be in the future: refused.
  const short = await connect(a);
  const grantId = (jwt.decode(short.access_token) as any).grant;
  await executor.run(a.tenantId, (manager) => manager.query(
    `UPDATE ai_api_keys SET created_at = now() - interval '2 days' WHERE tenant_id = $1 AND id = $2`, [a.tenantId, grantId]));
  harness.settings.mcp_key_max_lifetime_days = 1;
  try {
    const expired = await call(a.host, '/oauth/token', { form: { grant_type: 'refresh_token', refresh_token: short.refresh_token } });
    assert.equal(expired.data.error, 'invalid_grant');
  } finally {
    harness.settings.mcp_key_max_lifetime_days = null;
  }
}

async function testOldGrantsOfAClientAreRetired(a: Seed) {
  const userId = await addUser(a, 'many');
  const tokens = [];
  for (let i = 0; i < 6; i += 1) tokens.push(await connect(a, { userId }));
  const first = await grantRow(a, 'id = $2', [(jwt.decode(tokens[0].access_token) as any).grant]);
  assert.equal(first.revocation_reason, 'oauth_superseded', 'the sixth connection retires the oldest');
  for (const token of tokens.slice(1)) assert.equal((await toolsList(a, token.access_token)).status, 200);
}

async function testForgedRefreshTokenDoesNotRevoke(a: Seed) {
  const token = await connect(a);
  const forged = token.refresh_token.replace(/_[A-Za-z0-9_-]{43}$/, `_${'A'.repeat(43)}`);
  const refused = await call(a.host, '/oauth/token', { form: { grant_type: 'refresh_token', refresh_token: forged } });
  assert.equal(refused.data.error, 'invalid_grant');
  const claims = jwt.decode(token.access_token) as any;
  assert.equal((await grantRow(a, 'id = $2', [claims.grant])).revoked_at, null, 'a forged token is only refused');
  assert.equal((await toolsList(a, token.access_token)).status, 200);
}

async function testAuthorizeRefusals(a: Seed) {
  const session = { authorization: `Bearer ${sessionToken(a)}` };
  const expectError = async (overrides: Record<string, string | undefined>, error: string, backToClient: boolean) => {
    const { params } = authorizationParams(a, overrides);
    const query = new URLSearchParams(params).toString();
    // The authorization endpoint sends every usable request to KANAP's own page, never to the client.
    const authorize = await call(a.host, `/oauth/authorize?${query}`);
    assert.equal(authorize.status, 302, `${error}: ${authorize.text}`);
    assert.equal(authorize.headers.get('location'), `${origin(a)}/oauth/authorize?${query}`);
    // The page reads the request and shows the error.
    const described = await call(a.host, `/oauth/authorize/request?${query}`, { headers: session });
    assert.equal(described.status, 400, `${error}: ${described.text}`);
    assert.equal(described.data.error, error);
    if (backToClient) {
      // The redirect URI was verified: the page may offer to go back to the client with the error.
      const back = new URL(described.data.redirect_to);
      assert.equal(`${back.origin}${back.pathname}`, new URL(params.redirect_uri).origin + new URL(params.redirect_uri).pathname);
      assert.equal(back.searchParams.get('error'), error);
      assert.equal(back.searchParams.get('state'), params.state);
      assert.equal(back.searchParams.get('iss'), origin(a));
    } else {
      assert.equal(described.data.redirect_to, null, 'nothing points to an unverified address');
    }
  };
  // Before the redirect URI is verified.
  await expectError({ client_id: 'http://claude.ai/oauth/claude-code-client-metadata' }, 'invalid_client', false);
  await expectError({ client_id: 'https://unknown.example.com/metadata.json' }, 'invalid_client', false);
  await expectError({ redirect_uri: 'https://attacker.example.com/callback' }, 'invalid_request', false);
  await expectError({ redirect_uri: 'http://localhost:53682/other' }, 'invalid_request', false);
  // After: the error may go back to the client.
  await expectError({ code_challenge: undefined }, 'invalid_request', true);
  await expectError({ code_challenge_method: 'plain' }, 'invalid_request', true);
  await expectError({ code_challenge_method: undefined }, 'invalid_request', true);
  await expectError({ resource: undefined }, 'invalid_target', true);
  await expectError({ resource: 'https://other.kanap.test/api/ai/mcp' }, 'invalid_target', true);
  await expectError({ scope: 'mcp:write' }, 'invalid_scope', true);
  await expectError({ response_type: 'token' }, 'unsupported_response_type', true);

  // Too malformed to show: answered by the endpoint itself.
  for (const overrides of [{ redirect_uri: undefined }, { client_id: undefined }, { client_id: `${CLAUDE_CIMD}?${'a'.repeat(520)}` }]) {
    const { params } = authorizationParams(a, overrides);
    const response = await call(a.host, `/oauth/authorize?${new URLSearchParams(params)}`);
    assert.equal(response.status, 400, response.text);
    assert.equal(response.data.error, 'invalid_request');
    assert.equal(response.headers.get('location'), null);
  }

  // offline_access is accepted and ignored.
  const offline = authorizationParams(a, { scope: 'mcp:read offline_access' });
  const described = await call(a.host, `/oauth/authorize/request?${new URLSearchParams(offline.params)}`, { headers: session });
  assert.equal(described.status, 200, described.text);
  assert.equal(described.data.scope, 'mcp:read');

  // A trailing slash on the resource is tolerated, the token audience stays canonical.
  const { params, verifier } = authorizationParams(a, { resource: `${resource(a)}/` });
  const code = await approve(a, params);
  const token = await exchange(a, code, params, verifier);
  assert.equal(token.status, 200, token.text);
  assert.equal((jwt.decode(token.data.access_token) as any).aud, resource(a));

  // The decision applies the same checks as the redirect.
  const bad = authorizationParams(a, { code_challenge_method: 'plain' });
  const decision = await call(a.host, '/oauth/authorize/decision', {
    headers: { authorization: `Bearer ${sessionToken(a)}` },
    json: { ...bad.params, approve: true },
  });
  assert.equal(decision.status, 400);
  assert.equal(decision.data.error, 'invalid_request');

  // The decision needs a web session.
  const anonymous = await call(a.host, '/oauth/authorize/decision', { json: { ...authorizationParams(a).params, approve: true } });
  assert.equal(anonymous.status, 401);

  // A refusal goes back as access_denied and is audited.
  const refused = authorizationParams(a);
  const denied = await call(a.host, '/oauth/authorize/decision', {
    headers: { authorization: `Bearer ${sessionToken(a)}` },
    json: { ...refused.params, approve: false },
  });
  assert.equal(denied.status, 200);
  assert.equal(new URL(denied.data.redirect_to).searchParams.get('error'), 'access_denied');
  assert.ok(harness.events.some((event) => event.action === 'mcp_connection_refused' && event.userId === a.userId && event.tenantId === a.tenantId));
}

async function testTokenRefusals(a: Seed) {
  const fresh = async () => {
    const { params, verifier } = authorizationParams(a);
    return { params, verifier, code: await approve(a, params) };
  };
  const expectGrantError = async (overrides: Record<string, string | undefined>, error: string) => {
    const { params, verifier, code } = await fresh();
    const response = await exchange(a, code, params, verifier, overrides);
    assert.equal(response.status, 400, response.text);
    assert.equal(response.data.error, error, JSON.stringify(overrides));
  };
  await expectGrantError({ code_verifier: undefined }, 'invalid_grant');
  await expectGrantError({ code_verifier: randomBytes(32).toString('base64url') }, 'invalid_grant');
  // resource is optional at the token endpoint: the code's is used.
  {
    const { params, verifier, code } = await fresh();
    const response = await exchange(a, code, params, verifier, { resource: undefined });
    assert.equal(response.status, 200, response.text);
    assert.equal((jwt.decode(response.data.access_token) as any).aud, resource(a));
  }
  await expectGrantError({ resource: 'https://other.kanap.test/api/ai/mcp' }, 'invalid_target');
  await expectGrantError({ redirect_uri: 'http://localhost:1/callback' }, 'invalid_grant');
  await expectGrantError({ client_id: WEB_CIMD }, 'invalid_grant');
  await expectGrantError({ code: 'not-a-code' }, 'invalid_grant');
  const unsupported = await call(a.host, '/oauth/token', { form: { grant_type: 'client_credentials' } });
  assert.equal(unsupported.data.error, 'unsupported_grant_type');

  // A session token is not an authorization code.
  const { params, verifier } = authorizationParams(a);
  const notACode = await exchange(a, sessionToken(a), params, verifier);
  assert.equal(notACode.data.error, 'invalid_grant');
}

async function testCodeReplayRevokesTheGrant(a: Seed) {
  const { params, verifier } = authorizationParams(a);
  const code = await approve(a, params);
  const first = await exchange(a, code, params, verifier);
  assert.equal(first.status, 200, first.text);
  const second = await exchange(a, code, params, verifier);
  assert.equal(second.status, 400);
  assert.equal(second.data.error, 'invalid_grant');
  const grantId = (jwt.decode(first.data.access_token) as any).grant;
  const row = await grantRow(a, 'id = $2', [grantId]);
  assert.ok(row.revoked_at, 'the grant of the first exchange is revoked');
  assert.equal(row.revocation_reason, 'oauth_code_replayed');
  assert.equal((await toolsList(a, first.data.access_token)).status, 401);
  const refresh = await call(a.host, '/oauth/token', { form: { grant_type: 'refresh_token', refresh_token: first.data.refresh_token } });
  assert.equal(refresh.data.error, 'invalid_grant');
}

async function testRevocationIsImmediate(a: Seed) {
  // Revoked by the user from the keys card (same route as an API key).
  const token = await connect(a);
  assert.equal((await toolsList(a, token.access_token)).status, 200);
  const grantId = (jwt.decode(token.access_token) as any).grant;
  await new AiTenantExecutionService(dataSource).run(a.tenantId, (manager) =>
    manager.query(`UPDATE ai_api_keys SET revoked_at = now() WHERE tenant_id = $1 AND id = $2`, [a.tenantId, grantId]));
  const after = await toolsList(a, token.access_token);
  assert.equal(after.status, 401, 'a still-valid access token is refused once the grant is revoked');
  assert.match(after.headers.get('www-authenticate') ?? '', /error="invalid_token"/);

  // Revoked by the client (RFC 7009).
  const other = await connect(a);
  const revoked = await call(a.host, '/oauth/revoke', { form: { token: other.refresh_token, token_type_hint: 'refresh_token' } });
  assert.equal(revoked.status, 200);
  assert.equal((await toolsList(a, other.access_token)).status, 401);
  const otherRow = await grantRow(a, 'id = $2', [(jwt.decode(other.access_token) as any).grant]);
  assert.equal(otherRow.revocation_reason, 'oauth_client_revocation');
  const unknown = await call(a.host, '/oauth/revoke', { form: { token: 'whatever' } });
  assert.equal(unknown.status, 200, 'an unknown token is not an error');

}

async function testIsolation(a: Seed, b: Seed) {
  const token = await connect(a);
  // A token that passes every claim check for tenant B, naming a grant of tenant A: the grant is
  // read inside tenant B (tenant_id predicate and RLS), where it does not exist.
  const grantOfA = (jwt.decode(token.access_token) as any).grant;
  const forged = signAccessToken({ sub: a.userId, tenant_id: b.tenantId, iss: origin(b), aud: resource(b), grant: grantOfA, scope: 'mcp:read' });
  assert.equal((await toolsList(b, forged)).status, 401);
  // Seen from tenant B's context, without any tenant predicate, the row is not there (FORCE RLS).
  const seenFromB = await new AiTenantExecutionService(dataSource).run(b.tenantId, (manager) =>
    manager.query(`SELECT id FROM ai_api_keys WHERE id = $1`, [grantOfA]));
  assert.equal(seenFromB.length, 0);
  // The access token travels in Authorization only.
  const inHeader = await call(a.host, '/ai/mcp', {
    headers: { accept: 'application/json, text/event-stream', 'x-api-key': token.access_token },
    json: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
  });
  assert.equal(inHeader.status, 401);
  // A token of tenant A on tenant B's address.
  assert.equal((await toolsList(b, token.access_token)).status, 401);
  const refreshOnB = await call(b.host, '/oauth/token', { form: { grant_type: 'refresh_token', refresh_token: token.refresh_token } });
  assert.equal(refreshOnB.data.error, 'invalid_grant');
  // A code of tenant A exchanged on B.
  const { params, verifier } = authorizationParams(a);
  const code = await approve(a, params);
  const onB = await exchange(b, code, { ...params, resource: resource(b) }, verifier);
  assert.equal(onB.data.error, 'invalid_grant');

  // The access token does not open the web API, the session token does not open MCP.
  const sessionRoute = await call(a.host, '/session-only', { headers: { authorization: `Bearer ${token.access_token}` }, json: {} });
  assert.equal(sessionRoute.status, 401);
  assert.equal((await call(a.host, '/session-only', { headers: { authorization: `Bearer ${sessionToken(a)}` }, json: {} })).status, 200);
  assert.equal((await toolsList(a, sessionToken(a))).status, 401);
  // A refresh token is not an access token, nor an API key.
  assert.equal((await toolsList(a, token.refresh_token)).status, 401);
  const asKey = token.refresh_token.replace('kanap_mcprt_', 'kanap_mcp_');
  assert.equal((await toolsList(a, asKey)).status, 401);

  // An API key keeps working beside OAuth.
  const apiKeys = new AiApiKeysService(
    dataSource.getRepository(AiApiKey),
    {} as any,
    new McpApiKeyHashService(),
    { find: async () => null } as any,
  );
  const created = await new AiTenantExecutionService(dataSource).run(a.tenantId, (manager) => apiKeys.createKey(
    { tenantId: a.tenantId, userId: a.userId, label: 'Desktop', createdByUserId: a.userId },
    { manager },
  ));
  assert.equal(created.record.credential_kind, 'api_key');
  assert.equal((await toolsList(a, created.key)).status, 200);
  const header = await call(a.host, '/ai/mcp', {
    headers: { accept: 'application/json, text/event-stream', 'x-api-key': created.key },
    json: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
  });
  assert.equal(header.status, 200);
}

async function testRememberedConsent(a: Seed) {
  const describe = async (userId: string, overrides: Record<string, string> = {}) => {
    const { params } = authorizationParams(a, overrides);
    const response = await call(a.host, `/oauth/authorize/request?${new URLSearchParams(params)}`, {
      headers: { authorization: `Bearer ${sessionToken(a, userId)}` },
    });
    assert.equal(response.status, 200, response.text);
    return { remembered: response.data.remembered as boolean, auto: response.data.auto_approve as boolean };
  };
  const web = { client_id: WEB_CIMD, redirect_uri: WEB_REDIRECT };
  const neither = { remembered: false, auto: false };
  const userId = await addUser(a, 'remember');
  const otherUser = await addUser(a, 'other');

  // Not remembered: both false, loopback or web.
  await connect(a, { userId, remember: false, clientId: WEB_CIMD, redirectUri: WEB_REDIRECT });
  await connect(a, { userId, remember: false });
  assert.deepEqual(await describe(userId, web), neither);
  assert.deepEqual(await describe(userId), neither);

  // Remembered, loopback redirect: the screen is skipped.
  const loopback = await connect(a, { userId, remember: true });
  assert.deepEqual(await describe(userId), { remembered: true, auto: true });
  assert.deepEqual(await describe(userId, { redirect_uri: 'http://localhost:9999/callback' }), { remembered: true, auto: true }, 'any loopback port');
  assert.deepEqual(await describe(userId, { redirect_uri: 'http://127.0.0.1:9999/callback' }), neither, 'another redirect host');
  assert.deepEqual(await describe(otherUser), neither, 'another user');

  // Remembered, web redirect: known, and still one click.
  const remoteGrant = await connect(a, { userId, remember: true, clientId: WEB_CIMD, redirectUri: WEB_REDIRECT });
  assert.deepEqual(await describe(userId, web), { remembered: true, auto: false });
  assert.deepEqual(await describe(otherUser, web), neither, 'another user');

  // Revoking the connection forgets the consent.
  await call(a.host, '/oauth/revoke', { form: { token: loopback.refresh_token } });
  assert.deepEqual(await describe(userId), neither);
  await call(a.host, '/oauth/revoke', { form: { token: remoteGrant.refresh_token } });
  assert.deepEqual(await describe(userId, web), neither);
}

async function testDisabledDeploymentAnswersNothing(a: Seed) {
  (Features as any).AI_MCP_ENABLED = false;
  try {
    assert.equal((await call(a.host, '/.well-known/oauth-authorization-server')).status, 403);
    assert.equal((await call(a.host, '/oauth/token', { form: { grant_type: 'refresh_token' } })).status, 403);
  } finally {
    (Features as any).AI_MCP_ENABLED = true;
  }
  // No tenant behind the host: nothing to discover.
  assert.equal((await call('unknown.kanap.test', '/.well-known/oauth-protected-resource')).status, 404);
}

async function run() {
  const mcpFlag = Features.AI_MCP_ENABLED;
  (Features as any).AI_MCP_ENABLED = true;
  await dataSource.initialize();
  const a = await seedTenant('a');
  const b = await seedTenant('b');
  harness = await startHarness([a, b]);
  try {
    await testFullFlow(a);
    await testForgedRefreshTokenDoesNotRevoke(a);
    await testRefreshRetriesAndRaces(a);
    await testRefreshAuditIsAggregated(a);
    await testRefreshChecksTheGrantAndItsOwnerOnly(a);
    await testOldGrantsOfAClientAreRetired(a);
    await testAuthorizeRefusals(a);
    await testTokenRefusals(a);
    await testCodeReplayRevokesTheGrant(a);
    await testRevocationIsImmediate(a);
    await testIsolation(a, b);
    await testRememberedConsent(a);
    await testDisabledDeploymentAnswersNothing(a);
    // eslint-disable-next-line no-console
    console.log('mcp-oauth-flow.integration.spec: OK');
  } finally {
    await harness.close();
    await cleanup([a, b]);
    await dataSource.destroy();
    (Features as any).AI_MCP_ENABLED = mcpFlag;
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
