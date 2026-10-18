// @database-spec
import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import {
  OS_PRODUCTS,
  OperatingSystemTechnology1854330000000 as Migration,
} from '../../migrations/1854330000000-operating-system-technology';
import { assert, inRolledBackTransaction, runSpecs, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { asset, installed, technology, version } from './technologies.fixtures';

// Migration 1854330000000, against a real database, in a transaction rolled back at the end.
// The suite has already applied it, so the dirty case calls down() first and puts the old column back.

const migration = new Migration();

const windowsVersions = OS_PRODUCTS.find((product) => product.key === 'windows-server')!.versions.length;
const ubuntuVersions = OS_PRODUCTS.find((product) => product.key === 'ubuntu')!.versions.length;
const centosVersions = OS_PRODUCTS.find((product) => product.key === 'centos')!.versions.length;
const oracleLinuxVersions = OS_PRODUCTS.find((product) => product.key === 'oracle-linux')!.versions.length;
const ubuntu2204 = OS_PRODUCTS.find((product) => product.key === 'ubuntu')!.versions.find((item) => item.label === '22.04 LTS')!;
const centos7 = OS_PRODUCTS.find((product) => product.key === 'centos')!.versions.find((item) => item.label === '7')!;

type Counts = { created: number; adopted: number; versions: number; linksCreated: number; linksReused: number; orphans: number; datesDropped?: number };

function line(tenantId: string, counts: Counts): string {
  return `[migration 1854330000000] tenant ${tenantId}: created=${counts.created} adopted=${counts.adopted}`
    + ` versions=${counts.versions} links_created=${counts.linksCreated} links_reused=${counts.linksReused} orphans=${counts.orphans}`
    + ` dates_dropped=${counts.datesDropped ?? 0}`;
}

async function linkCount(runner: QueryRunner, tenantId: string): Promise<number> {
  await setTenant(runner, tenantId);
  const [row] = await runner.query(`SELECT count(*)::int AS n FROM asset_technologies WHERE tenant_id = $1`, [tenantId]);
  return row.n;
}

async function logged(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => void lines.push(args.map(String).join(' '));
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines;
}

async function column(runner: QueryRunner, table: string, name: string) {
  const rows: Array<{ is_nullable: string; column_default: string | null }> = await runner.query(
    `SELECT is_nullable, column_default FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
    [table, name],
  );
  return rows[0] ?? null;
}

async function functionReadsOperatingSystem(runner: QueryRunner): Promise<boolean> {
  const [row]: Array<{ def: string }> = await runner.query(
    `SELECT pg_get_functiondef('search_index_refresh_assets(uuid, uuid[])'::regprocedure) AS def`,
  );
  return row.def.includes('operating_system');
}

async function testMigratedAndRerun() {
  await inRolledBackTransaction(async (runner) => {
    assert.equal(await column(runner, 'assets', 'operating_system'), null);
    const flag = await column(runner, 'asset_technologies', 'is_operating_system');
    assert.equal(flag?.is_nullable, 'NO');
    assert.match(String(flag?.column_default), /false/);
    const [index] = await runner.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_asset_technologies_one_os'`);
    assert.match(String(index?.indexdef), /UNIQUE/i);
    assert.equal(await functionReadsOperatingSystem(runner), false);
    const log = await logged(() => migration.up(runner));
    assert.deepEqual(log, []);
    assert.equal(await column(runner, 'assets', 'operating_system'), null);
  });
}

