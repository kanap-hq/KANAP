import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { CsvImportService } from '../csv-import.service';
import { CsvResolverService } from '../csv-resolver.service';
import { CsvJsonValidators } from '../csv-json-validators';
import { CsvEntityConfig, CsvFieldType, CsvImportRow } from '../csv-field.types';
import { importCell, markGuardedDash, noteCleared, refuseClear, removedEntries } from '../csv-import-cells';

// The contract of the clearing rule for the hooks of the family configs (`csv-import-cells.ts`):
// reading a cell, refusing a `-`, declaring cleared values, which the import adds to its `cleared`
// count at the preflight as at the load.

function row(): CsvImportRow {
  return { rowNumber: 2, raw: {}, parsed: {}, isInsert: false, errors: [], warnings: [] };
}

function testImportCell() {
  const raw: Record<string, string> = { blank: '  ', clear: ' - ', legacy: '__CLEAR__', text: ' Paris ', dash: '-', guarded: '-' };
  markGuardedDash(raw, 'guarded');
  assert.deepEqual(importCell(raw, 'blank'), { kind: 'blank' });
  assert.deepEqual(importCell(raw, 'absent'), { kind: 'blank' }, 'a column left out reads blank');
  assert.deepEqual(importCell(raw, 'clear'), { kind: 'clear' });
  assert.deepEqual(importCell(raw, 'legacy'), { kind: 'clear' }, '__CLEAR__ reads as -');
  assert.deepEqual(importCell(raw, 'dash'), { kind: 'clear' });
  assert.deepEqual(importCell(raw, 'guarded'), { kind: 'value', text: '-' }, "'- is the text -");
  assert.deepEqual(importCell(raw, 'text'), { kind: 'value', text: 'Paris' });
  assert.deepEqual(importCell({ ...raw }, 'guarded'), { kind: 'clear' }, 'the note belongs to the row read');
}

function testRefuseAndNote() {
  const r = row();
  refuseClear(r, 'status');
  refuseClear(r, 'progress', { number: true });
  assert.deepEqual(r.errors.map((e) => [e.row, e.column, e.code, e.params]), [
    [2, 'status', 'CSV_VALUE_CANNOT_BE_CLEARED', { column: 'status' }],
    [2, 'progress', 'CSV_NUMBER_CANNOT_BE_CLEARED', { column: 'progress' }],
  ]);
  noteCleared(r, 0);
  assert.equal(r.clearedByConfig, undefined);
  noteCleared(r, 2);
  noteCleared(r, 1);
  assert.equal(r.clearedByConfig, 3);
  assert.equal(removedEntries(['a', 'b', 'c'], ['a', 'b']), 1, 'a filled list that drops c clears one entry');
  assert.equal(removedEntries(['a'], []), 1);
  assert.equal(removedEntries([], ['a']), 0);
  assert.equal(removedEntries(null, null), 0);
}

/** A hook's `noteCleared` counts in the result, at the preflight and at the load; a row in error counts nothing. */
async function testServiceCountsHookClears() {
  const stored = [
    { id: 'a', tenant_id: 't', title: 'Alpha', description: 'Kept' },
    { id: 'b', tenant_id: 't', title: 'Beta', description: 'Kept' },
  ];
  const manager: any = {
    query: async (sql: string, params: any[]) => {
      if (sql.includes('information_schema.columns')) {
        return ['id', 'tenant_id', 'title', 'description'].map((column) => ({ column_name: column, is_nullable: column === 'description' ? 'YES' : 'NO', data_type: 'text', column_default: null }));
      }
      return stored.filter((entry) => entry.tenant_id === params[0]);
    },
    getRepository: () => ({ create: (entity: any) => entity, save: async (entities: any) => entities, insert: async () => ({ identifiers: [] }) }),
  };
  const config: CsvEntityConfig = {
    entityName: 'task',
    tableName: 'tasks',
    displayName: 'Tasks',
    upsertKey: ['title'],
    fields: [
      { csvColumn: 'title', entityProperty: 'title', type: CsvFieldType.STRING, required: true },
      { csvColumn: 'description', entityProperty: 'description', type: CsvFieldType.STRING },
      { csvColumn: 'people', entityProperty: '_people', type: CsvFieldType.STRING },
    ],
    afterValidate: async (rows) => {
      for (const r of rows) {
        const cell = importCell(r.raw, 'people');
        if (cell.kind === 'clear') noteCleared(r, 2);
        if (cell.kind === 'value' && cell.text === 'bad') refuseClear(r, 'people');
        delete r.parsed._people;
      }
    },
  };
  const service = new CsvImportService(new CsvResolverService(), new CsvJsonValidators());
  const file = (csv: string) => ({ buffer: Buffer.from('﻿' + csv, 'utf8'), originalname: 'x.csv', mimetype: 'text/csv', size: csv.length }) as Express.Multer.File;
  const csv = 'title;description;people\nAlpha;-;-\nBeta;;-\nGamma;;-';
  for (const dryRun of [true, false]) {
    const result = await service.import(config, file(csv), { dryRun, operation: 'upsert' }, { manager, tenantId: 't' });
    assert.deepEqual([result.ok, result.updated, result.inserted, result.cleared], [true, 2, 1, 5], `dryRun ${dryRun}: ${JSON.stringify(result.errors)}`);
  }
  const refused = await service.import(config, file('title;description;people\nAlpha;-;bad'), { dryRun: true, operation: 'upsert' }, { manager, tenantId: 't' });
  assert.deepEqual([refused.ok, refused.cleared, refused.errors.map((e) => e.code)], [false, 0, ['CSV_VALUE_CANNOT_BE_CLEARED']]);
}

async function main() {
  testImportCell();
  testRefuseAndNote();
  await testServiceCountsHookClears();
  console.log('csv-import-cells.spec: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
