import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { CompaniesController } from '../companies.controller';
import { CompaniesService } from '../companies.service';
import { COMPANY_YEAR_MESSAGE, companyYearPeriod, parseCompanyYear } from '../company-year';

// A partial year must be a 400 before any query. `Number("2")` is finite, and the
// end of that year is an invalid date (`new Date("2-12-31T23:59:59.999Z")`).

function messageOf(err: unknown): string {
  assert.ok(err instanceof BadRequestException);
  assert.equal(err.getStatus(), 400);
  const body = err.getResponse();
  return typeof body === 'string' ? body : String((body as { message?: string }).message);
}

function testParserAcceptsAFourDigitYear() {
  assert.equal(parseCompanyYear(undefined), undefined);
  assert.equal(parseCompanyYear(null), undefined);
  assert.equal(parseCompanyYear(''), undefined);
  assert.equal(parseCompanyYear('   '), undefined);
  assert.equal(parseCompanyYear('2026'), 2026);
  assert.equal(parseCompanyYear(2026), 2026);
  assert.equal(parseCompanyYear(' 2026 '), 2026);
  assert.equal(parseCompanyYear('1900'), 1900);
  assert.equal(parseCompanyYear('2999'), 2999);
  const period = companyYearPeriod(2026);
  assert.equal(Number.isNaN(period.start.getTime()), false);
  assert.equal(Number.isNaN(period.end.getTime()), false);
  assert.equal(period.end.toISOString().startsWith('2026-12-31'), true);
}

function testParserRejectsAPartialYear() {
  for (const raw of ['2', '20', '202', 2, '1899', '3000', '20261', '2e3', '2026.0', 'abcd', '02026']) {
    assert.throws(() => parseCompanyYear(raw), (err: unknown) => {
      assert.equal(messageOf(err), COMPANY_YEAR_MESSAGE, String(raw));
      return true;
    });
    if (typeof raw === 'number') {
      assert.throws(() => companyYearPeriod(raw), (err: unknown) => messageOf(err) === COMPANY_YEAR_MESSAGE);
    }
  }
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
      };
    },
  };
}

function service() {
  return new CompaniesService({} as never, {} as never, {} as never);
}

async function rejectsBeforeQuery(run: () => Promise<unknown>) {
  await assert.rejects(run, (err: unknown) => messageOf(err) === COMPANY_YEAR_MESSAGE);
}

async function testRoutesRejectPartialYearBeforeQuery() {
  const svc = service();
  const opts = { manager: closedManager() as never };
  await rejectsBeforeQuery(() => svc.list({ year: '2' }, opts));
  await rejectsBeforeQuery(() => svc.listIds({ year: '2' }, opts));
  await rejectsBeforeQuery(() => svc.totals({ year: '2' }, { ...opts, tenantId: 't1' }));
  await assert.rejects(
    () => svc.totals({}, { manager: closedManager() as never, tenantId: '' }),
    /tenant/,
  );

  const controller = new CompaniesController(
    { exportCsv: async () => { throw new Error('export ran'); }, importCsv: async () => { throw new Error('import ran'); } } as never,
    {} as never,
  );
  await rejectsBeforeQuery(() => controller.export('data', '2', undefined, {}, {} as never, {} as never));
  await rejectsBeforeQuery(() => controller.import({} as never, 'true', '2', undefined, undefined, undefined, {} as never));
}

async function testValidYearReachesTheQuery() {
  const svc = service();
  const opts = { manager: queryingManager() as never };
  await assert.rejects(() => svc.list({ year: '2026' }, opts), /query starts/);
  await assert.rejects(() => svc.list({}, opts), /query starts/);
  await assert.rejects(() => svc.listIds({ year: '2026' }, opts), /query starts/);
  await assert.rejects(() => svc.totals({ year: '2026' }, { ...opts, tenantId: 't1' }), /query starts/);
  await assert.rejects(() => svc.totals({}, { ...opts, tenantId: 't1' }), /query starts/);
}

async function main() {
  testParserAcceptsAFourDigitYear();
  testParserRejectsAPartialYear();
  await testRoutesRejectPartialYearBeforeQuery();
  await testValidYearReachesTheQuery();
  console.log('company-year.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