async function testDirtyDatabase() {
  await inRolledBackTransaction(async (runner) => {
    await migration.down(runner);
    assert.ok(await column(runner, 'assets', 'operating_system'));
    assert.equal(await column(runner, 'asset_technologies', 'is_operating_system'), null);
    assert.equal(await functionReadsOperatingSystem(runner), true);

    const a = await seedTenant(runner, 'os-a');
    await runner.query(
      `UPDATE tenants SET metadata = jsonb_build_object('it_ops', jsonb_build_object('operating_systems', $2::jsonb)) WHERE id = $1`,
      [a, JSON.stringify([
        { code: 'windows_server_2019', label: 'Windows Server 2019' },
        { code: 'windows_server_2022', label: 'Windows Server 2022' },
        { code: 'vmware_esxi_8', label: 'VMware ESXi 8.0', standardSupportEnd: '2030-01-01', extendedSupportEnd: '2035-01-01' },
        { code: 'cisco_meraki', label: 'Cisco Meraki' },
        { code: 'old_os', label: 'Retired OS 3.1', deprecated: true },
        { code: 'kept_new', label: 'Kept OS 1.0' },
        { code: 'kept_old', label: 'Kept OS 2.0', deprecated: true },
        // Review B1: custom codes go through the resolver's order, not a bare split.
        { code: 'win2008r2', label: 'Windows Server 2008 R2', deprecated: true, standardSupportEnd: '2015-01-13', extendedSupportEnd: '2020-01-14' },
        { code: 'ubuntu1604', label: 'Ubuntu 16.04 LTS', standardSupportEnd: '2021-04-30', extendedSupportEnd: '2026-04-30' },
        { code: 'centos_7', label: 'CentOS 7' },
        { code: 'oracle_linux_9', label: 'Oracle Linux 9' },
        { code: 'dated_bare', label: 'Dated Bare', standardSupportEnd: '2020-01-01' },
        // A shipped default no server uses stays in the catalog.
        { code: 'rhel_9', label: 'RHEL 9' },
      ])],
    );
    await technology(runner, a, 3, 'Oracle', 'database');
    const vmware = await technology(runner, a, 1, 'VMware ESXi', 'hypervisor');
    const ubuntu = await technology(runner, a, 2, 'Ubuntu', 'runtime');
    await runner.query(`UPDATE technologies SET lifecycle = 'sunset' WHERE tenant_id = $1 AND id = $2`, [a, ubuntu]);
    const vmware80 = await version(runner, a, vmware, '8.0', '2011-01-01');
    const names = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'aa', 'ab'] as const;
    const ids: Record<string, string> = {};
    for (const name of names) ids[name] = await asset(runner, a, name);
    const codes: Record<string, string> = {
      a1: 'windows_server_2019', a2: 'windows_server_2022', a3: 'vmware_esxi_8', a4: 'ubuntu_22_04_lts',
      a5: 'foo_bar_2', a6: 'plain_orphan', a7: 'cisco_meraki', a8: 'win2008r2', a9: 'ubuntu1604', aa: 'centos_7', ab: 'oracle_linux_9',
    };
    for (const name of names) {
      await runner.query(`UPDATE assets SET operating_system = $3 WHERE tenant_id = $1 AND id = $2`, [a, ids[name], codes[name]]);
    }
    const reused = await installed(runner, a, ids.a3, vmware, null, 'import');
    await runner.query(
      `INSERT INTO ai_adapter_configs (tenant_id, provider_kind, provider_key, implementation, environment, metadata_json)
       VALUES ($1, 'inventory', 'netbox', 'netbox', 'prod', $2::jsonb)`,
      [a, JSON.stringify({ os_map: {
        win: 'windows_server_2019', esx: 'vmware_esxi_8', already: 'Ubuntu 22.04 LTS',
        bsd: 'freebsd', old: 'free_bsd_14', srv: 'windows_server_2016',
      } })],
    );

    const b = await seedTenant(runner, 'os-b');
    await runner.query(
      `UPDATE tenants SET metadata = jsonb_build_object('it_ops', jsonb_build_object('operating_systems', $2::jsonb)) WHERE id = $1`,
      [b, JSON.stringify([
        { code: 'lonely_9', label: 'Lonely 9', deprecated: true, standardSupportEnd: '2020-01-01', extendedSupportEnd: '2021-01-01' },
        { code: 'pair_1', label: 'Pair 1.0', deprecated: true },
      ])],
    );
    const bLonely = await asset(runner, b, 'b-lonely');
    const bPair = await asset(runner, b, 'b-pair');
    await runner.query(`UPDATE assets SET operating_system = 'lonely_9' WHERE tenant_id = $1 AND id = $2`, [b, bLonely]);
    await runner.query(`UPDATE assets SET operating_system = 'pair_9' WHERE tenant_id = $1 AND id = $2`, [b, bPair]);
    const bFree = await asset(runner, b, 'b-free');
    await runner.query(`UPDATE assets SET operating_system = 'Windows Server 2012 R2' WHERE tenant_id = $1 AND id = $2`, [b, bFree]);

    // Windows Server 2008 R2 and Ubuntu 16.04 LTS are versions of the frozen products: the custom
    // codes land on them and create no version of their own.
    const expectedA = {
      created: 9, adopted: 4, versions: windowsVersions + ubuntuVersions + centosVersions + oracleLinuxVersions + 4,
      linksCreated: 10, linksReused: 1, orphans: 2, datesDropped: 1,
    };
    const expectedB = { created: 3, adopted: 1, versions: windowsVersions + 3, linksCreated: 3, linksReused: 0, orphans: 2 };
    const log = await logged(() => migration.up(runner));
    assert.ok(log.includes(line(a, expectedA)), log.join(' | '));
    assert.ok(log.includes(line(b, expectedB)), log.join(' | '));

    assert.equal(await column(runner, 'assets', 'operating_system'), null);
    assert.equal(await functionReadsOperatingSystem(runner), false);
    await setTenant(runner, a);
    const [rhel] = await runner.query(`SELECT count(*)::int AS n FROM technologies WHERE tenant_id = $1 AND catalog_key = 'rhel'`, [a]);
    assert.equal(rhel.n, 0, 'an unused shipped default is not adopted');
    const marked: Array<{ name: string; tech: string; family: string; lifecycle: string; catalog_key: string | null; version: string | null; source: string }> = await runner.query(
      `SELECT a.name, t.name AS tech, t.family, t.lifecycle, t.catalog_key, v.label AS version, at.source
         FROM assets a
         JOIN asset_technologies at ON at.tenant_id = a.tenant_id AND at.asset_id = a.id AND at.is_operating_system
         JOIN technologies t ON t.tenant_id = at.tenant_id AND t.id = at.technology_id
         LEFT JOIN technology_versions v ON v.tenant_id = at.tenant_id AND v.id = at.technology_version_id
        WHERE a.tenant_id = $1 ORDER BY a.name`,
      [a],
    );
    assert.deepEqual(marked.map((row) => [row.name, row.tech, row.version, row.family, row.source]), [
      ['a1', 'Windows Server', '2019', 'operating_system', 'manual'],
      ['a2', 'Windows Server', '2022', 'operating_system', 'manual'],
      ['a3', 'VMware ESXi', '8.0', 'hypervisor', 'import'],
      ['a4', 'Ubuntu', '22.04 LTS', 'runtime', 'manual'],
      ['a5', 'foo bar', '2', 'operating_system', 'manual'],
      ['a6', 'plain orphan', null, 'operating_system', 'manual'],
      ['a7', 'Cisco Meraki', null, 'operating_system', 'manual'],
      ['a8', 'Windows Server', '2008 R2', 'operating_system', 'manual'],
      ['a9', 'Ubuntu', '16.04 LTS', 'runtime', 'manual'],
      ['aa', 'CentOS', '7', 'operating_system', 'manual'],
      ['ab', 'Oracle Linux', '9', 'operating_system', 'manual'],
    ]);
    assert.equal(marked.find((row) => row.name === 'aa')!.catalog_key, 'centos', 'CentOS 7 adopts the shipped product');
    assert.equal(marked.find((row) => row.name === 'ab')!.catalog_key, 'oracle-linux', 'the longest prefix wins over the tenant\'s Oracle');
    const dated = async (tech: string, label: string) => (await runner.query(
      `SELECT to_char(v.standard_support_end, 'YYYY-MM-DD') AS standard, to_char(v.extended_support_end, 'YYYY-MM-DD') AS extended
         FROM technology_versions v JOIN technologies t ON t.tenant_id = v.tenant_id AND t.id = v.technology_id
        WHERE v.tenant_id = $1 AND t.name = $2 AND v.label = $3`,
      [a, tech, label],
    ))[0];
    assert.deepEqual(await dated('Windows Server', '2008 R2'), { standard: '2015-01-13', extended: '2020-01-14' }, 'the dates of a custom entry are kept');
    assert.deepEqual(await dated('Ubuntu', '16.04 LTS'), { standard: '2021-04-30', extended: '2026-04-30' });
    assert.deepEqual(await dated('CentOS', '7'), { standard: centos7.standard_support_end, extended: centos7.extended_support_end });
    const [strays] = await runner.query(
      `SELECT count(*)::int AS n FROM technologies
        WHERE tenant_id = $1 AND lower(name) IN ('windows server 2008 r2', 'ubuntu 16.04 lts', 'freebsd', 'free bsd', 'free bsd 14')`,
      [a],
    );
    assert.equal(strays.n, 0, 'no technology for a version of a known product, nor for an os_map orphan');
    const ubuntuRow = marked.find((row) => row.name === 'a4')!;
    assert.equal(ubuntuRow.lifecycle, 'sunset', 'a technology that already existed keeps its lifecycle');
    assert.equal(ubuntuRow.catalog_key, 'ubuntu');
    const [ubuntuDate] = await runner.query(
      `SELECT to_char(standard_support_end, 'YYYY-MM-DD') AS standard, to_char(extended_support_end, 'YYYY-MM-DD') AS extended
         FROM technology_versions WHERE tenant_id = $1 AND label = '22.04 LTS'`,
      [a],
    );
    assert.equal(ubuntuDate.standard, ubuntu2204.standard_support_end, 'the shipped catalog wins over the old operating-system dates');
    assert.equal(ubuntuDate.extended, ubuntu2204.extended_support_end);
    const [vmwareDate] = await runner.query(
      `SELECT to_char(standard_support_end, 'YYYY-MM-DD') AS standard, to_char(extended_support_end, 'YYYY-MM-DD') AS extended
         FROM technology_versions WHERE tenant_id = $1 AND id = $2`,
      [a, vmware80],
    );
    assert.deepEqual(vmwareDate, { standard: '2011-01-01', extended: '2035-01-01' });
    const [vmwareLink] = await runner.query(`SELECT id, technology_version_id FROM asset_technologies WHERE tenant_id = $1 AND id = $2`, [a, reused]);
    assert.equal(vmwareLink.technology_version_id, vmware80, 'the versionless link is reused');
    const lifecycles: Array<{ name: string; lifecycle: string }> = await runner.query(
      `SELECT name, lifecycle FROM technologies WHERE tenant_id = $1 AND name IN ('Retired OS', 'Kept OS', 'Windows Server') ORDER BY name`,
      [a],
    );
    assert.deepEqual(lifecycles, [
      { name: 'Kept OS', lifecycle: 'active' },
      { name: 'Retired OS', lifecycle: 'retired' },
      { name: 'Windows Server', lifecycle: 'active' },
    ]);
    const [settings] = await runner.query(`SELECT metadata #> '{it_ops,operating_systems}' AS os FROM tenants WHERE id = $1`, [a]);
    assert.equal(settings.os, null);
    const [netbox] = await runner.query(
      `SELECT metadata_json->'os_map' AS os_map FROM ai_adapter_configs WHERE tenant_id = $1 AND provider_key = 'netbox'`,
      [a],
    );
    assert.deepEqual(netbox.os_map, {
      win: 'Windows Server 2019', esx: 'VMware ESXi 8.0', already: 'Ubuntu 22.04 LTS',
      bsd: 'freebsd', old: 'free bsd 14', srv: 'Windows Server 2016',
    });
    const [dupes] = await runner.query(
      `SELECT count(*)::int AS n FROM (
         SELECT asset_id FROM asset_technologies WHERE tenant_id = $1 AND is_operating_system GROUP BY asset_id HAVING count(*) > 1
       ) d`,
      [a],
    );
    assert.equal(dupes.n, 0);

    await setTenant(runner, b);
    const bRows: Array<{ name: string; tech: string; version: string | null; lifecycle: string }> = await runner.query(
      `SELECT a.name, t.name AS tech, v.label AS version, t.lifecycle
         FROM assets a
         JOIN asset_technologies at ON at.tenant_id = a.tenant_id AND at.asset_id = a.id AND at.is_operating_system
         JOIN technologies t ON t.tenant_id = at.tenant_id AND t.id = at.technology_id
         LEFT JOIN technology_versions v ON v.tenant_id = at.tenant_id AND v.id = at.technology_version_id
        WHERE a.tenant_id = $1 ORDER BY a.name`,
      [b],
    );
    assert.deepEqual(bRows, [
      { name: 'b-free', tech: 'Windows Server', version: '2012 R2', lifecycle: 'active' },
      { name: 'b-lonely', tech: 'Lonely', version: '9', lifecycle: 'retired' },
      { name: 'b-pair', tech: 'Pair', version: '9', lifecycle: 'active' },
    ]);
    const [lonelyDate] = await runner.query(
      `SELECT to_char(v.standard_support_end, 'YYYY-MM-DD') AS standard
         FROM technology_versions v JOIN technologies t ON t.id = v.technology_id
        WHERE v.tenant_id = $1 AND t.name = 'Lonely'`,
      [b],
    );
    assert.equal(lonelyDate.standard, '2020-01-01');

    await runner.query('SAVEPOINT os_unique');
    let rejected = false;
    try {
      const other = await technology(runner, b, 9, 'Other OS');
      await runner.query(
        `INSERT INTO asset_technologies (tenant_id, asset_id, technology_id, is_operating_system, source)
         VALUES ($1, $2, $3, true, 'manual')`,
        [b, bLonely, other],
      );
    } catch (error: any) {
      rejected = (error?.code ?? error?.driverError?.code) === '23505';
      await runner.query('ROLLBACK TO SAVEPOINT os_unique');
    }
    assert.equal(rejected, true, 'a second operating system on one server is rejected');

    const again = await logged(() => migration.up(runner));
    assert.deepEqual(again, [], 'a rerun, with the column gone, changes nothing');

    // Review M6: a technology named like a shipped code, and a tenant with no operating system.
    const c = await seedTenant(runner, 'os-c');
    const cServer = await asset(runner, c, 'c1');
    const cTech = await technology(runner, c, 1, 'Windows Server 2016');
    await runner.query(
      `INSERT INTO asset_technologies (tenant_id, asset_id, technology_id, is_operating_system, source) VALUES ($1, $2, $3, true, 'manual')`,
      [c, cServer, cTech],
    );
    const d = await seedTenant(runner, 'os-d');
    const linksBefore = { a: await linkCount(runner, a), b: await linkCount(runner, b), c: await linkCount(runner, c) };

    await migration.down(runner);
    assert.ok(await column(runner, 'assets', 'operating_system'));
    assert.equal(await functionReadsOperatingSystem(runner), true);
    await setTenant(runner, a);
    const restored: Array<{ name: string; operating_system: string }> = await runner.query(
      `SELECT name, operating_system FROM assets WHERE tenant_id = $1 ORDER BY name`,
      [a],
    );
    assert.deepEqual(restored.slice(0, 7), [
      { name: 'a1', operating_system: 'windows_server_2019' },
      { name: 'a2', operating_system: 'windows_server_2022' },
      { name: 'a3', operating_system: 'vmware_esxi_8_0' },
      { name: 'a4', operating_system: 'ubuntu_22_04_lts' },
      { name: 'a5', operating_system: 'foo_bar_2' },
      { name: 'a6', operating_system: 'plain_orphan' },
      { name: 'a7', operating_system: 'cisco_meraki' },
    ]);
    const [rebuilt] = await runner.query(`SELECT metadata #> '{it_ops,operating_systems}' AS os FROM tenants WHERE id = $1`, [a]);
    const rebuiltCodes = (rebuilt.os as Array<{ code: string }>).map((entry) => entry.code).sort();
    assert.deepEqual(rebuiltCodes, [
      'centos_7', 'cisco_meraki', 'foo_bar_2', 'oracle_linux_9', 'plain_orphan', 'ubuntu_16_04_lts', 'ubuntu_22_04_lts',
      'vmware_esxi_8_0', 'windows_server_2008_r2', 'windows_server_2019', 'windows_server_2022',
    ]);
    const [cSettings] = await runner.query(`SELECT metadata #> '{it_ops,operating_systems}' AS os FROM tenants WHERE id = $1`, [c]);
    assert.deepEqual((cSettings.os as Array<{ code: string; label: string }>).map((entry) => [entry.code, entry.label]),
      [['windows_server_2016_custom', 'Windows Server 2016']], 'never a shipped code for another technology, it_ops created');
    const [dSettings] = await runner.query(`SELECT metadata #> '{it_ops,operating_systems}' AS os FROM tenants WHERE id = $1`, [d]);
    assert.equal(dSettings.os, null, 'no operating system, no settings key: the defaults apply');
    const [still] = await runner.query(`SELECT count(*)::int AS n FROM technologies WHERE tenant_id = $1 AND name = 'Windows Server'`, [a]);
    assert.equal(still.n, 1, 'down() does not delete the technologies');

    const relinked = await logged(() => migration.up(runner));
    assert.ok(relinked.includes(line(a, { created: 0, adopted: 0, versions: 0, linksCreated: 0, linksReused: 11, orphans: 0 })), relinked.join(' | '));
    assert.ok(relinked.includes(line(c, { created: 0, adopted: 0, versions: 0, linksCreated: 0, linksReused: 1, orphans: 0 })), relinked.join(' | '));
    assert.deepEqual(
      { a: await linkCount(runner, a), b: await linkCount(runner, b), c: await linkCount(runner, c) },
      linksBefore,
      'down() then up() leaves no link twice',
    );
    await setTenant(runner, a);
    const [windows] = await runner.query(`SELECT count(*)::int AS n FROM technologies WHERE tenant_id = $1 AND name = 'Windows Server'`, [a]);
    assert.equal(windows.n, 1);
    const [marks] = await runner.query(
      `SELECT count(*)::int AS n FROM asset_technologies WHERE tenant_id = $1 AND is_operating_system`,
      [a],
    );
    assert.equal(marks.n, 11);
  });
}

void runSpecs('Operating system technology migration', [
  ['as migrated, rerun', testMigratedAndRerun],
  ['dirty database', testDirtyDatabase],
]);
