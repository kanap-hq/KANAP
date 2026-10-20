import * as assert from 'node:assert/strict';
import { ConfigController } from '../../config/config.controller';
import { Features } from '../../config/features';
import { cleanLabel, cpeVersionOf, endoflifeSlug, MAX_RELEASES, MAX_VERSIONS, mergeProduct, mergeVersions, realDay, releaseProduct, SUPPORT_RULES, validCatalogVersion, versionPrecisionOf, versionsOfReleases } from '../catalog/catalog-releases';
import { VERSION_PRECISION, versionMatches } from '../../vulnerabilities/vulnerability-rules';
import { TechnologyCatalogService, type CatalogVersion } from '../catalog/technology-catalog.service';

// The living catalog (lot C4) reads endoflife.date with the rules of the script that builds the
// shipped catalog (scripts/technologies/build-catalog.mjs): the same versions, labels and NVD
// versions, then merged with the shipped ones.

const shipped = new TechnologyCatalogService({} as any, {} as any).all();

/** The rules of the backend give back the `cpe_version` the script wrote on every shipped version. */
function testCpeVersionMatchesTheShippedCatalog() {
  let checked = 0;
  for (const product of shipped) {
    for (const version of product.versions) {
      assert.equal(cpeVersionOf(version.label, product.key), version.cpe_version, `${product.key} ${version.label}`);
      checked += 1;
    }
  }
  assert.ok(checked > 300, `every shipped version is checked (${checked})`);
  assert.equal(cpeVersionOf('19c', 'oracle-database'), '19c');
  assert.equal(cpeVersionOf('Subscription Edition SU12', 'msexchange'), '15.2');
  assert.equal(cpeVersionOf('IBM MQ 9.5 LTS', 'ibm-mq'), '9.5');
  assert.equal(cpeVersionOf('19', 'postgresql'), null);
}

function testVersionsOfReleases() {
  const releases = [
    { name: '20', label: '20', releaseDate: '2027-09-01', eolFrom: '2032-11-01' }, // not released yet
    { name: '19', label: '19 (LTS)', releaseDate: '2026-09-25', eoasFrom: '2028-01-01', eolFrom: '2031-11-13' },
    { name: '18', label: "18 'Code'", releaseDate: '2025-09-25', eolFrom: '2030-11-14', eoesFrom: '2032-11-14' },
    { name: '17.4', label: '17', releaseDate: '2024-09-26', eolFrom: '2029-11-08' },
    { name: '17-bis', label: '17', releaseDate: '2024-09-20', eolFrom: '2029-11-08' }, // same label
    { name: '9', label: '9', releaseDate: '2010-09-20', eolFrom: '2015-11-08' }, // ended too long ago
    { name: '8', label: '8', releaseDate: null, eolFrom: null }, // no release date
  ];
  const versions = versionsOfReleases(releases, '2026-10-17', 'postgresql');
  assert.deepEqual(versions, [
    { key: '19', label: '19', cpe_version: null, build_prefixes: [], release_date: '2026-09-25', standard_support_end: '2028-01-01', extended_support_end: '2031-11-13' },
    { key: '18', label: '18', cpe_version: null, build_prefixes: [], release_date: '2025-09-25', standard_support_end: '2030-11-14', extended_support_end: '2032-11-14' },
    { key: '17.4', label: '17', cpe_version: null, build_prefixes: ['17.4'], release_date: '2024-09-26', standard_support_end: '2029-11-08', extended_support_end: null },
  ]);
  const many = Array.from({ length: 12 }, (_, i) => ({ name: `${i + 1}`, label: `${i + 1}`, releaseDate: `20${10 + i}-01-01`, eolFrom: '2030-01-01' }));
  assert.equal(versionsOfReleases(many, '2026-10-17', 'x').length, 8, 'at most eight versions');
}

