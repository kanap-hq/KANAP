import * as assert from 'node:assert/strict';
import { CsvResolverService } from '../csv-resolver.service';
import { CsvFieldDefinition, CsvFieldType } from '../csv-field.types';

/**
 * Mock EntityManager for testing
 */
function createMockManager(data: Record<string, any[]>) {
  // Two queries in flight at once are the node-postgres warning
  // (`client.query() when the client is already executing a query`).
  let busy = 0;
  return {
    query: async (sql: string, params: any[]) => {
      if (busy > 0) throw new Error('client.query() when the client is already executing a query');
      busy += 1;
      try {
        await new Promise((resolve) => setImmediate(resolve));
        // Extract table name from query
        const tableMatch = sql.match(/FROM (\w+)/i);
        const tableName = tableMatch?.[1] || '';
        const tenantId = params[0];

        // Return mock data for the table
        return data[tableName]?.filter((row) => row.tenant_id === tenantId) || [];
      } finally {
        busy -= 1;
      }
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


// Lot I3 of 26.11.9: a name of the file finds a record once accents are set aside, for the families
// looked up by name; case aside first, as before; several names answering are an ambiguity.
async function testNamesBeyondAccents() {
  const service = new CsvResolverService();
  const mockData = {
    suppliers: [
      { id: 's1', name: 'Société Générale', item_number: 4, tenant_id: 't1' },
      { id: 's2', name: 'Café', item_number: 7, tenant_id: 't1' },
      { id: 's3', name: 'Cafè', item_number: 8, tenant_id: 't1' },
    ],
    companies: [
      { id: 'c1', name: 'Café', item_number: 1, tenant_id: 't1' },
      { id: 'c2', name: 'Cafe', item_number: 2, tenant_id: 't1' },
    ],
    portfolio_sources: [
      { id: 'p1', name: 'Métier', tenant_id: 't1' },
      { id: 'p2', name: 'Metièr', tenant_id: 't1' },
    ],
  };
  const fields: CsvFieldDefinition[] = [
    { csvColumn: 'supplier_name', entityProperty: 'supplier_id', type: CsvFieldType.FK_BY_NAME, fkEntity: 'suppliers' },
    { csvColumn: 'company_name', entityProperty: 'company_id', type: CsvFieldType.FK_BY_NAME, fkEntity: 'companies' },
    { csvColumn: 'source_name', entityProperty: 'source_id', type: CsvFieldType.FK_BY_NAME, fkEntity: 'portfolio_sources' },
  ];
  const cache = await service.preloadResolvers('t1', fields, createMockManager(mockData));
  const beyond = { beyondCase: true };

  for (const cell of ['Societe Generale', 'SOCIETE GENERALE']) {
    const found = service.resolveName('suppliers', cell, cache, beyond);
    assert.equal(found.kind, 'one', cell);
    assert.deepEqual(found.kind === 'one' && [found.entry.id, found.how, found.target, found.ref], ['s1', 'accents', 'Société Générale', 'SUP-4'], cell);
  }
  // Case aside first: the same name, no match to list.
  const sameCase = service.resolveName('suppliers', 'société générale', cache, beyond);
  assert.deepEqual(sameCase.kind === 'one' && [sameCase.entry.id, sameCase.how], ['s1', 'case']);
  const exact = service.resolveName('suppliers', 'Société Générale', cache, beyond);
  assert.deepEqual(exact.kind === 'one' && exact.how, 'exact');
  // The case-blind lookup is unchanged: resolveId never sets accents aside.
  assert.equal(service.resolveId('suppliers', 'Societe Generale', cache), null);
  // Not beyond case (the person does not read the family, or the value was undone): not found.
  assert.deepEqual(service.resolveName('suppliers', 'Societe Generale', cache, { beyondCase: false }), { kind: 'none' });

  // "Café" and "Cafe": the file's "cafe" is "Cafe" by case, no match beyond case.
  const cafe = service.resolveName('companies', 'cafe', cache, beyond);
  assert.deepEqual(cafe.kind === 'one' && [cafe.entry.id, cafe.how, cafe.ref], ['c2', 'case', 'COMP-2']);
  // "Café" and "Cafè": the file's "cafe" may be either, named by their references.
  assert.deepEqual(service.resolveName('suppliers', 'cafe', cache, beyond), { kind: 'many', names: ['SUP-7', 'SUP-8'] });
  // A family without references: named by their names.
  assert.deepEqual(service.resolveName('portfolio_sources', 'metier', cache, beyond), { kind: 'many', names: ['Métier', 'Metièr'] });
  console.log('  names beyond accents, case first, ambiguity named: OK');
}

// The same name held by several records (two departments of two companies): the accent level gives
// the record the case-blind lookup gives for that name, as before; no ambiguity among equal names.
async function testEqualNamesStayOneName() {
  const service = new CsvResolverService();
  const mockData = {
    departments: [
      { id: 'd1', name: 'Études', company_id: 'c1', item_number: 1, tenant_id: 't1' },
      { id: 'd2', name: 'études', company_id: 'c2', item_number: 2, tenant_id: 't1' },
    ],
  };
  const fields: CsvFieldDefinition[] = [
    { csvColumn: 'department_name', entityProperty: 'department_id', type: CsvFieldType.FK_BY_NAME, fkEntity: 'departments' },
  ];
  const cache = await service.preloadResolvers('t1', fields, createMockManager(mockData));
  assert.equal(service.resolveId('departments', 'ÉTUDES', cache), 'd1');
  const found = service.resolveName('departments', 'Etudes', cache, { beyondCase: true });
  assert.deepEqual(found.kind === 'one' && [found.entry.id, found.how, found.ref], ['d1', 'accents', 'DEPT-1']);
  console.log('  equal names beyond accents stay the case-blind record: OK');
}

// A shipped task type found by its name in another language is a translation; e-mails and site
// references are never looked up beyond case.
async function testTranslationsAndCodesBeyondCase() {
  const service = new CsvResolverService();
  const mockData = {
    portfolio_task_types: [{ id: 'tt-task', name: 'Task', code: 'task', tenant_id: 't1' }],
    users: [{ id: 'u1', email: 'josé@example.com', first_name: 'José', last_name: 'Ruiz', tenant_id: 't1' }],
    locations: [{ id: 'l1', location_reference: 'LOC-É1', name: 'Siège', tenant_id: 't1' }],
  };
  const fields: CsvFieldDefinition[] = [
    { csvColumn: 'task_type_name', entityProperty: 'task_type_id', type: CsvFieldType.FK_BY_NAME, fkEntity: 'portfolio_task_types' },
    { csvColumn: 'assignee_email', entityProperty: 'assignee_user_id', type: CsvFieldType.FK_BY_EMAIL, fkEntity: 'users' },
    { csvColumn: 'location_reference', entityProperty: 'location_id', type: CsvFieldType.FK_BY_CODE, fkEntity: 'locations' },
  ];
  const cache = await service.preloadResolvers('t1', fields, createMockManager(mockData));
  const beyond = { beyondCase: true };
  const translated = service.resolveName('portfolio_task_types', 'Tâche', cache, beyond);
  assert.deepEqual(translated.kind === 'one' && [translated.entry.id, translated.how, translated.target, translated.ref], ['tt-task', 'translation', 'Task', null]);
  const shown = service.resolveName('portfolio_task_types', 'tache', cache, beyond);
  assert.deepEqual(shown.kind === 'one' && [shown.entry.id, shown.how], ['tt-task', 'translation']);
  const own = service.resolveName('portfolio_task_types', 'TASK', cache, beyond);
  assert.deepEqual(own.kind === 'one' && own.how, 'case');
  assert.deepEqual(service.resolveName('users', 'jose@example.com', cache, beyond), { kind: 'none' });
  assert.deepEqual(service.resolveName('locations', 'LOC-E1', cache, beyond), { kind: 'none' });
  assert.equal(service.matchesBeyondCase('users', { isAdmin: true }), false);
  assert.equal(service.matchesBeyondCase('locations', { isAdmin: true }), false);
  console.log('  translations noted, e-mails and site references never beyond case: OK');
}

// Beyond case only for a family whose module the person reads.
async function testBeyondCaseFollowsReadRights() {
  const service = new CsvResolverService();
  assert.equal(service.matchesBeyondCase('suppliers', { isAdmin: true }), true);
  assert.equal(service.matchesBeyondCase('suppliers', { permissions: { suppliers: 'reader' } }), true);
  assert.equal(service.matchesBeyondCase('suppliers', { permissions: { applications: 'admin' } }), false);
  assert.equal(service.matchesBeyondCase('suppliers', null), false, 'no access given: case-blind as before');
  assert.equal(service.matchesBeyondCase('portfolio_sources', { permissions: { tasks: 'reader' } }), true);
  assert.equal(service.matchesBeyondCase('portfolio_task_types', { permissions: { portfolio_projects: 'admin' } }), false);
  assert.equal(service.matchesBeyondCase('portfolio_project_phases', { permissions: { portfolio_projects: 'reader' } }), true);
  console.log('  beyond case for the families the person reads: OK');
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
  await testNamesBeyondAccents();
  await testEqualNamesStayOneName();
  await testTranslationsAndCodesBeyondCase();
  await testBeyondCaseFollowsReadRights();

  console.log('CSV resolver service tests passed.');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
