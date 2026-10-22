// @database-spec
import 'reflect-metadata';
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import { REQUIRE_LEVEL_KEY } from '../../auth/require-level.decorator';
import { IncidentsController } from '../incidents.controller';
import { Incident } from '../incident.entity';
import { INCIDENT_LOCKED_MESSAGE } from '../incident-visibility';
import { IncidentRelationsService } from '../services/incident-relations.service';
import { IncidentsService } from '../services/incidents.service';
import { assert, captureAudit, inRolledBackTransaction, runSpecs, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';

// GET/POST/DELETE /incidents/:id/relations, on an empty migrated database: the tab in one round
// trip, one link at a time with the incident journal and the audit, suggestions, the badge,
// and a record of another tenant.

const READ = { incidents: 'reader', infrastructure: 'reader', applications: 'reader' };
const WRITE = { ...READ, incidents: 'contributor' };

type Ref = { id: string; reference: string };

type Rich = {
  tenantId: string;
  userId: string;
  contributorId: string;
  strangerId: string;
  incidentId: string;
  incidentRef: string;
  apps: { alpha: Ref; owned: Ref };
  assets: { alpha: Ref; beta: Ref; bare: Ref };
  techs: { onAsset: Ref; onApp: Ref; both: Ref; linked: Ref; spare: Ref };
};

function harness(runner: QueryRunner, audit = captureAudit()) {
  const repo = runner.manager.getRepository(Incident);
  const relations = new IncidentRelationsService(repo, audit as any);
  const svc = new IncidentsService(repo, audit as any, null as any, null as any);
  const args: any[] = Array.from({ length: 12 }, () => undefined);
  args[0] = svc;
  args[2] = relations;
  return { audit, http: new (IncidentsController as any)(...args) as IncidentsController };
}

function ctx(runner: QueryRunner, tenantId: string, permissions: Record<string, string>, userId: string | null) {
  return {
    tenantId,
    userId,
    isAdmin: false,
    permissions,
    manager: runner.manager,
    queryRunner: { manager: runner.manager },
  } as any;
}

async function refusal(fn: () => Promise<unknown>): Promise<{ error: Error; message: string; body: unknown }> {
  try {
    await fn();
  } catch (err) {
    const error = err as Error & { getResponse?: () => unknown };
    const body = typeof error.getResponse === 'function' ? error.getResponse() : undefined;
    const fromBody = body && typeof body === 'object' && body !== null && 'message' in body
      ? String((body as { message: unknown }).message)
      : '';
    return { error, message: fromBody || error.message, body };
  }
  throw new Error('expected a refusal');
}

async function linkChanges(runner: QueryRunner, incidentId: string): Promise<Array<{ content: string; changed_fields: any }>> {
  return runner.query(
    `SELECT content, changed_fields FROM incident_entries
      WHERE incident_id = $1 AND kind = 'link_change' ORDER BY occurred_at, id`,
    [incidentId],
  );
}

async function seedRich(runner: QueryRunner, tag: string): Promise<Rich> {
  const tenantId = await seedTenant(runner, tag);
  const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0];
  const memberRole = (await one(`INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Member') RETURNING id`, [tenantId])).id as string;
  const contributorRole = (await one(
    `INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Business Contributor') RETURNING id`,
    [tenantId],
  )).id as string;
  const user = (email: string, roleId: string, first: string, last: string) => one(
    `INSERT INTO users (tenant_id, email, role_id, first_name, last_name) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenantId, email, roleId, first, last],
  ).then((row) => row.id as string);
  const stamp = tenantId.slice(0, 8);
  const userId = await user(`inc-${tag}-${stamp}@example.test`, memberRole, 'Ada', 'Martin');
  const contributorId = await user(`inc-${tag}-bc-${stamp}@example.test`, contributorRole, 'Luc', 'Bernard');
  const strangerId = await user(`inc-${tag}-st-${stamp}@example.test`, memberRole, 'Noa', 'Petit');
  const incident = await one(
    `INSERT INTO incidents (tenant_id, item_number, title, severity, reporter_user_id)
     VALUES ($1, 4, $2, 'major', $3) RETURNING id`,
    [tenantId, `Outage ${tag}`, userId],
  );

  const application = async (name: string, criticality: string) => {
    const row = await one(
      `INSERT INTO applications (tenant_id, name, lifecycle, criticality, status)
       VALUES ($1, $2, 'active', $3, 'enabled') RETURNING id, sequential_id AS reference`,
      [tenantId, name, criticality],
    );
    return { id: row.id as string, reference: row.reference as string };
  };
  const alpha = await application('Alpha app', 'high');
  const owned = await application('Owned app', 'low');
  await runner.query(
    `INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type) VALUES ($1, $2, $3, 'business')`,
    [tenantId, owned.id, contributorId],
  );

  const asset = async (name: string, kind: string, environment: string) => {
    const row = await one(
      `INSERT INTO assets (tenant_id, name, kind, environment, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'active', now(), now()) RETURNING id, asset_reference AS reference`,
      [tenantId, name, kind, environment],
    );
    return { id: row.id as string, reference: row.reference as string };
  };
  const assetAlpha = await asset('Alpha srv', 'physical_server', 'prod');
  const assetBeta = await asset('Beta srv', 'virtual_machine', 'test');
  const assetBare = await asset('Bare srv', 'physical_server', 'prod');

  await runner.query(
    `INSERT INTO incident_assets (tenant_id, incident_id, asset_id) VALUES ($1, $2, $3), ($1, $2, $4)`,
    [tenantId, incident.id, assetAlpha.id, assetBeta.id],
  );
  await runner.query(
    `INSERT INTO incident_applications (tenant_id, incident_id, application_id) VALUES ($1, $2, $3), ($1, $2, $4)`,
    [tenantId, incident.id, alpha.id, owned.id],
  );

  const tech = async (n: number, name: string, editor: string | null) => {
    const row = await one(
      `INSERT INTO technologies (tenant_id, item_number, name, family, editor) VALUES ($1, $2, $3, 'database', $4) RETURNING id`,
      [tenantId, n, name, editor],
    );
    return { id: row.id as string, reference: `TEC-${n}` };
  };
  const onAsset = await tech(1, 'On asset', 'Microsoft');
  const onApp = await tech(2, 'On application', null);
  const both = await tech(3, 'Shared stack', 'Oracle');
  const linked = await tech(4, 'Already linked', 'VMware');
  const spare = await tech(5, 'Unlinked host', 'Debian');
  await runner.query(
    `INSERT INTO asset_technologies (tenant_id, asset_id, technology_id) VALUES
       ($1, $2, $3), ($1, $4, $5), ($1, $2, $6), ($1, $7, $8)`,
    [tenantId, assetAlpha.id, onAsset.id, assetBeta.id, both.id, linked.id, assetBare.id, spare.id],
  );
  await runner.query(
    `INSERT INTO application_technologies (tenant_id, application_id, technology_id) VALUES ($1, $2, $3), ($1, $2, $4)`,
    [tenantId, alpha.id, onApp.id, both.id],
  );
  await runner.query(
    `INSERT INTO incident_technologies (tenant_id, incident_id, technology_id) VALUES ($1, $2, $3)`,
    [tenantId, incident.id, linked.id],
  );

  return {
    tenantId,
    userId,
    contributorId,
    strangerId,
    incidentId: incident.id as string,
    incidentRef: 'INC-4',
    apps: { alpha, owned },
    assets: { alpha: assetAlpha, beta: assetBeta, bare: assetBare },
    techs: { onAsset, onApp, both, linked, spare },
  };
}

async function testPayload() {
  await inRolledBackTransaction(async (runner) => {
    const s = await seedRich(runner, 'incr-payload');
    assert.ok(s.apps.alpha.reference < s.assets.beta.reference, 'the shared technology prefers the application reference');
    const { http } = harness(runner);
    const caller = ctx(runner, s.tenantId, READ, s.userId);
    const body = await http.getRelations(s.incidentRef, caller) as any;
    const again = await http.getRelations(s.incidentId, caller) as any;
    assert.equal(again.assets.length, body.assets.length);

    assert.equal(body.editable, true);
    assert.deepEqual(body.assets.map((row: Ref) => row.reference), [s.assets.alpha.reference, s.assets.beta.reference]);
    assert.deepEqual(body.assets[0], {
      id: s.assets.alpha.id,
      reference: s.assets.alpha.reference,
      name: 'Alpha srv',
      kind: 'physical_server',
      environment: 'prod',
      status: 'active',
    });
    assert.deepEqual(body.applications.map((row: Ref) => row.reference), [s.apps.alpha.reference, s.apps.owned.reference]);
    assert.deepEqual(body.applications[0], {
      id: s.apps.alpha.id,
      reference: s.apps.alpha.reference,
      name: 'Alpha app',
      lifecycle: 'active',
      business_criticality: 'high',
      status: 'enabled',
    });
    assert.deepEqual(body.technologies, [{
      id: s.techs.linked.id,
      reference: s.techs.linked.reference,
      name: 'Already linked',
      family: 'database',
      vendor: 'VMware',
    }]);
    assert.deepEqual(body.suggestions.map((row: { name: string }) => row.name), ['On application', 'On asset', 'Shared stack']);
    const via = Object.fromEntries(body.suggestions.map((row: any) => [row.name, row.via]));
    assert.deepEqual(via['On asset'], { kind: 'asset_technology', label: s.assets.alpha.reference });
    assert.deepEqual(via['On application'], { kind: 'application_technology', label: s.apps.alpha.reference });
    assert.deepEqual(via['Shared stack'], { kind: 'application_technology', label: s.apps.alpha.reference });
    assert.equal(body.suggestions.find((row: any) => row.name === 'On application').vendor, null);
    assert.deepEqual(body.suggestions.map((row: { reference: string }) => row.reference), ['TEC-2', 'TEC-1', 'TEC-3']);
  });
}

async function testSectionsFollowTheRead() {
  await inRolledBackTransaction(async (runner) => {
    const s = await seedRich(runner, 'incr-read');
    const { http } = harness(runner);
    const hidden = await http.getRelations(s.incidentId, ctx(runner, s.tenantId, { incidents: 'reader' }, s.userId)) as any;
    assert.equal(hidden.assets, null);
    assert.equal(hidden.applications, null);
    assert.equal(hidden.technologies, null);
    assert.deepEqual(hidden.suggestions, []);

    const infra = await http.getRelations(s.incidentId, ctx(runner, s.tenantId, { incidents: 'reader', infrastructure: 'reader' }, s.userId)) as any;
    assert.equal(infra.assets.length, 2);
    assert.equal(infra.applications, null);
    assert.equal(infra.technologies.length, 1);
    assert.deepEqual(infra.suggestions.map((row: { name: string }) => row.name), ['On asset', 'Shared stack']);
    assert.deepEqual(infra.suggestions.find((row: any) => row.name === 'Shared stack').via, {
      kind: 'asset_technology',
      label: s.assets.beta.reference,
    });

    const apps = await http.getRelations(s.incidentId, ctx(runner, s.tenantId, { incidents: 'reader', applications: 'reader' }, s.userId)) as any;
    assert.equal(apps.assets, null);
    assert.equal(apps.technologies, null);
    assert.equal(apps.applications.length, 2);
    assert.deepEqual(apps.suggestions, []);
  });
}

async function testContributorSeesOwnedApplications() {
  await inRolledBackTransaction(async (runner) => {
    const s = await seedRich(runner, 'incr-bc');
    const { http } = harness(runner);
    const caller = ctx(runner, s.tenantId, READ, s.contributorId);
    const body = await http.getRelations(s.incidentId, caller) as any;
    assert.deepEqual(body.applications.map((row: Ref) => row.reference), [s.apps.owned.reference]);
    const shared = body.suggestions.find((row: any) => row.name === 'Shared stack');
    assert.deepEqual(shared.via, { kind: 'asset_technology', label: s.assets.beta.reference });
    assert.equal(body.suggestions.some((row: any) => row.name === 'On application'), false);
    const detail = await http.get(s.incidentId, caller) as any;
    assert.equal(detail.counts.applications, body.applications.length);
    assert.equal(detail.counts.assets, body.assets.length);
    assert.equal(detail.counts.technologies, body.technologies.length);
  });
}

async function testContributorWritesOwnedApplicationsOnly() {
  await inRolledBackTransaction(async (runner) => {
    const s = await seedRich(runner, 'incr-bcw');
    const { http } = harness(runner);
    const caller = ctx(runner, s.tenantId, WRITE, s.contributorId);
    // Alpha is linked but outside the contributor's applications: it reads as missing and stays linked.
    const hidden = await refusal(() => http.unlinkRelation(s.incidentId, 'applications', s.apps.alpha.id, caller));
    assert.ok(hidden.error instanceof NotFoundException);
    assert.equal(hidden.message, 'Application not found.');
    const admin = ctx(runner, s.tenantId, WRITE, s.userId);
    const body = await http.getRelations(s.incidentId, admin) as any;
    assert.ok(body.applications.some((row: Ref) => row.id === s.apps.alpha.id));
  });
}

async function testClosedIncidentHasNothingToLink() {
  await inRolledBackTransaction(async (runner) => {
    const s = await seedRich(runner, 'incr-closed');
    const { http } = harness(runner);
    const caller = ctx(runner, s.tenantId, WRITE, s.userId);
    for (const status of ['closed', 'cancelled']) {
      await runner.query(`UPDATE incidents SET status = $2 WHERE id = $1`, [s.incidentId, status]);
      const body = await http.getRelations(s.incidentId, caller) as any;
      assert.equal(body.editable, false, status);
      assert.deepEqual(body.suggestions, [], status);
      assert.equal(body.assets.length, 2, status);
      const refused = await refusal(() => http.linkRelation(s.incidentId, 'assets', { id: s.assets.bare.id }, caller));
      assert.ok(refused.error instanceof ForbiddenException, status);
      assert.equal(refused.message, INCIDENT_LOCKED_MESSAGE, status);
    }
    const [{ n }] = await runner.query(
      `SELECT count(*)::int AS n FROM incident_assets WHERE tenant_id = $1 AND incident_id = $2`,
      [s.tenantId, s.incidentId],
    );
    assert.equal(n, 2, 'the closed write linked nothing');
    assert.equal((await linkChanges(runner, s.incidentId)).length, 0);
  });
}

async function testSuggestionsAreCapped() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'incr-cap');
    const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0];
    const incidentId = (await one(
      `INSERT INTO incidents (tenant_id, item_number, title, severity) VALUES ($1, 1, 'Cap', 'minor') RETURNING id`,
      [tenantId],
    )).id as string;
    const host = await one(
      `INSERT INTO assets (tenant_id, name, kind, environment, status, created_at, updated_at)
       VALUES ($1, 'Host', 'physical_server', 'prod', 'active', now(), now()) RETURNING id`,
      [tenantId],
    );
    const other = await one(
      `INSERT INTO assets (tenant_id, name, kind, environment, status, created_at, updated_at)
       VALUES ($1, 'Other', 'physical_server', 'prod', 'active', now(), now()) RETURNING id`,
      [tenantId],
    );
    await runner.query(`INSERT INTO incident_assets (tenant_id, incident_id, asset_id) VALUES ($1, $2, $3)`, [tenantId, incidentId, host.id]);
    const tech = async (n: number, name: string) => (await one(
      `INSERT INTO technologies (tenant_id, item_number, name, family) VALUES ($1, $2, $3, 'database') RETURNING id`,
      [tenantId, n, name],
    )).id as string;
    for (let n = 1; n <= 21; n += 1) {
      const id = await tech(n, `Tech ${String(n).padStart(2, '0')}`);
      await runner.query(
        `INSERT INTO asset_technologies (tenant_id, asset_id, technology_id) VALUES ($1, $2, $3)`,
        [tenantId, host.id, id],
      );
    }
    const already = await tech(22, 'Tech 00');
    await runner.query(`INSERT INTO asset_technologies (tenant_id, asset_id, technology_id) VALUES ($1, $2, $3)`, [tenantId, host.id, already]);
    await runner.query(`INSERT INTO incident_technologies (tenant_id, incident_id, technology_id) VALUES ($1, $2, $3)`, [tenantId, incidentId, already]);
    const aside = await tech(23, 'Tech 99');
    await runner.query(`INSERT INTO asset_technologies (tenant_id, asset_id, technology_id) VALUES ($1, $2, $3)`, [tenantId, other.id, aside]);

    const { http } = harness(runner);
    const body = await http.getRelations(incidentId, ctx(runner, tenantId, READ, null)) as any;
    assert.deepEqual(
      body.suggestions.map((row: { name: string }) => row.name),
      Array.from({ length: 20 }, (_, i) => `Tech ${String(i + 1).padStart(2, '0')}`),
    );

    await runner.query(`UPDATE assets SET asset_reference = NULL WHERE id = $1`, [host.id]);
    const blank = await http.getRelations(incidentId, ctx(runner, tenantId, READ, null)) as any;
    assert.deepEqual(blank.suggestions, [], 'a source with no reference suggests nothing');
  });
}

async function testWrites() {
  await inRolledBackTransaction(async (runner) => {
    const s = await seedRich(runner, 'incr-write');
    const audit = captureAudit();
    const { http } = harness(runner, audit);
    const caller = ctx(runner, s.tenantId, WRITE, s.userId);
    const incidentsOnly = ctx(runner, s.tenantId, { incidents: 'contributor' }, s.userId);

    const unknown = await refusal(() => http.linkRelation(s.incidentId, 'contacts', { id: 'nope' }, incidentsOnly));
    assert.ok(unknown.error instanceof NotFoundException);
    assert.equal(unknown.message, 'Unknown relation type.');

    const early = await refusal(() => http.linkRelation(s.incidentId, 'assets', { id: 'nope' }, incidentsOnly));
    assert.ok(early.error instanceof ForbiddenException);
    assert.equal(early.message, 'You cannot read this module.');
    const techs = await refusal(() => http.unlinkRelation(s.incidentId, 'technologies', 'nope', incidentsOnly));
    assert.equal(techs.message, 'You cannot read technologies.');

    const badId = await refusal(() => http.linkRelation(s.incidentId, 'assets', { id: 'nope' }, caller));
    assert.ok(badId.error instanceof BadRequestException);
    assert.equal(badId.message, 'Invalid id.');
    const missingIncident = await refusal(() => http.linkRelation(randomUUID(), 'assets', { id: 'nope' }, caller));
    assert.equal(missingIncident.message, 'Invalid id.');

    const missing = await refusal(() => http.linkRelation(s.incidentId, 'assets', { id: randomUUID() }, caller));
    assert.ok(missing.error instanceof NotFoundException);
    assert.equal(missing.message, 'Asset not found.');
    assert.equal((await refusal(() => http.linkRelation(s.incidentId, 'applications', { id: randomUUID() }, caller))).message, 'Application not found.');
    assert.equal((await refusal(() => http.linkRelation(s.incidentId, 'technologies', { id: randomUUID() }, caller))).message, 'Technology not found.');
    const gone = await refusal(() => http.linkRelation(randomUUID(), 'assets', { id: s.assets.bare.id }, caller));
    assert.deepEqual(gone.body, { code: 'INCIDENT_NOT_FOUND', message: 'Incident not found' });

    await runner.query(`UPDATE incidents SET status = 'closed' WHERE id = $1`, [s.incidentId]);
    const closedId = await refusal(() => http.linkRelation(s.incidentId, 'assets', { id: 'nope' }, caller));
    assert.equal(closedId.message, 'Invalid id.');
    await runner.query(`UPDATE incidents SET status = 'open' WHERE id = $1`, [s.incidentId]);

    const untouched = await http.unlinkRelation(s.incidentId, 'assets', s.assets.bare.id, caller) as any;
    assert.equal(untouched.changed, false);
    assert.equal((await linkChanges(runner, s.incidentId)).length, 0);
    assert.equal(audit.entries.length, 0);

    const linked = await http.linkRelation(s.incidentId, 'assets', { id: ` ${s.assets.bare.id.toUpperCase()} ` }, caller) as any;
    assert.deepEqual(linked, { ok: true, changed: true });
    const [journal] = await linkChanges(runner, s.incidentId);
    assert.equal(journal.content, `Assets linked: ${s.assets.bare.reference}.`);
    assert.deepEqual(journal.changed_fields.assets, { from: [s.assets.alpha.reference, s.assets.beta.reference], to: [s.assets.alpha.reference, s.assets.bare.reference, s.assets.beta.reference] });
    assert.deepEqual(audit.entries.at(-1), {
      table: 'incident_assets',
      recordId: s.incidentId,
      action: 'update',
      before: [s.assets.alpha.id, s.assets.beta.id],
      after: [s.assets.alpha.id, s.assets.bare.id, s.assets.beta.id],
      userId: s.userId,
    });

    const again = await http.linkRelation(s.incidentId, 'assets', { id: s.assets.bare.id }, caller) as any;
    assert.equal(again.changed, false);
    assert.equal((await linkChanges(runner, s.incidentId)).length, 1);
    assert.equal(audit.entries.length, 1);

    const removed = await http.unlinkRelation(s.incidentId, 'assets', s.assets.bare.id, caller) as any;
    assert.equal(removed.changed, true);
    assert.equal((await linkChanges(runner, s.incidentId)).at(-1)?.content, `Assets unlinked: ${s.assets.bare.reference}.`);
    const still = await http.unlinkRelation(s.incidentId, 'assets', s.assets.bare.id, caller) as any;
    assert.equal(still.changed, false);

    const app = await http.linkRelation(s.incidentId, 'applications', { id: s.apps.alpha.id }, caller) as any;
    assert.equal(app.changed, false, 'the application was already linked');
    const spareApp = (await runner.query(
      `INSERT INTO applications (tenant_id, name) VALUES ($1, 'Spare app') RETURNING id, sequential_id AS reference`,
      [s.tenantId],
    ))[0];
    const addedApp = await http.linkRelation(s.incidentId, 'applications', { id: spareApp.id }, caller) as any;
    assert.equal(addedApp.changed, true);
    assert.equal((await linkChanges(runner, s.incidentId)).at(-1)?.content, `Applications linked: ${spareApp.reference}.`);
    assert.equal(audit.entries.at(-1)?.table, 'incident_applications');

    const spareTech = (await runner.query(
      `INSERT INTO technologies (tenant_id, item_number, name, family) VALUES ($1, 9, 'Spare tech', 'database') RETURNING id`,
      [s.tenantId],
    ))[0];
    const addedTech = await http.linkRelation(s.incidentId, 'technologies', { id: spareTech.id }, caller) as any;
    assert.equal(addedTech.changed, true);
    assert.equal((await linkChanges(runner, s.incidentId)).at(-1)?.content, 'Technologies linked: TEC-9.');
    assert.equal(audit.entries.at(-1)?.table, 'incident_technologies');

    const appsOnly = ctx(runner, s.tenantId, { incidents: 'contributor', applications: 'reader' }, s.userId);
    const assetRefused = await refusal(() => http.linkRelation(s.incidentId, 'assets', { id: s.assets.bare.id }, appsOnly));
    assert.equal(assetRefused.message, 'You cannot read this module.');
    const infraOnly = ctx(runner, s.tenantId, { incidents: 'contributor', infrastructure: 'reader' }, s.userId);
    const appRefused = await refusal(() => http.unlinkRelation(s.incidentId, 'applications', spareApp.id, infraOnly));
    assert.equal(appRefused.message, 'You cannot read this module.');
    const [{ apps }] = await runner.query(
      `SELECT count(*)::int AS apps FROM incident_applications WHERE tenant_id = $1 AND incident_id = $2 AND application_id = $3`,
      [s.tenantId, s.incidentId, spareApp.id],
    );
    assert.equal(apps, 1, 'the refusal left the application link');
  });
}

async function testConfidentialIncidentStaysHidden() {
  await inRolledBackTransaction(async (runner) => {
    const s = await seedRich(runner, 'incr-secret');
    await runner.query(
      `UPDATE incidents SET confidential = true, reporter_user_id = $2, owner_user_id = $2 WHERE id = $1`,
      [s.incidentId, s.userId],
    );
    const { http } = harness(runner);
    const stranger = ctx(runner, s.tenantId, WRITE, s.strangerId);
    const hidden = await refusal(() => http.getRelations(s.incidentId, stranger));
    assert.deepEqual(hidden.body, { code: 'INCIDENT_NOT_FOUND', message: 'Incident not found' });
    const refused = await refusal(() => http.linkRelation(s.incidentId, 'assets', { id: s.assets.bare.id }, stranger));
    assert.deepEqual(refused.body, { code: 'INCIDENT_NOT_FOUND', message: 'Incident not found' });
    const owner = ctx(runner, s.tenantId, WRITE, s.userId);
    const body = await http.getRelations(s.incidentId, owner) as any;
    assert.equal(body.assets.length, 2);
    const linked = await http.linkRelation(s.incidentId, 'assets', { id: s.assets.bare.id }, owner) as any;
    assert.equal(linked.changed, true);
  });
}

async function testTenantIsolation() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seedRich(runner, 'incr-iso-a');
    const bTenant = await seedTenant(runner, 'incr-iso-b');
    const bIncident = (await runner.query(
      `INSERT INTO incidents (tenant_id, item_number, title, severity) VALUES ($1, 1, 'Other', 'minor') RETURNING id`,
      [bTenant],
    ))[0].id as string;
    const bAsset = (await runner.query(
      `INSERT INTO assets (tenant_id, name, kind, environment, status, created_at, updated_at)
       VALUES ($1, 'Foreign', 'physical_server', 'prod', 'active', now(), now()) RETURNING id`,
      [bTenant],
    ))[0].id as string;

    const { http } = harness(runner);
    await setTenant(runner, bTenant);
    const missing = await refusal(() => http.getRelations(a.incidentId, ctx(runner, bTenant, READ, null)));
    assert.deepEqual(missing.body, { code: 'INCIDENT_NOT_FOUND', message: 'Incident not found' });
    const ontoB = await refusal(() => http.linkRelation(bIncident, 'assets', { id: a.assets.alpha.id }, ctx(runner, bTenant, WRITE, null)));
    assert.equal(ontoB.message, 'Asset not found.');
    const [{ onB }] = await runner.query(`SELECT count(*)::int AS "onB" FROM incident_assets WHERE tenant_id = $1`, [bTenant]);
    assert.equal(onB, 0);

    await setTenant(runner, a.tenantId);
    const ontoA = await refusal(() => http.linkRelation(a.incidentId, 'assets', { id: bAsset }, ctx(runner, a.tenantId, WRITE, a.userId)));
    assert.equal(ontoA.message, 'Asset not found.');
    const [{ onA }] = await runner.query(
      `SELECT count(*)::int AS "onA" FROM incident_assets WHERE tenant_id = $1 AND incident_id = $2`,
      [a.tenantId, a.incidentId],
    );
    assert.equal(onA, 2);
  });
}

async function testRouteLevels() {
  const proto = IncidentsController.prototype as any;
  assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, proto.getRelations), { resource: 'incidents', level: 'reader' });
  assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, proto.linkRelation), { resource: 'incidents', level: 'contributor' });
  assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, proto.unlinkRelation), { resource: 'incidents', level: 'contributor' });
  const methods = Object.getOwnPropertyNames(IncidentsController.prototype);
  assert.ok(methods.indexOf('bulkReplaceApplications') < methods.indexOf('getRelations'), 'relations after the fixed link routes');
  assert.ok(methods.indexOf('getRelations') < methods.indexOf('get'), 'relations before :id');
}

void runSpecs('incident-relations-tab', [
  ['route levels', testRouteLevels],
  ['the tab lists assets, applications, technologies and suggestions', testPayload],
  ['a section is null without the module read', testSectionsFollowTheRead],
  ['a business contributor sees the applications they take part in', testContributorSeesOwnedApplications],
  ['a business contributor links and unlinks only the applications they take part in', testContributorWritesOwnedApplicationsOnly],
  ['a closed incident is not editable and suggests nothing', testClosedIncidentHasNothingToLink],
  ['suggestions keep twenty technologies and a referenced source', testSuggestionsAreCapped],
  ['one link writes the journal and the audit, and the refusals write nothing', testWrites],
  ['a confidential incident stays hidden', testConfidentialIncidentStaysHidden],
  ['another tenant cannot read or link the incident', testTenantIsolation],
]);