/** What endoflife.date may send that the cache must never hold (C4 review, finding 1 and 5). */
function testInvalidReleasesAreLeftOut() {
  assert.equal(realDay('2031-02-30'), null);
  assert.equal(realDay('2028-02-29'), '2028-02-29');
  assert.equal(realDay('1989-12-31'), null);
  assert.equal(realDay('2026-1-01'), null);
  const reasons: string[] = [];
  const versions = versionsOfReleases([
    { name: '99', label: '99', releaseDate: '2026-09-01', eolFrom: '2031-02-30' },
    { name: ' ', releaseDate: '2026-08-01', eolFrom: '2031-01-01' },
    { name: 98 as unknown as string, releaseDate: '2026-07-01' },
    { name: '97', label: '()', releaseDate: '2026-06-01', eolFrom: '2031-01-01' },
    { name: 'x'.repeat(101), releaseDate: '2026-05-01' },
    { name: '96', label: '96', releaseDate: '2026-04-31' },
    { name: '95', label: '95', releaseDate: '2026-04-01', eolFrom: '2030-01-01' },
    { name: '95', label: '95 again', releaseDate: '2026-03-01', eolFrom: '2030-01-01' },
  ], '2026-10-17', 'postgresql', (reason) => reasons.push(reason));
  assert.deepEqual(versions.map((x) => x.key), ['97', '95'], 'only the usable cycles are kept, one per key');
  assert.equal(versions[0].label, '97', 'a label empty once cleaned falls back to the name');
  assert.equal(reasons.length, 5, reasons.join(' | '));
  assert.ok(versions.every(validCatalogVersion));
  const many = Array.from({ length: MAX_RELEASES + 20 }, (_, i) => ({ name: `${i}`, releaseDate: '2026-01-01', eolFrom: '2030-01-01' }));
  const cut: string[] = [];
  versionsOfReleases(many, '2026-10-17', 'x', (reason) => cut.push(reason));
  assert.ok(cut.some((reason) => reason.includes('20 release cycle(s)')));
  assert.equal(validCatalogVersion({ key: '1', label: ' ', cpe_version: null, build_prefixes: [], standard_support_end: null }), false);
  assert.equal(validCatalogVersion({ key: '1', label: '1', cpe_version: null, build_prefixes: [], standard_support_end: '2031-02-30' }), false);
}

/** `cleanLabel` gives what the script's regular expressions give, in linear time. */
function testCleanLabel() {
  const script = (label: unknown, name: unknown) => {
    const text = String(label ?? name ?? '').replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s*'.*?'\s*/g, ' ').replace(/\s+/g, ' ').trim();
    return text || String(name);
  };
  const samples = ["2022 'Dallas'", '24 (LTS)', 'a (b (c) d) e', 'x (unclosed', "it's 'quoted' twice 'here'", '(only)', 'a(b)c', 'one (two\nthree) four', '  spaced   out  ', "'", '((a))'];
  for (const sample of samples) assert.equal(cleanLabel(sample, 'n'), script(sample, 'n'), JSON.stringify(sample));
  for (const shipped of new TechnologyCatalogService({} as any, {} as any).all()) {
    for (const version of shipped.versions) assert.equal(cleanLabel(version.label, version.key), script(version.label, version.key));
  }
  const started = Date.now();
  cleanLabel(`${'('.repeat(200_000)}${' '.repeat(200_000)}`, 'n');
  assert.ok(Date.now() - started < 1000, `linear on a long label (${Date.now() - started} ms)`);
}

function v(key: string, release: string, standard: string | null, extra: Partial<CatalogVersion> = {}): CatalogVersion {
  return { key, label: key, cpe_version: null, build_prefixes: [], release_date: release, standard_support_end: standard, extended_support_end: null, ...extra };
}

function testMerge() {
  const fromFile = [v('2.0', '2024-01-01', '2026-01-01', { cpe_version: '2.0-curated' }), v('1.0', '2020-01-01', '2023-01-01')];
  assert.deepEqual(mergeVersions(fromFile, null), fromFile, 'without the cache, the shipped versions');
  const live = [v('3.0', '2026-06-01', '2029-01-01'), v('2.0', '2024-01-01', '2027-06-30'), v('2.0b', '2024-02-01', null, { label: '2.0' })];
  const merged = mergeVersions(fromFile, live);
  assert.deepEqual(merged.map((m) => [m.key, m.standard_support_end, m.cpe_version]), [
    ['3.0', '2029-01-01', null],
    ['2.0', '2027-06-30', '2.0-curated'],
    ['1.0', '2023-01-01', null],
  ], 'a new cycle is added, a shipped one takes the new dates and keeps its NVD version, one no longer listed stays, one label once');
}

