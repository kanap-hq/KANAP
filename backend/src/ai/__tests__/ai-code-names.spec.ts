import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { normalizeBudgetColumns } from '../../budget-columns/budget-columns.util';
import { backendPath } from '../../common/__tests__/backend-root';
import {
  AI_CODE_LISTS,
  AI_NAMED_CHILD_FIELDS,
  AI_NAMED_FIELDS,
  AiCodeNamer,
  aiFamilyNamesBudgetColumns,
  aiNamesLanguage,
  LANGUAGE_NATIVE_NAMES,
  withCodeNames,
  withFilterCodes,
} from '../ai-code-names';
import { AI_CODE_NAMES_PENDING, AI_NOT_CODE_FIELDS } from '../ai-code-names.inventory';
import { AiToolRegistry } from '../ai-tool.registry';
import { aiEntityRegistries } from '../query/registries';
import { assertCodeListIsTheScreens } from './code-list-locale';

/**
 * Kad and the MCP server read the name of each code next to it (lot K2d): `<field>_name` in the
 * reader's language, from a fixed list copied from the screens or from the workspace's catalog.
 */

const CATALOGS: any = {
  // A value the workspace translated, one it keeps as shipped, one it renamed without translating.
  lifecycleStates: [
    { code: 'active', label: 'In use', translations: { de: { label: 'Im Einsatz' } } },
    { code: 'retired', label: 'Retired' },
  ],
  applicationCategories: [
    { code: 'line_of_business', label: 'Line-of-business' },
    { code: 'erp_core', label: 'Cœur ERP' },
  ],
  businessCriticalityLevels: [
    { code: 'high', label: 'High', rank: 2, translations: { fr: { label: 'Haute' }, es: { label: 'Alta' } } },
  ],
  hostingTypes: [{ code: 'public_cloud', label: 'Public cloud' }, { code: 'k2d_hosting', label: 'K2d hosting' }],
  serverProviders: [{ code: 'k2d_cloud', label: 'K2d cloud', translations: { fr: { label: 'Nuage K2d' } } }],
};

const namer = (language: 'en' | 'fr' | 'de' | 'es') => new AiCodeNamer(language, CATALOGS);

function summary(type: string, status: string | null, metadata: Record<string, unknown>) {
  return { type, id: `${type}-1`, ref: null, label: 'Record', status, summary: null, updated_at: null, metadata };
}

function testFixedListInTheFourLanguages() {
  const names = (['en', 'fr', 'de', 'es'] as const).map((language) => {
    const out = withCodeNames('query_entities', { entity_type: 'tasks' }, { items: [summary('tasks', 'in_progress', { priority: 'normal' })] }, namer(language)) as any;
    return [out.items[0].status_name, out.items[0].metadata.priority_name];
  });
  assert.deepEqual(names, [
    ['In progress', 'Medium'],
    ['En cours', 'Moyenne'],
    ['In Bearbeitung', 'Mittel'],
    ['En curso', 'Media'],
  ]);
  console.log('  a fixed list (task status and priority) in en, fr, de, es: OK');
}

function testCatalogLists() {
  const read = (language: 'en' | 'fr' | 'de' | 'es', metadata: Record<string, unknown>) =>
    (withCodeNames('query_entities', { entity_type: 'applications' }, { items: [summary('applications', 'enabled', metadata)] }, namer(language)) as any).items[0];
  // The workspace's translation; without one in that language, its own label.
  assert.equal(read('de', { lifecycle: 'active' }).metadata.lifecycle_name, 'Im Einsatz');
  assert.equal(read('fr', { lifecycle: 'active' }).metadata.lifecycle_name, 'In use');
  // A value the workspace keeps as shipped: the shipped word of the language.
  assert.equal(read('fr', { category: 'line_of_business' }).metadata.category_name, 'Métier');
  // A value the workspace named itself, untranslated: its own label in every language.
  assert.equal(read('es', { category: 'erp_core' }).metadata.category_name, 'Cœur ERP');
  // A classification axis: the workspace's label, translated where it is.
  assert.equal(read('fr', { criticality: 'high' }).metadata.criticality_name, 'Haute');
  assert.equal(read('de', { criticality: 'high' }).metadata.criticality_name, 'Hoch');
  // Several codes in one field; the status of the record from its fixed list.
  const item = read('fr', { environments: 'prod, pre_prod, lab', hosting_types: 'public_cloud' });
  assert.equal(item.metadata.environments_name, 'Prod, Pré-prod, lab');
  assert.equal(item.metadata.hosting_types_name, 'Public cloud');
  assert.equal(item.status_name, 'Activé');
  console.log('  workspace catalog: translation, shipped word, own label, classification, several codes: OK');
}

