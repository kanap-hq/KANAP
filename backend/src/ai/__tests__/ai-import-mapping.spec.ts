import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { REQUIRE_LEVEL_KEY, RequireLevelMeta } from '../../auth/require-level.decorator';
import { RESERVED_TO_UNSCOPED_DATA_ACCESS_KEY } from '../../data-access/reserved-operations';
import { Features } from '../../config/features';
import { Tenant, TenantStatus } from '../../tenants/tenant.entity';
import { UserRole } from '../../users/user-role.entity';
import { Subscription } from '../../billing/subscription.entity';
import { CsvEntityConfig } from '../../common/csv/csv-field.types';
import { applicationCsvConfig } from '../../applications/application-csv.config';
import { assetCsvConfig } from '../../assets/asset-csv.config';
import { portfolioProjectCsvConfig } from '../../portfolio/portfolio-project-csv.config';
import { portfolioRequestCsvConfig } from '../../portfolio/portfolio-request-csv.config';
import { taskCsvConfig } from '../../tasks/task-csv.config';
import { incidentCsvConfig } from '../../incidents/incident-csv.config';
import { SUPPLIER_CSV_COLUMNS } from '../../suppliers/supplier-csv-headers';
import { CONTRACT_CSV_COLUMNS } from '../../contracts/contract-csv-headers';
import { COST_CENTER_CSV_HEADERS } from '../../cost-centers/cost-centers-csv.service';
import { ANALYTICS_VALUE_CSV_HEADERS } from '../../analytics/analytics-categories-csv.service';
import { WORKING_DAY_PROFILE_CSV_HEADERS } from '../../working-day-profiles/working-day-profiles-csv.service';
import { APPLICATION_LINK_CSV_HEADERS, ASSET_LINK_CSV_HEADERS } from '../../technologies/technology-links-csv.service';
import { CompaniesService } from '../../companies/companies.service';
import { ContactsService } from '../../contacts/contacts.service';
import { DepartmentsService } from '../../departments/departments.service';
import { AccountsService } from '../../accounts/accounts.service';
import { BusinessProcessesService } from '../../business-processes/business-processes.service';
import { detailColumns } from '../../spend/budget-file/columns';
import { AiPolicyService } from '../ai-policy.service';
import { AiMutationPreviewService } from '../ai-mutation-preview.service';
import { AiMutationPreview } from '../ai-mutation-preview.entity';
import { AiMutationPlan } from '../ai-mutation-plan.entity';
import { AiMutationPlanStep } from '../ai-mutation-plan-step.entity';
import { AiEvidenceService } from '../control-plane/evidence/ai-evidence.service';
import { MODEL_HIDDEN_OUTPUT_FIELDS } from '../control-plane/capability/ai-capability.registry';
import { isReservedAiMutation } from '../mutation/ai-mutation-reserved';
import { aiRelationTargetRequirement, aiWriteLevel, aiWriteRequirements } from '../mutation/ai-write-levels';
import { PrepareImportMappingAiMutationOperation } from '../mutation/operations/prepare-import-mapping.ai-mutation-operation';
import { AI_IMPORT_ACCESS, AI_IMPORT_KEYS, AI_IMPORT_RESOURCES, AiImportKey } from '../import/ai-import-access';
import { AI_IMPORT_TARGETS, importColumnTitle } from '../import/ai-import-targets';
import { columnReader } from '../import/ai-import-convert';
import { AiImportMappingService } from '../import/ai-import-mapping.service';
import { AiImportRunnerService, budgetBilan, personLine, rowsBilan } from '../import/ai-import-runner.service';
import { AiChatOrchestratorService } from '../ai-chat-orchestrator.service';
import { readTableAttachment } from '../attachments/table-attachment';
import { AuditLog } from '../../audit/audit.entity';
import type { AiImportRunDto } from '../ai.types';
import { selectAiContextProfile } from '../ai-context-profile';
import { AI_IMPORT_ROUTES } from './ai-import-routes';

/**
 * Lots I2 and I3 of the Plaid import: the column mapping of an attached spreadsheet onto an
 * import's template, and the import's check and load of the file it builds. Rights of every import
 * as its route, the template as the import reads it, the cell conversions, three files (clean,
 * messy, unknown columns), the rights on the preview path (contributor, reader refused, limited
 * person), the approval that runs the import, and what the model receives. The imports themselves
 * are stubbed here: ai-import-run.integration.spec.ts runs them on the database.
 */

const TENANT = 'tenant-1';
const USER = 'user-1';
const FILE = '11111111-1111-4111-8111-111111111111';

// --- Rights of each import, as its route -----------------------------------------------------

function testAccessMatchesTheImportRoutes() {
  for (const key of AI_IMPORT_KEYS) {
    const [controller, method] = AI_IMPORT_ROUTES[key];
    const handler = (controller.prototype as Record<string, unknown>)[method];
    assert.equal(typeof handler, 'function', `${controller.name}.${method} exists`);
    const guard = Reflect.getMetadata(REQUIRE_LEVEL_KEY, handler as object) as RequireLevelMeta;
    const access = AI_IMPORT_ACCESS[key];
    assert.deepEqual(guard, { resource: access.resource, level: access.level }, `${key}: the level of ${controller.name}.${method}`);
    const reserved = Reflect.getMetadata(RESERVED_TO_UNSCOPED_DATA_ACCESS_KEY, handler as object) === true;
    assert.equal(access.reservedToUnscoped, reserved, `${key}: reserved as its route`);
    assert.equal(isReservedAiMutation('prepare_import_mapping', key), reserved, `${key}: reserved for Plaid`);
    assert.equal(aiWriteLevel('prepare_import_mapping', key), access.level, `${key}: Plaid level`);
  }
  // The application links read the applications they name; no other import reads another module.
  assert.deepEqual(aiRelationTargetRequirement('prepare_import_mapping', 'technology_application_links', undefined), { resource: 'applications', level: 'reader' });
  assert.equal(aiRelationTargetRequirement('prepare_import_mapping', 'technology_asset_links', undefined), null);
  assert.equal(aiWriteLevel('prepare_import_mapping', 'users'), 'admin');
  // Offered to a person who may run one import: each module at the level of its routes, once.
  const requirements = aiWriteRequirements('prepare_import_mapping', AI_IMPORT_RESOURCES);
  assert.equal(new Set(requirements.map((r) => `${r.resource}:${r.level}`)).size, requirements.length);
  assert.ok(requirements.some((r) => r.resource === 'incidents' && r.level === 'contributor'));
  assert.ok(requirements.some((r) => r.resource === 'infrastructure' && r.level === 'member'));
  assert.ok(requirements.some((r) => r.resource === 'infrastructure' && r.level === 'admin'));
  console.log(`  ${AI_IMPORT_KEYS.length} imports: rights as their routes: OK`);
}

