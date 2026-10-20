// @database-spec
import 'dotenv/config';
import type { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { assert, inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { TechnologyCatalogSyncService } from '../catalog/technology-catalog-sync.service';
import type { CatalogProduct, CatalogVersion } from '../catalog/technology-catalog.service';
import { asset, installed, services, technology } from './technologies.fixtures';
import { VulnerabilityMatchService } from '../../vulnerabilities/vulnerability-match.service';

// An operating system adopted before its CPE identifiers (lot V3): the living catalog adds them,
// and the matching keeps a simulated CVE on the version the criterion names. When
// `vulnerability_alerts` exists (lot V1), the fixture sets it false and the sync must leave it.

const UBUNTU_CVE = 'CVE-2099-31001';
const WINDOWS_CVE = 'CVE-2099-31002';
const matcher = new VulnerabilityMatchService();

function preLotState(product: CatalogProduct) {
  return {
    cpe_products: [] as string[],
    versions: Object.fromEntries(product.versions.map((version) => [version.key, {
      standard_support_end: version.standard_support_end,
      extended_support_end: version.extended_support_end,
      cpe_version: version.cpe_version,
    }])),
  };
}

async function putVersion(runner: QueryRunner, tenantId: string, technologyId: string, productKey: string, version: CatalogVersion) {
  const [row] = await runner.query(
    `INSERT INTO technology_versions (
       tenant_id, technology_id, label, cpe_version, build_prefixes, standard_support_end, extended_support_end, catalog_key
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      tenantId, technologyId, version.label, version.cpe_version, version.build_prefixes ?? [],
      version.standard_support_end, version.extended_support_end, `${productKey}:${version.key}`,
    ],
  );
  return row.id as string;
}

/** The technology as lot T3 left it: catalog key, versions, and no CPE identifier. */
async function adoptedBefore(runner: QueryRunner, tenantId: string, number: number, product: CatalogProduct) {
  const id = await technology(runner, tenantId, number, product.name, 'operating_system');
  await runner.query(
    `UPDATE technologies
        SET editor = $2, catalog_key = $3, cpe_products = '{}', description = $4, catalog_state = $5::jsonb
      WHERE id = $1`,
    [id, product.editor, product.key, 'Adopted before CPE identifiers.', JSON.stringify(preLotState(product))],
  );
  const ids = new Map<string, string>();
  for (const version of product.versions) ids.set(version.key, await putVersion(runner, tenantId, id, product.key, version));
  return { id, ids };
}

async function cve(runner: QueryRunner, id: string, product: string, exact: string | null, end: string | null) {
  await runner.query(
    `INSERT INTO vulnerability_cves (cve_id, summary, cvss_score, severity, cvss_version, published_at, nvd_status)
     VALUES ($1, 'Spec flaw', 7.5, 'high', '3.1', '2099-01-01', 'Analyzed')`,
    [id],
  );
  await runner.query(
    `INSERT INTO vulnerability_cve_matches (cve_id, product, criteria, version_exact, version_end, end_including, vulnerable)
     VALUES ($1, $2, 'cpe:2.3:' || $2 || ':*', $3, $4, $5, true)`,
    [id, product, exact, end, end ? false : null],
  );
}

async function testAdoptedOperatingSystemGainsCpe() {
  await inRolledBackTransaction(async (runner) => {
    const { catalog } = services();
    const sync = new TechnologyCatalogSyncService(
      dataSource,
      { register: () => undefined } as any,
      catalog,
      { log: async () => undefined } as any,
    );
    const tenantId = await seedTenant(runner, 'os-cpe');
    const ubuntu = catalog.shippedProduct('ubuntu')!;
    const windows = catalog.shippedProduct('windows-server')!;
    const ubuntuTech = await adoptedBefore(runner, tenantId, 1, ubuntu);
    const windowsTech = await adoptedBefore(runner, tenantId, 2, windows);
    const products = new Map<string, CatalogProduct>([['ubuntu', ubuntu], ['windows-server', windows]]);
    const osIds = [ubuntuTech.id, windowsTech.id];

    // Lot V1's column is NOT NULL DEFAULT true, and this fixture inserts the row itself, so the
    // operating-system default never applies. Set the exclusion the migration's backfill sets, and
    // check the sync leaves it. Without the column (this branch, before V1), skip the assertion.
    const [column] = await runner.query(
      `SELECT 1 AS present FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'technologies' AND column_name = 'vulnerability_alerts'`,
    );
    if (column) {
      await runner.query(`UPDATE technologies SET vulnerability_alerts = false WHERE id = ANY($1::uuid[])`, [osIds]);
    }
    const alertsBefore = column
      ? await runner.query(`SELECT vulnerability_alerts FROM technologies WHERE id = ANY($1::uuid[]) ORDER BY item_number`, [osIds])
      : [];

    const result = await sync.syncTenant(runner.manager, tenantId, products);
    assert.equal(result.cpe_added, ubuntu.cpe_products.length + windows.cpe_products.length);
    assert.equal(result.versions_added, 0, 'the versions were already offered');
    assert.deepEqual(result.errors, []);

    const [ubuntuRow] = await runner.query(`SELECT cpe_products FROM technologies WHERE id = $1`, [ubuntuTech.id]);
    const [windowsRow] = await runner.query(`SELECT cpe_products FROM technologies WHERE id = $1`, [windowsTech.id]);
    assert.deepEqual(ubuntuRow.cpe_products, ['o:canonical:ubuntu_linux']);
    assert.deepEqual(windowsRow.cpe_products, windows.cpe_products);
    assert.ok(!windowsRow.cpe_products.some((p: string) => p.endsWith('_2000') || p.endsWith(':windows_2000')));

    const again = await sync.syncTenant(runner.manager, tenantId, products);
    assert.equal(again.cpe_added, 0, 'a second pass adds nothing');

    if (column) {
      const alertsAfter = await runner.query(
        `SELECT vulnerability_alerts FROM technologies WHERE id = ANY($1::uuid[]) ORDER BY item_number`,
        [osIds],
      );
      assert.deepEqual(alertsBefore.map((row: { vulnerability_alerts: boolean }) => row.vulnerability_alerts), [false, false]);
      assert.deepEqual(alertsAfter, alertsBefore, 'the sync leaves the operating systems out of the alerts');
    }

    const srv2204 = await asset(runner, tenantId, 'ubuntu-2204');
    const srv2404 = await asset(runner, tenantId, 'ubuntu-2404');
    const srv2019 = await asset(runner, tenantId, 'windows-2019');
    const srv2022 = await asset(runner, tenantId, 'windows-2022');
    await installed(runner, tenantId, srv2204, ubuntuTech.id, ubuntuTech.ids.get('22.04')!);
    await installed(runner, tenantId, srv2404, ubuntuTech.id, ubuntuTech.ids.get('24.04')!);
    await installed(runner, tenantId, srv2019, windowsTech.id, windowsTech.ids.get('2019')!);
    await installed(runner, tenantId, srv2022, windowsTech.id, windowsTech.ids.get('2022')!);
    await cve(runner, UBUNTU_CVE, 'o:canonical:ubuntu_linux', '22.04', null);
    await cve(runner, WINDOWS_CVE, 'o:microsoft:windows_server_2019', null, '10.0.17763.9376');

    const matched = await matcher.matchTenant(runner.manager, tenantId);
    assert.equal(matched.added, 2);
    const rows: Array<{ technology_id: string; technology_version_id: string; cve_id: string; match_basis: string }> = await runner.query(
      `SELECT technology_id, technology_version_id, cve_id, match_basis FROM technology_vulnerabilities WHERE tenant_id = $1 ORDER BY cve_id`,
      [tenantId],
    );
    assert.deepEqual(rows, [
      { technology_id: ubuntuTech.id, technology_version_id: ubuntuTech.ids.get('22.04'), cve_id: UBUNTU_CVE, match_basis: 'version_in_range' },
      { technology_id: windowsTech.id, technology_version_id: windowsTech.ids.get('2019'), cve_id: WINDOWS_CVE, match_basis: 'version_in_range' },
    ]);
  });
}

void runSpecs('operating system CPE', [
  ['an operating system adopted before the identifiers gains them', testAdoptedOperatingSystemGainsCpe],
]);
