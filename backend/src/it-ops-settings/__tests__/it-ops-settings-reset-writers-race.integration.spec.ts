import 'dotenv/config';
import 'reflect-metadata';
import type { EntityManager } from 'typeorm';
import { Incident } from '../../incidents/incident.entity';
import { IncidentsService } from '../../incidents/services/incidents.service';
import { Location } from '../../locations/location.entity';
import { assert, assertSucceeded, progress, Race, runRaceSpecs, settle, sql, withRace } from '../../spend/__tests__/race-harness';
import { Tenant } from '../../tenants/tenant.entity';
import { TechnologiesService } from '../../technologies/technologies.service';
import { TechnologyReachService } from '../../technologies/technology-reach.service';
import { ItOpsSettings, ItOpsSettingsService } from '../it-ops-settings.service';

// A write that stores a value the workspace added (a technology, an incident) reads the lists under
// the shared lock of the tenant row (`getSettingsForWrite`). Restoring the default lists locks that
// row FOR NO KEY UPDATE: while the write is open, the restore waits; it then sees the record and
// keeps the value. Without the shared lock, the restore removes the value as unused and the write
// commits a code the list no longer has.

const noAudit = { log: async () => undefined } as any;

function settings(manager: EntityManager) {
  return new ItOpsSettingsService(manager.getRepository(Tenant), manager.getRepository(Location), noAudit);
}

function technologies(manager: EntityManager) {
  return new TechnologiesService(noAudit, settings(manager), new TechnologyReachService(), {} as any);
}

function incidents(manager: EntityManager) {
  return new IncidentsService(manager.getRepository(Incident), noAudit, null as any, null as any, settings(manager));
}

/** The workspace's lists hold one added value in `key` (stored metadata key `metadataKey`). */
async function addValue(race: Race, metadataKey: string, value: { code: string; label: string }) {
  await race.seedWith((runner) => runner.query(
    `UPDATE tenants SET metadata = jsonb_build_object('it_ops', jsonb_build_object($2::text, $3::jsonb)) WHERE id = $1`,
    [race.tenantId, metadataKey, JSON.stringify([value])],
  ));
}

/**
 * `write` stores the added value and pauses at `gate`, its transaction open; the restore must wait
 * for it, then keep the value.
 */
async function restoreWaitsFor(race: Race, opts: {
  gate: (text: string) => boolean;
  write: (manager: EntityManager) => Promise<unknown>;
  kept: (restored: ItOpsSettings) => boolean;
}) {
  const writer = await race.open('a write of the added value');
  const restorer = await race.open('a restore of the default lists');
  const holds = race.gate(writer, { label: 'write the record', when: 'after', match: opts.gate });
  const write = race.start(writer, opts.write);
  assert.equal(await progress(write, { party: writer, gate: holds }), 'gated', 'harness: the write must pause with its record written');

  const restore = race.start(restorer, (manager) => settings(manager).resetToDefaults(race.tenantId, { manager, userId: null }));
  assert.equal(await progress(restore, { party: restorer }), 'blocked', 'the restore waits for the open write');

  holds.release();
  assertSucceeded(await settle(write), 'the write');
  const outcome = await settle(restore);
  assertSucceeded(outcome, 'the restore');
  assert.ok(outcome.ok && opts.kept(outcome.value), 'the restore keeps the value the write stored');
}

async function technologyUpdate() {
  await withRace('reset-technology-update', async (race) => {
    await addValue(race, 'admin_zones', { code: 'race_zone', label: 'Race zone' });
    await race.seedWith((runner) => runner.query(`INSERT INTO technologies (tenant_id, item_number, name) VALUES ($1, 1, 'Race tech')`, [race.tenantId]));
    await restoreWaitsFor(race, {
      gate: sql.update('technologies'),
      write: (manager) => technologies(manager).update('TEC-1', { admin_zone: 'race_zone' }, { manager, tenantId: race.tenantId, userId: null }),
      kept: (restored) => restored.adminZones.some((zone) => zone.code === 'race_zone'),
    });
    const row = await race.readOne<{ admin_zone: string }>(`SELECT admin_zone FROM technologies WHERE tenant_id = $1`, [race.tenantId]);
    assert.equal(row?.admin_zone, 'race_zone');
  });
}

async function technologyCreate() {
  await withRace('reset-technology-create', async (race) => {
    await addValue(race, 'hosting_types', { code: 'race_host', label: 'Race hosting' });
    await restoreWaitsFor(race, {
      gate: sql.insertInto('technologies'),
      write: (manager) => technologies(manager).create({ name: 'Race tech', hosting_type: 'race_host' }, { manager, tenantId: race.tenantId, userId: null }),
      kept: (restored) => restored.hostingTypes.some((type) => type.code === 'race_host'),
    });
  });
}

async function incidentUpdate() {
  await withRace('reset-incident-update', async (race) => {
    await addValue(race, 'incident_categories', { code: 'race_cat', label: 'Race category' });
    const [incident] = await race.seedWith((runner) => runner.query(`INSERT INTO incidents (tenant_id, item_number, title, severity) VALUES ($1, 1, 'Race incident', 'minor') RETURNING id`, [race.tenantId]));
    await restoreWaitsFor(race, {
      gate: sql.update('incidents'),
      write: (manager) => incidents(manager).update(incident.id, { category: 'race_cat' }, null, { manager, tenantId: race.tenantId }),
      kept: (restored) => restored.incidentCategories.some((category) => category.code === 'race_cat'),
    });
  });
}

void runRaceSpecs('Restore of the default lists and the writes of an added value', [
  ['a technology update that stores an added value holds the restore, which keeps the value', technologyUpdate],
  ['a technology creation that stores an added value holds the restore, which keeps the value', technologyCreate],
  ['an incident update that stores an added category holds the restore, which keeps the category', incidentUpdate],
]);
