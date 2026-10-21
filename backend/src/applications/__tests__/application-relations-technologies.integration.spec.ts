// @database-spec
import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { QueryRunner } from 'typeorm';
import { ApplicationsCrudService } from '../services/applications-crud.service';
import {
  ALL_ACCESS, ALL_WRITES, context, inRolledBackTransaction, relationsService, runSpecs, seedRelations,
  type AuditEntry, type RelationsSeed,
} from './application-relations.fixtures';

// The technologies and business processes of the Relations tab (lot T2a): the two sections of
// GET /applications/:id/relations, and the single link and unlink of POST / DELETE
// /applications/:id/relations/technologies|processes, written by the technology layer.

type TechSeed = RelationsSeed & {
  tech: { sql: string; vsphere: string; tomcat: string; java: string; elsewhere: string };
  servers: { etl1: string; etl2: string; esx: string };
  processes: { linked: string; free: string };
};

/**
 * On the relations tenant: SQL Server 2019 (support ended) installed on `srv-etl-1`, vSphere 8 on
 * the host `esx` that contains `srv-etl-2`, Tomcat (no version) installed on `srv-etl-1` and
 * declared, Java declared only, and Redis installed on a server the application does not use.
 * One business process linked (owned by Claire Dubois), one free.
 */
async function seedTechnologies(runner: QueryRunner, tag: string): Promise<TechSeed> {
  const seed = await seedRelations(runner, tag);
  const t = seed.tenantId;
  const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0].id as string;
  const server = async (name: string) => one(`SELECT id FROM assets WHERE tenant_id = $1 AND name = $2`, [t, `${name}-${tag}`]);
  const asset = (name: string) => one(`INSERT INTO assets (tenant_id, name, kind, environment) VALUES ($1, $2, 'vm', 'prod') RETURNING id`, [t, name]);
  const technology = (n: number, name: string, family: string) =>
    one(`INSERT INTO technologies (tenant_id, item_number, name, family) VALUES ($1, $2, $3, $4) RETURNING id`, [t, n, name, family]);
  const version = (tech: string, label: string, end: string | null) =>
    one(`INSERT INTO technology_versions (tenant_id, technology_id, label, standard_support_end) VALUES ($1, $2, $3, $4) RETURNING id`, [t, tech, label, end]);
  const install = (assetId: string, tech: string, versionId: string | null) =>
    runner.query(`INSERT INTO asset_technologies (tenant_id, asset_id, technology_id, technology_version_id) VALUES ($1, $2, $3, $4)`, [t, assetId, tech, versionId]);
  const declare = (tech: string) =>
    runner.query(`INSERT INTO application_technologies (tenant_id, application_id, technology_id) VALUES ($1, $2, $3)`, [t, seed.appId, tech]);

  const servers = { etl1: await server('srv-etl-1'), etl2: await server('srv-etl-2'), esx: await asset(`esx-${tag}`) };
  const other = await asset(`srv-cache-${tag}`);
  await runner.query(`INSERT INTO asset_relations (tenant_id, asset_id, related_asset_id, relation_type) VALUES ($1, $2, $3, 'contains')`, [t, servers.esx, servers.etl2]);

  const tech = {
    sql: await technology(1, 'SQL Server', 'database'),
    vsphere: await technology(2, 'vSphere', 'virtualization'),
    tomcat: await technology(3, 'Tomcat', 'middleware'),
    java: await technology(4, 'Java', 'runtime'),
    elsewhere: await technology(5, 'Redis', 'database'),
  };
  await install(servers.etl1, tech.sql, await version(tech.sql, '2019', '2020-01-14'));
  await install(servers.esx, tech.vsphere, await version(tech.vsphere, '8', '2027-10-11'));
  await install(servers.etl1, tech.tomcat, null);
  await install(other, tech.elsewhere, null);
  await declare(tech.tomcat);
  await declare(tech.java);

  const bp = (name: string, owner: string | null) =>
    one(`INSERT INTO business_processes (tenant_id, name, owner_user_id) VALUES ($1, $2, $3) RETURNING id`, [t, name, owner]);
  const processes = { linked: await bp('Order to cash', seed.userId), free: await bp('Procure to pay', null) };
  await runner.query(`INSERT INTO application_business_processes (tenant_id, application_id, business_process_id) VALUES ($1, $2, $3)`, [t, seed.appId, processes.linked]);
  return { ...seed, tech, servers, processes };
}