function testUnknownCodeStaysAsStored() {
  const out = withCodeNames('query_entities', { entity_type: 'projects' }, { items: [summary('projects', 'someday', { origin: null })] }, namer('fr')) as any;
  assert.equal(out.items[0].status, 'someday');
  assert.equal('status_name' in out.items[0], false);
  assert.equal('origin_name' in out.items[0].metadata, false);
  // A catalog code without the workspace's catalog has no name either.
  const bare = withCodeNames('query_entities', {}, { items: [summary('applications', null, { lifecycle: 'active' })] }, new AiCodeNamer('fr')) as any;
  assert.equal('lifecycle_name' in bare.items[0].metadata, false);
  // A name already there is never replaced.
  const kept = withCodeNames('query_entities', {}, { items: [summary('incidents', 'open', { severity: 'major', severity_name: 'kept' })] }, namer('fr')) as any;
  assert.equal(kept.items[0].metadata.severity_name, 'kept');
  console.log('  an unknown code stays as stored, without a name or an error: OK');
}

function testAllocationMethodAndContactRole() {
  const line = (language: 'en' | 'fr' | 'de' | 'es') => (withCodeNames('query_entities', {}, {
    items: [summary('budget_lines', 'enabled', { nature: 'capex', run_build: 'build', allocation_method: 'Manual %', next_year_allocation_method: 'Headcount' })],
  }, namer(language)) as any).items[0].metadata;
  assert.deepEqual((['en', 'fr', 'de', 'es'] as const).map((language) => line(language).allocation_method_name), [
    'Manual percentages', 'Pourcentages manuels', 'Manuelle Prozentsätze', 'Porcentajes manuales',
  ]);
  assert.equal(line('fr').next_year_allocation_method_name, 'Effectif');
  assert.equal(line('fr').nature_name, 'CAPEX');
  const chargeback = (withCodeNames('query_entities', {}, { items: [summary('chargeback_lines', 'manual_company', { allocation_method: 'manual_company' })] }, namer('es')) as any).items[0];
  assert.equal(chargeback.status_name, 'Manual por empresa');
  const contact = (withCodeNames('query_entities', {}, { items: [summary('contacts', 'active', { supplier_role: 'technical' })] }, namer('de')) as any).items[0];
  assert.deepEqual([contact.status_name, contact.metadata.supplier_role_name], ['Aktiv', 'Technik']);
  console.log('  allocation method as the Allocations tab names it, contact type and status: OK');
}

function testDetailAndChildRows() {
  const out = withCodeNames('get_entity_detail', { entity_type: 'applications', entity_id: 'APP-3' }, {
    entity: summary('applications', 'enabled', { lifecycle: 'retired' }),
    data: {
      lifecycle: 'retired',
      hosting_model: 'on_premise',
      owners: [{ owner_type: 'business', full_name: 'Camille Roux' }, { owner_type: 'it', full_name: 'Paul Martin' }],
      instances: [{ environment: 'pre_prod' }],
    },
    total: 1,
  }, namer('fr')) as any;
  assert.equal(out.entity.metadata.lifecycle_name, 'Retiré');
  assert.equal(out.data.hosting_model_name, 'Sur site');
  assert.deepEqual(out.data.owners.map((owner: any) => owner.owner_type_name), ['Métier', 'IT']);
  assert.equal(out.data.instances[0].environment_name, 'Pré-prod');
  const line = withCodeNames('get_entity_detail', { entity_type: 'budget_lines' }, {
    entity: summary('budget_lines', 'enabled', {}),
    data: {
      contacts: [{ role: 'commercial' }, { role: 'Account manager' }],
      financial_versions: [{ allocation_method: 'default', resolved_allocation_method: 'turnover' }],
    },
  }, namer('es')) as any;
  assert.deepEqual(line.data.contacts.map((contact: any) => contact.role_name ?? null), ['Comercial', null]);
  assert.deepEqual([line.data.financial_versions[0].allocation_method_name, line.data.financial_versions[0].resolved_allocation_method_name], ['Predeterminado', 'Facturación']);
  console.log('  a detail, its owners, deployments, contacts and versions: OK');
}

