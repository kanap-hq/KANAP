import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AiEntityService } from '../ai-entity.service';
import { AiPolicyService } from '../ai-policy.service';
import { AiSearchController } from '../ai-search.controller';
import { Features } from '../../config/features';
import { Subscription } from '../../billing/subscription.entity';
import { Tenant, TenantStatus } from '../../tenants/tenant.entity';
import { UserRole } from '../../users/user-role.entity';

// Entity types of the @-mention search: only the known types reach the query
// layer (the controller drops the others, the policy never returns them, for
// administrators too), and savepoint names are a fixed prefix and a counter,
// whatever type is requested.

const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const UNKNOWN_TYPE = 'not_a_known_type';
const TENANT_ID = '11111111-1111-4111-8111-111111111111';

type Statement = { sql: string; params: unknown[] };

function createRequest() {
  return { tenant: { id: TENANT_ID }, user: { sub: 'user-1' }, id: 'req-1', isPlatformHost: false };
}

async function withEnv<T>(name: string, value: string, run: () => Promise<T>): Promise<T> {
  const previous = process.env[name];
  process.env[name] = value;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

/** Controller with a stub entity service that records the types it receives. */
function createControllerWithRecorder() {
  const received: string[][] = [];
  const controller = new AiSearchController(
    { runWithContext: async (context: any, fn: Function) => fn({ ...context, manager: {} }) } as any,
    { assertSurfaceAccess: async () => undefined } as any,
    {
      searchMentionCandidates: async (_context: unknown, input: { entity_types: string[] }) => {
        received.push([...input.entity_types]);
        return { items: [] };
      },
    } as any,
  );
  return { controller, received };
}

async function testControllerKeepsKnownTypesOnly() {
  const { controller, received } = createControllerWithRecorder();

  await controller.searchEntities(createRequest(), 'billing', undefined, `applications, ${UNKNOWN_TYPE} ,projects,Applications`);
  assert.deepEqual(received.pop(), ['applications', 'projects'], 'unknown values are dropped, known ones kept in order');

  await controller.searchEntities(createRequest(), '', undefined, 'tasks');
  assert.deepEqual(received.pop(), ['tasks'], 'a known narrow is unchanged');
}

async function testControllerTreatsOnlyUnknownTypesAsNoNarrow() {
  const { controller, received } = createControllerWithRecorder();

  const empty = await controller.searchEntities(createRequest(), '', undefined, `${UNKNOWN_TYPE},other value`);
  assert.deepEqual(empty, { items: [] }, 'an empty query without a known narrow returns nothing');
  assert.equal(received.length, 0, 'the entity service is not called');

  await controller.searchEntities(createRequest(), 'billing', undefined, undefined);
  const defaultTypes = received.pop();
  assert.ok(defaultTypes?.includes('spend_items') && defaultTypes.includes('capex_items'), 'the default types include OPEX and CAPEX lines');
  await controller.searchEntities(createRequest(), 'billing', undefined, UNKNOWN_TYPE);
  assert.deepEqual(received.pop(), defaultTypes, 'a query with unknown types only searches the default types');

  await controller.searchEntities(createRequest(), 'billing', undefined, ['tasks', UNKNOWN_TYPE] as any);
  assert.deepEqual(received.pop(), ['tasks'], 'a repeated parameter is read as one list');
}

/** Manager answering the policy's repository reads and recording every SQL statement. */
function createManager(statements: Statement[]) {
  return {
    getRepository(entity: unknown) {
      if (entity === UserRole) {
        return { find: async () => [{ role_id: 'role-admin', role: { role_name: 'Administrator' } }] };
      }
      if (entity === Tenant) {
        return { findOne: async () => ({ id: TENANT_ID, status: TenantStatus.ACTIVE }) };
      }
      if (entity === Subscription) {
        return { findOne: async () => null };
      }
      throw new Error(`Unexpected repository request: ${String(entity)}`);
    },
    query: async (sql: string, params?: unknown[]) => {
      statements.push({ sql, params: params ?? [] });
      return [];
    },
  };
}

function createAdministratorPolicy() {
  const settings = { tenant_id: TENANT_ID, chat_enabled: true, mcp_enabled: false };
  return new AiPolicyService(
    {
      findById: async () => ({
        id: 'user-1',
        status: 'enabled',
        role_id: 'role-admin',
        role: { role_name: 'Administrator', is_system: true },
      }),
    } as any,
    { listForRoles: async () => new Map() } as any,
    {
      get: async () => settings,
      find: async () => settings,
      getProviderValidationErrors: async () => [],
    } as any,
    {} as any,
    {} as any,
    { isConfigured: () => false } as any,
  );
}

function createEntityService(policy: unknown) {
  return new AiEntityService(
    {
      searchMentionOptions: async () => ({ items: [], total: 0 }),
      search: async () => ({ items: [], total: 0 }),
      listReadableLibraryIdsForUser: async () => null,
    } as any,
    policy as any,
  );
}

/**
 * End to end with an administrator (who passes every permission check): an
 * unknown type appears in no SQL statement and no parameter, on the indexed
 * and the per-type search paths.
 */
async function testUnknownTypeNeverReachesTheQueryLayer() {
  const originalChat = Features.AI_CHAT_ENABLED;
  Features.AI_CHAT_ENABLED = true;
  try {
    for (const indexed of ['true', 'false']) {
      await withEnv('AI_SEARCH_INDEX_ENABLED', indexed, async () => {
        const statements: Statement[] = [];
        const manager = createManager(statements);
        const policy = createAdministratorPolicy();
        const controller = new AiSearchController(
          { runWithContext: async (context: any, fn: Function) => fn({ ...context, manager }) } as any,
          policy,
          createEntityService(policy),
        );

        await controller.searchEntities(createRequest(), 'billing', undefined, `tasks,${UNKNOWN_TYPE}`);

        assert.ok(statements.length > 0, `index=${indexed}: the known type is searched`);
        const recorded = JSON.stringify(statements);
        assert.equal(recorded.includes(UNKNOWN_TYPE), false, `index=${indexed}: the unknown type reaches no statement`);
      });
    }

    const policy = createAdministratorPolicy();
    const context = {
      tenantId: TENANT_ID,
      userId: 'user-1',
      isPlatformHost: false,
      surface: 'chat' as const,
      authMethod: 'jwt' as const,
    };
    const readable = await policy.listReadableEntityTypes(
      context,
      ['applications', UNKNOWN_TYPE, 'toString', 'tasks'] as any,
      createManager([]) as any,
    );
    assert.deepEqual(readable, ['applications', 'tasks'], 'the policy returns known types only, for an administrator too');
  } finally {
    Features.AI_CHAT_ENABLED = originalChat;
  }
}

function savepointNames(statements: Statement[]): string[] {
  return statements
    .map((statement) => /^(?:SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)\s+(.*)$/.exec(statement.sql.trim())?.[1])
    .filter((name): name is string => name !== undefined);
}

/**
 * Savepoint names stay within a safe alphabet whatever type the search is
 * given (the policy stub passes every requested value through).
 */
async function testSavepointNamesUseFixedPrefixAndCounter() {
  const odd = ['tasks', 'Type With Spaces', 'type-with-dashes', 'unknown.type', 'ÉTYPE'];
  for (const indexed of ['true', 'false']) {
    await withEnv('AI_SEARCH_INDEX_ENABLED', indexed, async () => {
      const statements: Statement[] = [];
      const service = createEntityService({
        listReadableEntityTypes: async (_context: unknown, requested: string[]) => requested,
      });
      const context = {
        tenantId: randomUUID(),
        userId: randomUUID(),
        isPlatformHost: false,
        surface: 'chat' as const,
        authMethod: 'jwt' as const,
        manager: { query: async (sql: string, params?: unknown[]) => { statements.push({ sql, params: params ?? [] }); return []; } },
      };

      await service.searchMentionCandidates(context as any, { query: 'billing', entity_types: odd as any, limit: 10 });
      await service.searchByEntityTypes(context as any, { query: 'billing', entity_types: odd as any, limitPerType: 3 });
      await service.searchAll(context as any, { query: 'billing', entity_types: odd as any, limit: 10 });

      const names = savepointNames(statements);
      assert.ok(names.length >= odd.length * 2, `index=${indexed}: savepoints were opened (${names.length})`);
      for (const name of names) {
        assert.match(name, SAFE_IDENTIFIER, `index=${indexed}: savepoint name "${name}"`);
        assert.match(name, /^(mention|pick|search)_sp_\d+$/, `index=${indexed}: fixed prefix and counter ("${name}")`);
      }
    });
  }
}

async function run() {
  await testControllerKeepsKnownTypesOnly();
  await testControllerTreatsOnlyUnknownTypesAsNoNarrow();
  await testUnknownTypeNeverReachesTheQueryLayer();
  await testSavepointNamesUseFixedPrefixAndCounter();
  console.log('ai-search-entity-types.spec: ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