async function testTechnologiesDeclaredAndHostedMerged() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTechnologies(runner, 'tech');
    const res = await relationsService().getRelations(seed.appId, context(runner.manager, seed));
    const rows = res.technologies ?? [];
    assert.deepEqual(rows.map((row) => [row.reference, row.name, row.declared, row.hosted]), [
      ['TEC-4', 'Java', true, false],
      ['TEC-1', 'SQL Server', false, true],
      ['TEC-3', 'Tomcat', true, true],
      ['TEC-2', 'vSphere', false, true],
    ], 'one row per technology, declared and hosted merged; Redis is on another server');
    const [java, sql, tomcat, vsphere] = rows;
    assert.deepEqual([java.id, sql.id, tomcat.id, vsphere.id], [seed.tech.java, seed.tech.sql, seed.tech.tomcat, seed.tech.vsphere]);
    assert.deepEqual(java.via, [], 'a declared row has no server');
    assert.equal(java.version_unknown, true);
    assert.deepEqual(sql.versions, ['2019']);
    assert.equal(sql.version_unknown, false);
    assert.equal(sql.standard_support_end, '2020-01-14');
    assert.equal(sql.family, 'database');
    assert.deepEqual(sql.via, [{ asset_id: seed.servers.etl1, asset_name: 'srv-etl-1-tech', host_name: null }]);
    assert.deepEqual(vsphere.via, [{ asset_id: seed.servers.etl2, asset_name: 'srv-etl-2-tech', host_name: 'esx-tech' }], 'carried by the host of the server');
    assert.deepEqual(tomcat.versions, []);
    assert.equal(tomcat.version_unknown, true);
    assert.deepEqual(tomcat.via.map((v) => v.asset_id), [seed.servers.etl1]);

    assert.deepEqual(res.processes, [{ id: seed.processes.linked, name: 'Order to cash', status: 'enabled', owner_name: 'Claire Dubois' }]);
  });
}

async function testSectionsNullWithoutReadRight() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTechnologies(runner, 'technull');
    const res = await relationsService().getRelations(seed.appId, context(runner.manager, seed, {
      access: { ...ALL_ACCESS, technologies: false, processes: false },
    }));
    assert.equal(res.technologies, null);
    assert.equal(res.processes, null);
    assert.ok(res.contracts, 'the other sections stay');
  });
}

async function testLinkAndUnlinkTechnology() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTechnologies(runner, 'techwrite');
    const audit: AuditEntry[] = [];
    const svc = relationsService({ audit });
    const ctx = context(runner.manager, seed);
    const declared = async () => (await runner.query(
      `SELECT technology_id FROM application_technologies WHERE tenant_id = $1 AND application_id = $2 ORDER BY technology_id`,
      [seed.tenantId, seed.appId],
    )).map((row: { technology_id: string }) => row.technology_id);

    assert.deepEqual(await svc.setLink('technologies', seed.appId, seed.tech.sql, true, ctx), { ok: true, changed: true });
    assert.deepEqual(await svc.setLink('technologies', seed.appId, seed.tech.sql, true, ctx), { ok: true, changed: false }, 'idempotent');
    assert.deepEqual(await svc.setLink('technologies', seed.appId, seed.tech.tomcat, false, ctx), { ok: true, changed: true });
    assert.deepEqual(await svc.setLink('technologies', seed.appId, seed.tech.tomcat, false, ctx), { ok: true, changed: false });
    assert.deepEqual(await declared(), [seed.tech.java, seed.tech.sql].sort());
    assert.deepEqual(audit.map((entry) => entry.table), ['application_technologies', 'application_technologies']);

    // Tomcat stays, hosted only; SQL Server is now declared and hosted.
    const rows = (await svc.getRelations(seed.appId, ctx)).technologies ?? [];
    const flags = Object.fromEntries(rows.map((row) => [row.name, [row.declared, row.hosted]]));
    assert.deepEqual(flags, { Java: [true, false], 'SQL Server': [true, true], Tomcat: [false, true], vSphere: [false, true] });
  });
}

