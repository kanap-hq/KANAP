import 'dotenv/config';
import 'reflect-metadata';
import type { EntityManager } from 'typeorm';
import { Company } from '../../companies/company.entity';
import { Department } from '../../departments/department.entity';
import { DepartmentsService } from '../../departments/departments.service';
import { PortfolioClassificationService } from '../../portfolio/portfolio-classification.service';
import { PortfolioCategory } from '../../portfolio/portfolio-category.entity';
import { PortfolioSource } from '../../portfolio/portfolio-source.entity';
import { PortfolioStream } from '../../portfolio/portfolio-stream.entity';
import { PortfolioTaskType } from '../../portfolio/portfolio-task-type.entity';
import { assert, httpStatus, progress, runRaceSpecs, settle, withRace } from '../../spend/__tests__/race-harness';

// A department or a stream moved while a record takes it (lot I7a of 26.12.1). The move locks the
// row `FOR UPDATE` before it counts the records that carry it (`record-membership-moves.ts`); the
// record's foreign key takes `FOR KEY SHARE` on the same row. So the move waits for the record's
// transaction, counts it once committed, and is refused: no record ends with a department of another
// company or a stream of another category.

const noAudit = { log: async () => undefined };

async function departmentTakenWhileMoved() {
  await withRace('membership-move-department', async (race) => {
    const seeded = await race.seedWith(async (runner) => {
      const tenant = race.tenantId;
      const company = async (name: string) => (await runner.query(
        `INSERT INTO companies (tenant_id, name, country_iso, city, base_currency) VALUES ($1, $2, 'FR', 'Lyon', 'EUR') RETURNING id`,
        [tenant, name],
      ))[0].id as string;
      const alpha = await company('Alpha');
      const beta = await company('Beta');
      const [department] = await runner.query(`INSERT INTO departments (tenant_id, company_id, name) VALUES ($1, $2, 'Finance') RETURNING id`, [tenant, alpha]);
      const [role] = await runner.query(
        `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in) VALUES ($1, 'Race', 'Race', false, false) RETURNING id`,
        [tenant],
      );
      const [user] = await runner.query(
        `INSERT INTO users (tenant_id, email, role_id, status, company_id) VALUES ($1, 'race-move@example.invalid', $2, 'enabled', $3) RETURNING id`,
        [tenant, role.id, alpha],
      );
      return { alpha, beta, department: department.id as string, user: user.id as string };
    });
    const recordSide = await race.open('the person takes the department');
    const moveSide = await race.open('the department moves');
    const taken = race.gate(recordSide, { label: 'the person written', when: 'after', match: (text) => /^UPDATE users SET department_id/.test(text) });
    const record = race.start(recordSide, (manager) => manager.query(
      `UPDATE users SET department_id = $1 WHERE id = $2`, [seeded.department, seeded.user],
    ));
    assert.equal(await progress(record, { party: recordSide, gate: taken }), 'gated', 'harness: the person is written, not committed');
    const move = race.start(moveSide, (manager: EntityManager) => new DepartmentsService(
      manager.getRepository(Department), manager.getRepository(Company), noAudit as any,
    ).update(seeded.department, { company_id: seeded.beta } as any, undefined, { manager }));
    assert.equal(await progress(move, { party: moveSide }), 'blocked', 'the move waits for the person');
    taken.release();
    assert.equal((await settle(record)).ok, true, 'the person is saved');
    const moved = await settle(move);
    assert.equal(moved.ok ? 200 : httpStatus(moved.error), 400, 'the move is refused once the person is counted');
    assert.equal(moved.ok ? null : (moved.error as any).getResponse().code, 'DEPARTMENT_MOVE_IN_USE');
    const stored = await race.readOne(`SELECT company_id FROM departments WHERE id = $1`, [seeded.department]);
    assert.equal(stored.company_id, seeded.alpha, 'the department stays in its company');
  });
}

async function streamTakenWhileMoved() {
  await withRace('membership-move-stream', async (race) => {
    const seeded = await race.seedWith(async (runner) => {
      const tenant = race.tenantId;
      const [it] = await runner.query(`INSERT INTO portfolio_categories (tenant_id, name) VALUES ($1, 'IT') RETURNING id`, [tenant]);
      const [biz] = await runner.query(`INSERT INTO portfolio_categories (tenant_id, name) VALUES ($1, 'Business') RETURNING id`, [tenant]);
      const [ops] = await runner.query(`INSERT INTO portfolio_streams (tenant_id, category_id, name) VALUES ($1, $2, 'Ops') RETURNING id`, [tenant, it.id]);
      const [request] = await runner.query(
        `INSERT INTO portfolio_requests (tenant_id, item_number, name, status, category_id) VALUES ($1, 1, 'Request', 'pending_review', $2) RETURNING id`,
        [tenant, it.id],
      );
      return { it: it.id as string, biz: biz.id as string, ops: ops.id as string, request: request.id as string };
    });
    const recordSide = await race.open('the request takes the stream');
    const moveSide = await race.open('the stream moves');
    const taken = race.gate(recordSide, { label: 'the request written', when: 'after', match: (text) => /^UPDATE portfolio_requests SET stream_id/.test(text) });
    const record = race.start(recordSide, (manager) => manager.query(
      `UPDATE portfolio_requests SET stream_id = $1 WHERE id = $2`, [seeded.ops, seeded.request],
    ));
    assert.equal(await progress(record, { party: recordSide, gate: taken }), 'gated', 'harness: the request is written, not committed');
    const move = race.start(moveSide, (manager: EntityManager) => new PortfolioClassificationService(
      manager.getRepository(PortfolioSource), manager.getRepository(PortfolioCategory), manager.getRepository(PortfolioStream), manager.getRepository(PortfolioTaskType),
    ).updateStream(seeded.ops, race.tenantId, { category_id: seeded.biz }, { manager }));
    assert.equal(await progress(move, { party: moveSide }), 'blocked', 'the move waits for the request');
    taken.release();
    assert.equal((await settle(record)).ok, true, 'the request is saved');
    const moved = await settle(move);
    assert.equal(moved.ok ? 200 : httpStatus(moved.error), 400, 'the move is refused once the request is counted');
    const stored = await race.readOne(`SELECT category_id FROM portfolio_streams WHERE id = $1`, [seeded.ops]);
    assert.equal(stored.category_id, seeded.it, 'the stream stays in its category');
  });
}

void runRaceSpecs('record-membership-moves-race', [
  ['a department moved while a person takes it', departmentTakenWhileMoved],
  ['a stream moved while a request takes it', streamTakenWhileMoved],
]);
