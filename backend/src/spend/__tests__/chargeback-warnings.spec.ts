import * as assert from 'node:assert/strict';
import { allocationFailureReason } from '../chargeback-report.service';

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

function main() {
  testKnownReasons();
  testStoredSuffix();
  console.log('chargeback-warnings.spec: ok');
}

main();
