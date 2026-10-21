// @database-spec
import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import type { QueryRunner } from 'typeorm';
import {
  ALL_WRITES, context, inRolledBackTransaction, NO_ACCESS, ALL_ACCESS, relationsService, runSpecs, seedRelations, setTenant,
  type AuditEntry, type RelationsSeed,
} from './application-relations.fixtures';

// The incidents of an application's Relations tab (lot R1b): listed by the register's
// confidentiality rule, linked and unlinked from the application through the incident's own
// service (visibility, open state, row lock, journal, audit), under the incident edit right.

async function incident(
  runner: QueryRunner,
  seed: RelationsSeed,
  number: number,
  extra: { confidential?: boolean; status?: string; reporter?: string; detected?: string } = {},
): Promise<string> {
  const rows = await runner.query(
    `INSERT INTO incidents (tenant_id, item_number, title, severity, confidential, status, reporter_user_id, detected_at)
     VALUES ($1, $2, $3, 'low', $4, $5, $6, $7) RETURNING id`,
    [seed.tenantId, number, `Incident ${number}`, extra.confidential ?? false, extra.status ?? 'open', extra.reporter ?? null, extra.detected ?? '2026-10-01T08:00:00Z'],
  );
  return rows[0].id;
}

async function linkRaw(runner: QueryRunner, seed: RelationsSeed, incidentId: string) {
  await runner.query(`INSERT INTO incident_applications (tenant_id, incident_id, application_id) VALUES ($1, $2, $3)`, [seed.tenantId, incidentId, seed.appId]);
}

async function linkedIds(runner: QueryRunner, seed: RelationsSeed): Promise<string[]> {
  const rows: Array<{ incident_id: string }> = await runner.query(
    `SELECT incident_id FROM incident_applications WHERE tenant_id = $1 AND application_id = $2 ORDER BY incident_id`,
    [seed.tenantId, seed.appId],
  );
  return rows.map((row) => row.incident_id);
}

/** The section lists what the viewer may see, newest detection first; a confidential one has no title. */
async function testList() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedRelations(runner, 'inc-list');
    const svc = relationsService();
    const older = await incident(runner, seed, 1, { detected: '2026-09-01T08:00:00Z' });
    const newer = await incident(runner, seed, 2, { detected: '2026-10-10T08:00:00Z', status: 'closed' });
    const secret = await incident(runner, seed, 3, { confidential: true, reporter: seed.otherUserId, detected: '2026-10-05T08:00:00Z' });
    const notLinked = await incident(runner, seed, 4);
    for (const id of [older, newer, secret]) await linkRaw(runner, seed, id);

    const admin = await svc.getRelations(seed.appId, context(runner.manager, seed));
    assert.deepEqual(admin.incidents?.map((row) => row.id), [newer, secret, older]);
    assert.ok(!admin.incidents?.some((row) => row.id === notLinked));
    const first = admin.incidents?.[0];
    assert.deepEqual(
      { item_number: first?.item_number, title: first?.title, status: first?.status, severity: first?.severity, detected_at: first?.detected_at },
      { item_number: 2, title: 'Incident 2', status: 'closed', severity: 'low', detected_at: '2026-10-10' },
    );
    assert.equal(admin.incidents?.[1].title, null, 'a confidential incident shows without its title');

    // A viewer who is neither registry admin, reporter nor owner does not see the confidential one.
    const viewer = context(runner.manager, seed, { incidentViewer: { userId: seed.userId, isAdmin: false } });
    assert.deepEqual((await svc.getRelations(seed.appId, viewer)).incidents?.map((row) => row.id), [newer, older]);
    // Its reporter does.
    const reporter = context(runner.manager, seed, { incidentViewer: { userId: seed.otherUserId, isAdmin: false } });
    assert.deepEqual((await svc.getRelations(seed.appId, reporter)).incidents?.map((row) => row.id), [newer, secret, older]);

    // Without the read of incidents, the section is null.
    const noRead = await svc.getRelations(seed.appId, context(runner.manager, seed, { access: { ...ALL_ACCESS, incidents: false } }));
    assert.equal(noRead.incidents, null);
  });
}

