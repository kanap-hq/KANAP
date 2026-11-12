// @database-spec
import 'dotenv/config';
import { NotFoundException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import { PortfolioProjectsController } from '../portfolio-projects.controller';
import { PortfolioProjectTasksController } from '../portfolio-project-tasks.controller';
import { PortfolioDependenciesService } from '../services/portfolio-dependencies.service';
import { PortfolioProjectsCrudService } from '../services/portfolio-projects-crud.service';
import { PortfolioProjectsService } from '../services/portfolio-projects.service';
import { assert, captureAudit, inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';

// GET /portfolio/projects/:id says whether the reader may contribute to the project
// (`can_contribute`), with the check the project's writes make. A Business Contributor who also
// reads every project through another role reads a project they do not take part in, and may not
// add a task or edit a managed document there: `can_contribute` is false on it, true on a project
// they take part in.

type Seed = {
  tenantId: string;
  users: Record<'bcReader' | 'contributor' | 'reader', string>;
  projects: Record<'theirs' | 'other', string>;
};

async function seed(runner: QueryRunner): Promise<Seed> {
  const tenantId = await seedTenant(runner, 'can-contribute');
  const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0];
  const role = async (name: string, level: string) => {
    const id = (await one(`INSERT INTO roles (tenant_id, role_name) VALUES ($1, $2) RETURNING id`, [tenantId, name])).id as string;
    await runner.query(
      `INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, 'portfolio_projects', $3)`,
      [tenantId, id, level],
    );
    return id;
  };
  const bc = await role('Business Contributor', 'contributor');
  const projectReader = await role('Project reader', 'reader');
  const projectContributor = await role('Project contributor', 'contributor');
  const user = async (tag: string, roleIds: string[]) => {
    const id = (await one(
      `INSERT INTO users (tenant_id, email, role_id, first_name, last_name) VALUES ($1, $2, $3, $4, 'Tester') RETURNING id`,
      [tenantId, `${tag}-${tenantId.slice(0, 8)}@example.test`, roleIds[0], tag],
    )).id as string;
    for (const [index, roleId] of roleIds.entries()) {
      await runner.query(
        `INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, $4)`,
        [tenantId, id, roleId, index === 0],
      );
    }
    return id;
  };
  const users = {
    bcReader: await user('bc-reader', [bc, projectReader]),
    contributor: await user('contributor', [projectContributor]),
    reader: await user('reader', [projectReader]),
  };
  const project = async (number: number, itLead: string | null) => (await one(
    `INSERT INTO portfolio_projects (tenant_id, name, item_number, status, it_lead_id) VALUES ($1, $2, $3, 'in_progress', $4) RETURNING id`,
    [tenantId, `Project ${number}`, number, itLead],
  )).id as string;
  return { tenantId, users, projects: { theirs: await project(1, users.bcReader), other: await project(2, null) } };
}

function controllers() {
  const crud = new PortfolioProjectsCrudService(
    undefined as any, undefined as any, captureAudit() as any, undefined as any,
    undefined as any, undefined as any, undefined as any,
  );
  const projects = new PortfolioProjectsService(
    undefined as any, crud, new PortfolioDependenciesService(undefined as any, captureAudit() as any),
    undefined as any, undefined as any, undefined as any, undefined as any, undefined as any,
  );
  return {
    projects: new PortfolioProjectsController(
      projects, undefined as any, undefined as any, undefined as any, {
        acquireLockBySource: async () => ({ acquired: true }),
      } as any, undefined as any, undefined as any, undefined as any,
    ),
    tasks: new PortfolioProjectTasksController(undefined as any, undefined as any, undefined as any, projects, undefined as any),
  };
}

/** The request as the guards leave it: the union of the person's rights. */
function ctx(runner: QueryRunner, s: Seed, userId: string, level: string) {
  return {
    tenantId: s.tenantId,
    userId,
    userRoles: [],
    isAdmin: false,
    permissions: { portfolio_projects: level },
    manager: runner.manager,
    queryRunner: { manager: runner.manager },
    user: { sub: userId },
    tenant: { id: s.tenantId },
  } as any;
}

async function rejection(fn: () => Promise<unknown>): Promise<Error> {
  try {
    await fn();
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected a refusal');
}

async function testBusinessContributorWhoReadsEveryProject() {
  await inRolledBackTransaction(async (runner) => {
    const s = await seed(runner);
    const { projects, tasks } = controllers();
    const who = ctx(runner, s, s.users.bcReader, 'contributor');

    // They read the project they do not take part in, but its writes refuse them.
    const other = await projects.get(s.projects.other, {}, who);
    assert.equal(other.id, s.projects.other);
    const task = await rejection(() => tasks.createTask(s.projects.other, { title: 'Task' } as any, who));
    assert.ok(task instanceof NotFoundException, 'adding a task is refused');
    const lock = await rejection(() => projects.acquireIntegratedDocumentLock(s.projects.other, 'purpose', who));
    assert.ok(lock instanceof NotFoundException, 'editing a managed document is refused');
    assert.equal((other as any).can_contribute, false, 'may not contribute to a project they do not take part in');

    const theirs = await projects.get(s.projects.theirs, {}, who);
    assert.equal((theirs as any).can_contribute, true, 'may contribute to a project they take part in');
    await projects.acquireIntegratedDocumentLock(s.projects.theirs, 'purpose', who);
  });
}

async function testOtherReaders() {
  await inRolledBackTransaction(async (runner) => {
    const s = await seed(runner);
    const { projects } = controllers();
    const contributor = await projects.get(s.projects.other, {}, ctx(runner, s, s.users.contributor, 'contributor'));
    assert.equal((contributor as any).can_contribute, true, 'a contributor to every project');
    const reader = await projects.get(s.projects.other, {}, ctx(runner, s, s.users.reader, 'reader'));
    assert.equal((reader as any).can_contribute, false, 'a reader');
  });
}

void runSpecs('project-can-contribute.integration.spec', [
  ['testBusinessContributorWhoReadsEveryProject', testBusinessContributorWhoReadsEveryProject],
  ['testOtherReaders', testOtherReaders],
]);
