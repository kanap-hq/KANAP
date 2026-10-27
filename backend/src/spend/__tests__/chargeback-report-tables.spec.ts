import * as assert from 'node:assert/strict';
import {
  chargebackIntercompanyRows,
  chargebackItemLabel,
  chargebackKpiTotals,
  globalChargebackDetailedRows,
  nettedChargebackFlows,
} from '../chargeback-report.tables';

/**
 * The tables of the chargeback reports (`chargeback-report.tables.ts`), the computations the two
 * screens made before: the detailed allocations (company total rows, then departments), the netted
 * flows, the indicators' totals, the intercompany rows and the label of a line the person cannot read.
 */

const dept = (companyId: string, companyName: string, departmentId: string | null, departmentName: string | null, amount: number, extra = {}) => ({
  companyId, companyName, departmentId, departmentName, amount, amountRaw: amount, headcount: null, costPerUser: null, ...extra,
});

function detailed() {
  const rows = globalChargebackDetailedRows(
    [
      dept('fr', 'Alpha France', 'd-it', 'IT', 300, { headcount: 3, costPerUser: 100 }),
      dept('es', 'Beta Spain', null, null, 200),
      dept('fr', 'Alpha France', null, null, 100),
      dept('fr', 'Alpha France', 'd-gone', null, 50),
      // A company the companies list does not name (its shares balance out): after the others.
      dept('zz', 'Zeta', 'd-z', 'Z', 0.5, { amountRaw: 0.6 }),
    ],
    [{ companyId: 'es', companyName: 'Beta Spain', amount: 500 }, { companyId: 'fr', companyName: 'Alpha France', amount: 450 }],
    [{ companyId: 'fr', amount: 450, headcount: 9, itUsers: null, turnover: null, costPerUser: 50 }],
    1000,
  );
  assert.deepEqual(
    rows.map((row) => [row.rowType, row.companyId, row.departmentId, row.amount, row.share]),
    [
      ['company', 'es', null, 500, 0.5],
      ['department', 'es', null, 200, 0.2],
      ['company', 'fr', null, 450, 0.45],
      ['department', 'fr', 'd-it', 300, 0.3],
      ['department', 'fr', null, 100, 0.1],
      ['department', 'fr', 'd-gone', 50, 0.05],
      ['company', 'zz', null, 0.5, 0.0005],
      ['department', 'zz', 'd-z', 0.5, 0.0005],
    ],
    'companies in the order of the companies list, each total row then its departments by amount; the share is a fraction',
  );
  const frTotal = rows[2];
  assert.deepEqual(
    { name: frTotal.companyName, departmentName: frTotal.departmentName, raw: frTotal.amountRaw, headcount: frTotal.headcount, perUser: frTotal.costPerUser },
    { name: 'Alpha France', departmentName: null, raw: 450, headcount: 9, perUser: 50 },
    'the total row: headcount and cost per user from the indicators, the raw amount summed',
  );
  assert.equal(rows[1].departmentName, null, 'common costs: no department, no name (the screen words it)');
  assert.deepEqual([rows[5].departmentId, rows[5].departmentName], ['d-gone', null], 'a missing department: its id, no name');
  assert.deepEqual([rows[3].headcount, rows[3].costPerUser], [3, 100], 'a department row keeps its own figures');
  assert.equal(rows[6].headcount, null, 'no indicator: no headcount on the total row');
  assert.equal(rows[6].amountRaw, 0.6);
  assert.ok(globalChargebackDetailedRows([dept('fr', 'A', null, null, 10)], [], [], 0)[0].share === null, 'no share without a positive total');
}