/**
 * Lot K2d, browser pass of 24/11: the countries of a detail's child rows (an application's data
 * residency, a contract's contacts) and the method each year of a line applies, named.
 */
function testDetailCountriesAndYearlyMethods() {
  const app = withCodeNames('get_entity_detail', { entity_type: 'applications' }, {
    entity: summary('applications', 'enabled', {}),
    data: { data_residency: [{ country_iso: 'FR' }, { country_iso: 'XX' }] },
  }, namer('fr')) as any;
  assert.deepEqual(app.data.data_residency.map((row: any) => row.country_iso_name ?? null), ['France', null]);
  const contract = withCodeNames('get_entity_detail', { entity_type: 'contracts' }, {
    entity: summary('contracts', 'enabled', {}),
    data: { contacts: [{ role: 'technical', country: 'US' }] },
  }, namer('de')) as any;
  assert.deepEqual([contract.data.contacts[0].role_name, contract.data.contacts[0].country_name], ['Technik', 'Vereinigte Staaten']);
  const line = withCodeNames('get_entity_detail', { entity_type: 'budget_lines' }, {
    entity: summary('budget_lines', 'enabled', {}),
    data: {
      contacts: [{ role: 'support', country: 'NL' }],
      allocation_by_year: [
        { budget_year: 2026, allocation_method: 'manual_company', default: false, version: true },
        { budget_year: 2027, allocation_method: 'headcount', default: true, version: false },
      ],
    },
  }, namer('fr')) as any;
  assert.equal(line.data.contacts[0].country_name, 'Pays-Bas');
  assert.deepEqual(line.data.allocation_by_year.map((year: any) => year.allocation_method_name), ['Manuel par société', 'Effectif']);
  console.log('  the countries of child rows and the method of each year of a line: OK');
}

/**
 * Lot K2d, browser pass of 24/11: a set filter on a named field takes the name, in the reader's
 * language or another of the four, as the code; a field read in its stored form (the budget lines'
 * allocation method, "Headcount") takes that form; an unknown name stays, listed with the accepted
 * values and their names.
 */
