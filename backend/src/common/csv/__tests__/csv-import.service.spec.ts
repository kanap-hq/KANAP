import * as assert from 'node:assert/strict';
import { CsvImportService } from '../csv-import.service';
import { CsvResolverService } from '../csv-resolver.service';
import { CsvJsonValidators } from '../csv-json-validators';
import {
  ArrayStrategy,
  CsvEntityConfig,
  CsvFieldType,
  CsvImportParams,
} from '../csv-field.types';

/**
 * Create a mock file from CSV content
 */
function createMockFile(content: string): Express.Multer.File {
  // Add BOM if not present
  const contentWithBom = content.startsWith('\uFEFF') ? content : '\uFEFF' + content;
  return {
    buffer: Buffer.from(contentWithBom, 'utf8'),
    fieldname: 'file',
    originalname: 'test.csv',
    encoding: 'utf8',
    mimetype: 'text/csv',
    size: contentWithBom.length,
  } as Express.Multer.File;
}

/**
 * Mock EntityManager for testing
 */
function createMockManager(data: Record<string, any[]>) {
  const saved: any[] = [];
  return {
    query: async (sql: string, params: any[]) => {
      const tableMatch = sql.match(/FROM (\w+)/i);
      const tableName = tableMatch?.[1] || '';
      const tenantId = params[0];
      return data[tableName]?.filter((row) => row.tenant_id === tenantId) || [];
    },
    getRepository: (target: unknown) => ({
      create: (entity: any) => entity,
      save: async (entities: any | any[]) => {
        const arr = Array.isArray(entities) ? entities : [entities];
        // The audit lines of the import are not the saved entities.
        if (typeof target === 'string') saved.push(...arr);
        return arr;
      },
    }),
    getSaved: () => saved,
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
      { csvColumn: 'id', entityProperty: 'id', type: CsvFieldType.STRING, isIdentityColumn: true, importable: true },
      { csvColumn: 'title', entityProperty: 'title', type: CsvFieldType.STRING, required: true },
      { csvColumn: 'description', entityProperty: 'description', type: CsvFieldType.STRING },
      { csvColumn: 'status', entityProperty: 'status', type: CsvFieldType.ENUM, enumValues: ['open', 'in_progress', 'done'] },
      { csvColumn: 'due_date', entityProperty: 'due_date', type: CsvFieldType.DATE },
      { csvColumn: 'priority', entityProperty: 'priority', type: CsvFieldType.NUMBER },
    ],
  };
}

/**
 * Default import params
 */
const defaultParams: CsvImportParams = {
  dryRun: true,
  mode: 'replace',
  operation: 'upsert',
};

// ===== Tests =====

async function testDryRunDoesNotCommit() {
  const resolver = new CsvResolverService();
  const validators = new CsvJsonValidators();
  const service = new CsvImportService(resolver, validators);
  const config = createTestConfig();

  const csv = `id;title;description;status;due_date;priority
;New Task;A description;open;2024-01-15;1`;

  const manager = createMockManager({ tasks: [] });

  const result = await service.import(config, createMockFile(csv), { ...defaultParams, dryRun: true }, {
    manager,
    tenantId: 't1',
  });

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.inserted, 1);
  assert.equal(result.updated, 0);
  assert.equal(manager.getSaved().length, 0); // Nothing saved in dry run
}

async function testMissingRequiredFieldError() {
  const resolver = new CsvResolverService();
  const validators = new CsvJsonValidators();
  const service = new CsvImportService(resolver, validators);
  const config = createTestConfig();

  const csv = `id;title;description;status;due_date;priority
;;A description;open;2024-01-15;1`;

  const result = await service.import(config, createMockFile(csv), defaultParams, {
    manager: createMockManager({ tasks: [] }),
    tenantId: 't1',
  });

  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 1);
  assert.ok(result.errors[0].message.includes('required'));
}

async function testInvalidEnumError() {
  const resolver = new CsvResolverService();
  const validators = new CsvJsonValidators();
  const service = new CsvImportService(resolver, validators);
  const config = createTestConfig();

  const csv = `id;title;description;status;due_date;priority
;Task;Desc;invalid_status;2024-01-15;1`;

  const result = await service.import(config, createMockFile(csv), defaultParams, {
    manager: createMockManager({ tasks: [] }),
    tenantId: 't1',
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.message.includes('Invalid status')));
}

