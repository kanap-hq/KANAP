import * as assert from 'node:assert/strict';
import { ACCOUNT_EXPECTED_UNITS } from '../../accounts/account.entity';
import { EXPECTED_UNIT_LABELS } from '../../accounts/account-expected-units';
import { CreateMasterDataRecordAiMutationOperation } from '../mutation/operations/create-master-data-record.ai-mutation-operation';
import { UpdateMasterDataRecordAiMutationOperation } from '../mutation/operations/update-master-data-record.ai-mutation-operation';
import { accountsRegistry } from '../query/registries/accounts.registry';

// What Kad's account tools tell the model about the two settings of quantity and price entry. A
// request such as "set account 622200 on pieces" names a unit: it goes to `expected_units` (the
// card ticks the setting with it when it is off), never to the yes-or-no `quantity_price_expected`.
// - the write tools (create, update) declare `expected_units` with every unit's code and its word
//   in the four languages, say that naming a unit for an account is that field, and declare
//   `quantity_price_expected` as the yes-or-no setting, never a unit;
// - the read side's note on `quantity_price_expected` says the same.

function accountsLine(fields: readonly string[]): string {
  const line = fields.find((entry) => entry.startsWith('accounts:'));
  assert.ok(line, 'the tool declares the accounts fields');
  return line!;
}

function assertUnitsDeclared(text: string, who: string) {
  for (const unit of ACCOUNT_EXPECTED_UNITS) {
    assert.ok(text.includes(unit), `${who}: the code ${unit}`);
    for (const language of ['en', 'fr', 'de', 'es'] as const) {
      const word = EXPECTED_UNIT_LABELS[language][unit];
      assert.ok(text.includes(word), `${who}: the ${language} word of ${unit} (${word})`);
    }
  }
  assert.match(text, /quantity_price_expected \(the yes-or-no setting of quantity and price entry, never a unit\)/, `${who}: the setting is no unit`);
  assert.match(text, /naming a unit for an account \("on pieces"\) is expected_units/, `${who}: a unit named for an account is expected_units`);
  assert.match(text, /ticks quantity_price_expected in the same change when it is off/, `${who}: the setting ticked with the units`);
  assert.match(text, /flagged to check, never refused/, `${who}: an expectation, no obligation`);
}

function testWriteTools() {
  const update = new UpdateMasterDataRecordAiMutationOperation(undefined as any);
  const create = new CreateMasterDataRecordAiMutationOperation(undefined as any);
  assertUnitsDeclared(accountsLine(update.writePreview.fields), 'update_master_data_record');
  assertUnitsDeclared(accountsLine(create.writePreview.fields), 'create_master_data_record');
  console.log('ok - the write tools declare the units and the setting apart');
}

function testReadNote() {
  const note = String((accountsRegistry as any).fields.quantity_price_expected.description);
  assert.match(note, /never a unit/, 'the read side: the setting is no unit');
  assert.match(note, /flagged to check, never refused/, 'the read side: an expectation, no obligation');
  assert.match(note, /a unit named for an account \("on pieces"[^)]*\) is expected_units/, 'the read side: a unit named for an account is expected_units');
  console.log('ok - the read side says the setting is no unit');
}

function main() {
  const failures: string[] = [];
  for (const test of [testWriteTools, testReadNote]) {
    try {
      test();
    } catch (err) {
      console.error(err);
      failures.push(`${test.name}: ${(err as Error).message.split('\n')[0]}`);
    }
  }
  if (failures.length) {
    console.error(`ai-account-units-declaration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
  console.log('ai-account-units-declaration.spec: ok');
}

main();
