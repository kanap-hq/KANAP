import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';

vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import api from '../../api';
import { buildAnalyticsAxes } from '../../hooks/useAnalyticsAxes';
import { buildCostCenterTree } from '../../hooks/useCostCenterTree';
import { cachedListContextId, LIST_CONTEXT_INLINE_LIMIT, resetListContextCache } from '../../lib/listContext';
import type { AnalyticsAxis } from '../../services/analytics';
import type { CostCenterNode } from '../../services/costCenters';
import {
  axisListColumn,
  NO_LIST_PICKS,
  oneOffListLink,
  reportListFilters,
  reportListHref,
  reportListLink,
  reportListPicks,
  rowListGroup,
  windowFilter,
  type ReportListPicks,
  type ReportListScope,
} from './reportListLink';

const post = (api as unknown as { post: ReturnType<typeof vi.fn> }).post;

const set = (values: Array<string | null>) => ({ filterType: 'set', values });
/** The filters an href carries inline. */
const filtersOf = (href: string) => JSON.parse(new URLSearchParams(href.split('?')[1]).get('filters') ?? 'null');

function axis(id: string, patch: Partial<AnalyticsAxis> = {}): AnalyticsAxis {
  return { id, code: id, name: null, description: null, sort_order: 0, is_default: false, status: 'enabled', disabled_at: null, ...patch };
}
const DEFAULT_AXIS = axis('ax-def', { is_default: true });
const NATURE = axis('ax-nat', { name: 'Nature', sort_order: 1 });
const AXES = buildAnalyticsAxes([DEFAULT_AXIS, NATURE], ((key: string) => key) as unknown as TFunction);

function node(id: string, code: string, name: string, kind: CostCenterNode['kind'], parent: string | null): CostCenterNode {
  return {
    id, code, name, kind, parent_id: parent, company_id: null, company_name: null, owner_user_id: null, owner_name: null,
    status: 'enabled', disabled_at: null, sort_order: 0, depth: parent ? 1 : 0, path: name, path_ids: [id],
  };
}
// IT (group) holds Ops and Dev (cost centers) and Infra (group) with Net; Sales stays outside.
const TREE = buildCostCenterTree([
  node('it', 'IT', 'Information', 'group', null),
  node('ops', 'CC1', 'Ops', 'cost_center', 'it'),
  node('dev', 'CC2', 'Dev', 'cost_center', 'it'),
  node('infra', 'INF', 'Infra', 'group', 'it'),
  node('net', 'CC3', 'Net', 'cost_center', 'infra'),
  node('sales', 'CC9', 'Sales', 'cost_center', null),
]);

/** The bar's state as `useBudgetReportFilters` gives it, with nothing picked. */
function barState(patch: Partial<Parameters<typeof reportListPicks>[0]> = {}): Parameters<typeof reportListPicks>[0] {
  return {
    costCenterId: null,
    costCenterMissing: false,
    tree: TREE,
    runBuild: null,
    withFte: false,
    analytics: new Map(),
    analyticsAxes: AXES,
    analyticsMissing: false,
    options: {
      ready: true,
      lineCount: 3,
      hasRunBuild: true,
      hasFte: true,
      analytics: new Map([
        ['ax-def', [{ id: 'v-cloud', label: 'Cloud', name: 'Cloud' }]],
        ['ax-nat', [{ id: 'n-hw', label: 'Hardware', name: ' Hardware' }]],
      ]),
      isError: false,
      retry: () => undefined,
    },
    ...patch,
  };
}

beforeEach(() => {
  resetListContextCache();
  post.mockReset();
});

// An amount report reading 2025 and later: the lines still active on 1 January 2025, every line.
const REPORT: ReportListScope = { firstYear: 2025, fteOnly: false };
const WINDOW = {
  filterType: 'date',
  operator: 'OR',
  conditions: [
    { filterType: 'date', type: 'blank', dateFrom: null, dateTo: null },
    { filterType: 'date', type: 'greaterThan', dateFrom: '2024-12-31 00:00:00', dateTo: null },
  ],
};
/** The filters every link carries besides its group and picks: the report's window. */
const withWindow = (filters: Record<string, unknown>) => ({ disabled_at: WINDOW, ...filters });
const statusOf = (href: string) => new URLSearchParams(href.split('?')[1]).get('statusScope');

describe('oneOffListLink: a list opened on given filters', () => {
  it('opens the list on every status as a one-off view, with the filters alone', () => {
    const link = oneOffListLink('capex', { account_id: set(['acc-1']) });
    expect(link.save).toBeUndefined();
    const [path, search] = link.href.split('?');
    expect(path).toBe('/ops/capex');
    const params = new URLSearchParams(search);
    expect(filtersOf(link.href)).toEqual({ account_id: set(['acc-1']) });
    expect(params.get('statusScope')).toBe('all');
    expect(params.get('from')).toBe('report');
  });
});

