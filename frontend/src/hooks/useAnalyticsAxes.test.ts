import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { axisAppliesTo, axisRequiredFor, buildAnalyticsAxes, isHiddenAxis } from './useAnalyticsAxes';
import { analyticsFieldKey, type AnalyticsAxis } from '../services/analytics';

const t = ((key: string) => (key === 'master-data:analytics.analyticsCategoryFallback' ? 'Analytics dimension' : key)) as unknown as TFunction;

function axis(partial: Partial<AnalyticsAxis> & Pick<AnalyticsAxis, 'id' | 'code'>): AnalyticsAxis {
  return {
    name: null,
    description: null,
    sort_order: 0,
    is_default: false,
    applies_to: null,
    required: false,
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

  it('keeps, with a scope, only the enabled dimensions that apply to its lines, and the full list beside', () => {
    const OPEX_ONLY = axis({ id: 'ax-opex', code: 'opex-only', name: 'Opex only', sort_order: 2, applies_to: 'opex' });
    const CAPEX_ONLY = axis({ id: 'ax-capex', code: 'capex-only', name: 'Capex only', sort_order: 3, applies_to: 'capex' });
    const list = [ORDER, CAPEX_ONLY, ACTIVITY, OPEX_ONLY, DEFAULT, NATURE];
    const opex = buildAnalyticsAxes(list, t, true, false, undefined, 'opex');
    expect(opex.enabled.map((a) => a.id)).toEqual(['ax-nature', 'ax-opex', 'ax-default', 'ax-activity']);
    const capex = buildAnalyticsAxes(list, t, true, false, undefined, 'capex');
    expect(capex.enabled.map((a) => a.id)).toEqual(['ax-nature', 'ax-capex', 'ax-default', 'ax-activity']);
    // Labels of held values and edit conflicts still find every dimension.
    expect(opex.axes).toHaveLength(6);
    expect(opex.byId.get('ax-capex')).toBe(CAPEX_ONLY);
    expect(opex.defaultAxis?.id).toBe('ax-default');
    // No scope: every enabled dimension, as before.
    expect(buildAnalyticsAxes(list, t).enabled.map((a) => a.id)).toEqual(['ax-nature', 'ax-opex', 'ax-capex', 'ax-default', 'ax-activity']);
  });

  it('tells which dimensions apply to a type of line, and which a screen hides', () => {
    expect(axisAppliesTo({ applies_to: null }, 'opex')).toBe(true);
    expect(axisAppliesTo({ applies_to: null }, 'capex')).toBe(true);
    expect(axisAppliesTo({ applies_to: 'opex' }, 'opex')).toBe(true);
    expect(axisAppliesTo({ applies_to: 'opex' }, 'capex')).toBe(false);
    expect(axisAppliesTo({ applies_to: 'capex' }, 'opex')).toBe(false);
    const capex = axis({ id: 'ax-capex', code: 'capex-only', applies_to: 'capex' });
    const opex = buildAnalyticsAxes([DEFAULT, NATURE, ORDER, capex], t, true, false, undefined, 'opex');
    expect(isHiddenAxis(opex, 'ax-capex')).toBe(true);
    expect(isHiddenAxis(opex, 'ax-order')).toBe(true);
    expect(isHiddenAxis(opex, 'ax-nature')).toBe(false);
    // Unknown (dimensions not loaded): the server decides.
    expect(isHiddenAxis(opex, 'ax-unknown')).toBe(false);
  });

  it('requires a value only on a required dimension, enabled now, for the types it applies to', () => {
    const required = axis({ id: 'ax-req', code: 'req', required: true });
    expect(axisRequiredFor(required, 'opex')).toBe(true);
    expect(axisRequiredFor(required, 'capex')).toBe(true);
    expect(axisRequiredFor({ ...required, required: false }, 'opex')).toBe(false);
    // Another type: not required for it.
    expect(axisRequiredFor({ ...required, applies_to: 'capex' }, 'opex')).toBe(false);
    expect(axisRequiredFor({ ...required, applies_to: 'capex' }, 'capex')).toBe(true);
    // Disabled: the setting stays, ignored; a future disable date still counts as enabled.
    expect(axisRequiredFor({ ...required, status: 'disabled', disabled_at: '2026-01-01T00:00:00.000Z' }, 'opex')).toBe(false);
    expect(axisRequiredFor({ ...required, disabled_at: '2999-01-01T00:00:00.000Z' }, 'opex')).toBe(true);
    // The default dimension may be required.
    expect(axisRequiredFor({ ...DEFAULT, required: true }, 'capex')).toBe(true);
  });

  it('builds the list field key of a dimension without a colon', () => {
    expect(analyticsFieldKey('ax-nature')).toBe('analytics_ax-nature');
  });
});
