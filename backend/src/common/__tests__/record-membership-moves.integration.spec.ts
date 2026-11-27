import 'dotenv/config';
import 'reflect-metadata';
// @database-spec: opens the data-source through runSpecs, so it runs on a database lane.
import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import { DepartmentsService } from '../../departments/departments.service';
import { Department } from '../../departments/department.entity';
import { Company } from '../../companies/company.entity';
import { PortfolioClassificationService } from '../../portfolio/portfolio-classification.service';
import { PortfolioSource } from '../../portfolio/portfolio-source.entity';
import { PortfolioCategory } from '../../portfolio/portfolio-category.entity';
import { PortfolioStream } from '../../portfolio/portfolio-stream.entity';
import { PortfolioTaskType } from '../../portfolio/portfolio-task-type.entity';
import { AiMasterDataMutationSupportService } from '../../ai/mutation/ai-master-data-mutation-support.service';
import { applyDataAccess } from '../../data-access/data-access';
import { rowsBilan } from '../../ai/import/ai-import-runner.service';
import {
  assert,
  captureAudit,
  inRolledBackTransaction,
  runSpecs,
  seedItem,
  seedTenant,
  seedVersion,
  setTenant,
  underSavepoint,
} from '../../spend/__tests__/round-inputs.fixtures';

// A department that records carry stays in its company, a stream that records carry stays in its
// category (lot I7a of 26.12.1, decision of 2026-11-25): the move is refused (400) with the records
// counted per family, through the API, the departments file and Kad. An unused one moves; the same
// parent sent back, a rename, pass. The records of another workspace do not count, and a person with
// limited data access, who reads none of them, gets the same refusal.

type Refusal = { status?: number; code?: string; message: string; usages?: Array<{ type: string; total: number }>; params?: Record<string, unknown> };

/** The refusal of `fn`, inside a savepoint so the transaction goes on. */
async function refusal(runner: QueryRunner, fn: () => Promise<unknown>): Promise<Refusal> {
  try {
    await underSavepoint(runner, fn);
  } catch (error) {
    const body = (error as any)?.getResponse?.() ?? {};
    return { status: (error as any)?.getStatus?.(), code: body.code, message: (error as Error).message, usages: body.usages, params: body.params };
  }
  throw new Error('expected a refusal');
}

type Seeded = {
  runner: QueryRunner;
  tenantId: string;
  alpha: string;
  beta: string;
  role: string;
  svc: DepartmentsService;
  department: (name: string, number: number, company?: string) => Promise<string>;
  companyOf: (id: string) => Promise<string>;
};

async function withCompanies(tag: string, fn: (seeded: Seeded) => Promise<void>) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, tag);
    const company = async (name: string) => (await runner.query(
      `INSERT INTO companies (tenant_id, name, country_iso, city, base_currency) VALUES ($1, $2, 'FR', 'Lyon', 'EUR') RETURNING id`,
      [tenantId, name],
    ))[0].id as string;
    const alpha = await company('Alpha');
    const beta = await company('Beta');
    const [role] = await runner.query(
      `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in) VALUES ($1, 'Moves', 'Moves', false, false) RETURNING id`,
      [tenantId],
    );
    const svc = new DepartmentsService(runner.manager.getRepository(Department), runner.manager.getRepository(Company), captureAudit() as any);
    const department = async (name: string, number: number, companyId = alpha) => (await runner.query(
      `INSERT INTO departments (tenant_id, company_id, name, item_number) VALUES ($1, $2, $3, $4) RETURNING id`,
      [tenantId, companyId, name, number],
    ))[0].id as string;
    const companyOf = async (id: string) => (await runner.query(`SELECT company_id FROM departments WHERE id = $1`, [id]))[0].company_id as string;
    await fn({ runner, tenantId, alpha, beta, role: role.id, svc, department, companyOf });
  });
}

