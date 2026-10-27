// @database-spec
import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import * as express from 'express';
import { BadRequestException, HttpException } from '@nestjs/common';
import dataSource from '../../data-source';
import { createBodyParsers } from '../../common/body-parsers';
import { User } from '../../users/user.entity';
import { AiApiKey } from '../ai-api-key.entity';
import { AiApiKeysService } from '../ai-api-keys.service';
import { AiMcpController } from '../ai-mcp.controller';
import { McpApiKeyAuthGuard } from '../auth/mcp-api-key-auth.guard';
import { McpApiKeyHashService } from '../auth/mcp-api-key-hash.service';
import { parseMcpApiKeyPolicy } from '../control-plane/mcp/ai-mcp-access-policy';
import { AiMcpAuditService } from '../control-plane/mcp/ai-mcp-audit.service';
import { AiMcpExposureService } from '../control-plane/mcp/ai-mcp-exposure.service';
import { AiTenantExecutionService } from '../execution/ai-tenant-execution.service';

// The MCP journal against PostgreSQL (brief plaid-mcp-annuaire, P3-9): a refused or failed call,
// and a request with a revoked key, each leave one line in ai_runs / ai_tool_executions under FORCE
// RLS, written after the request transaction rolled back; the lines carry the argument values and
// never a key; the admin list pages (offset, period, person, key, result) with names and labels; a
// tenant reads none of another tenant's lines, even without the tenant predicate. The controller,
// the guard, the key service, the journal and the tenant runner are the real ones; the tools and
// the dispatcher are stubbed.

const TAG = randomBytes(4).toString('hex');
const executor = new AiTenantExecutionService(dataSource);
const audit = new AiMcpAuditService();

type Seed = { tenantId: string; userId: string; roleId: string; key: string; keyId: string };

async function seedTenant(label: string): Promise<Seed> {
  const tenantId = randomUUID();
  const roleId = randomUUID();
  const userId = randomUUID();
  const slug = `mcp-journal-${label}-${TAG}`;
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  try {
    await runner.startTransaction();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'MCP journal spec', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, slug],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    await runner.query(
      `INSERT INTO roles (id, tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
       VALUES ($1, $2, $3, 'MCP journal spec role', false, false, now(), now())`,
      [roleId, tenantId, `MCP journal ${label} ${TAG}`],
    );
    await runner.query(
      `INSERT INTO users (id, tenant_id, email, first_name, last_name, role_id, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Ana', $4, $5, 'enabled', now(), now())`,
      [userId, tenantId, `${slug}@example.invalid`, `Journal ${label}`, roleId],
    );
    await runner.commitTransaction();
  } finally {
    await runner.release();
  }
  return { tenantId, userId, roleId, key: '', keyId: '' };
}

const users = {
  findById: (id: string, opts?: { manager?: any }) =>
    (opts?.manager ?? dataSource.manager).getRepository(User).findOne({ where: { id }, relations: ['role'] }),
} as any;
const apiKeys = new AiApiKeysService(
  dataSource.getRepository(AiApiKey),
  users,
  new McpApiKeyHashService(),
  { find: async () => null } as any,
  { log: async () => undefined } as any,
  executor,
);

async function createKey(seed: Seed): Promise<void> {
  const created = await executor.run(seed.tenantId, (manager) => apiKeys.createKey(
    { tenantId: seed.tenantId, userId: seed.userId, label: `Journal key ${TAG}`, createdByUserId: seed.userId },
    { manager },
  ));
  seed.key = created.key;
  seed.keyId = created.record.id;
}

// What KANAP declares, for the refusals (the real explanation runs on it).
const DECLARED: Record<string, { reads: boolean; mcpReadable: boolean }> = {
  search_all: { reads: true, mcpReadable: true },
  prepare_mutation_plan: { reads: false, mcpReadable: false },
};
const exposureForRefusals = new AiMcpExposureService(
  { describeRegisteredCapability: (name: string) => DECLARED[name] ?? null } as any,
  {} as any,
);

