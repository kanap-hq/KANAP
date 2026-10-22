import 'dotenv/config';
// @database-spec: the database comes through round-inputs.fixtures (data-source).
import { QueryRunner } from 'typeorm';
import { Incident } from '../incident.entity';
import { ForbiddenException } from '@nestjs/common';
import { IncidentsController } from '../incidents.controller';
import { IncidentRelationsService } from '../services/incident-relations.service';
import { IncidentsService } from '../services/incidents.service';
import { assert, inRolledBackTransaction, runSpecs, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';

// The Documents tab badge of an incident (`counts.documents`) counts what the tab lists: the
// incident's own review is a managed document hidden from its documents, so it is not counted
// (QA lot 14: the badge said 1 while the tab said there was no standalone document). A document
// another record manages, linked to the incident, is listed and counted.

async function seed(runner: QueryRunner, tag: string) {
  const tenantId = await seedTenant(runner, tag);
  await setTenant(runner, tenantId);
  const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0].id as string;
  const incidentId = await one(
    `INSERT INTO incidents (tenant_id, item_number, title, severity) VALUES ($1, 1, $2, 'minor') RETURNING id`,
    [tenantId, `Outage ${tag}`],
  );
  const libraryId = await one(`INSERT INTO document_libraries (tenant_id, name, slug) VALUES ($1, 'Lib', $2) RETURNING id`, [tenantId, `lib-${tag}`]);
  const doc = (n: number, title: string) => one(
    `INSERT INTO documents (tenant_id, item_number, title, library_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [tenantId, n, title, libraryId],
  );
  const reviewDocId = await doc(1, 'Incident review');
  await runner.query(
    `INSERT INTO integrated_document_bindings (tenant_id, source_entity_type, source_entity_id, slot_key, document_id, hidden_from_entity_knowledge)
     VALUES ($1, 'incidents', $2, 'review', $3, true)`,
    [tenantId, incidentId, reviewDocId],
  );
  await runner.query(`INSERT INTO document_incidents (tenant_id, document_id, incident_id) VALUES ($1, $2, $3)`, [tenantId, reviewDocId, incidentId]);
  return { tenantId, incidentId, doc };
}

function service(runner: QueryRunner) {
  return new IncidentsService(runner.manager.getRepository(Incident), { log: async () => undefined } as any, null as any, null as any);
}

async function testReviewIsNotCounted() {
  await inRolledBackTransaction(async (runner) => {
    const s = await seed(runner, 'incdoc-review');
    const opts = { manager: runner.manager, tenantId: s.tenantId };
    assert.equal((await service(runner).get(s.incidentId, opts)).counts.documents, 0);

    const runbookId = await s.doc(2, 'Runbook');
    const overviewId = await s.doc(3, 'Application overview');
    await runner.query(
      `INSERT INTO integrated_document_bindings (tenant_id, source_entity_type, source_entity_id, slot_key, document_id, hidden_from_entity_knowledge)
       VALUES ($1, 'applications', gen_random_uuid(), 'overview', $2, false)`,
      [s.tenantId, overviewId],
    );
    for (const documentId of [runbookId, overviewId]) {
      await runner.query(`INSERT INTO document_incidents (tenant_id, document_id, incident_id) VALUES ($1, $2, $3)`, [s.tenantId, documentId, s.incidentId]);
    }
    assert.equal((await service(runner).get(s.incidentId, opts)).counts.documents, 2);
  });
}

// Relations the tab shows are counted for a reader of their module only. Assets and technologies
// need the infrastructure, applications need applications. A caller who cannot read a module gets
// that count null (a linked row still there, so null is not zero). Technologies still refuse their
// old list and replacement, and no link is removed. A reader of the infrastructure gets the count
// and the list.
async function testTechnologiesNeedTheInfrastructure() {
  await inRolledBackTransaction(async (runner) => {
    const s = await seed(runner, 'incdoc-tech');
    const [{ id: techId }] = await runner.query(
      `INSERT INTO technologies (tenant_id, item_number, name, family) VALUES ($1, 1, 'SQL Server', 'database') RETURNING id`,
      [s.tenantId],
    );
    await runner.query(`INSERT INTO incident_technologies (tenant_id, incident_id, technology_id) VALUES ($1, $2, $3)`, [s.tenantId, s.incidentId, techId]);
    const [{ id: assetId }] = await runner.query(
      `INSERT INTO assets (tenant_id, name, kind, environment, status, created_at, updated_at)
       VALUES ($1, 'DB server', 'physical_server', 'prod', 'active', now(), now()) RETURNING id`,
      [s.tenantId],
    );
    await runner.query(`INSERT INTO incident_assets (tenant_id, incident_id, asset_id) VALUES ($1, $2, $3)`, [s.tenantId, s.incidentId, assetId]);
    const [{ id: appId }] = await runner.query(
      `INSERT INTO applications (tenant_id, name) VALUES ($1, 'Billing') RETURNING id`,
      [s.tenantId],
    );
    await runner.query(`INSERT INTO incident_applications (tenant_id, incident_id, application_id) VALUES ($1, $2, $3)`, [s.tenantId, s.incidentId, appId]);
    const relations = new IncidentRelationsService(undefined as any, { log: async () => undefined } as any);
    const args: any[] = Array.from({ length: 12 }, () => undefined);
    args[0] = service(runner);
    args[2] = relations;
    const controller = new (IncidentsController as any)(...args) as IncidentsController;
    const ctx = (permissions: Record<string, string>): any => ({ manager: runner.manager, tenantId: s.tenantId, userId: null, isAdmin: false, permissions });

    const incidentsOnly = ctx({ incidents: 'contributor' });
    const hidden = ((await controller.get(s.incidentId, incidentsOnly)) as any).counts;
    assert.equal(hidden.assets, null);
    assert.equal(hidden.applications, null);
    assert.equal(hidden.technologies, null);
    for (const call of [
      () => controller.listTechnologies(s.incidentId, incidentsOnly),
      () => controller.bulkReplaceTechnologies(s.incidentId, { technology_ids: [] }, incidentsOnly),
    ]) {
      const refused = await call().then(() => null, (err) => err);
      assert.ok(refused instanceof ForbiddenException);
    }
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM incident_technologies WHERE tenant_id = $1 AND incident_id = $2`, [s.tenantId, s.incidentId]);
    assert.equal(n, 1, 'no link removed');

    const reader = ctx({ incidents: 'contributor', infrastructure: 'reader' });
    const shown = ((await controller.get(s.incidentId, reader)) as any).counts;
    assert.equal(shown.assets, 1);
    assert.equal(shown.applications, null, 'a linked application stays null without the applications read');
    assert.equal(shown.technologies, 1);
    assert.deepEqual((await controller.listTechnologies(s.incidentId, reader)).map((row) => row.reference), ['TEC-1']);

    const applications = ctx({ incidents: 'reader', applications: 'reader' });
    const appCounts = ((await controller.get(s.incidentId, applications)) as any).counts;
    assert.equal(appCounts.applications, 1);
    assert.equal(appCounts.assets, null);
    assert.equal(appCounts.technologies, null);
  });
}

void runSpecs('incident-documents-count', [
  ['the review is not counted among the incident documents', testReviewIsNotCounted],
  ['relation counts follow the module the tab shows', testTechnologiesNeedTheInfrastructure],
]);