async function seedUser(runner: QueryRunner, tenantId: string, role: string, values: { department?: string; company?: string; mode?: 'all' | 'limited' } = {}) {
  const id = randomUUID();
  await runner.query(
    `INSERT INTO users (id, tenant_id, email, role_id, status, data_access_mode, company_id, department_id)
     VALUES ($1, $2, $3, $4, 'enabled', $5, $6, $7)`,
    [id, tenantId, `moves-${id.slice(0, 8)}@example.invalid`, role, values.mode ?? 'all', values.company ?? null, values.department ?? null],
  );
  return id;
}

/** One OPEX line whose allocation puts `department` with `company`. */
async function seedAllocation(runner: QueryRunner, tenantId: string, company: string, department: string, number: number) {
  const item = await seedItem(runner, 'opex', tenantId, number);
  const version = await seedVersion(runner, 'opex', tenantId, item, 2026);
  await runner.query(
    `INSERT INTO spend_allocations (tenant_id, version_id, company_id, department_id, allocation_pct) VALUES ($1, $2, $3, $4, 100)`,
    [tenantId, version, company, department],
  );
}

async function testDepartmentThroughTheApi() {
  await withCompanies('moves-api', async ({ runner, tenantId, alpha, beta, role, svc, department, companyOf }) => {
    const m = runner.manager;
    const person = await department('Person', 1);
    await seedUser(runner, tenantId, role, { company: alpha, department: person });
    const request = await department('Request', 2);
    await runner.query(
      `INSERT INTO portfolio_requests (tenant_id, item_number, name, status, company_id, department_id) VALUES ($1, 1, 'Request', 'pending_review', $2, $3)`,
      [tenantId, alpha, request],
    );
    const project = await department('Project', 3);
    await runner.query(
      `INSERT INTO portfolio_projects (tenant_id, item_number, name, status, origin, execution_progress, company_id, department_id)
       VALUES ($1, 1, 'Project', 'in_progress', 'fast_track', 0, $2, $3)`,
      [tenantId, alpha, project],
    );
    const allocated = await department('Allocated', 4);
    await seedAllocation(runner, tenantId, alpha, allocated, 1);
    await seedAllocation(runner, tenantId, alpha, allocated, 2);

    const expected: Array<[string, string, Array<{ type: string; total: number }>, RegExp]> = [
      [person, 'Person', [{ type: 'users', total: 1 }], /is used by 1 user\. It cannot change company\./],
      [request, 'Request', [{ type: 'requests', total: 1 }], /is used by 1 request\./],
      [project, 'Project', [{ type: 'projects', total: 1 }], /is used by 1 project\./],
      [allocated, 'Allocated', [{ type: 'opex_lines', total: 2 }], /is used by 2 OPEX lines\./],
    ];
    for (const [id, name, usages, message] of expected) {
      const refused = await refusal(runner, () => svc.update(id, { company_id: beta } as any, undefined, { manager: m }));
      assert.equal(refused.status, 400, `${name}: a 400`);
      assert.equal(refused.code, 'DEPARTMENT_MOVE_IN_USE', `${name}: ${refused.message}`);
      assert.deepEqual(refused.usages, usages, `${name}: counted per family`);
      assert.deepEqual(refused.params, { name }, `${name}: named`);
      assert.match(refused.message, message);
      assert.equal(await companyOf(id), alpha, `${name}: stays in Alpha`);
    }

    // Several families in one sentence.
    await seedUser(runner, tenantId, role, { company: alpha, department: allocated });
    const both = await refusal(runner, () => svc.update(allocated, { company_id: beta } as any, undefined, { manager: m }));
    assert.match(both.message, /^The department "Allocated" is used by 1 user and 2 OPEX lines\. It cannot change company\.$/);

    // The same company sent back, a rename, a description, a status: they pass.
    await svc.update(person, { company_id: alpha, name: 'People', description: 'Renamed', status: 'disabled' } as any, undefined, { manager: m });
    assert.equal(await companyOf(person), alpha);
    assert.equal((await runner.query(`SELECT name FROM departments WHERE id = $1`, [person]))[0].name, 'People');
    await svc.update(person, { company_id: alpha.toUpperCase() } as any, undefined, { manager: m });

    // A record already with Beta would not contradict the move: only what it breaks counts.
    const stale = await department('Stale', 5);
    await seedUser(runner, tenantId, role, { company: beta, department: stale });
    await svc.update(stale, { company_id: beta } as any, undefined, { manager: m });
    assert.equal(await companyOf(stale), beta, 'a record already with the new company does not hold the move');

    // An unused department moves.
    const empty = await department('Empty', 6);
    await svc.update(empty, { company_id: beta } as any, undefined, { manager: m });
    assert.equal(await companyOf(empty), beta, 'an unused department moves');
  });
}

