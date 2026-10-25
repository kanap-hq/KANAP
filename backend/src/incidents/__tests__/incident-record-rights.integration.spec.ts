// @database-spec
import 'reflect-metadata';
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import { Task } from '../../tasks/task.entity';
import { TasksUnifiedService } from '../../tasks/tasks-unified.service';
import { Incident } from '../incident.entity';
import { IncidentRecordService } from '../services/incident-record.service';
import { IncidentReportService } from '../services/incident-report.service';
import { IncidentEntriesService } from '../services/incident-entries.service';
import { IncidentRelationsService } from '../services/incident-relations.service';
import { IncidentsAttachmentsService } from '../services/incidents-attachments.service';
import { IncidentsService } from '../services/incidents.service';
import {
  assert,
  captureAudit,
  inRolledBackTransaction,
  runSpecs,
  seedTenant,
} from '../../spend/__tests__/round-inputs.fixtures';

// The complete incident record on a migrated database: the PDF and the assistant's detail read
// the linked assets, applications and technologies (infrastructure), the applications a Business
// Contributor takes part in, and the incident's tasks only when the caller reads their module.
// A section without the right is null in the record and absent from the PDF; the PDF adds the
// linked technologies and the tasks' assignee and due date when it may print them.

type Seed = {
  tenantId: string;
  userId: string;
  contributorId: string;
  incidentId: string;
  incidentRef: string;
  assets: string[];
  apps: { alpha: string; owned: string };
  technologies: { postgres: string; redis: string };
  tasks: { assigned: string; other: string };
};

async function harness(runner: QueryRunner) {
  const repo = runner.manager.getRepository(Incident);
  const audit = captureAudit();
  const incidents = new IncidentsService(repo, audit as any, null as any, null as any);
  const entries = new IncidentEntriesService(repo);
  const relations = new IncidentRelationsService(repo, audit as any);
  const attachments = new IncidentsAttachmentsService(repo, audit as any, null as any);
  const tasks = new TasksUnifiedService(
    runner.manager.getRepository(Task),
    audit as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
  );
  const knowledge = { listDocumentsForEntity: async () => ({ access: 'granted', items: [] }) };
  const records = new IncidentRecordService(
    incidents,
    entries,
    relations,
    attachments,
    tasks,
    knowledge as any,
  );
  const markdowns: string[] = [];
  const documentExport = {
    exportMarkdown: async (markdown: string) => {
      markdowns.push(markdown);
      return { buffer: Buffer.from('%PDF-1.4 fake'), mimeType: 'application/pdf', extension: 'pdf', filename: 'report.pdf' };
    },
  };
  const itOps = { getSettings: async () => ({ incidentCategories: [] }) };
  const report = new IncidentReportService(records, documentExport as any, itOps as any);
  return { records, report, markdowns };
}

