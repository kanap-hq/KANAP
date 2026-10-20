import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import api from '../../../api';
import { KanapDialogProvider } from '../../../components/design';
import { createAppTheme } from '../../../config/ThemeContext';
import TechnologyOverviewTab, { type TechnologyDetail } from './TechnologyOverviewTab';

vi.mock('../../../api', () => ({ default: { get: vi.fn(async () => ({ data: { items: [] } })), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));

const VERSION = { cpe_version: null, build_prefixes: [], extended_support_end: null, notes: null };
const TECHNOLOGY = {
  id: 'tech-1', reference: 'TEC-1', name: 'PostgreSQL', editor: 'PostgreSQL Global Development Group', family: 'database', hosting_type: 'on_prem',
  lifecycle: 'active', description: null, notes: null, cpe_products: ['a:postgresql:postgresql'], replaced_by_id: null, replaced_by: null, owners: [],
  catalog_key: 'postgresql',
  versions: [
    { ...VERSION, id: 'v-19', label: '19', standard_support_end: '2031-11-13', catalog_key: 'postgresql:19' },
    { ...VERSION, id: 'v-own', label: '17 custom', standard_support_end: null, catalog_key: null },
  ],
} as TechnologyDetail;

function renderTab(technology: TechnologyDetail = TECHNOLOGY) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <TechnologyOverviewTab technology={technology} canManage onPatch={vi.fn()} onVersionsChanged={vi.fn(async () => undefined)} onError={vi.fn()} />
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('TechnologyOverviewTab', () => {
  it('says the versions follow the catalog and marks the versions that come from it', () => {
    renderTab();
    expect(screen.getByText('Versions and dates kept up to date from the catalog')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Versions' });
    const rows = within(table).getAllByRole('row');
    const catalogRow = rows.find((row) => within(row).queryByText('19'))!;
    const ownRow = rows.find((row) => within(row).queryByText('17 custom'))!;
    expect(within(catalogRow).getByText('Catalog')).toBeInTheDocument();
    expect(within(ownRow).queryByText('Catalog')).not.toBeInTheDocument();
  });

  it('shows no catalog line for a technology typed by hand', () => {
    renderTab({ ...TECHNOLOGY, catalog_key: null, versions: [{ ...TECHNOLOGY.versions[1] }] });
    expect(screen.queryByText('Versions and dates kept up to date from the catalog')).not.toBeInTheDocument();
    expect(screen.queryByText('Catalog')).not.toBeInTheDocument();
  });

  it('explains the catalog mark to a keyboard user', async () => {
    renderTab();
    const mark = screen.getByText('Catalog');
    expect(mark).toHaveAttribute('tabindex', '0');
    // Focus reached with the keyboard: MUI shows a tooltip on a focus that follows a key press.
    fireEvent.keyDown(document.body, { key: 'Tab' });
    act(() => mark.focus());
    expect(mark).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('From the catalog');
  });

  it('shows every end of support with its year, in the current year too', () => {
    const thisYear = new Date().getFullYear();
    renderTab({ ...TECHNOLOGY, versions: [{ ...TECHNOLOGY.versions[0], standard_support_end: `${thisYear}-11-12` }] });
    expect(screen.getByText(`12 Nov ${thisYear}`)).toBeInTheDocument();
  });

  it('asks before deleting a version and names the servers and applications that use it', async () => {
    vi.mocked(api.delete).mockClear();
    renderTab({
      ...TECHNOLOGY,
      versions: [{
        ...VERSION, id: 'v-used', label: '2019 (1809)', standard_support_end: null, catalog_key: null, servers: 2, applications: 1,
      }],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete version 2019 (1809)' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Delete version 2019 (1809)?')).toBeInTheDocument();
    expect(within(dialog).getByText('Version 2019 (1809) is used by 2 servers and 1 application. They will show "version unknown".')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('deletes an unused version only after confirmation', async () => {
    vi.mocked(api.delete).mockReset();
    vi.mocked(api.delete).mockResolvedValue({ data: {} });
    renderTab({
      ...TECHNOLOGY,
      versions: [{
        ...VERSION, id: 'v-free', label: '22.04 LTS', standard_support_end: null, catalog_key: null, servers: 0, applications: 0,
      }],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete version 22.04 LTS' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Version 22.04 LTS is used by no server and no application. This cannot be undone.')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/technologies/tech-1/versions/v-free'));
  });

  it('names no count when the detail did not bring one', async () => {
    renderTab({
      ...TECHNOLOGY,
      versions: [{ ...VERSION, id: 'v-plain', label: '16.99-c2check', standard_support_end: null, catalog_key: null }],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete version 16.99-c2check' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Version 16.99-c2check will be deleted. This cannot be undone.')).toBeInTheDocument();
    expect(within(dialog).queryByText(/server/)).not.toBeInTheDocument();
  });
});
