import * as assert from 'node:assert/strict';
import { CsvResolverService } from '../csv-resolver.service';
import { CsvFieldDefinition, CsvFieldType } from '../csv-field.types';

/**
 * Mock EntityManager for testing
 */
function createMockManager(data: Record<string, any[]>) {
  return {
    query: async (sql: string, params: any[]) => {
      // Extract table name from query
      const tableMatch = sql.match(/FROM (\w+)/i);
      const tableName = tableMatch?.[1] || '';
      const tenantId = params[0];

      // Return mock data for the table
      return data[tableName]?.filter((row) => row.tenant_id === tenantId) || [];
    },
  } as any;
}

// ===== Tests =====

async function testPreloadResolversLoadsUsers() {
  const service = new CsvResolverService();

  const mockData = {
    users: [
      { id: 'u1', email: 'alice@example.com', tenant_id: 't1' },
      { id: 'u2', email: 'Bob@Example.com', tenant_id: 't1' },
      { id: 'u3', email: 'charlie@other.com', tenant_id: 't2' },
    ],
  };

  const fields: CsvFieldDefinition[] = [
    { csvColumn: 'assignee_email', entityProperty: 'assignee_user_id', type: CsvFieldType.FK_BY_EMAIL, fkEntity: 'users' },
  ];

  const cache = await service.preloadResolvers('t1', fields, createMockManager(mockData));

  assert.ok(cache.has('users'));
  assert.equal(cache.get('users')?.size, 2);
}

async function testResolveWithCaseInsensitiveMatch() {
  const service = new CsvResolverService();

  const mockData = {
    users: [
      { id: 'u1', email: 'Alice@Example.com', tenant_id: 't1' },
    ],
  };

  const fields: CsvFieldDefinition[] = [
    { csvColumn: 'email', entityProperty: 'user_id', type: CsvFieldType.FK_BY_EMAIL, fkEntity: 'users' },
  ];

  const cache = await service.preloadResolvers('t1', fields, createMockManager(mockData));

  // Test various case variations
  assert.equal(service.resolveId('users', 'alice@example.com', cache), 'u1');
  assert.equal(service.resolveId('users', 'ALICE@EXAMPLE.COM', cache), 'u1');
  assert.equal(service.resolveId('users', 'Alice@Example.com', cache), 'u1');
  assert.equal(service.resolveId('users', '  alice@example.com  ', cache), 'u1');
}

async function testResolveReturnsNullForNotFound() {
  const service = new CsvResolverService();

  const mockData = {
    users: [
      { id: 'u1', email: 'alice@example.com', tenant_id: 't1' },
    ],
  };

  const fields: CsvFieldDefinition[] = [
    { csvColumn: 'email', entityProperty: 'user_id', type: CsvFieldType.FK_BY_EMAIL, fkEntity: 'users' },
  ];

  const cache = await service.preloadResolvers('t1', fields, createMockManager(mockData));

  assert.equal(service.resolveId('users', 'notfound@example.com', cache), null);
  assert.equal(service.resolveId('users', '', cache), null);
  assert.equal(service.resolveId('users', null, cache), null);
  assert.equal(service.resolveId('users', undefined, cache), null);
}

async function testResolveSuppliersByName() {
  const service = new CsvResolverService();

  const mockData = {
    suppliers: [
      { id: 's1', name: 'Acme Corp', tenant_id: 't1' },
      { id: 's2', name: 'Big Company', tenant_id: 't1' },
    ],
  };

  const fields: CsvFieldDefinition[] = [
    { csvColumn: 'supplier', entityProperty: 'supplier_id', type: CsvFieldType.FK_BY_NAME, fkEntity: 'suppliers' },
  ];

  const cache = await service.preloadResolvers('t1', fields, createMockManager(mockData));

  assert.equal(service.resolveId('suppliers', 'acme corp', cache), 's1');
  assert.equal(service.resolveId('suppliers', 'ACME CORP', cache), 's1');
  assert.equal(service.resolveId('suppliers', 'Big Company', cache), 's2');
}

async function testReverseResolve() {
  const service = new CsvResolverService();

  const mockData = {
    users: [
      { id: 'u1', email: 'alice@example.com', tenant_id: 't1' },
    ],
  };

  const fields: CsvFieldDefinition[] = [
    { csvColumn: 'email', entityProperty: 'user_id', type: CsvFieldType.FK_BY_EMAIL, fkEntity: 'users' },
  ];

  const cache = await service.preloadResolvers('t1', fields, createMockManager(mockData));

  // Build reverse lookup
  const reverseLookup = service.buildReverseLookup('users', cache);

  assert.equal(reverseLookup.get('u1'), 'alice@example.com');
  assert.equal(reverseLookup.get('u999'), undefined);
}

