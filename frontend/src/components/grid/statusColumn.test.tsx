import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import CheckboxSetFilter from '../CheckboxSetFilter';
import CheckboxSetFloatingFilter from '../CheckboxSetFloatingFilter';
import { LinkCellRenderer } from './renderers';
import { statusColumnProps } from './statusColumn';

const labels: Record<string, string> = { 'common:statuses.enabled': 'Enabled', 'common:statuses.disabled': 'Disabled' };
const t = ((key: string) => labels[key] ?? key) as unknown as TFunction;

describe('statusColumnProps', () => {
  it('filters on the two status values with their labels', () => {
    const props = statusColumnProps(t);
    expect(props.filter).toBe(CheckboxSetFilter);
    expect(props.floatingFilterComponent).toBe(CheckboxSetFloatingFilter);
    expect(props.filterParams).toEqual({
      values: [
        { value: 'enabled', label: 'Enabled' },
        { value: 'disabled', label: 'Disabled' },
      ],
      searchable: false,
    });
  });

  it('formats the cell with the label, not the raw value', () => {
    const { valueFormatter } = statusColumnProps(t);
    expect(valueFormatter({ value: 'disabled' })).toBe('Disabled');
    expect(valueFormatter({ value: 'enabled' })).toBe('Enabled');
    expect(valueFormatter({ value: null })).toBe('');
    expect(valueFormatter({})).toBe('');
  });

  it('is what the link cell prints', () => {
    const { valueFormatter } = statusColumnProps(t);
    const value = 'disabled';
    render(
      <LinkCellRenderer
        {...({ value, valueFormatted: valueFormatter({ value }), data: { id: '1' } } as any)}
        linkType="internal"
        getHref={() => '/master-data/companies/1/overview'}
      />,
    );
    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(screen.queryByText('disabled')).toBeNull();
  });
});