async function seedRich(runner: QueryRunner, tag: string): Promise<Seed> {
  const tenantId = await seedTenant(runner, tag);
  const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0];
  const memberRole = (await one(
    `INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Member') RETURNING id`,
    [tenantId],
  )).id as string;
  const contributorRole = (await one(
    `INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Business Contributor') RETURNING id`,
    [tenantId],
  )).id as string;
  const user = (email: string, roleId: string, first: string, last: string) => one(
    `INSERT INTO users (tenant_id, email, role_id, first_name, last_name)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenantId, email, roleId, first, last],
  ).then((row) => row.id as string);
  const stamp = tenantId.slice(0, 8);
  const userId = await user(`rec-${tag}-${stamp}@example.test`, memberRole, 'Ada', 'Martin');
  const contributorId = await user(`rec-${tag}-bc-${stamp}@example.test`, contributorRole, 'Luc', 'Bernard');

  const incident = await one(
    `INSERT INTO incidents (tenant_id, item_number, title, severity, reporter_user_id)
     VALUES ($1, 4, $2, 'major', $3) RETURNING id`,
    [tenantId, `Outage ${tag}`, userId],
  );
  const incidentId = incident.id as string;
  const asset = (name: string, kind: string, environment: string) => one(
    `INSERT INTO assets (tenant_id, name, kind, environment, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'active', now(), now()) RETURNING id`,
    [tenantId, name, kind, environment],
  ).then((row) => row.id as string);
  const assetA = await asset('Alpha srv', 'physical_server', 'prod');
  const assetB = await asset('Beta srv', 'virtual_machine', 'test');

  const application = (name: string) => one(
    `INSERT INTO applications (tenant_id, name, lifecycle, criticality, status)
     VALUES ($1, $2, 'active', 'high', 'enabled') RETURNING id`,
    [tenantId, name],
  ).then((row) => row.id as string);
  const alpha = await application('Alpha app');
  const owned = await application('Owned app');
  await runner.query(
    `INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type)
     VALUES ($1, $2, $3, 'business')`,
    [tenantId, owned, contributorId],
  );

  const technology = (n: number, name: string, family: string, editor: string | null) => one(
    `INSERT INTO technologies (tenant_id, item_number, name, family, editor)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenantId, n, name, family, editor],
  ).then((row) => row.id as string);
  const postgres = await technology(10, 'PostgreSQL', 'database', 'PostgreSQL Global Development Group');
  const redis = await technology(11, 'Redis', 'database', 'Redis Ltd');

  const task = (n: number, title: string, status: string, due: string | null) => one(
    `INSERT INTO tasks (tenant_id, item_number, title, status, related_object_type, related_object_id, assignee_user_id, due_date)
     VALUES ($1, $2, $3, $4, 'incident', $5, $6, $7) RETURNING id`,
    [tenantId, n, title, status, incidentId, userId, due],
  ).then((row) => row.id as string);
  const assigned = await task(1, 'Restore mail flow', 'open', '2026-03-20');
  const other = await task(2, 'Archive logs', 'done', null);

  await runner.query(
    `INSERT INTO incident_assets (tenant_id, incident_id, asset_id) VALUES ($1, $2, $3), ($1, $2, $4)`,
    [tenantId, incidentId, assetA, assetB],
  );
  await runner.query(
    `INSERT INTO incident_applications (tenant_id, incident_id, application_id) VALUES ($1, $2, $3), ($1, $2, $4)`,
    [tenantId, incidentId, alpha, owned],
  );
  await runner.query(
    `INSERT INTO incident_technologies (tenant_id, incident_id, technology_id) VALUES ($1, $2, $3), ($1, $2, $4)`,
    [tenantId, incidentId, postgres, redis],
  );
  return {
    tenantId,
    userId,
    contributorId,
    incidentId,
    incidentRef: 'INC-4',
    assets: [assetA, assetB],
    apps: { alpha, owned },
    technologies: { postgres, redis },
    tasks: { assigned, other },
  };
}

async function testAdministratorGetsEverySection() {
  await inRolledBackTransaction(async (runner) => {
    const s = await seedRich(runner, 'rec-all');
    const { records } = await harness(runner);
    const record = await records.load(s.incidentId, {
      manager: runner.manager,
      tenantId: s.tenantId,
      userId: s.userId,
      viewer: { userId: s.userId, isAdmin: false },
      technologies: true,
      applications: true,
      tasks: true,
    });
    assert.equal(record.assets?.length, 2);
    assert.equal(record.applications?.length, 2);
    assert.equal(record.technologies?.length, 2);
    assert.equal(record.tasks?.length, 2);
    const assigned = record.tasks?.find((task) => task.id === s.tasks.assigned);
    assert.equal(assigned?.assignee_name, 'Ada Martin');
    assert.equal(assigned?.due_date, '2026-03-20');
    assert.equal(record.incident.item_number, 4);
  });
}

async function testReaderWithoutModuleRightsGetsNoSection() {
  await inRolledBackTransaction(async (runner) => {
    const s = await seedRich(runner, 'rec-none');
    const { records, report, markdowns } = await harness(runner);
    const opts = {
      manager: runner.manager,
      tenantId: s.tenantId,
      userId: s.userId,
      viewer: { userId: s.userId, isAdmin: false },
    };
    const record = await records.load(s.incidentId, opts);
    assert.equal(record.assets, null);
    assert.equal(record.applications, null);
    assert.equal(record.technologies, null);
    assert.equal(record.tasks, null);

    await report.exportPdf(s.incidentId, 'en', opts);
    const markdown = markdowns[0];
    assert.equal(markdown.includes('### Assets'), false);
    assert.equal(markdown.includes('### Applications'), false);
    assert.equal(markdown.includes('### Technologies'), false);
    assert.equal(markdown.includes('### Tasks'), false);
    assert.equal(markdown.includes('Linked objects'), false);
  });
}

