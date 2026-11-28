// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import * as express from 'express';
import { HttpException, INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import { PgClient, seedNodes, seedPerson, seedRole } from '../../data-access/__tests__/data-access-test-helpers';

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-thirty-two-chars-min';
process.env.SETTINGS_ENCRYPTION_SECRET ||= process.env.AI_SETTINGS_ENCRYPTION_SECRET || 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-contributors-mcp-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

// The family `contributors` (Portfolio › Contributors, MEM-n) through the MCP server: the real
// controller, capability dispatcher and tools, on the spec's transaction.
// - The tools and the instructions name the family; search_all says it searches it by MEM-n.
// - A reader of the portfolio settings lists, reads, searches and describes the contributors; the
//   default company is withheld without the companies, in describe_entity_filters too.
// - A person without a name is named by their MEM-n, never by their email.
// - A person without the right is refused by every tool, and search_all leaves them out, said so.
// - Another tenant's contributor is not found by its id.
// - A person in limited access reads them under the limited role, as a request.

let app: INestApplicationContext;
let dataSource: DataSource;

type Seed = {
  tenantId: string;
  alice: string;
  otherContributor: string;
  reader: string;
  noRight: string;
  limited: string;
};

async function inTransaction(fn: (runner: QueryRunner) => Promise<void>): Promise<void> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await fn(runner);
  } finally {
    await runner.rollbackTransaction().catch(() => undefined);
    await runner.release();
  }
}

function pg(runner: QueryRunner): PgClient {
  return {
    connect: async () => undefined,
    end: async () => undefined,
    query: async (sql: string, params?: unknown[]) => ({ rows: await runner.query(sql, params as any[]) }),
  };
}