async function testOtherWorkspaceAndLimitedPerson() {
  await withCompanies('moves-scope', async ({ runner, tenantId, alpha, beta, role, svc, department, companyOf }) => {
    const m = runner.manager;
    // A record of another workspace naming this department (the foreign key ignores workspaces): it does not count.
    const shared = await department('Shared', 1);
    const other = await seedTenant(runner, 'moves-other');
    const [otherCompany] = await runner.query(
      `INSERT INTO companies (tenant_id, name, country_iso, city, base_currency) VALUES ($1, 'Gamma', 'FR', 'Lyon', 'EUR') RETURNING id`,
      [other],
    );
    const [otherRole] = await runner.query(
      `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in) VALUES ($1, 'Other', 'Other', false, false) RETURNING id`,
      [other],
    );
    await seedUser(runner, other, otherRole.id, { company: otherCompany.id, department: shared });
    await setTenant(runner, tenantId);
    await svc.update(shared, { company_id: beta } as any, undefined, { manager: m });
    assert.equal(await companyOf(shared), beta, 'the records of another workspace do not count');

    // A person with limited data access reads no budget line: the line still holds the move.
    const allocated = await department('Allocated', 2);
    await seedAllocation(runner, tenantId, alpha, allocated, 1);
    const limited = await seedUser(runner, tenantId, role, { mode: 'limited' });
    await runner.query('SAVEPOINT limited_person');
    try {
      await applyDataAccess(runner, limited);
      const [{ n }] = await m.query(`SELECT count(*)::int AS n FROM spend_allocations WHERE tenant_id = $1`, [tenantId]);
      assert.equal(n, 0, 'harness: the limited person reads no allocation');
      const refused = await refusal(runner, () => svc.update(allocated, { company_id: beta } as any, undefined, { manager: m }));
      assert.equal(refused.code, 'DEPARTMENT_MOVE_IN_USE', refused.message);
      assert.deepEqual(refused.usages, [{ type: 'opex_lines', total: 1 }], 'the same count as for anyone');
      const [{ role: current }] = await m.query(`SELECT current_setting('role') AS role`);
      assert.equal(current, 'kanap_data_limited', 'the limited role is back after the count');
    } finally {
      await runner.query('ROLLBACK TO SAVEPOINT limited_person');
    }
    assert.equal(await companyOf(allocated), alpha);
  });
}

function fileOf(rows: Array<Record<string, string>>): Express.Multer.File {
  const headers = ['reference', 'company_name', 'name'];
  const lines = [headers.join(','), ...rows.map((row) => headers.map((header) => row[header] ?? '').join(','))];
  return { buffer: Buffer.from(`${lines.join('\n')}\n`, 'utf8') } as Express.Multer.File;
}

