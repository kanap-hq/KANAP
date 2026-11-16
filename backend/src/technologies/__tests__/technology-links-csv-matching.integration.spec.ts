// @database-spec
import 'dotenv/config';
import type { QueryRunner } from 'typeorm';
import { DEFAULT_HOSTING_TYPES, DEFAULT_TECHNOLOGY_FAMILIES } from '../../it-ops-settings/it-ops-settings.service';
import { assert, inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { TechnologyCatalogService } from '../catalog/technology-catalog.service';
import { OperatingSystemService } from '../operating-system.service';
import { TechnologyLinksCsvService, type TechnologyLinksImportResult } from '../technology-links-csv.service';
import { TechnologyLinksService } from '../technology-links.service';
import { TechnologyReachService } from '../technology-reach.service';
import { application, asset, technology, version } from './technologies.fixtures';

// Lot I3 of 26.11.9: the files of links find a server, an application and a technology by name
// exactly, then case aside (several names refuse the row, as before), then accents aside for a
// person who reads them (several: `CSV_NAME_AMBIGUOUS_AMONG`); a version by its label, else by the
// prefix rule (`22.04` for `22.04 LTS`). Each match beyond case is listed and may be undone
// (`unmatched`); Kad's proposals are taken for a record the person reads, else refused.

const ASSETS = 'asset_reference,asset_name,technology_reference,technology_name,version,operating_system,notes';
const APPS = 'application_reference,application_name,technology_reference,technology_name,version,notes';
const ADMIN = { isAdmin: true };
const INFRA_ONLY = { isAdmin: false, permissions: { infrastructure: 'member' } };

function service() {
  const audit = { log: async () => undefined };
  const itOps = { getSettings: async () => ({ technologyFamilies: DEFAULT_TECHNOLOGY_FAMILIES, hostingTypes: DEFAULT_HOSTING_TYPES }) };
  const links = new TechnologyLinksService(audit as any, new TechnologyReachService(), itOps as any);
  return new TechnologyLinksCsvService(links, new OperatingSystemService(audit as any, itOps as any, new TechnologyCatalogService(audit as any, itOps as any)));
}

function csvFile(lines: string[]): Express.Multer.File {
  return { buffer: Buffer.from(lines.join('\n'), 'utf8'), originalname: 'links.csv' } as Express.Multer.File;
}

const codes = (result: TechnologyLinksImportResult) => result.errors.map((error) => [error.row, error.column, error.code, error.params]);
const listed = (result: TechnologyLinksImportResult) =>
  (result.matches ?? []).map((match) => `${match.column}:${match.value}>${match.target}:${match.reason}:${match.origin}:${match.lines.join('|')}`);

async function storedVersions(runner: QueryRunner, tenantId: string): Promise<string[]> {
  const rows: Array<{ pair: string }> = await runner.query(
    `SELECT a.name || '/' || t.name || '/' || COALESCE(v.label, '') AS pair
       FROM asset_technologies at
       JOIN assets a ON a.id = at.asset_id
       JOIN technologies t ON t.id = at.technology_id
       LEFT JOIN technology_versions v ON v.id = at.technology_version_id
      WHERE at.tenant_id = $1 ORDER BY 1`,
    [tenantId],
  );
  return rows.map((row) => row.pair);
}

async function testServerLinks() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'links-csv-matching');
    const csv = service();
    const ctx = { manager: runner.manager, tenantId, userId: null };
    await asset(runner, tenantId, 'Serveur Comptabilité');
    await asset(runner, tenantId, 'Base Équipe');
    await asset(runner, tenantId, 'Base Equipé');
    const ubuntu = await technology(runner, tenantId, 1, 'Ubuntu Serveur', 'operating_system');
    await version(runner, tenantId, ubuntu, '22.04 LTS');
    await technology(runner, tenantId, 2, 'Pilote réseau');
    const file = csvFile([
      ASSETS,
      ',Serveur Comptabilite,,Ubuntu Serveur,22.04,,',
      ',SERVEUR COMPTABILITÉ,,Pilote reseau,,no,',
      ',Base Equipe,,Ubuntu Serveur,,,',
      ',Serveur Comptabilité,,Ubuntu Serveur,22.04.3 LTS,no,',
    ]);
    const check = await csv.importAssetLinks({ file, dryRun: true, language: 'en', access: ADMIN }, ctx);
    assert.deepEqual(codes(check).map(([row, column, code]) => [row, column, code]), [[4, 'asset_name', 'CSV_NAME_AMBIGUOUS_AMONG']]);
    assert.deepEqual(String(check.errors[0].params?.names).split(', ').sort(), ['AST-2', 'AST-3'], 'the servers are named by their references');
    assert.deepEqual(listed(check), [
      'asset_name:Serveur Comptabilite>Serveur Comptabilité:accents:server:2',
      'version:22.04>22.04 LTS:version:server:2',
      'technology_name:Pilote reseau>Pilote réseau:accents:server:3',
    ]);
    assert.deepEqual(check.warnings.filter((w) => w.code === 'CSV_TECHNOLOGY_VERSION_CREATED').map((w) => [w.row, w.params]), [[5, { value: '22.04.3 LTS' }]]);

    const clean = csvFile([ASSETS, ',Serveur Comptabilite,,Ubuntu Serveur,22.04,,', ',Serveur Comptabilité,,Ubuntu Serveur,22.04.3 LTS,no,']);
    const load = await csv.importAssetLinks({ file: clean, dryRun: false, language: 'en', access: ADMIN }, ctx);
    assert.equal(load.ok, true, JSON.stringify(load.errors));
    assert.deepEqual(await storedVersions(runner, tenantId), [
      'Serveur Comptabilité/Ubuntu Serveur/22.04 LTS',
      'Serveur Comptabilité/Ubuntu Serveur/22.04.3 LTS',
    ]);

    // The same file again: nothing new. Undone, the version is created as written.
    const again = await csv.importAssetLinks({ file: clean, dryRun: true, language: 'en', access: ADMIN }, ctx);
    assert.equal(again.unchanged, 2, JSON.stringify(again));
    const undone = await csv.importAssetLinks({
      file: csvFile([ASSETS, ',Serveur Comptabilite,,Ubuntu Serveur,22.04,no,']), dryRun: false, language: 'en', access: ADMIN,
      unmatched: [{ column: 'version', value: '22.04' }, { column: 'asset_name', value: 'Serveur Comptabilite' }],
    }, ctx);
    assert.deepEqual(codes(undone), [[2, 'asset_name', 'CSV_REFERENCE_NOT_FOUND', { value: 'Serveur Comptabilite' }]], 'an undone server name is unknown');
    const versionUndone = await csv.importAssetLinks({
      file: csvFile([ASSETS, ',Serveur Comptabilité,,Ubuntu Serveur,22.04,no,']), dryRun: false, language: 'en', access: ADMIN,
      unmatched: [{ column: 'version', value: '22.04' }],
    }, ctx);
    assert.equal(versionUndone.ok, true, JSON.stringify(versionUndone.errors));
    assert.deepEqual(versionUndone.warnings.map((w) => w.code), ['CSV_TECHNOLOGY_VERSION_CREATED']);
    assert.equal((await storedVersions(runner, tenantId)).includes('Serveur Comptabilité/Ubuntu Serveur/22.04'), true, 'created as written');

    // Without the person's rights (an internal caller), names are found case aside only.
    const internal = await csv.importAssetLinks({ file: csvFile([ASSETS, ',Serveur Comptabilite,,Ubuntu Serveur,,no,']), dryRun: true, language: 'en' }, ctx);
    assert.deepEqual(codes(internal), [[2, 'asset_name', 'CSV_REFERENCE_NOT_FOUND', { value: 'Serveur Comptabilite' }]]);

    // Kad's proposal: taken for a server the person reads, refused otherwise.
    const proposed = await csv.importAssetLinks({
      file: csvFile([ASSETS, ',compta,,Ubuntu Serveur,,no,', ',inconnu,,Ubuntu Serveur,,no,']), dryRun: true, language: 'en', access: INFRA_ONLY,
      proposals: { asset_name: { compta: 'Serveur Comptabilité', inconnu: 'Serveur absent' } },
    }, ctx);
    assert.deepEqual(listed(proposed), ['asset_name:compta>Serveur Comptabilité:model:model:2']);
    assert.deepEqual(proposed.refusedProposals?.map((entry) => [entry.column, entry.value, entry.target, entry.reason]), [['asset_name', 'inconnu', 'Serveur absent', 'missing']]);
    assert.deepEqual(codes(proposed), [[3, 'asset_name', 'CSV_REFERENCE_NOT_FOUND', { value: 'inconnu' }]]);
  });
}

async function testApplicationLinks() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'links-csv-apps');
    const csv = service();
    const ctx = { manager: runner.manager, tenantId, userId: null };
    await application(runner, tenantId, 'Gestion des congés');
    await technology(runner, tenantId, 1, 'Moteur Java');
    const file = csvFile([APPS, ',Gestion des conges,,Moteur Java,,']);
    const reader = await csv.importApplicationLinks({ file, dryRun: true, language: 'en', access: { isAdmin: false, permissions: { infrastructure: 'member', applications: 'reader' } } }, ctx, {});
    assert.equal(reader.ok, true, JSON.stringify(reader.errors));
    assert.deepEqual(listed(reader), ['application_name:Gestion des conges>Gestion des congés:accents:server:2']);
    const noApps = await csv.importApplicationLinks({ file, dryRun: true, language: 'en', access: INFRA_ONLY }, ctx, {});
    assert.deepEqual(codes(noApps), [[2, 'application_name', 'CSV_REFERENCE_NOT_FOUND', { value: 'Gestion des conges' }]], 'without the applications right, case aside only');
  });
}

void runSpecs('technology-links-csv-matching.integration.spec.ts', [
  ['server links', testServerLinks],
  ['application links', testApplicationLinks],
]);
