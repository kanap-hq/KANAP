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
  reportListFilters,
  reportListHref,
  reportListLink,
  reportListPicks,
  rowListGroup,
  type ReportListPicks,
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

describe('reportListHref: each group kind', () => {
  it('a cost center row opens the list filtered on its label, the row without one on the blank value', () => {
    expect(reportListHref('opex', { kind: 'costCenter', label: 'CC1 · Ops' }, NO_LIST_PICKS))
      .toBe(`/ops/opex?${new URLSearchParams({ filters: JSON.stringify({ cost_center_label: set(['CC1 · Ops']) }) })}`);
    expect(filtersOf(reportListHref('opex', { kind: 'costCenter', label: null }, NO_LIST_PICKS))).toEqual({ cost_center_label: set([null]) });
  });

  it('a supplier row filters the supplier column, No supplier the blank value', () => {
    expect(filtersOf(reportListHref('capex', { kind: 'supplier', name: 'Acme' }, NO_LIST_PICKS))).toEqual({ supplier_name: set(['Acme']) });
    expect(reportListHref('capex', { kind: 'supplier', name: null }, NO_LIST_PICKS).startsWith('/ops/capex?filters=')).toBe(true);
    expect(filtersOf(reportListHref('capex', { kind: 'supplier', name: null }, NO_LIST_PICKS))).toEqual({ supplier_name: set([null]) });
  });

  it('a dimension value row filters that dimension column: the default one keeps analytics_category_name', () => {
    expect(axisListColumn(DEFAULT_AXIS)).toBe('analytics_category_name');
    expect(axisListColumn(NATURE)).toBe('analytics_ax-nat');
    expect(filtersOf(reportListHref('opex', { kind: 'axis', column: axisListColumn(NATURE), name: 'Hardware' }, NO_LIST_PICKS)))
      .toEqual({ 'analytics_ax-nat': set(['Hardware']) });
    expect(filtersOf(reportListHref('opex', { kind: 'axis', column: axisListColumn(DEFAULT_AXIS), name: null }, NO_LIST_PICKS)))
      .toEqual({ analytics_category_name: set([null]) });
  });

  it('an account row filters the account column on its accounts', () => {
    expect(filtersOf(reportListHref('opex', { kind: 'account', values: ['6110 - Software', '6120 - Cloud'] }, NO_LIST_PICKS)))
      .toEqual({ account_display: set(['6110 - Software', '6120 - Cloud']) });
  });

  it('rowListGroup: the stored name, null without one, no link for a blank name', () => {
    expect(rowListGroup('costCenter', { name: 'CC1 · Ops' })).toEqual({ kind: 'costCenter', label: 'CC1 · Ops' });
    expect(rowListGroup('supplier', { name: null })).toEqual({ kind: 'supplier', name: null });
    expect(rowListGroup('axis', { name: ' Hardware' }, 'analytics_ax-nat')).toEqual({ kind: 'axis', column: 'analytics_ax-nat', name: ' Hardware' });
    expect(rowListGroup('axis', { name: '  ' }, 'analytics_ax-nat')).toBeNull();
    expect(rowListGroup('axis', { name: 'Hardware' }, null)).toBeNull();
  });
});

describe('reportListFilters: the bar picks', () => {
  const picks: ReportListPicks = {
    costCenterLabels: ['CC1 · Ops', 'CC2 · Dev'],
    runBuild: 'run',
    analytics: [{ column: 'analytics_ax-nat', name: 'Hardware' }, { column: 'analytics_category_name', name: null }],
    withFte: true,
  };

  it('maps cost center, run or build, dimension values and Items with FTE to the list columns', () => {
    expect(reportListFilters({ kind: 'supplier', name: 'Acme' }, picks)).toEqual({
      cost_center_label: set(['CC1 · Ops', 'CC2 · Dev']),
      run_build: set(['run']),
      'analytics_ax-nat': set(['Hardware']),
      analytics_category_name: set([null]),
      has_fte: set(['yes']),
      supplier_name: set(['Acme']),
    });
    expect(reportListFilters({ kind: 'supplier', name: 'Acme' }, { ...NO_LIST_PICKS, runBuild: 'none' })).toEqual({
      run_build: set([null]),
      supplier_name: set(['Acme']),
    });
  });

  it("the row's group replaces a pick on the same column (a cost center under the node, the picked value)", () => {
    const filters = reportListFilters({ kind: 'costCenter', label: 'CC2 · Dev' }, picks);
    expect(filters.cost_center_label).toEqual(set(['CC2 · Dev']));
    expect(reportListFilters({ kind: 'axis', column: 'analytics_ax-nat', name: 'Hardware' }, picks)['analytics_ax-nat']).toEqual(set(['Hardware']));
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
  it('stays inline until saved, then opens on ctx', async () => {
    const many = Array.from({ length: 80 }, (_, i) => `CC${100 + i} · Cost center number ${i}`);
    const picks: ReportListPicks = { ...NO_LIST_PICKS, costCenterLabels: many };
    const group = { kind: 'supplier' as const, name: 'Acme' };
    expect(encodeURIComponent(JSON.stringify(reportListFilters(group, picks))).length).toBeGreaterThan(LIST_CONTEXT_INLINE_LIMIT);

    const before = reportListLink('opex', group, picks);
    expect(filtersOf(before.href)).toEqual(reportListFilters(group, picks));
    expect(before.save).toBeTypeOf('function');

    post.mockResolvedValue({ data: { id: 'ctx-1' } });
    await expect(before.save!()).resolves.toBe('ctx-1');
    expect(post).toHaveBeenCalledWith('/list-contexts', { list: 'spend-items', state: { filters: reportListFilters(group, picks) } });
    expect(cachedListContextId('/spend-items/summary', JSON.stringify(reportListFilters(group, picks)))).toBe('ctx-1');

    const after = reportListLink('opex', group, picks);
    expect(after.href).toBe('/ops/opex?ctx=ctx-1');
    expect(after.save).toBeUndefined();
  });

  it('short filters never need saving', () => {
    expect(reportListLink('opex', { kind: 'supplier', name: 'Acme' }, NO_LIST_PICKS).save).toBeUndefined();
  });
});
