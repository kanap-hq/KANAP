import '../../i18n';
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import RelationAddPicker, { type RelationOption } from './RelationAddPicker';

const ROWS: RelationOption[] = [
  { id: 't-1', label: 'PostgreSQL', ref: 'TECH-1' },
  { id: 't-2', label: 'Redis', ref: 'TECH-2' },
];

function renderPicker(props: Partial<React.ComponentProps<typeof RelationAddPicker>> = {}) {
  const anchor = document.createElement('button');
  document.body.appendChild(anchor);
  const search = vi.fn(async (q: string) => ROWS.filter((row) => row.label.toLowerCase().includes(q.toLowerCase())));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onPick = vi.fn();
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={client}>
        <RelationAddPicker
          anchorEl={anchor}
          searchKey="test"
          search={search}
          excludeIds={new Set()}
          placeholder="Search"
          ariaLabel="Search"
          onPick={onPick}
          onClose={vi.fn()}
          {...props}
        />
      </QueryClientProvider>
    </ThemeProvider>,
  );
  return { onPick, search };
}

const optionTexts = () => screen.getAllByRole('option').map((option) => option.textContent);

describe('RelationAddPicker', () => {
  it('lists the matches alone without an action row, as the Relations sections use it', async () => {
    renderPicker();
    await waitFor(() => expect(optionTexts()).toEqual(['TECH-1PostgreSQL', 'TECH-2Redis']));
  });

  // Lot A1 of 26.11.9: the contacts of a contract or a budget line end the list with "create".
  it('ends the list with the action row, also when the search finds nothing, and hands it the text typed', async () => {
    const onChoose = vi.fn();
    const label = vi.fn((text: string) => (text ? `Create "${text}"` : 'New'));
    renderPicker({ action: { label, onChoose } });
    await waitFor(() => expect(optionTexts()).toEqual(['TECH-1PostgreSQL', 'TECH-2Redis', 'New']));
    fireEvent.change(screen.getByRole('combobox', { name: 'Search' }), { target: { value: 'Mongo' } });
    await waitFor(() => expect(optionTexts()).toEqual(['Create "Mongo"']));
    expect(screen.queryByText('No results')).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: 'Create "Mongo"' }));
    expect(onChoose).toHaveBeenCalledWith('Mongo');
  });

  it('leaves the action row out when its label says so', async () => {
    renderPicker({ action: { label: () => null, onChoose: vi.fn() } });
    await waitFor(() => expect(optionTexts()).toEqual(['TECH-1PostgreSQL', 'TECH-2Redis']));
  });

  it('reaches the action row from the keyboard: arrow down into the list, down to the last row, Enter', async () => {
    const onChoose = vi.fn();
    const { onPick } = renderPicker({ action: { label: (text) => (text ? `Create "${text}"` : 'New'), onChoose } });
    const field = screen.getByRole('combobox', { name: 'Search' });
    await screen.findByRole('option', { name: 'New' });
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: 'TECH-1PostgreSQL' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: 'New' })).toHaveFocus();
    await act(async () => { fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Enter' }); });
    expect(onChoose).toHaveBeenCalledWith('');
    expect(onPick).not.toHaveBeenCalled();
  });

  it('takes the action with Enter in the field when nothing matches', async () => {
    const onChoose = vi.fn();
    renderPicker({ action: { label: (text) => (text ? `Create "${text}"` : 'New'), onChoose } });
    const field = screen.getByRole('combobox', { name: 'Search' });
    fireEvent.change(field, { target: { value: 'Mongo' } });
    await screen.findByRole('option', { name: 'Create "Mongo"' });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onChoose).toHaveBeenCalledWith('Mongo');
  });
});