async function testLinkAndUnlinkProcess() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTechnologies(runner, 'procwrite');
    const audit: AuditEntry[] = [];
    const svc = relationsService({ audit });
    const ctx = context(runner.manager, seed);
    assert.deepEqual(await svc.setLink('processes', seed.appId, seed.processes.free, true, ctx), { ok: true, changed: true });
    assert.deepEqual(await svc.setLink('processes', seed.appId, seed.processes.free, true, ctx), { ok: true, changed: false });
    assert.deepEqual(await svc.setLink('processes', seed.appId, seed.processes.linked, false, ctx), { ok: true, changed: true });
    const res = await svc.getRelations(seed.appId, ctx);
    assert.deepEqual(res.processes?.map((p) => [p.id, p.owner_name]), [[seed.processes.free, null]]);
    assert.deepEqual(audit.map((entry) => [entry.table, entry.recordId]), [
      ['application_business_processes', seed.processes.free],
      ['application_business_processes', seed.processes.linked],
    ]);
  });
}

async function testWriteRefusedWithoutTheRight() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTechnologies(runner, 'techdeny');
    const svc = relationsService();
    const readOnly = context(runner.manager, seed, { writes: { technologies: false, processes: false, incidents: true } });
    await assert.rejects(svc.setLink('technologies', seed.appId, seed.tech.sql, true, readOnly), ForbiddenException);
    await assert.rejects(svc.setLink('technologies', seed.appId, seed.tech.java, false, readOnly), ForbiddenException);
    await assert.rejects(svc.setLink('processes', seed.appId, seed.processes.free, true, readOnly), ForbiddenException);
    const noRead = context(runner.manager, seed, { access: { ...ALL_ACCESS, technologies: false, processes: false }, writes: ALL_WRITES });
    await assert.rejects(svc.setLink('technologies', seed.appId, seed.tech.sql, true, noRead), ForbiddenException);
    await assert.rejects(svc.setLink('processes', seed.appId, seed.processes.free, true, noRead), ForbiddenException);

    const [{ n }] = await runner.query(
      `SELECT (SELECT count(*) FROM application_technologies WHERE tenant_id = $1 AND application_id = $2)
            + (SELECT count(*) FROM application_business_processes WHERE tenant_id = $1 AND application_id = $2) AS n`,
      [seed.tenantId, seed.appId],
    );
    assert.equal(Number(n), 3, 'nothing changed');
  });
}

/**
 * A disabled application leaves the technology layer's views, but its own page still shows its
 * declarations (only them: its hostings are out of service) and can withdraw them. The `technologies`
 * field follows; the Relations badge does not.
 */