// --- The template, as the import reads it ----------------------------------------------------

function importableColumns(config: CsvEntityConfig): string[] {
  return config.fields.filter((field) => field.importable !== false).map((field) => field.csvColumn);
}

const privateHeaders = (service: { prototype: object }, ...args: unknown[]): string[] =>
  (Object.create(service.prototype) as { csvHeaders(...a: unknown[]): string[] }).csvHeaders(...args);

async function testTemplatesAreTheColumnsTheImportsRead() {
  const year = new Date().getFullYear();
  const read: Record<AiImportKey, readonly string[]> = {
    applications: importableColumns(applicationCsvConfig),
    assets: importableColumns(assetCsvConfig),
    portfolio_projects: importableColumns(portfolioProjectCsvConfig),
    portfolio_requests: importableColumns(portfolioRequestCsvConfig),
    tasks: importableColumns(taskCsvConfig),
    incidents: importableColumns(incidentCsvConfig),
    budget_lines: [
      ...detailColumns(['it_tower']),
      ...[year - 1, year, year + 1].flatMap((y) => ['budget', 'revision', 'forecast', 'actual', 'landing'].map((m) => `${m}_${y}`)),
    ],
    contracts: CONTRACT_CSV_COLUMNS,
    suppliers: SUPPLIER_CSV_COLUMNS,
    contacts: privateHeaders(ContactsService),
    companies: privateHeaders(CompaniesService, year),
    departments: privateHeaders(DepartmentsService),
    cost_centers: COST_CENTER_CSV_HEADERS,
    accounts: privateHeaders(AccountsService, true),
    analytics_categories: ANALYTICS_VALUE_CSV_HEADERS,
    business_processes: privateHeaders(BusinessProcessesService),
    working_day_calendars: WORKING_DAY_PROFILE_CSV_HEADERS,
    technology_asset_links: ASSET_LINK_CSV_HEADERS,
    technology_application_links: APPLICATION_LINK_CSV_HEADERS,
  };
  const ctx = { manager: { query: async () => [{ id: 'a', code: 'it_tower', name: 'IT tower', status: 'enabled', is_default: false, applies_to: null, required: false, open_values: false, disabled_at: null, sort_order: 1 }] } as any, tenantId: TENANT };
  for (const key of AI_IMPORT_KEYS) {
    const columns = await AI_IMPORT_TARGETS[key].columns(ctx);
    assert.ok(columns.length > 0, `${key}: columns`);
    const names = columns.map((column) => column.column);
    assert.equal(new Set(names).size, names.length, `${key}: each column once`);
    for (const name of names) assert.ok(read[key].includes(name), `${key}: ${name} is a column its import reads`);
    for (const column of columns) {
      if (column.kind === 'codes') assert.ok(column.codes?.length, `${key}.${column.column}: its codes`);
      if (column.kind === 'catalog') assert.ok(column.catalog, `${key}.${column.column}: its catalog`);
    }
    // A title in every language, for the card: the list's name, and each column's own title.
    for (const name of AI_IMPORT_TARGETS[key].names ? Object.values(AI_IMPORT_TARGETS[key].names) : []) assert.ok(name);
    for (const column of columns) {
      for (const language of ['en', 'fr', 'de', 'es'] as const) {
        assert.notEqual(importColumnTitle(column, language), column.column, `${key}.${column.column}: a title in ${language}`);
      }
    }
  }
  const budget = await AI_IMPORT_TARGETS.budget_lines.columns(ctx);
  assert.equal(importColumnTitle(budget.find((column) => column.column === 'analytics:it_tower')!, 'fr'), 'IT tower');
  assert.equal(importColumnTitle(budget.find((column) => column.column === `landing_${year}`)!, 'fr'), `Atterrissage prévu ${year}`);
  const tasks = await AI_IMPORT_TARGETS.tasks.columns(ctx);
  assert.equal(importColumnTitle(tasks.find((column) => column.column === 'viewer_email_2')!, 'de'), 'E-Mail Beobachter 2');
  const calendars = await AI_IMPORT_TARGETS.working_day_calendars.columns(ctx);
  assert.equal(importColumnTitle(calendars.find((column) => column.column === 'aug')!, 'fr'), 'Août');
  // The identity columns stay out: the person's file has no KANAP id or reference.
  const applications = (await AI_IMPORT_TARGETS.applications.columns(ctx)).map((column) => column.column);
  assert.ok(!applications.includes('id') && !applications.includes('reference'));
  console.log('  templates are the columns the imports read: OK');
}

// --- Cell conversion -------------------------------------------------------------------------

const text = (value: string) => ({ kind: 'text' as const, value });

function read(rule: Parameters<typeof columnReader>[0], values: string[], hints: Parameters<typeof columnReader>[2] = {}, language: 'en' | 'fr' = 'en') {
  const cells = values.map(text);
  const reader = columnReader(rule, cells, hints, language);
  return { reader, results: cells.map((cell) => reader.read(cell)) };
}

