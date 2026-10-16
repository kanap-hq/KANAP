import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { LinkAndReferenceKeys1854160000000 } from '../../migrations/1854160000000-link-and-reference-keys';

// Migration 1854160000000 against a seeded dirty database, in one transaction rolled back at the
// end. It starts from its down(), the state before it ran, and succeeds with no manual step:
// - link and owned rows naming a missing row (a supplier contact link, a contract budget line
//   link, a team member setting, a monthly time total, a project activity) are deleted;
// - nullable references naming a missing row, or a row of another tenant (a project lead and
//   department, a task phase, a connection leg's equipment) are cleared;
// - the sound rows stay, every key is added and validated with its delete action, the counts are
//   logged per tenant, RLS is put back as found, and a rerun changes nothing.
// Then the keys work: deleting a user removes its team membership and clears what it led or was
// assigned, and an asset that a connection leg uses cannot be deleted.

async function setTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

async function seedTenant(runner: QueryRunner, tag: string) {
  const tenantId = randomUUID();
  const slug = `${tag}-${tenantId.slice(0, 8)}`;
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Link keys', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, slug],
  );
  return { tenantId, slug };
}

async function one(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(sql, params))[0].id as string;
}

async function ids(runner: QueryRunner, sql: string, params: unknown[]): Promise<string[]> {
  return (await runner.query(sql, params)).map((row: { id: string }) => row.id);
}

/** Name → `<action>/<validated>` of every foreign key of the public schema. */
async function foreignKeys(runner: QueryRunner): Promise<Map<string, string>> {
  const rows: Array<{ name: string; state: string }> = await runner.query(
    `SELECT conrelid::regclass::text || '.' || conname AS name,
            confdeltype::text || '/' || CASE WHEN convalidated THEN 'valid' ELSE 'not valid' END AS state
       FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace`,
  );
  return new Map(rows.map((row) => [row.name, row.state]));
}

async function rlsStates(runner: QueryRunner) {
  return runner.query(
    `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relnamespace = 'public'::regnamespace AND relrowsecurity ORDER BY relname`,
  );
}

/** Runs `fn` and returns what it logged. */
async function logged(fn: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}