async function testDisabledApplicationKeepsItsDeclarations() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTechnologies(runner, 'techoff');
    await runner.query(`UPDATE applications SET status = 'disabled' WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, seed.appId]);
    const svc = relationsService();
    const ctx = context(runner.manager, seed);
    const crud = new ApplicationsCrudService(undefined as any, undefined as any, undefined as any, undefined as any, undefined as any);
    const shown = async () => ((await svc.getRelations(seed.appId, ctx)).technologies ?? []).map((row) => [row.name, row.declared, row.hosted]);

    assert.deepEqual(await shown(), [['Java', true, false], ['Tomcat', true, false]]);
    assert.equal((await crud.relationCounts(seed.appId, { manager: runner.manager })).technologies, 2);

    assert.deepEqual(await svc.setLink('technologies', seed.appId, seed.tech.java, false, ctx), { ok: true, changed: true });
    assert.deepEqual(await shown(), [['Tomcat', true, false]]);
    assert.equal((await crud.relationCounts(seed.appId, { manager: runner.manager })).technologies, 1);

    // A declaration with a version shows it and its end of support.
    const v2019: string = (await runner.query(`SELECT id FROM technology_versions WHERE tenant_id = $1 AND technology_id = $2`, [seed.tenantId, seed.tech.sql]))[0].id;
    await runner.query(
      `INSERT INTO application_technologies (tenant_id, application_id, technology_id, technology_version_id) VALUES ($1, $2, $3, $4)`,
      [seed.tenantId, seed.appId, seed.tech.sql, v2019],
    );
    const sql = ((await svc.getRelations(seed.appId, ctx)).technologies ?? []).find((row) => row.id === seed.tech.sql);
    assert.deepEqual([sql?.reference, sql?.versions, sql?.standard_support_end, sql?.declared, sql?.hosted], ['TEC-1', ['2019'], '2020-01-14', true, false]);
  });
}

/** A Business Contributor writes only on the applications of its participation scope. */
async function testBusinessContributorScope() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTechnologies(runner, 'techscope');
    const svc = relationsService();
    const scoped = context(runner.manager, seed, { scopes: { application: { userId: seed.userId } } });
    const isNotFound = (err: any) => err?.getStatus?.() === 404;
    await assert.rejects(svc.setLink('technologies', seed.appId, seed.tech.sql, true, scoped), isNotFound);
    await assert.rejects(svc.setLink('technologies', seed.appId, seed.tech.java, false, scoped), isNotFound);
    await assert.rejects(svc.setLink('processes', seed.appId, seed.processes.free, true, scoped), isNotFound);
    await assert.rejects(svc.setLink('processes', seed.appId, seed.processes.linked, false, scoped), isNotFound);
    const [{ n }] = await runner.query(
      `SELECT (SELECT count(*) FROM application_technologies WHERE tenant_id = $1 AND application_id = $2)
            + (SELECT count(*) FROM application_business_processes WHERE tenant_id = $1 AND application_id = $2) AS n`,
      [seed.tenantId, seed.appId],
    );
    assert.equal(Number(n), 3, 'nothing changed');

    // Once the user takes part in the application, the same writes go through.
    await runner.query(`INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type) VALUES ($1, $2, $3, 'it')`, [seed.tenantId, seed.appId, seed.userId]);
    assert.deepEqual(await svc.setLink('technologies', seed.appId, seed.tech.sql, true, scoped), { ok: true, changed: true });
    assert.deepEqual(await svc.setLink('processes', seed.appId, seed.processes.free, true, scoped), { ok: true, changed: true });
  });
}

/**
 * The Relations badge (`GET /applications/:id/relations-count`) leaves technologies out (the
 * Operations tab) and business processes (the properties panel, lot R1b); both fields stay.
 */
async function testBadgeLeavesOutTechnologies() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTechnologies(runner, 'techcount');
    const crud = new ApplicationsCrudService(undefined as any, undefined as any, undefined as any, undefined as any, undefined as any);
    const counts = await crud.relationCounts(seed.appId, { manager: runner.manager });
    assert.equal(counts.technologies, 2, 'the field still names the declared technologies; hosted ones are not in it');
    assert.equal(counts.processes, 1);
    assert.equal(counts.total, counts.opex + counts.capex + counts.contracts + counts.projects + counts.links + counts.attachments);
  });
}


type DeclarationRow = { technology_id: string; label: string | null };

/** The application's declarations of `technologyId`, by version label (null: unknown). */
async function declarationsOf(runner: QueryRunner, seed: TechSeed, technologyId: string): Promise<Array<string | null>> {
  const rows: DeclarationRow[] = await runner.query(
    `SELECT d.technology_id, v.label FROM application_technologies d
       LEFT JOIN technology_versions v ON v.tenant_id = d.tenant_id AND v.id = d.technology_version_id
      WHERE d.tenant_id = $1 AND d.application_id = $2 AND d.technology_id = $3 ORDER BY v.label NULLS FIRST`,
    [seed.tenantId, seed.appId, technologyId],
  );
  return rows.map((row) => row.label);
}

/** The installed links of `technologyId` on `assetId`, by version label (null: unknown). */
async function installedOn(runner: QueryRunner, seed: TechSeed, assetId: string, technologyId: string): Promise<Array<string | null>> {
  const rows: Array<{ label: string | null; source: string }> = await runner.query(
    `SELECT v.label, at.source FROM asset_technologies at
       LEFT JOIN technology_versions v ON v.tenant_id = at.tenant_id AND v.id = at.technology_version_id
      WHERE at.tenant_id = $1 AND at.asset_id = $2 AND at.technology_id = $3 ORDER BY v.label NULLS FIRST`,
    [seed.tenantId, assetId, technologyId],
  );
  return rows.map((row) => row.label);
}

/** The declaration names an existing version, a new label (created) or none, as the asset side does. */
async function testDeclareWithVersion() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTechnologies(runner, 'techver');
    const svc = relationsService();
    const ctx = context(runner.manager, seed);
    const v2019: string = (await runner.query(`SELECT id FROM technology_versions WHERE tenant_id = $1 AND technology_id = $2`, [seed.tenantId, seed.tech.sql]))[0].id;

    assert.deepEqual(await svc.setLink('technologies', seed.appId, seed.tech.sql, true, ctx, { technology_version_id: v2019 }), { ok: true, changed: true });
    assert.deepEqual(await declarationsOf(runner, seed, seed.tech.sql), ['2019']);

    assert.deepEqual(await svc.setLink('technologies', seed.appId, seed.tech.elsewhere, true, ctx, { version_label: ' 7.2 ' }), { ok: true, changed: true });
    assert.deepEqual(await declarationsOf(runner, seed, seed.tech.elsewhere), ['7.2'], 'the label typed is created as a version');
    assert.deepEqual(await svc.setLink('technologies', seed.appId, seed.tech.elsewhere, true, ctx, { version_label: '7.2' }), { ok: true, changed: false }, 'the same version again changes nothing');
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM technology_versions WHERE tenant_id = $1 AND technology_id = $2`, [seed.tenantId, seed.tech.elsewhere]);
    assert.equal(n, 1, 'the label is resolved without creating it twice');

    assert.deepEqual(await svc.setLink('technologies', seed.appId, seed.tech.vsphere, true, ctx, { technology_version_id: null }), { ok: true, changed: true });
    assert.deepEqual(await declarationsOf(runner, seed, seed.tech.vsphere), [null], 'version unknown');

    // A version of another technology is refused, and nothing is declared.
    await assert.rejects(svc.setLink('technologies', seed.appId, seed.tech.tomcat, true, ctx, { technology_version_id: v2019 }), BadRequestException);
    assert.deepEqual(await declarationsOf(runner, seed, seed.tech.tomcat), [null]);

    const sql = ((await svc.getRelations(seed.appId, ctx)).technologies ?? []).find((row) => row.id === seed.tech.sql);
    assert.deepEqual(sql?.declarations.map((d) => [d.technology_version_id, d.version_label]), [[v2019, '2019']], 'the declaration and its link');
    assert.ok(sql?.declarations[0].link_id);
  });
}

