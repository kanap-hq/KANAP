import * as assert from 'node:assert/strict';
import {
  AI_CODE_LISTS,
  AI_NAMED_CHILD_FIELDS,
  AI_NAMED_FIELDS,
  AiCodeNamer,
  aiNamesLanguage,
  withCodeNames,
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
  hostingTypes: [{ code: 'public_cloud', label: 'Public cloud' }],
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

async function run() {
  console.log('ai-code-names.spec');
  testFixedListInTheFourLanguages();
  testCatalogLists();
  testUnknownCodeStaysAsStored();
  testAllocationMethodAndContactRole();
  testDetailAndChildRows();
  testAggregateAndFilterValues();
  testEveryFixedListIsTheScreens();
  testEveryCodeFieldIsNamedOrListed();
  await testMcpLanguage();
  console.log('ai-code-names.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