/** SQL Server: a release the living catalog adds receives its own CPE product, read by the C3 rule. */
function testProductPerRelease() {
  assert.equal(releaseProduct('mssqlserver', '2028'), 'a:microsoft:sql_server_2028');
  assert.equal(releaseProduct('mssqlserver', '2019 CU15'), 'a:microsoft:sql_server_2019');
  assert.equal(releaseProduct('mssqlserver', '20280'), null);
  assert.equal(releaseProduct('postgresql', '2028'), null);
  const sql = shipped.find((p) => p.key === 'mssqlserver')!;
  for (const version of sql.versions) {
    const product = releaseProduct('mssqlserver', version.label);
    if (product && Number(version.label.slice(0, 4)) >= 2016) assert.ok(sql.cpe_products.includes(product), `${version.label}: the rule names the shipped product`);
  }
  const live = versionsOfReleases([{ name: '18.0', label: '2028', releaseDate: '2026-10-01', eolFrom: '2034-01-01' }], '2026-10-17', 'mssqlserver');
  const merged = mergeProduct(sql, live);
  assert.ok(merged.cpe_products.includes('a:microsoft:sql_server_2028'));
  assert.deepEqual(merged.cpe_products.filter((p) => !sql.cpe_products.includes(p)), ['a:microsoft:sql_server_2028'], 'only the new release brings one');
  const added = merged.versions.find((v) => v.key === '18.0')!;
  assert.deepEqual([added.label, added.cpe_version, added.build_prefixes], ['2028', null, ['18.0']]);
  const criterion = { version_exact: null, version_start: '18.0.1000.0', start_including: true, version_end: '18.0.1105.2', end_including: false };
  assert.equal(versionMatches(added, 'a:microsoft:sql_server_2028', criterion), 'in_range', 'the C3 rule applies the product to the 2028 release');
  assert.equal(versionMatches(sql.versions.find((v) => v.label.startsWith('2025'))!, 'a:microsoft:sql_server_2028', criterion), 'out');
  assert.deepEqual(mergeProduct(sql, []).cpe_products, sql.cpe_products);
}

function testSlug() {
  const byKey = new Map(shipped.map((p) => [p.key, p]));
  assert.equal(endoflifeSlug(byKey.get('vsphere')!), 'vcenter');
  assert.equal(endoflifeSlug(byKey.get('active-directory')!), null, 'an entry written by hand is not read');
}

/** `TECHNOLOGY_CATALOG_SYNC_ENABLED`: on by default in the cloud, off on-premise, given to the frontend. */
function testFeatureGate() {
  const initial = Features.TECHNOLOGY_CATALOG_SYNC_ENABLED;
  try {
    if (!(process.env.TECHNOLOGY_CATALOG_SYNC_ENABLED ?? '').trim()) {
      assert.equal(initial, !Features.SINGLE_TENANT, 'on by default in the cloud, off by default on-premise');
    }
    Features.TECHNOLOGY_CATALOG_SYNC_ENABLED = false;
    assert.equal(new ConfigController().getPublicConfig().features.technologyCatalogSync, false);
    Features.TECHNOLOGY_CATALOG_SYNC_ENABLED = true;
    assert.equal(new ConfigController().getPublicConfig().features.technologyCatalogSync, true);
  } finally {
    Features.TECHNOLOGY_CATALOG_SYNC_ENABLED = initial;
  }
}

/**
 * Operating systems keep the meaning of the former IT settings catalog, in the living catalog as
 * in the script (`SUPPORT_RULES`, twins): Ubuntu, RHEL and SLES standard = end of security fixes,
 * extended = paid extension; Windows Server and Debian standard = mainstream or regular security
 * support, extended = extended support or LTS (the paid ESU and ELTS are left out). Without the same rule here, the first sync would undo the shipped dates.
 */
