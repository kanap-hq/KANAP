import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import en from '../locales/en/common.json';
import fr from '../locales/fr/common.json';

/** A `t` reading a common locale file, with `{{name}}` interpolation. */
function translator(bundle: Record<string, unknown>) {
  return (key: string, options?: Record<string, unknown>) => {
    let value: unknown = bundle;
    for (const part of key.replace(/^common:/, '').split('.')) value = (value as Record<string, unknown> | undefined)?.[part];
    return String(value ?? key).replace(/{{(\w+)}}/g, (_, name: string) => String(options?.[name] ?? ''));
  };
}

const translation = vi.hoisted(() => ({ t: null as any }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translation.t }) }));
vi.mock('../i18n/useLocale', () => ({ useLocale: () => 'en' }));

import DateFloatingFilter, { dateFilterText } from './DateFloatingFilter';

const enT = translator(en as Record<string, unknown>) as any;
const frT = translator(fr as Record<string, unknown>) as any;
translation.t = enT;

const condition = (type: string, dateFrom: string | null = null, dateTo: string | null = null) => ({ filterType: 'date' as const, type, dateFrom, dateTo });
const WINDOW = { filterType: 'date' as const, operator: 'OR' as const, conditions: [condition('blank'), condition('greaterThan', '2024-12-31 00:00:00')] };

describe('dateFilterText', () => {
  it('names every condition of a combined model, joined by its operator', () => {
    expect(dateFilterText(enT, WINDOW, 'en')).toBe('Blank or after 31 Dec 2024');
    expect(dateFilterText(enT, { ...WINDOW, operator: 'AND', conditions: [condition('notBlank'), condition('lessThan', '2026-01-01 00:00:00')] }, 'en'))
      .toBe('Not blank and before 1 Jan 2026');
    expect(dateFilterText(frT, WINDOW, 'fr')).toMatch(/^Vide ou après le 31 déc\.? 2024$/);
  });

  it('names a single condition, a range, and nothing without a model', () => {
    expect(dateFilterText(enT, condition('greaterThan', '2024-12-31 00:00:00'), 'en')).toBe('After 31 Dec 2024');
    expect(dateFilterText(enT, condition('equals', '2025-03-04'), 'en')).toBe('On 4 Mar 2025');
    expect(dateFilterText(enT, condition('inRange', '2025-01-01 00:00:00', '2025-06-30 00:00:00'), 'en')).toBe('From 1 Jan 2025 to 30 Jun 2025');
    expect(dateFilterText(enT, condition('blank'), 'en')).toBe('Blank');
    expect(dateFilterText(enT, null, 'en')).toBe('');
  });
});

describe('DateFloatingFilter', () => {
  function setup(model: Record<string, unknown>) {
    let current = { ...model };
    const listeners: Array<() => void> = [];
    const api = {
      getFilterModel: () => current,
      setFilterModel: vi.fn((next: Record<string, unknown>) => {
        current = next;
        listeners.forEach((listener) => listener());
      }),
      addEventListener: (_type: string, listener: () => void) => listeners.push(listener),
      removeEventListener: vi.fn(),
    };
    const showParentFilter = vi.fn();
    const column = { getColId: () => 'disabled_at', getColDef: () => ({ headerName: 'End of validity' }) };
    render(<DateFloatingFilter {...({ api, column, showParentFilter } as any)} />);
    return { api, showParentFilter };
  }

  it('shows the combined model in words, opens the menu on a click and clears the column in one click', () => {
    const { api, showParentFilter } = setup({ disabled_at: WINDOW, has_fte: { filterType: 'set', values: ['yes'] } });
    const box = screen.getByRole('button', { name: 'Filter End of validity: Blank or after 31 Dec 2024' });
    expect(box).toHaveTextContent('Blank or after 31 Dec 2024');
    fireEvent.click(box);
    expect(showParentFilter).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }));
    // The other columns' filters stay.
    expect(api.setFilterModel).toHaveBeenCalledWith({ has_fte: { filterType: 'set', values: ['yes'] } });
    expect(screen.queryByRole('button', { name: 'Clear filter' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Filter End of validity' })).toHaveTextContent('Filter…');
  });

  it('without a filter: the placeholder, no clear button', () => {
    setup({});
    expect(screen.getByRole('button', { name: 'Filter End of validity' })).toHaveTextContent('Filter…');
    expect(screen.queryByRole('button', { name: 'Clear filter' })).toBeNull();
  });
});