function testConversions() {
  // A day after the twelfth settles the order: the whole column reads day first.
  let { reader, results } = read({ kind: 'date' }, ['03/04/2026', '25/12/2025', '2026-01-15', '']);
  assert.deepEqual(reader.settled, { dateOrder: 'day-first' });
  assert.deepEqual(results, [
    { status: 'converted', value: '2026-04-03' },
    { status: 'converted', value: '2025-12-25' },
    { status: 'converted', value: '2026-01-15' },
    { status: 'blank' },
  ]);
  // The order the file shows wins over the one the mapping supposed.
  ({ reader, results } = read({ kind: 'date' }, ['12/25/2025', '01/02/2026'], { dateOrder: 'day-first' }));
  assert.deepEqual(reader.settled, { dateOrder: 'month-first' });
  assert.deepEqual(results[1], { status: 'converted', value: '2026-01-02' });
  // Both orders in one column: no cell reads, and the column says why.
  ({ reader, results } = read({ kind: 'date' }, ['25/12/2025', '12/25/2025']));
  assert.equal(reader.error, 'mixed-date-orders');
  assert.deepEqual(results[0], { status: 'unread', raw: '25/12/2025' });
  // Numbers with a decimal comma, booleans in four languages.
  ({ reader, results } = read({ kind: 'number' }, ['1 234,50', '12,5', 'n/a'], {}, 'fr'));
  assert.deepEqual(reader.settled, { decimalMark: ',' });
  assert.deepEqual(results, [
    { status: 'converted', value: '1234.5' },
    { status: 'converted', value: '12.5' },
    { status: 'unread', raw: 'n/a' },
  ]);
  ({ results } = read({ kind: 'boolean' }, ['Oui', 'nein', 'peut-être']));
  assert.deepEqual(results.map((r) => r.status === 'converted' ? r.value : r.status), ['true', 'false', 'unread']);
  // A fixed list reads its codes, their names in any language, and the mapping's value map.
  const status = { kind: 'codes' as const, codes: ['enabled', 'disabled'], codeLabels: { enabled: ['Enabled', 'Activé'], disabled: ['Disabled', 'Désactivé'] } };
  ({ results } = read(status, ['enabled', 'Désactivé', 'Actif', 'DESACTIVE'], { values: { actif: 'enabled' } }));
  assert.deepEqual(results.map((r) => r.status === 'converted' ? r.value : r.status), ['enabled', 'disabled', 'enabled', 'disabled']);
  // A catalog reads the workspace's names and the shipped names; a name two entries carry is not a guess.
  const lifecycle = {
    kind: 'catalog' as const,
    multi: true,
    options: [
      { code: 'active', label: 'Active', shippedLabels: ['Active', 'Actif', 'Aktiv', 'Activo'] },
      { code: 'retired', label: 'Retired', shippedLabels: ['Retired', 'Retiré'] },
      { code: 'twin_a', label: 'Twin' },
      { code: 'twin_b', label: 'twin' },
      { code: 'high', label: 'Élevée' },
      { code: 'summary_a', label: 'Résumé' },
      { code: 'summary_b', label: 'Resumé' },
    ],
  };
  // A name written without its accents reads as the one entry it can name ("Elevee" is "Élevée"), not two.
  ({ results } = read(lifecycle, ['Actif', 'retiré; Active', 'Twin', 'En prod', 'Elevée', 'RETIRE', 'Resume']));
  assert.deepEqual(results, [
    { status: 'converted', value: 'active' },
    { status: 'converted', value: 'retired, active' },
    { status: 'unread', raw: 'Twin' },
    { status: 'unread', raw: 'En prod' },
    { status: 'converted', value: 'high' },
    { status: 'converted', value: 'retired' },
    { status: 'unread', raw: 'Resume' },
  ]);
  console.log('  conversions: OK');
}

function testConversionsOfRealExports() {
  // The value map reads any column: a name for a reference, a number, an e-mail; "" leaves the cell blank.
  let { results } = read({ kind: 'reference' }, ['Paris DC', 'Lyon'], { values: { 'Paris DC': 'PAR-DC1' } });
  assert.deepEqual(results, [{ status: 'converted', value: 'PAR-DC1' }, { status: 'converted', value: 'Lyon' }]);
  ({ results } = read({ kind: 'number' }, ['3 months', '30 days', '6', 'soon'], { values: { '3 months': '3', '30 days': '1' } }));
  assert.deepEqual(results, [
    { status: 'converted', value: '3' },
    { status: 'converted', value: '1' },
    { status: 'converted', value: '6' },
    { status: 'unread', raw: 'soon' },
  ]);
  ({ results } = read({ kind: 'email' }, ['Mercier Hugo'], { values: { 'mercier hugo': 'hugo.mercier@fromage-co.com' } }));
  assert.deepEqual(results, [{ status: 'converted', value: 'hugo.mercier@fromage-co.com' }]);
  ({ results } = read({ kind: 'codes', codes: ['opex', 'capex'] }, ['OPEX', 'Les deux'], { values: { 'Les deux': '' } }));
  assert.deepEqual(results, [{ status: 'converted', value: 'opex' }, { status: 'blank' }]);
  // A value the map turns into one the column still cannot read is unread as the file writes it.
  ({ results } = read({ kind: 'date' }, ['TBD'], { values: { TBD: 'later' } }));
  assert.deepEqual(results, [{ status: 'unread', raw: 'TBD' }]);

  // Dates with the month's name, as Jira and French exports write them.
  ({ results } = read({ kind: 'date' }, ['15/Nov/26', '3 janvier 2027', 'Nov 5, 2026', '15. Dezember 2026', '28/Oct/26 9:41 AM']));
  assert.deepEqual(results.map((r) => r.status === 'converted' ? r.value : r.status), ['2026-11-15', '2027-01-03', '2026-11-05', '2026-12-15', '2026-10-28']);

  // A date and time keeps its time: GLPI's 02-10-2026 07:48, Jira's 2:10 PM, a time stamp, a day alone.
  ({ results } = read({ kind: 'datetime' }, ['02-10-2026 07:48', '25-12-2026 18:05:30', '4/Nov/26 2:10 PM', '2026-10-06T09:15:00Z', '26-10-2026']));
  assert.deepEqual(results.map((r) => r.status === 'converted' ? r.value : r.status), [
    '2026-10-02 07:48', '2026-12-25 18:05:30', '2026-11-04 14:10', '2026-10-06T09:15:00.000Z', '2026-10-26',
  ]);
  const fromWorkbook = columnReader({ kind: 'datetime' }, [{ kind: 'date', iso: '2026-10-02', time: '07:48:00' }], {}, 'fr');
  assert.deepEqual(fromWorkbook.read({ kind: 'date', iso: '2026-10-02', time: '07:48:00' }), { status: 'converted', value: '2026-10-02 07:48' });

  // A percentage: a cell shown as 45% holds 0.45, the import takes 45. A plain number stays itself.
  const progress = [{ kind: 'number' as const, value: '0.45', percent: true as const }, { kind: 'number' as const, value: '60' }, text('80 %')];
  const percent = columnReader({ kind: 'number', percent: true }, progress, {}, 'fr');
  assert.deepEqual(progress.map((cell) => percent.read(cell)), [
    { status: 'converted', value: '45' },
    { status: 'converted', value: '60' },
    { status: 'converted', value: '80' },
  ]);
  const share = columnReader({ kind: 'number' }, [progress[0]], {}, 'fr');
  assert.deepEqual(share.read(progress[0]), { status: 'converted', value: '0.45' });

  // A country by its code or its name in four languages; a list of them.
  ({ results } = read({ kind: 'country' }, ['France', 'Pays-Bas', 'Niederlande', 'Países Bajos', 'UK', 'de', 'Atlantis']));
  assert.deepEqual(results.map((r) => r.status === 'converted' ? r.value : r.status), ['FR', 'NL', 'NL', 'NL', 'GB', 'DE', 'unread']);
  ({ results } = read({ kind: 'country', multi: true }, ['France; Allemagne', 'EU'], { values: { EU: 'FR, DE, IT' } }));
  assert.deepEqual(results, [{ status: 'converted', value: 'FR, DE' }, { status: 'converted', value: 'FR, DE, IT' }]);
  console.log('  conversions of real exports: OK');
}

