import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { ConflictException } from '@nestjs/common';
import { IncidentJournalImportService } from '../services/incident-journal-import.service';

// The sample-data journal route: a register administrator may replay the fixture timeline only
// while the sample data of the workspace is loading. Outside that window the route answers 409
// with a dedicated code and writes nothing, even for an invalid file; during the load it writes
// the author and the event time carried by the file.

const JOURNAL = `incident_ref;incident_title;occurred_at (Europe/Paris);author_email;author_role;kind;content;status_from;status_to;severity_from;severity_to
INC-4;B2B portal down: database disk full;2026-06-02 07:52;isabelle.moreau@fromage-co.example;reporter;note;The B2B portal is unreachable.;;;;
`;

const FILE = { buffer: Buffer.from(JOURNAL, 'utf8') } as any;

type Query = { sql: string; params: any[] };

/** A manager that answers the two lookups and counts the insert, and refuses anything else. */
function acceptingManager() {
  const queries: Query[] = [];
  return {
    queries,
    query: async (sql: string, params: any[]) => {
      queries.push({ sql, params });
      if (sql.includes('FROM incidents')) {
        return [{ id: 'incident-4', item_number: 4, title: 'B2B portal down: database disk full' }];
      }
      if (sql.includes('FROM users')) {
        return [{ id: 'user-isabelle', email: 'isabelle.moreau@fromage-co.example' }];
      }
      if (sql.includes('INSERT INTO incident_entries')) return [{ n: 1 }];
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

/** A manager that must never be reached: the gate stands before every read and write. */
function refusingManager() {
  let called = false;
  return {
    get called() {
      return called;
    },
    query: async () => {
      called = true;
      throw new Error('the journal import wrote before checking the sample-data load');
    },
  };
}

const serviceFor = (status: string) =>
  new IncidentJournalImportService({ getStatus: async () => ({ status }) } as any);

async function testRefusedOutsideLoad(): Promise<void> {
  for (const status of ['idle', 'loaded', 'failed', 'resetting']) {
    const manager = refusingManager();
    const refused = await serviceFor(status)
      .import(FILE, { manager: manager as any, tenantId: 'tenant-1' })
      .then(() => null, (error) => error);
    assert.ok(refused instanceof ConflictException, `${status}: 409`);
    assert.equal(refused.getStatus(), 409, `${status}: HTTP 409`);
    assert.equal((refused.getResponse() as any).code, 'SAMPLE_DATA_LOAD_ONLY', `${status}: the dedicated code`);
    assert.equal(manager.called, false, `${status}: nothing was read or written`);
  }

  // The gate comes before the file is read: an empty body is a 409 outside a load, not a 400.
  const empty = await serviceFor('idle')
    .import({ buffer: Buffer.alloc(0) } as any, { manager: refusingManager() as any, tenantId: 'tenant-1' })
    .then(() => null, (error) => error);
  assert.ok(empty instanceof ConflictException, 'empty file outside a load: 409');
  assert.equal(empty.getStatus(), 409);
}

async function testAcceptedDuringLoad(): Promise<void> {
  const manager = acceptingManager();
  const result = await serviceFor('loading').import(FILE, { manager: manager as any, tenantId: 'tenant-1' });
  assert.deepEqual(result, { ok: true, imported: 1, skipped: 0, entries: 1 });

  const insert = manager.queries.find((query) => query.sql.includes('INSERT INTO incident_entries'));
  assert.ok(insert, 'one entry written');
  assert.equal(insert.params[1], 'incident-4');
  assert.equal(insert.params[2], 'note');
  assert.equal(insert.params[3], 'The B2B portal is unreachable.');
  assert.equal(insert.params[4], null);
  assert.equal((insert.params[5] as Date).toISOString(), '2026-06-02T05:52:00.000Z');
  assert.equal(insert.params[6], 'user-isabelle');
}

async function run(): Promise<void> {
  await testRefusedOutsideLoad();
  await testAcceptedDuringLoad();
  console.log('incident-journal-import.spec.ts: ok');
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
