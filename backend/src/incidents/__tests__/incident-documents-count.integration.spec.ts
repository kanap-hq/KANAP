import 'dotenv/config';
// @database-spec: the database comes through round-inputs.fixtures (data-source).
import { QueryRunner } from 'typeorm';
import { Incident } from '../incident.entity';
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

// The Relations tab badge takes the incident's technologies (`counts.technologies`, lot T2b).
async function testTechnologiesCounted() {
  await inRolledBackTransaction(async (runner) => {
    const s = await seed(runner, 'incdoc-tech');
    const opts = { manager: runner.manager, tenantId: s.tenantId };
    assert.equal((await service(runner).get(s.incidentId, opts)).counts.technologies, 0);
    const [{ id: techId }] = await runner.query(
      `INSERT INTO technologies (tenant_id, item_number, name, family) VALUES ($1, 1, 'SQL Server', 'database') RETURNING id`,
      [s.tenantId],
    );
    await runner.query(`INSERT INTO incident_technologies (tenant_id, incident_id, technology_id) VALUES ($1, $2, $3)`, [s.tenantId, s.incidentId, techId]);
    assert.equal((await service(runner).get(s.incidentId, opts)).counts.technologies, 1);
  });
}

void runSpecs('incident-documents-count', [
  ['the review is not counted among the incident documents', testReviewIsNotCounted],
  ['the technologies are counted for the Relations tab', testTechnologiesCounted],
]);
