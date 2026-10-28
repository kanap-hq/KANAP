import 'dotenv/config';
import * as assert from 'node:assert/strict';
import type { QueryRunner } from 'typeorm';
import { inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { Application } from '../application.entity';
import { ApplicationsListService } from '../services/applications-list.service';
import { adaptFilters } from '../../ai/query/ai-filter.adapter';
import { applicationsRegistry } from '../../ai/query/registries/applications.registry';

// CA3 (Plaid L5 lot 2): an application's version, go-live date, end of support date and
// retirement date filter, sort and read on the Applications list, which is the path both the
// screen and Plaid use. The dates filter by day, the version as text; end of support groups by
// year. The existing filters keep their behaviour.

type Ctx = { runner: QueryRunner; tenantId: string; list: ApplicationsListService; apps: Record<'a' | 'b' | 'c', string>; dates: Record<string, string> };

const opts = (ctx: { runner: QueryRunner; tenantId: string }) => ({ manager: ctx.runner.manager, tenantId: ctx.tenantId });
type SeedExtra = { version?: string | null; goLive?: number | null; endOfSupport?: number | null; retired?: number | null; lifecycle?: string };

const today = async (runner: QueryRunner) => {
  const [row]: Array<{ today: string }> = await runner.query(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today`);
  return row.today;
};

const shift = (from: string, days: number) => {
  const date = new Date(`${from}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

async function inTenant(fn: (ctx: Ctx) => Promise<void>) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'app-dates');
    const list = new ApplicationsListService(runner.manager.getRepository(Application));
    const start = await today(runner);
    const insert = async (n: number, name: string, extra: SeedExtra = {}) => {
      const goLive = extra.goLive == null ? null : shift(start, extra.goLive);
      const endOfSupport = extra.endOfSupport == null ? null : shift(start, extra.endOfSupport);
      const retired = extra.retired == null ? null : shift(start, extra.retired);
      const rows = await runner.query(
        `INSERT INTO applications (tenant_id, name, sequential_id, version, go_live_date, end_of_support_date, retired_date, lifecycle, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'enabled') RETURNING id`,
        [tenantId, name, `APP-${n}`, extra.version ?? null, goLive, endOfSupport, retired, extra.lifecycle ?? 'active'],
      );
      return rows[0].id as string;
    };
    const apps = {
      a: await insert(1, 'Alpha', { version: '16', goLive: -200, endOfSupport: 30 }),
      b: await insert(2, 'Beta', { version: '16.4', goLive: -100, endOfSupport: 700, retired: -10, lifecycle: 'retired' }),
      c: await insert(3, 'Gamma'),
    };
    const dates = {
      aGoLive: shift(start, -200), bGoLive: shift(start, -100),
      aEnd: shift(start, 30), bEnd: shift(start, 700), bRetired: shift(start, -10),
    };
    await fn({ runner, tenantId, list, apps, dates });
  });
}

async function names(result: { items: any[] }): Promise<string[]> {
  return result.items.map((row) => row.name);
}

async function testDateFilters() {
  await inTenant(async ({ runner, list, tenantId, apps, dates }) => {
    const range = { filterType: 'date', type: 'inRange', dateFrom: dates.aEnd, dateTo: dates.aEnd };
    const filtered = await list.list({ include_inactive: true, filters: { end_of_support_date: range } }, opts({ runner, tenantId }));
    assert.deepEqual(filtered.items.map((row) => row.id), [apps.a], 'the end of support range keeps Alpha only');
    assert.equal(filtered.total, 1);

    // The same date range as Plaid builds it, through the registry and the list.
    const adapted = adaptFilters(applicationsRegistry, { end_of_support_date: { op: 'between', value: shift(dates.aEnd, -1), valueTo: shift(dates.bEnd, 1) } });
    assert.deepEqual(adapted.ignored, []);
    const withEnd = await list.list({ include_inactive: true, filters: adapted.filters }, opts({ runner, tenantId }));
    assert.deepEqual(withEnd.items.map((row) => row.id).sort(), [apps.a, apps.b].sort(), 'the range keeps both dated applications');

    const retired = await list.list({ include_inactive: true, filters: { retired_date: { filterType: 'date', type: 'equals', dateFrom: dates.bRetired } } }, opts({ runner, tenantId }));
    assert.deepEqual(retired.items.map((row) => row.id), [apps.b], 'the retirement date filters by day');

    const goLive = await list.list({ include_inactive: true, filters: { go_live_date: { filterType: 'date', type: 'inRange', dateFrom: dates.aGoLive, dateTo: dates.bGoLive } } }, opts({ runner, tenantId }));
    assert.deepEqual(goLive.items.map((row) => row.id).sort(), [apps.a, apps.b].sort(), 'the go-live range keeps the two dated applications');
  });
}

