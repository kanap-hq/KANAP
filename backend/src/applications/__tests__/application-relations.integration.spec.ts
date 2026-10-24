// @database-spec
import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { ApplicationsController } from '../applications.controller';
import { ApplicationsCrudService } from '../services/applications-crud.service';
import { context, inRolledBackTransaction, NO_ACCESS, relationsService, runSpecs, seedRelations, YEAR } from './application-relations.fixtures';

// GET /applications/:id/relations (lot R1), on an empty migrated database: the sections, the
// amount of each line on the tenant's default column for the current year, the four suggestion
// rules, the sections hidden from a caller who cannot read their module, and the participation
// scopes of a Business Contributor.

async function testSections() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedRelations(runner, 'sections');
    const res = await relationsService().getRelations(seed.appId, context(runner.manager, seed));

    assert.equal(res.year, YEAR);
    assert.deepEqual(res.budget_column, { key: 'committed', label: 'Revision' });

    // Lines by name; the amount is the default column (committed) of this year's version only.
    assert.deepEqual(res.budget_lines?.map((l) => [l.id, l.nature, l.amount, l.currency]), [
      [seed.lines.linked, 'opex', 999, 'EUR'],
      [seed.lines.noVersion, 'capex', null, 'EUR'],
    ]);
    assert.equal(res.budget_lines?.[0].supplier_name, 'Talend sections');

    assert.equal(res.contracts?.length, 1);
    const contract = res.contracts![0];
    assert.equal(contract.id, seed.contracts.linked);
    assert.equal(contract.yearly_amount, 36000);
    assert.equal(contract.currency, 'EUR');
    assert.equal(contract.auto_renewal, true);
    assert.match(contract.end_date ?? '', /^\d{4}-\d{2}-\d{2}$/);

    assert.deepEqual(res.projects?.map((p) => [p.id, p.item_number, p.planned_end]), [[seed.projects.linked, 7, `${YEAR}-11-30`]]);
    assert.deepEqual(res.requests?.map((r) => r.id).sort(), [seed.requests.linked, seed.requests.hidden].sort());

    // Direct links only, active first by due date, done last; a task of a linked project that is
    // not linked to the application never shows.
    assert.deepEqual(res.tasks?.map((t) => t.id), [seed.tasks.carried, seed.tasks.linked, seed.tasks.done]);
    assert.ok(!res.tasks?.some((t) => t.id === seed.tasks.ofLinkedProject));
    assert.equal(res.tasks?.find((t) => t.id === seed.tasks.linked)?.assignee_name, 'Claire Dubois');

    assert.deepEqual(res.also, { assets: 2, interfaces: 2, documents: 3 });
  });
}

async function testSuggestions() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedRelations(runner, 'suggest');
    const res = await relationsService().getRelations(seed.appId, context(runner.manager, seed));
    const byId = new Map(res.suggestions.map((s) => [s.id, s]));

    // A1: the supplier's active contract not linked yet.
    assert.deepEqual(byId.get(seed.contracts.sameSupplier)?.via, { kind: 'same_supplier', label: null });
    assert.ok(!byId.has(seed.contracts.disabled));
    assert.ok(!byId.has(seed.contracts.linked));
    // A2: the supplier's active line not linked yet; a disabled one is never offered.
    assert.deepEqual(byId.get(seed.lines.sameSupplier)?.via, { kind: 'same_supplier', label: null });
    assert.ok(!byId.has(seed.lines.disabledSameSupplier));
    assert.ok(!byId.has(seed.lines.linked));
    // A3: lines of the linked contract and of the linked project.
    assert.deepEqual(byId.get(seed.lines.viaContract)?.via, { kind: 'contract', label: 'Maintenance Talend' });
    assert.deepEqual(byId.get(seed.lines.viaProject)?.via, { kind: 'project', label: 'PRJ-7' });
    // A4: the project that carries a task linked to the application.
    assert.deepEqual(byId.get(seed.projects.carrier)?.via, { kind: 'task', label: `T-${seed.taskNumbers.carried}` });
    assert.ok(!byId.has(seed.projects.linked));
    assert.ok(!byId.has(seed.projects.other));

    assert.deepEqual(
      res.suggestions.map((s) => s.type).sort(),
      ['budget_line', 'budget_line', 'budget_line', 'contract', 'project'],
    );
  });
}

async function testHiddenWithoutReadAccess() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedRelations(runner, 'noread');
    const res = await relationsService().getRelations(seed.appId, context(runner.manager, seed, { access: NO_ACCESS }));
    assert.equal(res.budget_lines, null);
    assert.equal(res.contracts, null);
    assert.equal(res.projects, null);
    assert.equal(res.requests, null);
    assert.equal(res.tasks, null);
    assert.deepEqual(res.suggestions, []);

    // Budget readers without contract access: no contract section, no A1, no A3 by contract.
    const budgetOnly = await relationsService().getRelations(
      seed.appId,
      context(runner.manager, seed, { access: { ...NO_ACCESS, budget_lines: true } }),
    );
    assert.equal(budgetOnly.contracts, null);
    assert.deepEqual(budgetOnly.suggestions.map((s) => s.id), [seed.lines.sameSupplier]);
  });
}

