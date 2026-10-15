import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { AiMasterDataMutationSupportService } from '../mutation/ai-master-data-mutation-support.service';

// An AI mutation of an account follows the accounts' bound (`accounts/account-number.ts`): a
// whole number greater than zero, at most 15 digits, for the account number and the
// consolidation number. No database: the account fields need no lookup.

const service = Object.create(AiMasterDataMutationSupportService.prototype) as any;
const NUMBER_FIELD = { label: 'Account Number', kind: 'text', requiredOnCreate: true };
const CONSOLIDATION_FIELD = { label: 'Consolidation Account Number', kind: 'integer', nullable: true };

function normalize(fieldName: string, field: object, value: unknown) {
  return service.normalizeFieldValue({}, 'accounts', fieldName, field, value);
}

async function refusal(fn: () => Promise<unknown>): Promise<Error> {
  try {
    await fn();
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected a refusal');
}

async function main() {
  assert.deepEqual(await normalize('account_number', NUMBER_FIELD, '615630000012'), { value: '615630000012', displayValue: '615630000012' });
  assert.deepEqual(await normalize('account_number', NUMBER_FIELD, '06156'), { value: '6156', displayValue: '6156' }, 'leading zeros are dropped');
  assert.deepEqual(await normalize('consolidation_account_number', CONSOLIDATION_FIELD, 615630000012), { value: 615630000012, displayValue: '615630000012' });
  assert.deepEqual(await normalize('consolidation_account_number', CONSOLIDATION_FIELD, ''), { value: null, displayValue: null }, 'empty clears it');

  const rule = 'must be a whole number greater than zero, with at most 15 digits.';
  for (const [fieldName, field, value] of [
    ['account_number', NUMBER_FIELD, '6156300000123456'],
    ['account_number', NUMBER_FIELD, 'FR-PCG'],
    ['consolidation_account_number', CONSOLIDATION_FIELD, 6156300000123456],
    ['consolidation_account_number', CONSOLIDATION_FIELD, 0],
  ] as const) {
    const err = await refusal(() => normalize(fieldName, field, value));
    assert.ok(err instanceof BadRequestException, `${fieldName} ${value}`);
    assert.equal(err.message, `${field.label} ${rule}`);
  }
  console.log('ai-account-number-bound.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