function testFiltersTakeNames() {
  const dynamic = () => ({ values: null });
  const declared = (values: Array<string | null>) => () => ({ values });
  const lines = (language: 'en' | 'fr' | 'de' | 'es', values: unknown) =>
    withFilterCodes('budget_lines', { allocation_method: values, product: 'Okta' }, namer(language), dynamic);
  // The name in the reader's language, in another language, the code, the stored form.
  assert.deepEqual(lines('fr', ['Effectif', 'Manuel par société']).filters, { allocation_method: ['Headcount', 'Company'], product: 'Okta' });
  assert.deepEqual(lines('fr', ['mitarbeiterzahl']).filters.allocation_method, ['Headcount']);
  assert.deepEqual(lines('en', ['headcount', 'Manual %', 'company']).filters.allocation_method, ['Headcount', 'Manual %', 'Company']);
  assert.deepEqual(lines('es', { not: ['Porcentajes manuales', null] }).filters.allocation_method, { not: ['Manual %', null] });
  assert.deepEqual(lines('fr', 'Effectif').unknown, []);
  // An unknown name: kept, listed with the accepted values and their names.
  const unknown = lines('fr', ['Inexistant', 'Effectif']);
  assert.deepEqual(unknown.filters.allocation_method, ['Inexistant', 'Headcount']);
  assert.equal(unknown.unknown.length, 1);
  assert.equal(unknown.unknown[0].field, 'allocation_method');
  assert.deepEqual(unknown.unknown[0].values, ['Inexistant']);
  assert.ok(unknown.unknown[0].accepted?.some((value) => value.value === 'Headcount' && value.name === 'Effectif'), JSON.stringify(unknown.unknown));
  // A field that declares its values takes the code among them, and refuses an unknown one itself.
  const chargeback = withFilterCodes('chargeback_lines', { allocation_method: ['Effectif', 'Inconnu'] }, namer('fr'),
    declared(['headcount', 'it_users', 'turnover', 'manual_company', 'manual_department', 'manual_pct']));
  assert.deepEqual(chargeback, { filters: { allocation_method: ['headcount', 'Inconnu'] }, unknown: [] });
  // A catalog value by the workspace's translation; a country by its name; a status of a fixed list.
  assert.deepEqual(withFilterCodes('applications', { lifecycle: ['Im Einsatz'], data_residency: 'Pays-Bas' }, namer('fr'), dynamic).filters,
    { lifecycle: ['active'], data_residency: 'NL' });
  assert.deepEqual(withFilterCodes('projects', { status: ['Suspendu'] }, namer('fr'), declared(['waiting_list', 'in_progress', 'on_hold'])).filters,
    { status: ['on_hold'] });
  // A field that is not a set field, or not named, is left alone.
  assert.deepEqual(withFilterCodes('budget_lines', { allocation_method: ['Effectif'] }, namer('fr'), () => null).filters, { allocation_method: ['Effectif'] });
  console.log('  filters take names in the four languages, codes and stored forms; an unknown name is listed: OK');
}

function testAggregateAndFilterValues() {
  const groups = withCodeNames('aggregate_entities', { entity_type: 'budget_lines', group_by: 'nature', then_by: 'run_build' }, {
    group_by: 'nature',
    groups: [{ key: 'opex', then_key: 'run', count: 3 }, { key: null, then_key: null, count: 1 }],
  }, namer('de')) as any;
  assert.deepEqual(groups.groups[0], { key: 'opex', then_key: 'run', count: 3, key_name: 'OPEX', then_key_name: 'Run' });
  assert.deepEqual(groups.groups[1], { key: null, then_key: null, count: 1 });
  const values = withCodeNames('get_filter_values', { entity_type: 'incidents', fields: ['status', 'owner'] }, {
    values: { status: ['open', 'closed'], owner: ['Paul Martin'] },
    fields_ignored: [],
  }, namer('fr')) as any;
  assert.deepEqual(values.values, { status: ['open', 'closed'], owner: ['Paul Martin'] });
  assert.deepEqual(values.names, { status: { open: 'Ouvert', closed: 'Clôturé' } });
  console.log('  aggregate groups and filter values: OK');
}

