import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import TechnologyCreateDialog from './TechnologyCreateDialog';

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());

const stableT = (key: string) => key;
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../../api', () => ({ default: { get, post } }));
vi.mock('../../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({
    settings: null,
    byField: { technologyFamily: [{ code: 'database', label: 'Database' }] },
    labelFor: (_field: string, code: string) => (code === 'database' ? 'Database' : code ?? ''),
  }),
}));

function renderDialog(onCreated = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <TechnologyCreateDialog open onClose={() => undefined} onCreated={onCreated} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return onCreated;
}

describe('TechnologyCreateDialog', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    get.mockImplementation(async (url: string) => {
      if (url === '/technologies/catalog') {
        return { data: { items: [{ key: 'mssqlserver', name: 'Microsoft SQL Server', editor: 'Microsoft', family: 'database', mode: 'installed', versions: 9, latest_version: '2022', description: 'Microsoft relational database.' }] } };
      }
      if (url === '/technologies/editors') return { data: { items: ['Microsoft'] } };
      return { data: { items: [] } };
    });
  });

  it('adopts a catalog entry and opens the new technology', async () => {
    post.mockResolvedValueOnce({ data: { ok: true, created: true, technology: { id: 'u1', name: 'Microsoft SQL Server', reference: 'TEC-4' } } });
    const onCreated = renderDialog();
    fireEvent.change(screen.getByLabelText('pages.technologies.create.searchLabel'), { target: { value: 'sql' } });
    await waitFor(() => expect(get).toHaveBeenCalledWith('/technologies/catalog', { params: { q: 'sql', language: 'en' } }));
    const description = await screen.findByText('Microsoft relational database.');
    expect(description.getAttribute('title')).toBe('Microsoft relational database.');
    // Two levels: the name and its facts on top, the description below across the row.
    const row = description.closest('[role="listitem"]')!;
    const top = row.firstElementChild!;
    expect(top.textContent).toBe('Microsoft SQL ServerMicrosoft · Database');
    expect(row.lastElementChild).toBe(description);
    fireEvent.click(await screen.findByText('Microsoft SQL Server'));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('TEC-4'));
    expect(post).toHaveBeenCalledWith('/technologies/adopt', { catalog_key: 'mssqlserver', language: 'en' });
    expect(screen.getByText('Microsoft · Database')).toBeTruthy();
  });

  it('creates a technology missing from the catalog', async () => {
    post.mockResolvedValueOnce({ data: { id: 'u2', reference: 'TEC-5', name: 'In-house broker' } });
    const onCreated = renderDialog();
    fireEvent.click(screen.getByText('pages.technologies.create.manualLink'));
    fireEvent.change(screen.getByLabelText('workspace.technology.fields.name'), { target: { value: 'In-house broker' } });
    fireEvent.mouseDown(screen.getByLabelText('workspace.technology.fields.mode'));
    fireEvent.click(await screen.findByRole('option', { name: 'workspace.technology.modes.subscribed' }));
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('TEC-5'));
    expect(post).toHaveBeenCalledWith('/technologies', { name: 'In-house broker', family: undefined, editor: undefined, mode: 'subscribed' });
  });

  it('says under the name that the tenant already has it, and goes back to the catalog', async () => {
    post.mockRejectedValueOnce({ response: { status: 409, data: { code: 'duplicate', message: 'A technology with this name already exists.' } } });
    const onCreated = renderDialog();
    fireEvent.click(screen.getByText('pages.technologies.create.manualLink'));
    fireEvent.change(screen.getByLabelText('workspace.technology.fields.name'), { target: { value: 'Microsoft SQL Server' } });
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    expect(await screen.findByText('workspace.technology.messages.duplicateName')).toBeTruthy();
    expect(onCreated).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('pages.technologies.create.backToCatalog'));
    expect(screen.getByLabelText('pages.technologies.create.searchLabel')).toBeTruthy();
  });
});