async function seedTenantRow(runner: QueryRunner, slug: string): Promise<string> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{"reporting_currency":"EUR"}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `${slug}-${tenantId.slice(0, 8)}`, `${slug} ${tenantId.slice(0, 8)}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  return tenantId;
}

function memberService() {
  const { TeamMemberConfigService } = require('../../portfolio/team-member-config.service');
  return app.get(TeamMemberConfigService);
}

async function grant(runner: QueryRunner, tenantId: string, roleId: string, resource: string, level: string): Promise<void> {
  await runner.query('INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)', [tenantId, roleId, resource, level]);
}

async function named(runner: QueryRunner, userId: string, first: string, last: string): Promise<void> {
  await runner.query('UPDATE users SET first_name = $2, last_name = $3 WHERE id = $1', [userId, first, last]);
}

async function seed(runner: QueryRunner): Promise<Seed> {
  const [{ current }] = await runner.query(`SELECT current_database() AS current`);
  assert.notEqual(current, 'appdb', 'this spec does not write the dev database');
  const service = memberService();
  const client = pg(runner);

  // Another tenant first, so the tenant of the spec stays the current one.
  const other = await seedTenantRow(runner, 'ai-mem-mcp-other');
  const zoe = await seedPerson(client, other, 'all', await seedRole(client, other, 'Administrator'));
  await named(runner, zoe, 'Zoe', 'Other');
  const otherContributor = (await service.create({ user_id: zoe }, other, zoe, { manager: runner.manager })).id;

  const tenantId = await seedTenantRow(runner, 'ai-mem-mcp');
  const admin = await seedPerson(client, tenantId, 'all', await seedRole(client, tenantId, 'Administrator'));
  const portfolioReader = await seedRole(client, tenantId, 'Portfolio settings reader');
  await grant(runner, tenantId, portfolioReader, 'portfolio_settings', 'reader');
  const reader = await seedPerson(client, tenantId, 'all', portfolioReader);
  const budgetOnly = await seedRole(client, tenantId, 'Budget administrator');
  await grant(runner, tenantId, budgetOnly, 'budget', 'admin');
  const noRight = await seedPerson(client, tenantId, 'all', budgetOnly);
  const limitedRole = await seedRole(client, tenantId, 'Portfolio and companies reader');
  await grant(runner, tenantId, limitedRole, 'portfolio_settings', 'reader');
  await grant(runner, tenantId, limitedRole, 'companies', 'reader');
  const limited = await seedPerson(client, tenantId, 'limited', limitedRole);

  const [{ id: alpha }] = await runner.query(
    `INSERT INTO companies (tenant_id, name, country_iso, city, item_number) VALUES ($1, 'Fromagerie Alpha', 'FR', 'Lyon', 1) RETURNING id`, [tenantId]);
  const [{ id: beta }] = await runner.query(
    `INSERT INTO companies (tenant_id, name, country_iso, city, item_number) VALUES ($1, 'Beta Hidden', 'FR', 'Lyon', 2) RETURNING id`, [tenantId]);
  await seedNodes(client, tenantId, limited, [{ type: 'company', id: beta, access: 'read' }]);
  const [{ id: teamId }] = await runner.query(`INSERT INTO portfolio_teams (tenant_id, name) VALUES ($1, 'Platform') RETURNING id`, [tenantId]);
  const [{ id: sap }] = await runner.query(`INSERT INTO portfolio_skills (tenant_id, category, name) VALUES ($1, 'ERP', 'SAP') RETURNING id`, [tenantId]);

  const aliceUser = await seedPerson(client, tenantId, 'all', portfolioReader);
  const bobUser = await seedPerson(client, tenantId, 'all', portfolioReader);
  const carlUser = await seedPerson(client, tenantId, 'all', portfolioReader);
  await named(runner, aliceUser, 'Alice', 'Martin');
  await named(runner, bobUser, 'Bob', 'Durand');
  // Carl has no name: the family names him by his MEM-n.
  await named(runner, carlUser, '', '');
  // Through the screen's service, which numbers them MEM-1, MEM-2, MEM-3.
  const alice = (await service.create({
    user_id: aliceUser, team_id: teamId, manager_user_id: carlUser,
    skills: [{ skill_id: sap, proficiency: 4 }], project_availability: 12, default_company_id: alpha,
  }, tenantId, admin, { manager: runner.manager })).id;
  await service.create({ user_id: bobUser, default_company_id: beta }, tenantId, admin, { manager: runner.manager });
  await service.create({ user_id: carlUser }, tenantId, admin, { manager: runner.manager });
  return { tenantId, alice, otherContributor, reader, noRight, limited };
}

/** The real MCP controller, dispatcher and tools, on the transaction; `applyAccess` takes the person's data access, as a request. */
async function mcp(runner: QueryRunner, s: Seed, userId: string, applyAccess = false) {
  const { AiMcpController } = require('../ai-mcp.controller');
  const { AiCapabilityDispatcherService } = require('../control-plane/dispatcher/ai-capability-dispatcher.service');
  const { AiMcpExposureService } = require('../control-plane/mcp/ai-mcp-exposure.service');
  const { AiMcpAuditService } = require('../control-plane/mcp/ai-mcp-audit.service');
  const { applyDataAccess } = require('../../data-access/data-access');
  const controller = new AiMcpController(
    app.get(AiCapabilityDispatcherService), app.get(AiMcpExposureService), app.get(AiMcpAuditService),
    { assertAllowed: () => undefined },
    {
      runWithContext: async (context: any, fn: (ctx: any) => Promise<unknown>) => {
        if (applyAccess) await applyDataAccess(runner.manager, userId);
        return fn({ ...context, manager: runner.manager });
      },
    },
  );
  const server = express();
  server.use(express.json());
  server.post('/ai/mcp', (req: any, res, next) => {
    req.tenant = { id: s.tenantId };
    req.user = { sub: userId, aiApiKeyId: null };
    req.aiApiKey = {
      id: null, tenant_id: s.tenantId, user_id: userId,
      mcp_scopes: ['mcp:tools:list', 'mcp:tools:execute'], mcp_allowed_capabilities: ['kanap.read.core'],
      mcp_denied_capabilities: [], mcp_max_effect: 'read', mcp_rate_limit_per_minute: 600,
    };
    controller.handlePost(req, res).catch(next);
  });
  server.use((error: any, _req: any, res: any, _next: any) => {
    res.status(error instanceof HttpException ? error.getStatus() : 500).json({ message: String(error?.message ?? error) });
  });
  const listener = server.listen(0);
  await new Promise((resolve) => listener.once('listening', resolve));
  const url = `http://127.0.0.1:${(listener.address() as AddressInfo).port}/ai/mcp`;
  let id = 0;
  const rpc = async (body: any) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, ...body }),
    });
    const text = await response.text();
    assert.equal(response.status, 200, text);
    const data = text.split('\n').find((line) => line.startsWith('data: '));
    return JSON.parse(data ? data.slice('data: '.length) : text);
  };
  const call = async (name: string, args: any): Promise<{ isError: boolean; text: string; json?: any }> => {
    const reply = await rpc({ method: 'tools/call', params: { name, arguments: args } });
    if (reply.error) return { isError: true, text: `RPC ${reply.error.code}: ${reply.error.message}` };
    const text = reply.result.content[0].text;
    return reply.result.isError ? { isError: true, text } : { isError: false, text, json: JSON.parse(text) };
  };
  return { rpc, call, close: () => new Promise((resolve) => listener.close(resolve)) };
}