describe('reportListHref: each group kind', () => {
  it('a cost center row opens the list on every status, its window and its label; the row without one on blank', () => {
    const href = reportListHref('opex', { kind: 'costCenter', label: 'CC1 · Ops' }, NO_LIST_PICKS, REPORT);
    const filters = withWindow({ cost_center_label: set(['CC1 · Ops']) });
    expect(href).toBe(`/ops/opex?${new URLSearchParams({ filters: JSON.stringify(filters), statusScope: 'all', from: 'report' })}`);
    expect(statusOf(href)).toBe('all');
    expect(filtersOf(reportListHref('opex', { kind: 'costCenter', label: null }, NO_LIST_PICKS, REPORT))).toEqual(withWindow({ cost_center_label: set([null]) }));
  });

  it('a supplier row filters the supplier column, No supplier the blank value', () => {
    expect(filtersOf(reportListHref('capex', { kind: 'supplier', name: 'Acme' }, NO_LIST_PICKS, REPORT))).toEqual(withWindow({ supplier_name: set(['Acme']) }));
    expect(reportListHref('capex', { kind: 'supplier', name: null }, NO_LIST_PICKS, REPORT).startsWith('/ops/capex?filters=')).toBe(true);
    expect(filtersOf(reportListHref('capex', { kind: 'supplier', name: null }, NO_LIST_PICKS, REPORT))).toEqual(withWindow({ supplier_name: set([null]) }));
  });

  it('a dimension value row filters that dimension column: the default one keeps analytics_category_name', () => {
    expect(axisListColumn(DEFAULT_AXIS)).toBe('analytics_category_name');
    expect(axisListColumn(NATURE)).toBe('analytics_ax-nat');
    expect(filtersOf(reportListHref('opex', { kind: 'axis', column: axisListColumn(NATURE), name: 'Hardware' }, NO_LIST_PICKS, REPORT)))
      .toEqual(withWindow({ 'analytics_ax-nat': set(['Hardware']) }));
    expect(filtersOf(reportListHref('opex', { kind: 'axis', column: axisListColumn(DEFAULT_AXIS), name: null }, NO_LIST_PICKS, REPORT)))
      .toEqual(withWindow({ analytics_category_name: set([null]) }));
  });

  it('a consolidation line filters the account ids (the link-only column), blank for the lines without an account', () => {
    expect(filtersOf(reportListHref('opex', { kind: 'account', ids: ['acc-1', 'acc-2', null] }, NO_LIST_PICKS, REPORT)))
      .toEqual(withWindow({ account_id: set(['acc-1', 'acc-2', null]) }));
  });

  it('rowListGroup: the stored name, null without one, no link for a blank name', () => {
    expect(rowListGroup('costCenter', { name: 'CC1 · Ops' })).toEqual({ kind: 'costCenter', label: 'CC1 · Ops' });
    expect(rowListGroup('supplier', { name: null })).toEqual({ kind: 'supplier', name: null });
    expect(rowListGroup('axis', { name: ' Hardware' }, 'analytics_ax-nat')).toEqual({ kind: 'axis', column: 'analytics_ax-nat', name: ' Hardware' });
    expect(rowListGroup('axis', { name: '  ' }, 'analytics_ax-nat')).toBeNull();
    expect(rowListGroup('axis', { name: 'Hardware' }, null)).toBeNull();
  });
});

describe('reportListFilters: the window, the FTE scope and the bar picks', () => {
  const picks: ReportListPicks = {
    costCenterLabels: ['CC1 · Ops', 'CC2 · Dev'],
    runBuild: 'run',
    analytics: [{ column: 'analytics_ax-nat', name: 'Hardware' }, { column: 'analytics_category_name', name: null }],
    withFte: true,
  };

  it('the window: End of validity blank or after 31 December of the year before the first year', () => {
    expect(windowFilter(2025)).toEqual(WINDOW);
    expect(reportListFilters({ kind: 'supplier', name: 'Acme' }, NO_LIST_PICKS, { firstYear: 2027, fteOnly: false }).disabled_at)
      .toMatchObject({ operator: 'OR', conditions: [{ type: 'blank' }, { type: 'greaterThan', dateFrom: '2026-12-31 00:00:00' }] });
  });

  it('rows that count only FTE lines always add FTE declared, Items with FTE or not', () => {
    expect(reportListFilters({ kind: 'supplier', name: 'Acme' }, NO_LIST_PICKS, { firstYear: 2025, fteOnly: true }))
      .toEqual(withWindow({ has_fte: set(['yes']), supplier_name: set(['Acme']) }));
    expect(reportListFilters({ kind: 'supplier', name: 'Acme' }, NO_LIST_PICKS, REPORT)).not.toHaveProperty('has_fte');
  });

  it('maps cost center, run or build, dimension values and Items with FTE to the list columns', () => {
    expect(reportListFilters({ kind: 'supplier', name: 'Acme' }, picks, REPORT)).toEqual(withWindow({
      cost_center_label: set(['CC1 · Ops', 'CC2 · Dev']),
      run_build: set(['run']),
      'analytics_ax-nat': set(['Hardware']),
      analytics_category_name: set([null]),
      has_fte: set(['yes']),
      supplier_name: set(['Acme']),
    }));
    expect(reportListFilters({ kind: 'supplier', name: 'Acme' }, { ...NO_LIST_PICKS, runBuild: 'none' }, REPORT)).toEqual(withWindow({
      run_build: set([null]),
      supplier_name: set(['Acme']),
    }));
  });

  it("the row's group replaces a pick on the same column (a cost center under the node, the picked value)", () => {
    const filters = reportListFilters({ kind: 'costCenter', label: 'CC2 · Dev' }, picks, REPORT);
    expect(filters.cost_center_label).toEqual(set(['CC2 · Dev']));
    expect(reportListFilters({ kind: 'axis', column: 'analytics_ax-nat', name: 'Hardware' }, picks, REPORT)['analytics_ax-nat']).toEqual(set(['Hardware']));
  });
});

