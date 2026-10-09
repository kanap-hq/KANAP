import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { AiQueryExecutor } from '../query/ai-query.executor';

type SearchItem = { id: string; label: string; ref?: string | null };

function createExecutor(options: {
  searchItems?: SearchItem[];
  contracts?: Record<string, unknown>;
  knowledge?: Record<string, unknown>;
} = {}) {
  const services: any[] = Array.from({ length: 23 }, () => ({}));
  services[6] = options.contracts ?? {};
  services[10] = options.knowledge ?? {};
  const executor = new (AiQueryExecutor as any)(...services) as AiQueryExecutor;
  const searches: string[] = [];
  (executor as any).execute = async (_context: unknown, input: { q: string }) => {
    searches.push(input.q);
    return { items: options.searchItems ?? [] };
  };
  return { executor, searches };
}

function createContext(query: (sql: string, params?: unknown[]) => Promise<unknown[]> = async () => []) {
  return {
    tenantId: randomUUID(),
    userId: randomUUID(),
    isPlatformHost: false,
    surface: 'chat' as const,
    authMethod: 'jwt' as const,
    manager: { query },
  } as any;
}

function resolve(executor: AiQueryExecutor, context: any, entityType: string, rawId: string): Promise<string> {
  return (executor as any).resolveDetailEntityId(context, entityType, rawId);
}

async function testUnmatchedTextThrowsNotFoundBeforeTheService() {
  let serviceCalled = false;
  const { executor, searches } = createExecutor({
    contracts: { get: async () => { serviceCalled = true; return null; } },
  });

  await assert.rejects(
    executor.executeDetail(createContext(), { entity_type: 'contracts', entity_id: 'zzqx-contrat-inexistant' }),
    (error: unknown) => {
      assert.ok(error instanceof NotFoundException);
      assert.equal(
        (error as NotFoundException).message,
        'No contracts record matches "zzqx-contrat-inexistant". Search for it first, then use its id or reference.',
      );
      return true;
    },
  );
  assert.deepEqual(searches, ['zzqx-contrat-inexistant']);
  assert.equal(serviceCalled, false);
}

async function testAmbiguousTextThrowsNotFound() {
  const { executor } = createExecutor({
    searchItems: [
      { id: randomUUID(), label: 'Microsoft 365 E3' },
      { id: randomUUID(), label: 'Microsoft 365 E5' },
    ],
  });
  await assert.rejects(resolve(executor, createContext(), 'contracts', 'Microsoft'), NotFoundException);
}

async function testMatchesStillResolve() {
  const exactId = randomUUID();
  const exact = createExecutor({
    searchItems: [
      { id: randomUUID(), label: 'Oracle support renewal' },
      { id: exactId, label: 'Oracle support' },
    ],
  });
  assert.equal(await resolve(exact.executor, createContext(), 'contracts', 'oracle support'), exactId);

  const singleId = randomUUID();
  const single = createExecutor({ searchItems: [{ id: singleId, label: 'Salesforce Enterprise' }] });
  assert.equal(await resolve(single.executor, createContext(), 'contracts', 'salesforce'), singleId);
}

async function testUuidsPassThroughWithoutSearch() {
  const { executor, searches } = createExecutor();
  const v4 = randomUUID();
  const v7 = '01928f6e-7c2a-7b3d-9e4f-0a1b2c3d4e5f';
  assert.equal(await resolve(executor, createContext(), 'contracts', v4), v4);
  assert.equal(await resolve(executor, createContext(), 'contracts', v7), v7);
  assert.deepEqual(searches, []);
}

async function testDocumentsKeepTheRawReference() {
  const received: string[] = [];
  const { executor, searches } = createExecutor({
    knowledge: { get: async (idOrRef: string) => { received.push(idOrRef); return null; } },
  });
  assert.equal(await resolve(executor, createContext(), 'documents', 'DOC-12'), 'DOC-12');
  assert.equal(await resolve(executor, createContext(), 'documents', 'zzqx'), 'zzqx');
  assert.deepEqual(searches, []);
}

async function testIncidentReferences() {
  const incidentId = randomUUID();
  const { executor, searches } = createExecutor();
  const found = createContext(async (sql, params) => {
    assert.match(sql, /FROM incidents WHERE tenant_id = \$1 AND item_number = \$2/);
    assert.equal(params?.[1], 7);
    return [{ id: incidentId }];
  });
  assert.equal(await resolve(executor, found, 'incidents', 'INC-7'), incidentId);

  await assert.rejects(
    resolve(executor, createContext(async () => []), 'incidents', 'INC-99'),
    (error: unknown) => error instanceof NotFoundException && error.message === 'Incident not found.',
  );
  assert.deepEqual(searches, []);

  await assert.rejects(resolve(executor, createContext(), 'incidents', 'printer on fire'), NotFoundException);
  assert.deepEqual(searches, ['printer on fire']);
}

async function run() {
  await testUnmatchedTextThrowsNotFoundBeforeTheService();
  await testAmbiguousTextThrowsNotFound();
  await testMatchesStillResolve();
  await testUuidsPassThroughWithoutSearch();
  await testDocumentsKeepTheRawReference();
  await testIncidentReferences();
  console.log('ai-query-detail-entity-id spec passed');
}

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});
