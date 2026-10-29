import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { REQUIRE_LEVEL_KEY, RequireLevelMeta } from '../../auth/require-level.decorator';
import { PermissionLevel } from '../../permissions/permissions.service';
import { AiMutationWriteToolName } from '../ai.types';
import { aiRelationTargetRequirement, aiWriteLevel, aiWriteRequirements, CONTRIBUTOR_WRITABLE_FIELDS } from '../mutation/ai-write-levels';
import { PROJECT_RELATION_READS, REQUEST_RELATION_READS } from '../../portfolio/portfolio-relations.service';
import {
  AI_BUSINESS_RECORD_ENTITY_TYPES,
  AI_INCIDENT_WRITABLE_FIELDS,
  getAiBusinessRecordBusinessResource,
} from '../mutation/ai-business-record-mutation-support.service';
import {
  AI_MASTER_DATA_ENTITY_TYPES,
  getAiMasterDataBusinessResource,
} from '../mutation/ai-master-data-mutation-support.service';
import { AI_RELATION_ENTITY_TYPES, getAiRelationBusinessResource } from '../mutation/ai-relation-mutation-support.service';
import { AccountsController } from '../../accounts/accounts.controller';
import { ChartOfAccountsController } from '../../accounts/chart-of-accounts.controller';
import { AnalyticsCategoriesController } from '../../analytics/analytics-categories.controller';
import { ApplicationsController } from '../../applications/applications.controller';
import { AssetsController } from '../../assets/assets.controller';
import { BusinessProcessesController } from '../../business-processes/business-processes.controller';
import { CompaniesController } from '../../companies/companies.controller';
import { ConnectionsController } from '../../connections/connections.controller';
import { ContactsController } from '../../contacts/contacts.controller';
import { ContractsController } from '../../contracts/contracts.controller';
import { DepartmentsController } from '../../departments/departments.controller';
import { InterfacesController } from '../../interfaces/interfaces.controller';
import { IncidentsController } from '../../incidents/incidents.controller';
import { IncidentsTasksController } from '../../incidents/incidents-tasks.controller';
import { KnowledgeController } from '../../knowledge/knowledge.controller';
import { LocationsController } from '../../locations/locations.controller';
import { PortfolioProjectsController } from '../../portfolio/portfolio-projects.controller';
import { PortfolioRequestsController } from '../../portfolio/portfolio-requests.controller';
import { BudgetLinesController } from '../../spend/budget-lines.controller';
import { CapexVersionsController } from '../../spend/capex-versions.controller';
import { SpendVersionsController } from '../../spend/spend-versions.controller';
import { TasksController } from '../../spend/tasks.controller';
import { SuppliersController } from '../../suppliers/suppliers.controller';
import { TechnologiesController } from '../../technologies/technologies.controller';
import { VulnerabilitiesController } from '../../vulnerabilities/vulnerabilities.controller';

/**
 * Lot D11: each Plaid write needs the level of the screen route that makes the same change.
 * The table below is the reference, operation x family -> module and level, with that route.
 * The spec breaks when a route changes level (its `@RequireLevel` guard is read), when Plaid's
 * level drifts from the table, or when a family or a write tool is added without a row.
 *
 * Choices kept stricter than a route (the brief: the strictest level in doubt):
 * - a contributor writes only the purpose of a project (`CONTRIBUTOR_WRITABLE_FIELDS`), as the
 *   project page; `PATCH /portfolio/projects/:id` accepts every field at contributor level;
 * - a task needs `tasks` at member level, as the task page, also on a project, where
 *   `/portfolio/projects/:id/tasks` asks only `portfolio_projects` at contributor level (Plaid
 *   asks both, the task family being read through `tasks`).
 */

type Controller = { prototype: object; name: string };
type Row = { resource: string; level: PermissionLevel; route: [Controller, string] };

const BUSINESS_RECORD_ROUTES: Record<string, Controller> = {
  applications: ApplicationsController,
  assets: AssetsController,
  contracts: ContractsController,
  projects: PortfolioProjectsController,
  requests: PortfolioRequestsController,
  interfaces: InterfacesController,
  connections: ConnectionsController,
  budget_lines: BudgetLinesController,
  incidents: IncidentsController,
  technologies: TechnologiesController,
};

const MASTER_DATA_ROUTES: Record<string, Controller> = {
  companies: CompaniesController,
  departments: DepartmentsController,
  suppliers: SuppliersController,
  contacts: ContactsController,
  accounts: AccountsController,
  chart_of_accounts: ChartOfAccountsController,
  analytics_categories: AnalyticsCategoriesController,
  business_processes: BusinessProcessesController,
  locations: LocationsController,
};

