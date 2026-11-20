import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { Controller, Post } from '@nestjs/common';
import { defer, lastValueFrom, of, throwError } from 'rxjs';
import { ImportEventsInterceptor, recordImport } from '../import-events.interceptor';
import { importCounts, importEventEntry, ImportRoute, importRouteOf } from '../security-events';
import { journalImportCounts } from '../../incidents/services/incident-journal-import.service';

// The `import` row of the screens' imports (lot I5 of 26.11.9), without a database: a route marked
// `@ImportRoute('<list>')` writes one row once its load succeeded, in the request transaction,
// before TenantInterceptor commits, with the list, the name of the file sent and the counts read
// from its answer; a check (`dryRun`), a refused file, a failed handler and another route write
// nothing. A handler that commits the request itself (the budget file's ANALYZE) records first
// with `recordImport`, and the interceptor then writes nothing more.

@Controller('probe-items')
class ImportProbe {
  @ImportRoute('applications')
  @Post('import')
  importRows() {
    return 'rows';
  }

  @ImportRoute('incident_journal', journalImportCounts)
  @Post('import-journal')
  importJournal() {
    return 'journal';
  }

  @Post('other')
  other() {
    return 'other';
  }
}

function fakeContext(handler: object, req: any) {
  return {
    getType: () => 'http',
    getClass: () => ImportProbe,
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
  } as any;
}

function recordingRequest(extra: Record<string, unknown> = {}) {
  const inserted: any[] = [];
  const order: string[] = [];
  const manager = {
    getRepository: () => ({
      insert: async (row: any) => {
        order.push('audit');
        inserted.push(row);
        return { identifiers: [{ id: 'row-1' }] };
      },
    }),
    query: async () => [],
  };
  const req: any = {
    tenant: { id: 'tenant-1' },
    user: { sub: 'user-9' },
    // As multer gives it: the UTF-8 bytes of the name read as latin1.
    file: { originalname: Buffer.from('Serveurs été.csv', 'utf8').toString('latin1') },
    queryRunner: { isReleased: false, manager },
    ...extra,
  };
  return { req, inserted, order };
}

const LOAD = { ok: true, dryRun: false, total: 4, inserted: 1, updated: 2, unchanged: 1, cleared: 0, errors: [] };

const handled = (order: string[], value: unknown) => ({ handle: () => defer(async () => { order.push('handler'); return value; }) });

async function testOneRowAfterALoad() {
  const interceptor = new ImportEventsInterceptor();
  const { req, inserted, order } = recordingRequest();
  assert.deepEqual(await lastValueFrom(interceptor.intercept(fakeContext(ImportProbe.prototype.importRows, req), handled(order, LOAD))), LOAD);
  assert.deepEqual(order, ['handler', 'audit'], 'after the handler, before the value goes on to the commit');
  assert.equal(inserted.length, 1);
  const row = inserted[0];
  assert.equal(row.table_name, 'import');
  assert.equal(row.action, 'import');
  assert.equal(row.record_id, null);
  assert.equal(row.user_id, 'user-9');
  assert.equal(row.source, 'user');
  assert.equal(row.source_ref, null);
  assert.equal(row.before_json, null);
  assert.deepEqual(row.after_json, { list: 'applications', filename: 'Serveurs été.csv', rows: 4, inserted: 1, updated: 2, unchanged: 1 });
}

async function testNothingWithoutASuccessfulLoad() {
  const interceptor = new ImportEventsInterceptor();
  for (const [what, value] of [
    ['a check', { ...LOAD, dryRun: true }],
    ['a refused file', { ...LOAD, ok: false, inserted: 0, updated: 0 }],
    ['an answer without dryRun', { ok: true, total: 1, inserted: 1, updated: 0, unchanged: 0 }],
    ['no answer', undefined],
  ] as const) {
    const { req, inserted, order } = recordingRequest();
    await lastValueFrom(interceptor.intercept(fakeContext(ImportProbe.prototype.importRows, req), handled(order, value)), { defaultValue: undefined });
    assert.equal(inserted.length, 0, what);
  }
  // A handler that fails: nothing written, the error goes on (TenantInterceptor rolls back).
  const failing = recordingRequest();
  await assert.rejects(
    lastValueFrom(interceptor.intercept(fakeContext(ImportProbe.prototype.importRows, failing.req), { handle: () => throwError(() => new Error('refused')) })),
    /refused/,
  );
  assert.equal(failing.inserted.length, 0);
  // Another route, or no tenant transaction: nothing written.
  const other = recordingRequest();
  assert.equal(await lastValueFrom(interceptor.intercept(fakeContext(ImportProbe.prototype.other, other.req), { handle: () => of(LOAD) })), LOAD);
  assert.equal(other.inserted.length, 0);
  const noTransaction = recordingRequest({ queryRunner: undefined });
  assert.equal(await lastValueFrom(interceptor.intercept(fakeContext(ImportProbe.prototype.importRows, noTransaction.req), { handle: () => of(LOAD) })), LOAD);
  assert.equal(noTransaction.inserted.length, 0);
}

