import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { ContractsService } from '../contracts.service';
import { addDaysYmd, addMonthsYmd } from '../contract-terms';
import { FxRateService } from '../../currency/fx-rate.service';
import { CurrencySettingsService } from '../../currency/currency-settings.service';
import { CurrencyRateSet } from '../../currency/currency-rate-set.entity';
import { Tenant } from '../../tenants/tenant.entity';
import { utcDateYmd } from '../../notifications/expiry-reminder-schedule';
import { seedCompany } from '../../spend/__tests__/cost-center.fixtures';
import { assert, inRolledBackTransaction, runSpecs, seedItem, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';

// The contract list (lot CL): the next due date and the state come from contract-terms.ts, the
// list sorts on the next due date by default (ended contracts last), filters on the state, and
// its footer sums the yearly amounts in the reporting currency with this year's rates, naming
// the contracts in a currency without a rate. Everything is seeded relative to today, on an
// empty database.

const TODAY = utcDateYmd(new Date());
const YEAR = Number(TODAY.slice(0, 4));

type Seeded = { tenantId: string; ids: Record<string, string> };

async function seed(runner: QueryRunner): Promise<Seeded> {
  const tenantId = await seedTenant(runner, 'contract-list');
  const { companyId } = await seedCompany(runner, tenantId, 'Contract list company');
  const [supplier] = await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Contract list supplier') RETURNING id`, [tenantId]);
  // This year's rates: USD has one, GBP none. EUR is the reporting currency (tenant default).
  await runner.query(
    `INSERT INTO currency_rate_sets (tenant_id, fiscal_year, base_currency, rates) VALUES ($1, $2, 'EUR', $3::jsonb)`,
    [tenantId, YEAR, JSON.stringify({ USD: 0.9 })],
  );
  const contract = async (
    name: string,
    start: string,
    months: number,
    notice: number,
    renewal: boolean,
    amount: number,
    currency: string,
    disabledAt: string | null = null,
  ) => {
    const [row] = await runner.query(
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, duration_months, notice_period_months,
                              auto_renewal, yearly_amount_at_signature, currency, disabled_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [tenantId, name, companyId, supplier.id, start, months, notice, renewal, amount, currency, disabledAt, disabledAt ? 'disabled' : 'enabled'],
    );
    return row.id as string;
  };
  const ids: Record<string, string> = {};
  // Deadline about a month away: to decide.
  ids.decide = await contract('Decide soon', addDaysYmd(addMonthsYmd(TODAY, -12), 60), 12, 1, true, 1000, 'USD');
  // Deadline in more than two years: in progress.
  ids.progress = await contract('In progress', addMonthsYmd(TODAY, -6), 36, 3, true, 2000, 'EUR');
  // The current term's deadline passed two months ago, the term ends in a month: renewed.
  ids.renewed = await contract('Renewed', addMonthsYmd(TODAY, -11), 12, 3, true, 3000, 'EUR');
  // No renewal, ends in a year and a half.
  ids.ending = await contract('Ending', addMonthsYmd(TODAY, -6), 24, 3, false, 4000, 'GBP');
  // No renewal, ended a year ago, no end of validity: still listed as active.
  ids.expired = await contract('Expired', addMonthsYmd(TODAY, -24), 12, 1, false, 500, 'EUR');
  // Past its end of validity: out of the default scope.
  ids.disabled = await contract('Disabled', addMonthsYmd(TODAY, -6), 12, 1, true, 99999, 'EUR', '2020-01-01T12:00:00Z');

  // One OPEX and one CAPEX line linked to the first contract: the list counts both.
  const opex = await seedItem(runner, 'opex', tenantId, 1, 'Linked OPEX');
  const capex = await seedItem(runner, 'capex', tenantId, 2, 'Linked CAPEX');
  for (const line of [opex, capex]) {
    await runner.query(`INSERT INTO contract_spend_items (tenant_id, contract_id, spend_item_id) VALUES ($1, $2, $3)`, [tenantId, ids.decide, line]);
  }
  return { tenantId, ids };
}

function service(runner: QueryRunner): ContractsService {
  const audit = { log: async () => undefined };
  const settings = new CurrencySettingsService(runner.manager.getRepository(Tenant), audit as any);
  const fx = new FxRateService(runner.manager.getRepository(CurrencyRateSet), settings);
  const args: any[] = Array.from({ length: 10 }, () => undefined);
  args[4] = audit;
  args[9] = fx;
  return new (ContractsService as any)(...args);
}

const stateFilter = (...values: string[]) => JSON.stringify({ term_state: { filterType: 'set', values } });

async function testStatesAndDefaultSort() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, ids } = await seed(runner);
    await setTenant(runner, tenantId);
    const svc = service(runner);
    const opts = { manager: runner.manager };
    const nameOf = new Map(Object.entries(ids).map(([key, id]) => [id, key]));

    const page = await svc.list({}, opts);
    const rows = page.items as any[];
    assert.deepEqual(
      rows.map((r) => nameOf.get(r.id)),
      ['decide', 'renewed', 'ending', 'progress', 'expired'],
      'default order: next due date ascending, the ended contract last',
    );
    const byKey: Record<string, any> = Object.fromEntries(rows.map((r) => [nameOf.get(r.id), r]));
    assert.deepEqual(
      Object.fromEntries(Object.entries(byKey).map(([key, r]) => [key, r.term_state])),
      { decide: 'to_decide', renewed: 'renewed', ending: 'ending', progress: 'in_progress', expired: 'expired' },
      'states',
    );
    assert.equal(byKey.decide.next_due_date, byKey.decide.next_cancellation_deadline, 'a renewing contract is due on its next deadline');
    assert.equal(byKey.ending.next_due_date, byKey.ending.current_term_end, 'a contract without renewal is due at its end');
    assert.equal(byKey.expired.next_due_date, null, 'an ended contract has no next due date');
    assert.equal(byKey.decide.linked_lines_count, 2, 'linked lines of both natures');
    assert.equal(byKey.progress.linked_lines_count, 0);

    const desc = await svc.list({ sort: 'next_due_date:DESC' }, opts);
    assert.deepEqual(
      (desc.items as any[]).map((r) => nameOf.get(r.id)),
      ['progress', 'ending', 'renewed', 'decide', 'expired'],
      'descending: the ended contract stays last',
    );
    const { ids: orderedIds } = await svc.listIds({}, opts);
    assert.deepEqual(orderedIds.map((id) => nameOf.get(id)), ['decide', 'renewed', 'ending', 'progress', 'expired'], 'ids follow the default order');

    // A sort field the list does not know falls back to the default order.
    const unknown = await svc.list({ sort: 'nope:DESC' }, opts);
    assert.deepEqual((unknown.items as any[]).map((r) => nameOf.get(r.id)), ['decide', 'renewed', 'ending', 'progress', 'expired'], 'unknown sort');
  });
}

