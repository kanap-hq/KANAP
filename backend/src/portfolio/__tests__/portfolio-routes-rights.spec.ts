import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { REQUIRE_LEVEL_KEY } from '../../auth/require-level.decorator';
import { PortfolioProjectsController } from '../portfolio-projects.controller';
import { PortfolioRequestsController } from '../portfolio-requests.controller';
import { ContractsController } from '../../contracts/contracts.controller';

/**
 * The portfolio routes accept no more than their page. The project page opens to a contributor
 * (`canContributeToProject`) the purpose, time entries, web links and files, the Relations tab and
 * the integrated documents, and the planning page the planned dates and the scheduling mode; every
 * other change needs `member` (`canManage`). A bulk replacement of
 * linked applications, assets or budget lines needs a read of that family, as the Relations tab.
 */

const PROJECT = '11111111-1111-4111-8111-111111111111';
const APP_IN = '22222222-2222-4222-8222-222222222222';
const APP_OUT = '33333333-3333-4333-8333-333333333333';
const USER = '44444444-4444-4444-8444-444444444444';

const levelOf = (proto: any, method: string) => {
  assert.equal(typeof proto[method], 'function', method);
  return Reflect.getMetadata(REQUIRE_LEVEL_KEY, proto[method]);
};

/** Project routes the page keeps for members (`canManage`). */
const PROJECT_MEMBER_WRITES = [
  'create',
  'linkSourceRequest', 'unlinkSourceRequest',
  'bulkReplaceBusinessTeam', 'bulkReplaceItTeam',
  'setEffortAllocations', 'resetEffortAllocations',
  'bulkReplaceContacts',
  'addComment', 'updateComment',
  'addDependency', 'removeDependency',
  'createPhase', 'updatePhase', 'deletePhase', 'reorderPhases', 'togglePhaseMilestone',
  'createMilestone', 'updateMilestone', 'deleteMilestone', 'applyPhaseTemplate',
];

/** Project routes the page opens to a contributor. `update` filters its fields (below). */
const PROJECT_CONTRIBUTOR_WRITES = [
  'update',
  'linkRelation', 'unlinkRelation',
  'bulkReplaceLinkedApplications', 'bulkReplaceLinkedAssets', 'bulkReplaceCapex', 'bulkReplaceOpex',
  'replaceUrls', 'uploadAttachment', 'uploadInlineAttachment', 'importInlineAttachment', 'deleteAttachment',
  'updateIntegratedDocument', 'acquireIntegratedDocumentLock',
  'createTimeEntry', 'updateTimeEntry', 'deleteTimeEntry',
];

function testRouteLevels() {
  const proto = PortfolioProjectsController.prototype as any;
  for (const method of PROJECT_MEMBER_WRITES) {
    assert.deepEqual(levelOf(proto, method), { resource: 'portfolio_projects', level: 'member' }, method);
  }
  for (const method of PROJECT_CONTRIBUTOR_WRITES) {
    assert.deepEqual(levelOf(proto, method), { resource: 'portfolio_projects', level: 'contributor' }, method);
  }
  // Every write of the request page is a member's, except its Relations tab and its delete,
  // which the page keeps behind `canAdmin` as its route is.
  const req = PortfolioRequestsController.prototype as any;
  for (const method of ['bulkReplaceApplications', 'bulkReplaceAssets', 'bulkReplaceCapex', 'bulkReplaceOpex', 'bulkReplaceBusinessProcesses']) {
    assert.deepEqual(levelOf(req, method), { resource: 'portfolio_requests', level: 'member' }, method);
  }
  assert.deepEqual(levelOf(req, 'delete'), { resource: 'portfolio_requests', level: 'admin' });
}

type Perms = Record<string, string>;

/** A project controller whose project lookup is stubbed: what remains is the route's own rule. */
function projectController(scopeVisible: string[] = []) {
  const calls: string[] = [];
  const svc = new Proxy({}, {
    get: (_t, name: string) => async (..._args: unknown[]) => {
      calls.push(name);
      if (name === 'listLinkedApplications') return { items: [{ id: APP_IN }] };
      return { ok: true };
    },
  });
  const controller = new PortfolioProjectsController(svc as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any) as any;
  const levels: string[] = [];
  controller.resolveForAccess = async (_id: string, _ctx: unknown, level: string) => {
    levels.push(level);
    return { id: PROJECT };
  };
  controller.projectRelationsContext = async () => ({ applicationScope: scopeVisible.length ? { userId: USER } : undefined });
  const ctx = (permissions: Perms) => ({
    userId: USER,
    tenantId: 't',
    isAdmin: false,
    permissions,
    manager: { query: async () => scopeVisible.map((id) => ({ id })) },
  }) as any;
  return { controller, calls, levels, ctx };
}