/** The route of the Relations tab (or of the links of the record) for each source family, and one relation of it. */
const RELATION_ROUTES: Record<string, { route: [Controller, string]; relation: string }> = {
  applications: { route: [ApplicationsController, 'linkRelation'], relation: 'projects' },
  assets: { route: [AssetsController, 'linkRelation'], relation: 'projects' },
  suppliers: { route: [SuppliersController, 'attachContact'], relation: 'contacts' },
  contracts: { route: [ContractsController, 'linkRelation'], relation: 'budget_lines' },
  budget_lines: { route: [BudgetLinesController, 'linkRelation'], relation: 'projects' },
  projects: { route: [PortfolioProjectsController, 'linkRelation'], relation: 'applications' },
  requests: { route: [PortfolioRequestsController, 'linkRelation'], relation: 'applications' },
  locations: { route: [LocationsController, 'addInternalContact'], relation: 'internal_contacts' },
};

function recordRows(action: 'create' | 'update'): Record<string, Row> {
  return Object.fromEntries(AI_BUSINESS_RECORD_ENTITY_TYPES.map((family) => [family, {
    resource: getAiBusinessRecordBusinessResource(family),
    level: family === 'incidents' || (action === 'update' && family === 'projects') ? 'contributor' : 'member',
    route: [BUSINESS_RECORD_ROUTES[family], action],
  } satisfies Row]));
}

function masterDataRows(action: 'create' | 'update'): Record<string, Row> {
  return Object.fromEntries(AI_MASTER_DATA_ENTITY_TYPES.map((family) => [family, {
    resource: getAiMasterDataBusinessResource(family),
    level: 'member',
    route: [MASTER_DATA_ROUTES[family], action],
  } satisfies Row]));
}

const one = (resource: string, route: [Controller, string]): Record<string, Row> => ({ '': { resource, level: 'member', route } });

/** Operation x family -> module and level, with the screen route that makes the same change. */
const TABLE: Record<AiMutationWriteToolName, Record<string, Row>> = {
  create_business_record: recordRows('create'),
  update_business_record: recordRows('update'),
  add_incident_note: {
    incidents: { resource: 'incidents', level: 'contributor', route: [IncidentsController, 'createEntry'] },
  },
  update_incident_links: {
    incidents: { resource: 'incidents', level: 'contributor', route: [IncidentsController, 'linkRelation'] },
  },
  update_technology_links: {
    technologies: { resource: 'infrastructure', level: 'member', route: [TechnologiesController, 'addAsset'] },
  },
  update_technology_versions: {
    technologies: { resource: 'infrastructure', level: 'member', route: [TechnologiesController, 'createVersion'] },
  },
  update_technology_people: {
    technologies: { resource: 'infrastructure', level: 'member', route: [TechnologiesController, 'replaceOwners'] },
  },
  update_technology_web_links: {
    technologies: { resource: 'infrastructure', level: 'member', route: [TechnologiesController, 'createLink'] },
  },
  set_technology_vulnerability_alerts: {
    technologies: { resource: 'infrastructure', level: 'member', route: [TechnologiesController, 'setVulnerabilityAlerts'] },
  },
  change_vulnerability_state: {
    vulnerabilities: { resource: 'infrastructure', level: 'member', route: [VulnerabilitiesController, 'bulkState'] },
  },
  change_incident_state: {
    incidents: { resource: 'incidents', level: 'admin', route: [IncidentsController, 'reopen'] },
  },
  set_incident_confidentiality: {
    incidents: { resource: 'incidents', level: 'admin', route: [IncidentsController, 'setConfidentiality'] },
  },
  create_master_data_record: masterDataRows('create'),
  update_master_data_record: masterDataRows('update'),
  update_entity_relations: Object.fromEntries(AI_RELATION_ENTITY_TYPES.map((family) => [family, {
    resource: getAiRelationBusinessResource(family, RELATION_ROUTES[family].relation),
    level: family === 'projects' || family === 'requests' ? 'contributor' : 'member',
    route: RELATION_ROUTES[family].route,
  } satisfies Row])),
  write_financial_plan: {
    budget_lines: { resource: 'budget', level: 'member', route: [SpendVersionsController, 'upsertAmounts'] },
  },
  create_document: one('knowledge', [KnowledgeController, 'create']),
  update_document_content: one('knowledge', [KnowledgeController, 'update']),
  update_document_metadata: one('knowledge', [KnowledgeController, 'update']),
  update_document_relations: one('knowledge', [KnowledgeController, 'bulkReplaceRelationSets']),
  create_task: {
    ...one('tasks', [TasksController, 'createStandalone']),
    // The screen's follow-up task on an incident (`POST /incidents/:id/tasks`, tasks:member).
    incident: { resource: 'tasks', level: 'member', route: [IncidentsTasksController, 'create'] },
  },
  import_ticket: one('tasks', [TasksController, 'createStandalone']),
  import_glpi_ticket: one('tasks', [TasksController, 'createStandalone']),
  update_task_fields: one('tasks', [TasksController, 'updateTask']),
  update_task_status: one('tasks', [TasksController, 'updateTask']),
  update_task_assignee: one('tasks', [TasksController, 'updateTask']),
  add_task_comment: one('tasks', [TasksController, 'createActivity']),
  delete_record: {
    tasks: { resource: 'tasks', level: 'admin', route: [TasksController, 'bulkDelete'] },
    contacts: { resource: 'contacts', level: 'admin', route: [ContactsController, 'remove'] },
    locations: { resource: 'locations', level: 'member', route: [LocationsController, 'remove'] },
    budget_lines: { resource: 'budget', level: 'admin', route: [BudgetLinesController, 'bulkDelete'] },
    connections: { resource: 'infrastructure', level: 'member', route: [ConnectionsController, 'delete'] },
    interfaces: { resource: 'applications', level: 'admin', route: [InterfacesController, 'bulkDelete'] },
    documents: { resource: 'knowledge', level: 'admin', route: [KnowledgeController, 'remove'] },
  },
};