function testOperatingSystemSupportDates() {
  const dates = (key: string, release: Record<string, unknown>) => {
    const [version] = versionsOfReleases([{ name: '1', label: '1', releaseDate: '2022-04-21', ...release }], '2026-10-18', key);
    return [version.standard_support_end, version.extended_support_end];
  };
  const ubuntu = { eoasFrom: '2024-09-30', eolFrom: '2027-06-01', eoesFrom: '2032-04-21', isLts: true };
  assert.deepEqual(dates('ubuntu', ubuntu), ['2027-06-01', '2032-04-21']);
  assert.deepEqual(dates('rhel', { eoasFrom: '2019-08-06', eolFrom: '2024-06-30', eoesFrom: '2029-05-31' }), ['2024-06-30', '2029-05-31']);
  assert.deepEqual(dates('centos', { eoasFrom: '2020-08-06', eolFrom: '2024-06-30' }), ['2024-06-30', null], 'no paid extension, no extended date');
  assert.deepEqual(dates('sles', { eolFrom: '2024-10-31', eoesFrom: '2027-10-31' }), ['2024-10-31', '2027-10-31']);
  assert.deepEqual(dates('windows-server', { eoasFrom: '2022-01-11', eolFrom: '2027-01-12', eoesFrom: '2030-01-12' }), ['2022-01-11', '2027-01-12']);
  assert.deepEqual(dates('debian', { eoasFrom: '2026-06-10', eolFrom: '2028-06-30', eoesFrom: '2033-06-30' }), ['2026-06-10', '2028-06-30'], 'Debian: regular security support, then LTS');
  // Every other product keeps the catalog convention: active support, then the paid extension.
  assert.deepEqual(dates('nginx', ubuntu), ['2024-09-30', '2032-04-21']);
  assert.deepEqual(dates('postgresql', { eolFrom: '2029-11-08' }), ['2029-11-08', null]);
  // Every shipped operating system has a rule.
  const osKeys = shipped.filter((product) => product.family === 'operating_system').map((product) => product.key).sort();
  assert.deepEqual(osKeys, Object.keys(SUPPORT_RULES).sort());
}

/**
 * Operating systems (lot T3, second test round): every version whose support ended in 2010 or
 * later, however many; Windows Server long-term releases only, without the service pack in the
 * label; Ubuntu LTS releases only; SLES service packs as `11 SP4`, `12` for `12.0`.
 */
