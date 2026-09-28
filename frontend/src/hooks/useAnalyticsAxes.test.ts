import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { buildAnalyticsAxes } from './useAnalyticsAxes';
import { analyticsFieldKey, type AnalyticsAxis } from '../services/analytics';

const t = ((key: string) => (key === 'master-data:analytics.analyticsCategoryFallback' ? 'Analytics dimension' : key)) as unknown as TFunction;

function axis(partial: Partial<AnalyticsAxis> & Pick<AnalyticsAxis, 'id' | 'code'>): AnalyticsAxis {
  return {
    name: null,
    description: null,
    sort_order: 0,
    is_default: false,
    status: 'enabled',
    disabled_at: null,
    ...partial,
  };
}

const DEFAULT = axis({ id: 'ax-default', code: 'default', is_default: true, sort_order: 5 });
const NATURE = axis({ id: 'ax-nature', code: 'nature', name: 'Nature', sort_order: 1 });
const ACTIVITY = axis({ id: 'ax-activity', code: 'activity', name: 'activity', sort_order: 5 });
const ORDER = axis({ id: 'ax-order', code: 'order', name: 'Internal order', sort_order: 9, status: 'disabled', disabled_at: '2026-01-01T00:00:00.000Z' });
const LATER = axis({ id: 'ax-later', code: 'later', name: 'Later', sort_order: 9, disabled_at: '2999-01-01T00:00:00.000Z' });

describe('buildAnalyticsAxes', () => {
  it('orders by sort order, then name (no name first), then code, whatever the response order', () => {
    const axes = buildAnalyticsAxes([ORDER, ACTIVITY, LATER, DEFAULT, NATURE], t);
    expect(axes.axes.map((a) => a.id)).toEqual(['ax-nature', 'ax-default', 'ax-activity', 'ax-order', 'ax-later']);
  });

  it('keeps the dimensions enabled now in order, a future disable date included', () => {
    const axes = buildAnalyticsAxes([ORDER, ACTIVITY, LATER, DEFAULT, NATURE], t);
    expect(axes.enabled.map((a) => a.id)).toEqual(['ax-nature', 'ax-default', 'ax-activity', 'ax-later']);
    expect(axes.byId.get('ax-order')).toBe(ORDER);
  });

  it('finds the default by its flag, not by its place', () => {
    const axes = buildAnalyticsAxes([NATURE, DEFAULT], t);
    expect(axes.axes[0].id).toBe('ax-nature');
    expect(axes.defaultAxis?.id).toBe('ax-default');
    expect(buildAnalyticsAxes([NATURE], t).defaultAxis).toBeNull();
  });

  it('labels a dimension by its name, and the unnamed default by the translated label', () => {
    const axes = buildAnalyticsAxes([DEFAULT, NATURE], t);
    expect(axes.label(NATURE)).toBe('Nature');
    expect(axes.label(DEFAULT)).toBe('Analytics dimension');
    expect(axes.label({ ...DEFAULT, name: 'Catégorie analytique' })).toBe('Catégorie analytique');
    expect(axes.label({ name: '  ' })).toBe('Analytics dimension');
  });

  it('carries the load state', () => {
    const loading = buildAnalyticsAxes([], t, false, false);
    expect(loading.ready).toBe(false);
    const failed = buildAnalyticsAxes([], t, true, true);
    expect(failed.ready).toBe(true);
    expect(failed.isError).toBe(true);
    expect(failed.axes).toEqual([]);
  });

  it('builds the list field key of a dimension without a colon', () => {
    expect(analyticsFieldKey('ax-nature')).toBe('analytics_ax-nature');
  });
});