async function testParticipationScopes() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedRelations(runner, 'scope');
    const scope = { userId: seed.userId };
    const res = await relationsService().getRelations(
      seed.appId,
      context(runner.manager, seed, { scopes: { project: scope, request: scope, task: scope } }),
    );
    assert.deepEqual(res.projects?.map((p) => p.id), [seed.projects.linked]);
    assert.deepEqual(res.requests?.map((r) => r.id), [seed.requests.linked]);
    // The tasks the user is assigned to, or that belong to a project the user takes part in.
    assert.deepEqual(res.tasks?.map((t) => t.id), [seed.tasks.linked]);
    // The carrier project is out of the user's projects: never suggested.
    assert.ok(!res.suggestions.some((s) => s.id === seed.projects.carrier));
  });
}

/**
 * The Relations badge (`relations-count.total`) counts the linked requests and leaves the tasks out
 * (fried, 2026-10-21): none without the read right on requests, a Business Contributor's own only.
 */
async function testBadgeCountsRequestsNotTasks() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedRelations(runner, 'badge');
    const crud = new ApplicationsCrudService(undefined as any, undefined as any, undefined as any, undefined as any, undefined as any);
    const sum = (c: Awaited<ReturnType<ApplicationsCrudService['relationCounts']>>) =>
      c.opex + c.capex + c.budget_lines_hidden + c.contracts + c.projects + c.requests + c.links + c.attachments;

    const all = await crud.relationCounts(seed.appId, { manager: runner.manager, requestsAccess: {} });
    assert.equal(all.requests, 2, 'both linked requests');
    assert.equal(all.total, sum(all), 'requests in the total, tasks never');
    assert.ok(!('tasks' in all), 'the counts carry no task field');

    const scoped = await crud.relationCounts(seed.appId, { manager: runner.manager, requestsAccess: { scope: { userId: seed.userId } } });
    assert.equal(scoped.requests, 1, 'a Business Contributor counts the requests it takes part in');

    const unread = await crud.relationCounts(seed.appId, { manager: runner.manager, requestsAccess: null });
    assert.equal(unread.requests, 0, 'no read right on requests: none counted');
    assert.equal(unread.total, all.total - 2);
  });
}

/**
 * The badge follows the same rule as the tab (recette C1b n° 32): an IT Landscape Reader, who reads
 * neither the budget, the contracts nor the portfolio, sees no section for them and counts none of them.
 */
async function testBadgeFollowsModuleRights() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedRelations(runner, 'badge-rights');
    const crud = new ApplicationsCrudService(undefined as any, undefined as any, undefined as any, undefined as any, undefined as any);
    const all = await crud.relationCounts(seed.appId, { manager: runner.manager, requestsAccess: {} });
    assert.ok(all.opex > 0 && all.contracts > 0 && all.projects > 0, 'the seed links budget lines, contracts and projects');

    const controller = Object.create(ApplicationsController.prototype) as ApplicationsController;
    Object.assign(controller, { svc: { relationCounts: (id: string, opts: any) => crud.relationCounts(id, opts) } });
    const itLandscapeReader = {
      applications: 'reader', infrastructure: 'reader', locations: 'reader', incidents: 'reader', settings: 'reader',
      tasks: 'reader', users: 'reader', companies: 'reader', departments: 'reader', cost_centers: 'reader',
      working_day_profiles: 'reader', suppliers: 'reader', contacts: 'reader',
    };
    const ctx = { tenantId: seed.tenantId, userId: seed.userId, userRoles: ['IT Landscape Reader'], isAdmin: false, permissions: itLandscapeReader, manager: runner.manager };
    const reader = await controller.relationCounts(seed.appId, ctx as any);
    assert.deepEqual(
      [reader.opex, reader.capex, reader.contracts, reader.projects, reader.requests],
      [0, 0, 0, 0, 0],
      'no budget, contract, project or request counted',
    );
    // Without the budget right, the tab shows "N budget lines": the badge counts them too.
    assert.equal(reader.budget_lines_hidden, all.opex + all.capex, 'every linked line counted, none named');
    assert.equal(reader.total, reader.links + reader.attachments + reader.budget_lines_hidden);

    const withRights = await controller.relationCounts(seed.appId, {
      ...ctx,
      permissions: { ...itLandscapeReader, budget: 'reader', contracts: 'reader', portfolio_projects: 'reader' },
    } as any);
    assert.deepEqual(
      [withRights.opex, withRights.capex, withRights.contracts, withRights.projects],
      [all.opex, all.capex, all.contracts, all.projects],
      'counted with the read rights',
    );
    assert.equal(withRights.budget_lines_hidden, 0, 'nothing hidden with the budget right and no data access limit');
  });
}

runSpecs('application-relations.integration.spec', [testSections, testSuggestions, testHiddenWithoutReadAccess, testParticipationScopes, testBadgeCountsRequestsNotTasks, testBadgeFollowsModuleRights])
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
