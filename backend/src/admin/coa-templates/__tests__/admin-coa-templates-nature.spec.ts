import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { AdminCoaTemplatesService } from '../admin-coa-templates.service';

// The platform admin's template accounts carry the `nature` column (lot N): a
// row edit keeps it, a create or an edit validates it, a payload without the
// column (older templates, older uploads) still reads and imports. The
// repository is an in-memory stand-in: no database.

const HEADER = 'account_number;account_name;native_name;description;consolidation_account_number;consolidation_account_name;consolidation_account_description;status';

function serviceWith(csvPayload: string) {
  const template: any = { id: 't1', template_code: 'TEST', version: '1.0', csv_payload: csvPayload };
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

async function testRowEditKeepsNature() {
  const { svc, template } = serviceWith(`﻿${HEADER};nature\n1000;Tangible;;;1000;;;enabled;capex\n2000;Licences;;;2000;;;enabled;opex\n`);
  const edited = await svc.updateAccount('t1', '1000', { account_name: 'Tangible assets' });
  assert.equal(edited.nature, 'capex', 'a row edit keeps the nature');
  assert.equal(edited.account_name, 'Tangible assets');
  assert.match(template.csv_payload, /^﻿account_number;.*;status;nature\n1000;Tangible assets;;;1000;;;enabled;capex\n2000;Licences;;;2000;;;enabled;opex$/);

  const cleared = await svc.updateAccount('t1', '2000', { nature: null });
  assert.equal(cleared.nature, null, 'null clears it');
  const set = await svc.updateAccount('t1', '2000', { nature: 'CAPEX' });
  assert.equal(set.nature, 'capex', 'the value is read lower case');

  const invalid = await refusal(() => svc.updateAccount('t1', '2000', { nature: 'both' }));
  assert.ok(invalid instanceof BadRequestException);
  assert.equal(invalid.message, "Invalid nature 'both'. Use 'opex', 'capex' or leave it empty.");
  const onCreate = await refusal(() => svc.createAccount('t1', { account_number: 3000, account_name: 'New', nature: 'x' }));
  assert.equal(onCreate.message, "Invalid nature 'x'. Use 'opex', 'capex' or leave it empty.");
  await svc.createAccount('t1', { account_number: 3000, account_name: 'New', nature: 'opex' });
  assert.equal((await svc.getAccount('t1', '3000')).nature, 'opex', 'a created account keeps its nature');
}

async function testPayloadWithoutNature() {
  const { svc, template } = serviceWith(`﻿${HEADER}\n1000;Tangible;;;1000;;;enabled\n`);
  assert.equal((await svc.getAccount('t1', '1000')).nature, null, 'no column: both');
  await svc.updateAccount('t1', '1000', { description: 'Edited' });
  assert.match(template.csv_payload, /;status;nature\n1000;Tangible;;Edited;1000;;;enabled;$/, 'the next write adds the column');
}

async function testImport() {
  const { svc } = serviceWith('');
  const without = await svc.importCsv('t1', upload(`${HEADER}\n1000;Tangible;;;1000;;;enabled\n`), true);
  assert.equal(without.ok, true, 'a file without nature imports');
  const valid = await svc.importCsv('t1', upload(`${HEADER};nature\n1000;Tangible;;;1000;;;enabled;capex\n2000;Other;;;2000;;;enabled;\n`), true);
  assert.equal(valid.ok, true, 'a file with nature imports');
  const invalid = await svc.importCsv('t1', upload(`${HEADER};nature\n1000;Tangible;;;1000;;;enabled;capex\n2000;Other;;;2000;;;enabled;both\n`), false);
  assert.equal(invalid.ok, false, 'an invalid nature is refused');
  assert.deepEqual(invalid.errors, [{ row: 3, message: "Invalid nature 'both'. Use 'opex', 'capex' or leave it empty." }]);
}

async function main() {
  await testRowEditKeepsNature();
  await testPayloadWithoutNature();
  await testImport();
  console.log('admin-coa-templates-nature.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