async function testPreloadMultipleEntityTypes() {
  const service = new CsvResolverService();

  const mockData = {
    users: [
      { id: 'u1', email: 'alice@example.com', tenant_id: 't1' },
    ],
    suppliers: [
      { id: 's1', name: 'Acme Corp', tenant_id: 't1' },
    ],
    companies: [
      { id: 'c1', name: 'Test Company', tenant_id: 't1' },
    ],
  };

  const fields: CsvFieldDefinition[] = [
    { csvColumn: 'email', entityProperty: 'user_id', type: CsvFieldType.FK_BY_EMAIL, fkEntity: 'users' },
    { csvColumn: 'supplier', entityProperty: 'supplier_id', type: CsvFieldType.FK_BY_NAME, fkEntity: 'suppliers' },
    { csvColumn: 'company', entityProperty: 'company_id', type: CsvFieldType.FK_BY_NAME, fkEntity: 'companies' },
  ];

  const cache = await service.preloadResolvers('t1', fields, createMockManager(mockData));

  assert.equal(cache.size, 3);
  assert.ok(cache.has('users'));
  assert.ok(cache.has('suppliers'));
  assert.ok(cache.has('companies'));
}

async function testIsSupportedEntity() {
  const service = new CsvResolverService();

  assert.equal(service.isSupported('users'), true);
  assert.equal(service.isSupported('suppliers'), true);
  assert.equal(service.isSupported('unknown_entity'), false);
}

async function testGetLookupColumn() {
  const service = new CsvResolverService();

  assert.equal(service.getLookupColumn('users'), 'email');
  assert.equal(service.getLookupColumn('suppliers'), 'name');
  assert.equal(service.getLookupColumn('locations'), 'location_reference');
}

// ===== Run tests =====

// A task type the tenant kept as shipped also answers to the name it is shown with in each
// language ("Tâche", "Aufgabe"); a renamed one only to its own name, and a tenant's own type
// named like a translation wins. Exports still write the stored name.
async function testTaskTypesAcceptTheirShownNames() {
  const service = new CsvResolverService();
  const mockData = {
    portfolio_task_types: [
      { id: 'tt-task', name: 'Task', code: 'task', tenant_id: 't1' },
      { id: 'tt-bug', name: 'Defect', code: 'bug', tenant_id: 't1' },
      { id: 'tt-problem', name: 'Problem', code: 'problem', tenant_id: 't1' },
      { id: 'tt-own', name: 'Problème', code: null, tenant_id: 't1' },
    ],
  };
  const fields: CsvFieldDefinition[] = [
    { csvColumn: 'task_type_name', entityProperty: 'task_type_id', type: CsvFieldType.FK_BY_NAME, fkEntity: 'portfolio_task_types' },
  ];
  const cache = await service.preloadResolvers('t1', fields, createMockManager(mockData));
  assert.equal(service.resolveId('portfolio_task_types', 'Task', cache), 'tt-task');
  assert.equal(service.resolveId('portfolio_task_types', 'Tâche', cache), 'tt-task', 'French name of a kept shipped type');
  assert.equal(service.resolveId('portfolio_task_types', 'aufgabe', cache), 'tt-task', 'German name, any case');
  assert.equal(service.resolveId('portfolio_task_types', 'Anomalie', cache), null, 'a renamed type answers to its own name only');
  assert.equal(service.resolveId('portfolio_task_types', 'Defect', cache), 'tt-bug');
  assert.equal(service.resolveId('portfolio_task_types', 'Problème', cache), 'tt-own', 'a tenant type named like a translation wins');
  assert.equal(service.resolveId('portfolio_task_types', 'Problema', cache), 'tt-problem');
  assert.equal(service.reverseResolve('portfolio_task_types', 'tt-task', cache), 'Task', 'exports write the stored name');
}

(async () => {
  await testPreloadResolversLoadsUsers();
  await testResolveWithCaseInsensitiveMatch();
  await testResolveReturnsNullForNotFound();
  await testResolveSuppliersByName();
  await testReverseResolve();
  await testPreloadMultipleEntityTypes();
  await testIsSupportedEntity();
  await testGetLookupColumn();
  await testTaskTypesAcceptTheirShownNames();

  console.log('CSV resolver service tests passed.');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
