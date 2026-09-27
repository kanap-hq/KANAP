import 'dotenv/config';
import * as assert from 'node:assert/strict';
import dataSource from '../../data-source';
import { CapexItemsService } from '../capex-items.service';
import {
  inRolledBackTransaction,
  repeat,
  seedItem,
  seedMonths,
  seedTenant,
  seedVersion,
} from '../../spend/__tests__/round-inputs.fixtures';

// CAPEX hides the years after an item's end of validity, as OPEX does: the
// year of the end keeps its amounts, later years contribute nothing to the
// summary slots (fixed and requested), the totals and the sort. Which items
// are listed does not change, and the item CSV export still writes what is
// stored (a masked 0 would clear that year on re-import).

const identityFx = {
  resolveRates: async () => ({ map: new Map(), settings: { reportingCurrency: 'EUR' } }),
  convertValue: (amount: number, rate: number) => amount * rate,
};
const noAllocations = { computeForVersions: async () => new Map() };

function capexItems(): {
  summary: (...args: any[]) => Promise<any>;
  summaryTotals: (...args: any[]) => Promise<any>;
  summaryIds: (...args: any[]) => Promise<any>;
  exportCsv: (...args: any[]) => Promise<any>;
} {
  const args: any[] = Array.from({ length: 12 }, () => undefined);
  args[4] = noAllocations;
  args[7] = identityFx;
  return new (CapexItemsService as any)(...args);
}

async function testYearsAfterTheEndContributeNothing() {
  await inRolledBackTransaction(async (runner) => {
    const Y = new Date().getFullYear();
    const tenantId = await seedTenant(runner, 'capex-mask');
    const lines: Record<'ending' | 'open', string> = { ending: '', open: '' };
    for (const [key, itemNumber, plusOne] of [['ending', 1, '50'], ['open', 2, '20']] as const) {
      const itemId = await seedItem(runner, 'capex', tenantId, itemNumber, `Mask ${key}`);
      const current = await seedVersion(runner, 'capex', tenantId, itemId, Y);
      await seedMonths(runner, 'capex', tenantId, current, Y, { planned: repeat('10', 12) });
      const next = await seedVersion(runner, 'capex', tenantId, itemId, Y + 1);
      await seedMonths(runner, 'capex', tenantId, next, Y + 1, { planned: repeat(plusOne, 12) });
      lines[key] = itemId;
    }
    // End of validity on the last day of Y (still valid today, so every list shows it).
    await runner.query(`UPDATE capex_items SET disabled_at = $2 WHERE id = $1`, [lines.ending, `${Y}-12-31T12:00:00Z`]);

    const svc = capexItems();
    const query = { includeDisabled: 'true' };
    const { items } = await svc.summary({ ...query, years: String(Y + 1) }, { manager: runner.manager });
    const byId = new Map(items.map((row: any) => [row.id, row]));
    const ending: any = byId.get(lines.ending);
    const open: any = byId.get(lines.open);
    assert.ok(ending && open, 'both lines are listed');
    assert.equal(ending.versions.y.totals.budget, 120, 'the year of the end keeps its amounts');
    const nothing = { budget: 0, revision: 0, forecast: 0, follow_up: 0, landing: 0 };
    assert.deepEqual(ending.versions.yPlus1.totals, nothing, 'fixed slot after the end: nothing');
    assert.equal(ending.versions.yPlus1.version_id, undefined);
    assert.deepEqual(ending.versions[`y${Y + 1}`].totals, nothing, 'requested slot after the end: nothing');
    assert.equal(open.versions.y.totals.budget, 120);
    assert.equal(open.versions.yPlus1.totals.budget, 240, 'without an end of validity both years count');
    assert.equal(open.versions[`y${Y + 1}`].totals.budget, 240);

    const totals = await svc.summaryTotals(query, { manager: runner.manager });
    assert.equal(totals.yBudget, 240, 'Y counts both lines');
    assert.equal(totals.yPlus1Budget, 240, 'Y+1 excludes the ended line');

    // Sort on the Y+1 budget: the ended line (600 stored, 0 shown) comes last.
    const ids = await svc.summaryIds({ ...query, sort: 'yPlus1Budget:DESC' }, { manager: runner.manager });
    assert.deepEqual(ids.ids, [lines.open, lines.ending], 'workspace navigation sorts on what is shown');
    const sorted = await svc.summary({ ...query, sort: 'yPlus1Budget:DESC' }, { manager: runner.manager });
    assert.deepEqual(sorted.items.map((row: any) => row.id), [lines.open, lines.ending], 'the list sorts on what is shown');

    // The item CSV export writes what is stored, as the OPEX export does.
    const { content } = await svc.exportCsv('data', { manager: runner.manager });
    const [header, ...rows] = content.replace(/^\ufeff/, '').trim().split('\n');
    const columns = header.split(';');
    const exported = rows
      .map((line: string) => Object.fromEntries(line.split(';').map((value, i) => [columns[i], value])))
      .find((row: Record<string, string>) => row.description === 'Mask ending');
    assert.equal(Number(exported?.y_plus1_budget), 600, 'the export keeps the stored Y+1 amounts');

    // The same line without an end of validity counts in both years.
    await runner.query(`UPDATE capex_items SET disabled_at = NULL WHERE id = $1`, [lines.ending]);
    const reopened = await svc.summaryTotals(query, { manager: runner.manager });
    assert.equal(reopened.yPlus1Budget, 840);
  });
}

async function main() {
  await dataSource.initialize();
  try {
    await testYearsAfterTheEndContributeNothing();
  } finally {
    await dataSource.destroy();
  }
  console.log('capex-end-of-validity-mask.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