function routeGuard([controller, method]: [Controller, string]): RequireLevelMeta {
  const handler = (controller.prototype as Record<string, unknown>)[method];
  assert.equal(typeof handler, 'function', `${controller.name}.${method} exists`);
  const meta = Reflect.getMetadata(REQUIRE_LEVEL_KEY, handler as object) as RequireLevelMeta | undefined;
  assert.ok(meta, `${controller.name}.${method} has a @RequireLevel guard`);
  return meta;
}


/**
 * The technology routes the assistant writes through, at the screen's level: the fiche's creation
 * and modification, the catalog adoption (`create_business_record` when the catalog knows the
 * name), and the versions. Adoption has no tool of its own; it takes the same member level as the
 * creation route.
 */
function testTechnologyWriteRoutes() {
  const expected: Array<[string, string]> = [
    ['create', 'create'],
    ['adopt', 'adopt'],
    ['update', 'update'],
    ['createVersion', 'createVersion'],
    ['updateVersion', 'updateVersion'],
    ['replaceOwners', 'replaceOwners'],
    ['replaceSupportContacts', 'replaceSupportContacts'],
    ['createLink', 'createLink'],
    ['updateLink', 'updateLink'],
    ['deleteLink', 'deleteLink'],
    ['setVulnerabilityAlerts', 'setVulnerabilityAlerts'],
  ];
  for (const [method, label] of expected) {
    assert.deepEqual(routeGuard([TechnologiesController, method]), { resource: 'infrastructure', level: 'member' }, `${label}: the screen route level`);
  }
}

function testTableMatchesRoutesAndPlaid() {
  let rows = 0;
  for (const [toolName, families] of Object.entries(TABLE)) {
    for (const [family, row] of Object.entries(families)) {
      const where = `${toolName} x ${family || '(one family)'}`;
      // The screen route: same module, same level. A route that changes level breaks here.
      assert.deepEqual(routeGuard(row.route), { resource: row.resource, level: row.level }, `${where}: route ${row.route[0].name}.${row.route[1]}`);
      // Plaid: the same level for this operation and family.
      assert.equal(aiWriteLevel(toolName, family), row.level, `${where}: Plaid level`);
      rows += 1;
    }
  }
  // Every family of the multi-family tools has its row (the record builders map every family).
  assert.equal(Object.keys(TABLE.update_entity_relations).length, AI_RELATION_ENTITY_TYPES.length);
  // The state tool makes two changes: cancelling needs the same administrator right as reopening.
  assert.deepEqual(routeGuard([IncidentsController, 'cancel']), { resource: 'incidents', level: 'admin' });
  assert.ok(rows >= 50, `${rows} rows`);
  console.log(`  ${rows} operation x family rows match their screen routes: OK`);
}