// --- The mapping on three files --------------------------------------------------------------

const SETTINGS = {
  lifecycleStates: [
    { code: 'proposed', label: 'Proposed' },
    { code: 'active', label: 'Active' },
    { code: 'deprecated', label: 'Deprecated' },
    { code: 'retired', label: 'Retired' },
  ],
  applicationCategories: [{ code: 'line_of_business', label: 'Line of business' }],
  businessCriticalityLevels: [{ code: 'business_critical', label: 'Critical' }, { code: 'low', label: 'Low' }],
  accessMethods: [{ code: 'web', label: 'Web' }],
};

type StubFile = { csv: string; filename: string; kind?: string; conversationId?: string };

function createManager(options: { limited?: boolean; locale?: string } = {}) {
  const previews: any[] = [];
  const audits: any[] = [];
  const previewRepo = {
    find: async () => previews.filter((preview) => preview.status === 'pending'),
    update: async (criteria: any, values: any) => {
      const ids: string[] = criteria.id?.value ?? [criteria.id];
      for (const preview of previews) {
        if (ids.includes(preview.id) && preview.status === criteria.status) Object.assign(preview, values);
      }
    },
    findOne: async ({ where }: any) => previews.find((preview) => preview.id === where.id) ?? null,
    count: async () => previews.filter((preview) => preview.status === 'pending').length,
    create: (payload: any) => ({ id: `preview-${previews.length + 1}`, ...payload }),
    save: async (record: any) => {
      const index = previews.findIndex((preview) => preview.id === record.id);
      if (index >= 0) previews[index] = record; else previews.push(record);
      return record;
    },
    createQueryBuilder: () => {
      const chain: any = { update: () => chain, set: () => chain, where: () => chain, andWhere: () => chain, execute: async () => ({ affected: 0 }) };
      return chain;
    },
  };
  const manager = {
    previews,
    audits,
    query: async (sql: string) => {
      if (/app\.da_mode|data_access_mode/.test(sql)) return [{ limited: options.limited === true }];
      if (/SELECT locale FROM users/.test(sql)) return [{ locale: options.locale ?? 'en' }];
      return [];
    },
    getRepository(entity: unknown) {
      if (entity === AiMutationPreview) return previewRepo;
      if (entity === AiMutationPlan || entity === AiMutationPlanStep) return { find: async () => [], findOne: async () => null };
      if (entity === UserRole) return { find: async () => [] };
      if (entity === Tenant) return { findOne: async () => ({ id: TENANT, status: TenantStatus.ACTIVE }) };
      if (entity === Subscription) return { findOne: async () => null };
      if (entity === AuditLog) return { insert: async (row: any) => { audits.push(row); return { identifiers: [{ id: `audit-${audits.length}` }] }; } };
      throw new Error(`Unexpected repository request: ${String(entity)}`);
    },
  };
  return manager;
}

function createPolicy(permissions: Record<string, string>) {
  const settings = { tenant_id: TENANT, chat_enabled: true, mcp_enabled: true, provider_source: 'custom' };
  return new AiPolicyService(
    { findById: async () => ({ id: USER, status: 'enabled', role_id: 'role-1', role: { role_name: 'Member', is_system: false } }) } as any,
    { listForRoles: async () => new Map(Object.entries({ ai_chat: 'member', ...permissions })) } as any,
    {
      get: async () => settings,
      getProviderValidationErrors: async () => [],
      getProviderErrorsWithoutConfirmation: async () => [],
    } as any,
    { validate: () => [] } as any,
    { isConfigured: async () => true } as any,
    { isConfigured: () => false } as any,
  );
}

type ImportRun = { key: string; dryRun: boolean; lines: number[]; language: string; file: Buffer };

/** What a stubbed import answers: every row created, or the answer the test gives. */
function importAnswer(run: ImportRun, rows: number, answer?: (run: ImportRun) => Partial<AiImportRunDto>): AiImportRunDto {
  return {
    ok: true, dry_run: run.dryRun, total: rows, inserted: rows, updated: 0, unchanged: 0, skipped: 0,
    error_count: 0, warning_count: 0, issues: [], report: { kind: 'rows', errors: [], warnings: [] },
    ...(answer ? answer(run) : {}),
  };
}

function createImport(
  files: Record<string, StubFile>,
  permissions: Record<string, string> = { applications: 'admin' },
  options: { limited?: boolean; locale?: string; answer?: (run: ImportRun) => Partial<AiImportRunDto> } = {},
) {
  const attachments = {
    assertAndLoadAttachments: async (ids: string[], ctx: { conversationId: string }) => ids.map((id) => {
      const file = files[id];
      if (!file || (file.conversationId ?? 'conv-1') !== ctx.conversationId) {
        throw new Error('One or more attachments are invalid for this conversation');
      }
      return { id, kind: file.kind ?? 'table', original_filename: file.filename };
    }),
    loadAttachmentBuffer: async (id: string) => ({ attachment: { id }, buffer: Buffer.from(files[id].csv, 'utf8') }),
  };
  const policy = createPolicy(permissions);
  const runs: ImportRun[] = [];
  const runner = {
    run: async (key: string, file: Buffer, call: { dryRun: boolean; language: string; lines: number[] }) => {
      const run = { key, file, ...call };
      runs.push(run);
      return importAnswer(run, call.lines.length, options.answer);
    },
  } as unknown as AiImportRunnerService;
  const mapping = new AiImportMappingService(attachments as any, { getSettings: async () => SETTINGS } as any, policy, runner);
  const operation = new PrepareImportMappingAiMutationOperation(mapping);
  const registry = {
    getOperation: (name: string) => {
      if (name !== operation.toolName) throw new Error(`Unsupported preview type ${name}`);
      return operation;
    },
    getOperationOrNull: (name: string) => (name === operation.toolName ? operation : null),
    isSupportedToolName: (name: string) => name === operation.toolName,
    listOperations: () => [operation],
  };
  const manager = createManager(options);
  const previews = new AiMutationPreviewService({ manager } as any, { manager } as any, { manager } as any, policy, registry as any);
  const context = {
    tenantId: TENANT, userId: USER, isPlatformHost: false, surface: 'chat' as const, authMethod: 'jwt' as const,
    conversationId: 'conv-1', manager: manager as any,
  };
  return { mapping, operation, previews, context, manager, runs };
}