/** Link and unlink from the application: one journal entry and one audit row each, idempotent. */
async function testLinkAndUnlink() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedRelations(runner, 'inc-link');
    const audit: AuditEntry[] = [];
    const svc = relationsService({ audit });
    const ctx = context(runner.manager, seed);
    const open = await incident(runner, seed, 1);
    const other = await incident(runner, seed, 2);
    await linkRaw(runner, seed, other);

    assert.deepEqual(await svc.setLink('incidents', seed.appId, open, true, ctx), { ok: true, changed: true });
    assert.deepEqual(await linkedIds(runner, seed), [open, other].sort(), 'the link already there stays');
    const entries: Array<{ kind: string; author_id: string; changed_fields: any }> = await runner.query(
      `SELECT kind, author_id, changed_fields FROM incident_entries WHERE tenant_id = $1 AND incident_id = $2`,
      [seed.tenantId, open],
    );
    assert.equal(entries.length, 1, 'one journal entry');
    assert.equal(entries[0].kind, 'link_change');
    assert.equal(entries[0].author_id, seed.userId);
    assert.ok(Array.isArray(entries[0].changed_fields?.applications?.to));
    assert.equal(audit.at(-1)?.table, 'incident_applications');
    assert.equal(audit.at(-1)?.recordId, open);

    // Linking again, or unlinking what is not linked, changes nothing and writes nothing.
    const auditCount = audit.length;
    assert.deepEqual(await svc.setLink('incidents', seed.appId, open, true, ctx), { ok: true, changed: false });
    const free = await incident(runner, seed, 3);
    assert.deepEqual(await svc.setLink('incidents', seed.appId, free, false, ctx), { ok: true, changed: false });
    assert.equal(audit.length, auditCount);

    assert.deepEqual(await svc.setLink('incidents', seed.appId, open, false, ctx), { ok: true, changed: true });
    assert.deepEqual(await linkedIds(runner, seed), [other]);
    const after = await runner.query(`SELECT count(*)::int AS n FROM incident_entries WHERE tenant_id = $1 AND incident_id = $2`, [seed.tenantId, open]);
    assert.equal(after[0].n, 2);
  });
}

/** A closed or cancelled incident is frozen: it can be neither linked nor unlinked. */
async function testClosedIncidentIsFrozen() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedRelations(runner, 'inc-closed');
    const svc = relationsService();
    const ctx = context(runner.manager, seed);
    const closed = await incident(runner, seed, 1, { status: 'closed' });
    const cancelled = await incident(runner, seed, 2, { status: 'cancelled' });
    await linkRaw(runner, seed, closed);
    await assert.rejects(svc.setLink('incidents', seed.appId, closed, false, ctx), /closed/);
    await assert.rejects(svc.setLink('incidents', seed.appId, cancelled, true, ctx), /closed/);
    assert.deepEqual(await linkedIds(runner, seed), [closed]);
  });
}

/** A confidential incident the viewer cannot see answers as an unknown one, to link or unlink. */
async function testConfidentialIsInvisible() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedRelations(runner, 'inc-secret');
    const svc = relationsService();
    const secret = await incident(runner, seed, 1, { confidential: true, reporter: seed.otherUserId });
    const linkedSecret = await incident(runner, seed, 2, { confidential: true, reporter: seed.otherUserId });
    await linkRaw(runner, seed, linkedSecret);
    const viewer = context(runner.manager, seed, { incidentViewer: { userId: seed.userId, isAdmin: false } });
    await assert.rejects(svc.setLink('incidents', seed.appId, secret, true, viewer), /Incident not found/);
    await assert.rejects(svc.setLink('incidents', seed.appId, linkedSecret, false, viewer), /Incident not found/);
    await assert.rejects(svc.setLink('incidents', seed.appId, randomUUID(), true, viewer), /Incident not found/);
    assert.deepEqual(await linkedIds(runner, seed), [linkedSecret]);
    // Its reporter may link it.
    const reporter = context(runner.manager, seed, { incidentViewer: { userId: seed.otherUserId, isAdmin: false } });
    assert.deepEqual(await svc.setLink('incidents', seed.appId, secret, true, reporter), { ok: true, changed: true });
  });
}

/** Linking needs the read of incidents and the right to edit one. */
async function testMissingRight() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedRelations(runner, 'inc-right');
    const svc = relationsService();
    const open = await incident(runner, seed, 1);
    await assert.rejects(
      svc.setLink('incidents', seed.appId, open, true, context(runner.manager, seed, { writes: { ...ALL_WRITES, incidents: false } })),
      ForbiddenException,
    );
    await assert.rejects(svc.setLink('incidents', seed.appId, open, true, context(runner.manager, seed, { access: NO_ACCESS })), ForbiddenException);
    assert.deepEqual(await linkedIds(runner, seed), []);
  });
}

/** Under another tenant, an incident is unknown and nothing of it shows. */
async function testTenantIsolation() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seedRelations(runner, 'inc-iso-a');
    const incidentA = await incident(runner, a, 1);
    await linkRaw(runner, a, incidentA);
    const b = await seedRelations(runner, 'inc-iso-b');
    const svc = relationsService();
    const ctxB = context(runner.manager, b);
    // The session is on B: A's incident does not exist here.
    await assert.rejects(svc.setLink('incidents', b.appId, incidentA, true, ctxB), /Incident not found/);
    assert.deepEqual((await svc.getRelations(b.appId, ctxB)).incidents, []);
    await setTenant(runner, a.tenantId);
    assert.deepEqual((await svc.getRelations(a.appId, context(runner.manager, a))).incidents?.map((row) => row.id), [incidentA]);
  });
}

runSpecs('application-relations-incidents.integration.spec', [
  testList,
  testLinkAndUnlink,
  testClosedIncidentIsFrozen,
  testConfidentialIsInvisible,
  testMissingRight,
  testTenantIsolation,
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
