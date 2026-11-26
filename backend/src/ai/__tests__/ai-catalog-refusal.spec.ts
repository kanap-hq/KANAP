import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { normalizeServerRole } from '../../app-asset-assignments/cluster-assignment-rules';
import { catalogValueRefusal, resolveOfferedCatalogCode } from '../../it-ops-settings/catalog-resolve';
import { AiCodeNamer } from '../ai-code-names';
import { catalogRefusalForModel } from '../ai-catalog-refusal';

// Lot K2c (rejeu du pilote): a refusal of a catalog value reaches the model with the names the
// screen's selector shows, in the person's language, without codes (rule of lot K2d: Plaid names
// values, never codes). The API keeps its answer: same code, same params.

const serverRoles = [
  { code: 'app', label: 'Application server' },
  { code: 'backup', label: 'Backup server', deprecated: true },
  { code: 'db', label: 'Database server' },
  { code: 'custom', label: 'Batch host', translations: { fr: { label: 'Hôte de traitements' } } },
];
const namer = new AiCodeNamer('fr', { serverRoles } as any);

function refusalOf(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('expected a refusal');
}

// A retired server role on a new assignment, French profile.
const original = refusalOf(() => normalizeServerRole('backup', serverRoles, null));
const forModel = catalogRefusalForModel(original, namer);
assert.ok(forModel instanceof BadRequestException);
const text = forModel!.message;
assert.match(text, /Serveur d'applications/);
assert.match(text, /"Serveur de sauvegarde" is retired/);
assert.match(text, /Hôte de traitements/);
assert.doesNotMatch(text, /\(app\)|Application server|\bdb\b|Backup server/, text);
assert.equal(
  text,
  'The role "Serveur de sauvegarde" is retired: only a record that already holds it keeps it. Use one of: Serveur d\'applications, Serveur de bases de données, Hôte de traitements.',
);
// The API's answer is unchanged: code and params as before, the English list with codes.
const apiResponse = (original as BadRequestException).getResponse() as Record<string, any>;
const modelResponse = forModel!.getResponse() as Record<string, any>;
assert.equal(modelResponse.code, 'catalog_value_retired');
assert.deepEqual(modelResponse.params, apiResponse.params);
assert.match(apiResponse.params.allowed, /app \(Application server\)/);
assert.match((original as Error).message, /app \(Application server\)/);

// An unknown value keeps the list, named.
const unknown = catalogRefusalForModel(refusalOf(() => normalizeServerRole('Citrix', serverRoles, null)), namer);
assert.equal((unknown!.getResponse() as any).code, 'assignment_role_invalid');
assert.equal(unknown!.message, 'Unknown role "Citrix". Use one of: Serveur d\'applications, Serveur de bases de données, Hôte de traitements.');

// Two values the person reads under one name keep their code, those two only.
const twins = [
  { code: 'vpn', label: 'VPN' },
  { code: 'vpn2', label: 'Vpn' },
  { code: 'web', label: 'Web' },
];
const twinNamer = new AiCodeNamer('fr', { accessMethods: twins } as any);
const twinText = catalogRefusalForModel(
  refusalOf(() => resolveOfferedCatalogCode('ssh', twins, { what: 'access method', list: 'accessMethods' })),
  twinNamer,
)!.message;
assert.equal(twinText, 'Unknown access method "ssh". Use one of: VPN (vpn), Vpn (vpn2), Web.');

// A required value left empty, and a refusal whose response is a plain sentence (incident category).
const categories = [{ code: 'erp', label: 'ERP suite', translations: { fr: { label: 'Progiciel de gestion' } } }, { code: 'web', label: 'Web' }];
const categoryNamer = new AiCodeNamer('fr', { applicationCategories: categories, incidentCategories: categories } as any);
const required = catalogValueRefusal({ value: '', allowed: 'erp (ERP suite), web (Web)', retired: false }, 'Application category is required. Use one of: erp (ERP suite), web (Web).', undefined, {
  what: 'application category', list: 'applicationCategories', retired: false, value: '', offered: categories,
});
assert.equal(catalogRefusalForModel(required, categoryNamer)!.message, 'The application category is required. Use one of: Progiciel de gestion, Web.');
const incident = Object.assign(new BadRequestException('Unknown incident category "x". Valid incident categories: ERP suite, Web.'), {
  catalogRefusal: { what: 'incident category', list: 'incidentCategories', retired: true, value: 'ERP suite', valueCode: 'erp', offered: [categories[1]] },
});
assert.equal(
  catalogRefusalForModel(incident, categoryNamer)!.message,
  'The incident category "Progiciel de gestion" is retired: only a record that already holds it keeps it. Use one of: Web.',
);
assert.equal((catalogRefusalForModel(incident, categoryNamer)!.getResponse() as any).code, 'catalog_value_retired');

// Any other error passes as it is.
assert.equal(catalogRefusalForModel(new BadRequestException('Body is required'), namer), null);
assert.equal(catalogRefusalForModel(new Error('boom'), namer), null);

console.log('ai-catalog-refusal.spec.ts passed');
