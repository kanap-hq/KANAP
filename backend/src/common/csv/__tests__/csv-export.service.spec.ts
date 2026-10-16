import * as assert from 'node:assert/strict';
import { CsvExportService, denormalizeCsvFormulaValue, neutralizeCsvFormulaValue } from '../csv-export.service';
import { CsvResolverService } from '../csv-resolver.service';
import {
  ArrayStrategy,
  CsvEntityConfig,
  CsvFieldType,
} from '../csv-field.types';

/**
 * Mock EntityManager for testing
 */
function createMockManager(data: Record<string, any[]>) {
  return {
    query: async (sql: string, params: any[]) => {
      const tableMatch = sql.match(/FROM (\w+)/i);
      const tableName = tableMatch?.[1] || '';
      const tenantId = params[0];
      return data[tableName]?.filter((row) => row.tenant_id === tenantId) || [];
    },
  } as any;
}

/**
 * Create a simple test config
 */
function createTestConfig(): CsvEntityConfig {
  return {
    entityName: 'task',
    tableName: 'tasks',
    displayName: 'Tasks',
    upsertKey: ['title'],
    fields: [
      { csvColumn: 'id', entityProperty: 'id', type: CsvFieldType.STRING, isIdentityColumn: true },
      { csvColumn: 'title', entityProperty: 'title', type: CsvFieldType.STRING, required: true },
      { csvColumn: 'description', entityProperty: 'description', type: CsvFieldType.STRING },
      { csvColumn: 'status', entityProperty: 'status', type: CsvFieldType.ENUM, enumValues: ['open', 'in_progress', 'done'] },
      { csvColumn: 'due_date', entityProperty: 'due_date', type: CsvFieldType.DATE },
      { csvColumn: 'priority', entityProperty: 'priority', type: CsvFieldType.NUMBER },
    ],
  };
}

/**
 * Create config with array fields
 */
function createConfigWithArrays(): CsvEntityConfig {
  return {
    entityName: 'task',
    tableName: 'tasks',
    displayName: 'Tasks',
    upsertKey: ['title'],
    fields: [
      { csvColumn: 'id', entityProperty: 'id', type: CsvFieldType.STRING, isIdentityColumn: true },
      { csvColumn: 'title', entityProperty: 'title', type: CsvFieldType.STRING },
      { csvColumn: 'labels', entityProperty: 'labels', type: CsvFieldType.ARRAY },
      {
        csvColumn: 'owner_id_1',
        entityProperty: 'owner_ids',
        type: CsvFieldType.ARRAY,
        arrayStrategy: ArrayStrategy.NUMBERED_COLUMNS,
        maxItems: 3,
      },
    ],
  };
}

// ===== Tests =====

async function testTemplateExportReturnsHeadersOnly() {
  const resolver = new CsvResolverService();
  const service = new CsvExportService(resolver);
  const config = createTestConfig();

  const result = await service.export(config, [], {
    manager: createMockManager({}),
    tenantId: 't1',
    language: 'fr',
    scope: 'template',
  });

  assert.equal(result.rowCount, 0);
  assert.ok(result.content.startsWith('\uFEFF')); // BOM
  assert.ok(result.content.includes('id;title;description;status;due_date;priority'));
  assert.equal(result.filename, 'task_template.csv');
}

async function testDataExportIncludesRows() {
  const resolver = new CsvResolverService();
  const service = new CsvExportService(resolver);
  const config = createTestConfig();

  const entities = [
    { id: '1', title: 'Task 1', description: 'Desc 1', status: 'open', due_date: '2024-01-15', priority: 1 },
    { id: '2', title: 'Task 2', description: null, status: 'done', due_date: null, priority: 2 },
  ];

  const result = await service.export(config, entities, {
    manager: createMockManager({}),
    tenantId: 't1',
    language: 'fr',
    scope: 'data',
  });

  assert.equal(result.rowCount, 2);
  assert.ok(result.content.includes('Task 1'));
  assert.ok(result.content.includes('Task 2'));
  assert.ok(result.content.includes('open'));
  assert.ok(result.content.includes('done'));
}