/** The lists of the second pass: one row per family, in the four languages where it matters. */
function testSecondPassFixedLists() {
  const item = (family: string, status: string | null, metadata: Record<string, unknown>, language: 'en' | 'fr' | 'de' | 'es' = 'fr') =>
    (withCodeNames('query_entities', { entity_type: family }, { items: [summary(family, status, metadata)] }, namer(language)) as any).items[0];
  const deadline = (language: 'en' | 'fr' | 'de' | 'es') => {
    const row = item('support_deadlines', 'extended_support', { state: 'extended_support', subject_type: 'operating_system', milestone: null }, language);
    return [row.status_name, row.metadata.state_name, row.metadata.subject_type_name];
  };
  assert.deepEqual((['en', 'fr', 'de', 'es'] as const).map(deadline), [
    ['Extended support', 'Extended support', 'Operating system'],
    ['Support étendu', 'Support étendu', "Système d'exploitation"],
    ['Erweiterter Support', 'Erweiterter Support', 'Betriebssystem'],
    ['Soporte extendido', 'Soporte extendido', 'Sistema operativo'],
  ]);
  assert.equal(item('support_deadlines', 'upcoming', { milestone: 'support_contract' }).metadata.milestone_name, 'Contrat de support');
  const gap = item('support_gaps', 'link_without_version', { gap: 'link_without_version', subject_type: 'technology', related_type: 'asset' }, 'de');
  assert.deepEqual([gap.status_name, gap.metadata.subject_type_name, gap.metadata.related_type_name], ['Technologieverknüpfung ohne Version', 'Technologie', 'Asset']);
  const version = item('technology_versions', 'out_of_support', { support_status: 'out_of_support' }, 'es');
  assert.deepEqual([version.status_name, version.metadata.support_status_name], ['Sin soporte', 'Sin soporte']);
  assert.equal(item('technologies', 'enabled', { support_status: 'unknown' }).metadata.support_status_name, 'Date inconnue');
  const access = item('data_access', 'edit', { node_type: 'cost_center', node_kind: 'group', access: 'edit' });
  assert.deepEqual([access.status_name, access.metadata.node_type_name, access.metadata.node_kind_name], ['Saisie', 'Centre de coûts', 'Groupe de centres']);
  assert.equal(item('data_access', null, { node_type: 'all' }, 'de').metadata.node_type_name, 'Alles');
  // A custom role shows no badge on the Roles screen: its code has no name.
  const builtIn = item('roles', 'built_in', { type: 'built_in' });
  assert.deepEqual([builtIn.status_name, builtIn.metadata.type_name], ['Intégré', 'Intégré']);
  assert.equal('type_name' in item('roles', 'custom', { type: 'custom' }).metadata, false);
  assert.equal(item('documents', 'in_review', {}, 'de').status_name, 'In Prüfung');
  const connection = item('connections', 'active', { topology: 'server_to_server', risk_mode: 'manual' }, 'es');
  assert.deepEqual([connection.metadata.topology_name, connection.metadata.risk_mode_name], ['Servidor a servidor', 'Manual']);
  assert.equal(item('interfaces', null, { integration_route_type: 'via_middleware' }, 'de').metadata.integration_route_type_name, 'Über Middleware');
  const app = item('applications', 'enabled', { classification_review_state: 'stale', users_mode: 'headcount', vulnerabilities: 'severe' });
  assert.deepEqual(
    [app.metadata.classification_review_state_name, app.metadata.users_mode_name, app.metadata.vulnerabilities_name],
    ['À revoir', 'Dérivé', 'Avec des vulnérabilités graves'],
  );
  assert.equal(item('tasks', 'open', { related: 'budget_line' }, 'es').metadata.related_name, 'Presupuesto');
  const cve = item('vulnerabilities', 'to_review', { severity: 'high', score_source: 'cve_org' });
  assert.deepEqual([cve.metadata.severity_name, cve.metadata.score_source_name], ['Élevée', 'Éditeur']);
  assert.deepEqual([item('chart_of_accounts', null, { scope: 'GLOBAL' }, 'de').metadata.scope_name], ['Alle Länder']);
  const rate = item('exchange_rates', 'world-bank-annual', { source: 'manual' }, 'en');
  assert.deepEqual([rate.status_name, rate.metadata.source_name], ['Annual avg', 'Rate entered manually']);
  // The reporting currency's own rate shows no source on the screen.
  assert.equal('status_name' in item('exchange_rates', 'identity', {}), false);
  const chargeback = item('chargeback', 'common', { level: 'common' }, 'de');
  assert.deepEqual([chargeback.status_name, chargeback.metadata.level_name], ['Gemeinkosten', 'Gemeinkosten']);
  assert.equal(item('users', 'enabled', { data_access: 'limited' }).metadata.data_access_name, 'Limité à');
  console.log('  end of support, gaps, support states, data access, roles, documents, connections, routes, applications, tasks, CVEs, charts, rates, chargeback, users: OK');
}

