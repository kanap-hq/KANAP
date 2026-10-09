import * as assert from 'node:assert/strict';
import { TEMPLATES } from '..';
import { AccountNature1853890000000 as AccountNature } from '../../../migrations/1853890000000-account-nature';
import { SeedCoaTemplates1826000000000 as SeedCoaTemplates } from '../../../migrations/1826000000000-seed-coa-templates';

// The `nature` column of the template files (lot N) is the one migration
// 1853890000000 derives from the consolidation account number: each file, its
// nature column removed then derived again, gives back exactly the file. The
// seed migration 1826000000000, which inserts the current files on a fresh
// database, accepts them (8 columns, or 9 with nature). No database.

async function testFilesMatchTheMigrationRule() {
  assert.equal(TEMPLATES.length, 20, 'the 20 template files');
  for (const template of TEMPLATES) {
    const label = `${template.template_code} ${template.version}`;
    assert.match(template.csv, /^﻿account_number;.*;status;nature\n/, `${label}: BOM, then nature last`);
    const stripped = await AccountNature.withoutNatureColumn(template.csv);
    assert.ok(stripped !== null, `${label}: the nature column is found`);
    assert.doesNotMatch(stripped, /nature/, `${label}: stripped`);
    assert.equal(await AccountNature.withNatureColumn(stripped), template.csv, `${label}: derived again, the file is unchanged`);
    assert.equal(await AccountNature.withNatureColumn(template.csv), null, `${label}: a payload with the column is left alone`);
  }
}

function testSeedValidatorAcceptsBoth() {
  const seed = new SeedCoaTemplates() as any;
  for (const template of TEMPLATES) {
    seed.validateCsv(template.template_code, template.version, template.csv);
  }
  const header8 = 'account_number;account_name;native_name;description;consolidation_account_number;consolidation_account_name;consolidation_account_description;status';
  seed.validateCsv('OLD', '1.0', `﻿${header8}\n1000;Tangible;;;1000;;;enabled\n`);
  assert.throws(
    () => seed.validateCsv('BAD', '1.0', `${header8};nature\n1000;Tangible;;;1000;;;enabled;both\n`),
    /nature "both" must be "opex", "capex" or empty/,
  );
  assert.throws(
    () => seed.validateCsv('BAD', '1.0', `${header8};kind\n1000;Tangible;;;1000;;;enabled;capex\n`),
    /Header\[8\] expected "nature", got "kind"/,
  );
  assert.throws(
    () => seed.validateCsv('BAD', '1.0', `${header8};nature\n1000;Tangible;;;1000;;;enabled\n`),
    /Expected 9 columns, got 8/,
  );
}

async function testRule() {
  const cases: Array<[string | null, string]> = [
    ['1000', 'capex'], ['1199', 'capex'], ['1200', ''], ['1999', ''], ['2000', 'opex'], ['2999', 'opex'],
    ['3000', ''], ['', ''], [null, ''], [' 1100 ', 'capex'], ['1100.5', ''], ['abc', ''],
  ];
  for (const [input, expected] of cases) assert.equal(AccountNature.natureOf(input), expected, `${input}`);
  // A row with more cells than the header cannot be placed.
  await assert.rejects(
    () => AccountNature.withNatureColumn('account_number;consolidation_account_number\n1;1000;extra\n'),
    /row 2 has 3 cells for 2 columns/,
  );
  // A short row is padded, a payload without the consolidation column gets empty natures.
  assert.equal(await AccountNature.withNatureColumn('a;consolidation_account_number;c\n1;2000\n'), 'a;consolidation_account_number;c;nature\n1;2000;;opex\n');
  assert.equal(await AccountNature.withNatureColumn('a;b\n1;2'), 'a;b;nature\n1;2;');
  assert.equal(await AccountNature.withNatureColumn(''), null, 'an empty payload is left alone');
}

async function main() {
  await testFilesMatchTheMigrationRule();
  testSeedValidatorAcceptsBoth();
  await testRule();
  console.log('template-nature.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