async function testSectionsFollowTheirOwnModuleRead() {
  await inRolledBackTransaction(async (runner) => {
    const s = await seedRich(runner, 'rec-split');
    const { records, report, markdowns } = await harness(runner);
    const base = {
      manager: runner.manager,
      tenantId: s.tenantId,
      userId: s.userId,
      viewer: { userId: s.userId, isAdmin: false },
    };

    const infrastructure = await records.load(s.incidentId, { ...base, technologies: true });
    assert.equal(infrastructure.assets?.length, 2);
    assert.equal(infrastructure.technologies?.length, 2);
    assert.equal(infrastructure.applications, null);
    assert.equal(infrastructure.tasks, null);

    const applications = await records.load(s.incidentId, { ...base, applications: true });
    assert.equal(applications.assets, null);
    assert.equal(applications.technologies, null);
    assert.equal(applications.applications?.length, 2);
    assert.equal(applications.tasks, null);

    const tasks = await records.load(s.incidentId, { ...base, tasks: true });
    assert.equal(tasks.tasks?.length, 2);
    assert.equal(tasks.assets, null);

    await report.exportPdf(s.incidentId, 'fr', { ...base, technologies: true, tasks: true });
    const markdown = markdowns.at(-1)!;
    assert.ok(markdown.includes('### Technologies'));
    assert.ok(markdown.includes('TEC-10 · PostgreSQL'));
    assert.ok(markdown.includes('### Tâches'));
    assert.ok(markdown.includes('Assigné à: Ada Martin'), markdown);
    assert.ok(markdown.includes('Échéance 20 mars 2026'), markdown);
    assert.ok(markdown.includes('### Actifs'), 'the infrastructure read also prints the assets');
    assert.equal(markdown.includes('### Applications'), false);
  });
}

async function testBusinessContributorSeesOwnedApplicationsOnly() {
  await inRolledBackTransaction(async (runner) => {
    const s = await seedRich(runner, 'rec-bc');
    const { records, report, markdowns } = await harness(runner);
    const opts = {
      manager: runner.manager,
      tenantId: s.tenantId,
      userId: s.contributorId,
      viewer: { userId: s.contributorId, isAdmin: false },
      applications: true,
      applicationScope: { userId: s.contributorId },
    };
    const record = await records.load(s.incidentId, opts);
    assert.equal(record.applications?.length, 1);
    assert.equal(record.applications?.[0].id, s.apps.owned);

    await report.exportPdf(s.incidentId, 'en', opts);
    const markdown = markdowns[0];
    assert.ok(markdown.includes('### Applications'));
    assert.ok(markdown.includes('Owned app'));
    assert.equal(markdown.includes('Alpha app'), false, 'the application outside the contributor scope is never printed');
  });
}

async function testConfidentialIncidentStaysHidden() {
  await inRolledBackTransaction(async (runner) => {
    const s = await seedRich(runner, 'rec-secret');
    await runner.query(
      `UPDATE incidents SET confidential = true, reporter_user_id = $2, owner_user_id = $2 WHERE id = $1`,
      [s.incidentId, s.userId],
    );
    const { records } = await harness(runner);
    const strangerId = randomUUID();
    await assert.rejects(
      () => records.load(s.incidentId, {
        manager: runner.manager,
        tenantId: s.tenantId,
        userId: strangerId,
        viewer: { userId: strangerId, isAdmin: false },
        technologies: true,
        applications: true,
        tasks: true,
      }),
      /not found/i,
    );
  });
}

void runSpecs('incident-record-rights', [
  ['an administrator reads every linked section', testAdministratorGetsEverySection],
  ['a reader without the module rights gets no section and no error', testReaderWithoutModuleRightsGetsNoSection],
  ['each section follows its own module read', testSectionsFollowTheirOwnModuleRead],
  ['a business contributor sees only their applications', testBusinessContributorSeesOwnedApplicationsOnly],
  ['a confidential incident stays hidden', testConfidentialIncidentStaysHidden],
]);
