import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const translation = vi.hoisted(() => ({ t: (key: string) => key }));
vi.mock('react-i18next', () => ({ useTranslation: () => translation, initReactI18next: { type: '3rdParty', init: () => {} } }));
vi.mock('../../hooks/usePlacementOptions', () => ({ useLinePlacementFilter: () => null }));
const axes = vi.hoisted(() => {
  const list = [
    { id: 'both-required', name: 'Priority', required: true, applies_to: null, status: 'enabled', disabled_at: null },
    { id: 'opex-required', name: 'Tower', required: true, applies_to: 'opex', status: 'enabled', disabled_at: null },
    { id: 'free', name: 'Purpose', required: false, applies_to: null, status: 'enabled', disabled_at: null },
  ];
  return { list, scopes: [] as Array<string | null> };
});
vi.mock('../../hooks/useAnalyticsAxes', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../hooks/useAnalyticsAxes')>();
  const values = { enabled: axes.list, label: (axis: { name: string }) => axis.name };
  return {
    ...mod,
    useAnalyticsAxes: (options?: { scope?: string | null }) => { axes.scopes.push(options?.scope ?? null); return values; },
  };
});

import { useBudgetLineBulkFields } from './budgetLineBulkFields';

const fieldsOf = (scope: 'all' | 'opex' | 'capex') => renderHook(() => useBudgetLineBulkFields(scope)).result.current;
const optional = (field: { optional: boolean | ((first: string) => boolean) }, first = '') => (
  typeof field.optional === 'function' ? field.optional(first) : field.optional
);

describe('useBudgetLineBulkFields', () => {
  it('declares the fields of the rules, the account and the paying company without emptying', () => {
    const fields = fieldsOf('all');
    expect(fields.map((f) => [f.key, optional(f, 'free')])).toEqual([
      ['cost_center_id', true],
      ['account_id', false],
      ['paying_company_id', false],
      ['supplier_id', true],
      ['owner_it_id', true],
      ['owner_business_id', true],
      ['analytics_values', true],
      ['run_build', true],
    ]);
    expect(fields.map((f) => f.label)).toEqual([
      'opex.fields.costCenter', 'opex.fields.account', 'opex.fields.payingCompany', 'opex.fields.supplier',
      'opex.metadata.itOwner', 'opex.metadata.businessOwner', 'budget.bulkEdit.dimensionValue', 'opex.fields.runBuild',
    ]);
  });

  it('writes each field under its name in the changes, a dimension value under its dimension', () => {
    const byKey = Object.fromEntries(fieldsOf('all').map((f) => [f.key, f]));
    expect(byKey.cost_center_id.changes(null, null)).toEqual({ cost_center_id: null });
    expect(byKey.account_id.changes('a-1', 'company-1')).toEqual({ account_id: 'a-1' });
    expect(byKey.run_build.changes('build', null)).toEqual({ run_build: 'build' });
    expect(byKey.analytics_values.changes('v-1', 'free')).toEqual({ analytics_values: { free: 'v-1' } });
    expect(byKey.analytics_values.changes(null, 'free')).toEqual({ analytics_values: { free: null } });
    expect(byKey.account_id.first?.label).toBe('budget.bulkEdit.chartOf');
    expect(byKey.analytics_values.first?.label).toBe('budget.bulkEdit.dimension');
  });

  it('empties a dimension unless every line of the list requires it', () => {
    const all = fieldsOf('all').find((f) => f.key === 'analytics_values')!;
    expect([optional(all, 'both-required'), optional(all, 'opex-required'), optional(all, 'free')]).toEqual([false, true, true]);
    const opex = fieldsOf('opex').find((f) => f.key === 'analytics_values')!;
    expect([optional(opex, 'both-required'), optional(opex, 'opex-required'), optional(opex, 'free')]).toEqual([false, false, true]);
  });

  it('reads the dimensions of the Type filter nature, every one with both natures', () => {
    axes.scopes.length = 0;
    fieldsOf('capex');
    fieldsOf('all');
    expect(axes.scopes).toEqual(['capex', null]);
  });

  it('turns every picker off while the change is written', () => {
    for (const field of fieldsOf('all')) {
      const props = { value: null, onChange: () => {}, label: field.label, disabled: true };
      const picker = field.render({ ...props, first: 'free' }) as { props: { disabled?: boolean } };
      expect(picker.props.disabled, field.key).toBe(true);
      if (field.first) expect((field.first.render(props) as { props: { disabled?: boolean } }).props.disabled, `${field.key} first`).toBe(true);
    }
  });

  it('offers no dimension value without a dimension', () => {
    const saved = axes.list.splice(0, axes.list.length);
    try {
      expect(fieldsOf('all').some((f) => f.key === 'analytics_values')).toBe(false);
    } finally {
      axes.list.push(...saved);
    }
  });
});