function testOnlyTheContributorRowsAreBelowMember() {
  const contributorRows = Object.entries(TABLE).flatMap(([toolName, families]) =>
    Object.entries(families).filter(([, row]) => row.level === 'contributor').map(([family]) => `${toolName}:${family}`));
  assert.deepEqual(contributorRows.sort(), [
    'add_incident_note:incidents',
    'create_business_record:incidents',
    'update_business_record:incidents',
    'update_business_record:projects',
    'update_entity_relations:projects',
    'update_entity_relations:requests',
    'update_incident_links:incidents',
  ]);
  // Never below contributor, and an unknown family stays at member.
  assert.equal(aiWriteLevel('update_business_record', 'applications'), 'member');
  assert.equal(aiWriteLevel('create_business_record', 'projects'), 'member');
  assert.equal(aiWriteLevel('create_business_record', 'incidents'), 'contributor');
  assert.equal(aiWriteLevel('update_business_record', 'incidents'), 'contributor');
  assert.equal(aiWriteLevel('add_incident_note', 'incidents'), 'contributor');
  assert.equal(aiWriteLevel('update_incident_links', 'incidents'), 'contributor');
  assert.equal(aiWriteLevel('update_technology_links', 'technologies'), 'member');
  // The link to an application needs the application read, as the Applications tab of a technology.
  assert.deepEqual(
    aiRelationTargetRequirement('update_technology_links', 'technologies', 'applications'),
    { resource: 'applications', level: 'reader' },
  );
  assert.equal(aiRelationTargetRequirement('update_technology_links', 'technologies', 'servers'), null);
  // Naming a support contact needs the contacts read, as the Operations tab's picker does.
  assert.equal(aiWriteLevel('update_technology_people', 'technologies'), 'member');
  assert.equal(aiWriteLevel('update_technology_web_links', 'technologies'), 'member');
  assert.equal(aiWriteLevel('set_technology_vulnerability_alerts', 'technologies'), 'member');
  assert.deepEqual(
    aiRelationTargetRequirement('update_technology_people', 'technologies', 'support_contacts'),
    { resource: 'contacts', level: 'reader' },
  );
  assert.equal(aiRelationTargetRequirement('update_technology_people', 'technologies', 'owners'), null);
  // The administrator actions know one level per tool, and an unknown family stays at admin.
  assert.equal(aiWriteLevel('change_incident_state', 'incidents'), 'admin');
  assert.equal(aiWriteLevel('set_incident_confidentiality', 'incidents'), 'admin');
  assert.equal(aiWriteLevel('change_incident_state', 'unknown'), 'admin');
  assert.equal(aiWriteLevel('set_incident_confidentiality', 'unknown'), 'admin');
  // A follow-up task on an incident stays at the tasks module's member level.
  assert.equal(aiWriteLevel('create_task', 'incident'), 'member');
  assert.equal(aiWriteLevel('update_business_record', 'unknown'), 'member');
  // A delete family without its row keeps the strictest level.
  assert.equal(aiWriteLevel('delete_record', 'unknown'), 'admin');
  // A contributor writes the purpose of a project, nothing else through its fields.
  assert.deepEqual(CONTRIBUTOR_WRITABLE_FIELDS.update_business_record.projects, ['purpose']);
  // The incident screen accepts every field of the family at contributor level, on create and update.
  assert.deepEqual(CONTRIBUTOR_WRITABLE_FIELDS.create_business_record.incidents, AI_INCIDENT_WRITABLE_FIELDS);
  assert.deepEqual(CONTRIBUTOR_WRITABLE_FIELDS.update_business_record.incidents, AI_INCIDENT_WRITABLE_FIELDS);
  console.log('  contributor rows: OK');
}