/** A country in the reader's language, a profile's language in its own words; several codes keep their shape. */
function testCountriesLanguagesAndSeveralValues() {
  const item = (family: string, metadata: Record<string, unknown>, language: 'en' | 'fr' | 'de' | 'es') =>
    (withCodeNames('query_entities', { entity_type: family }, { items: [summary(family, 'enabled', metadata)] }, namer(language)) as any).items[0].metadata;
  assert.deepEqual((['en', 'fr', 'de', 'es'] as const).map((language) => item('companies', { country_iso: 'DE' }, language).country_iso_name), [
    'Germany', 'Allemagne', 'Deutschland', 'Alemania',
  ]);
  assert.equal(item('contacts', { country: 'nl' }, 'fr').country_name, 'Pays-Bas');
  assert.equal(item('locations', { country: 'ES', country_iso: 'ES' }, 'de').country_iso_name, 'Spanien');
  // A value that names no country has no name.
  assert.equal('country_iso_name' in item('chart_of_accounts', { country_iso: 'XX' }, 'fr'), false);
  // Several countries: one name per code, in the value's order; an unknown code stays as stored.
  assert.equal(item('applications', { data_residency: 'FR, DE, XX' }, 'fr').data_residency_name, 'France, Allemagne, XX');
  assert.equal(item('users', { locale: 'fr-FR' }, 'en').locale_name, 'Français');
  assert.equal(item('users', { locale: 'de' }, 'es').locale_name, 'Deutsch');
  assert.equal('locale_name' in item('users', { locale: 'it' }, 'en'), false);
  assert.equal(item('vulnerabilities', { sources: 'nvd, cve_org' }, 'de').sources_name, 'NVD, Hersteller');
  const axis = item('analytics_axes', { applies_to: 'opex', required_for: 'opex, capex' }, 'fr');
  assert.deepEqual([axis.applies_to_name, axis.required_for_name], ['OPEX uniquement', 'OPEX, CAPEX']);
  const values = withCodeNames('get_filter_values', { entity_type: 'applications' }, { values: { data_residency: ['FR', 'BE'] } }, namer('es')) as any;
  assert.deepEqual(values.names, { data_residency: { FR: 'Francia', BE: 'Bélgica' } });
  console.log('  countries in four languages, residencies, profile languages, feeds, natures: OK');
}

/** A provider from the IT settings; a budget column by the workspace's name, else the product's. */
function testProvidersAndBudgetColumns() {
  const meta = (family: string, metadata: Record<string, unknown>, language: 'en' | 'fr' | 'de' | 'es') =>
    (withCodeNames('query_entities', { entity_type: family }, { items: [summary(family, null, metadata)] }, namer(language)) as any).items[0].metadata;
  assert.equal(meta('locations', { provider: 'k2d_cloud' }, 'fr').provider_name, 'Nuage K2d');
  // A location on premises carries its operating company's name, which no list names.
  assert.equal('provider_name' in meta('locations', { provider: 'Fromagerie Durand SA' }, 'fr'), false);
  // An asset's provider: a server provider, else a hosting type.
  assert.equal(meta('assets', { provider: 'k2d_cloud' }, 'de').provider_name, 'K2d cloud');
  assert.equal(meta('assets', { provider: 'k2d_hosting' }, 'de').provider_name, 'K2d hosting');
  const settings = normalizeBudgetColumns({ labels: { actual: 'Réel comptable' } });
  const filter = (budgetColumns: any) => (withCodeNames('get_filter_values', { entity_type: 'chargeback' }, {
    values: { column: ['budget', 'review', 'actual', 'landing'] },
  }, new AiCodeNamer('fr', CATALOGS, budgetColumns)) as any).names.column;
  assert.deepEqual(filter(settings), { budget: 'Budget', review: 'Révision', actual: 'Réel comptable', landing: 'Atterrissage prévu' });
  assert.equal(filter(null).actual, 'Réalisé');
  assert.deepEqual([aiFamilyNamesBudgetColumns('chargeback'), aiFamilyNamesBudgetColumns('chargeback_lines'), aiFamilyNamesBudgetColumns('applications')], [true, true, false]);
  console.log('  server providers and hosting types, budget columns by the workspace\'s names: OK');
}