async function testDepartmentsFile() {
  await withCompanies('moves-file', async ({ runner, tenantId, alpha, beta, role, svc, department, companyOf }) => {
    const m = runner.manager;
    const used = await department('Used', 1);
    await seedUser(runner, tenantId, role, { company: alpha, department: used });
    await seedUser(runner, tenantId, role, { company: alpha, department: used });
    const empty = await department('Empty', 2);
    const file = fileOf([
      { reference: 'DEPT-1', company_name: 'Beta', name: 'Used' },
      { reference: 'DEPT-2', company_name: 'Beta', name: 'Empty' },
      { company_name: 'Alpha', name: 'New one' },
    ]);
    for (const dryRun of [true, false]) {
      const result = await svc.importCsv({ file, dryRun, language: 'en' }, { manager: m });
      assert.equal(result.ok, false, `${dryRun ? 'check' : 'load'}: refused`);
      assert.equal(result.errors.length, 1, `${dryRun ? 'check' : 'load'}: the other rows raise nothing: ${JSON.stringify(result.errors)}`);
      const [error] = result.errors as any[];
      assert.equal(error.row, 2);
      assert.equal(error.column, 'company_name');
      assert.equal(error.code, 'DEPARTMENT_MOVE_IN_USE');
      assert.deepEqual(error.usages, [{ type: 'users', total: 2 }]);
      assert.deepEqual(error.params, { name: 'Used' });
      assert.match(error.message, /^The department "Used" is used by 2 users\. It cannot change company\.$/);
      assert.equal(await companyOf(used), alpha);
      assert.equal(await companyOf(empty), alpha, 'nothing written');
      // Kad's card of the same file keeps the counts, for the card to word them.
      const card = rowsBilan(result as any, dryRun, [1, 2, 3, 4]);
      assert.equal(card.report.kind, 'rows');
      const [shown] = (card.report as any).errors;
      assert.deepEqual([shown.code, shown.usages], ['DEPARTMENT_MOVE_IN_USE', [{ type: 'users', total: 2 }]], 'Kad\'s card keeps the counts');
    }
    // An unused department moves by the file.
    const moved = await svc.importCsv({ file: fileOf([{ reference: 'DEPT-2', company_name: 'Beta', name: 'Empty' }]), dryRun: false, language: 'en' }, { manager: m });
    assert.equal(moved.ok, true, JSON.stringify(moved.errors));
    assert.equal(await companyOf(empty), beta, 'an unused department moves by the file');
  });
}

async function testKadPreview() {
  await withCompanies('moves-kad', async ({ runner, tenantId, alpha, role, svc, department }) => {
    const used = await department('Used', 1);
    const userId = await seedUser(runner, tenantId, role, { company: alpha, department: used });
    const empty = await department('Empty', 2);
    const args = Array.from({ length: 12 }, () => ({})) as any[];
    args[7] = svc;
    const kad = new (AiMasterDataMutationSupportService as any)(...args) as AiMasterDataMutationSupportService;
    const context = { manager: runner.manager, tenantId, userId, isPlatformHost: false, surface: 'chat', authMethod: 'jwt', conversationId: 'moves' } as any;
    const refused = await refusal(runner, () => kad.prepareUpdatePreview(context, { entity_type: 'departments', ref: 'DEPT-1', fields: { company_id: 'Beta' } } as any));
    assert.equal(refused.code, 'DEPARTMENT_MOVE_IN_USE', refused.message);
    assert.match(refused.message, /^The department "Used" is used by 1 user\. It cannot change company\.$/);
    const card = await kad.prepareUpdatePreview(context, { entity_type: 'departments', ref: 'DEPT-2', fields: { company_id: 'Beta' } } as any);
    assert.ok((card.mutationInput.fields as Record<string, unknown>).company_id, 'an unused department: the card');
    assert.equal(card.targetEntityId, empty);
  });
}

