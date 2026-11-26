import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { normalizeServerRole } from '../../app-asset-assignments/cluster-assignment-rules';
import { catalogValueRefusal, resolveOfferedCatalogCode } from '../../it-ops-settings/catalog-resolve';
import { AiCodeNamer } from '../ai-code-names';
import { catalogRefusalForModel, previewCatalogNamesForModel } from '../ai-catalog-refusal';

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

// A preview Kad prepared (rejeu du pilote): the card keeps the code, the model reads the name.
const connectionTypes = [
  { code: 'ipsec', label: 'IPSec' },
  { code: 'zabbix', label: 'Zabbix agent', translations: { fr: { label: 'Agent Zabbix' } } },
  { code: 'https', label: 'HTTPS' },
];
const previewNamer = new AiCodeNamer('fr', { connectionTypes, applicationCategories: [{ code: 'erp', label: 'ERP suite', translations: { fr: { label: 'Progiciel de gestion' } } }] } as any);
const preview = {
  preview_id: 'p1',
  tool_name: 'update_business_record',
  status: 'pending',
  target: { entity_type: 'connections', id: 'c1', label: 'VPN Paris-NYC' },
  changes: {
    protocol_codes: { label: 'Protocol Codes', from: 'ipsec', to: 'zabbix', format: 'text' },
    name: { label: 'Name', from: 'VPN', to: 'zabbix', format: 'text' },
  },
};
const card = JSON.parse(JSON.stringify(preview));
const read = previewCatalogNamesForModel({ previews: [preview], message: 'ok' }, previewNamer) as any;
assert.equal(read.previews[0].changes.protocol_codes.from, 'IPSec');
assert.equal(read.previews[0].changes.protocol_codes.to, 'Agent Zabbix');
assert.equal(read.previews[0].changes.name.to, 'zabbix', 'a field outside the catalogs stays as typed');
assert.equal(read.message, 'ok');
assert.deepEqual(preview, card, 'the card keeps the codes');
// A list of values, a single preview, an application category, a code the catalog does not name.
const many = previewCatalogNamesForModel({ ...preview, changes: { protocol_codes: { label: 'Protocol Codes', from: null, to: 'zabbix, https, legacy' } } }, previewNamer) as any;
assert.equal(many.changes.protocol_codes.to, 'Agent Zabbix, HTTPS, legacy');
const category = previewCatalogNamesForModel({ results: [{ ...preview, target: { entity_type: 'applications' }, changes: { category: { label: 'Category', from: null, to: 'erp' } } }] }, previewNamer) as any;
assert.equal(category.results[0].changes.category.to, 'Progiciel de gestion');
// Any other result is the same object.
const other = { items: [{ code: 'zabbix' }] };
assert.equal(previewCatalogNamesForModel(other, previewNamer), other);

console.log('ai-catalog-refusal.spec.ts passed');