async function testSorts() {
  await inTenant(async ({ runner, list, tenantId, apps, dates }) => {
    const asc = await list.list({ include_inactive: true, sort: 'go_live_date:ASC', limit: 200 }, opts({ runner, tenantId }));
    const ascNames = asc.items.map((row) => row.name);
    assert.ok(ascNames.indexOf('Alpha') < ascNames.indexOf('Beta'), 'go_live_date asc: Alpha went live first');
    assert.equal(ascNames[ascNames.length - 1], 'Gamma', 'an application without a date comes last');
    const desc = await list.list({ include_inactive: true, sort: 'go_live_date:DESC', limit: 200 }, opts({ runner, tenantId }));
    assert.ok(desc.items.map((row) => row.name).indexOf('Beta') < desc.items.map((row) => row.name).indexOf('Alpha'), 'go_live_date desc');

    const byEnd = await list.list({ include_inactive: true, sort: 'end_of_support_date:ASC', limit: 200 }, opts({ runner, tenantId }));
    const ids = byEnd.items.map((row) => row.id);
    assert.ok(ids.indexOf(apps.a) < ids.indexOf(apps.b) && ids[ids.length - 1] === apps.c, 'end_of_support_date asc, no date last');
    assert.equal(dates.aEnd < dates.bEnd, true);
  });
}

async function testVersionAndYearFilters() {
  await inTenant(async ({ runner, list, tenantId, apps, dates }) => {
    const version = await list.list({ include_inactive: true, filters: { version: { filterType: 'text', type: 'contains', filter: '16.4' } } }, opts({ runner, tenantId }));
    assert.deepEqual(version.items.map((row) => row.id), [apps.b], 'the version text filter');
    const exact = adaptFilters(applicationsRegistry, { version: '16' });
    assert.deepEqual(exact.ignored, []);
    const sixteen = await list.list({ include_inactive: true, filters: exact.filters }, opts({ runner, tenantId }));
    assert.deepEqual(sixteen.items.map((row) => row.id).sort(), [apps.a, apps.b].sort(), 'the version 16 contains filter keeps 16 and 16.4');

    const year = dates.bEnd.slice(0, 4);
    const byYear = await list.list({ include_inactive: true, filters: { end_of_support_year: { filterType: 'set', values: [year] } } }, opts({ runner, tenantId }));
    assert.deepEqual(byYear.items.map((row) => row.id), [apps.b], 'the end of support year filter');

    const values = await list.listFilterValues({ include_inactive: true, fields: 'version,end_of_support_year,go_live_date,end_of_support_date,retired_date' }, opts({ runner, tenantId }));
    assert.deepEqual(values.version.filter((value) => value != null).sort(), ['16', '16.4'], 'the versions of the tenant');
    assert.ok(values.end_of_support_year.includes(year), 'the end of support years');
    assert.ok(values.go_live_date.includes(dates.aGoLive) && values.end_of_support_date.includes(dates.bEnd));
    assert.ok(values.retired_date.includes(dates.bRetired));
  });
}

async function testExistingFiltersKeepTheirBehaviour() {
  await inTenant(async ({ runner, list, tenantId, apps }) => {
    const active = await list.list({ include_inactive: true, filters: { lifecycle: { filterType: 'set', values: ['active'] } } }, opts({ runner, tenantId }));
    assert.deepEqual(active.items.map((row) => row.id).sort(), [apps.a, apps.c].sort(), 'the lifecycle filter still keeps the active applications');
    const name = await list.list({ include_inactive: true, filters: { name: { filterType: 'text', type: 'contains', filter: 'alph' } } }, opts({ runner, tenantId }));
    assert.deepEqual(name.items.map((row) => row.id), [apps.a], 'the name filter still matches without case');
    const noRetired = await list.list({ filters: {} }, opts({ runner, tenantId }));
    assert.ok(!noRetired.items.some((row) => row.id === apps.b), 'without include_inactive the retired application stays out');
  });
}

runSpecs('application-list-dates.integration.spec', [
  ['date filters', testDateFilters],
  ['sorts', testSorts],
  ['version and year filters', testVersionAndYearFilters],
  ['existing filters', testExistingFiltersKeepTheirBehaviour],
]).catch((error) => {
  console.error(error);
  process.exit(1);
});
