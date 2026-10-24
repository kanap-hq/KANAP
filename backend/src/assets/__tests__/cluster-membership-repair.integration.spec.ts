// @database-spec
import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import { ClusterMembershipRepair1854900000000 as Migration } from '../../migrations/1854900000000-cluster-membership-repair';
import { assert, inRolledBackTransaction, runSpecs, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { asset, member } from '../../technologies/__tests__/technologies.fixtures';

// Migration 1854900000000 on a dirty database: two tenants, one membership of each forbidden kind
// (cluster no longer a cluster, member that is a cluster, cluster member of itself) next to sound
// ones. It removes exactly the three bad rows, without app.current_tenant, keeps RLS as found,
// and a second run removes nothing.

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

async function testRepair() {
  await inRolledBackTransaction(async (runner) => {
    const first = await seedTenant(runner, 'cmr-a');
    const sound = await asset(runner, first, 'cl-sound', true);
    const node1 = await asset(runner, first, 'node-1');
    const node2 = await asset(runner, first, 'node-2');
    const former = await asset(runner, first, 'cl-former', true);
    await member(runner, first, sound, node1);
    await member(runner, first, former, node2);
    await runner.query(`UPDATE assets SET is_cluster = false WHERE tenant_id = $1 AND id = $2`, [first, former]);
    const self = await asset(runner, first, 'cl-self', true);
    await member(runner, first, self, self);

    const second = await seedTenant(runner, 'cmr-b');
    const outer = await asset(runner, second, 'cl-outer', true);
    const inner = await asset(runner, second, 'cl-inner', true);
    const node3 = await asset(runner, second, 'node-3');
    await member(runner, second, outer, node3);
    await member(runner, second, outer, inner);

    assert.deepEqual(await memberships(runner, first), ['cl-former>node-2', 'cl-self>cl-self', 'cl-sound>node-1']);
    assert.deepEqual(await memberships(runner, second), ['cl-outer>cl-inner', 'cl-outer>node-3']);

    // As a migration runs: no tenant set.
    await runner.query(`RESET app.current_tenant`);
    const firstRun = await captureLogs(() => migration.up(runner));
    assert.ok(firstRun.some((line) => line.includes(first) && /1 membership\(s\) removed, not_a_cluster/.test(line)), firstRun.join('\n'));
    assert.ok(firstRun.some((line) => line.includes(first) && /1 membership\(s\) removed, self/.test(line)), firstRun.join('\n'));
    assert.ok(firstRun.some((line) => line.includes(second) && /1 membership\(s\) removed, member_is_cluster/.test(line)), firstRun.join('\n'));

    const security: Array<{ relname: string; enabled: boolean; forced: boolean }> = await runner.query(
      `SELECT relname, relrowsecurity AS enabled, relforcerowsecurity AS forced
         FROM pg_class WHERE relname IN ('asset_cluster_members', 'assets') AND relnamespace = 'public'::regnamespace ORDER BY relname`,
    );
    assert.deepEqual(security.map((row) => [row.relname, row.enabled, row.forced]), [
      ['asset_cluster_members', true, true],
      ['assets', true, true],
    ]);

    assert.deepEqual(await memberships(runner, first), ['cl-sound>node-1']);
    assert.deepEqual(await memberships(runner, second), ['cl-outer>node-3']);

    await runner.query(`RESET app.current_tenant`);
    const secondRun = await captureLogs(() => migration.up(runner));
    assert.deepEqual(secondRun, ['[Migration] ClusterMembershipRepair: no invalid cluster membership, nothing removed']);
    assert.deepEqual(await memberships(runner, first), ['cl-sound>node-1']);
    assert.deepEqual(await memberships(runner, second), ['cl-outer>node-3']);
  });
}

runSpecs('cluster-membership-repair.integration.spec.ts', [
  ['removes the three forbidden memberships, keeps the sound ones, reruns clean', testRepair],
]);
