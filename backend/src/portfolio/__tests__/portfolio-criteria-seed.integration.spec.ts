// @database-spec
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import dataSource from '../../data-source';
import {
  ActivatedTenant,
  buildServices,
  cleanupTenants,
  createActivatedTenant,
  inTenant,
  runSpecs,
} from '../../admin/tenants/__tests__/tenant-reset-test-helpers';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { PortfolioCriteriaService } from '../portfolio-criteria.service';
import { PortfolioCriterion } from '../portfolio-criterion.entity';
import { PortfolioCriterionValue } from '../portfolio-criterion-value.entity';
import { PortfolioRequest } from '../portfolio-request.entity';
import { PortfolioSettings } from '../portfolio-settings.entity';

// The evaluation criteria a workspace starts with are seeded on the first read of the list,
// named in the workspace seed language (`metadata.language`), English when the tenant has none.

const NAMES = {
  fr: [
    'Valeur métier',
    'Alignement stratégique',
    'Coûts du projet',
    'ROI',
    'Niveau de risque',
    'Urgence',
    'Estimation de temps IT',
    'Estimation de temps métier',
  ],
  en: [
    'Business value',
    'Strategic alignment',
    'Project costs',
    'ROI',
    'Risk level',
    'Urgency',
    'Time estimation IT',
    'Time estimation Business',
  ],
  de: [
    'Geschäftswert',
    'Strategische Ausrichtung',
    'Projektkosten',
    'ROI',
    'Risikoniveau',
    'Dringlichkeit',
    'Zeitschätzung IT',
    'Zeitschätzung Fachbereich',
  ],
  es: [
    'Valor de negocio',
    'Alineación estratégica',
    'Costes del proyecto',
    'ROI',
    'Nivel de riesgo',
    'Urgencia',
    'Estimación de tiempo IT',
    'Estimación de tiempo de negocio',
  ],
};

const LABELS = {
  fr: [
    ['0-10k€', '10-50k€', '50-200k€', '200-500k€', '>500k€', 'Obligatoire'],
    ['Faible', 'Moyen', 'Élevé', 'Très élevé'],
    ['Sans coût direct', '0-10k€', '10-50k€', '50-200k€', '200-500k€', '>500k€'],
    ['Non quantifiable', '>10 ans', '5-10 ans', '2-5 ans', '1-2 ans', '<1 an'],
    ['Négligeable', 'Faible', 'Moyen', 'Élevé', 'Très élevé'],
    ['Faible', 'Moyen', 'Élevé', 'Critique'],
    ['0-10 JH', '10-20 JH', '20-50 JH', '>50 JH'],
    ['0-10 JH', '10-20 JH', '20-50 JH', '>50 JH'],
  ],
  en: [
    ['0-10k€', '10-50k€', '50-200k€', '200-500k€', '>500k€', 'Mandatory'],
    ['Low', 'Medium', 'High', 'Top'],
    ['No direct cost', '0-10k€', '10-50k€', '50-200k€', '200-500k€', '>500k€'],
    ['Not quantifiable', '>10y', '5-10y', '2-5y', '1-2y', '<1y'],
    ['Negligible', 'Low', 'Medium', 'High', 'Top'],
    ['Low', 'Medium', 'High', 'Critical'],
    ['0-10 MD', '10-20 MD', '20-50 MD', '>50 MD'],
    ['0-10 MD', '10-20 MD', '20-50 MD', '>50 MD'],
  ],
  de: [
    ['0-10k€', '10-50k€', '50-200k€', '200-500k€', '>500k€', 'Obligatorisch'],
    ['Niedrig', 'Mittel', 'Hoch', 'Sehr hoch'],
    ['Keine direkten Kosten', '0-10k€', '10-50k€', '50-200k€', '200-500k€', '>500k€'],
    ['Nicht quantifizierbar', '>10 Jahre', '5-10 Jahre', '2-5 Jahre', '1-2 Jahre', '<1 Jahr'],
    ['Vernachlässigbar', 'Niedrig', 'Mittel', 'Hoch', 'Sehr hoch'],
    ['Niedrig', 'Mittel', 'Hoch', 'Kritisch'],
    ['0-10 PT', '10-20 PT', '20-50 PT', '>50 PT'],
    ['0-10 PT', '10-20 PT', '20-50 PT', '>50 PT'],
  ],
  es: [
    ['0-10k€', '10-50k€', '50-200k€', '200-500k€', '>500k€', 'Obligatorio'],
    ['Bajo', 'Medio', 'Alto', 'Muy alto'],
    ['Sin coste directo', '0-10k€', '10-50k€', '50-200k€', '200-500k€', '>500k€'],
    ['No cuantificable', '>10 años', '5-10 años', '2-5 años', '1-2 años', '<1 año'],
    ['Insignificante', 'Bajo', 'Medio', 'Alto', 'Muy alto'],
    ['Bajo', 'Medio', 'Alto', 'Crítico'],
    ['0-10 DP', '10-20 DP', '20-50 DP', '>50 DP'],
    ['0-10 DP', '10-20 DP', '20-50 DP', '>50 DP'],
  ],
};

