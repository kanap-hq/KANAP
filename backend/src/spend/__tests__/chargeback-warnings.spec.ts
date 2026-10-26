import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { backendPath } from '../../common/__tests__/backend-root';
import { allocationFailureReason } from '../chargeback-report.service';
import { turnoverFxMissingAllMessage, type TurnoverFxMissingWarning } from '../allocation-distribution';

/** The calculator's English `error` becomes a code. A message this report does not know stays as text. */
function testKnownReasons() {
  assert.deepEqual(allocationFailureReason('Select at least one company for manual allocation.'), { code: 'select_company' });
  assert.deepEqual(allocationFailureReason('Select at least one department for manual allocation.'), { code: 'select_department' });
  assert.deepEqual(allocationFailureReason('No enabled companies for allocation distribution'), { code: 'no_enabled_companies' });
  assert.deepEqual(
    allocationFailureReason('No enabled companies for allocation distribution. Using last stored allocation.'),
    { code: 'no_enabled_companies' },
  );
  assert.deepEqual(allocationFailureReason('No enabled companies for distribution'), { code: 'no_enabled_companies' });
  assert.deepEqual(
    allocationFailureReason('Some departments could not be found for manual allocation.'),
    { code: 'departments_not_found' },
  );
  assert.deepEqual(
    allocationFailureReason('Provide headcount values for the selected departments.'),
    { code: 'provide_department_headcount' },
  );
  assert.deepEqual(
    allocationFailureReason('Allocation source values must sum to a positive amount.'),
    { code: 'driver_sum_zero' },
  );
  assert.deepEqual(
    allocationFailureReason('Some companies are not available for manual allocation.'),
    { code: 'companies_unavailable' },
  );
  assert.deepEqual(
    allocationFailureReason('No exchange rate from USD to EUR for 2026: the turnover of the selected companies cannot be compared. Enter the rate, or choose another allocation driver.'),
    { code: 'turnover_rate' },
  );
  assert.deepEqual(allocationFailureReason('Provide headcount values for the selected companies.'), { code: 'provide_driver', driver: 'headcount' });
  assert.deepEqual(allocationFailureReason('Provide it users values for the selected companies.'), { code: 'provide_driver', driver: 'it_users' });
  assert.deepEqual(allocationFailureReason('Provide turnover values for the selected companies.'), { code: 'provide_driver', driver: 'turnover' });
}

/** The "(used stored allocation)" suffix is the wrapper's job, not part of the reason. */
function testStoredSuffix() {
  assert.deepEqual(
    allocationFailureReason('Provide headcount values for the selected departments. (used stored allocation)'),
    { code: 'provide_department_headcount' },
  );
  assert.deepEqual(
    allocationFailureReason('Something new from the calculator. (used stored allocation)'),
    { code: 'text', text: 'Something new from the calculator.' },
  );
}

const CALCULATOR_SOURCES = [
  backendPath('src', 'spend', 'allocation-calculator.service.ts'),
  backendPath('src', 'spend', 'allocation-distribution.ts'),
];

function matches(source: string, re: RegExp): string[] {
  return Array.from(source.matchAll(re), (match) => match[1]);
}

/**
 * Every English sentence the calculator can store in `AllocationComputation.error` today.
 * A new `BadRequestException` or `error:` string in those files has to map to a code.
 * `text` stays the safety net for a message this report does not know yet.
 */
function testEveryCalculatorMessageHasACode() {
  const sources = CALCULATOR_SOURCES.map((file) => fs.readFileSync(file, 'utf8'));
  const [calculator] = sources;
  // `error: '...'` on a computation. The HTTP body field `error: 'Bad Request'` is not one.
  const literals = [
    ...sources.flatMap((source) => matches(source, /new BadRequestException\(\s*'([^']*)'/g)),
    ...matches(calculator, /error:\s*'([^']*)'/g),
  ];
  assert.ok(literals.length > 0, 'the calculator sources still name their errors');
  for (const text of literals) {
    const reason = allocationFailureReason(text);
    assert.notEqual(reason.code, 'text', `unmapped calculator message: ${text}`);
    const wrapped = allocationFailureReason(`${text} (used stored allocation)`);
    assert.notEqual(wrapped.code, 'text', `unmapped stored-allocation wrapper: ${text}`);
  }

  const provide = sources.flatMap((source) => matches(source, /new BadRequestException\(\s*`([^`]*)`/g));
  assert.deepEqual(provide, ['Provide ${driver.replace(\'_\', \' \')} values for the selected companies.']);
  for (const driver of ['headcount', 'it users', 'turnover']) {
    const reason = allocationFailureReason(`Provide ${driver} values for the selected companies.`);
    assert.equal(reason.code, 'provide_driver', driver);
  }

  const errorTemplates = sources.flatMap((source) => matches(source, /error:\s*`([^`]*)`/g));
  assert.deepEqual(errorTemplates, ['${err.message} (used stored allocation)']);

  const warning: TurnoverFxMissingWarning = {
    code: 'turnover_fx_missing',
    items: [
      { companyId: 'ny', companyName: 'New York', currency: 'USD', year: 2026 },
      { companyId: 'tokyo', companyName: 'Tokyo', currency: 'JPY', year: 2026 },
    ],
    reportingCurrency: 'EUR',
  };
  assert.equal(allocationFailureReason(turnoverFxMissingAllMessage(warning)).code, 'turnover_rate');
  assert.equal(allocationFailureReason('Anything the calculator has not said yet.').code, 'text');

  // Thrown, never stored in `error`, so the report never shows them through `code: 'text'`.
  const thrown = [
    'Allocations need a tenant.',
    'Allocations are computed for versions of one tenant only.',
    'The turnover method needs the turnovers in the reporting currency.',
    'Converting turnovers needs the exchange rates.',
  ];
  const joined = sources.join('\n');
  for (const text of thrown) {
    assert.ok(joined.includes(`InternalServerErrorException('${text}')`), `${text} is thrown, not stored`);
  }
}

function main() {
  testKnownReasons();
  testStoredSuffix();
  testEveryCalculatorMessageHasACode();
  console.log('chargeback-warnings.spec: ok');
}

main();
