import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';

// An incident's journal records each change of its linked applications with their references.
// - A person who reads every application sees the references, as before.
// - A Business Contributor sees the references of the applications of their participation; the
//   others are a number per direction (`hidden: { linked, unlinked }`), in the entry's sentence too.
// - A person who does not read applications does not see the entry at all, as before.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'incident-journal-linked-names-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(`${sql} RETURNING id`, params))[0].id;
}

type Entry = { kind: string; content: string | null; changed_fields: Record<string, any> | null };

async function run() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for incident-journal-linked-names.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { IncidentsController } = require('../incidents.controller');
  const { IncidentRelationsService } = require('../services/incident-relations.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  const incidents = app.get(IncidentsController);
  const incidentRelations = app.get(IncidentRelationsService);
  const runner = app.get(DataSource).createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    const slug = `journal-names-${tenantId.slice(0, 8)}`;
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, slug, slug],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const role = async (name: string, permissions: Record<string, string>) => {
      const id = await insertId(runner, `INSERT INTO roles (tenant_id, role_name) VALUES ($1, $2)`, [tenantId, name]);
      for (const [resource, level] of Object.entries(permissions)) {
        await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`, [tenantId, id, resource, level]);
      }
      return { id, permissions };
    };
    const user = async (name: string, roleId: string) => {
      const id = await insertId(runner,
        `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status) VALUES ($1, $2, $3, 'Reader', $4, 'enabled')`,
        [tenantId, `${name}-${tenantId.slice(0, 8)}@example.test`, name, roleId]);
      await runner.query(`INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, true)`, [tenantId, id, roleId]);
      return id;
    };
    const adminRole = await role('Administrator', {});
    const bcRole = await role('Business Contributor', { incidents: 'reader', applications: 'reader' });
    const incidentsOnly = await role('Incident reader', { incidents: 'reader' });
    const adminId = await user('admin', adminRole.id);
    const bcId = await user('bc', bcRole.id);
    const readerId = await user('reader', incidentsOnly.id);

    const seen = await insertId(runner, `INSERT INTO applications (tenant_id, name) VALUES ($1, 'Seen app')`, [tenantId]);
    await runner.query(`INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type) VALUES ($1, $2, $3, 'business')`, [tenantId, seen, bcId]);
    const unseen = await insertId(runner, `INSERT INTO applications (tenant_id, name) VALUES ($1, 'Secret app')`, [tenantId]);
    const refOf = async (id: string) => (await runner.query(`SELECT sequential_id FROM applications WHERE id = $1`, [id]))[0].sequential_id as string;
    const seenRef = await refOf(seen);
    const unseenRef = await refOf(unseen);
    assert.ok(seenRef && unseenRef, 'applications carry references');
    const incident = await insertId(runner,
      `INSERT INTO incidents (tenant_id, item_number, title, severity, status, detected_at, reporter_user_id, owner_user_id, confidential, created_at, updated_at)
       VALUES ($1, 1, 'Outage', 'major', 'open', now(), $2, $2, false, now(), now())`, [tenantId, adminId]);

    // Written by a person who reads every application: both linked, then the unseen one unlinked.
    const write = { manager: runner.manager, tenantId };
    await incidentRelations.bulkReplaceApplications(incident, [seen, unseen], adminId, write);
    await incidentRelations.bulkReplaceApplications(incident, [seen], adminId, write);

    const ctxOf = (userId: string, permissions: Record<string, string>, isAdmin = false) => ({
      tenantId, userId, isAdmin, permissions, manager: runner.manager, queryRunner: runner, user: { sub: userId }, tenant: { id: tenantId },
    });
    const journal = async (ctx: any): Promise<Entry[]> => (await incidents.listEntries(incident, ctx))
      .filter((entry: Entry) => entry.kind === 'link_change')
      .sort((a: Entry, b: Entry) => String(a.content).length - String(b.content).length);

    // A person who reads every application: the references, as before.
    const full = await journal(ctxOf(adminId, {}, true));
    assert.equal(full.length, 2, 'full reader: both entries');
    assert.ok(full.some((entry) => String(entry.content).includes(unseenRef)), 'full reader: the unseen reference');
    const snapshot = (change: any) => ({ ...change, from: [...change.from].sort(), to: [...change.to].sort() });
    assert.deepEqual(full.map((entry) => snapshot(entry.changed_fields?.applications)).sort((x, y) => x.from.length - y.from.length), [
      { from: [], to: [seenRef, unseenRef].sort() },
      { from: [seenRef, unseenRef].sort(), to: [seenRef] },
    ], 'full reader: unchanged snapshots');
    console.log('  a reader of every application sees the references: OK');

    // A Business Contributor: their application named, the other a number, in the sentence too.
    const bc = await journal(ctxOf(bcId, bcRole.permissions));
    assert.equal(bc.length, 2, 'contributor: both entries stay');
    assert.ok(!JSON.stringify(bc).includes(unseenRef) && !JSON.stringify(bc).includes('Secret'), 'contributor: no unseen reference');
    const linked = bc.find((entry) => entry.changed_fields?.applications?.from.length === 0)!;
    assert.deepEqual(linked.changed_fields?.applications, { from: [], to: [seenRef], hidden: { linked: 1, unlinked: 0 } }, 'contributor: linking');
    assert.equal(linked.content, `Applications linked: ${seenRef}, 1 not shown.`, 'contributor: the sentence of the linking');
    const unlinked = bc.find((entry) => entry.changed_fields?.applications?.from.length === 1)!;
    assert.deepEqual(unlinked.changed_fields?.applications, { from: [seenRef], to: [seenRef], hidden: { linked: 0, unlinked: 1 } }, 'contributor: unlinking');
    assert.equal(unlinked.content, 'Applications unlinked: 1 not shown.', 'contributor: the sentence of the unlinking');
    console.log('  a Business Contributor sees their references and the number of the others: OK');

    // A person who does not read applications: no application link change at all, as before.
    assert.deepEqual(await journal(ctxOf(readerId, incidentsOnly.permissions)), [], 'no reader of applications: no entry');
    console.log('  a person who does not read applications sees no such entry: OK');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await app.close();
  }
  console.log('incident-journal-linked-names.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