async function withServer(seeds: Seed[], fn: (url: string) => Promise<void>): Promise<void> {
  const controller = new AiMcpController(
    {
      execute: async (_ctx: any, request: any) => {
        if (request.input?.query === 'fail-http') throw new BadRequestException('Invalid input for search_all: query too long.');
        return { output: { items: [] } };
      },
    } as any,
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
      explainRefusal: (apiKey: any, name: string) => exposureForRefusals.explainRefusal(apiKey, name),
    } as any,
    audit,
    { assertAllowed: () => undefined } as any,
    executor,
  );
  const guard = new McpApiKeyAuthGuard(apiKeys, executor, {} as any, audit);
  const byTenant = new Map(seeds.map((seed) => [seed.tenantId, seed]));
  const app = express();
  app.use((req: any, _res, next) => {
    const seed = byTenant.get(String(req.headers['x-test-tenant'] ?? ''));
    req.tenant = seed ? { id: seed.tenantId } : null;
    next();
  });
  app.use(...createBodyParsers());
  app.post('/ai/mcp', async (req: any, res, next) => {
    try {
      const ctx = { switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) } as any;
      await guard.canActivate(ctx);
      await controller.handlePost(req, res);
    } catch (error) {
      next(error);
    }
  });
  app.use((error: any, _req: any, res: any, _next: any) => {
    const status = error instanceof HttpException ? error.getStatus() : 500;
    res.status(status).json(error instanceof HttpException ? error.getResponse() : { message: String(error) });
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}/ai/mcp`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function call(url: string, seed: Seed, name: string, args: Record<string, unknown>): Promise<{ status: number; body: any }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${seed.key}`,
      'x-test-tenant': seed.tenantId,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const text = await response.text();
  const data = text.split('\n').find((line) => line.startsWith('data: '));
  return { status: response.status, body: JSON.parse(data ? data.slice('data: '.length) : text) };
}

function asAdmin<T>(seed: Seed, fn: (ctx: any) => Promise<T>): Promise<T> {
  return executor.runWithContext({
    tenantId: seed.tenantId,
    userId: seed.userId,
    isPlatformHost: false,
    surface: 'mcp',
    authMethod: 'jwt',
    requestId: null,
    aiApiKeyId: null,
  }, fn);
}

async function testRefusalsAndRevokedKeyAreJournaled(a: Seed) {
  await withServer([a], async (url) => {
    const unknown = await call(url, a, 'does_not_exist', { query: 'SAP' });
    assert.equal(unknown.body.error.code, -32602);
    const write = await call(url, a, 'prepare_mutation_plan', { summary: 'Create QA-PL incident' });
    assert.match(write.body.result.content[0].text, /^This server is read only/);
    const invalid = await call(url, a, 'search_all', { query: 'fail-http' });
    assert.equal(invalid.body.result.isError, true);
    const ok = await call(url, a, 'search_all', { query: 'SAP' });
    assert.equal(ok.body.result.isError, undefined);

    await executor.run(a.tenantId, (manager) => apiKeys.revokeKey(a.keyId, { manager, userId: a.userId, revocationReason: 'user_self_service' }));
    const revoked = await call(url, a, 'search_all', { query: 'after revocation' });
    assert.equal(revoked.status, 401);
  });

  const page = await asAdmin(a, (ctx) => audit.list(ctx, { limit: 50 }));
  const byTool = (tool: string) => page.items.filter((item) => item.capability_name === tool);
  assert.equal(page.items.length, 4, JSON.stringify(page.items.map((item) => [item.capability_name, item.reason])));
  assert.deepEqual(
    page.items.map((item) => [item.capability_name, item.result, item.reason]).sort(),
    [
      ['does_not_exist', 'refused', 'unknown_tool'],
      ['prepare_mutation_plan', 'refused', 'read_only'],
      ['search_all', 'refused', 'invalid_input'],
      ['search_all', 'refused', 'key_revoked'],
    ],
  );
  const write = byTool('prepare_mutation_plan')[0];
  assert.deepEqual(write.input_summary, { arguments: { summary: 'Create QA-PL incident' } });
  assert.equal(write.user_id, a.userId);
  assert.equal(write.user_name, `Ana Journal a`);
  assert.equal(write.ai_api_key_id, a.keyId);
  assert.equal(write.key_label, `Journal key ${TAG}`);
  assert.equal(write.key_kind, 'api_key');
  assert.equal(write.effect, 'write');
  assert.ok(write.duration_ms != null && write.duration_ms >= 0);

  // No key value anywhere in the journal rows.
  const dump = await executor.run(a.tenantId, (manager) => manager.query(
    `SELECT (SELECT json_agg(t)::text FROM ai_tool_executions t WHERE t.tenant_id = $1) AS tools,
            (SELECT json_agg(r)::text FROM ai_runs r WHERE r.tenant_id = $1) AS runs`,
    [a.tenantId],
  ));
  const text = `${dump[0].tools}${dump[0].runs}`;
  assert.ok(text.includes(a.keyId));
  assert.equal(text.includes(a.key), false);
  assert.doesNotMatch(text, /kanap_mcp_/);
}

