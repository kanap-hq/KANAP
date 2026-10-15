import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { AdminCoaTemplatesService } from '../admin-coa-templates.service';

// Template account numbers follow the accounts' bound: whole numbers greater than zero, at most
// 15 digits (`accounts/account-number.ts`). A row create or edit refuses a longer one, the CSV
// import reports it on its row, a 12-digit number reads back exactly. The repository is an
// in-memory stand-in: no database.

const HEADER = 'account_number;account_name;native_name;description;consolidation_account_number;consolidation_account_name;consolidation_account_description;status;nature';
const RULE = 'must be a whole number greater than zero, with at most 15 digits';

function serviceWith(csvPayload: string) {
  const template: any = { id: 't1', template_code: 'FR-PCG', version: '1.0', csv_payload: csvPayload };
  const repo: any = {
    manager: {},
    findOne: async () => template,
    save: async (entity: any) => Object.assign(template, entity),
  };
  const audit: any = { log: async () => undefined };
  return { svc: new AdminCoaTemplatesService(repo, audit), template };
}

function upload(content: string): Express.Multer.File {
  return { buffer: Buffer.from(content, 'utf8') } as Express.Multer.File;
}

async function refusal(fn: () => Promise<unknown>): Promise<Error> {
  try {
    await fn();
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected a refusal');
}

async function testRowCreateAndEdit() {
  const { svc } = serviceWith(`﻿${HEADER}\n6156100;Maintenance;;;6156;;;enabled;opex\n`);
  await svc.createAccount('t1', { account_number: '615630000012', account_name: 'Long number', consolidation_account_number: 615630000012 });
  const created = await svc.getAccount('t1', '615630000012');
  assert.equal(created.account_number, 615630000012, 'a 12-digit number reads back exactly');
  assert.equal(created.consolidation_account_number, 615630000012);

  const tooLong = await refusal(() => svc.createAccount('t1', { account_number: '6156300000123456', account_name: 'Too long' }));
  assert.ok(tooLong instanceof BadRequestException);
  assert.equal(tooLong.message, `account_number ${RULE}`);
  const zero = await refusal(() => svc.createAccount('t1', { account_number: 0, account_name: 'Zero' }));
  assert.equal(zero.message, `account_number ${RULE}`);
  const consolidation = await refusal(() => svc.updateAccount('t1', '6156100', { consolidation_account_number: '6156300000123456' }));
  assert.equal(consolidation.message, `consolidation_account_number ${RULE}`);
}

async function testImport() {
  const { svc } = serviceWith(`﻿${HEADER}\n`);
  const ok = await svc.importCsv('t1', upload(`${HEADER}\n615630000012;Long number;;;615630000012;;;enabled;\n6156100;Maintenance;;;;;;enabled;\n`), true);
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));

  const refused = await svc.importCsv('t1', upload(`${HEADER}\n6156300000123456;Too long;;;6156;;;enabled;\nabc;Not a number;;;6156300000123456;;;enabled;\n`), true);
  assert.equal(refused.ok, false);
  assert.deepEqual(refused.errors, [
    {
      row: 2, column: 'account_number', code: 'CSV_ACCOUNT_NUMBER_TOO_LONG', params: { value: '6156300000123456', max: 15 },
      message: "account_number '6156300000123456' has more than 15 digits. Use at most 15 digits.",
    },
    { row: 3, column: 'account_number', message: `account_number ${RULE}` },
    {
      row: 3, column: 'consolidation_account_number', code: 'CSV_ACCOUNT_NUMBER_TOO_LONG', params: { value: '6156300000123456', max: 15 },
      message: "consolidation_account_number '6156300000123456' has more than 15 digits. Use at most 15 digits.",
    },
  ]);
}

async function main() {
  const failures: string[] = [];
  for (const test of [testRowCreateAndEdit, testImport]) {
    try {
      await test();
    } catch (err) {
      failures.push(`${test.name}: ${(err as Error).message.split('\n')[0]}`);
    }
  }
  if (failures.length) {
    throw new Error(`admin-coa-templates-account-number.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('admin-coa-templates-account-number.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