function flows() {
  const companies = [{ companyId: 'a', companyName: 'Alpha' }, { companyId: 'b', companyName: 'Beta' }];
  const rows = nettedChargebackFlows(
    [
      { payerId: 'a', payerName: 'Alpha', consumerId: 'b', consumerName: 'Beta', amount: 100 },
      { payerId: 'b', payerName: 'Beta', consumerId: 'a', consumerName: 'Alpha', amount: 30.1 },
      // b pays more for c than c for b: the net goes from b to c.
      { payerId: 'c', payerName: 'Gamma', consumerId: 'b', consumerName: 'Beta', amount: 20 },
      { payerId: 'b', payerName: 'Beta', consumerId: 'c', consumerName: 'Gamma', amount: 89.9 },
      // A pair that balances out.
      { payerId: 'a', payerName: 'Alpha', consumerId: 'd', consumerName: 'Delta', amount: 5 },
      { payerId: 'd', payerName: 'Delta', consumerId: 'a', consumerName: 'Alpha', amount: 5 },
      // A tie on the amount: by payer name.
      { payerId: 'e', payerName: 'Echo', consumerId: 'f', consumerName: '', amount: 10 },
      { payerId: 'g', payerName: 'Delta bis', consumerId: 'h', consumerName: 'Hotel', amount: 10 },
    ],
    companies,
  );
  assert.deepEqual(
    rows.map((row) => [row.payerName, row.consumerName, row.amount]),
    [['Alpha', 'Beta', 69.9], ['Beta', 'Gamma', 69.9], ['Delta bis', 'Hotel', 10], ['Echo', null, 10]],
    'one row per pair in the direction of the net, balanced pairs left out, largest first then by payer name; a nameless company is null',
  );
  assert.deepEqual(rows.map((row) => [row.payerId, row.consumerId]).slice(0, 2), [['a', 'b'], ['b', 'c']], 'net sign: the larger payer pays');
  assert.deepEqual(nettedChargebackFlows([], companies), []);
}

function kpiTotals() {
  // Paris 70,000 EUR; New York 35,000 USD = 31,500 EUR. A USD line: its raw amount is in USD.
  const totals = chargebackKpiTotals([
    { amount: 600, headcount: 10, itUsers: 5, turnover: 70000 },
    { amount: 600, headcount: 10, itUsers: 5, turnover: 31500 },
  ]);
  assert.ok(totals);
  assert.equal(totals.turnover, 101500, 'turnovers in the reporting currency, never the raw ones');
  assert.ok(Math.abs(totals.costVsTurnoverPct! - (1200 / 101500) * 100) < 1e-10, 'cost vs turnover of the totals, in points');
  assert.equal(totals.costPerUser, 60);
  assert.equal(totals.costPerItUser, 120);
  assert.deepEqual(
    chargebackKpiTotals([{ amount: 10, headcount: null, itUsers: null, turnover: null }]),
    { amount: 10, headcount: 0, itUsers: 0, turnover: 0, costVsTurnoverPct: null, costPerUser: null, costPerItUser: null },
    'no headcount, IT users or turnover: no ratio',
  );
  assert.equal(chargebackKpiTotals([]), null, 'no company: no totals row');
}

function intercompany() {
  const { rows, total } = chargebackIntercompanyRows(
    [
      { consumerId: 'b', consumerName: 'Beta', amount: 100 },
      { consumerId: 'c', consumerName: 'Gamma', amount: 40 },
      { consumerId: 'd', consumerName: 'Alpha', amount: 40 },
    ],
    [
      { payerId: 'b', payerName: 'Beta', amount: 30 },
      { payerId: 'e', payerName: '', amount: 25.5 },
    ],
  );
  assert.deepEqual(
    rows.map((row) => [row.partnerId, row.partnerName, row.receivables, row.payables, row.net]),
    [['b', 'Beta', 100, 30, 70], ['d', 'Alpha', 40, 0, 40], ['c', 'Gamma', 40, 0, 40], ['e', null, 0, 25.5, -25.5]],
    'merged per partner, net = receivables - payables, largest net first then by name',
  );
  assert.deepEqual(total, { receivables: 180, payables: 55.5, net: 124.5 }, 'the total row');
  assert.deepEqual(chargebackIntercompanyRows([], []), { rows: [], total: null }, 'no partner: no total row');
}

function itemLabels() {
  assert.equal(chargebackItemLabel({ itemName: 'Licences', itemNumber: 12 }), 'Licences', 'a line of a full report');
  assert.equal(chargebackItemLabel({ itemName: 'Licences', itemNumber: 12, readable: true }), 'Licences');
  assert.equal(chargebackItemLabel({ itemName: 'Licences', itemNumber: 12, readable: false }), 'BL-12 · Licences', 'a line the person cannot read');
  assert.equal(chargebackItemLabel({ itemName: 'Licences', itemNumber: null, readable: false }), 'Licences');
}

detailed();
flows();
kpiTotals();
intercompany();
itemLabels();
console.log('chargeback-report-tables.spec: OK');