const CLEAN_CSV = [
  'name,description,lifecycle,go_live_date,criticality,external_facing',
  'CheeseTrack,Tracks the cheese,Active,2024-03-01,Critical,yes',
  'CaveGuard,Cellar sensors,Proposed,2025-11-15,Low,no',
  'Affineur,Ripening planner,Retired,2019-06-30,Low,no',
].join('\n');

async function testCleanFile() {
  const { previews, context, runs } = createImport({ [FILE]: { csv: CLEAN_CSV, filename: 'apps.csv' } });
  const dto = await previews.createPreview(context, 'prepare_import_mapping', {
    attachment_id: FILE,
    entity_type: 'applications',
    columns: [
      { column: 'name', source: 1, confidence: 'high' },
      { column: 'description', source: 2, confidence: 'high' },
      { column: 'lifecycle', source: 3, confidence: 'high' },
      { column: 'go_live_date', source: 4, confidence: 'high' },
      { column: 'criticality', source: 5, confidence: 'high' },
      { column: 'external_facing', source: 6, confidence: 'high' },
    ],
  });
  const mapping = dto.import_mapping!;
  assert.equal(dto.status, 'pending');
  assert.equal(dto.target.title, 'Applications · apps.csv');
  assert.deepEqual(dto.changes, {});
  assert.equal(mapping.row_count, 3);
  assert.ok(mapping.columns.every((column) => column.filled === 3 && column.unread === 0), 'every value read');
  assert.deepEqual(mapping.unplaced, []);
  assert.deepEqual(mapping.missing_required, []);
  assert.equal(mapping.rows_missing_required, 0);
  // The first rows as the template holds them, catalog values by their name.
  const index = (column: string) => mapping.sample.columns.indexOf(column);
  assert.equal(mapping.sample.rows[0][index('lifecycle')], 'Active');
  assert.equal(mapping.sample.rows[0][index('go_live_date')], '2024-03-01');
  assert.equal(mapping.sample.rows[1][index('external_facing')], 'false');
  assert.equal(dto.summary, 'Import "apps.csv" into the Applications list.');
  // The import checked the file built in its template's format: technical headers, one row per row
  // of the person's file, a date as a date, a catalog value by its code.
  assert.equal(runs.length, 1);
  assert.deepEqual({ key: runs[0].key, dryRun: runs[0].dryRun, lines: runs[0].lines }, { key: 'applications', dryRun: true, lines: [2, 3, 4] });
  const built = await readTableAttachment(runs[0].file);
  assert.equal(built.format, 'xlsx');
  const firstRow = Object.fromEntries(built.header.map((cell, at) => [(cell as { value: string }).value, built.rows[0][at]]));
  assert.deepEqual(firstRow, {
    name: text('CheeseTrack'), description: text('Tracks the cheese'), lifecycle: text('active'),
    go_live_date: { kind: 'date', iso: '2024-03-01' }, criticality: text('business_critical'), external_facing: text('true'),
  });
  assert.equal(mapping.validation?.ok, true);
  assert.equal(mapping.validation?.dry_run, true);
  console.log('  clean file: OK');
}

const MESSY_CSV = [
  'Appli;Etat;Mise en service;Commentaire interne;',
  'CheeseTrack;Actif;03/04/2024;à revoir;',
  ';;;;',
  'CaveGuard;En prod;25/11/2025;;',
  ';Retiré;30/06/2019;sans nom;',
].join('\n');

const LONG_NOTE = 'Etat lu comme cycle de vie : En prod et Actif valent Actif, Retiré vaut Retiré, le reste reste à confirmer.';
const LONG_ASSUMPTION = "Une ligne par application, rapprochée par son nom : une application du même nom est mise à jour au lieu d'être créée.";

const OTHER_FILE = '22222222-2222-4222-8222-222222222222';

