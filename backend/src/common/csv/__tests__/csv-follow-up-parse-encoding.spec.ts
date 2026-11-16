/**
 * The imports that read the file a second time, after CsvImportService, for the
 * columns it leaves to them (application owners and data residency), read
 * Windows-1252 as the first pass does. A file Excel saved as plain CSV must not
 * pass the check and then fail on the second read. (The task viewers and owners
 * are written by the import itself since lot I3 of 26.11.9.)
 */
import * as assert from 'node:assert/strict';
import { ApplicationsCsvService } from '../../../applications/applications-csv.service';

const TENANT = 't1';

function windows1252File(content: string): Express.Multer.File {
  // latin1 matches Windows-1252 for "é".
  return { buffer: Buffer.from(content, 'latin1') } as Express.Multer.File;
}

function recordingManager() {
  const params: unknown[][] = [];
  return {
    params,
    query: async (_sql: string, values: unknown[] = []) => {
      params.push(values);
      return [];
    },
  } as any;
}

async function testApplicationPassesReadWindows1252() {
  const svc = new (ApplicationsCsvService as any)(null, null, null, null, null, null, null);
  const owners = recordingManager();
  await svc.handleOwnerImport(
    windows1252File('name;business_owner_email_1\r\nRefonte CRM é;\r\n'),
    'enrich',
    new Set<string>(),
    { manager: owners, tenantId: TENANT },
  );
  assert.ok(owners.params.some((values: unknown[]) => values.includes('Refonte CRM é')), JSON.stringify(owners.params));

  const residency = recordingManager();
  await svc.handleDataResidencyImport(
    windows1252File('name;data_residency\r\nRefonte CRM é;FR\r\n'),
    'enrich',
    new Set<string>(),
    { manager: residency, tenantId: TENANT },
  );
  assert.ok(residency.params.some((values: unknown[]) => values.includes('Refonte CRM é')), JSON.stringify(residency.params));
}

(async () => {
  await testApplicationPassesReadWindows1252();
  console.log('CSV follow-up parse encoding tests passed.');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