async function testDateFormatting() {
  const resolver = new CsvResolverService();
  const service = new CsvExportService(resolver);
  const config = createTestConfig();

  const entities = [
    { id: '1', title: 'Task', due_date: new Date('2024-06-15T10:30:00Z') },
    { id: '2', title: 'Task 2', due_date: '2024-07-20T12:00:00Z' },
  ];

  const result = await service.export(config, entities, {
    manager: createMockManager({}),
    tenantId: 't1',
    language: 'en',
  });

  assert.ok(result.content.includes('2024-06-15'));
  assert.ok(result.content.includes('2024-07-20'));
}

async function testArrayExpansionToNumberedColumns() {
  const resolver = new CsvResolverService();
  const service = new CsvExportService(resolver);
  const config = createConfigWithArrays();

  const entities = [
    { id: '1', title: 'Task 1', labels: [], owner_ids: ['u1', 'u2'] },
  ];

  const result = await service.export(config, entities, {
    manager: createMockManager({}),
    tenantId: 't1',
    language: 'fr',
  });

  // Check headers include numbered columns
  assert.ok(result.content.includes('owner_id_1'));
  assert.ok(result.content.includes('owner_id_2'));
  assert.ok(result.content.includes('owner_id_3'));
}

async function testArrayTruncationWarning() {
  const resolver = new CsvResolverService();
  const service = new CsvExportService(resolver);
  const config = createConfigWithArrays();

  const entities = [
    { id: '1', title: 'Task', owner_ids: ['u1', 'u2', 'u3', 'u4', 'u5'] }, // 5 items, max is 3
  ];

  const result = await service.export(config, entities, {
    manager: createMockManager({}),
    tenantId: 't1',
    language: 'fr',
  });

  assert.equal(result.warnings.length, 1);
  assert.ok(result.warnings[0].includes('truncated'));
}

async function testCommaSeparatedArrays() {
  const resolver = new CsvResolverService();
  const service = new CsvExportService(resolver);
  const config = createConfigWithArrays();

  const entities = [
    { id: '1', title: 'Task', labels: ['bug', 'urgent', 'backend'], owner_ids: [] },
  ];

  const result = await service.export(config, entities, {
    manager: createMockManager({}),
    tenantId: 't1',
    language: 'fr',
  });

  assert.ok(result.content.includes('bug, urgent, backend'));
}

async function testFieldSelection() {
  const resolver = new CsvResolverService();
  const service = new CsvExportService(resolver);
  const config = createTestConfig();

  const entities = [
    { id: '1', title: 'Task', description: 'Desc', status: 'open' },
  ];

  const result = await service.export(config, entities, {
    manager: createMockManager({}),
    tenantId: 't1',
    language: 'fr',
    fields: ['id', 'title'],
  });

  // Should only include selected fields
  const firstLine = result.content.split('\n')[0];
  assert.ok(firstLine.includes('id'));
  assert.ok(firstLine.includes('title'));
  assert.ok(!firstLine.includes('description'));
  assert.ok(!firstLine.includes('status'));
}

async function testNullValuesExportAsEmpty() {
  const resolver = new CsvResolverService();
  const service = new CsvExportService(resolver);
  const config = createTestConfig();

  const entities = [
    { id: '1', title: 'Task', description: null, status: 'open', due_date: null, priority: null },
  ];

  const result = await service.export(config, entities, {
    manager: createMockManager({}),
    tenantId: 't1',
    language: 'fr',
  });

  // Parse the CSV to check empty values
  const lines = result.content.split('\n');
  const dataLine = lines[1];
  assert.ok(dataLine); // Data line exists

  // Null values should result in empty fields (consecutive semicolons or trailing semicolon)
  const fields = dataLine.split(';');
  assert.ok(fields.some((f) => f === '')); // At least one empty field
}

async function testBOMIsPresent() {
  const resolver = new CsvResolverService();
  const service = new CsvExportService(resolver);
  const config = createTestConfig();

  const result = await service.export(config, [], {
    manager: createMockManager({}),
    tenantId: 't1',
    language: 'fr',
    scope: 'template',
  });

  // UTF-8 BOM
  assert.equal(result.content.charCodeAt(0), 0xFEFF);
}