async function testMessyFile() {
  const { previews, context, manager } = createImport({
    [FILE]: { csv: MESSY_CSV, filename: 'export appli.csv' },
    [OTHER_FILE]: { csv: CLEAN_CSV, filename: 'apps.csv' },
  }, { applications: 'admin' }, { locale: 'fr' });
  const columns = [
    { column: 'name', source: 1, confidence: 'high' as const },
    { column: 'lifecycle', source: 2, confidence: 'medium' as const, note: LONG_NOTE },
    { column: 'go_live_date', source: 3, confidence: 'medium' as const },
    { column: 'category', value: 'Line of business', confidence: 'low' as const },
  ];
  let dto = await previews.createPreview(context, 'prepare_import_mapping', {
    attachment_id: FILE, entity_type: 'applications', columns, assumptions: [LONG_ASSUMPTION],
  });
  let mapping = dto.import_mapping!;
  const lifecycle = mapping.columns.find((column) => column.column === 'lifecycle')!;
  // The blank row is no row; "En prod" names no lifecycle: shown on the card, not read.
  assert.equal(mapping.row_count, 3);
  assert.equal(lifecycle.filled, 3);
  assert.equal(lifecycle.unread, 1);
  assert.deepEqual(mapping.unread_values.lifecycle, ['En prod']);
  // The model's own words reach the card whole (the input schema bounds them), unlike file cells.
  assert.equal(lifecycle.note, LONG_NOTE);
  const goLive = mapping.columns.find((column) => column.column === 'go_live_date')!;
  assert.equal(goLive.read_as, 'day-first');
  assert.equal(goLive.unread, 0);
  // A value for every row, converted to its code and shown by its name.
  const category = mapping.columns.find((column) => column.column === 'category')!;
  assert.equal(category.source, null);
  assert.equal(category.value, 'Line of business');
  assert.equal(category.filled, 3);
  // The file's unused column, and the row without a name.
  assert.deepEqual(mapping.unplaced, [{ position: 4, header: 'Commentaire interne' }]);
  assert.equal(mapping.rows_missing_required, 1);
  assert.deepEqual(mapping.assumptions, [LONG_ASSUMPTION]);
  assert.equal(dto.summary, 'Import de « export appli.csv » dans la liste Applications.');
  // The person says what "En prod" stands for: the corrected mapping reads every value.
  dto = await previews.createPreview(context, 'prepare_import_mapping', {
    attachment_id: FILE,
    entity_type: 'applications',
    columns: columns.map((column) => (column.column === 'lifecycle' ? { ...column, values: { 'En prod': 'Active' } } : column)),
  });
  mapping = dto.import_mapping!;
  assert.equal(mapping.columns.find((column) => column.column === 'lifecycle')!.unread, 0);
  assert.equal(mapping.unread_values.lifecycle, undefined);
  assert.equal(manager.previews.length, 2, 'the correction is a new card');
  // It replaces the pending card of the same file: the person has one card to approve.
  assert.deepEqual(manager.previews.map((preview) => preview.status), ['expired', 'pending']);
  // The mapping of another file leaves it pending.
  await previews.createPreview(context, 'prepare_import_mapping', {
    attachment_id: OTHER_FILE, entity_type: 'applications', columns: [{ column: 'name', source: 1, confidence: 'high' }],
  });
  assert.deepEqual(manager.previews.map((preview) => preview.status), ['expired', 'pending', 'pending']);
  console.log('  messy file: OK');
}

async function rejects(promise: Promise<unknown>, pattern: RegExp, what: string) {
  await assert.rejects(promise, (error: any) => {
    const message = String(error?.response?.message ?? error?.message ?? error);
    assert.match(message, pattern, what);
    return true;
  });
}

