import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { backendPath } from '../../common/__tests__/backend-root';
import { parseItemRef } from '../../common/resolve-item-id';
import { resolveAiEntityReference } from '../../ai/ai-entity-reference.util';
import { TeamMemberConfigController } from '../team-member-config.controller';

/**
 * A contributor is `MEM-n`. The former `CTR-n` (now the reference of a contract) still opens a
 * contributor on the contributors route only: the general resolution, Kad and the MCP refuse it.
 */

const ROW_ID = '33333333-3333-4333-8333-333333333333';

function controllerOver() {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const read: string[] = [];
  const manager = {
    query: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      return [{ id: ROW_ID }];
    },
  };
  const controller = new TeamMemberConfigController(
    { get: async (id: string) => { read.push(id); return { id }; } } as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { controller, queries, read, req: { tenant: { id: 'tenant-1' }, queryRunner: { manager } } };
}

function testGeneralResolutionKnowsMemOnly() {
  assert.deepEqual(parseItemRef('MEM-12', 'contributor'), { type: 'item_number', value: 12, prefix: 'MEM' });
  assert.deepEqual(parseItemRef('mem-12', 'contributor'), { type: 'item_number', value: 12, prefix: 'MEM' });
  assert.deepEqual(parseItemRef('12', 'contributor'), { type: 'item_number', value: 12 });
  // CTR-n is a contract: it is no contributor for any caller of the general resolution.
  assert.throws(
    () => parseItemRef('CTR-12', 'contributor'),
    (err: unknown) => err instanceof BadRequestException && /expected MEM-N, got CTR-12/.test(err.message),
  );
  // And a contributor reference opens no other family.
  assert.throws(() => parseItemRef('MEM-12', 'task'), BadRequestException);
  assert.throws(() => parseItemRef('MEM-12', 'project'), BadRequestException);
  assert.throws(() => parseItemRef('MEM-12', 'spend'), BadRequestException);
}

function testLegacyPrefixIsAnOptionOfTheCaller() {
  assert.deepEqual(
    parseItemRef('CTR-12', 'contributor', { alsoAccept: ['CTR'] }),
    { type: 'item_number', value: 12, prefix: 'CTR' },
  );
  assert.deepEqual(parseItemRef('MEM-12', 'contributor', { alsoAccept: ['CTR'] }), { type: 'item_number', value: 12, prefix: 'MEM' });
  // The option names the prefixes of the caller's own type only.
  assert.throws(() => parseItemRef('CTR-12', 'task', { alsoAccept: [] }), BadRequestException);
  assert.throws(() => parseItemRef('CTR-12', 'contributor', { alsoAccept: [] }), BadRequestException);
}

async function testContributorsRouteAcceptsBothReferences() {
  for (const reference of ['MEM-12', 'CTR-12', ROW_ID]) {
    const { controller, queries, read, req } = controllerOver();
    await controller.get(reference, req);
    assert.deepEqual(read, [ROW_ID], `${reference}: the profile is read by its row id`);
    if (reference === ROW_ID) assert.equal(queries.length, 0, 'a uuid is read as given');
    else {
      assert.equal(queries.length, 1);
      assert.match(queries[0].sql, /portfolio_team_member_configs WHERE tenant_id = app_current_tenant\(\) AND item_number = \$1/);
      assert.deepEqual(queries[0].params, [12], `${reference}: the number is looked up in the tenant`);
    }
  }
  // Another family's reference is refused on that route.
  const { controller, queries, req } = controllerOver();
  await assert.rejects(() => controller.get('PRJ-12', req), BadRequestException);
  assert.equal(queries.length, 0);
}

async function testKadAndTheMcpReadNoContributorFromCtr() {
  const calls: unknown[] = [];
  const manager = { query: async (...args: unknown[]) => { calls.push(args); return [{ id: ROW_ID }]; } } as any;
  for (const reference of ['CTR-12', 'MEM-12']) {
    for (const family of ['contributors', 'contributor', 'team_members']) {
      assert.equal(await resolveAiEntityReference(manager, 'tenant-1', family, reference), null, `${family}: ${reference} names no row`);
    }
  }
  assert.equal(calls.length, 0, 'no lookup runs for a contributor reference');
}

/** Only the contributors controller resolves a contributor by its reference, so only it can accept CTR-n. */
function testOnlyTheContributorsControllerAcceptsTheLegacyPrefix() {
  const users: string[] = [];
  const legacy: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__' && entry.name !== 'migrations') walk(full);
      } else if (entry.name.endsWith('.ts')) {
        const source = fs.readFileSync(full, 'utf8');
        const rel = path.relative(backendPath('src'), full);
        if (/(?:parseItemRef|resolveToUuid)\([^;]*'contributor'/.test(source)) users.push(rel);
        if (/alsoAccept/.test(source)) legacy.push(rel);
      }
    }
  };
  walk(backendPath('src'));
  assert.deepEqual(users, [path.join('portfolio', 'team-member-config.controller.ts')]);
  assert.deepEqual(legacy.sort(), [path.join('common', 'resolve-item-id.ts'), path.join('portfolio', 'team-member-config.controller.ts')]);
}

async function main() {
  testGeneralResolutionKnowsMemOnly();
  testLegacyPrefixIsAnOptionOfTheCaller();
  await testContributorsRouteAcceptsBothReferences();
  await testKadAndTheMcpReadNoContributorFromCtr();
  testOnlyTheContributorsControllerAcceptsTheLegacyPrefix();
  console.log('contributor-reference.spec OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
