import * as assert from 'node:assert/strict';
import { assertLocaleLabels } from '../../common/report-export/__tests__/locale-labels';
import { writeReportExport } from '../../common/report-export';
import {
  CHARGEBACK_EXPORT_KEYS,
  CHARGEBACK_EXPORT_LABELS,
  chargebackMethodLabel,
  companyChargebackExport,
  globalChargebackExport,
  GlobalChargebackExportInput,
} from '../chargeback-report.export';
import type { CompanyChargebackReportResponse } from '../chargeback-report.service';

/**
 * The chargeback exports' tables from a report (the database spec compares them with the data routes):
 * the screens' words, cells by kind, the footers, the columns of a limited person's lines, the
 * parameters and the file names. Then the label table against `ops.json`.
 */

const kpi = (companyName: string, amount: number) => ({
  companyName, amount, headcount: 10, itUsers: null, turnover: 1_000_000, costVsTurnoverPct: 12.5, costPerUser: amount / 10, costPerItUser: null,
});

const global: GlobalChargebackExportInput = {
  year: 2026,
  scope: 'all',
  reportingCurrency: 'eur',
  detailedRows: [
    { rowType: 'company', companyId: 'fr', companyName: 'Alpha France', departmentId: null, departmentName: null, amount: 1000.5, amountRaw: 1000.5, share: 0.75, headcount: 10, costPerUser: 100.05 },
    { rowType: 'department', companyId: 'fr', companyName: 'Alpha France', departmentId: null, departmentName: null, amount: 600, amountRaw: 600, share: 0.45, headcount: 10, costPerUser: 60 },
    { rowType: 'department', companyId: 'fr', companyName: 'Alpha France', departmentId: 'd-gone', departmentName: null, amount: 400.5, amountRaw: 400.5, share: 0.3, headcount: null, costPerUser: null },
  ],
  companies: [{ companyName: 'Alpha France', amount: 1000.5, paid: 1334, net: -333.5, share: 0.75 }],
  nettedFlows: [{ payerId: 'fr', payerName: 'Alpha France', consumerId: 'x', consumerName: null, amount: 12.3 }],
  kpis: [kpi('Alpha France', 1000.5)],
  kpiTotals: { amount: 1000.5, headcount: 10, itUsers: 0, turnover: 0, costVsTurnoverPct: null, costPerUser: 100.05, costPerItUser: null },
};