async function testAHandlerThatRecordsItself() {
  const interceptor = new ImportEventsInterceptor();
  const { req, inserted, order } = recordingRequest();
  const handler = {
    handle: () => defer(async () => {
      order.push('handler');
      await recordImport(req, LOAD);
      await recordImport(req, LOAD);
      // The request is committed and its runner given back, as analyzeAfterLargeImport does.
      req.queryRunner = null;
      return LOAD;
    }),
  };
  assert.deepEqual(await lastValueFrom(interceptor.intercept(fakeContext(ImportProbe.prototype.importRows, req), handler)), LOAD);
  assert.deepEqual(order, ['handler', 'audit'], 'one row, written by the handler before its commit');
  assert.equal(inserted.length, 1);
  // Outside an import route, recordImport does nothing.
  const outside = recordingRequest();
  await recordImport(outside.req, LOAD);
  assert.equal(outside.inserted.length, 0);
}

async function testOwnShapes() {
  // The journal of the incidents has its own answer: its reader, given to the decorator.
  assert.deepEqual(importRouteOf(ImportProbe.prototype.importJournal)?.list, 'incident_journal');
  assert.equal(importRouteOf(ImportProbe.prototype.other), undefined);
  const interceptor = new ImportEventsInterceptor();
  const { req, inserted, order } = recordingRequest({ file: { originalname: 'journal.csv' } });
  const journal = { ok: true, imported: 3, skipped: 2, entries: 5 };
  await lastValueFrom(interceptor.intercept(fakeContext(ImportProbe.prototype.importJournal, req), handled(order, journal)));
  assert.deepEqual(inserted.map((row) => row.after_json), [
    { list: 'incident_journal', filename: 'journal.csv', rows: 5, inserted: 3, updated: 0, unchanged: 2 },
  ]);
  assert.equal(journalImportCounts({ ok: true, imported: 0, skipped: 0, entries: 0 } as any)?.rows, 0);

  // The users' answer adds `processed`: the standard counts are read.
  assert.deepEqual(importCounts({ ...LOAD, processed: 3 }), { rows: 4, inserted: 1, updated: 2, unchanged: 1 });
  // The budget file's load has no `total`: its rows are the lines written, unchanged and left out.
  assert.deepEqual(
    importCounts({ ok: true, dryRun: false, inserted: 2, updated: 1, unchanged: 4, skipped: 1, cleared: 3, createdSuppliers: false, createdDimensionValues: false }),
    { rows: 8, inserted: 2, updated: 1, unchanged: 4 },
  );
  // A count that is missing or not a whole number reads as 0.
  assert.deepEqual(importCounts({ ok: true, dryRun: false, inserted: 2, updated: 'x' }), { rows: 2, inserted: 2, updated: 0, unchanged: 0 });
  for (const none of [null, undefined, 'text', { ok: true, dryRun: true }, { ok: false, dryRun: false }]) {
    assert.equal(importCounts(none), null, JSON.stringify(none));
  }

  // The shape of the row, the same for Plaid's import (its source and preview given).
  const entry = importEventEntry({
    list: 'suppliers', filename: null, counts: { rows: 1, inserted: 1, updated: 0, unchanged: 0 }, userId: 'user-1', source: 'ai_chat', sourceRef: 'preview-1',
  });
  assert.deepEqual(entry, {
    table: 'import', recordId: null, action: 'import', before: null,
    after: { list: 'suppliers', filename: null, rows: 1, inserted: 1, updated: 0, unchanged: 0 },
    userId: 'user-1', source: 'ai_chat', sourceRef: 'preview-1',
  });
  const screen = importEventEntry({ list: 'users', filename: 'u.csv', counts: { rows: 0, inserted: 0, updated: 0, unchanged: 0 }, userId: null });
  assert.equal(screen.source, 'user', 'the default source');
  assert.equal(screen.sourceRef, null);
}

async function run() {
  await testOneRowAfterALoad();
  await testNothingWithoutASuccessfulLoad();
  await testAHandlerThatRecordsItself();
  await testOwnShapes();
  console.log('import-events.spec: all assertions passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
