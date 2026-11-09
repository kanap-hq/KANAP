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
const enumProps = vi.hoisted(() => ({ current: null as null | { value: string; onChange: (value: string) => void; options: Array<{ label: string; value: string }> } }));
vi.mock('./EnumAutocomplete', () => ({ default: (props: any) => { enumProps.current = props; return null; } }));
const mocked = vi.mocked(api);
beforeEach(() => mocked.get.mockReset());

describe.each([
  ['spend_item', 'opex', 'spend_item'],
  ['spend_item', 'capex', 'capex_item'],
  ['capex_item', 'opex', 'spend_item'],
] as const)('task line picker from %s, %s line', (relationType, nature, pickedType) => {
  it('searches the lines of both natures, displays the BL reference with the title and takes the type from the line', async () => {
    mocked.get.mockResolvedValue({ data: { items: [{ id: 'line-1', item_number: 127, product_name: 'Software', nature }] } } as never);
    const onChangeId = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ThemeProvider theme={createAppTheme('light')}>
          <RelatedObjectSelect relationType={relationType} relationId={null} onChangeId={onChangeId} onChangeType={() => undefined} hideLabel />
        </ThemeProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/budget-lines/summary', { params: { limit: 50, q: undefined } }));
    expect(enumProps.current?.value).toBe('budget');
    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: 'BL-127 · Software' }));
    expect(onChangeId).toHaveBeenCalledWith('line-1', 'BL-127 · Software', pickedType);
    expect(mocked.get.mock.calls.every(([url]) => url === '/budget-lines/summary')).toBe(true);
  });
});

describe('related object type picker', () => {
  it('offers one budget choice, held as an OPEX line until a line is picked', () => {
    mocked.get.mockResolvedValue({ data: { items: [] } } as never);
    const onChangeType = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ThemeProvider theme={createAppTheme('light')}>
          <RelatedObjectSelect relationType={null} relationId={null} onChangeId={() => undefined} onChangeType={onChangeType} />
        </ThemeProvider>
      </QueryClientProvider>,
    );
    expect(enumProps.current?.options.filter((option) => option.value === 'budget')).toHaveLength(1);
    enumProps.current?.onChange('budget');
    expect(onChangeType).toHaveBeenCalledWith('spend_item');
  });

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
      'relatedObject.types.budgetLine',
      'relatedObject.types.contract',
      'relatedObject.types.incident',
    ]);
    expect(screen.getByText('relatedObject.types.project')).toBeTruthy();
    expect(screen.getByPlaceholderText('filters.search')).toBeTruthy();
  });
});