function globalTables() {
  const exp = globalChargebackExport(global, { language: 'fr', columnName: 'Budget', limited: false });
  assert.equal(exp.fileBase, 'chargeback-global-all-2026');
  assert.deepEqual(exp.tables.map((table) => table.key), ['detailed', 'companies', 'flows', 'kpis']);
  const [detailed, companies, flows, kpis] = exp.tables;
  assert.deepEqual(detailed.columns.map((column) => column.header), ['Société', 'Département', 'Montant Budget', 'Part du total', 'Effectif', 'Coût par utilisateur']);
  assert.deepEqual(detailed.rows, [
    ['Alpha France', 'Total', { kind: 'amount', value: '1000.50' }, { kind: 'percent', value: 0.75 }, { kind: 'number', value: 10 }, { kind: 'amount', value: '100.05' }],
    ['Alpha France', 'Coûts communs', { kind: 'amount', value: '600.00' }, { kind: 'percent', value: 0.45 }, { kind: 'number', value: 10 }, { kind: 'amount', value: '60.00' }],
    ['Alpha France', 'Département inconnu', { kind: 'amount', value: '400.50' }, { kind: 'percent', value: 0.3 }, null, null],
  ], 'the company total row, common costs, a missing department; amounts to the cent');
  assert.deepEqual(companies.rows[0], ['Alpha France', { kind: 'amount', value: '1000.50' }, { kind: 'amount', value: '1334.00' }, { kind: 'amount', value: '-333.50' }, { kind: 'percent', value: 0.75 }]);
  assert.deepEqual(flows.rows, [['Alpha France', 'Société inconnue', { kind: 'amount', value: '12.30' }]], 'a nameless company');
  assert.deepEqual(kpis.columns.map((column) => column.header)[1], 'Budget', 'the KPI table names the column alone, as the screen');
  assert.deepEqual(kpis.rows[0][5], { kind: 'percent', value: 0.125 }, 'cost vs turnover: points to a fraction');
  assert.deepEqual(kpis.footer, [['Total', { kind: 'amount', value: '1000.50' }, { kind: 'number', value: 10 }, { kind: 'number', value: 0 }, null, null, { kind: 'amount', value: '100.05' }, null]]);
  assert.deepEqual(exp.parameters, [['Type de ligne', 'Tout'], ['Année', '2026'], ['Colonne', 'Budget'], ['Devise de reporting', 'EUR']]);

  // A limited person: the access line, no footer anywhere in the file.
  const limited = globalChargebackExport(global, { language: 'en', columnName: 'Budget', limited: true });
  const file = writeReportExport(limited, { format: 'csv', language: 'en', timeZone: 'UTC', table: 'kpis', generatedAt: new Date('2026-10-27T10:00:00Z'), generatedBy: 'A' });
  assert.equal(file.filename, 'chargeback-global-all-2026-kpis-2026-10-27.csv');
  assert.ok(!file.body.toString('utf8').includes('Total'), 'no totals row for a limited person');
  assert.equal(file.limited, true);
  // CSV with several tables needs `table`.
  assert.throws(
    () => writeReportExport(limited, { format: 'csv', language: 'en', timeZone: 'UTC', generatedAt: new Date(), generatedBy: 'A' }),
    (error: any) => error.getStatus?.() === 400 && /table is required/.test(error.message),
  );
  const xlsx = writeReportExport(limited, { format: 'xlsx', language: 'en', timeZone: 'UTC', generatedAt: new Date('2026-10-27T10:00:00Z'), generatedBy: 'A' });
  assert.equal(xlsx.filename, 'chargeback-global-all-2026-2026-10-27.xlsx');
  assert.equal(xlsx.rows, 3 + 1 + 1 + 1, 'every data row, no footer');
}

function companyReport(limited: boolean): CompanyChargebackReportResponse {
  return {
    year: 2026, metric: 'budget', scope: 'opex', total: 90, totalRaw: 90,
    company: { name: 'Beta Spain' } as any,
    departments: [
      { departmentId: 'd-fin', departmentName: 'Finance ES', amount: 40, amountRaw: 40, sharePct: 44.44, headcount: 4, costPerUser: 10 },
      { departmentId: null, departmentName: null, amount: 50, amountRaw: 50, sharePct: 55.56, headcount: null, costPerUser: null },
    ],
    items: [
      {
        versionId: null, itemId: null, itemNumber: 12, nature: 'opex', itemName: 'Hidden', itemLabel: 'BL-12 · Hidden', allocationMethod: 'manual_pct',
        amount: 40, amountRaw: 40, sharePct: 44.44,
        ...(limited ? { readable: false, payingCompanyId: 'fr', payingCompanyName: 'Alpha France', allocationPct: 40, departments: ['Finance ES', null] } : {}),
      },
      {
        versionId: 'v', itemId: 'i', itemNumber: 13, nature: 'opex', itemName: 'Own', itemLabel: 'Own', allocationMethod: 'default' as any,
        amount: 50, amountRaw: 50, sharePct: 55.56,
        ...(limited ? { readable: true, payingCompanyId: 'es', payingCompanyName: 'Beta Spain', allocationPct: 50, departments: [] } : {}),
      },
    ],
    itemsTotal: 90, itemsTotalRaw: 90, itemsTotalShare: 1,
    kpis: [{ companyId: 'es', amountRaw: 90, turnoverRaw: null, ...kpi('Beta Spain', 90) }],
    globalKpi: limited ? null : { amount: 700, amountRaw: 700, headcount: 30, itUsers: null, turnover: null, turnoverRaw: null, costPerUser: 23.33, costPerItUser: null, costVsTurnoverPct: null },
    ...(limited ? { dataAccessLimited: true as const, fxMissingHiddenLines: [] } : {}),
    intercompany: { receivables: [], payables: [] },
    intercompanyRows: [{ partnerId: 'fr', partnerName: 'Alpha France', receivables: 250, payables: 40, net: 210 }],
    intercompanyTotal: { receivables: 250, payables: 40, net: 210 },
    reportingCurrency: 'EUR',
    warnings: [],
  };
}