async function testListPagesAndFilters(a: Seed) {
  const first = await asAdmin(a, (ctx) => audit.list(ctx, { limit: 3 }));
  assert.equal(first.items.length, 3);
  assert.equal(first.has_more, true);
  const second = await asAdmin(a, (ctx) => audit.list(ctx, { limit: 3, offset: 3 }));
  assert.equal(second.items.length, 1);
  assert.equal(second.has_more, false);
  const ids = new Set([...first.items, ...second.items].map((item) => item.tool_execution_id));
  assert.equal(ids.size, 4);
  // Newest first.
  const times = first.items.map((item) => item.tool_created_at);
  assert.deepEqual([...times].sort().reverse(), times);

  assert.equal((await asAdmin(a, (ctx) => audit.list(ctx, { result: 'refused' }))).items.length, 4);
  assert.equal((await asAdmin(a, (ctx) => audit.list(ctx, { result: 'completed' }))).items.length, 0);
  assert.equal((await asAdmin(a, (ctx) => audit.list(ctx, { userId: a.userId }))).items.length, 4);
  assert.equal((await asAdmin(a, (ctx) => audit.list(ctx, { userId: randomUUID() }))).items.length, 0);
  assert.equal((await asAdmin(a, (ctx) => audit.list(ctx, { apiKeyId: a.keyId }))).items.length, 4);
  assert.equal((await asAdmin(a, (ctx) => audit.list(ctx, { capabilityName: 'search_all' }))).items.length, 2);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
  const yesterday = new Date(Date.now() - 86_400_000).toISOString();
  assert.equal((await asAdmin(a, (ctx) => audit.list(ctx, { from: tomorrow }))).items.length, 0);
  assert.equal((await asAdmin(a, (ctx) => audit.list(ctx, { from: yesterday, to: tomorrow }))).items.length, 4);
  assert.equal((await asAdmin(a, (ctx) => audit.list(ctx, { to: yesterday }))).items.length, 0);
  await assert.rejects(() => asAdmin(a, (ctx) => audit.list(ctx, { limit: 201 })), /limit must be/);
  await assert.rejects(() => asAdmin(a, (ctx) => audit.list(ctx, { result: 'other' })), /result must be/);

  const facets = await asAdmin(a, (ctx) => audit.listFacets(ctx));
  assert.deepEqual(facets.people, [{ id: a.userId, name: 'Ana Journal a' }]);
  assert.deepEqual(facets.keys.map((key) => [key.id, key.label, key.revoked]), [[a.keyId, `Journal key ${TAG}`, true]]);
}

async function testTenantsReadOnlyTheirOwnLines(a: Seed, b: Seed) {
  const fromB = await asAdmin(b, (ctx) => audit.list(ctx, { limit: 200 }));
  assert.equal(fromB.items.some((item) => item.tenant_id === a.tenantId), false);
  assert.equal(fromB.items.length, 0);
  const facets = await asAdmin(b, (ctx) => audit.listFacets(ctx));
  assert.deepEqual(facets.keys.map((key) => key.id), [b.keyId]);
  assert.deepEqual(facets.people.map((person) => person.id), [b.userId]);
  // RLS, not the predicate: tenant B's context sees no row of tenant A even when it asks for them.
  const leaked = await executor.run(b.tenantId, (manager) => manager.query(
    `SELECT (SELECT count(*) FROM ai_tool_executions WHERE tenant_id = $1)::int AS tools,
            (SELECT count(*) FROM ai_runs WHERE tenant_id = $1)::int AS runs`,
    [a.tenantId],
  ));
  assert.deepEqual(leaked[0], { tools: 0, runs: 0 });
  const own = await executor.run(a.tenantId, (manager) => manager.query(
    `SELECT count(*)::int AS tools FROM ai_tool_executions WHERE tenant_id = $1 AND surface = 'mcp'`,
    [a.tenantId],
  ));
  assert.equal(own[0].tools, 4);
}

async function cleanup(seeds: Seed[]) {
  for (const seed of seeds) {
    try {
      await executor.run(seed.tenantId, async (manager) => {
        await manager.query(`DELETE FROM ai_tool_executions WHERE tenant_id = $1`, [seed.tenantId]);
        await manager.query(`DELETE FROM ai_runs WHERE tenant_id = $1`, [seed.tenantId]);
        await manager.query(`DELETE FROM ai_api_keys WHERE tenant_id = $1`, [seed.tenantId]);
        await manager.query(`DELETE FROM audit_log WHERE tenant_id = $1`, [seed.tenantId]).catch(() => undefined);
      });
    } catch {
      // best effort: the tag keeps the rows of this run apart
    }
  }
}

async function run() {
  await dataSource.initialize();
  const seeds: Seed[] = [];
  try {
    const a = await seedTenant('a');
    const b = await seedTenant('b');
    seeds.push(a, b);
    await createKey(a);
    await createKey(b);
    await testRefusalsAndRevokedKeyAreJournaled(a);
    await testListPagesAndFilters(a);
    await testTenantsReadOnlyTheirOwnLines(a, b);
  } finally {
    await cleanup(seeds);
    await dataSource.destroy();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