async function testFormulaLikeValuesAreNeutralized() {
  const resolver = new CsvResolverService();
  const service = new CsvExportService(resolver);
  const config = createTestConfig();

  const result = await service.export(config, [
    { id: '1', title: '=HYPERLINK("https://evil.example")', description: ' +SUM(1,1)' },
  ], {
    manager: createMockManager({}),
    tenantId: 't1',
    language: 'fr',
  });

  assert.ok(result.content.includes('\'=HYPERLINK'));
  assert.ok(result.content.includes('\' +SUM'));
}

function testDenormalizeReversesNeutralize() {
  // Values a user might enter; neutralize -> denormalize must round-trip.
  for (const v of ['=SUM(A1)', '+33 6 12 34', '-x', '@handle', '\t tab', ' hello', "'quoted", 'plain', '']) {
    assert.equal(denormalizeCsvFormulaValue(neutralizeCsvFormulaValue(v)), v);
  }
  // Non-neutralized apostrophes are left untouched.
  assert.equal(denormalizeCsvFormulaValue("'quoted"), "'quoted");
}


/**
 * The file follows the screen language, as every file of the shared layer: the separator, the
 * day, the decimal mark and yes or no. The headers stay the same in every language.
 */
async function testExportFollowsTheLanguage() {
  const service = new CsvExportService(new CsvResolverService());
  const config: CsvEntityConfig = {
    entityName: 'asset',
    tableName: 'assets',
    displayName: 'Assets',
    upsertKey: ['name'],
    fields: [
      { csvColumn: 'name', entityProperty: 'name', type: CsvFieldType.STRING },
      { csvColumn: 'end_of_support', entityProperty: 'end_of_support', type: CsvFieldType.DATE },
      { csvColumn: 'cost', entityProperty: 'cost', type: CsvFieldType.NUMBER },
      { csvColumn: 'is_cluster', entityProperty: 'is_cluster', type: CsvFieldType.BOOLEAN },
      { csvColumn: 'tags', entityProperty: 'tags', type: CsvFieldType.ARRAY },
    ],
  };
  const rows = [
    { id: 'a1', name: 'srv-01', end_of_support: '2024-06-15', cost: 1234.5, is_cluster: true, tags: ['db', 'prod'] },
    { id: 'a2', name: 'srv-02', end_of_support: null, cost: null, is_cluster: false, tags: [] },
  ];
  const file = async (language: 'en' | 'fr' | 'de' | 'es', scope: 'data' | 'template' = 'data') =>
    (await service.export(config, rows, { manager: createMockManager({}), tenantId: 't1', scope, language })).content
      .replace(/^\uFEFF/, '').split('\n');

  const fr = await file('fr');
  assert.equal(fr[0], 'name;end_of_support;cost;is_cluster;tags');
  assert.equal(fr[1], 'srv-01;15/06/2024;1234,5;oui;db, prod');
  assert.equal(fr[2], 'srv-02;;;non;');
  const de = await file('de');
  assert.equal(de[1], 'srv-01;15.06.2024;1234,5;ja;db, prod');
  const es = await file('es');
  assert.equal(es[1], 'srv-01;15/06/2024;1234,5;sí;db, prod');
  const en = await file('en');
  assert.equal(en[0], 'name,end_of_support,cost,is_cluster,tags');
  assert.equal(en[1], 'srv-01,2024-06-15,1234.5,yes,"db, prod"');
  assert.equal(en[2], 'srv-02,,,no,');
  assert.equal((await file('en', 'template'))[0], 'name,end_of_support,cost,is_cluster,tags');
  assert.equal((await file('fr', 'template'))[0], 'name;end_of_support;cost;is_cluster;tags');
}

// ===== Run tests =====

(async () => {
  await testTemplateExportReturnsHeadersOnly();
  await testExportFollowsTheLanguage();
  await testDataExportIncludesRows();
  await testDateFormatting();
  await testArrayExpansionToNumberedColumns();
  await testArrayTruncationWarning();
  await testCommaSeparatedArrays();
  await testFieldSelection();
  await testNullValuesExportAsEmpty();
  await testBOMIsPresent();
  await testFormulaLikeValuesAreNeutralized();
  testDenormalizeReversesNeutralize();

  console.log('CSV export service tests passed.');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