/** The deployment servers of the application, offered by the Operations tab: in service, with environment and role. */
async function testDeploymentServersListed() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTechnologies(runner, 'techsrv');
    const svc = relationsService();
    const ctx = context(runner.manager, seed);
    const listed = async () => ((await svc.getRelations(seed.appId, ctx)).deployment_servers ?? []).map((s) => [s.asset_id, s.name, s.environments, s.roles]);
    assert.deepEqual(await listed(), [
      [seed.servers.etl1, 'srv-etl-1-techsrv', ['prod'], ['app']],
      [seed.servers.etl2, 'srv-etl-2-techsrv', ['prod'], ['app']],
    ]);
    // A second role in a test instance: one row per server, every environment and role.
    const test: string = (await runner.query(`INSERT INTO app_instances (tenant_id, application_id, environment) VALUES ($1, $2, 'test') RETURNING id`, [seed.tenantId, seed.appId]))[0].id;
    await runner.query(`INSERT INTO app_asset_assignments (tenant_id, app_instance_id, asset_id, role) VALUES ($1, $2, $3, 'db')`, [seed.tenantId, test, seed.servers.etl1]);
    await runner.query(`UPDATE assets SET status = 'retired' WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, seed.servers.etl2]);
    assert.deepEqual(await listed(), [[seed.servers.etl1, 'srv-etl-1-techsrv', ['prod', 'test'], ['app', 'db']]], 'a retired server is not offered');

    const hidden = await svc.getRelations(seed.appId, context(runner.manager, seed, { access: { ...ALL_ACCESS, technologies: false } }));
    assert.equal(hidden.deployment_servers, null, 'null with the technologies');
  });
}

/**
 * The declaration records the technology at its version on the servers ticked, in the same call:
 * one manual link per server, audited, the vulnerabilities matched again; a server that already has
 * the technology keeps its link and is not doubled.
 */
async function testDeclareOnServers() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTechnologies(runner, 'techon');
    const audit: AuditEntry[] = [];
    const cpeEvents: string[] = [];
    const svc = relationsService({ audit, cpeEvents });
    const ctx = context(runner.manager, seed);

    const res = await svc.setLink('technologies', seed.appId, seed.tech.elsewhere, true, ctx, {
      version_label: '7.2', asset_ids: [seed.servers.etl2, seed.servers.etl1, seed.servers.etl1],
    });
    assert.deepEqual(res, { ok: true, changed: true, servers: { added: 2, skipped: 0 } });
    assert.deepEqual(await declarationsOf(runner, seed, seed.tech.elsewhere), ['7.2']);
    assert.deepEqual(await installedOn(runner, seed, seed.servers.etl1, seed.tech.elsewhere), ['7.2']);
    assert.deepEqual(await installedOn(runner, seed, seed.servers.etl2, seed.tech.elsewhere), ['7.2']);
    const [{ manual }] = await runner.query(
      `SELECT bool_and(source = 'manual') AS manual FROM asset_technologies WHERE tenant_id = $1 AND technology_id = $2 AND asset_id = ANY($3::uuid[])`,
      [seed.tenantId, seed.tech.elsewhere, [seed.servers.etl1, seed.servers.etl2]],
    );
    assert.equal(manual, true);
    assert.deepEqual(audit.map((entry) => [entry.table, entry.recordId]), [
      ['application_technologies', seed.tech.elsewhere],
      ['asset_technologies', seed.tech.elsewhere],
      ['asset_technologies', seed.tech.elsewhere],
    ]);
    assert.ok(cpeEvents.length >= 2 && cpeEvents.every((id) => id === seed.tech.elsewhere), 'the declaration and the servers are matched again');

    const redis = ((await svc.getRelations(seed.appId, ctx)).technologies ?? []).find((row) => row.id === seed.tech.elsewhere);
    assert.deepEqual([redis?.declared, redis?.hosted, redis?.via.map((v) => v.asset_id).sort()], [true, true, [seed.servers.etl1, seed.servers.etl2].sort()]);

    // Tomcat is installed on srv-etl-1 (version unknown): that link stays, srv-etl-2 receives 9.0.
    audit.length = 0;
    cpeEvents.length = 0;
    const tomcat = await svc.setLink('technologies', seed.appId, seed.tech.tomcat, true, ctx, {
      version_label: '9.0', asset_ids: [seed.servers.etl1, seed.servers.etl2],
    });
    assert.deepEqual(tomcat, { ok: true, changed: true, servers: { added: 1, skipped: 1 } });
    assert.deepEqual(await installedOn(runner, seed, seed.servers.etl1, seed.tech.tomcat), [null], 'not doubled, not changed');
    assert.deepEqual(await installedOn(runner, seed, seed.servers.etl2, seed.tech.tomcat), ['9.0']);
    assert.deepEqual(audit.map((entry) => entry.table), ['application_technologies', 'asset_technologies']);

    // Every server has it already: nothing is written on the servers.
    audit.length = 0;
    cpeEvents.length = 0;
    const again = await svc.setLink('technologies', seed.appId, seed.tech.elsewhere, true, ctx, { version_label: '7.2', asset_ids: [seed.servers.etl1] });
    assert.deepEqual(again, { ok: true, changed: false, servers: { added: 0, skipped: 1 } });
    assert.deepEqual(audit, []);
    assert.deepEqual(cpeEvents, []);
  });
}

/** A server that is not a deployment server of the application in service, in this tenant, is refused: nothing is written. */
async function testServersRefused() {
  await inRolledBackTransaction(async (runner) => {
    const elsewhere = await seedTechnologies(runner, 'techfar');
    const seed = await seedTechnologies(runner, 'technear');
    const svc = relationsService();
    const ctx = context(runner.manager, seed);
    const notDeployed: string = (await runner.query(`SELECT id FROM assets WHERE tenant_id = $1 AND name = $2`, [seed.tenantId, 'srv-cache-technear']))[0].id;
    const nothingWritten = async () => {
      const [{ d, a, v }] = await runner.query(
        `SELECT (SELECT count(*)::int FROM application_technologies WHERE tenant_id = $1 AND technology_id = $2) AS d,
                (SELECT count(*)::int FROM asset_technologies WHERE tenant_id = $1 AND technology_id = $2 AND asset_id <> $3) AS a,
                (SELECT count(*)::int FROM technology_versions WHERE tenant_id = $1 AND technology_id = $2) AS v`,
        [seed.tenantId, seed.tech.elsewhere, notDeployed],
      );
      assert.deepEqual([d, a, v], [0, 0, 0], 'no declaration, no link, no version');
    };
    const refused = async (assetIds: unknown) => {
      await assert.rejects(
        svc.setLink('technologies', seed.appId, seed.tech.elsewhere, true, ctx, { version_label: '7.2', asset_ids: assetIds }),
        BadRequestException,
      );
      await nothingWritten();
    };
    await refused([seed.servers.etl1, notDeployed]);
    await refused([elsewhere.servers.etl1]);
    await refused(['not-a-uuid']);
    await refused(seed.servers.etl1);
    await runner.query(`UPDATE assets SET status = 'retired' WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, seed.servers.etl2]);
    await refused([seed.servers.etl2]);

    // An operating system is marked from the server's page.
    const os: string = (await runner.query(
      `INSERT INTO technologies (tenant_id, item_number, name, family) VALUES ($1, 9, 'Debian', 'operating_system') RETURNING id`, [seed.tenantId],
    ))[0].id;
    await assert.rejects(svc.setLink('technologies', seed.appId, os, true, ctx, { asset_ids: [seed.servers.etl1] }), BadRequestException);
    assert.deepEqual(await declarationsOf(runner, seed, os), []);
    assert.deepEqual(await svc.setLink('technologies', seed.appId, os, true, ctx, { asset_ids: [] }), { ok: true, changed: true }, 'declared alone');
  });
}