async function testDateParsing() {
  const resolver = new CsvResolverService();
  const validators = new CsvJsonValidators();
  const service = new CsvImportService(resolver, validators);
  const config = createTestConfig();

  // Test different date formats
  const csv = `id;title;description;status;due_date;priority
;Task 1;;open;2024-01-15;1
;Task 2;;open;15/01/2024;2
;Task 3;;open;15.01.2024;3`;

  const result = await service.import(config, createMockFile(csv), defaultParams, {
    manager: createMockManager({ tasks: [] }),
    tenantId: 't1',
  });

  assert.equal(result.ok, true);
  assert.equal(result.inserted, 3);
}

async function testNumberParsing() {
  const resolver = new CsvResolverService();
  const validators = new CsvJsonValidators();
  const service = new CsvImportService(resolver, validators);
  const config = createTestConfig();

  // Test different number formats
  const csv = `id;title;description;status;due_date;priority
;Task 1;;open;;1
;Task 2;;open;;1.5
;Task 3;;open;;1,5`;

  const result = await service.import(config, createMockFile(csv), defaultParams, {
    manager: createMockManager({ tasks: [] }),
    tenantId: 't1',
  });

  assert.equal(result.ok, true);
  assert.equal(result.inserted, 3);
}

async function testIdentityResolutionById() {
  const resolver = new CsvResolverService();
  const validators = new CsvJsonValidators();
  const service = new CsvImportService(resolver, validators);
  const config = createTestConfig();

  const existingTasks = [
    { id: 'existing-id', title: 'Existing Task', tenant_id: 't1' },
  ];

  const csv = `id;title;description;status;due_date;priority
existing-id;Updated Task;New description;done;;`;

  const result = await service.import(config, createMockFile(csv), defaultParams, {
    manager: createMockManager({ tasks: existingTasks }),
    tenantId: 't1',
  });

  assert.equal(result.ok, true);
  assert.equal(result.inserted, 0);
  assert.equal(result.updated, 1);
}

async function testIdentityResolutionByUpsertKey() {
  const resolver = new CsvResolverService();
  const validators = new CsvJsonValidators();
  const service = new CsvImportService(resolver, validators);
  const config = createTestConfig();

  const existingTasks = [
    { id: 'some-id', title: 'existing task', tenant_id: 't1' }, // lowercase
  ];

  // Match by title (case-insensitive)
  const csv = `id;title;description;status;due_date;priority
;Existing Task;New description;done;;`;

  const result = await service.import(config, createMockFile(csv), defaultParams, {
    manager: createMockManager({ tasks: existingTasks }),
    tenantId: 't1',
  });

  assert.equal(result.ok, true);
  assert.equal(result.updated, 1);
}

/** A row equal to the stored entity, as the database returns it, counts as unchanged and is not saved. */
async function testIdenticalRowIsUnchanged() {
  const service = new CsvImportService(new CsvResolverService(), new CsvJsonValidators());
  const stored = (id: string, title: string) => ({
    id, tenant_id: 't1', title, description: null, status: 'open',
    due_date: new Date(2026, 8, 2), priority: '3', updated_at: new Date(2020, 0, 1),
  });
  const csv = `id;title;description;status;due_date;priority
a;Same;;open;2026-09-02;3
b;Other;Now described;open;2026-09-02;3`;

  for (const mode of ['replace', 'enrich'] as const) {
    const check = await service.import(createTestConfig(), createMockFile(csv), { ...defaultParams, mode }, {
      manager: createMockManager({ tasks: [stored('a', 'Same'), stored('b', 'Other')] }),
      tenantId: 't1',
    });
    assert.equal(check.ok, true, JSON.stringify(check.errors));
    assert.deepEqual([check.inserted, check.updated, check.unchanged], [0, 1, 1], `${mode}: ${JSON.stringify(check)}`);

    const manager = createMockManager({ tasks: [stored('a', 'Same'), stored('b', 'Other')] });
    const load = await service.import(createTestConfig(), createMockFile(csv), { ...defaultParams, mode, dryRun: false }, {
      manager,
      tenantId: 't1',
    });
    assert.deepEqual([load.inserted, load.updated, load.unchanged], [0, 1, 1], mode);
    assert.deepEqual(manager.getSaved().map((entity: any) => entity.id), ['b'], `${mode}: only the changed row is saved`);
  }
}

async function testDuplicateKeysInFileError() {
  const resolver = new CsvResolverService();
  const validators = new CsvJsonValidators();
  const service = new CsvImportService(resolver, validators);
  const config = createTestConfig();

  const csv = `id;title;description;status;due_date;priority
;Duplicate Task;Desc 1;open;;1
;Duplicate Task;Desc 2;done;;2`;

  const result = await service.import(config, createMockFile(csv), defaultParams, {
    manager: createMockManager({ tasks: [] }),
    tenantId: 't1',
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.message.includes('Duplicate key')));
}