function testOperatingSystemReleases() {
  const today = '2026-10-18';
  const labels = (key: string, releases: Array<Record<string, unknown>>) => versionsOfReleases(releases, today, key).map((x) => `${x.key}=${x.label}`);

  // The window: a last support ending on 2010-01-01 stays, one the day before goes, whatever the count.
  const window = [
    { name: '4', label: '4', releaseDate: '2005-02-15', eolFrom: '2009-12-31' },
    { name: '5', label: '5', releaseDate: '2007-03-15', eoasFrom: '2008-01-01', eolFrom: '2009-01-01', eoesFrom: '2010-01-01' },
    ...Array.from({ length: 10 }, (_, i) => ({ name: `${10 + i}`, label: `${10 + i}`, releaseDate: `20${10 + i}-01-01`, eolFrom: '2015-01-01' })),
  ];
  const rhel = versionsOfReleases(window, today, 'rhel');
  assert.equal(rhel.length, 11, `more than ${MAX_VERSIONS} versions for an operating system`);
  assert.ok(rhel.some((x) => x.key === '5'), 'an extended support ending on 2010-01-01 is kept');
  assert.ok(!rhel.some((x) => x.key === '4'), 'a support ended before 2010 is left out');
  assert.equal(versionsOfReleases(window, today, 'postgresql').length, 0, 'other families keep the four-year window');

  // Windows Server: long-term releases, service pack dropped, one 2003.
  assert.deepEqual(labels('windows-server', [
    { name: '2025', label: 'Windows Server 2025 (LTSC)', releaseDate: '2024-11-01', eoasFrom: '2029-11-13', eolFrom: '2034-11-14' },
    { name: '23h2-ac', label: 'Windows Server 23H2 AC', releaseDate: '2023-10-24', eoasFrom: '2026-05-12', eolFrom: '2026-05-12' },
    { name: '1809-sac', label: 'Windows Server 1809 SAC', releaseDate: '2018-11-13', eoasFrom: '2020-11-10', eolFrom: '2020-11-10' },
    { name: '2008-r2-sp1', label: 'Windows Server 2008 R2 SP1 (LTSC)', releaseDate: '2011-02-22', eoasFrom: '2015-01-13', eolFrom: '2020-01-14' },
    { name: '2008-sp2', label: 'Windows Server 2008 SP2 (LTSC)', releaseDate: '2009-04-29', eoasFrom: '2015-01-13', eolFrom: '2020-01-14' },
    { name: '2003-sp2', label: 'Windows Server 2003 SP2 (LTSC)', releaseDate: '2007-03-13', eoasFrom: '2010-07-13', eolFrom: '2015-07-14' },
    { name: '2003-sp1', label: 'Windows Server 2003 SP1', releaseDate: '2005-03-30', eoasFrom: '2009-04-14', eolFrom: '2012-04-14' },
    { name: '2003', label: 'Windows Server 2003 (LTSC)', releaseDate: '2003-04-24', eoasFrom: '2007-04-10', eolFrom: '2011-04-10' },
    { name: '2000', label: 'Windows Server 2000 (LTSC)', releaseDate: '2000-02-17', eoasFrom: '2005-06-30', eolFrom: '2010-07-13' },
  ]), ['2025=2025', '2008-r2-sp1=2008 R2', '2008-sp2=2008', '2003-sp2=2003', '2000=2000']);

  // Ubuntu: the LTS releases only.
  assert.deepEqual(labels('ubuntu', [
    { name: '24.10', label: "24.10 'Oracular Oriole'", isLts: false, releaseDate: '2024-10-10', eolFrom: '2025-07-10' },
    { name: '24.04', label: "24.04 'Noble Numbat' (LTS)", isLts: true, releaseDate: '2024-04-25', eolFrom: '2029-05-31', eoesFrom: '2034-04-25' },
    { name: '6.06', label: "6.06 'Dapper Drake' (LTS)", isLts: true, releaseDate: '2006-06-01', eolFrom: '2011-06-01' },
    { name: '5.10', label: "5.10 'Breezy Badger'", releaseDate: '2005-10-12', eolFrom: '2011-04-13' },
  ]), ['24.04=24.04 LTS', '6.06=6.06 LTS']);

  // SLES: service packs, and the first release of a major version without `.0`.
  assert.deepEqual(labels('sles', [
    { name: '16.0', label: '16.0', releaseDate: '2025-11-04', eolFrom: '2027-11-30', eoesFrom: '2030-11-30' },
    { name: '15.0', label: '15.0', releaseDate: '2018-07-16', eolFrom: '2019-12-31', eoesFrom: '2022-12-31' },
    { name: '11.4', label: '11.4', releaseDate: '2015-07-15', eolFrom: '2019-03-31', eoesFrom: '2022-03-31' },
    { name: '12.0', label: '12.0', releaseDate: '2014-10-27', eolFrom: '2016-06-30', eoesFrom: '2019-07-01' },
    { name: '10.4', label: '10.4', releaseDate: '2011-04-12', eolFrom: '2013-07-31', eoesFrom: '2016-07-30' },
  ]), ['16.0=16', '15.0=15', '11.4=11 SP4', '12.0=12', '10.4=10 SP4']);

  // Debian keeps its code name.
  assert.deepEqual(labels('debian', [{ name: '7', label: '7 (Wheezy)', releaseDate: '2013-05-04', eoasFrom: '2016-04-25', eolFrom: '2018-05-31' }]), ['7=7 (Wheezy)']);

  // The shipped catalog follows the same rules.
  const byKey = new Map(shipped.map((p) => [p.key, p]));
  const shippedLabels = (key: string) => byKey.get(key)!.versions.map((x) => x.label);
  assert.ok(['2000', '2003', '2008', '2008 R2', '2012 R2', '2025'].every((label) => shippedLabels('windows-server').includes(label)));
  assert.ok(!shippedLabels('windows-server').some((label) => /\b(AC|SAC|SP\d+)$/.test(label)), 'no channel release, no service pack');
  assert.ok(shippedLabels('ubuntu').every((label) => label.endsWith(' LTS')));
  assert.ok(['10 SP4', '11 SP4', '12', '12 SP5', '15', '15 SP7'].every((label) => shippedLabels('sles').includes(label)));
}

/**
 * Operating systems (lot V3). Identifiers checked at the NVD. Windows Server is one product per
 * long-term release from 2003; a release the living catalog adds receives the next year, and
 * Windows 2000 does not (`windows_2000` is not `windows_server_2000`). The CPE version stays the
 * one the labels already gave: null when the label is the version, `22.04` for Ubuntu LTS, the
 * major for Debian. 2012 and 2012 R2 share `windows_server_2012`.
 */
