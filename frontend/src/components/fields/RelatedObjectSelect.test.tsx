import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import RelatedObjectSelect from './RelatedObjectSelect';
import api from '../../api';

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});
vi.mock('../../api', () => ({ default: { get: vi.fn() } }));
const enumProps = vi.hoisted(() => ({ current: null as null | { options: Array<{ label: string; value: string }> } }));
vi.mock('./EnumAutocomplete', () => ({ default: (props: any) => { enumProps.current = props; return null; } }));
const mocked = vi.mocked(api);
beforeEach(() => mocked.get.mockReset());

describe.each([['spend_item', 'opex'], ['capex_item', 'capex']] as const)('task line picker %s', (relationType, nature) => {
  it('filters the native list by nature and displays the BL reference with the title', async () => {
    mocked.get.mockResolvedValue({ data: { items: [{ id: 'line-1', item_number: 127, product_name: 'Software' }] } } as never);
    const onChangeId = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ThemeProvider theme={createAppTheme('light')}>
          <RelatedObjectSelect relationType={relationType} relationId={null} onChangeId={onChangeId} onChangeType={() => undefined} hideLabel />
        </ThemeProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/budget-lines/summary', { params: { limit: 50, q: undefined, filters: JSON.stringify({ nature: { filterType: 'set', values: [nature] } }) } }));
    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: 'BL-127 · Software' }));
    expect(onChangeId).toHaveBeenCalledWith('line-1', 'BL-127 · Software');
    expect(mocked.get.mock.calls.every(([url]) => url === '/budget-lines/summary')).toBe(true);
  });
});

describe('related object type picker', () => {
  it('names every type and the search field through i18n', async () => {
    mocked.get.mockResolvedValue({ data: { items: [] } } as never);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ThemeProvider theme={createAppTheme('light')}>
          <RelatedObjectSelect relationType="project" relationId={null} onChangeId={() => undefined} onChangeType={() => undefined} />
        </ThemeProvider>
      </QueryClientProvider>,
    );
    expect(enumProps.current?.options.map((option) => option.label)).toEqual([
      'relatedObject.types.standalone',
      'relatedObject.types.project',
      'relatedObject.types.spendItem',
      'relatedObject.types.contract',
      'relatedObject.types.capexItem',
      'relatedObject.types.incident',
    ]);
    expect(screen.getByText('relatedObject.types.project')).toBeTruthy();
    expect(screen.getByPlaceholderText('filters.search')).toBeTruthy();
  });
});
