import { describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import de from '../../locales/de/admin.json';
import en from '../../locales/en/admin.json';
import es from '../../locales/es/admin.json';
import fr from '../../locales/fr/admin.json';
import type { Translate } from './auditLogLabels';
import {
  auditFields,
  auditHasNonObjectPayload,
  auditRecordLabel,
  auditRecordRef,
  auditSnapshot,
  auditUserIds,
  formatAuditValue,
  type AuditValueContext,
} from './auditLogValues';

const t = i18n.getFixedT('en', 'admin') as unknown as Translate;
const tFr = i18n.getFixedT('fr', 'admin') as unknown as Translate;
const tFrAll = i18n.getFixedT('fr') as unknown as Translate;
const tEnAll = i18n.getFixedT('en') as unknown as Translate;
const ADMIN = { en, fr, de, es } as Record<string, any>;
const uuid = '11111111-1111-4111-8111-111111111111';
const otherUuid = '22222222-2222-4222-8222-222222222222';

function context(overrides: Partial<AuditValueContext> = {}): AuditValueContext {
  return { locale: 'en', t, snapshot: undefined, users: undefined, ...overrides };
}

function valueAt(tree: any, path: string): unknown {
  return path.split('.').reduce((node, part) => node?.[part], tree);
}

/** The budget history's enumerations, their stored code and their locale key. */
const BUDGET_ENUM_CASES: Array<{ field: string; code: string; key: string }> = [
  { field: 'input_grain', code: 'annual', key: 'inputGrain.annual' },
  { field: 'input_grain', code: 'quarterly', key: 'inputGrain.quarterly' },
  { field: 'input_grain', code: 'monthly', key: 'inputGrain.monthly' },
  { field: 'allocation_method', code: 'default', key: 'allocationMethod.default' },
  { field: 'allocation_method', code: 'headcount', key: 'allocationMethod.headcount' },
  { field: 'allocation_method', code: 'it_users', key: 'allocationMethod.itUsers' },
  { field: 'allocation_method', code: 'turnover', key: 'allocationMethod.turnover' },
  { field: 'allocation_method', code: 'manual_company', key: 'allocationMethod.manualCompany' },
  { field: 'allocation_method', code: 'manual_department', key: 'allocationMethod.manualDepartment' },
  { field: 'allocation_method', code: 'manual_pct', key: 'allocationMethod.manualPct' },
  { field: 'allocation_driver', code: 'headcount', key: 'allocationDriver.headcount' },
  { field: 'allocation_driver', code: 'it_users', key: 'allocationDriver.itUsers' },
  { field: 'allocation_driver', code: 'turnover', key: 'allocationDriver.turnover' },
  { field: 'spread_profile_name', code: 'flat', key: 'spreadProfile.flat' },
  { field: 'spread_profile_name', code: '4-4-5', key: 'spreadProfile.p445' },
  { field: 'method', code: 'spread', key: 'roundInputMethod.spread' },
  { field: 'method', code: 'manual', key: 'roundInputMethod.manual' },
  { field: 'method', code: 'computed', key: 'roundInputMethod.computed' },
  { field: 'nature', code: 'opex', key: 'nature.opex' },
  { field: 'nature', code: 'capex', key: 'nature.capex' },
  { field: 'run_build', code: 'run', key: 'runBuild.run' },
  { field: 'run_build', code: 'build', key: 'runBuild.build' },
  { field: 'role', code: 'commercial', key: 'contactRole.commercial' },
  { field: 'role', code: 'technical', key: 'contactRole.technical' },
  { field: 'role', code: 'support', key: 'contactRole.support' },
  { field: 'role', code: 'other', key: 'contactRole.other' },
  { field: 'origin', code: 'manual', key: 'origin.manual' },
  { field: 'origin', code: 'supplier', key: 'origin.supplier' },
];

describe('formatAuditValue', () => {
  it('names an application\'s category, access methods and user count method as its screen does', () => {
    const app = context({ table: 'applications' });
    expect(formatAuditValue('line_of_business', 'category', app).text).toBe('Line of business');
    expect(formatAuditValue(['local', 'vdi'], 'access_methods', app).text).toBe('Locally installed application, VDI / remote desktop');
    expect(formatAuditValue('it_users', 'users_mode', app).text).toBe('Derived');
    expect(formatAuditValue('headcount', 'users_mode', app).text).toBe('Derived');
    expect(formatAuditValue('manual', 'users_mode', app).text).toBe('Manual');
    const fr = context({ t: tFr, locale: 'fr', table: 'applications' });
    expect(formatAuditValue('it_users', 'users_mode', fr).text).toBe('Dérivé');
    // A code the shipped catalog does not know stays as stored.
    expect(formatAuditValue('custom_cat', 'category', app).text).toBe('custom_cat');
  });

  it('reads a tenant catalog code with the tenant\'s label first, then the shipped one, then the code', () => {
    const tenant: Record<string, Record<string, string>> = {
      applicationCategories: { line_of_business: 'Core business', custom_cat: 'Shop floor' },
      accessMethods: { kiosk_plus: 'Kiosk plus' },
      incidentCategories: { plant_stop: 'Plant stop' },
      serverRoles: { db: 'Our database' },
    };
    const catalogLabel = (list: string, code: string) => tenant[list]?.[code] ?? null;
    const app = context({ table: 'applications', catalogLabel });
    expect(formatAuditValue('line_of_business', 'category', app).text).toBe('Core business');
    expect(formatAuditValue('custom_cat', 'category', app).text).toBe('Shop floor');
    expect(formatAuditValue(['kiosk_plus', 'vdi'], 'access_methods', app).text).toBe('Kiosk plus, VDI / remote desktop');
    expect(formatAuditValue('db', 'server_role', app).text).toBe('Our database');
    expect(formatAuditValue('unknown_role', 'server_role', app).text).toBe('unknown_role');
    const incident = context({ table: 'incidents', catalogLabel });
    expect(formatAuditValue('plant_stop', 'category', incident).text).toBe('Plant stop');
    // The application list never names an incident's category, nor the reverse.
    expect(formatAuditValue('custom_cat', 'category', incident).text).toBe('custom_cat');
    expect(formatAuditValue('plant_stop', 'category', app).text).toBe('plant_stop');
  });

  it('marks every empty value with the empty-cell glyph', () => {
    expect(formatAuditValue(null, 'notes', context()).text).toBe('—');
    expect(formatAuditValue(undefined, 'notes', context()).text).toBe('—');
    expect(formatAuditValue('', 'notes', context()).text).toBe('—');
    expect(formatAuditValue('   ', 'notes', context()).text).toBe('—');
  });

  it('writes a boolean as yes or no', () => {
    expect(formatAuditValue(true, 'mfa_supported', context())).toEqual({ text: 'Yes' });
    expect(formatAuditValue(false, 'mfa_supported', context())).toEqual({ text: 'No' });
  });

  it('formats short dates and date-times with the page locale', () => {
    expect(formatAuditValue('2020-03-31', 'go_live_date', context()).text).toBe('31 Mar 2020');
    expect(formatAuditValue('2020-03-31T14:30:00', 'created_at', context()).text).toBe('31 Mar 2020, 02:30 PM');
  });

  it('always shows the year of a date and reads UTC midnight as a date', () => {
    const thisYear = new Date().getFullYear();
    expect(formatAuditValue(`${thisYear}-09-30`, 'created_at', context()).text).toBe(`30 Sep ${thisYear}`);
    expect(formatAuditValue('2028-06-30T00:00:00.000Z', 'created_at', context()).text).toBe('30 Jun 2028');
    expect(formatAuditValue('2028-06-30T00:00:00Z', 'created_at', context()).text).toBe('30 Jun 2028');
  });

  it('formats numbers with the page locale, except a year', () => {
    expect(formatAuditValue(1234.5, 'amount', context()).text).toBe('1,234.5');
    expect(formatAuditValue(2026, 'users_year', context()).text).toBe('2026');
    expect(formatAuditValue(2026, 'year', context()).text).toBe('2026');
  });

  it('joins a list of scalars and keeps dates readable inside it', () => {
    expect(formatAuditValue(['a', 'b'], 'label', context()).text).toBe('a, b');
    expect(formatAuditValue([1, 2], 'year', context()).text).toBe('1, 2');
    expect(formatAuditValue([true, false], 'mfa_supported', context()).text).toBe('Yes, No');
    expect(formatAuditValue(['2020-03-31'], 'start_date', context()).text).toBe('31 Mar 2020');
    expect(formatAuditValue([], 'label', context()).text).toBe('—');
  });

  it('renders an object or a list of objects as one line of JSON', () => {
    expect(formatAuditValue({ a: 1, b: 'two' }, 'notes', context()).text).toBe('{"a":1,"b":"two"}');
    expect(formatAuditValue([{ a: 1 }, { b: 2 }], 'notes', context()).text).toBe('[{"a":1},{"b":2}]');
  });

  it('names the data-access table and its sources', () => {
    expect(t('auditLogs.tableNames.user_data_access')).toBe('Data access');
    expect(t('auditLogs.sources.screen')).toBe('Screen');
    expect(t('auditLogs.sources.import')).toBe('Import');
  });

  it('reads the before and after of a data-access entry', () => {
    const snapshot = {
      mode: 'limited',
      nodes: [
        { type: 'company', name: 'Alpha Spain', access: 'edit' },
        { type: 'cost_center', code: 'INF', name: 'Infrastructure', access: 'read' },
        { type: 'all', name: null, access: 'read' },
      ],
    };
    expect(formatAuditValue('limited', 'mode', context({ snapshot })).text).toBe('Limited to');
    expect(formatAuditValue('all', 'mode', context({ snapshot })).text).toBe('All data');
    expect(formatAuditValue(snapshot.nodes, 'nodes', context({ snapshot })).text)
      .toBe('Alpha Spain (Edit), Infrastructure (Read), Everything (Read)');
    expect(formatAuditValue([], 'nodes', context({ snapshot })).text).toBe('No node');
  });

  it('truncates long JSON and keeps the full value in the title', () => {
    const value = { note: 'x'.repeat(180) };
    const display = formatAuditValue(value, 'notes', context());
    expect(display.text).toHaveLength(120);
    expect(display.text.endsWith('…')).toBe(true);
    expect(display.title).toBe(JSON.stringify(value));
  });

  it('never shows an id when a readable neighbour names it', () => {
    const display = formatAuditValue(uuid, 'supplier_id', context({ snapshot: { supplier_id: uuid, supplier_name: 'Acme' } }));
    expect(display).toEqual({ text: 'Acme' });
  });

  it('shows a secondary identifier, with the id in the title, when no neighbour names it', () => {
    const display = formatAuditValue(uuid, 'company_id', context({ snapshot: { company_id: uuid } }));
    expect(display).toEqual({ text: 'Identifier', title: uuid, secondary: true });
  });

  it('resolves the people named by the dialog in one lookup', () => {
    const users = new Map([[uuid, 'Alice Martin']]);
    expect(formatAuditValue(uuid, 'user_id', context({ users }))).toEqual({ text: 'Alice Martin' });
    expect(formatAuditValue(uuid, 'updated_by', context({ users }))).toEqual({ text: 'Alice Martin' });
    expect(formatAuditValue(uuid, 'owner_user_id', context({ users }))).toEqual({ text: 'Alice Martin' });
    expect(formatAuditValue(uuid, 'assigned_user_id', context({ users }))).toEqual({ text: 'Alice Martin' });
    expect(formatAuditValue(uuid, 'created_by', context({ users }))).toEqual({ text: 'Alice Martin' });
    expect(formatAuditValue(uuid, 'creator_id', context({ users }))).toEqual({ text: 'Alice Martin' });
    expect(formatAuditValue(uuid, 'reporter_user_id', context({ users }))).toEqual({ text: 'Alice Martin' });
    expect(formatAuditValue(uuid, 'requestor_id', context({ users }))).toEqual({ text: 'Alice Martin' });
  });

  it('falls back to the identifier when a person cannot be read', () => {
    const display = formatAuditValue(otherUuid, 'user_id', context({ users: new Map() }));
    expect(display).toEqual({ text: 'Identifier', title: otherUuid, secondary: true });
  });

  it('keeps a free-text string as it is', () => {
    expect(formatAuditValue('on_premise', 'notes', context()).text).toBe('on_premise');
    expect(formatAuditValue('open', 'name', context()).text).toBe('open');
  });

  it('shows the screen label of a known enumeration, in French', () => {
    const fr = context({ locale: 'fr', t: tFr });
    expect(formatAuditValue('open', 'status', { ...fr, table: 'incidents' }).text).toBe('Ouvert');
    expect(formatAuditValue('production', 'environment', fr).text).toBe('Production');
    expect(formatAuditValue('high', 'criticality', fr).text).toBe('Élevée');
    expect(formatAuditValue('not_a_real_code', 'status', { ...fr, table: 'incidents' }).text).toBe('not_a_real_code');
    expect(formatAuditValue('warehouse', 'environment', fr).text).toBe('warehouse');
  });

  it('uses the incident status list, and the common list everywhere else', () => {
    const fr = context({ locale: 'fr', t: tFr });
    expect(formatAuditValue('closed', 'status', { ...fr, table: 'incidents' }).text).toBe('Clôturé');
    expect(formatAuditValue('resolved', 'status', { ...fr, table: 'incidents' }).text).toBe('Résolu');
    expect(formatAuditValue('closed', 'status', { ...fr, table: 'suppliers' }).text).toBe('Fermé');
    expect(formatAuditValue('enabled', 'status', fr).text).toBe('Activé');
    expect(formatAuditValue('in_progress', 'status', fr).text).toBe('En cours');
    expect(formatAuditValue('active', 'lifecycle', fr).text).toBe('Actif');
    expect(formatAuditValue('retired', 'lifecycle', context()).text).toBe('Retired');
  });

  it('labels hosting, severity and mode from the screen lists', () => {
    expect(formatAuditValue('on_premise', 'hosting_model', context()).text).toBe('On premise');
    expect(formatAuditValue('public_cloud', 'hosting_model', context()).text).toBe('Public cloud');
    expect(formatAuditValue('pre_prod', 'environment', context()).text).toBe('Pre-prod');
    expect(formatAuditValue('business_critical', 'criticality', context()).text).toBe('Business critical');
    expect(formatAuditValue('critical', 'severity', context()).text).toBe('Critical');
    expect(formatAuditValue(['high', 'low'], 'criticality', context()).text).toBe('High, Low');
    expect(formatAuditValue('limited', 'mode', context()).text).toBe('limited');
    expect(formatAuditValue('limited', 'mode', context({ table: 'user_data_access' })).text).toBe('Limited to');
    expect(formatAuditValue('auto', 'mode', context({ table: 'allocation_rules' })).text).toBe('All enabled companies');
    expect(formatAuditValue('manual_company', 'mode', context({ table: 'allocation_rules' })).text).toBe('Selected companies');
    expect(formatAuditValue('custom', 'mode', context({ table: 'allocation_rules' })).text).toBe('custom');
    expect(formatAuditValue('on_premise', 'hosting_model', context({ locale: 'fr', t: tFr })).text).toBe('Sur site');
  });

  it('translates every known budget history enumeration in the four languages', () => {
    for (const language of ['en', 'fr', 'de', 'es']) {
      const langContext = context({
        locale: language,
        t: i18n.getFixedT(language, 'admin') as unknown as Translate,
      });
      for (const item of BUDGET_ENUM_CASES) {
        const expected = valueAt(ADMIN[language].auditLogs.values, item.key);
        expect(typeof expected, `${language} ${item.key}`).toBe('string');
        expect((expected as string).trim().length, `${language} ${item.key}`).toBeGreaterThan(0);
        expect(formatAuditValue(item.code, item.field, langContext).text, `${language} ${item.field}=${item.code}`)
          .toBe(expected);
      }
    }
  });

  it('names an analytics Used for from the screen list, in the four languages', () => {
    for (const language of ['en', 'fr', 'de', 'es']) {
      const langContext = context({
        locale: language,
        t: i18n.getFixedT(language, 'admin') as unknown as Translate,
      });
      expect(formatAuditValue('opex', 'applies_to', langContext).text, language)
        .toBe(valueAt(ADMIN[language].auditLogs.values, 'lineTypeUsage.opex'));
      expect(formatAuditValue('capex', 'applies_to', langContext).text, language)
        .toBe(valueAt(ADMIN[language].auditLogs.values, 'lineTypeUsage.capex'));
    }
  });

  it('names the IT values and the countries as their screens do', () => {
    const fr = (table?: string) => context({ locale: 'fr', t: tFrAll, table });
    expect(formatAuditValue('on_prem', 'provider', fr('assets')).text).toBe('Sur site');
    expect(formatAuditValue('internal', 'data_class', fr('interfaces')).text).toBe('Interne');
    expect(formatAuditValue('transactional', 'data_category', fr('interfaces')).text).toBe('Transactionnelles');
    expect(formatAuditValue('internal_users', 'source_entity_code', fr('connections')).text).toBe('Utilisateurs internes');
    expect(formatAuditValue('par_dc1', 'destination_entity_code', fr('connections')).text).toBe('par_dc1');
    expect(formatAuditValue('FR', 'country_iso', fr()).text).toBe('France (FR)');
    expect(formatAuditValue('FR', 'country', fr()).text).toBe('France (FR)');
    expect(formatAuditValue('internal', 'data_class', context({ locale: 'en', t: tEnAll, table: 'interfaces' })).text).toBe('Internal');
  });

  it('keeps an account number as stored, without a thousands separator', () => {
    expect(formatAuditValue('1300', 'account_number', context()).text).toBe('1300');
    expect(formatAuditValue(1300, 'consolidation_account_number', context()).text).toBe('1300');
    expect(formatAuditValue(1300, 'amount', context()).text).toBe('1,300');
  });

  it('names an account nature and a cost center kind as their screens do', () => {
    expect(formatAuditValue('opex', 'nature', context({ table: 'accounts' })).text).toBe('OPEX only');
    expect(formatAuditValue('capex', 'nature', context({ table: 'accounts' })).text).toBe('CAPEX only');
    expect(formatAuditValue('opex', 'nature', context({ table: 'spend_items' })).text).toBe('OPEX');
    expect(formatAuditValue('cost_center', 'kind', context({ table: 'cost_centers' })).text).toBe('Cost center');
    expect(formatAuditValue('group', 'kind', context({ table: 'cost_centers' })).text).toBe('Group');
    expect(formatAuditValue('shelf', 'kind', context({ table: 'cost_centers' })).text).toBe('shelf');
  });

  it('names a project, phase and milestone status, origin, modes and effort type from the portfolio lists', () => {
    const project = (locale: 'en' | 'fr') => ({
      locale,
      t: i18n.getFixedT(locale, ['admin', 'portfolio']) as unknown as Translate,
      table: 'portfolio_projects',
    });
    expect(formatAuditValue('in_testing', 'status', project('en')).text).toBe('In testing');
    expect(formatAuditValue('waiting_list', 'status', project('fr')).text).toBe("Liste d'attente");
    expect(formatAuditValue('in_progress', 'phase_status', project('en')).text).toBe('In progress');
    expect(formatAuditValue('achieved', 'milestone_status', project('fr')).text).toBe('Atteint');
    expect(formatAuditValue('fast_track', 'origin', project('en')).text).toBe('Fast-track');
    expect(formatAuditValue('collaborative', 'scheduling_mode', project('fr')).text).toBe('Collaboratif');
    expect(formatAuditValue('manual', 'it_effort_allocation_mode', project('en')).text).toBe('Manual');
    expect(formatAuditValue('auto', 'business_effort_allocation_mode', project('en')).text).toBe('Automatic');
    expect(formatAuditValue('business', 'category', project('en')).text).toBe('Business');
    // Elsewhere the shared names keep their own lists.
    expect(formatAuditValue('closed', 'status', { locale: 'fr', t: tFrAll, table: 'suppliers' }).text).toBe('Fermé');
    expect(formatAuditValue('business', 'category', { locale: 'en', t: tEnAll, table: 'suppliers' }).text).toBe('business');
  });

  it('names a request status from the request list', () => {
    const request = (locale: 'en' | 'fr') => ({
      locale,
      t: i18n.getFixedT(locale, ['admin', 'portfolio']) as unknown as Translate,
      table: 'portfolio_requests',
    });
    expect(formatAuditValue('pending_review', 'status', request('en')).text).toBe('Pending review');
    expect(formatAuditValue('converted', 'status', request('en')).text).toBe('Converted');
  });

  it('leaves an unknown budget enumeration code as stored', () => {
    expect(formatAuditValue('not_a_profile', 'spread_profile_name', context()).text).toBe('not_a_profile');
    expect(formatAuditValue('not_a_method', 'method', context()).text).toBe('not_a_method');
  });

  const costCenterId = '44444444-4444-4444-8444-444444444444';
  const ctxId = '33333333-3333-4333-8333-333333333333';
  const budgetQuery = {
    amountYears: '2025,2026',
    columns: 'budget,forecast,actual',
    ctx: ctxId,
    detail: 'yearly',
    filters: JSON.stringify({
      status: { filterType: 'set', values: ['enabled'] },
      name: { filterType: 'text', type: 'contains', filter: 'Acme' },
    }),
    format: 'xlsx',
    language: 'en',
    q: 'hosting',
    truncated: true,
  };
  const reportQuery = {
    costCenter: costCenterId,
    ctx: ctxId,
    format: 'csv',
    language: 'fr',
    measure: 'amount',
    metric: 'budget',
    runBuild: 'run',
    scope: 'opex',
    top: '10',
    truncated: true,
    tz: 'Europe/Paris',
    year: '2026',
  };

  it('names a budget file export and lists its parameters', () => {
    const exported = context({ table: 'export' });
    expect(formatAuditValue('budget-lines/budget-file', 'resource', exported).text).toBe('Budget file');
    expect(formatAuditValue('xlsx', 'format', exported).text).toBe('Excel (.xlsx)');
    const parameters = formatAuditValue(budgetQuery, 'query', exported);
    expect(parameters.text).toBe([
      'Years: 2025, 2026',
      'Columns: Budget, Forecast, Actuals',
      'Detail: Yearly totals',
      'Status: Enabled',
      'Name: Acme',
      'Format: Excel (.xlsx)',
      'Language: English',
      'Search: hosting',
    ].join('\n'));
    expect(parameters.title).toBeUndefined();
    expect(parameters.text).not.toContain(ctxId);

    const french = context({ locale: 'fr', t: tFr, table: 'export' });
    expect(formatAuditValue('budget-lines/budget-file', 'resource', french).text).toBe('Fichier budgétaire');
    expect(formatAuditValue(budgetQuery, 'query', french).text).toBe([
      'Années\u00a0: 2025, 2026',
      'Colonnes\u00a0: Budget, Prévision, Réalisé',
      'Détail\u00a0: Totaux annuels',
      'Statut\u00a0: Activé',
      'Nom\u00a0: Acme',
      'Format\u00a0: Excel (.xlsx)',
      'Langue\u00a0: English',
      'Recherche\u00a0: hosting',
    ].join('\n'));
  });

  it('names a report export and lists its parameters, with an identifier in the title', () => {
    const exported = context({ table: 'export' });
    expect(formatAuditValue('reports/budget/top-lines', 'resource', exported).text).toBe('Top lines report');
    expect(formatAuditValue('csv', 'format', exported).text).toBe('CSV');
    const parameters = formatAuditValue(reportQuery, 'query', exported);
    expect(parameters.text).toBe([
      'Cost center: Identifier',
      'Format: CSV',
      'Language: Français',
      'Measure: Amount',
      'Metric: Budget',
      'Run or build: Run',
      'Scope: OPEX',
      'Top count: 10',
      'Time zone: Europe/Paris',
      'Year: 2026',
    ].join('\n'));
    expect(parameters.title).toBe(costCenterId);
    expect(parameters.text).not.toContain(costCenterId);
    expect(parameters.text).not.toContain(ctxId);

    const french = context({ locale: 'fr', t: tFr, table: 'export' });
    expect(formatAuditValue('reports/budget/top-lines', 'resource', french).text).toBe('Rapport du top lignes');
    const frenchParameters = formatAuditValue(reportQuery, 'query', french);
    expect(frenchParameters.text).toBe([
      'Centre de coûts\u00a0: Identifiant',
      'Format\u00a0: CSV',
      'Langue\u00a0: Français',
      'Mesure\u00a0: Montant',
      'Métrique\u00a0: Budget',
      'Run ou build\u00a0: Run',
      'Périmètre\u00a0: OPEX',
      'Nombre de premiers\u00a0: 10',
      'Fuseau horaire\u00a0: Europe/Paris',
      'Année\u00a0: 2026',
    ].join('\n'));
    expect(frenchParameters.title).toBe(costCenterId);
  });

  it('leaves an unknown export resource as stored, and a query on another table as JSON', () => {
    expect(formatAuditValue('not-a-resource', 'resource', context({ table: 'export' })).text).toBe('not-a-resource');
    expect(formatAuditValue('pdf', 'format', context({ table: 'export' })).text).toBe('pdf');
    expect(formatAuditValue({ q: 'enabled', scope: 'data', sort: 'name:ASC' }, 'query', context({ table: 'export' })).text)
      .toBe('Search: enabled\nScope: data\nSort: name:ASC');
    expect(formatAuditValue({ a: 1 }, 'query', context({ table: 'suppliers' })).text).toBe('{"a":1}');
    expect(formatAuditValue('budget-lines/budget-file', 'resource', context({ table: 'suppliers' })).text)
      .toBe('budget-lines/budget-file');
  });
});

describe('audit entry helpers', () => {
  const updateRow = {
    action: 'update',
    table_name: 'tasks',
    record_id: uuid,
    before_json: { id: uuid, tenant_id: otherUuid, status: 'draft', created_at: '2020-01-01', notes: 'same' },
    after_json: { id: uuid, tenant_id: otherUuid, status: 'active', created_at: '2020-01-01', notes: 'same', updated_at: '2020-01-02' },
  };

  it('reads the changed fields of an update, without the technical ids', () => {
    const fields = auditFields(updateRow);
    expect(fields.mode).toBe('change');
    expect(fields.rows.map((row) => row.key)).toEqual(['status']);
    expect(fields.rows[0]).toMatchObject({ before: 'draft', after: 'active' });
  });

  it('drops empty update rows and technical noise keys', () => {
    const fields = auditFields({
      action: 'update',
      before_json: {
        status: null, notes: '', tags: [], name: 'Old', __typename: 'Old',
        search_vector: 'old', content_plain: 'old', content_markdown: 'old',
      },
      after_json: {
        status: '', notes: '   ', tags: null, name: 'New', __typename: 'New',
        search_vector: 'new', content_plain: 'new', content_markdown: 'new',
      },
    });
    expect(fields.rows.map((row) => row.key)).toEqual(['name', 'content_markdown']);
  });

  it('reads one side for a create, keeping created_at there only', () => {
    const fields = auditFields({
      action: 'create',
      before_json: null,
      after_json: { id: uuid, tenant_id: otherUuid, name: 'Acme', created_at: '2020-01-01', updated_at: '2020-01-02' },
    });
    expect(fields.mode).toBe('single');
    expect(fields.rows.map((row) => row.key)).toEqual(['name', 'created_at']);
  });

  it('reads the before side of a delete', () => {
    const fields = auditFields({
      action: 'delete',
      before_json: { id: uuid, name: 'Acme', created_at: '2020-01-01' },
      after_json: null,
    });
    expect(fields.rows.map((row) => row.key)).toEqual(['name']);
  });

  it('reads the metadata of a sign-in or export event', () => {
    const fields = auditFields({
      action: 'export',
      table_name: 'export',
      after_json: { resource: 'users', format: 'csv', created_at: '2020-01-01' },
    });
    expect(fields.mode).toBe('single');
    expect(fields.rows.map((row) => row.key)).toEqual(['resource', 'format']);
  });

  it('keeps the route of an export out of the field list', () => {
    const fields = auditFields({
      action: 'export',
      table_name: 'export',
      after_json: {
        resource: 'budget-lines/budget-file',
        path: '/budget-lines/budget-file/export',
        query: { format: 'xlsx' },
        format: 'xlsx',
        rows: 4,
      },
    });
    expect(fields.rows.map((row) => row.key)).toEqual(['resource', 'query', 'format', 'rows']);
  });

  it('detects a payload that is not an object', () => {
    expect(auditHasNonObjectPayload({ before_json: ['x'], after_json: null })).toBe(true);
    expect(auditHasNonObjectPayload({ before_json: { a: 1 }, after_json: { b: 2 } })).toBe(false);
  });

  it('names the record with its item number when the table has one', () => {
    expect(auditRecordRef({ table_name: 'tasks', record_id: uuid, after_json: { item_number: 4 } })).toBe('T-4');
    expect(auditRecordRef({ table_name: 'portfolio_projects', record_id: uuid, after_json: { item_number: 3 } })).toBe('PRJ-3');
    expect(auditRecordRef({ table_name: 'suppliers', record_id: uuid, after_json: { name: 'Acme' } })).toBeNull();
  });

  it('names an application and an asset by the reference stored on the payload', () => {
    expect(auditRecordRef({ table_name: 'applications', record_id: uuid, after_json: { sequential_id: 'APP-12' } })).toBe('APP-12');
    expect(auditRecordRef({ table_name: 'assets', record_id: uuid, before_json: { asset_reference: 'AST-31' } })).toBe('AST-31');
    expect(auditRecordRef({ table_name: 'locations', record_id: uuid, after_json: { location_reference: 'LOC-4' } })).toBe('LOC-4');
    expect(auditRecordRef({ table_name: 'connections', record_id: uuid, after_json: { connection_reference: 'CONN-2' } })).toBe('CONN-2');
    expect(auditRecordRef({ table_name: 'interfaces', record_id: uuid, after_json: { interface_reference: 'INT-8' } })).toBe('INT-8');
    expect(auditRecordRef({
      table_name: 'applications',
      before_json: { sequential_id: 'APP-1' },
      after_json: { sequential_id: 'APP-12' },
    })).toBe('APP-12');
    expect(auditRecordRef({ table_name: 'applications', record_id: uuid, after_json: { sequential_id: '  ' } })).toBeNull();
    expect(auditRecordRef({ table_name: 'assets', record_id: uuid, after_json: { name: 'db01' } })).toBeNull();
    expect(auditRecordLabel({ table_name: 'applications', record_id: uuid, after_json: { sequential_id: 'APP-12' } }, t))
      .toEqual({ text: 'APP-12' });
    expect(auditRecordLabel({ table_name: 'assets', record_id: uuid, after_json: { asset_reference: 'AST-31' } }, t))
      .toEqual({ text: 'AST-31' });
  });

  it('shows an identifier label, with the id in the title, when the record has no business reference', () => {
    expect(auditRecordLabel({ table_name: 'suppliers', record_id: uuid, after_json: { name: 'Acme' } }, t))
      .toEqual({ text: 'Identifier', title: uuid });
    expect(auditRecordLabel({ table_name: 'tasks', record_id: uuid, after_json: { item_number: 4 } }, t))
      .toEqual({ text: 'T-4' });
    expect(auditRecordLabel({ table_name: 'suppliers', record_id: null }, t)).toBeNull();
  });

  it('merges the two payloads for the readable neighbours', () => {
    expect(auditSnapshot({
      before_json: { supplier_name: 'Acme', old: true },
      after_json: { supplier_id: uuid, new: true },
    })).toEqual({ supplier_name: 'Acme', old: true, supplier_id: uuid, new: true });
  });

  it('collects the people of the rows once each', () => {
    const fields = auditFields({
      action: 'update',
      before_json: { user_id: uuid, owner_user_id: otherUuid },
      after_json: { user_id: otherUuid, owner_user_id: otherUuid },
    });
    expect(auditUserIds(fields)).toEqual([uuid, otherUuid].sort());
  });
});

describe('audit field labels', () => {
  const newFields = [
    'severity', 'detected_at', 'started_at', 'resolved_at', 'closed_at', 'confidential',
    'personal_data_affected', 'planned_start', 'planned_end', 'it_lead_id', 'business_lead_id',
    'created_by', 'creator_id', 'reporter_user_id', 'purpose', 'content_markdown', 'is_suite',
    'users_mode', 'users_year', 'users_override', 'external_facing', 'access_methods',
    'etl_enabled', 'classification_justification', 'classification_review',
    'classification_revision',
  ];
  const locales = { en, fr, de, es } as Record<string, any>;

  it('has a product label for the new fields in the four languages', () => {
    for (const [language, admin] of Object.entries(locales)) {
      for (const key of newFields) {
        expect(admin.auditLogs.fields[key], `${language} ${key}`).toBeTruthy();
      }
    }
  });
});