async function testStreams() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'moves-streams');
    const m = runner.manager;
    const svc = new PortfolioClassificationService(
      m.getRepository(PortfolioSource), m.getRepository(PortfolioCategory), m.getRepository(PortfolioStream), m.getRepository(PortfolioTaskType),
    );
    const [it] = await runner.query(`INSERT INTO portfolio_categories (tenant_id, name) VALUES ($1, 'IT') RETURNING id`, [tenantId]);
    const [biz] = await runner.query(`INSERT INTO portfolio_categories (tenant_id, name) VALUES ($1, 'Business') RETURNING id`, [tenantId]);
    const stream = async (name: string) => (await runner.query(
      `INSERT INTO portfolio_streams (tenant_id, category_id, name) VALUES ($1, $2, $3) RETURNING id`, [tenantId, it.id, name],
    ))[0].id as string;
    const categoryOf = async (id: string) => (await runner.query(`SELECT category_id FROM portfolio_streams WHERE id = $1`, [id]))[0].category_id as string;
    const byRequest = await stream('By request');
    await runner.query(
      `INSERT INTO portfolio_requests (tenant_id, item_number, name, status, category_id, stream_id) VALUES ($1, 1, 'Request', 'pending_review', $2, $3)`,
      [tenantId, it.id, byRequest],
    );
    const byProject = await stream('By project');
    const [project] = await runner.query(
      `INSERT INTO portfolio_projects (tenant_id, item_number, name, status, origin, execution_progress, category_id, stream_id)
       VALUES ($1, 1, 'Project', 'in_progress', 'fast_track', 0, $2, $3) RETURNING id`,
      [tenantId, it.id, byProject],
    );
    // A task of that project with no stream of its own shows the project's: it is not counted.
    await runner.query(
      `INSERT INTO tasks (tenant_id, item_number, title, status, related_object_type, related_object_id, labels, viewer_ids, owner_ids)
       VALUES ($1, 1, 'Inherits', 'open', 'project', $2, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)`,
      [tenantId, project.id],
    );
    const byTask = await stream('By task');
    // Its own stream, the category of its project.
    await runner.query(
      `INSERT INTO tasks (tenant_id, item_number, title, status, related_object_type, related_object_id, stream_id, labels, viewer_ids, owner_ids)
       VALUES ($1, 2, 'Own', 'open', 'project', $2, $3, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)`,
      [tenantId, project.id, byTask],
    );
    const cases: Array<[string, string, Array<{ type: string; total: number }>]> = [
      [byRequest, 'By request', [{ type: 'requests', total: 1 }]],
      [byProject, 'By project', [{ type: 'projects', total: 1 }]],
      [byTask, 'By task', [{ type: 'tasks', total: 1 }]],
    ];
    for (const [id, name, usages] of cases) {
      const refused = await refusal(runner, () => svc.updateStream(id, tenantId, { category_id: biz.id }, { manager: m }));
      assert.equal(refused.status, 400, `${name}: a 400`);
      assert.equal(refused.code, 'STREAM_MOVE_IN_USE', `${name}: ${refused.message}`);
      assert.deepEqual(refused.usages, usages, name);
      assert.equal(await categoryOf(id), it.id, `${name}: stays in IT`);
    }
    const project_ = await refusal(runner, () => svc.updateStream(byProject, tenantId, { category_id: biz.id }, { manager: m }));
    assert.match(project_.message, /^The stream "By project" is used by 1 project\. It cannot change category\.$/, 'the inheriting task is not counted');
    // The same category sent back, whatever its case, a rename: they pass, even with a record already
    // out of line (no move, nothing counted).
    await runner.query(
      `INSERT INTO portfolio_requests (tenant_id, item_number, name, status, category_id, stream_id) VALUES ($1, 2, 'Out of line', 'pending_review', $2, $3)`,
      [tenantId, biz.id, byRequest],
    );
    await svc.updateStream(byRequest, tenantId, { category_id: it.id.toUpperCase() }, { manager: m });
    await svc.updateStream(byRequest, tenantId, { category_id: it.id, name: 'Requests' }, { manager: m });
    assert.equal(await categoryOf(byRequest), it.id);
    // An unused stream moves.
    const empty = await stream('Empty');
    await svc.updateStream(empty, tenantId, { category_id: biz.id }, { manager: m });
    assert.equal(await categoryOf(empty), biz.id, 'an unused stream moves');
  });
}

void runSpecs('record-membership-moves', [
  ['a department used by a person, a request, a project or an allocation stays in its company', testDepartmentThroughTheApi],
  ['another workspace does not count; a person with limited access gets the same refusal', testOtherWorkspaceAndLimitedPerson],
  ['the departments file refuses the row that moves a used department, at the check and the load', testDepartmentsFile],
  ['Kad: the preview refuses the move of a used department', testKadPreview],
  ['a stream used by a request, a project or a task stays in its category', testStreams],
]);