function withoutSurfaceChecks(): void {
  const { AiPolicyService } = require('../ai-policy.service');
  app.get(AiPolicyService).assertSurfaceAccess = async () => undefined;
}

async function testTheToolsAndTheInstructionsNameTheFamily(): Promise<void> {
  await inTransaction(async (runner) => {
    const s = await seed(runner);
    const server = await mcp(runner, s, s.reader);
    try {
      const listed = await server.rpc({ method: 'tools/list' });
      const tool = (name: string) => listed.result.tools.find((entry: any) => entry.name === name);
      const enumOf = (name: string, property: string) => {
        const schema = tool(name)?.inputSchema?.properties?.[property];
        return schema?.enum ?? schema?.items?.enum ?? [];
      };
      for (const [name, property] of [
        ['query_entities', 'entity_type'], ['get_entity_detail', 'entity_type'], ['aggregate_entities', 'entity_type'],
        ['describe_entity_filters', 'entity_type'], ['get_filter_values', 'entity_type'], ['search_all', 'entity_types'],
      ]) {
        assert.ok(enumOf(name, property).includes('contributors'), `${name}.${property} takes contributors`);
      }
      assert.match(tool('search_all').description, /contributors \(MEM-n\)/);
    } finally {
      await server.close();
    }
    const { MCP_SERVER_INSTRUCTIONS } = require('../ai-mcp.controller');
    assert.match(MCP_SERVER_INSTRUCTIONS, /contributors/);
    assert.match(MCP_SERVER_INSTRUCTIONS, /MEM-4/);
  });
  console.log('ok - mcp contributors: the tools and the instructions name the family');
}

async function testAReaderOfThePortfolioSettings(): Promise<void> {
  await inTransaction(async (runner) => {
    const s = await seed(runner);
    const server = await mcp(runner, s, s.reader);
    try {
      const list = await server.call('query_entities', { entity_type: 'contributors' });
      assert.equal(list.isError, false, list.text);
      assert.deepEqual(list.json.items.map((item: any) => [item.ref, item.label]), [['MEM-1', 'Alice Martin'], ['MEM-2', 'Bob Durand'], ['MEM-3', 'MEM-3']]);
      assert.deepEqual([list.json.items[0].metadata.manager, list.json.items[0].metadata.manager_ref], ['MEM-3', 'MEM-3']);
      assert.ok(list.json.items.every((item: any) => item.updated_at === null && item.metadata.default_company === null));
      assert.deepEqual(list.json.fields_withheld.map((entry: any) => entry.field), ['default_company']);
      assert.doesNotMatch(list.text, /@|REDACTED/, 'no email address');

      const detail = await server.call('get_entity_detail', { entity_type: 'contributors', entity_id: 'MEM-1' });
      assert.equal(detail.isError, false, detail.text);
      assert.equal(detail.json.entity.ref, 'MEM-1');
      assert.deepEqual(detail.json.data.skills, [{ skill: 'SAP', category: 'ERP', level: 4, level_name: 'Expert' }]);
      assert.match(detail.json.data.contributor_note, /no modification date/);

      const byRef = await server.call('search_all', { query: 'MEM-3' });
      assert.deepEqual(byRef.json.items.filter((item: any) => item.type === 'contributors').map((item: any) => [item.ref, item.label]), [['MEM-3', 'MEM-3']]);
      const byName = await server.call('search_all', { query: 'Durand' });
      assert.deepEqual(byName.json.items.filter((item: any) => item.type === 'contributors').map((item: any) => item.ref), ['MEM-2']);

      // The default company is withheld wherever the family is described or read.
      const described = await server.call('describe_entity_filters', { entity_type: 'contributors' });
      assert.equal(described.isError, false, described.text);
      assert.deepEqual(described.json.fields_withheld?.map((entry: any) => entry.field), ['default_company']);
      const values = await server.call('get_filter_values', { entity_type: 'contributors', fields: ['team', 'default_company'] });
      assert.deepEqual(values.json.values.team, ['Platform', null]);
      assert.deepEqual(values.json.fields_withheld.map((entry: any) => entry.field), ['default_company']);
      const grouped = await server.call('aggregate_entities', { entity_type: 'contributors', group_by: 'team' });
      assert.deepEqual(grouped.json.groups.map((group: any) => [group.key, group.count]), [[null, 2], ['Platform', 1]]);

      // Another tenant's contributor is not found by its id.
      const other = await server.call('get_entity_detail', { entity_type: 'contributors', entity_id: s.otherContributor });
      assert.equal(other.isError, true);
      assert.match(other.text, /No contributor matches/);
    } finally {
      await server.close();
    }
  });
  console.log('ok - mcp contributors: a reader of the portfolio settings, the company withheld');
}

