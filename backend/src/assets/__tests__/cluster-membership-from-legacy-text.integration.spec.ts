// @database-spec
import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import { ClusterMembershipFromLegacyText1855000000000 as Migration } from '../../migrations/1855000000000-cluster-membership-from-legacy-text';
import { assert, inRolledBackTransaction, runSpecs, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { asset, installed, member, technology } from '../../technologies/__tests__/technologies.fixtures';

// Migration 1855000000000 on a dirty database, two tenants: the legacy cluster text of each asset
// becomes real memberships when a name is exactly one cluster of the tenant; ambiguous, unknown,
// refused names (asset is a cluster, itself, cluster with an operating system) keep the text. It
// runs without app.current_tenant, never doubles a membership, and a second run writes nothing.

const migration = new Migration();

async function memberships(runner: QueryRunner, tenantId: string): Promise<string[]> {
  await setTenant(runner, tenantId);
  const rows: Array<{ pair: string }> = await runner.query(
    `SELECT c.name || '>' || a.name AS pair
       FROM asset_cluster_members m
       JOIN assets c ON c.id = m.cluster_id
       JOIN assets a ON a.id = m.asset_id
      WHERE m.tenant_id = $1
      ORDER BY 1`,
    [tenantId],
  );
  return rows.map((row) => row.pair);
}

async function texts(runner: QueryRunner, tenantId: string): Promise<Record<string, string | null>> {
  await setTenant(runner, tenantId);
  const rows: Array<{ name: string; cluster: string | null }> = await runner.query(
    `SELECT name, cluster FROM assets WHERE tenant_id = $1 ORDER BY name`,
    [tenantId],
  );
  return Object.fromEntries(rows.map((row) => [row.name, row.cluster]));
}

async function legacy(runner: QueryRunner, tenantId: string, assetId: string, text: string) {
  await runner.query(`UPDATE assets SET cluster = $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, assetId, text]);
}

async function captureLogs(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines;
}

async function testMigration() {
  await inRolledBackTransaction(async (runner) => {
    const first = await seedTenant(runner, 'cmlt-a');
    const esx = await asset(runner, first, 'ESX-PAR', true);
    await asset(runner, first, 'dup', true);
    await asset(runner, first, 'DUP', true);
    await asset(runner, first, 'plain-target');
    const withOs = await asset(runner, first, 'cl-os', true);
    const linux = await technology(runner, first, 1, 'Ubuntu', 'operating_system');
    const link = await installed(runner, first, withOs, linux);
    await runner.query(`UPDATE asset_technologies SET is_operating_system = true WHERE tenant_id = $1 AND id = $2`, [first, link]);
    const unique = await asset(runner, first, 'node-unique');
    const ambiguous = await asset(runner, first, 'node-ambiguous');
    const unknown = await asset(runner, first, 'node-unknown');
    const notCluster = await asset(runner, first, 'node-not-cluster');
    const inner = await asset(runner, first, 'cl-inner', true);
    const self = await asset(runner, first, 'cl-self', true);
    const os = await asset(runner, first, 'node-os');
    const present = await asset(runner, first, 'node-present');
    const half = await asset(runner, first, 'node-half');
    const blank = await asset(runner, first, 'node-blank');
    await member(runner, first, esx, present);
    await legacy(runner, first, unique, ' esx-par ');
    await legacy(runner, first, ambiguous, 'dup');
    await legacy(runner, first, unknown, 'ESX-LYO');
    await legacy(runner, first, notCluster, 'plain-target');
    await legacy(runner, first, inner, 'ESX-PAR');
    await legacy(runner, first, self, 'cl-self');
    await legacy(runner, first, os, 'cl-os');
    await legacy(runner, first, present, 'ESX-PAR');
    await legacy(runner, first, half, 'ESX-PAR, ESX-LYO');
    await legacy(runner, first, blank, ' , ');

    const second = await seedTenant(runner, 'cmlt-b');
    const other = await asset(runner, second, 'ESX-PAR', true);
    const remote = await asset(runner, second, 'node-remote');
    await legacy(runner, second, remote, 'ESX-PAR');
    void other;

    await runner.query(`RESET app.current_tenant`);
    const firstRun = await captureLogs(() => migration.up(runner));
    const lineOf = (tenantId: string) => firstRun.find((line) => line.includes(tenantId)) ?? '';
    assert.match(lineOf(first), /2 membership\(s\) inserted, 1 already present, 3 text\(s\) emptied, 3 name\(s\) without a cluster, 1 ambiguous, refused: 1 cluster, 1 self, 1 operating system/, firstRun.join('\n'));
    assert.match(lineOf(second), /1 membership\(s\) inserted, 0 already present, 1 text\(s\) emptied/, firstRun.join('\n'));

    assert.deepEqual(await memberships(runner, first), ['ESX-PAR>node-half', 'ESX-PAR>node-present', 'ESX-PAR>node-unique']);
    assert.deepEqual(await memberships(runner, second), ['ESX-PAR>node-remote']);
    const firstTexts = await texts(runner, first);
    assert.deepEqual(
      ['node-unique', 'node-present', 'node-blank', 'node-ambiguous', 'node-unknown', 'node-not-cluster', 'cl-inner', 'cl-self', 'node-os', 'node-half'].map((name) => [name, firstTexts[name]]),
      [
        ['node-unique', null],
        ['node-present', null],
        ['node-blank', null],
        ['node-ambiguous', 'dup'],
        ['node-unknown', 'ESX-LYO'],
        ['node-not-cluster', 'plain-target'],
        ['cl-inner', 'ESX-PAR'],
        ['cl-self', 'cl-self'],
        ['node-os', 'cl-os'],
        ['node-half', 'ESX-PAR, ESX-LYO'],
      ],
    );
    assert.equal((await texts(runner, second))['node-remote'], null);

    const security: Array<{ relname: string; enabled: boolean; forced: boolean }> = await runner.query(
      `SELECT relname, relrowsecurity AS enabled, relforcerowsecurity AS forced
         FROM pg_class WHERE relname IN ('asset_cluster_members', 'assets') AND relnamespace = 'public'::regnamespace ORDER BY relname`,
    );
    assert.deepEqual(security.map((row) => [row.relname, row.enabled, row.forced]), [
      ['asset_cluster_members', true, true],
      ['assets', true, true],
    ]);

    // A rerun writes nothing: the names left are logged again, no membership, no text emptied.
    await runner.query(`RESET app.current_tenant`);
    const secondRun = await captureLogs(() => migration.up(runner));
    const again = secondRun.find((line) => line.includes(first)) ?? '';
    assert.match(again, /0 membership\(s\) inserted, 1 already present, 0 text\(s\) emptied, 3 name\(s\) without a cluster, 1 ambiguous/, secondRun.join('\n'));
    assert.ok(!secondRun.some((line) => line.includes(second)), secondRun.join('\n'));
    assert.deepEqual(await memberships(runner, first), ['ESX-PAR>node-half', 'ESX-PAR>node-present', 'ESX-PAR>node-unique']);
    assert.deepEqual(await memberships(runner, second), ['ESX-PAR>node-remote']);
  });
}

runSpecs('cluster-membership-from-legacy-text.integration.spec.ts', [
  ['turns the legacy text into memberships, keeps the text of unmatched names, reruns clean', testMigration],
]);