async function testEnrichModePreservesExisting() {
  const resolver = new CsvResolverService();
  const validators = new CsvJsonValidators();
  const service = new CsvImportService(resolver, validators);
  const config = createTestConfig();

  const existingTasks = [
    { id: 'task-1', title: 'Task', description: 'Original description', status: 'open', tenant_id: 't1' },
  ];

  // Empty description should preserve existing in enrich mode
  const csv = `id;title;description;status;due_date;priority
task-1;Task;;done;;`;

  const result = await service.import(
    config,
    createMockFile(csv),
    { ...defaultParams, mode: 'enrich' },
    {
      manager: createMockManager({ tasks: existingTasks }),
      tenantId: 't1',
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.updated, 1);
}

async function testReplaceModeNullifiesEmpty() {
  const resolver = new CsvResolverService();
  const validators = new CsvJsonValidators();
  const service = new CsvImportService(resolver, validators);
  const config = createTestConfig();

  const existingTasks = [
    { id: 'task-1', title: 'Task', description: 'Original description', status: 'open', tenant_id: 't1' },
  ];

  // Empty description should become null in replace mode
  const csv = `id;title;description;status;due_date;priority
task-1;Task;;done;;`;

  const result = await service.import(
    config,
    createMockFile(csv),
    { ...defaultParams, mode: 'replace' },
    {
      manager: createMockManager({ tasks: existingTasks }),
      tenantId: 't1',
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.updated, 1);
}

async function testUpdateOnlyOperationSkipsInserts() {
  const resolver = new CsvResolverService();
  const validators = new CsvJsonValidators();
  const service = new CsvImportService(resolver, validators);
  const config = createTestConfig();

  const existingTasks = [
    { id: 'existing', title: 'Existing', tenant_id: 't1' },
  ];

  const csv = `id;title;description;status;due_date;priority
existing;Existing;Updated;open;;
;New Task;New;open;;`;

  const result = await service.import(
    config,
    createMockFile(csv),
    { ...defaultParams, operation: 'update_only' },
    {
      manager: createMockManager({ tasks: existingTasks }),
      tenantId: 't1',
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.updated, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.inserted, 0);
}

async function testInsertOnlyOperationSkipsUpdates() {
  const resolver = new CsvResolverService();
  const validators = new CsvJsonValidators();
  const service = new CsvImportService(resolver, validators);
  const config = createTestConfig();

  const existingTasks = [
    { id: 'existing', title: 'Existing', tenant_id: 't1' },
  ];

  const csv = `id;title;description;status;due_date;priority
existing;Existing;Updated;open;;
;New Task;New;open;;`;

  const result = await service.import(
    config,
    createMockFile(csv),
    { ...defaultParams, operation: 'insert_only' },
    {
      manager: createMockManager({ tasks: existingTasks }),
      tenantId: 't1',
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.inserted, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.updated, 0);
}

async function testMissingHeaderError() {
  const resolver = new CsvResolverService();
  const validators = new CsvJsonValidators();
  const service = new CsvImportService(resolver, validators);
  const config = createTestConfig();

  // Missing required 'title' column
  const csv = `id;description;status
;A description;open`;

  const result = await service.import(config, createMockFile(csv), defaultParams, {
    manager: createMockManager({ tasks: [] }),
    tenantId: 't1',
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.message.includes('Missing')));
  assert.deepEqual(
    result.errors.map((e) => ({ row: e.row, code: e.code, params: e.params })),
    [{ row: 0, code: 'CSV_HEADER_MISSING_COLUMNS', params: { missing: 'title' } }],
  );
}

/** The columns the import does not know are left out of it: a warning, not a refusal. */
async function testUnknownColumnsAreAWarning() {
  const service = new CsvImportService(new CsvResolverService(), new CsvJsonValidators());

  const csv = `id;title;notes;owner_phone
;Task;x;y`;

  const result = await service.import(createTestConfig(), createMockFile(csv), defaultParams, {
    manager: createMockManager({ tasks: [] }),
    tenantId: 't1',
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.inserted, 1);
  assert.deepEqual(
    result.warnings.map((w) => ({ row: w.row, code: w.code, params: w.params })),
    [{ row: 0, code: 'CSV_HEADER_IGNORED_COLUMNS', params: { extra: 'notes, owner_phone' } }],
  );
}

/** Every row message carries a code and the values its sentence names, for the interface to translate. */
async function testRowMessagesCarryCodes() {
  const service = new CsvImportService(new CsvResolverService(), new CsvJsonValidators());
  const config = createTestConfig();
  config.fields.push(
    { csvColumn: 'billable', entityProperty: 'billable', type: CsvFieldType.BOOLEAN },
    { csvColumn: 'payload', entityProperty: 'payload', type: CsvFieldType.JSON },
  );

  const csv = `id;title;status;due_date;priority;billable;payload
;;open;;;;
;Bad enum;nope;;;;
;Bad date;open;someday;;;
;Bad number;open;;high;;
;Bad boolean;open;;;perhaps;
;Bad json;open;;;;{oops
;Twice;open;;;;
;Twice;open;;;;`;

  const result = await service.import(config, createMockFile(csv), defaultParams, {
    manager: createMockManager({ tasks: [] }),
    tenantId: 't1',
  });

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.errors.map((e) => ({ row: e.row, column: e.column, code: e.code, params: e.params })),
    [
      { row: 2, column: 'title', code: 'CSV_VALUE_REQUIRED', params: undefined },
      { row: 3, column: 'status', code: 'CSV_ENUM_INVALID', params: { value: 'nope', allowed: 'open, in_progress, done' } },
      { row: 4, column: 'due_date', code: 'CSV_DATE_INVALID', params: { value: 'someday' } },
      { row: 5, column: 'priority', code: 'CSV_NUMBER_INVALID', params: { value: 'high' } },
      { row: 6, column: 'billable', code: 'CSV_BOOLEAN_INVALID', params: { value: 'perhaps' } },
      { row: 7, column: 'payload', code: 'CSV_JSON_INVALID', params: undefined },
      { row: 9, column: undefined, code: 'CSV_DUPLICATE_KEY', params: { columns: 'title', firstRow: 8 } },
    ],
  );
}

/** A name the tenant does not have: an error when the reference is required, a warning otherwise. */
async function testReferenceNotFoundCarriesCodes() {
  const service = new CsvImportService(new CsvResolverService(), new CsvJsonValidators());
  const config = createTestConfig();
  config.fields.push(
    { csvColumn: 'owner_email', entityProperty: 'owner_id', type: CsvFieldType.FK_BY_EMAIL, fkEntity: 'users' },
    { csvColumn: 'company_name', entityProperty: 'company_id', type: CsvFieldType.FK_BY_NAME, fkEntity: 'companies', fkRequired: true },
    {
      csvColumn: 'contributor_1',
      entityProperty: 'contributor_ids',
      type: CsvFieldType.ARRAY,
      arrayStrategy: ArrayStrategy.NUMBERED_COLUMNS,
      fkEntity: 'users',
      maxItems: 1,
    },
  );

  const csv = `id;title;owner_email;company_name;contributor_1
;Task;ghost@example.com;Nowhere;nobody@example.com`;

  const result = await service.import(config, createMockFile(csv), defaultParams, {
    manager: createMockManager({ tasks: [], users: [], companies: [] }),
    tenantId: 't1',
  });

  assert.deepEqual(
    result.errors.map((e) => ({ column: e.column, code: e.code, params: e.params })),
    [{ column: 'company_name', code: 'CSV_REFERENCE_NOT_FOUND', params: { value: 'Nowhere' } }],
  );
  assert.deepEqual(
    result.warnings.map((w) => ({ column: w.column, code: w.code, params: w.params })).sort((a, b) => a.column!.localeCompare(b.column!)),
    [
      { column: 'contributor_1', code: 'CSV_REFERENCE_NOT_FOUND_SKIPPED', params: { value: 'nobody@example.com' } },
      { column: 'owner_email', code: 'CSV_REFERENCE_NOT_FOUND_CLEARED', params: { value: 'ghost@example.com' } },
    ],
  );
}

async function testCaseInsensitiveEnumMatching() {
  const resolver = new CsvResolverService();
  const validators = new CsvJsonValidators();
  const service = new CsvImportService(resolver, validators);
  const config = createTestConfig();

  const csv = `id;title;description;status;due_date;priority
;Task 1;;OPEN;;
;Task 2;;Open;;
;Task 3;;In_Progress;;`;

  const result = await service.import(config, createMockFile(csv), defaultParams, {
    manager: createMockManager({ tasks: [] }),
    tenantId: 't1',
  });

  assert.equal(result.ok, true);
  assert.equal(result.inserted, 3);
}

async function testFormulaApostropheIsStrippedOnImport() {
  const resolver = new CsvResolverService();
  const validators = new CsvJsonValidators();
  const service = new CsvImportService(resolver, validators);
  const config = createTestConfig();

  // Export neutralizes formula-like values by prefixing an apostrophe;
  // import must strip it back so export -> import round-trips cleanly.
  const csv = `id;title;description;status;due_date;priority
;'=SUM(A1:A2);'+plus prefix;open;;`;

  const manager = createMockManager({ tasks: [] });
  const result = await service.import(config, createMockFile(csv), { ...defaultParams, dryRun: false }, {
    manager,
    tenantId: 't1',
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const savedTask = manager.getSaved().find((e: any) => e.title);
  assert.ok(savedTask, 'a task entity was saved');
  assert.equal(savedTask.title, '=SUM(A1:A2)');
  assert.equal(savedTask.description, '+plus prefix');
}

async function testBeforeValidateErrorsSurviveDryRun() {
  const resolver = new CsvResolverService();
  const validators = new CsvJsonValidators();
  const service = new CsvImportService(resolver, validators);
  const config = createTestConfig();
  config.beforeValidate = async (rows) => {
    rows[0].errors.push({ row: rows[0].rowNumber, column: 'title', message: 'blocked by hook' });
  };

  const csv = `id;title;description;status;due_date;priority
;Hooked task;desc;open;;`;

  const result = await service.import(config, createMockFile(csv), { ...defaultParams, dryRun: true }, {
    manager: createMockManager({ tasks: [] }),
    tenantId: 't1',
  });

  assert.equal(result.ok, false);
  assert.equal(result.updated, 0);
  assert.equal(result.errors.some((error) => error.message === 'blocked by hook'), true);
}

function createRawFile(buffer: Buffer): Express.Multer.File {
  return {
    buffer,
    fieldname: 'file',
    originalname: 'test.csv',
    encoding: '7bit',
    mimetype: 'text/csv',
    size: buffer.length,
  } as Express.Multer.File;
}

async function testWindows1252FileIsDecodedOnDryRun() {
  const resolver = new CsvResolverService();
  const validators = new CsvJsonValidators();
  const service = new CsvImportService(resolver, validators);
  const config = createTestConfig();
  let seenTitle: string | undefined;
  config.beforeValidate = async (rows) => {
    seenTitle = rows[0]?.raw.title;
  };

  // Excel "CSV (semicolon)" on Windows writes Windows-1252: latin1 matches it for "é".
  const buffer = Buffer.from('id;title;description;status;due_date;priority\r\n;Refonte CRM é;;open;;\r\n', 'latin1');
  assert.equal(buffer.includes(0xe9), true);

  const result = await service.import(config, createRawFile(buffer), { ...defaultParams, dryRun: true }, {
    manager: createMockManager({ tasks: [] }),
    tenantId: 't1',
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.inserted, 1);
  assert.equal(seenTitle, 'Refonte CRM é');
}

async function testUtf16FileIsRefusedWithClearMessage() {
  const service = new CsvImportService(new CsvResolverService(), new CsvJsonValidators());
  const buffer = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('id;title\r\n', 'utf16le')]);

  await assert.rejects(
    service.import(createTestConfig(), createRawFile(buffer), defaultParams, {
      manager: createMockManager({ tasks: [] }),
      tenantId: 't1',
    }),
    (err: any) =>
      err?.getStatus?.() === 400
      && /not UTF-8 or Windows-1252/.test(err.message)
      && err.getResponse().code === 'CSV_ENCODING_UNSUPPORTED',
  );
}

// ===== Run tests =====

(async () => {
  await testDryRunDoesNotCommit();
  await testMissingRequiredFieldError();
  await testInvalidEnumError();
  await testDateParsing();
  await testNumberParsing();
  await testIdentityResolutionById();
  await testIdentityResolutionByUpsertKey();
  await testDuplicateKeysInFileError();
  await testIdenticalRowIsUnchanged();
  await testEnrichModePreservesExisting();
  await testReplaceModeNullifiesEmpty();
  await testUpdateOnlyOperationSkipsInserts();
  await testInsertOnlyOperationSkipsUpdates();
  await testMissingHeaderError();
  await testUnknownColumnsAreAWarning();
  await testRowMessagesCarryCodes();
  await testReferenceNotFoundCarriesCodes();
  await testCaseInsensitiveEnumMatching();
  await testFormulaApostropheIsStrippedOnImport();
  await testBeforeValidateErrorsSurviveDryRun();
  await testWindows1252FileIsDecodedOnDryRun();
  await testUtf16FileIsRefusedWithClearMessage();

  console.log('CSV import service tests passed.');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