function companyTables() {
  const full = companyChargebackExport(companyReport(false), { language: 'en', columnName: 'Revision' });
  assert.equal(full.fileBase, 'chargeback-company-opex-2026', 'no company id in the file name');
  assert.equal(full.limited, false);
  assert.deepEqual(full.tables.map((table) => table.key), ['departments', 'items', 'intercompany', 'kpis']);
  const [departments, items, intercompany, kpis] = full.tables;
  assert.deepEqual(departments.rows.map((row) => [row[0], row[2]]), [['Finance ES', { kind: 'percent', value: 0.4444 }], ['Common costs', { kind: 'percent', value: 0.5556 }]]);
  assert.deepEqual(items.columns.map((column) => column.header), ['Line', 'Allocation method', 'Revision amount', 'Share of total']);
  assert.deepEqual(items.rows.map((row) => [row[0], row[1]]), [['BL-12 · Hidden', 'Manual percentages'], ['Own', 'Default']]);
  assert.deepEqual(items.footer, [['Total', null, { kind: 'amount', value: '90.00' }, { kind: 'percent', value: 1 }]]);
  assert.deepEqual(intercompany.footer, [['Total', { kind: 'amount', value: '250.00' }, { kind: 'amount', value: '40.00' }, { kind: 'amount', value: '210.00' }]]);
  assert.equal(kpis.footer?.[0][0], 'Global totals');
  assert.deepEqual(full.parameters, [['Line type', 'OPEX'], ['Year', '2026'], ['Column', 'Revision'], ['Company', 'Beta Spain'], ['Reporting currency', 'EUR']]);

  const limited = companyChargebackExport(companyReport(true), { language: 'en', columnName: 'Revision' });
  assert.equal(limited.limited, true, 'the report says the person is limited');
  const [, limitedItems, , limitedKpis] = limited.tables;
  assert.deepEqual(limitedItems.columns.map((column) => column.header), ['Line', 'Payer', 'Allocation method', 'Allocation', 'Department', 'Revision amount', 'Share of total']);
  assert.deepEqual(limitedItems.rows[0].slice(0, 5), ['BL-12 · Hidden', 'Alpha France', 'Manual percentages', { kind: 'percent', value: 0.4 }, 'Finance ES, Unknown department']);
  assert.deepEqual(limitedKpis.footer, [], 'no group total');
  const file = writeReportExport(limited, { format: 'csv', language: 'en', timeZone: 'UTC', table: 'intercompany', generatedAt: new Date(), generatedBy: 'A' });
  assert.ok(!file.body.toString('utf8').includes('Total'), 'no footer for a limited person');

  // No line, no partner: no total rows.
  const empty = companyChargebackExport({ ...companyReport(false), items: [], intercompanyRows: [], intercompanyTotal: null, kpis: [] }, { language: 'en', columnName: 'Budget' });
  assert.deepEqual(empty.tables.map((table) => table.footer ?? []), [[], [], [], []]);
}

function labels() {
  assertLocaleLabels('ops', CHARGEBACK_EXPORT_KEYS, CHARGEBACK_EXPORT_LABELS);
  assert.equal(chargebackMethodLabel(CHARGEBACK_EXPORT_LABELS.de, 'it_users'), 'IT-Benutzer');
  assert.equal(chargebackMethodLabel(CHARGEBACK_EXPORT_LABELS.de, 'something_new'), 'something_new', 'an unknown code as is, as the screen');
}

globalTables();
companyTables();
labels();
console.log('chargeback-report-export.spec: OK');
