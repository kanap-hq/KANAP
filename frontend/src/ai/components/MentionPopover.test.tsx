import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MentionPopover from './MentionPopover';
import { aiSearchApi } from '../aiApi';
import { createAppTheme } from '../../config/ThemeContext';

vi.mock('../aiApi', () => ({ aiSearchApi: { searchEntities: vi.fn() } }));

describe.each(['light', 'dark'] as const)('budget mentions in %s mode', (mode) => {
  beforeEach(() => {
    vi.mocked(aiSearchApi.searchEntities).mockReset();
    HTMLElement.prototype.scrollTo = vi.fn();
  });

  it.each(['BL-12', 'OPX-12', 'CPX-3'])('resolves @%s and displays its native reference', async (query) => {
    const item = { id: 'line-1', entity_type: 'budget_lines', ref: 'BL-12', label: 'Server renewal', summary: null };
    vi.mocked(aiSearchApi.searchEntities).mockResolvedValue([item]);
    const onSelect = vi.fn();
    render(<ThemeProvider theme={createAppTheme(mode)}>
      <MentionPopover query={query} onSelect={onSelect} onCancel={vi.fn()} />
    </ThemeProvider>);
    await waitFor(() => expect(aiSearchApi.searchEntities).toHaveBeenCalledWith(query, {
      signal: expect.any(AbortSignal), entityTypes: ['budget_lines'],
    }));
    const option = await screen.findByRole('option');
    expect(option).toHaveTextContent('BL-12');
    expect(option).toHaveTextContent('Server renewal');
    expect(screen.getByText('mention.entityTypes.budgetLines')).toBeInTheDocument();
    expect(screen.queryByText(/^OPX-|^CPX-/)).not.toBeInTheDocument();
    fireEvent.click(option);
    expect(onSelect).toHaveBeenCalledWith(item);
  });
});

describe('mention groups', () => {
  beforeEach(() => {
    vi.mocked(aiSearchApi.searchEntities).mockReset();
    HTMLElement.prototype.scrollTo = vi.fn();
  });

  it('renders results A, B, A without a duplicate key warning', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(aiSearchApi.searchEntities).mockResolvedValue([
      { id: 'app-1', entity_type: 'applications', ref: 'APP-1', label: 'Alpha' },
      { id: 'prj-1', entity_type: 'projects', ref: 'PRJ-1', label: 'Beta' },
      { id: 'app-2', entity_type: 'applications', ref: 'APP-2', label: 'Gamma' },
    ]);
    render(<ThemeProvider theme={createAppTheme('light')}>
      <MentionPopover query="backup" onSelect={vi.fn()} onCancel={vi.fn()} />
    </ThemeProvider>);
    expect(await screen.findByRole('option', { name: /Alpha/ })).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(3);
    expect(screen.getAllByText('mention.entityTypes.applications')).toHaveLength(2);
    const duplicateKey = errorSpy.mock.calls.filter((args) => args.some((arg) => (
      typeof arg === 'string' && arg.includes('same key')
    )));
    expect(duplicateKey).toEqual([]);
    errorSpy.mockRestore();
  });
});
