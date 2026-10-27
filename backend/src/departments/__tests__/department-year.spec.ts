import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { COMPANY_YEAR_MESSAGE } from '../../companies/company-year';
import { DepartmentMetricsController } from '../department-metrics.controller';
import { DepartmentMetricsService } from '../department-metrics.service';
import { DepartmentsService } from '../departments.service';

// A partial year must be a 400 before any query. `Number("2")` is finite, and the
// end of that year is an invalid date (`new Date("2-12-31T23:59:59.999Z")`).

const REJECTED = ['2', '20', '202', 'abcd', '12345', '1899', '3000', '2e3', '2026.0', '02026'];

function messageOf(err: unknown): string {
  assert.ok(err instanceof BadRequestException);
  assert.equal(err.getStatus(), 400);
  const body = err.getResponse();
  return typeof body === 'string' ? body : String((body as { message?: string }).message);
}

/** A manager that fails the test if a method reaches the database. */
function closedManager() {
  return new Proxy({}, {
    get() {
      throw new Error('year rejected after a database call');
    },
  });
}

/** A manager whose first query proves the year was accepted. */
function queryingManager() {
  return {
    getRepository() {
      return {
        createQueryBuilder() {
          throw new Error('query starts');
        },
        findOne() {
          throw new Error('query starts');
        },
      };
    },
  };
}

function departments() {
  return new DepartmentsService({} as never, {} as never, {} as never);
}

function metrics(freezeRuns = false) {
  return new DepartmentMetricsService({} as never, {} as never, {
    assertNotFrozen: async () => {
      if (!freezeRuns) throw new Error('freeze ran');
    },
  } as never);
}

function metricsController() {
  return new DepartmentMetricsController({
    getForDepartment: async () => { throw new Error('metrics ran'); },
    upsertForDepartment: async () => { throw new Error('metrics ran'); },
  } as never);
}

async function rejectsYear(run: () => Promise<unknown>) {
  await assert.rejects(run, (err: unknown) => messageOf(err) === COMPANY_YEAR_MESSAGE);
}

async function testListRejectsPartialYearBeforeQuery() {
  const svc = departments();
  const opts = { manager: closedManager() as never };
  for (const year of REJECTED) {
    await rejectsYear(() => svc.list({ year }, opts));
    await rejectsYear(() => svc.listIds({ year }, opts));
  }
}

async function testListAcceptsAFourDigitYear() {
  const svc = departments();
  const opts = { manager: queryingManager() as never };
  await assert.rejects(() => svc.list({ year: '2026' }, opts), /query starts/);
  await assert.rejects(() => svc.list({}, opts), /query starts/);
  await assert.rejects(() => svc.listIds({ year: '2026' }, opts), /query starts/);
  await assert.rejects(() => svc.listIds({}, opts), /query starts/);
}

async function testMetricsEndpointsRejectPartialYear() {
  const controller = metricsController();
  for (const year of REJECTED) {
    await rejectsYear(() => controller.get('dep-1', year, {}));
    await rejectsYear(() => controller.upsert('dep-1', year, { headcount: 1 }, {}));
  }
  await assert.rejects(
    () => controller.get('dep-1', undefined as unknown as string, {}),
    (err: unknown) => messageOf(err) === 'year is required',
  );
  await assert.rejects(() => controller.get('dep-1', '2026', {}), /metrics ran/);
  await assert.rejects(() => controller.upsert('dep-1', '2026', { headcount: 4 }, {}), /metrics ran/);
}

async function testMetricsServiceRejectsAnyIntegerOutsideTheBounds() {
  const svc = metrics();
  const opts = { manager: closedManager() as never };
  for (const year of [2, 1899, 3000, 12345]) {
    await rejectsYear(() => svc.getForDepartment('dep-1', year, opts));
    await rejectsYear(() => svc.upsertForDepartment('dep-1', year, { headcount: 1 }, undefined, opts));
  }
  await assert.rejects(
    () => svc.getForDepartment('dep-1', Number.NaN, opts),
    (err: unknown) => messageOf(err) === 'year is required',
  );
  await assert.rejects(
    () => svc.upsertForDepartment('dep-1', 2026, { headcount: -1 }, undefined, opts),
    (err: unknown) => messageOf(err) === 'headcount is required and must be a non-negative integer',
  );

  const open = metrics(true);
  const query = { manager: queryingManager() as never };
  await assert.rejects(() => open.getForDepartment('dep-1', 2026, query), /query starts/);
  await assert.rejects(
    () => open.upsertForDepartment('dep-1', 2026, { headcount: 4 }, 'user', query),
    /query starts/,
  );
}

async function main() {
  await testListRejectsPartialYearBeforeQuery();
  await testListAcceptsAFourDigitYear();
  await testMetricsEndpointsRejectPartialYear();
  await testMetricsServiceRejectsAnyIntegerOutsideTheBounds();
  console.log('department-year.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
