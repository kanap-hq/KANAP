import * as assert from 'node:assert/strict';
import { ConfigController } from '../../config/config.controller';
import { Features } from '../../config/features';
import { cleanLabel, cpeVersionOf, endoflifeSlug, MAX_RELEASES, mergeProduct, mergeVersions, realDay, releaseProduct, validCatalogVersion, versionsOfReleases } from '../catalog/catalog-releases';
import { versionMatches } from '../../vulnerabilities/vulnerability-rules';
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

function main() {
  testCpeVersionMatchesTheShippedCatalog();
  testVersionsOfReleases();
  testInvalidReleasesAreLeftOut();
  testCleanLabel();
  testMerge();
  testSlug();
  testProductPerRelease();
  testFeatureGate();
  console.log('catalog-releases.spec: ok');
}

main();
