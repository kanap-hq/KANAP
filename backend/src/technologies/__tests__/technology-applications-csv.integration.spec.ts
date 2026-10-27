// @database-spec
import 'dotenv/config';
import { csvProfile } from '../../common/csv-sheet/language';
import { assert, inRolledBackTransaction, runSpecs } from '../../spend/__tests__/round-inputs.fixtures';
import { assign, seedGraph, services } from './technologies.fixtures';
import { assertCsvGolden } from '../../common/csv/__tests__/export-golden';

// The export of a technology's Applications tab (lot T1b): headers, words, environments and
// criticality in the language asked, the criticality as the tenant's catalog names it.

/** The lines of the file as cells, without the BOM. */
function cells(content: string, language: 'en' | 'fr'): string[][] {
  const separator = csvProfile(language).separator;
  return content.replace(/^﻿/, '').trim().split(/\r?\n/).map((line) => line.split(separator).map((cell) => cell.replace(/^"|"$/g, '')));
}

async function seed(runner: Parameters<Parameters<typeof inRolledBackTransaction>[0]>[0], tag: string) {
  const g = await seedGraph(runner, tag);
  await runner.query(`UPDATE applications SET criticality = 'business_critical', external_facing = true WHERE tenant_id = $1 AND id = $2`, [g.tenantId, g.apps.erp]);
  await assign(runner, g.tenantId, g.apps.erp, g.ids.sqlCluster, 'pre_prod');
  return g;
}

async function testEnglishAndFrench() {
  await inRolledBackTransaction(async (runner) => {
    const g = await seed(runner, 'csv-lang');
    const { links } = services();
    const opts = { manager: runner.manager, tenantId: g.tenantId };

    const en = await links.applicationsCsv(g.tech.sql, 'en', opts, {});
    assertCsvGolden('technology-applications.en', en.content);
    assert.match(en.filename, /^TEC-\d+_applications\.csv$/);
    const enRows = cells(en.content, 'en');
    assert.deepEqual(enRows[0], ['Reference', 'Application', 'Link', 'Environment', 'Server', 'Installed on', 'Version', 'Criticality', 'External', 'IT owners', 'Notes']);
    const enErp = enRows.filter((row) => row[1].startsWith('ERP'));
    assert.deepEqual(new Set(enErp.map((row) => row[3])), new Set(['Prod', 'Pre-prod']), 'environments are named, not coded');
    assert.ok(enErp.every((row) => row[2] === 'Hosted' && row[7] === 'Critical' && row[8] === 'Yes'));
    const enPortal = enRows.find((row) => row[1].startsWith('Portal'))!;
    assert.deepEqual([enPortal[2], enPortal[6], enPortal[7], enPortal[8]], ['Declared', 'Version unknown', '', 'No']);

    const fr = await links.applicationsCsv(g.tech.sql, 'fr', opts, {});
    assertCsvGolden('technology-applications.fr', fr.content);
    const frRows = cells(fr.content, 'fr');
    assert.deepEqual(frRows[0], ['Référence', 'Application', 'Lien', 'Environnement', 'Serveur', 'Installée sur', 'Version', 'Criticité', 'Externe', 'Responsables IT', 'Notes']);
    const frErp = frRows.filter((row) => row[1].startsWith('ERP'));
    assert.deepEqual(new Set(frErp.map((row) => row[3])), new Set(['Prod', 'Pré-prod']));
    assert.ok(frErp.every((row) => row[2] === 'Hébergée' && row[7] === 'Critique' && row[8] === 'Oui'), 'the shipped level in French');
    const frPortal = frRows.find((row) => row[1].startsWith('Portal'))!;
    assert.deepEqual([frPortal[2], frPortal[6], frPortal[8]], ['Déclarée', 'Version inconnue', 'Non']);
    assert.ok(!fr.content.includes('business_critical') && !fr.content.includes('pre_prod'), 'no raw code');
  });
}

async function testTenantCatalog() {
  await inRolledBackTransaction(async (runner) => {
    const g = await seed(runner, 'csv-catalog');
    // The tenant renamed the level and translated it into French only.
    const levels = [{ code: 'business_critical', label: 'Vital', description: '', rank: 4, maxMtdMinutes: 240, translations: { fr: { label: 'Vitale' } } }];
    await runner.query(
      `UPDATE tenants SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{it_ops}', $2::jsonb) WHERE id = $1`,
      [g.tenantId, JSON.stringify({ business_criticality_levels: levels })],
    );
    const { links } = services();
    const opts = { manager: runner.manager, tenantId: g.tenantId };
    const label = async (language: 'en' | 'fr') => {
      const file = await links.applicationsCsv(g.tech.sql, language, opts, {});
      return cells(file.content, language).find((row) => row[1].startsWith('ERP'))![7];
    };
    assert.equal(await label('fr'), 'Vitale', "the tenant's translation");
    assert.equal(await label('en'), 'Vital', "the tenant's label");
    await assert.rejects(links.applicationsCsv(g.tech.sql, 'it', opts, {}), /language must be/);
  });
}

runSpecs('technology-applications-csv.integration.spec', [
  ['english and french', testEnglishAndFrench],
  ['tenant catalog', testTenantCatalog],
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