/** The profile languages are the Profile screen's (`SUPPORTED_LANGUAGES` of `frontend/src/i18n/index.ts`). */
function testLanguageNamesAreTheProfileScreens() {
  const source = fs.readFileSync(backendPath('..', 'frontend', 'src', 'i18n', 'index.ts'), 'utf8');
  const screen = Object.fromEntries(Array.from(source.matchAll(/\{ code: '(\w+)', nativeLabel: '([^']+)' \}/g), (match) => [match[1], match[2]]));
  assert.deepEqual(screen, LANGUAGE_NATIVE_NAMES);
  console.log('  profile languages as the Profile screen lists them: OK');
}

function testEveryFixedListIsTheScreens() {
  for (const [name, list] of Object.entries(AI_CODE_LISTS)) assertCodeListIsTheScreens(name, list);
  for (const fields of Object.values(AI_NAMED_CHILD_FIELDS)) {
    for (const children of Object.values(fields)) for (const field of Object.values(children)) assert.ok(Object.values(AI_CODE_LISTS).includes(field.list as any));
  }
  console.log('  every fixed list is the screens\', in the four languages: OK');
}

/** A set field whose values are yes or no (with `all` for a filter that lifts a default). */
function isYesNo(field: { values?: unknown[] }): boolean {
  return Array.isArray(field.values) && field.values.length > 0 && field.values.every((value) => ['true', 'false', 'all'].includes(String(value)));
}

function testEveryCodeFieldIsNamedOrListed() {
  const missing: string[] = [];
  for (const [family, registry] of Object.entries(aiEntityRegistries)) {
    for (const [key, field] of Object.entries(registry.fields)) {
      if (field.type !== 'set') continue;
      const places = [
        AI_NAMED_FIELDS[family]?.[key] ? 'named' : null,
        isYesNo(field) ? 'yes or no' : null,
        AI_CODE_NAMES_PENDING[family]?.[key] ? 'pending' : null,
        AI_NOT_CODE_FIELDS[family]?.[key] ? 'not a code' : null,
      ].filter(Boolean);
      if (places.length === 0) missing.push(`${family}.${key}`);
      assert.ok(places.length <= 1, `${family}.${key} is ${places.join(' and ')}`);
    }
  }
  assert.deepEqual(missing, [], 'a set field of a read registry is neither named nor listed in ai-code-names.inventory.ts');
  // Every listed field exists: the lists say exactly what is left. An item's `status` may repeat a field.
  for (const [list, entries] of [['pending', AI_CODE_NAMES_PENDING], ['not a code', AI_NOT_CODE_FIELDS]] as const) {
    for (const [family, fields] of Object.entries(entries)) {
      for (const key of Object.keys(fields)) {
        const registry = aiEntityRegistries[family as keyof typeof aiEntityRegistries];
        assert.ok(registry, `${list}: ${family} is a family`);
        assert.ok(key === 'status' || registry.fields[key]?.type === 'set', `${list}: ${family}.${key} is a set field`);
      }
    }
  }
  // A code is left without a name only when no screen names it.
  for (const [family, fields] of Object.entries(AI_CODE_NAMES_PENDING)) {
    for (const [key, reason] of Object.entries(fields)) assert.match(reason, /^no screen word: /, `${family}.${key}: pending without a screen word`);
  }
  console.log('  every set field of a read registry is named, yes or no, or listed: OK');
}

function registryFor(manager: any, output: unknown) {
  const none = {} as any;
  return new AiToolRegistry(
    none,
    none,
    {
      assertSurfaceAccess: async () => undefined,
      listReadableEntityTypes: async () => ['projects'],
      canReadKnowledge: async () => false,
      assertEntityTypeReadAccess: async () => undefined,
      adminFamiliesGap: async () => 'right',
    } as any,
    { execute: async () => output } as any,
    none,
    { find: async () => ({}) } as any,
    none,
    none,
    { listOperations: () => [], getOperationOrNull: () => null } as any,
    { getCatalogLabels: async () => CATALOGS } as any,
  );
}

/** A manager that answers the person's locale and the workspace's language. */
function managerWith(locale: string | null, workspace: string) {
  return {
    query: async (sql: string) => {
      if (/FROM users/.test(sql)) return locale === undefined ? [] : [{ locale }];
      if (/FROM tenants/.test(sql)) return [{ metadata: { language: workspace } }];
      return [{ limited: false }];
    },
  };
}

async function testMcpLanguage() {
  const read = async (locale: string | null, screenLanguage?: string) => {
    const manager = managerWith(locale, 'de');
    const registry = registryFor(manager, { items: [summary('projects', 'on_hold', {})], total: 1, filters_ignored: [] });
    const context: any = { tenantId: 't', userId: '00000000-0000-4000-8000-000000000001', surface: screenLanguage ? 'chat' : 'mcp', authMethod: 'api_key', isPlatformHost: false, manager, screenLanguage };
    const out = await registry.execute(context, 'query_entities', { entity_type: 'projects' }) as any;
    return out.items[0].status_name;
  };
  // The person behind the key, when their profile sets a language.
  assert.equal(await read('es-ES'), 'En pausa');
  // Otherwise the workspace's language (`tenants.metadata.language`).
  assert.equal(await read(null), 'Pausiert');
  // Kad in the chat: the person's language, else the screen's.
  assert.equal(await read(null, 'fr'), 'Suspendu');
  assert.equal(await aiNamesLanguage(managerWith(null, 'xx') as any, 't', null), 'en');
  console.log('  MCP: the person\'s language, else the workspace\'s; the chat: else the screen\'s: OK');
}

/** The MCP server and Kad filter with names in the language of the person behind the key. */
async function testFilterNamesThroughTheRegistry() {
  const run = async (locale: string | null, filters: Record<string, unknown>, surface: 'mcp' | 'chat' = 'mcp') => {
    const manager = managerWith(locale, 'en');
    const received: any[] = [];
    const registry = registryFor(manager, { items: [], total: 0, filters_ignored: [] });
    (registry as any).queryExecutor.execute = async (_context: unknown, input: unknown) => {
      received.push(input);
      return { items: [summary('projects', 'on_hold', {})], total: 1, filters_ignored: [] };
    };
    const context: any = { tenantId: 't', userId: '00000000-0000-4000-8000-000000000001', surface, authMethod: 'api_key', isPlatformHost: false, manager };
    const out = await registry.execute(context, 'query_entities', { entity_type: 'projects', filters }) as any;
    return { input: received[0], out };
  };
  const german = await run('de-DE', { status: ['Pausiert'] });
  assert.deepEqual(german.input.filters, { status: ['on_hold'] });
  assert.equal(german.out.items[0].status_name, 'Pausiert');
  assert.equal(german.out.filter_values_unknown, undefined);
  // Another language than the person's, and the code itself.
  assert.deepEqual((await run('de-DE', { status: ['En pausa', 'in_progress'] }, 'chat')).input.filters, { status: ['on_hold', 'in_progress'] });
  console.log('  the MCP server and Kad filter with names: OK');
}

async function run() {
  console.log('ai-code-names.spec');
  testFixedListInTheFourLanguages();
  testCatalogLists();
  testUnknownCodeStaysAsStored();
  testAllocationMethodAndContactRole();
  testDetailAndChildRows();
  testDetailCountriesAndYearlyMethods();
  testFiltersTakeNames();
  testAggregateAndFilterValues();
  testSecondPassFixedLists();
  testCountriesLanguagesAndSeveralValues();
  testProvidersAndBudgetColumns();
  testLanguageNamesAreTheProfileScreens();
  testEveryFixedListIsTheScreens();
  testEveryCodeFieldIsNamedOrListed();
  await testMcpLanguage();
  await testFilterNamesThroughTheRegistry();
  console.log('ai-code-names.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
