import 'dotenv/config';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { EntityManager, QueryRunner } from 'typeorm';
import { NestFactory } from '@nestjs/core';
import { seedManagedDocsKnowledgeAssets } from '../../knowledge/integrated-document-seed';
import { assert, assertSucceeded, progress, runRaceSpecs, settle, withRace } from '../../spend/__tests__/race-harness';

// Lot I7b of 26.12.1: an import of the rows B, A against a change in bulk of the owners of A and B.
// The import locks every application its file finds by id or name in id order, in one statement,
// before its first write (`CsvImportService.lockExistingEntities`, lot I6 of 26.11.9), as the change in
// bulk locks them: whichever starts first, the other waits for it, then both succeed, with no deadlock
// (40P01), in "update only" as in "add or update", whatever the order the file and the table hold.
// L3: a file that updates X by its name and Y, of the smaller id, through "Update APP-n" (a row that
// looks like Y): Y is locked with X, in the same statement and the same order (`lockExistingEntities`
// with the config's `lockAlso`), never after X.
// With the real services: each row also writes its application's description into its document.

process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.STRIPE_SECRET_KEY = '';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9000';
process.env.S3_BUCKET ||= 'test-bucket';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

let h!: { app: any; svc: any; csv: any };

async function boot() {
  const { AppModule } = require('../../app.module');
  const { ApplicationsService } = require('../services/applications.service');
  const { ApplicationsCsvService } = require('../applications-csv.service');
  const { NotificationsService } = require('../../notifications/notifications.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  // Nothing is sent from this spec.
  const notifications = app.get(NotificationsService, { strict: false });
  for (const method of Object.getOwnPropertyNames(Object.getPrototypeOf(notifications))) {
    if (method.startsWith('notify')) notifications[method] = async () => undefined;
  }
  h = { app, svc: app.get(ApplicationsService, { strict: false }), csv: app.get(ApplicationsCsvService, { strict: false }) };
}

/** The services of the application module; each call is given its connection's manager. */
function services(_manager: EntityManager) {
  return { svc: h.svc, csv: h.csv };
}

/** The descriptions of the applications' documents, in id order. */
async function documents(race: any, ids: string[]): Promise<string[]> {
  const rows = await race.read(
    `SELECT d.content_markdown AS text FROM integrated_document_bindings b JOIN documents d ON d.id = b.document_id
      WHERE b.source_entity_type = 'applications' AND b.slot_key = 'overview' AND b.source_entity_id = ANY($1::uuid[])
      ORDER BY b.source_entity_id`, [ids]);
  return rows.map((row: any) => row.text);
}

/** Two applications and a person; `first` has the smaller id. */
async function seedApplications(runner: QueryRunner, tenantId: string, firstName = 'Race one') {
  const [role] = await runner.query(
    `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, 'Race', 'Race', false, false, now(), now()) RETURNING id`,
    [tenantId],
  );
  await seedManagedDocsKnowledgeAssets(runner.manager as any, tenantId);
  const [user] = await runner.query(
    `INSERT INTO users (tenant_id, first_name, last_name, email, password_hash, role_id, mfa_enabled, status, created_at, updated_at)
     VALUES ($1, 'Ana', 'Race', $2, null, $3, false, 'enabled', now(), now()) RETURNING id`,
    [tenantId, `ana-${tenantId.slice(0, 8)}@example.com`, role.id],
  );
  // The application of the larger id is stored first: the table's order is not the id order.
  const [smaller, larger] = [randomUUID(), randomUUID()].sort();
  const apps: Array<{ id: string; name: string }> = [];
  for (const [id, name] of [[larger, 'Race two'], [smaller, firstName]]) {
    const [app] = await runner.query(
      `INSERT INTO applications (id, tenant_id, name, status, lifecycle) VALUES ($1, $2, $3, 'enabled', 'active') RETURNING id::text AS id, name`,
      [id, tenantId, name],
    );
    apps.push(app);
  }
  return { first: apps[1], second: apps[0], ana: String(user.id) };
}

const bounded = (manager: EntityManager) => manager.query(`SET LOCAL lock_timeout = '10s'`);

async function importAgainstBulk(operation: 'update_only' | 'upsert', importFirst: boolean) {
  await withRace(`apps-import-${operation}-${importFirst ? 'import' : 'bulk'}-first`, async (race) => {
    const { first, second, ana } = await race.seedWith((runner) => seedApplications(runner, race.tenantId));
    const load = await race.open(`import (${operation}) of ${second.name}, then ${first.name}`);
    const bulk = await race.open(`owners in bulk of ${first.name} and ${second.name}`);
    // The file in the reverse of the id order: the second application first.
    const file = `name;version;description\n${second.name};2.0;Text of two\n${first.name};2.0;Text of one\n`;
    const runImport = () => race.start(load, async (manager) => {
      await bounded(manager);
      // The plan of a large tenant: rows read without an index come in the table's order, which is
      // not the id order. The lock statement sorts them itself.
      await manager.query(`SET LOCAL enable_indexscan = off`);
      await manager.query(`SET LOCAL enable_bitmapscan = off`);
      return services(manager).csv.import(
        { buffer: Buffer.from(file), originalname: 'apps.csv' } as Express.Multer.File,
        { dryRun: false, operation },
        { manager, tenantId: race.tenantId, access: { isAdmin: true, permissions: {} } },
      );
    });
    const runBulk = () => race.start(bulk, async (manager) => {
      await bounded(manager);
      return services(manager).svc.bulkUpdate(
        { ids: [first.id, second.id], changes: { owners_business: [ana] } }, null, { manager, tenantId: race.tenantId },
      );
    });

    let importWork: Promise<any>;
    let bulkWork: Promise<any>;
    if (importFirst) {
      // The import paused at its first write of an application, holding what it locked so far.
      const holds = race.gate(load, { label: 'first write of an application', when: 'after', match: (text) => /^\s*UPDATE "applications"/.test(text) });
      importWork = runImport();
      assert.equal(await progress(importWork, { party: load, gate: holds }), 'gated', 'harness: the import must pause at its first write');
      bulkWork = runBulk();
      assert.equal(await progress(bulkWork, { party: bulk }), 'blocked', 'the change in bulk waits for the import');
      holds.release();
    } else {
      const holds = race.gate(bulk, { label: 'lock the applications', when: 'after', match: (text) => /FOR UPDATE OF a/.test(text) });
      bulkWork = runBulk();
      assert.equal(await progress(bulkWork, { party: bulk, gate: holds }), 'gated', 'harness: the change in bulk must pause holding the applications');
      importWork = runImport();
      assert.equal(await progress(importWork, { party: load }), 'blocked', 'the import waits for the change in bulk');
      holds.release();
    }
    const importDone = await settle(importWork);
    const bulkDone = await settle(bulkWork);
    assertSucceeded(importDone, 'the import');
    assertSucceeded(bulkDone, 'the change in bulk');
    assert.equal((importDone as any).value?.ok, true, JSON.stringify((importDone as any).value?.errors));
    assert.equal((importDone as any).value?.updated, 2, 'the import updated both applications');
    assert.equal((bulkDone as any).value?.changed, 2, 'the change in bulk changed both applications');
    const versions = await race.read(`SELECT version FROM applications WHERE id = ANY($1::uuid[])`, [[first.id, second.id]]);
    assert.deepEqual(versions.map((row) => row.version), ['2.0', '2.0']);
    const owners = await race.read(`SELECT count(*)::int AS n FROM application_owners WHERE application_id = ANY($1::uuid[]) AND owner_type = 'business'`, [[first.id, second.id]]);
    assert.equal(owners[0].n, 2);
    assert.deepEqual(await documents(race, [first.id, second.id]), ['Text of one', 'Text of two'], 'the documents hold the imported descriptions');
  });
}

void (async () => {
  await boot();
  try {
    await runRaceSpecs('Application import lock order', [
      ['L1: an import "update only" of B, A started first, then a change in bulk of A, B: no deadlock', () => importAgainstBulk('update_only', true)],
      ['L1: a change in bulk of A, B started first, then an import "update only" of B, A: no deadlock', () => importAgainstBulk('update_only', false)],
      ['L2: an import "add or update" of B, A found by name started first, then a change in bulk of A, B: no deadlock', () => importAgainstBulk('upsert', true)],
      ['L2: a change in bulk of A, B started first, then an import "add or update" of B, A: no deadlock', () => importAgainstBulk('upsert', false)],
      ['L3: an import of X by its name and of Y as "Update APP-n" started first, then a change in bulk of Y, X: no deadlock', () => lookalikeAgainstBulk(true)],
      ['L3: a change in bulk of Y, X started first, then an import of X by its name and of Y as "Update APP-n": no deadlock', () => lookalikeAgainstBulk(false)],
    ]);
  } finally {
    await h.app.close();
  }
  process.exit(0);
})();

/**
 * L3: the file updates `second` (the larger id) by its name and `first` through "Update APP-n": its row
 * names it without its accents (it looks like it), and the person chose to update it.
 */
async function lookalikeAgainstBulk(importFirst: boolean) {
  await withRace(`apps-lookalike-${importFirst ? 'import' : 'bulk'}-first`, async (race) => {
    const { first, second, ana } = await race.seedWith((runner) => seedApplications(runner, race.tenantId, 'Rácé one'));
    const load = await race.open(`import of ${second.name} by its name and of ${first.name} as "Update APP-n"`);
    const bulk = await race.open(`owners in bulk of ${first.name} and ${second.name}`);
    const file = `name;version;description\n${second.name};2.0;Text of two\nRace one;2.0;Text of one\n`;
    const runImport = () => race.start(load, async (manager) => {
      await bounded(manager);
      return services(manager).csv.import(
        { buffer: Buffer.from(file), originalname: 'apps.csv' } as Express.Multer.File,
        { dryRun: false, operation: 'upsert', lookalikes: [{ kind: 'lookalike', line: 3, action: 'update', id: first.id }] },
        { manager, tenantId: race.tenantId, access: { isAdmin: true, permissions: {} } },
      );
    });
    const runBulk = () => race.start(bulk, async (manager) => {
      await bounded(manager);
      return services(manager).svc.bulkUpdate(
        { ids: [first.id, second.id], changes: { owners_business: [ana] } }, null, { manager, tenantId: race.tenantId },
      );
    });

    let importWork: Promise<any>;
    let bulkWork: Promise<any>;
    if (importFirst) {
      // The import paused once it locked the applications its file finds by id or name.
      const holds = race.gate(load, { label: 'lock what the file finds', when: 'after', match: (text) => /FROM applications .*ORDER BY id FOR NO KEY UPDATE/s.test(text) });
      importWork = runImport();
      assert.equal(await progress(importWork, { party: load, gate: holds }), 'gated', 'harness: the import must pause after its first lock');
      bulkWork = runBulk();
      assert.equal(await progress(bulkWork, { party: bulk }), 'blocked', 'the change in bulk waits for the import');
      holds.release();
    } else {
      const holds = race.gate(bulk, { label: 'lock the applications', when: 'after', match: (text) => /FOR UPDATE OF a/.test(text) });
      bulkWork = runBulk();
      assert.equal(await progress(bulkWork, { party: bulk, gate: holds }), 'gated', 'harness: the change in bulk must pause holding the applications');
      importWork = runImport();
      assert.equal(await progress(importWork, { party: load }), 'blocked', 'the import waits for the change in bulk');
      holds.release();
    }
    const importDone = await settle(importWork);
    const bulkDone = await settle(bulkWork);
    assertSucceeded(importDone, 'the import');
    assertSucceeded(bulkDone, 'the change in bulk');
    assert.equal((importDone as any).value?.ok, true, JSON.stringify((importDone as any).value?.errors));
    assert.equal((importDone as any).value?.updated, 2, 'the import updated both applications');
    assert.equal((bulkDone as any).value?.changed, 2, 'the change in bulk changed both applications');
    const rows = await race.read(`SELECT name, version FROM applications WHERE id = ANY($1::uuid[]) ORDER BY id`, [[first.id, second.id]]);
    assert.deepEqual(rows.map((row) => [row.name, row.version]), [[first.name, '2.0'], [second.name, '2.0']], 'Y keeps its name');
    assert.deepEqual(await documents(race, [first.id, second.id]), ['Text of one', 'Text of two'], 'the documents hold the imported descriptions');
  });
}