/** The declaration and the server links are written in the caller's transaction: a failure leaves neither. */
async function testRolledBackTogether() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTechnologies(runner, 'techrb');
    const svc = relationsService({ failAuditOn: 'asset_technologies' });
    const ctx = context(runner.manager, seed);
    // The savepoint stands for the request's transaction, which the interceptor rolls back on an error.
    await runner.query('SAVEPOINT request');
    await assert.rejects(svc.setLink('technologies', seed.appId, seed.tech.elsewhere, true, ctx, {
      version_label: '7.2', asset_ids: [seed.servers.etl1],
    }), /audit of asset_technologies failed/);
    await runner.query('ROLLBACK TO SAVEPOINT request');
    assert.deepEqual(await declarationsOf(runner, seed, seed.tech.elsewhere), []);
    assert.deepEqual(await installedOn(runner, seed, seed.servers.etl1, seed.tech.elsewhere), []);
  });
}

/** Without the right to edit technologies, neither the declaration nor the servers are written. */
async function testServersNeedTheRight() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTechnologies(runner, 'techsrvdeny');
    const svc = relationsService();
    const readOnly = context(runner.manager, seed, { writes: { technologies: false, processes: true, incidents: true } });
    await assert.rejects(svc.setLink('technologies', seed.appId, seed.tech.elsewhere, true, readOnly, { asset_ids: [seed.servers.etl1] }), ForbiddenException);
    assert.deepEqual(await declarationsOf(runner, seed, seed.tech.elsewhere), []);
    assert.deepEqual(await installedOn(runner, seed, seed.servers.etl1, seed.tech.elsewhere), []);
  });
}

runSpecs('application-relations-technologies.integration.spec', [
  testTechnologiesDeclaredAndHostedMerged,
  testSectionsNullWithoutReadRight,
  testLinkAndUnlinkTechnology,
  testLinkAndUnlinkProcess,
  testWriteRefusedWithoutTheRight,
  testBadgeLeavesOutTechnologies,
  testDisabledApplicationKeepsItsDeclarations,
  testBusinessContributorScope,
  testDeclareWithVersion,
  testDeploymentServersListed,
  testDeclareOnServers,
  testServersRefused,
  testRolledBackTogether,
  testServersNeedTheRight,
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
