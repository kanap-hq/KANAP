import 'dotenv/config';
import 'reflect-metadata';
import type { EntityManager, QueryRunner } from 'typeorm';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { ItOpsSettingsService } from '../../it-ops-settings/it-ops-settings.service';
import { Location } from '../../locations/location.entity';
import { Tenant } from '../../tenants/tenant.entity';
import { assert, assertSucceeded, progress, runRaceSpecs, settle, withRace } from '../../spend/__tests__/race-harness';
import { Application } from '../application.entity';
import { ApplicationsCrudService } from '../services/applications-crud.service';
import { ApplicationsListService } from '../services/applications-list.service';
import { ApplicationsOwnersService } from '../services/applications-owners.service';
import { ApplicationsService } from '../services/applications.service';

// The locks of "Change the selection" on applications (lot F2 of 26.11.8, review fixes):
// - B1: every writer of an application's owners locks the application first, as the change in bulk
//   does: the owners saved from the application page while a change in bulk holds the application
//   wait for it, then write, with no deadlock.

function services(manager: EntityManager) {
  const audit = new AuditService(manager.getRepository(AuditLog));
  const settings = new ItOpsSettingsService(manager.getRepository(Tenant), manager.getRepository(Location), audit);
  const repo = manager.getRepository(Application);
  const crud = new ApplicationsCrudService(repo, audit, null as any, settings, null as any);
  const owners = new ApplicationsOwnersService(repo, audit);
  const svc = new ApplicationsService(new ApplicationsListService(repo), crud, owners, null as any, null as any, null as any, null as any);
  return { svc, owners, settings };
}

async function seedApplication(runner: QueryRunner, tenantId: string) {
  const [role] = await runner.query(
    `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, 'Race', 'Race', false, false, now(), now()) RETURNING id`,
    [tenantId],
  );
  const people: string[] = [];
  for (const name of ['ana', 'ben']) {
    const [user] = await runner.query(
      `INSERT INTO users (tenant_id, first_name, last_name, email, password_hash, role_id, mfa_enabled, status, created_at, updated_at)
       VALUES ($1, $2, 'Race', $3, null, $4, false, 'enabled', now(), now()) RETURNING id`,
      [tenantId, name, `${name}-${tenantId.slice(0, 8)}@example.com`, role.id],
    );
    people.push(user.id);
  }
  const { svc, owners } = services(runner.manager);
  const app = await (svc as any).crudService.create({ name: 'Race application', lifecycle: 'active' }, null, { manager: runner.manager });
  await owners.bulkReplaceOwners(app.id, [{ user_id: people[1], owner_type: 'it' }], null, { manager: runner.manager });
  return { appId: app.id as string, ana: people[0], ben: people[1] };
}

async function businessOwners(read: (sql: string, params: unknown[]) => Promise<any[]>, appId: string) {
  const rows = await read(`SELECT user_id::text AS id FROM application_owners WHERE application_id = $1 AND owner_type = 'business'`, [appId]);
  return rows.map((row) => row.id);
}

/** B1: the owners saved from the page while a change in bulk of the owners holds the application. */
async function ownersPageWaitsForTheBulk() {
  await withRace('apps-owners', async (race) => {
    const { appId, ana, ben } = await race.seedWith((runner) => seedApplication(runner, race.tenantId));
    const bulk = await race.open('owners in bulk');
    const page = await race.open('owners of the page');
    const holds = race.gate(bulk, { label: 'lock the applications', when: 'after', match: (text) => /FOR UPDATE OF a/.test(text) });
    const bulkWork = race.start(bulk, (manager) => services(manager).svc.bulkUpdate(
      { ids: [appId], changes: { owners_business: [ana] } }, null, { manager, tenantId: race.tenantId },
    ));
    assert.equal(await progress(bulkWork, { party: bulk, gate: holds }), 'gated', 'harness: the change in bulk must pause holding the application');
    const pageWork = race.start(page, (manager) => services(manager).owners.bulkReplaceOwners(
      appId, [{ user_id: ben, owner_type: 'business' }], null, { manager },
    ));
    assert.equal(await progress(pageWork, { party: page }), 'blocked', 'the page waits for the application');
    holds.release();
    const bulkDone = await settle(bulkWork);
    const pageDone = await settle(pageWork);
    assertSucceeded(bulkDone, 'the change in bulk');
    assertSucceeded(pageDone, 'the owners saved from the page');
    assert.equal((bulkDone as any).value?.changed, 1);
    assert.deepEqual(await businessOwners((sql, params) => race.read(sql, params), appId), [ben], 'the page wrote after the change in bulk');
  });
}

void runRaceSpecs('Application bulk edit locks', [
  ['B1: the owners saved from the page wait for a change in bulk of the same application, no deadlock', ownersPageWaitsForTheBulk],
]);