async function testUnknownColumns() {
  const { previews, context } = createImport({
    [FILE]: { csv: CLEAN_CSV, filename: 'apps.csv' },
    '22222222-2222-4222-8222-222222222222': { csv: 'a,b\n1,2', filename: 'photo.png', kind: 'image' },
    '33333333-3333-4333-8333-333333333333': { csv: CLEAN_CSV, filename: 'other.csv', conversationId: 'conv-2' },
  });
  const base = { attachment_id: FILE, entity_type: 'applications' };
  await rejects(previews.createPreview(context, 'prepare_import_mapping', {
    ...base, columns: [{ column: 'nom_appli', source: 1, confidence: 'high' }],
  }), /Unknown column for this import: nom_appli\. The template's columns are: .*\bname\b/, 'an unknown template column');
  await rejects(previews.createPreview(context, 'prepare_import_mapping', {
    ...base, columns: [{ column: 'name', source: 9, confidence: 'high' }],
  }), /column 9; the summary describes columns 1 to 6/, 'a source outside the file');
  await rejects(previews.createPreview(context, 'prepare_import_mapping', {
    ...base, columns: [{ column: 'name', source: 1, confidence: 'high' }, { column: 'name', source: 2, confidence: 'high' }],
  }), /mapped twice/, 'a column mapped twice');
  await rejects(previews.createPreview(context, 'prepare_import_mapping', {
    ...base, columns: [{ column: 'lifecycle', value: 'Bientôt', confidence: 'low' }],
  }), /not one this column takes \(one of Proposed, Active, Deprecated, Retired\)/, 'a value the catalog does not hold');
  await rejects(previews.createPreview(context, 'prepare_import_mapping', {
    ...base, entity_type: 'users', columns: [{ column: 'name', source: 1, confidence: 'high' }],
  }), /Unknown import "users"/, 'an import Plaid does not map');
  await rejects(previews.createPreview(context, 'prepare_import_mapping', {
    ...base, attachment_id: '22222222-2222-4222-8222-222222222222', columns: [{ column: 'name', source: 1, confidence: 'high' }],
  }), /not a spreadsheet/, 'an image');
  await rejects(previews.createPreview(context, 'prepare_import_mapping', {
    ...base, attachment_id: '33333333-3333-4333-8333-333333333333', columns: [{ column: 'name', source: 1, confidence: 'high' }],
  }), /invalid for this conversation/, 'a file of another conversation');
  console.log('  unknown columns and wrong files: refused: OK');
}

// --- Rights on the preview path --------------------------------------------------------------

const INCIDENTS_CSV = 'title,severity\nCellar door open,high\n';

async function testRights() {
  const files = { [FILE]: { csv: INCIDENTS_CSV, filename: 'incidents.csv' } };
  const incidentInput = { attachment_id: FILE, entity_type: 'incidents', columns: [{ column: 'title', source: 1, confidence: 'high' }] };
  // A contributor imports incidents, as the incident import route allows.
  const contributor = createImport(files, { incidents: 'contributor' });
  assert.equal((await contributor.previews.createPreview(contributor.context, 'prepare_import_mapping', incidentInput)).status, 'pending');
  const template = await contributor.mapping.describeTemplate(contributor.context, 'incidents', 'en');
  assert.ok(template.columns.some((column) => column.column === 'title' && column.required));
  // A reader is refused, on the template and on the mapping.
  const reader = createImport(files, { incidents: 'reader', applications: 'reader' });
  await rejects(reader.previews.createPreview(reader.context, 'prepare_import_mapping', incidentInput), /right to contribute to incidents/, 'a reader maps nothing');
  await rejects(reader.mapping.describeTemplate(reader.context, 'incidents', 'en'), /right to contribute to incidents/, 'nor reads the template');
  // The applications import needs the administrator level of its route.
  const member = createImport({ [FILE]: { csv: CLEAN_CSV, filename: 'apps.csv' } }, { applications: 'member' });
  await rejects(member.previews.createPreview(member.context, 'prepare_import_mapping', {
    attachment_id: FILE, entity_type: 'applications', columns: [{ column: 'name', source: 1, confidence: 'high' }],
  }), /right to administer applications/, 'a member maps no application file');
  // A reserved import is refused to a person whose access is limited; the others follow their rights.
  const supplierInput = { attachment_id: FILE, entity_type: 'suppliers', columns: [{ column: 'name', source: 1, confidence: 'high' }] };
  const limited = createImport({ [FILE]: { csv: 'name\nAcme\n', filename: 's.csv' } }, { suppliers: 'admin', applications: 'admin' }, { limited: true });
  await rejects(limited.previews.createPreview(limited.context, 'prepare_import_mapping', supplierInput), /reserved to people with access to all data/, 'reserved to unscoped persons');
  assert.equal((await limited.previews.createPreview(limited.context, 'prepare_import_mapping', {
    ...supplierInput, entity_type: 'applications',
  })).status, 'pending');
  // The application links read the applications they name.
  const linksInput = { attachment_id: FILE, entity_type: 'technology_application_links', columns: [{ column: 'application_name', source: 1, confidence: 'high' }] };
  const noApplications = createImport({ [FILE]: { csv: 'app\nCheeseTrack\n', filename: 'l.csv' } }, { infrastructure: 'member' });
  await rejects(noApplications.previews.createPreview(noApplications.context, 'prepare_import_mapping', linksInput), /right to read applications/, 'links need the applications read');
  const withApplications = createImport({ [FILE]: { csv: 'app\nCheeseTrack\n', filename: 'l.csv' } }, { infrastructure: 'member', applications: 'reader' });
  assert.equal((await withApplications.previews.createPreview(withApplications.context, 'prepare_import_mapping', linksInput)).status, 'pending');
  console.log('  rights: contributor, reader refused, limited person: OK');
}

// --- Approval and what the model receives ----------------------------------------------------

async function testApprovalRunsTheImportAndTheModelSeesNoCell() {
  const { previews, context, manager, runs } = createImport({ [FILE]: { csv: MESSY_CSV, filename: 'export appli.csv' } }, { applications: 'admin' }, {
    locale: 'fr',
    // The check finds one unread lifecycle; the import itself creates two applications and updates one.
    answer: (run) => (run.dryRun
      ? { warning_count: 1, issues: [{ level: 'warning', code: 'unknown_value', column: 'lifecycle', count: 1 }], report: {
        kind: 'rows', errors: [], warnings: [{ row: 4, column: 'lifecycle', message: 'Unknown lifecycle "En prod"', code: 'unknown_value' }],
      } }
      : { inserted: 2, updated: 1 }),
  });
  const dto = await previews.createPreview(context, 'prepare_import_mapping', {
    attachment_id: FILE,
    entity_type: 'applications',
    columns: [{ column: 'name', source: 1, confidence: 'high' }, { column: 'lifecycle', source: 2, confidence: 'high' }],
  });
  // The rows of the person's file: the blank line 3 is no row.
  assert.deepEqual(runs[0].lines, [2, 4, 5]);
  // The unread "En prod" goes to the import as the person wrote it: the import refuses it with its own message.
  const built = await readTableAttachment(runs[0].file);
  assert.deepEqual(built.rows.map((row) => row[1]), [text('active'), text('En prod'), text('retired')]);
  assert.equal(manager.audits.length, 0, 'the check writes nothing');

  const approved = await previews.executePreview(context, dto.preview_id);
  assert.equal(approved.status, 'executed');
  assert.equal(approved.summary, 'Appliqué : import de « export appli.csv » dans la liste Applications. Créées : 2, mises à jour : 1.');
  assert.deepEqual(runs.map((run) => run.dryRun), [true, false], 'the approval loads the same file');
  assert.equal(runs[1].language, 'fr');
  assert.equal(approved.import_mapping!.result!.inserted, 2);
  assert.equal(approved.import_mapping!.validation!.warning_count, 1, 'the card keeps the check');
  // The audit log records the import as made through Plaid, with the card as its reference.
  assert.equal(manager.audits.length, 1);
  assert.deepEqual(
    (({ table_name, action, source, source_ref, user_id, after_json }) => ({ table_name, action, source, source_ref, user_id, after_json }))(manager.audits[0]),
    {
      table_name: 'import', action: 'import', source: 'ai_chat', source_ref: dto.preview_id, user_id: USER,
      after_json: { list: 'applications', filename: 'export appli.csv', rows: 3, inserted: 2, updated: 1, unchanged: 0 },
    },
  );

  // The model receives the counts, never the cells beyond the summary, the card's first rows nor the import's messages.
  const hidden = MODEL_HIDDEN_OUTPUT_FIELDS.prepare_import_mapping;
  for (const shown of [dto, approved]) {
    const forModel = new AiEvidenceService({} as any).redact(shown, [...hidden]) as any;
    assert.equal(forModel.import_mapping.unread_values, '[REDACTED]');
    assert.equal(forModel.import_mapping.sample, '[REDACTED]');
    assert.equal(forModel.import_mapping.validation.report, '[REDACTED]');
    assert.equal(forModel.import_mapping.columns.length, dto.import_mapping!.columns.length);
    assert.equal(forModel.import_mapping.columns[1].unread, 1);
    assert.deepEqual(forModel.import_mapping.validation.issues, [{ level: 'warning', code: 'unknown_value', column: 'lifecycle', count: 1 }]);
    assert.ok(!JSON.stringify(forModel).includes('En prod'), 'no cell of the file');
  }
  const forModel = new AiEvidenceService({} as any).redact(approved, [...hidden]) as any;
  assert.equal(forModel.import_mapping.result.report, '[REDACTED]');
  assert.equal(forModel.import_mapping.result.inserted, 2);
  assert.deepEqual(dto.import_mapping!.unread_values.lifecycle, ['En prod'], 'the card keeps them');
  console.log('  approval runs the import, the model sees no cell: OK');
}

async function testARefusedFileIsNotImported() {
  const refusal: Partial<AiImportRunDto> = {
    ok: false, inserted: 0, error_count: 1, issues: [{ level: 'error', code: 'required', column: 'name', count: 1 }],
    report: { kind: 'rows', errors: [{ row: 3, column: 'name', message: 'Name is required', code: 'required' }], warnings: [] },
  };
  // The check refuses the file: the card cannot be approved, and the server refuses it too.
  const refused = createImport({ [FILE]: { csv: CLEAN_CSV, filename: 'apps.csv' } }, { applications: 'admin' }, { answer: () => refusal });
  const dto = await refused.previews.createPreview(refused.context, 'prepare_import_mapping', {
    attachment_id: FILE, entity_type: 'applications', columns: [{ column: 'name', source: 1, confidence: 'high' }],
  });
  assert.equal(dto.status, 'pending');
  assert.equal(dto.import_mapping!.validation!.ok, false);
  const failed = await refused.previews.executePreview(refused.context, dto.preview_id);
  assert.equal(failed.status, 'failed');
  assert.match(failed.error_message ?? '', /The import refused this file, so nothing was imported/);
  assert.deepEqual(refused.runs.map((run) => run.dryRun), [true], 'no load is tried');
  assert.equal(refused.manager.audits.length, 0);

  // The check passed, but the import refuses the file at approval (the data changed meanwhile).
  const changed = createImport({ [FILE]: { csv: CLEAN_CSV, filename: 'apps.csv' } }, { applications: 'admin' }, {
    locale: 'de', answer: (run) => (run.dryRun ? {} : refusal),
  });
  const card = await changed.previews.createPreview(changed.context, 'prepare_import_mapping', {
    attachment_id: FILE, entity_type: 'applications', columns: [{ column: 'name', source: 1, confidence: 'high' }],
  });
  const late = await changed.previews.executePreview(changed.context, card.preview_id);
  assert.equal(late.status, 'failed');
  assert.equal(late.error_message, 'Der Import hat diese Datei abgelehnt, daher wurde nichts importiert. Korrigieren Sie die Zuordnung oder die Datei und bereiten Sie den Import erneut vor.');
  assert.equal(late.import_mapping!.result ?? null, null, 'no result on a refused import');
  assert.equal(changed.manager.audits.length, 0);
  console.log('  a refused file is not imported: OK');
}

function testBilanOnThePersonsLines() {
  // The built file: header on line 1, then the person's rows, which sat on lines 3, 5 and 9.
  const lines = [3, 5, 9];
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((row) => personLine(row, lines)), [0, 0, 3, 5, 9, 5]);
  const rows = rowsBilan({
    ok: false, total: 3, inserted: 2,
    errors: [
      { row: 3, column: 'lifecycle', message: 'Unknown lifecycle "En prod"', code: 'lifecycle_invalid' },
      { row: 4, column: 'lifecycle', message: 'Unknown lifecycle "Prod"', code: 'lifecycle_invalid' },
      { row: 0, message: 'Only the first sheet was read.', code: 'XLSX_FIRST_SHEET_ONLY' },
    ],
  }, true, lines);
  assert.equal(rows.ok, false);
  assert.deepEqual(rows.report.kind === 'rows' && rows.report.errors.map((error) => error.row), [5, 9, 0]);
  assert.deepEqual(rows.issues, [
    { level: 'error', code: 'lifecycle_invalid', column: 'lifecycle', count: 2 },
    { level: 'error', code: 'XLSX_FIRST_SHEET_ONLY', column: null, count: 1 },
  ]);
  // The budget file: its check as its dialog shows it, on the person's lines, without the snapshot.
  const budget = budgetBilan({
    ok: false,
    snapshot: { secret: true },
    errors: [{ line: 2, column: 'account_number', message: 'Unknown account 7000' }],
    errorCount: 1,
    missing: [{ type: 'supplier', count: 2 }],
    changes: { created: 3, updated: 0, unchanged: 0 },
    warnings: { duplicates: [{ line: 4 }] },
  }, true, lines);
  assert.equal(budget.ok, false);
  assert.equal(budget.inserted, 3);
  assert.equal(budget.error_count, 3);
  assert.equal(budget.warning_count, 1);
  assert.deepEqual(budget.issues, [
    { level: 'error', code: null, column: 'account_number', count: 1 },
    { level: 'error', code: 'missing_supplier', column: null, count: 2 },
  ]);
  const file = budget.report.kind === 'budget_file' ? budget.report.file as any : null;
  assert.equal(file.snapshot, undefined);
  assert.equal(file.errors[0].line, 3);
  assert.equal(file.warnings.duplicates[0].line, 9);
  console.log('  bilan on the person\'s lines, tallied for the model: OK');
}

