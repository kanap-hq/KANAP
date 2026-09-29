import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => `t(${key})`, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});
vi.mock('../api', () => ({ default: { get: vi.fn() } }));

import api from '../api';
import { resolveBudgetColumns, useBudgetColumns } from './useBudgetColumns';
import { DEFAULT_BUDGET_COLUMNS, type BudgetColumnsSettings } from '../services/budgetColumns';

const t = ((key: string) => `t(${key})`) as unknown as TFunction;
const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;
const ALL_ON = { planned: true, committed: true, forecast: true, actual: true, expected_landing: true };
const resolve = (over: Partial<BudgetColumnsSettings> = {}) => resolveBudgetColumns({ ...DEFAULT_BUDGET_COLUMNS, ...over }, t);

describe('resolveBudgetColumns', () => {
  it('reproduces today with the product defaults', () => {
    const columns = resolve();
    expect(columns.all.map((c) => [c.position, c.measure])).toEqual([
      [1, 'planned'], [2, 'committed'], [3, 'forecast'], [4, 'actual'], [5, 'expected_landing'],
    ]);
    expect(columns.shown.map((c) => c.measure)).toEqual(['planned', 'committed', 'actual', 'expected_landing']);
    expect(columns.defaultColumn.measure).toBe('planned');
    expect(columns.displayDefaults.map((c) => c.measure)).toEqual(['planned', 'expected_landing']);
    expect(columns.defaultSort).toBe('yBudget:DESC');
    expect(columns.label('planned')).toBe('t(ops:operations.budgetColumns.budget)');
  });

  it('names a column with the tenant name, else the translated product name', () => {
    const columns = resolve({ labels: { ...DEFAULT_BUDGET_COLUMNS.labels, committed: 'A1', forecast: '  ' } });
    expect(columns.get('committed')).toMatchObject({ label: 'A1', customLabel: 'A1' });
    expect(columns.get('forecast')).toMatchObject({ label: 't(ops:operations.budgetColumns.forecast)', customLabel: null });
  });

  it('keeps the fixed order for the shown columns and the group', () => {
    const columns = resolve({
      enabled: { ...ALL_ON, committed: false },
      group_spread: { ...DEFAULT_BUDGET_COLUMNS.group_spread, actual: false },
    });
    expect(columns.shown.map((c) => c.position)).toEqual([1, 3, 4, 5]);
    // Shown and following the spread and the lines: a hidden column is never in the group.
    expect(columns.group.map((c) => c.measure)).toEqual(['planned', 'forecast', 'expected_landing']);
  });

  it('shows by default the default column and the last shown column, once when they coincide', () => {
    expect(resolve({ enabled: ALL_ON, default_column: 'forecast' }).displayDefaults.map((c) => c.measure))
      .toEqual(['forecast', 'expected_landing']);
    const onlyFirst = { planned: true, committed: false, forecast: false, actual: false, expected_landing: false };
    expect(resolve({ enabled: onlyFirst }).displayDefaults.map((c) => c.measure)).toEqual(['planned']);
    expect(resolve({ enabled: ALL_ON, default_column: 'expected_landing' }).displayDefaults.map((c) => c.measure))
      .toEqual(['expected_landing']);
  });

  it('finds a column from any of its keys and refuses anything else', () => {
    const columns = resolve();
    for (const key of ['actual', 'follow_up']) expect(columns.get(key).measure).toBe('actual');
    for (const key of ['expected_landing', 'landing']) expect(columns.get(key).measure).toBe('expected_landing');
    for (const key of ['planned', 'budget']) expect(columns.get(key).measure).toBe('planned');
    expect(columns.get('actual').freezeKey).toBe('actual');
    expect(columns.get('follow_up').suffix).toBe('FollowUp');
    expect(() => columns.get('yBudget')).toThrow();
  });

  it('sorts lists by the default column', () => {
    expect(resolve({ default_column: 'committed' }).defaultSort).toBe('yRevision:DESC');
    expect(resolve({ enabled: ALL_ON, default_column: 'actual' }).defaultSort).toBe('yFollowUp:DESC');
  });
});

describe('useBudgetColumns', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
  );

  it('holds the product defaults until the setting is loaded, then the tenant setting', async () => {
    let answer: (value: unknown) => void = () => undefined;
    get.mockReturnValueOnce(new Promise((resolveGet) => { answer = resolveGet; }));
    const { result } = renderHook(() => useBudgetColumns(), { wrapper });

    expect(result.current.ready).toBe(false);
    expect(result.current.defaultColumn.measure).toBe('planned');
    expect(get).toHaveBeenCalledWith('/budget-columns');

    answer({ data: { ...DEFAULT_BUDGET_COLUMNS, default_column: 'committed', labels: { ...DEFAULT_BUDGET_COLUMNS.labels, committed: 'A1' } } });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.defaultColumn.label).toBe('A1');
    expect(result.current.error).toBeNull();
    expect(result.current.defaultSort).toBe('yRevision:DESC');
  });

  it('falls back to the product defaults after a failed read, and says so', async () => {
    get.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useBudgetColumns(), { wrapper });
    // One retry, then the screens that wait for the setting go on with the defaults.
    await waitFor(() => expect(result.current.ready).toBe(true), { timeout: 4000 });
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.defaultColumn.measure).toBe('planned');
    expect(result.current.shown.map((c) => c.measure)).toEqual(['planned', 'committed', 'actual', 'expected_landing']);
  });
});
