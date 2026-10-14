import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { AiEntityService } from '../ai-entity.service';
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
    (error: unknown) => error instanceof NotFoundException
      && error.message === 'No incidents record matches "INC-99". Search for it first, then use its id or reference.',
  );
  assert.deepEqual(searches, []);

  await assert.rejects(resolve(executor, createContext(), 'incidents', 'printer on fire'), NotFoundException);
  assert.deepEqual(searches, ['printer on fire']);
}

async function testFamilyReferencesResolveWithoutSearch() {
  const cases: Array<[string, string, RegExp, unknown]> = [
    ['applications', 'APP-1', /FROM applications WHERE tenant_id = \$1 AND upper\(sequential_id\) = \$2/, 'APP-1'],
    ['applications', 'app-007', /FROM applications/, 'APP-7'],
    ['assets', 'AST-3', /FROM assets WHERE tenant_id = \$1 AND upper\(asset_reference\) = \$2/, 'AST-3'],
    ['projects', 'PRJ-1', /FROM portfolio_projects WHERE tenant_id = \$1 AND item_number = \$2/, 1],
    ['requests', 'REQ-7', /FROM portfolio_requests WHERE tenant_id = \$1 AND item_number = \$2/, 7],
    ['tasks', 'T-42', /FROM tasks WHERE tenant_id = \$1 AND item_number = \$2/, 42],
  ];
  for (const [entityType, ref, sqlPattern, param] of cases) {
    const id = randomUUID();
    const { executor, searches } = createExecutor();
    const context = createContext(async (sql, params) => {
      assert.match(sql, sqlPattern);
      assert.equal(params?.[0], context.tenantId, 'lookup is scoped to the caller tenant');
      assert.equal(params?.[1], param);
      return [{ id }];
    });
    assert.equal(await resolve(executor, context, entityType, ref), id, `${entityType} ${ref}`);
    assert.deepEqual(searches, [], `${entityType} ${ref} resolves without a text search`);
  }

  const { executor, searches } = createExecutor();
  await assert.rejects(
    resolve(executor, createContext(async () => []), 'applications', 'APP-999'),
    (error: unknown) => error instanceof NotFoundException && error.message.startsWith('No applications record matches "APP-999"'),
  );
  // Another family's prefix is not a reference of this one: it falls back to the text search.
  await assert.rejects(resolve(executor, createContext(), 'applications', 'PRJ-1'), NotFoundException);
  assert.deepEqual(searches, ['PRJ-1']);
}

async function testApplicationAndAssetRefsAreTopLevel() {
  const { executor } = createExecutor();
  const map = executor as any;
  assert.equal(map.mapApplication({ id: 'a', name: 'Microsoft 365', sequential_id: 'APP-1' }).ref, 'APP-1');
  assert.equal(map.mapAsset({ id: 'b', name: 'WEB-SRV-01', asset_reference: 'AST-7' }).ref, 'AST-7');
  assert.equal(map.mapContract({ id: 'c', name: 'Support' }).ref, null, 'contracts have no reference');
}

async function testEntityContextAcceptsReferences() {
  const projectId = randomUUID();
  const service = Object.create(AiEntityService.prototype) as any;
  service.policy = { assertEntityTypeReadAccess: async () => undefined };
  const built: string[] = [];
  service.buildProjectContext = async (_context: unknown, id: string) => {
    built.push(id);
    return { entity: { type: 'projects', id, ref: 'PRJ-1', metadata: {} }, related: [] };
  };
  const context = createContext(async (sql, params) => {
    assert.match(sql, /FROM portfolio_projects WHERE tenant_id = \$1 AND item_number = \$2/);
    return params?.[1] === 1 ? [{ id: projectId }] : [];
  });

  const result = await service.getEntityContext(context, { entity_type: 'projects', entity_id: 'PRJ-1' });
  assert.equal(result.entity.id, projectId);
  assert.deepEqual(built, [projectId]);

  const uuid = randomUUID();
  await service.getEntityContext(createContext(async () => { throw new Error('a uuid needs no lookup'); }), {
    entity_type: 'projects',
    entity_id: uuid,
  });
  assert.deepEqual(built, [projectId, uuid]);

  for (const missing of ['PRJ-99', 'not a project']) {
    await assert.rejects(
      service.getEntityContext(context, { entity_type: 'projects', entity_id: missing }),
      (error: unknown) => error instanceof NotFoundException && error.message.startsWith(`No projects record matches "${missing}"`),
    );
  }
  assert.equal(built.length, 2, 'the builders never receive a value that is not a uuid');
}

async function testNativeBudgetReferences() {
  const { executor } = createExecutor();
  const map = executor as any;
  const registry = { fields: {} };
  const opex = map.mapSpendItem({ id: 'opex', item_number: 12, reference: 'BL-12', product_name: 'License' }, registry);
  const capex = map.mapCapexItem({ id: 'capex', item_number: 3, reference: 'BL-103', description: 'Server' }, registry);
  assert.equal(opex.ref, 'BL-12');
  assert.equal(capex.ref, 'BL-103', 'CAPEX alias item_number is its CPX number, reference is native');
  assert.equal(map.mapSpendItem({ id: 'opex', item_number: 12 }, registry).ref, 'BL-12');
}

async function run() {
  await testUnmatchedTextThrowsNotFoundBeforeTheService();
  await testAmbiguousTextThrowsNotFound();
  await testMatchesStillResolve();
  await testUuidsPassThroughWithoutSearch();
  await testDocumentsKeepTheRawReference();
  await testIncidentReferences();
  await testFamilyReferencesResolveWithoutSearch();
  await testApplicationAndAssetRefsAreTopLevel();
  await testEntityContextAcceptsReferences();
  await testNativeBudgetReferences();
  console.log('ai-query-detail-entity-id spec passed');
}

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});