function testAFileImportIsAWrite() {
  for (const message of ['Importe ce fichier dans les applications', 'Import these servers', 'Importiere die Datei', 'Importa este archivo']) {
    const profile = selectAiContextProfile(message);
    assert.equal(profile.promptMode, 'write', message);
    assert.ok(profile.toolNames.includes('prepare_import_mapping'), message);
  }
  // A ticket import keeps its own route; a question on how to import stays a question.
  assert.notEqual(selectAiContextProfile('Importe le ticket GLPI 4512').name, 'write_general');
  assert.equal(selectAiContextProfile('Import ticket 4512 from GLPI').name, 'write_task');
  assert.notEqual(selectAiContextProfile('Comment importer des applications ?').name, 'write_general');
  console.log('  a file import is a write: OK');
}

function testApprovalEndsTheTurn() {
  // An approved import leaves Plaid nothing to prepare: it does not answer again after the approval.
  const orchestrator = Object.create(AiChatOrchestratorService.prototype) as any;
  const continuesAfter = (toolName: string) => orchestrator.shouldContinueAfterPreviewAction({
    action: 'approve',
    history: [{ role: 'user', content: 'Importe ces sociétés puis crée leurs départements' }],
    existingPreviews: [],
    previewResults: [{ tool_name: toolName, status: 'executed' }],
    followUpPreviews: [],
  });
  assert.equal(continuesAfter('prepare_import_mapping'), false);
  // Another approved change of the same request goes on to the next step.
  assert.equal(continuesAfter('create_company'), true);
  console.log('  an approved import ends the turn: OK');
}

async function run() {
  const originalFeature = Features.AI_CHAT_ENABLED;
  Features.AI_CHAT_ENABLED = true;
  try {
    testAccessMatchesTheImportRoutes();
    await testTemplatesAreTheColumnsTheImportsRead();
    testConversions();
    testConversionsOfRealExports();
    await testCleanFile();
    await testMessyFile();
    await testUnknownColumns();
    await testRights();
    await testApprovalRunsTheImportAndTheModelSeesNoCell();
    await testARefusedFileIsNotImported();
    testBilanOnThePersonsLines();
    testAFileImportIsAWrite();
    testApprovalEndsTheTurn();
  } finally {
    Features.AI_CHAT_ENABLED = originalFeature;
  }
  console.log('ai-import-mapping.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