function testToolRequirements() {
  const business = aiWriteRequirements('update_business_record', ['applications', 'portfolio_projects', 'portfolio_requests']);
  assert.deepEqual(business, [
    { resource: 'applications', level: 'member' },
    { resource: 'portfolio_projects', level: 'member' },
    { resource: 'portfolio_requests', level: 'member' },
    { resource: 'portfolio_projects', level: 'contributor' },
  ]);
  const relations = aiWriteRequirements('update_entity_relations', ['portfolio_projects', 'portfolio_requests']);
  assert.ok(relations.some((r) => r.resource === 'portfolio_requests' && r.level === 'contributor'));
  assert.deepEqual(aiWriteRequirements('create_business_record', ['portfolio_projects']), [{ resource: 'portfolio_projects', level: 'member' }]);
  assert.deepEqual(aiWriteRequirements('create_business_record', ['incidents']), [
    { resource: 'incidents', level: 'member' },
    { resource: 'incidents', level: 'contributor' },
  ]);
  // The journal note and the links need the incident contributor right; the target module read
  // is checked by the operations themselves, as the routes do.
  assert.deepEqual(aiWriteRequirements('add_incident_note', ['incidents']), [
    { resource: 'incidents', level: 'member' },
    { resource: 'incidents', level: 'contributor' },
  ]);
  assert.deepEqual(aiWriteRequirements('update_incident_links', ['incidents']), [
    { resource: 'incidents', level: 'member' },
    { resource: 'incidents', level: 'contributor' },
  ]);
  // The administrator tools ask for admin only: no member or contributor row opens them.
  assert.deepEqual(aiWriteRequirements('change_incident_state', ['incidents']), [
    { resource: 'incidents', level: 'admin' },
  ]);
  assert.deepEqual(aiWriteRequirements('set_incident_confidentiality', ['incidents']), [
    { resource: 'incidents', level: 'admin' },
  ]);
  // A follow-up task on an incident takes the tasks module at member, as its screen route.
  assert.deepEqual(aiWriteRequirements('create_task', ['tasks']), [{ resource: 'tasks', level: 'member' }]);
  assert.deepEqual(aiWriteRequirements('delete_record', [
    'tasks', 'contacts', 'locations', 'budget_lines', 'connections', 'interfaces', 'documents',
  ]), [
    { resource: 'tasks', level: 'admin' },
    { resource: 'contacts', level: 'admin' },
    { resource: 'locations', level: 'member' },
    { resource: 'budget', level: 'admin' },
    { resource: 'infrastructure', level: 'member' },
    { resource: 'applications', level: 'admin' },
    { resource: 'knowledge', level: 'admin' },
  ]);
  // The unit interface delete takes the integrated documents too: no lower than the list's bulk.
  assert.deepEqual(routeGuard([InterfacesController, 'delete']), { resource: 'applications', level: 'admin' });
  console.log('  tool requirements: OK');
}

/** The relations Plaid writes for one source family, as its refusal of an unknown relation lists them. */
function plaidRelations(family: string): string[] {
  try {
    getAiRelationBusinessResource(family, '__none__');
  } catch (error) {
    const listed = /Supported relations: (.*)\.$/.exec(String((error as Error).message))?.[1];
    if (listed) return listed.split(', ');
  }
  throw new Error(`No relations listed for ${family}`);
}

/**
 * A link written on a project or a request needs what its Relations tab needs: the read of the
 * linked family (`*_RELATION_READS`), and the right to modify business processes for a process
 * link (`PortfolioRequestsController.assertProcessWrite`). Breaks when Plaid writes a relation of
 * these families the table does not know, or when the tab reads another module.
 */
function testRelationTargetsMatchTheRelationsTab() {
  // Plaid's relation -> the section of the Relations tab.
  const section: Record<string, string> = {
    applications: 'applications',
    assets: 'assets',
    budget_lines: 'budget_lines',
    business_processes: 'processes',
  };
  const reads: Record<string, Record<string, string>> = { projects: PROJECT_RELATION_READS, requests: REQUEST_RELATION_READS };
  let rows = 0;
  for (const family of ['projects', 'requests']) {
    for (const relation of plaidRelations(family)) {
      const read = reads[family][section[relation]];
      assert.ok(read, `${family}.${relation}: a section of the Relations tab`);
      assert.deepEqual(
        aiRelationTargetRequirement('update_entity_relations', family, relation),
        { resource: read, level: relation === 'business_processes' ? 'member' : 'reader' },
        `${family}.${relation}`,
      );
      rows += 1;
    }
  }
  assert.equal(rows, 7);
  // The relation is read as the relation writes read it; other tools and families need nothing more.
  assert.deepEqual(aiRelationTargetRequirement('update_entity_relations', 'projects', 'Budget Lines'), { resource: 'budget', level: 'reader' });
  assert.equal(aiRelationTargetRequirement('update_entity_relations', 'applications', 'projects'), null);
  assert.equal(aiRelationTargetRequirement('update_business_record', 'projects', 'budget_lines'), null);
  console.log('  relation targets match the Relations tab: OK');
}

function run() {
  testTableMatchesRoutesAndPlaid();
  testTechnologyWriteRoutes();
  testOnlyTheContributorRowsAreBelowMember();
  testToolRequirements();
  testRelationTargetsMatchTheRelationsTab();
  console.log('ai-write-levels.spec: ok');
}

run();
