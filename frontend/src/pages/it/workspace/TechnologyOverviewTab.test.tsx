import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import api from '../../../api';
import { KanapDialogProvider } from '../../../components/design';
import { createAppTheme } from '../../../config/ThemeContext';
import TechnologyOverviewTab, { type TechnologyDetail } from './TechnologyOverviewTab';

vi.mock('../../../api', () => ({
  default: { get: vi.fn(async () => ({ data: { items: [] } })), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

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

function renderTab(technology: TechnologyDetail = TECHNOLOGY, canManage = true) {
  const onVersionsChanged = vi.fn(async () => undefined);
  const onError = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <TechnologyOverviewTab
            technology={technology}
            canManage={canManage}
            onPatch={vi.fn()}
            onVersionsChanged={onVersionsChanged}
            onError={onError}
          />
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { onVersionsChanged, onError };
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

  it('turns technology alerts on without asking when no version has its own setting', async () => {
    vi.mocked(api.put).mockReset();
    vi.mocked(api.put)
      .mockResolvedValueOnce({ data: { versions_reset: 0 } })
      .mockResolvedValueOnce({ data: { enabled: true, versions_reset: 0 } });
    const { onVersionsChanged } = renderTab();
    const header = screen.getByRole('switch', { name: 'Vulnerability alerts' });
    expect(header).not.toBeChecked();
    fireEvent.mouseOver(header.parentElement!);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Technology setting: it applies to versions without their own setting, to versions added later, and to links with no version.',
    );
    fireEvent.click(header);
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2));
    expect(api.put).toHaveBeenNthCalledWith(
      1,
      '/technologies/tech-1/vulnerability-alerts',
      { enabled: true },
      { params: { dry_run: true } },
    );
    expect(api.put).toHaveBeenNthCalledWith(2, '/technologies/tech-1/vulnerability-alerts', { enabled: true });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onVersionsChanged).toHaveBeenCalledTimes(1);
    const cell = header.closest('th');
    expect(cell).not.toBeNull();
    expect(getComputedStyle(cell!).maxWidth).toBe('56px');
  });

  it('asks before replacing version settings and writes only after confirmation', async () => {
    vi.mocked(api.put).mockReset();
    vi.mocked(api.put).mockResolvedValue({ data: { versions_reset: 2, enabled: false } });
    const { onVersionsChanged } = renderTab({ ...TECHNOLOGY, vulnerability_alerts: true });
    const header = screen.getByRole('switch', { name: 'Vulnerability alerts' });
    expect(header).toBeChecked();
    fireEvent.click(header);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Vulnerability alerts' })).toBeInTheDocument();
    expect(within(dialog).getByText('2 versions have their own setting. It will be replaced.')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(api.put).toHaveBeenCalledWith(
      '/technologies/tech-1/vulnerability-alerts',
      { enabled: false },
      { params: { dry_run: true } },
    );
    expect(onVersionsChanged).not.toHaveBeenCalled();

    await waitFor(() => expect(screen.getByRole('switch', { name: 'Vulnerability alerts' })).toBeEnabled());
    fireEvent.click(screen.getByRole('switch', { name: 'Vulnerability alerts' }));
    const again = await screen.findByRole('dialog');
    fireEvent.click(within(again).getByRole('button', { name: 'Replace' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(3));
    expect(api.put).toHaveBeenNthCalledWith(2, '/technologies/tech-1/vulnerability-alerts', { enabled: false }, { params: { dry_run: true } });
    expect(api.put).toHaveBeenNthCalledWith(3, '/technologies/tech-1/vulnerability-alerts', { enabled: false });
    expect(onVersionsChanged).toHaveBeenCalledTimes(1);
  });

  it('clears a version exception when the switch matches the technology and stores the other value', async () => {
    vi.mocked(api.patch).mockReset();
    vi.mocked(api.patch).mockResolvedValue({ data: {} });
    const technology = {
      ...TECHNOLOGY,
      vulnerability_alerts: true,
      versions: [
        { ...VERSION, id: 'v-follow', label: '16', standard_support_end: null, catalog_key: null, vulnerability_alerts: null, vulnerability_alerts_effective: true },
        { ...VERSION, id: 'v-own', label: '15', standard_support_end: null, catalog_key: null, vulnerability_alerts: false, vulnerability_alerts_effective: false },
      ],
    } as TechnologyDetail;
    const { onVersionsChanged } = renderTab(technology);
    expect(screen.getAllByRole('img', { name: 'Own setting for this version' })).toHaveLength(1);

    fireEvent.click(screen.getByRole('switch', { name: 'Vulnerability alerts for 16' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith(
      '/technologies/tech-1/versions/v-follow',
      { vulnerability_alerts: false },
    ));
    fireEvent.click(screen.getByRole('switch', { name: 'Vulnerability alerts for 15' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith(
      '/technologies/tech-1/versions/v-own',
      { vulnerability_alerts: null },
    ));
    expect(onVersionsChanged).toHaveBeenCalledTimes(2);
  });

  it('keeps the alert switches disabled for a reader and still marks an own setting', () => {
    renderTab({
      ...TECHNOLOGY,
      vulnerability_alerts: true,
      versions: [{
        ...VERSION, id: 'v-own', label: '15', standard_support_end: null, catalog_key: null,
        vulnerability_alerts: false, vulnerability_alerts_effective: false,
      }],
    }, false);
    expect(screen.getByRole('switch', { name: 'Vulnerability alerts' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Vulnerability alerts for 15' })).toBeDisabled();
    expect(screen.getByRole('img', { name: 'Own setting for this version' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete version 15' })).not.toBeInTheDocument();
  });

  it('keeps the technology alert switch when there is no version', () => {
    renderTab({ ...TECHNOLOGY, versions: [], vulnerability_alerts: false });
    expect(screen.getByRole('switch', { name: 'Vulnerability alerts' })).toBeInTheDocument();
    expect(screen.getByText('No version yet.')).toBeInTheDocument();
  });
});