async function testStateFilter() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, ids } = await seed(runner);
    await setTenant(runner, tenantId);
    const svc = service(runner);
    const opts = { manager: runner.manager };

    const decide = await svc.list({ filters: stateFilter('to_decide') }, opts);
    assert.deepEqual((decide.items as any[]).map((r) => r.id), [ids.decide], 'to decide');
    assert.equal(decide.total, 1);
    const ended = await svc.list({ filters: stateFilter('ending', 'expired') }, opts);
    assert.deepEqual((ended.items as any[]).map((r) => r.id).sort(), [ids.ending, ids.expired].sort(), 'ending or expired');
    const { ids: filteredIds } = await svc.listIds({ filters: stateFilter('renewed') }, opts);
    assert.deepEqual(filteredIds, [ids.renewed], 'ids: renewed');
    // The contract past its end of validity joins once every status is shown.
    const all = await svc.list({ includeDisabled: '1' }, opts);
    assert.equal(all.total, 6, 'every status');
  });
}

async function testTotals() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId } = await seed(runner);
    await setTenant(runner, tenantId);
    const svc = service(runner);
    const opts = { manager: runner.manager, tenantId };

    const totals = await svc.totals({}, opts);
    assert.deepEqual(
      totals,
      {
        count: 5,
        // 1000 USD × 0.9 + 2000 + 3000 + 500 EUR; the GBP contract has no rate.
        yearly_amount: 6400,
        reporting_currency: 'EUR',
        fx_year: YEAR,
        excluded: [{ currency: 'GBP', count: 1 }],
        to_decide_count: 1,
      },
      'default scope',
    );

    const decide = await svc.totals({ filters: stateFilter('to_decide') }, opts);
    assert.equal(decide.count, 1, 'to decide: one contract');
    assert.equal(decide.yearly_amount, 900, 'to decide: converted from USD');
    assert.deepEqual(decide.excluded, [], 'to decide: nothing left out');
    assert.equal(decide.to_decide_count, 1, 'the quick filter count ignores the state filter');

    const ended = await svc.totals({ filters: stateFilter('ending', 'expired') }, opts);
    assert.equal(ended.count, 2);
    assert.equal(ended.yearly_amount, 500);
    assert.deepEqual(ended.excluded, [{ currency: 'GBP', count: 1 }]);
    assert.equal(ended.to_decide_count, 1, 'still counts the contracts to decide');

    const searched = await svc.totals({ q: 'Renewed' }, opts);
    assert.deepEqual([searched.count, searched.yearly_amount, searched.to_decide_count], [1, 3000, 0], 'quick search');

    const all = await svc.totals({ includeDisabled: '1' }, opts);
    assert.equal(all.count, 6, 'every status');
    assert.equal(all.yearly_amount, 6400 + 99999);

    // Without any rate set this year, only the reporting currency adds up.
    await runner.query(`DELETE FROM currency_rate_sets WHERE tenant_id = $1`, [tenantId]);
    const noRates = await svc.totals({}, opts);
    assert.equal(noRates.yearly_amount, 5500, 'no rate set: EUR only');
    assert.deepEqual(noRates.excluded, [{ currency: 'GBP', count: 1 }, { currency: 'USD', count: 1 }]);
  });
}

void runSpecs('contract-list-terms.integration.spec', [
  ['testStatesAndDefaultSort', testStatesAndDefaultSort],
  ['testStateFilter', testStateFilter],
  ['testTotals', testTotals],
]);

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