async function testAPersonWithoutTheRight(): Promise<void> {
  await inTransaction(async (runner) => {
    const s = await seed(runner);
    const server = await mcp(runner, s, s.noRight);
    try {
      for (const [name, args] of [
        ['query_entities', { entity_type: 'contributors' }],
        ['get_entity_detail', { entity_type: 'contributors', entity_id: 'MEM-1' }],
        ['get_entity_detail', { entity_type: 'contributors', entity_id: s.alice }],
        ['aggregate_entities', { entity_type: 'contributors', group_by: 'team' }],
        ['get_filter_values', { entity_type: 'contributors', fields: ['team'] }],
        ['describe_entity_filters', { entity_type: 'contributors' }],
      ] as Array<[string, any]>) {
        const refused = await server.call(name, args);
        assert.equal(refused.isError, true, `${name} is refused`);
        assert.match(refused.text, /right to read portfolio settings/, refused.text);
      }
      for (const query of ['MEM-1', 'Alice Martin', 'contributeur Alice']) {
        const searched = await server.call('search_all', { query });
        assert.equal(searched.isError, false, searched.text);
        assert.equal(searched.json.items.some((item: any) => item.type === 'contributors'), false, query);
      }
      const asked = await server.call('search_all', { query: 'MEM-1' });
      assert.match(JSON.stringify(asked.json.not_read_here), /contributors[\s\S]*Portfolio settings right at reader level/);
    } finally {
      await server.close();
    }
  });
  console.log('ok - mcp contributors: refused without the right, left out of search_all, said so');
}

async function testLimitedAccessUnderTheLimitedRole(): Promise<void> {
  await inTransaction(async (runner) => {
    const s = await seed(runner);
    const server = await mcp(runner, s, s.limited, true);
    try {
      const list = await server.call('query_entities', { entity_type: 'contributors' });
      const [{ role }] = await runner.query('SELECT current_user AS role');
      assert.equal(role, 'kanap_data_limited');
      assert.equal(list.isError, false, list.text);
      // Every contributor, as the screen; the company lookup names the companies, as the drawer.
      assert.deepEqual(list.json.items.map((item: any) => [item.ref, item.metadata.default_company]), [
        ['MEM-1', 'Fromagerie Alpha'], ['MEM-2', 'Beta Hidden'], ['MEM-3', null],
      ]);
      const detail = await server.call('get_entity_detail', { entity_type: 'contributors', entity_id: 'MEM-1' });
      assert.equal(detail.isError, false, detail.text);
      assert.equal(detail.json.data.time_logged.monthly.length, 12);
    } finally {
      await server.close();
    }
  });
  console.log('ok - mcp contributors: limited access under the limited role');
}

async function run(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-contributors-mcp.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  dataSource = app.get(DataSource);
  withoutSurfaceChecks();
  const failures: string[] = [];
  try {
    for (const [name, test] of [
      ['tools and instructions', testTheToolsAndTheInstructionsNameTheFamily],
      ['reader', testAReaderOfThePortfolioSettings],
      ['no right', testAPersonWithoutTheRight],
      ['limited role', testLimitedAccessUnderTheLimitedRole],
    ] as Array<[string, () => Promise<void>]>) {
      try {
        await test();
      } catch (error: any) {
        failures.push(`${name}: ${error?.stack ?? error}`);
      }
    }
  } finally {
    await app.close();
  }
  if (failures.length) {
    console.error(failures.join('\n\n'));
    process.exit(1);
  }
  console.log('ai-contributors-mcp.integration.spec: ok');
}

run().catch((error) => {
  console.error(error?.stack ?? error);
  process.exit(1);
});
