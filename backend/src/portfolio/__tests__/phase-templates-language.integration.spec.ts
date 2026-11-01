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
import { PortfolioPhaseTemplate } from '../portfolio-phase-template.entity';
import { PortfolioPhaseTemplateItem } from '../portfolio-phase-template-item.entity';
import { PortfolioPhaseTemplatesService } from '../portfolio-phase-templates.service';

// The phase templates a workspace starts with are seeded on the first read of the list, named in
// the workspace seed language (`metadata.language`), English when the tenant has none.

function service() {
  return new PortfolioPhaseTemplatesService(
    dataSource.getRepository(PortfolioPhaseTemplate),
    dataSource.getRepository(PortfolioPhaseTemplateItem),
    new AuditService(dataSource.getRepository(AuditLog)),
  );
}

async function seededNames(t: ActivatedTenant, language: string | null) {
  await dataSource.query(
    `UPDATE tenants SET metadata = CASE WHEN $2::text IS NULL THEN COALESCE(metadata, '{}'::jsonb) - 'language'
       ELSE COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('language', $2::text) END WHERE id = $1`,
    [t.tenantId, language],
  );
  const list = await inTenant(t.tenantId, (manager) => service().list(t.tenantId, { manager }));
  return list.map((template: any) => [template.name, template.items.map((item: any) => [item.name, item.milestone_name])]);
}

async function testSeedLanguage() {
  const svc = buildServices();
  const tenants: ActivatedTenant[] = [];
  try {
    for (const tag of ['ph-fr', 'ph-en']) tenants.push(await createActivatedTenant(svc, { tag, orgName: `Phases ${tag}` }));
    const french = await seededNames(tenants[0], 'fr');
    assert.deepEqual(french.map(([name]) => name), ['Mini-projet', 'Applications métier', 'Projet informatique']);
    assert.deepEqual(french[0][1], [
      ['Réalisation', 'Mise en production'],
      ['Documentation et transfert de compétences', 'Projet terminé'],
    ], 'phases and milestones in French');
    const english = await seededNames(tenants[1], null);
    assert.deepEqual(english.map(([name]) => name), ['Mini Project', 'Business Apps', 'IT Project'], 'English without a language');
    // Seeded once: a later change of language leaves the stored names.
    assert.deepEqual((await seededNames(tenants[0], 'de')).map(([name]) => name), ['Mini-projet', 'Applications métier', 'Projet informatique']);
  } finally {
    await cleanupTenants(tenants.map((t) => t.tenantId));
  }
}

runSpecs('phase-templates-language.integration.spec', [testSeedLanguage]).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
