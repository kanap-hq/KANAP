import * as assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { CsvLanguage } from '../../../common/csv-sheet';
import { buildBudgetExport, writeBudgetFile } from '../export-file';
import type { FileDimension } from '../load';
import { BudgetFileDetail, emptyMonths, StoredLine } from '../types';

// The CSV of the budget file, byte for byte, on a fixed set of lines: the export of every language
// and both details, written before the export learned xlsx (Excel export, lot 1, run B). The
// hashes were taken from the code of before that change; the CSV must never move.

function line(patch: Partial<StoredLine> = {}): StoredLine {
  return {
    id: 'line-1',
    nature: 'opex',
    itemNumber: 3,
    legacyNumber: 'OPX-3',
    rowVersion: 7,
    name: 'Widget',
    description: null,
    companyId: 'c1',
    companyName: 'Acme',
    supplierId: null,
    supplierName: null,
    supplierErpId: null,
    accountId: null,
    accountNumber: null,
    costCenterId: null,
    costCenterCode: null,
    costCenterPath: null,
    runBuild: null,
    analytics: {},
    ownerItEmail: null,
    ownerBusinessEmail: null,
    projectNumber: null,
    currency: 'EUR',
    effectiveStart: '2026-01-01',
    endOfValidity: null,
    notes: null,
    versions: [],
    ...patch,
  };
}

function version(year: number, budgetRev: number, cells: Partial<Record<'planned' | 'committed' | 'actual', Array<bigint | null>>>) {
  const months = emptyMonths();
  for (const [measure, values] of Object.entries(cells) as Array<['planned' | 'committed' | 'actual', Array<bigint | null>]>) {
    values.forEach((cents, index) => {
      months[measure][index] = { cents };
    });
  }
  return { id: `v-${year}`, year, budgetRev, months };
}

const GOLDEN_DIMENSIONS: FileDimension[] = [
  { code: 'default', appliesTo: null },
  { code: 'ppe_type', appliesTo: 'capex' },
];

/** Amounts of every shape (negative cents, zero, large, none), dates, codes with leading zeros, text a spreadsheet would read as a formula. */
const GOLDEN_LINES: StoredLine[] = [
  line({
    itemNumber: 12,
    name: 'Licences; "pro"',
    description: 'Two lines\nof text',
    supplierName: 'Café Ltd',
    supplierErpId: '00042',
    accountNumber: '01100',
    costCenterCode: '0042',
    costCenterPath: 'IT / Apps',
    runBuild: 'run',
    analytics: { default: 'Apps', ppe_type: 'Hardware' },
    ownerItEmail: 'ada@example.com',
    projectNumber: 9,
    effectiveStart: '2026-03-15',
    endOfValidity: '2027-06-30T22:30:00.000Z',
    notes: '=SUM(A1)',
    versions: [
      version(2026, 4, {
        planned: [-5n, 0n, 123456789n, null, null, null, null, null, null, null, null, 1n],
        committed: [0n, null, null, null, null, null, null, null, null, null, null, null],
      }),
      version(2027, 1, { actual: [null, -100n, null, null, null, null, null, null, null, null, null, null] }),
    ],
  }),
  line({
    id: 'line-2',
    nature: 'capex',
    itemNumber: 120,
    legacyNumber: 'CPX-4',
    name: '-12',
    currency: ' USD ',
    effectiveStart: '',
    analytics: { default: 'Infra', ppe_type: 'Servers' },
    versions: [version(2026, 2, { planned: [null, null, null, null, null, null, 1000000n, null, null, null, null, null] })],
  }),
  line({ id: 'line-3', itemNumber: 4, name: 'Empty', currency: '', endOfValidity: 'not a date', versions: [] }),
];

function goldenCsv(language: CsvLanguage, detail: BudgetFileDetail): string {
  const built = buildBudgetExport({
    language,
    years: [2026, 2027],
    columns: ['budget', 'revision', 'actual'],
    detail,
    lines: GOLDEN_LINES,
    dimensions: GOLDEN_DIMENSIONS,
  });
  // The code path of the routes: the file, its name and its type.
  const file = writeBudgetFile(built, language, 'csv');
  assert.equal(file.filename, 'budget.csv');
  assert.equal(file.contentType, 'text/csv; charset=utf-8');
  assert.equal(typeof file.content, 'string');
  return file.content as string;
}

const GOLDEN_SHA256: Record<string, string> = {
  'en yearly': 'b68aa0aacf7844278a8d57ec629bfb4225dcbd7ffe681c731a5bcaf26fdf53a7',
  'en months': '9470de108eee27c810d3dbfc54369823be5edafa5bc99cbc383aa0ce531700fe',
  'fr yearly': '9acee8b992f2525b737ee6828467141bda91f3ffe11a34bd2636687268b4343f',
  'fr months': 'a7f6ec3039ac1bed7bba15c55c8791a3c36032107a10aee89671bb92b22f1551',
  'de yearly': '01ead0c1fe4a2000722c13d97880c1d1c817ebcf2e6e1de48e08997924066e8d',
  'de months': '6bb3463a36d0f5ab57cb67e5340fdca8d05f829b75a8a0ae4db12a2d1de8c0e8',
  'es yearly': 'c959d1235d8e0f655ee23561ef72fd35e526dfaebc4587253308cceed3f23496',
  'es months': '9107fd1cacc60012b1727fff0a9faa41d24f97b0239a980954235e1415845b49',
};

/** The English yearly file in full, to read what the hashes hold. */
const EN_YEARLY = [
  '﻿nature,item_number,name,description,company_name,supplier_name,supplier_erp_id,account_number,cost_center_code,cost_center_path,run_build,analytics:default,analytics:ppe_type,owner_it_email,owner_business_email,project,currency,effective_start,end_of_validity,notes,budget_2026,revision_2026,actual_2026,budget_2027,revision_2027,actual_2027,kanap_token',
  'opex,BL-12,"Licences; ""pro""","Two lines',
  `of text",Acme,Café Ltd,00042,01100,0042,IT / Apps,run,Apps,,ada@example.com,,PRJ-9,EUR,2026-03-15,2027-06-30,'=SUM(A1),1234567.85,0.00,,,,-1.00,v7.2026r4.2027r1.en`,
  'capex,BL-120,-12,,Acme,,,,,,,Infra,Servers,,,,USD,,,,10000.00,,,,,,v7.2026r2.en',
  'opex,BL-4,Empty,,Acme,,,,,,,,,,,,,2026-01-01,,,,,,,,,v7.en',
  '',
].join('\n');

function run() {
  assert.equal(goldenCsv('en', 'yearly'), EN_YEARLY, 'the English yearly file');
  const seen: Record<string, string> = {};
  for (const language of ['en', 'fr', 'de', 'es'] as CsvLanguage[]) {
    for (const detail of ['yearly', 'months'] as BudgetFileDetail[]) {
      seen[`${language} ${detail}`] = createHash('sha256').update(goldenCsv(language, detail), 'utf8').digest('hex');
    }
  }
  assert.deepEqual(seen, GOLDEN_SHA256, 'the CSV of the budget file is unchanged, byte for byte');
  console.log('budget-file-csv-golden.spec: all assertions passed');
}

run();