async function refusal(work: () => Promise<unknown>): Promise<Error> {
  try {
    await work();
  } catch (error) {
    return error as Error;
  }
  assert.fail('expected a refusal');
}

async function testProjectUpdateFields() {
  const { controller, calls, ctx } = projectController();
  const contributor = ctx({ portfolio_projects: 'contributor' });

  // Counter-check: the purpose (project page), the planned dates (planning Gantt) and the scheduling
  // mode (roadmap) go through for a contributor.
  await controller.update(PROJECT, { purpose: '<p>Why</p>' }, contributor);
  await controller.update(PROJECT, { planned_start: '2026-11-01', planned_end: '2026-12-01', scheduling_mode: 'manual' }, contributor);
  assert.deepEqual(calls, ['update', 'update']);

  for (const body of [{ name: 'Renamed' }, { purpose: 'x', status: 'done' }, { execution_progress: 50 }, { business_lead_id: USER }, { planned_end: '2026-12-01', estimated_effort_it: 10 }]) {
    const error = await refusal(() => controller.update(PROJECT, body, contributor));
    assert.ok(error instanceof ForbiddenException, JSON.stringify(body));
    assert.match(error.message, /member level on projects/, 'names the missing right');
    const response = error.getResponse() as { code?: string; params?: unknown };
    assert.equal(response.code, 'MODULE_RIGHT_REQUIRED', 'the screen translates the right');
    assert.deepEqual(response.params, { resource: 'portfolio_projects', level: 'member' });
    assert.match(error.message, new RegExp(`^Changing ${Object.keys(body).filter((k) => !['purpose', 'planned_end'].includes(k)).join(', ')} needs`), 'names the refused fields only');
  }
  assert.deepEqual(calls, ['update', 'update'], 'nothing written after a refusal');

  // A member changes every field, as before.
  await controller.update(PROJECT, { name: 'Renamed', status: 'done', purpose: 'x' }, ctx({ portfolio_projects: 'member' }));
  await controller.update(PROJECT, { name: 'Renamed' }, { ...ctx({}), isAdmin: true });
  assert.equal(calls.length, 4);
}

async function testProjectBulkReplaceNeedsTheLinkedFamily() {
  const routes: Array<[string, string, string, Record<string, unknown>]> = [
    ['bulkReplaceLinkedApplications', 'applications', 'You cannot read applications.', { application_ids: [APP_IN] }],
    ['bulkReplaceLinkedAssets', 'infrastructure', 'You cannot read assets.', { asset_ids: [] }],
    ['bulkReplaceCapex', 'budget', 'You cannot read budget lines.', { capex_ids: [] }],
    ['bulkReplaceOpex', 'budget', 'You cannot read budget lines.', { opex_ids: [] }],
  ];
  for (const [method, family, message, body] of routes) {
    const { controller, calls, ctx } = projectController();
    const error = await refusal(() => controller[method](PROJECT, body, ctx({ portfolio_projects: 'member' })));
    assert.ok(error instanceof ForbiddenException, method);
    assert.deepEqual((error as ForbiddenException).getResponse(), {
      statusCode: 403,
      error: 'Forbidden',
      code: 'MODULE_RIGHT_REQUIRED',
      message,
      params: { resource: family, level: 'reader' },
    }, method);
    assert.deepEqual(calls, [], `${method}: nothing read or written`);
    // Counter-check: with the read of the family, the replacement runs.
    await controller[method](PROJECT, body, ctx({ portfolio_projects: 'contributor', [family]: 'reader' }));
    assert.match(calls.join(' '), /bulkReplace/, method);
  }
}

async function testProjectApplicationsInScope() {
  // A Business Contributor who takes part in APP_IN only: APP_OUT is neither added nor dropped.
  const { controller, calls, ctx } = projectController([APP_IN]);
  const bc = ctx({ portfolio_projects: 'contributor', applications: 'reader' });
  const error = await refusal(() => controller.bulkReplaceLinkedApplications(PROJECT, { application_ids: [APP_IN, APP_OUT] }, bc));
  assert.ok(error instanceof BadRequestException);
  assert.ok(!calls.includes('bulkReplaceLinkedApplications'));
  await controller.bulkReplaceLinkedApplications(PROJECT, { application_ids: [APP_IN] }, bc);
  assert.ok(calls.includes('bulkReplaceLinkedApplications'), 'in scope: replaced');
}

