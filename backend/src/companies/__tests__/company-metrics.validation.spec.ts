import * as assert from 'node:assert/strict';
import { CompanyMetricsService } from '../company-metrics.service';

// Validation of company metrics answers with a code the interface translates.
// The English `message` stays the sentence API clients already match.

function service() {
  const repo = {
    findOne: async () => null,
    create: (row: Record<string, unknown>) => row,
    save: async (row: Record<string, unknown>) => ({ id: 'm1', ...row }),
    manager: {},
  };
  return new CompanyMetricsService(
    repo as never,
    { log: async () => undefined } as never,
    { assertNotFrozen: async () => undefined } as never,
  );
}

function expectCoded(err: unknown, code: string, message: string) {
  const error = err as { message?: string; getResponse?: () => { code?: string } };
  const body = typeof error.getResponse === 'function' ? error.getResponse() : {};
  assert.equal(error.message, message);
  assert.equal(body.code, code);
  return true;
}

async function testYearIsRequired() {
  const metrics = service();
  await assert.rejects(
    () => metrics.list(Number.NaN),
    (err) => expectCoded(err, 'COMPANY_METRIC_YEAR_REQUIRED', 'year is required'),
  );
  await assert.rejects(
    () => metrics.upsertForCompany('c1', 1.5, { headcount: 1 }),
    (err) => expectCoded(err, 'COMPANY_METRIC_YEAR_REQUIRED', 'year is required'),
  );
}

async function testHeadcountItUsersAndTurnover() {
  const metrics = service();
  await assert.rejects(
    () => metrics.upsertForCompany('c1', 2026, {}),
    (err) => expectCoded(err, 'COMPANY_METRIC_HEADCOUNT_INVALID', 'headcount is required and must be a non-negative integer'),
  );
  await assert.rejects(
    () => metrics.upsertForCompany('c1', 2026, { headcount: -1 }),
    (err) => expectCoded(err, 'COMPANY_METRIC_HEADCOUNT_INVALID', 'headcount is required and must be a non-negative integer'),
  );
  await assert.rejects(
    () => metrics.upsertForCompany('c1', 2026, { headcount: 1.5 }),
    (err) => expectCoded(err, 'COMPANY_METRIC_HEADCOUNT_INVALID', 'headcount is required and must be a non-negative integer'),
  );
  await assert.rejects(
    () => metrics.upsertForCompany('c1', 2026, { headcount: 3, it_users: -2 }),
    (err) => expectCoded(err, 'COMPANY_METRIC_IT_USERS_INVALID', 'it_users must be a non-negative integer'),
  );
  await assert.rejects(
    () => metrics.upsertForCompany('c1', 2026, { headcount: 3, turnover: -1 }),
    (err) => expectCoded(err, 'COMPANY_METRIC_TURNOVER_INVALID', 'turnover must be a non-negative number'),
  );
  await assert.rejects(
    () => metrics.upsertForCompany('c1', 2026, { headcount: 3, turnover: '1.2345' }),
    (err) => expectCoded(err, 'COMPANY_METRIC_TURNOVER_DECIMALS', 'turnover allows at most 3 decimals'),
  );
}

async function main() {
  await testYearIsRequired();
  await testHeadcountItUsersAndTurnover();
  console.log('company-metrics.validation.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