describe('reportListPicks: the bar as the list names it', () => {
  it('nothing picked', () => {
    expect(reportListPicks(barState())).toEqual(NO_LIST_PICKS);
  });

  it('a group node stands for the cost centers below it, at every depth, never for the groups', () => {
    expect(reportListPicks(barState({ costCenterId: 'it' }))?.costCenterLabels?.slice().sort()).toEqual(['CC1 · Ops', 'CC2 · Dev', 'CC3 · Net']);
    expect(reportListPicks(barState({ costCenterId: 'ops' }))?.costCenterLabels).toEqual(['CC1 · Ops']);
  });

  it('run or build and Items with FTE', () => {
    expect(reportListPicks(barState({ runBuild: 'build', withFte: true }))).toEqual({ ...NO_LIST_PICKS, runBuild: 'build', withFte: true });
  });

  it("dimension picks: the value's stored name on its dimension column, none as the blank value", () => {
    const picks = reportListPicks(barState({ analytics: new Map([['ax-def', 'none'], ['ax-nat', 'n-hw']]) }));
    expect(picks?.analytics).toEqual([
      { column: 'analytics_category_name', name: null },
      { column: 'analytics_ax-nat', name: ' Hardware' },
    ]);
  });

  it('no picks while a value cannot be named, or the address cannot be read', () => {
    expect(reportListPicks(barState({ analytics: new Map([['ax-nat', 'n-unknown']]) }))).toBeNull();
    expect(reportListPicks(barState({ analytics: new Map([['ax-gone', 'none']]) }))).toBeNull();
    expect(reportListPicks(barState({ costCenterMissing: true }))).toBeNull();
    expect(reportListPicks(barState({ analyticsMissing: true }))).toBeNull();
  });
});

describe('reportListLink: filters too long for a URL', () => {
  const many = Array.from({ length: 80 }, (_, i) => `CC${100 + i} · Cost center number ${i}`);
  const picks: ReportListPicks = { ...NO_LIST_PICKS, costCenterLabels: many };
  const group = { kind: 'supplier' as const, name: 'Acme' };

  it('stays inline (copyable) and saves nothing until used; the save answers the ctx address', async () => {
    expect(encodeURIComponent(JSON.stringify(reportListFilters(group, picks, REPORT))).length).toBeGreaterThan(LIST_CONTEXT_INLINE_LIMIT);

    const before = reportListLink('opex', group, picks, REPORT);
    expect(filtersOf(before.href)).toEqual(reportListFilters(group, picks, REPORT));
    expect(statusOf(before.href)).toBe('all');
    expect(before.save).toBeTypeOf('function');
    expect(post).not.toHaveBeenCalled();

    post.mockResolvedValue({ data: { id: 'ctx-1' } });
    await expect(before.save!()).resolves.toBe('/ops/opex?statusScope=all&from=report&ctx=ctx-1');
    expect(post).toHaveBeenCalledWith('/list-contexts', { list: 'spend-items', state: { filters: reportListFilters(group, picks, REPORT) } });
    expect(cachedListContextId('/spend-items/summary', JSON.stringify(reportListFilters(group, picks, REPORT)))).toBe('ctx-1');

    const after = reportListLink('opex', group, picks, REPORT);
    expect(after.href).toBe('/ops/opex?statusScope=all&from=report&ctx=ctx-1');
    expect(after.save).toBeUndefined();
  });

  it('short filters never need saving', () => {
    expect(reportListLink('opex', { kind: 'supplier', name: 'Acme' }, NO_LIST_PICKS, REPORT).save).toBeUndefined();
  });
});