function testOperatingSystemCpe() {
  const byKey = new Map(shipped.map((p) => [p.key, p]));
  const ids = (key: string) => byKey.get(key)!.cpe_products;
  assert.deepEqual(ids('ubuntu'), ['o:canonical:ubuntu_linux']);
  assert.deepEqual(ids('rhel'), ['o:redhat:enterprise_linux']);
  assert.deepEqual(ids('debian'), ['o:debian:debian_linux']);
  assert.deepEqual(ids('almalinux'), ['o:almalinux:almalinux']);
  assert.deepEqual(ids('oracle-linux'), ['o:oracle:linux']);
  assert.deepEqual(ids('centos'), ['o:centos:centos']);
  assert.deepEqual(ids('rocky-linux'), ['o:resf:rocky_linux']);
  assert.deepEqual(ids('sles'), [], 'the service pack is the CPE update, which the matching does not read');
  assert.deepEqual(ids('windows-server'), [
    'o:microsoft:windows_server_2003',
    'o:microsoft:windows_server_2008',
    'o:microsoft:windows_server_2012',
    'o:microsoft:windows_server_2016',
    'o:microsoft:windows_server_2019',
    'o:microsoft:windows_server_2022',
    'o:microsoft:windows_server_2025',
  ]);

  const windows = byKey.get('windows-server')!;
  const version = (label: string) => windows.versions.find((v) => v.label === label)!;
  assert.equal(version('2019').cpe_version, null, 'the NVD build is not stored');
  assert.equal(version('2025').cpe_version, null);
  assert.equal(version('2012 R2').cpe_version, '2012');
  assert.equal(version('2008 R2').cpe_version, '2008');
  assert.equal(byKey.get('ubuntu')!.versions.find((v) => v.label === '22.04 LTS')!.cpe_version, '22.04');
  assert.equal(byKey.get('debian')!.versions.find((v) => v.label.startsWith('12 '))!.cpe_version, '12');
  assert.equal(byKey.get('rhel')!.versions.find((v) => v.label === '9')!.cpe_version, null);
  for (const shippedVersion of windows.versions) {
    const product = releaseProduct('windows-server', shippedVersion.label);
    if (product) assert.ok(windows.cpe_products.includes(product), `${shippedVersion.label} names a shipped product`);
  }
  assert.equal(releaseProduct('windows-server', '2000'), null);
  assert.equal(releaseProduct('windows-server', '2012 R2'), 'o:microsoft:windows_server_2012');
  assert.equal(releaseProduct('windows-server', '2028'), 'o:microsoft:windows_server_2028');

  const live = versionsOfReleases(
    [{ name: '2028', label: 'Windows Server 2028 (LTSC)', releaseDate: '2027-11-01', eoasFrom: '2032-11-01', eolFrom: '2037-11-01' }],
    '2027-11-02',
    'windows-server',
  );
  const merged = mergeProduct(windows, live);
  assert.deepEqual(merged.cpe_products.filter((p) => !windows.cpe_products.includes(p)), ['o:microsoft:windows_server_2028']);
  assert.ok(!merged.cpe_products.some((p) => p.endsWith('_2000')));
  const added = merged.versions.find((v) => v.label === '2028')!;
  const bound = { version_exact: null, version_start: null, start_including: null, version_end: '10.0.99999.1', end_including: false };
  assert.equal(versionMatches(added, 'o:microsoft:windows_server_2028', bound), 'in_range');
  assert.equal(versionMatches(version('2025'), 'o:microsoft:windows_server_2028', bound), 'out');

  // The branch the matching compares is the same number on the catalog entry and on the CPE product.
  const precision: Array<[string, number]> = [
    ['rhel', 1], ['debian', 1], ['oracle-linux', 1], ['almalinux', 1], ['rocky-linux', 1], ['centos', 1], ['ubuntu', 2],
  ];
  const branched = new Set<string>();
  for (const [key, segments] of precision) {
    assert.equal(versionPrecisionOf(key), segments, key);
    for (const id of ids(key)) {
      assert.equal(VERSION_PRECISION[id], segments, id);
      branched.add(id);
    }
  }
  for (const id of Object.keys(VERSION_PRECISION)) assert.ok(branched.has(id), `${id} is a shipped operating-system product`);
  assert.equal(versionPrecisionOf('windows-server'), null);
  assert.equal(versionPrecisionOf('mssqlserver'), null);
  assert.equal(versionPrecisionOf('postgresql'), null);
}

function main() {
  testCpeVersionMatchesTheShippedCatalog();
  testVersionsOfReleases();
  testInvalidReleasesAreLeftOut();
  testCleanLabel();
  testMerge();
  testSlug();
  testProductPerRelease();
  testFeatureGate();
  testOperatingSystemSupportDates();
  testOperatingSystemReleases();
  testOperatingSystemCpe();
  console.log('catalog-releases.spec: ok');
}

main();