/** A request controller with its lookups stubbed. */
function requestController() {
  const calls: string[] = [];
  const svc = new Proxy({}, {
    get: (_t, name: string) => async () => {
      calls.push(name);
      return name === 'listLinkedApplications' ? { items: [] } : { ok: true };
    },
  });
  const controller = new PortfolioRequestsController(svc as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any) as any;
  controller.resolveForAccess = async () => ({ id: PROJECT });
  const req = (permissions: Perms) => ({
    user: { sub: USER },
    isAdmin: false,
    permissions,
    // No Business Contributor scope: resolved once per request, cached.
    __businessContributorScopeCache: { 'applications:reader': undefined },
    queryRunner: { manager: { query: async () => [] } },
  });
  return { controller, calls, req };
}

async function testRequestBulkReplaceNeedsTheLinkedFamily() {
  const routes: Array<[string, Perms, string, string, Record<string, unknown>]> = [
    ['bulkReplaceApplications', { applications: 'reader' }, 'applications', 'You cannot read applications.', { application_ids: [] }],
    ['bulkReplaceAssets', { infrastructure: 'reader' }, 'infrastructure', 'You cannot read assets.', { asset_ids: [] }],
    ['bulkReplaceCapex', { budget: 'reader' }, 'budget', 'You cannot read budget lines.', { capex_ids: [] }],
    ['bulkReplaceOpex', { budget: 'reader' }, 'budget', 'You cannot read budget lines.', { opex_ids: [] }],
    ['bulkReplaceBusinessProcesses', { business_processes: 'member' }, 'business_processes', 'You cannot read this module.', { business_process_ids: [] }],
  ];
  for (const [method, grant, resource, message, body] of routes) {
    const { controller, calls, req } = requestController();
    const error = await refusal(() => controller[method](PROJECT, body, req({ portfolio_requests: 'member' })));
    assert.ok(error instanceof ForbiddenException, method);
    assert.deepEqual((error as ForbiddenException).getResponse(), {
      statusCode: 403,
      error: 'Forbidden',
      code: 'MODULE_RIGHT_REQUIRED',
      message,
      params: { resource, level: 'reader' },
    }, method);
    assert.deepEqual(calls, [], `${method}: nothing read or written`);
    await controller[method](PROJECT, body, req({ portfolio_requests: 'member', ...grant }));
    assert.match(calls.join(' '), /bulkReplace/, method);
  }
  // A process link needs the right to manage business processes, as the Relations tab.
  const { controller, calls, req } = requestController();
  const error = await refusal(() => controller.bulkReplaceBusinessProcesses(PROJECT, { business_process_ids: [] }, req({ portfolio_requests: 'member', business_processes: 'reader' })));
  assert.equal(error.message, 'You cannot edit this module.');
  const editBody = (error as ForbiddenException).getResponse() as any;
  assert.equal(editBody.code, 'MODULE_RIGHT_REQUIRED');
  assert.deepEqual(editBody.params, { resource: 'business_processes', level: 'member' });
  assert.deepEqual(calls, []);
}

async function testContractComplianceReadsTheApplications() {
  const seen: unknown[] = [];
  const svc = {
    compliance: async (_id: string, access: unknown) => { seen.push(access); return {}; },
    updateCompliance: async (_id: string, _r: string, _b: unknown, _u: unknown, access: unknown) => { seen.push(access); return {}; },
  };
  const controller = new ContractsController(svc as any, {} as any, {} as any, {} as any);
  const req = { user: { sub: USER }, isAdmin: false, permissions: { contracts: 'member' }, queryRunner: { manager: {} } };
  await controller.compliance('c1', req);
  await controller.updateCompliance('c1', 'gdpr_dpa', { state: 'present' }, req);
  assert.deepEqual(seen, [
    { infrastructure: false, applications: false, applicationScope: undefined },
    { infrastructure: false, applications: false, applicationScope: undefined },
  ], 'a contracts member who reads neither applications nor assets: the reasons name none');
}

async function run() {
  testRouteLevels();
  await testProjectUpdateFields();
  await testProjectBulkReplaceNeedsTheLinkedFamily();
  await testProjectApplicationsInScope();
  await testRequestBulkReplaceNeedsTheLinkedFamily();
  await testContractComplianceReadsTheApplications();
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
