/**
 * The relation handlers of an import (`relationHandlers`) run on the record each row wrote, with
 * that row's cells: a row the import does not write (unchanged, or left out by the operation) runs
 * none, and moves no other row's relations onto another record. Lot I3 of 26.11.9, fixes C.
 */
import * as assert from 'node:assert/strict';
import { CsvImportService } from '../csv-import.service';
import { CsvResolverService } from '../csv-resolver.service';
import { CsvJsonValidators } from '../csv-json-validators';
import { CsvEntityConfig, CsvFieldType, CsvImportParams } from '../csv-field.types';

const T = 't1';

function file(content: string): Express.Multer.File {
  return { buffer: Buffer.from(content, 'utf8'), originalname: 'things.csv', mimetype: 'text/csv', size: content.length } as Express.Multer.File;
}

function setup(stored: any[]) {
  const calls: Array<[string, string]> = [];
  const config: CsvEntityConfig = {
    entityName: 'thing',
    tableName: 'things',
    displayName: 'Things',
    upsertKey: ['name'],
    fields: [
      { csvColumn: 'id', entityProperty: 'id', type: CsvFieldType.STRING, isIdentityColumn: true, required: false, label: 'ID', group: 'Identity' },
      { csvColumn: 'name', entityProperty: 'name', type: CsvFieldType.STRING, required: true, label: 'Name', group: 'Basic' },
      { csvColumn: 'note', entityProperty: 'note', type: CsvFieldType.STRING, required: false, label: 'Note', group: 'Basic' },
    ],
    relationHandlers: [{
      name: 'links',
      exportHandler: async () => ({}),
      importHandler: async (entity, values) => { calls.push([entity.name, values.link]); },
    }],
  } as CsvEntityConfig;
  let next = 100;
  const manager: any = {
    query: async (sql: string) => (/FROM things/.test(sql) ? stored : []),
    getRepository: () => ({
      save: async (entities: any[]) => {
        for (const entity of entities) if (!entity.id) entity.id = `new-${next++}`;
        return entities;
      },
    }),
  };
  const service = new CsvImportService(new CsvResolverService(), new CsvJsonValidators());
  const run = (csv: string, params: Partial<CsvImportParams>) => service.import(config, file(csv), {
    dryRun: false, operation: 'upsert', ...params,
  }, { manager, tenantId: T });
  return { calls, run };
}

async function testUpsertAfterAnUnchangedRow() {
  const { calls, run } = setup([{ id: 'a', tenant_id: T, name: 'Alpha', note: 'same' }]);
  const result = await run(['name;note;link', 'Alpha;same;la', 'Beta;b;lb', 'Gamma;g;lg'].join('\n'), {});
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual([result.inserted, result.unchanged], [2, 1]);
  assert.deepEqual(calls, [['Beta', 'lb'], ['Gamma', 'lg']]);
}

async function testUpdateOnlySkipsANewRow() {
  const { calls, run } = setup([{ id: 'a', tenant_id: T, name: 'Alpha', note: 'old' }]);
  const result = await run(['name;note;link', 'Nouveau;n;ln', 'Alpha;new;la'].join('\n'), { operation: 'update_only' });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual([result.updated, result.skipped], [1, 1]);
  assert.deepEqual(calls, [['Alpha', 'la']], 'the skipped row moves no relation onto Alpha');
}

async function main() {
  const failures: string[] = [];
  for (const [name, test] of [
    ['testUpsertAfterAnUnchangedRow', testUpsertAfterAnUnchangedRow],
    ['testUpdateOnlySkipsANewRow', testUpdateOnlySkipsANewRow],
  ] as const) {
    try {
      await test();
      console.log(`ok - ${name}`);
    } catch (error: any) {
      failures.push(name);
      console.error(`not ok - ${name}: ${error?.message ?? error}`);
    }
  }
  if (failures.length > 0) process.exit(1);
}

void main();