async function testDirtyDatabase() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const migration = new LinkAndReferenceKeys1854160000000();
    await migration.down(runner);
    const keysBefore = await foreignKeys(runner);
    const rlsBefore = await rlsStates(runner);

    const other = await seedTenant(runner, 'link-keys-b');
    await setTenant(runner, other.tenantId);
    const otherCompany = await one(runner, `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Other company', 'FR', 'Lyon') RETURNING id`, [other.tenantId]);
    const otherDepartment = await one(runner, `INSERT INTO departments (tenant_id, company_id, name) VALUES ($1, $2, 'Other department') RETURNING id`, [other.tenantId, otherCompany]);

    const { tenantId, slug } = await seedTenant(runner, 'link-keys');
    await setTenant(runner, tenantId);
    const roleId = randomUUID();
    await runner.query(
      `INSERT INTO roles (id, tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
       VALUES ($1, $2, 'Link keys role', 'Link keys role', false, false, now(), now())`,
      [roleId, tenantId],
    );
    const userId = await one(
      runner,
      `INSERT INTO users (tenant_id, first_name, last_name, email, password_hash, role_id, mfa_enabled, status)
       VALUES ($1, 'Kept', 'User', $2, null, $3, false, 'enabled') RETURNING id`,
      [tenantId, `${slug}@link-keys.test`, roleId],
    );
    const companyId = await one(runner, `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Keys company', 'FR', 'Lyon') RETURNING id`, [tenantId]);
    const departmentId = await one(runner, `INSERT INTO departments (tenant_id, company_id, name) VALUES ($1, $2, 'Keys department') RETURNING id`, [tenantId, companyId]);
    const supplierId = await one(runner, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Keys supplier') RETURNING id`, [tenantId]);
    const contactId = await one(runner, `INSERT INTO contacts (tenant_id, email) VALUES ($1, $2) RETURNING id`, [tenantId, `contact-${slug}@link-keys.test`]);
    const contractId = await one(
      runner,
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, 'Keys contract', $2, $3, '2026-01-01') RETURNING id`,
      [tenantId, companyId, supplierId],
    );
    const lineId = await one(
      runner,
      `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, supplier_id)
       VALUES ($1, 'Keys line', 'EUR', '2026-01-01', 1, $2) RETURNING id`,
      [tenantId, supplierId],
    );

    // Link and owned rows: one sound, one naming a missing row.
    const keptContactLink = await one(runner, `INSERT INTO supplier_contacts (tenant_id, supplier_id, contact_id, role) VALUES ($1, $2, $3, 'commercial') RETURNING id`, [tenantId, supplierId, contactId]);
    await runner.query(`INSERT INTO supplier_contacts (tenant_id, supplier_id, contact_id, role) VALUES ($1, $2, $3, 'support')`, [tenantId, supplierId, randomUUID()]);
    const keptLineLink = await one(runner, `INSERT INTO contract_spend_items (tenant_id, contract_id, spend_item_id) VALUES ($1, $2, $3) RETURNING id`, [tenantId, contractId, lineId]);
    await runner.query(`INSERT INTO contract_spend_items (tenant_id, contract_id, spend_item_id) VALUES ($1, $2, $3)`, [tenantId, contractId, randomUUID()]);
    const keptConfig = await one(runner, `INSERT INTO portfolio_team_member_configs (tenant_id, user_id, item_number) VALUES ($1, $2, 1) RETURNING id`, [tenantId, userId]);
    await runner.query(`INSERT INTO portfolio_team_member_configs (tenant_id, user_id, item_number) VALUES ($1, $2, 2)`, [tenantId, randomUUID()]);
    await runner.query(`INSERT INTO user_time_monthly_aggregates (tenant_id, user_id, year_month) VALUES ($1, $2, '2026-01-01')`, [tenantId, randomUUID()]);

    // Nullable references: a sound project, and one whose lead is missing and whose department is another tenant's.
    const soundProject = await one(
      runner,
      `INSERT INTO portfolio_projects (tenant_id, name, item_number, it_lead_id, department_id) VALUES ($1, 'Sound project', 1, $2, $3) RETURNING id`,
      [tenantId, userId, departmentId],
    );
    const strayProject = await one(
      runner,
      `INSERT INTO portfolio_projects (tenant_id, name, item_number, it_lead_id, department_id) VALUES ($1, 'Stray project', 2, $2, $3) RETURNING id`,
      [tenantId, randomUUID(), otherDepartment],
    );
    await runner.query(`INSERT INTO portfolio_project_team (tenant_id, project_id, user_id, role) VALUES ($1, $2, $3, 'it_team')`, [tenantId, soundProject, userId]);
    const keptActivity = await one(runner, `INSERT INTO portfolio_activities (tenant_id, project_id, author_id, type) VALUES ($1, $2, $3, 'comment') RETURNING id`, [tenantId, soundProject, userId]);
    await runner.query(`INSERT INTO portfolio_activities (tenant_id, project_id, type) VALUES ($1, $2, 'comment')`, [tenantId, randomUUID()]);
    const phaseId = await one(runner, `INSERT INTO portfolio_project_phases (tenant_id, project_id, name) VALUES ($1, $2, 'Build') RETURNING id`, [tenantId, soundProject]);
    const phasedTask = await one(runner, `INSERT INTO tasks (tenant_id, item_number, title, phase_id, assignee_user_id) VALUES ($1, 1, 'Phased task', $2, $3) RETURNING id`, [tenantId, phaseId, userId]);
    const strayTask = await one(runner, `INSERT INTO tasks (tenant_id, item_number, title, phase_id) VALUES ($1, 2, 'Stray task', $2) RETURNING id`, [tenantId, randomUUID()]);
    const assetId = await one(runner, `INSERT INTO assets (tenant_id, name, kind, environment) VALUES ($1, 'Keys firewall', 'server', 'prod') RETURNING id`, [tenantId]);
    const connectionId = await one(
      runner,
      `INSERT INTO connections (tenant_id, name, topology, connection_reference, source_entity_code, destination_entity_code)
       VALUES ($1, 'Keys flow', 'point_to_point', 'CONN-1', 'internet', 'internet') RETURNING id`,
      [tenantId],
    );
    const usedLeg = await one(runner, `INSERT INTO connection_legs (tenant_id, connection_id, order_index, equipment_asset_id) VALUES ($1, $2, 1, $3) RETURNING id`, [tenantId, connectionId, assetId]);
    const strayLeg = await one(runner, `INSERT INTO connection_legs (tenant_id, connection_id, order_index, equipment_asset_id) VALUES ($1, $2, 2, $3) RETURNING id`, [tenantId, connectionId, randomUUID()]);
    await setTenant(runner, '');

    const log = await logged(() => migration.up(runner));

    const keysAfter = await foreignKeys(runner);
    const added = [...keysAfter.keys()].filter((name) => !keysBefore.has(name)).sort();
    assert.equal(added.length, 61, `61 keys added, got ${added.length}`);
    for (const name of added) assert.match(keysAfter.get(name)!, /\/valid$/, `${name} is validated`);
    const expected: Record<string, string> = {
      'supplier_contacts.fk_supplier_contacts_contact_id': 'c/valid',
      'contract_spend_items.fk_contract_spend_items_spend_item_id': 'c/valid',
      'portfolio_team_member_configs.fk_portfolio_team_member_configs_user_id': 'c/valid',
      'portfolio_activities.fk_portfolio_activities_task_id': 'c/valid',
      'ai_mutation_plans.fk_ai_mutation_plans_conversation_id': 'c/valid',
      'portfolio_projects.fk_portfolio_projects_it_lead_id': 'n/valid',
      'portfolio_projects.fk_portfolio_projects_department_id': 'n/valid',
      'tasks.fk_tasks_phase_id': 'n/valid',
      'spend_items.fk_spend_items_contract_id': 'n/valid',
      'incidents.fk_incidents_created_by': 'n/valid',
      'connection_legs.fk_connection_legs_equipment_asset_id': 'r/valid',
    };
    for (const [name, state] of Object.entries(expected)) assert.equal(keysAfter.get(name), state, name);
    assert.deepEqual(await rlsStates(runner), rlsBefore, 'RLS is put back as found');

    const tenantLine = `tenant ${slug} \\(${tenantId}\\)`;
    for (const [column, verb] of [
      ['supplier_contacts\\.contact_id', 'deleted'],
      ['contract_spend_items\\.spend_item_id', 'deleted'],
      ['portfolio_team_member_configs\\.user_id', 'deleted'],
      ['user_time_monthly_aggregates\\.user_id', 'deleted'],
      ['portfolio_activities\\.project_id', 'deleted'],
      ['portfolio_projects\\.it_lead_id', 'cleared'],
      ['portfolio_projects\\.department_id', 'cleared'],
      ['tasks\\.phase_id', 'cleared'],
      ['connection_legs\\.equipment_asset_id', 'cleared'],
    ]) {
      assert.match(log, new RegExp(`${tenantLine}: ${column}: 1 row\\(s\\) naming a missing \\w+ row ${verb}`), `${column} ${verb} and logged`);
    }

    await setTenant(runner, tenantId);
    assert.deepEqual(await ids(runner, `SELECT id FROM supplier_contacts WHERE tenant_id = $1`, [tenantId]), [keptContactLink]);
    assert.deepEqual(await ids(runner, `SELECT id FROM contract_spend_items WHERE tenant_id = $1`, [tenantId]), [keptLineLink]);
    assert.deepEqual(await ids(runner, `SELECT id FROM portfolio_team_member_configs WHERE tenant_id = $1`, [tenantId]), [keptConfig]);
    assert.deepEqual(await ids(runner, `SELECT id FROM user_time_monthly_aggregates WHERE tenant_id = $1`, [tenantId]), []);
    assert.deepEqual(await ids(runner, `SELECT id FROM portfolio_activities WHERE tenant_id = $1`, [tenantId]), [keptActivity]);
    const projects = await runner.query(`SELECT id, it_lead_id, department_id FROM portfolio_projects WHERE tenant_id = $1 ORDER BY item_number`, [tenantId]);
    assert.deepEqual(projects, [
      { id: soundProject, it_lead_id: userId, department_id: departmentId },
      { id: strayProject, it_lead_id: null, department_id: null },
    ]);
    const tasks = await runner.query(`SELECT id, phase_id FROM tasks WHERE tenant_id = $1 ORDER BY item_number`, [tenantId]);
    assert.deepEqual(tasks, [{ id: phasedTask, phase_id: phaseId }, { id: strayTask, phase_id: null }]);
    const legs = await runner.query(`SELECT id, equipment_asset_id FROM connection_legs WHERE tenant_id = $1 ORDER BY order_index`, [tenantId]);
    assert.deepEqual(legs, [{ id: usedLeg, equipment_asset_id: assetId }, { id: strayLeg, equipment_asset_id: null }]);
    await setTenant(runner, '');

    const rerun = await logged(() => migration.up(runner));
    assert.deepEqual(await foreignKeys(runner), keysAfter, 'a second run changes no key');
    assert.equal((rerun.match(/ in place$/gm) ?? []).length, 61, 'a second run finds every key in place');

    // The keys at work.
    await setTenant(runner, tenantId);
    await runner.query(`SAVEPOINT refused_asset`);
    await assert.rejects(
      runner.query(`DELETE FROM assets WHERE tenant_id = $1 AND id = $2`, [tenantId, assetId]),
      (err: any) => err?.code === '23503',
      'an asset that a connection leg uses cannot be deleted',
    );
    await runner.query(`ROLLBACK TO SAVEPOINT refused_asset`);
    await runner.query(`DELETE FROM portfolio_project_phases WHERE tenant_id = $1 AND id = $2`, [tenantId, phaseId]);
    await runner.query(`DELETE FROM users WHERE tenant_id = $1 AND id = $2`, [tenantId, userId]);
    const [project] = await runner.query(`SELECT it_lead_id FROM portfolio_projects WHERE id = $1`, [soundProject]);
    assert.equal(project.it_lead_id, null, 'the deleted user no longer leads the project');
    const [task] = await runner.query(`SELECT phase_id, assignee_user_id FROM tasks WHERE id = $1`, [phasedTask]);
    assert.deepEqual(task, { phase_id: null, assignee_user_id: null }, 'the task loses its deleted phase and assignee');
    assert.deepEqual(await ids(runner, `SELECT id FROM portfolio_project_team WHERE tenant_id = $1`, [tenantId]), [], 'the team membership goes with the user');
    assert.deepEqual(await ids(runner, `SELECT id FROM portfolio_team_member_configs WHERE tenant_id = $1`, [tenantId]), [], 'so do its team member settings');
    const [activity] = await runner.query(`SELECT author_id FROM portfolio_activities WHERE id = $1`, [keptActivity]);
    assert.equal(activity.author_id, null, 'the project history stays, without its author');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function main() {
  await dataSource.initialize();
  try {
    await testDirtyDatabase();
    console.log('  ok testDirtyDatabase');
  } finally {
    await dataSource.destroy();
  }
  console.log('link-and-reference-keys.migration.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