function service() {
  return new PortfolioCriteriaService(
    dataSource.getRepository(PortfolioCriterion),
    dataSource.getRepository(PortfolioCriterionValue),
    dataSource.getRepository(PortfolioRequest),
    dataSource.getRepository(PortfolioSettings),
    new AuditService(dataSource.getRepository(AuditLog)),
  );
}

async function seeded(t: ActivatedTenant, language: string | null) {
  await dataSource.query(
    `UPDATE tenants SET metadata = CASE WHEN $2::text IS NULL THEN COALESCE(metadata, '{}'::jsonb) - 'language'
       ELSE COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('language', $2::text) END WHERE id = $1`,
    [t.tenantId, language],
  );
  const list = await inTenant(t.tenantId, (manager) => service().list(t.tenantId, { manager }));
  return list.map((criterion: any) => ({
    name: criterion.name,
    system_key: criterion.system_key,
    inverted: criterion.inverted,
    labels: criterion.values.map((value: any) => value.label),
    bypass: criterion.values.filter((value: any) => value.triggers_mandatory_bypass).map((value: any) => value.label),
  }));
}

async function testSeedLanguage() {
  const svc = buildServices();
  const tenants: ActivatedTenant[] = [];
  try {
    for (const tag of ['cr-fr', 'cr-en', 'cr-de', 'cr-es']) {
      tenants.push(await createActivatedTenant(svc, { tag, orgName: `Criteria ${tag}` }));
    }
    const french = await seeded(tenants[0], 'fr');
    assert.deepEqual(french.map((criterion) => criterion.name), NAMES.fr);
    assert.deepEqual(french.map((criterion) => criterion.labels), LABELS.fr, 'French labels');
    assert.deepEqual(french.map((criterion) => criterion.inverted), [false, false, true, false, true, false, true, true]);
    assert.deepEqual(french.map((criterion) => criterion.system_key), [
      null, null, null, null, null, null, 'time_estimation_it', 'time_estimation_business',
    ]);
    assert.deepEqual(french.map((criterion) => criterion.bypass), [['Obligatoire'], [], [], [], [], [], [], []]);

    const english = await seeded(tenants[1], null);
    assert.deepEqual(english.map((criterion) => criterion.name), NAMES.en, 'English without a language');
    assert.deepEqual(english.map((criterion) => criterion.labels), LABELS.en);
    assert.deepEqual(english[0].bypass, ['Mandatory']);

    const german = await seeded(tenants[2], 'de');
    assert.deepEqual(german.map((criterion) => criterion.name), NAMES.de);
    assert.deepEqual(german.map((criterion) => criterion.labels), LABELS.de);

    const spanish = await seeded(tenants[3], 'es');
    assert.deepEqual(spanish.map((criterion) => criterion.name), NAMES.es);
    assert.deepEqual(spanish.map((criterion) => criterion.labels), LABELS.es);

    // Seeded once: a later change of language leaves the stored names.
    assert.deepEqual((await seeded(tenants[0], 'de')).map((criterion) => criterion.name), NAMES.fr);
  } finally {
    await cleanupTenants(tenants.map((t) => t.tenantId));
  }
}

runSpecs('portfolio-criteria-seed.integration.spec', [testSeedLanguage]).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
