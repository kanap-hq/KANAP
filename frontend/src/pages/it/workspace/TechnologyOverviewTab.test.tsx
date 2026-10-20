import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import api from '../../../api';
import { KanapDialogProvider } from '../../../components/design';
import { createAppTheme } from '../../../config/ThemeContext';
import TechnologyOverviewTab, { type TechnologyDetail } from './TechnologyOverviewTab';

const features = vi.hoisted(() => ({ vulnerabilityFeed: true }));
vi.mock('../../../config/FeaturesContext', () => ({ useFeatures: () => ({ config: { features } }) }));

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

function renderTab(technology: TechnologyDetail = TECHNOLOGY, canManage = true, mode: 'light' | 'dark' = 'light') {
  const onVersionsChanged = vi.fn(async () => undefined);
  const onError = vi.fn();
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const view = render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme(mode)}>
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
  return { onVersionsChanged, onError, invalidate, unmount: view.unmount };
}

const ALERT_VERSIONS = {
  ...TECHNOLOGY,
  vulnerability_alerts: true,
  versions: [
    { ...VERSION, id: 'v-follow', label: '16', standard_support_end: null, catalog_key: null, vulnerability_alerts: null, vulnerability_alerts_effective: true },
  ],
} as TechnologyDetail;

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
    const title = screen.getByRole('heading', { name: 'Versions' }).parentElement!;
    const header = within(title).getByRole('switch', { name: 'Include in vulnerability alerts' });
    expect(within(title).getByText('Include in vulnerability alerts')).toBeInTheDocument();
    expect(within(title).getByRole('button', { name: 'Add version' })).toBeInTheDocument();
    expect(header).not.toBeChecked();
    const table = screen.getByRole('table', { name: 'Versions' });
    const column = within(table).getByRole('columnheader', { name: /Alerts/ });
    expect(within(column).queryByRole('switch')).toBeNull();
    const hint = 'Includes this version in vulnerability alerts: the Vulnerabilities page, the counts and the summary email. Each version follows the technology setting unless a dot marks its own setting.';
    const info = within(column).getByRole('img', { name: hint });
    fireEvent.keyDown(document.body, { key: 'Tab' });
    act(() => info.focus());
    expect(await screen.findByRole('tooltip')).toHaveTextContent(hint);
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
  });

  it('explains the technology switch and packs the Alerts title to the switches edge', async () => {
    renderTab();
    const title = screen.getByRole('heading', { name: 'Versions' }).parentElement!;
    const header = within(title).getByRole('switch', { name: 'Include in vulnerability alerts' });
    fireEvent.mouseOver(header);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Technology setting: it applies to versions without their own setting, to versions added later, and to links with no version.',
    );
    const column = within(screen.getByRole('table', { name: 'Versions' })).getByRole('columnheader', { name: /Alerts/ });
    const info = within(column).getByRole('img');
    expect(getComputedStyle(info.parentElement!).justifyContent).toBe('flex-end');
  });

  it('asks before replacing version settings and writes only after confirmation', async () => {
    vi.mocked(api.put).mockReset();
    vi.mocked(api.put).mockResolvedValue({ data: { versions_reset: 2, enabled: false } });
    const { onVersionsChanged } = renderTab({ ...TECHNOLOGY, vulnerability_alerts: true });
    const header = screen.getByRole('switch', { name: 'Include in vulnerability alerts' });
    expect(header).toBeChecked();
    fireEvent.click(header);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Vulnerability alerts' })).toBeInTheDocument();
    expect(within(dialog).getByText('2 versions have their own setting. They will be replaced.')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(api.put).toHaveBeenCalledWith(
      '/technologies/tech-1/vulnerability-alerts',
      { enabled: false },
      { params: { dry_run: true } },
    );
    expect(onVersionsChanged).not.toHaveBeenCalled();

    await waitFor(() => expect(screen.getByRole('switch', { name: 'Include in vulnerability alerts' })).toBeEnabled());
    fireEvent.click(screen.getByRole('switch', { name: 'Include in vulnerability alerts' }));
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
    expect(screen.getByRole('switch', { name: 'Include in vulnerability alerts' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Vulnerability alerts for 15' })).toBeDisabled();
    expect(screen.getByRole('img', { name: 'Own setting for this version' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete version 15' })).not.toBeInTheDocument();
  });

  it('shows no alerts column without the vulnerability feed', () => {
    features.vulnerabilityFeed = false;
    try {
      renderTab(TECHNOLOGY);
      expect(screen.queryByRole('switch')).toBeNull();
      expect(screen.getByText('19')).toBeInTheDocument();
    } finally {
      features.vulnerabilityFeed = true;
    }
  });

  it('keeps the technology alert switch when there is no version', () => {
    renderTab({ ...TECHNOLOGY, versions: [], vulnerability_alerts: false });
    expect(screen.getByRole('switch', { name: 'Include in vulnerability alerts' })).toBeInTheDocument();
    expect(screen.getByText('No version yet.')).toBeInTheDocument();
  });

  it('marks the vulnerability queries stale after each alert write', async () => {
    vi.mocked(api.patch).mockReset();
    vi.mocked(api.patch).mockResolvedValue({ data: {} });
    vi.mocked(api.put).mockReset();
    vi.mocked(api.put).mockResolvedValue({ data: { versions_reset: 0, enabled: false } });
    const { invalidate, onVersionsChanged } = renderTab(ALERT_VERSIONS);
    fireEvent.click(screen.getByRole('switch', { name: 'Vulnerability alerts for 16' }));
    await waitFor(() => expect(onVersionsChanged).toHaveBeenCalledTimes(1));
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenLastCalledWith({ queryKey: ['vulnerabilities'] });

    await waitFor(() => expect(screen.getByRole('switch', { name: 'Include in vulnerability alerts' })).toBeEnabled());
    fireEvent.click(screen.getByRole('switch', { name: 'Include in vulnerability alerts' }));
    await waitFor(() => expect(onVersionsChanged).toHaveBeenCalledTimes(2));
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenLastCalledWith({ queryKey: ['vulnerabilities'] });
  });

  it('reports a failed alert write and leaves the switches usable', async () => {
    vi.mocked(api.patch).mockReset();
    vi.mocked(api.patch).mockRejectedValue({ response: { status: 500, data: { message: 'Version write refused' } } });
    vi.mocked(api.put).mockReset();
    vi.mocked(api.put).mockRejectedValue({ response: { status: 500, data: { message: 'Preview refused' } } });
    const { invalidate, onVersionsChanged, onError } = renderTab(ALERT_VERSIONS);

    fireEvent.click(screen.getByRole('switch', { name: 'Vulnerability alerts for 16' }));
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Vulnerability alerts for 16' })).toBeEnabled());
    expect(screen.getByRole('switch', { name: 'Vulnerability alerts for 16' })).toBeChecked();

    fireEvent.click(screen.getByRole('switch', { name: 'Include in vulnerability alerts' }));
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(2));
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Include in vulnerability alerts' })).toBeEnabled());
    expect(screen.getByRole('switch', { name: 'Include in vulnerability alerts' })).toBeChecked();
    expect(onVersionsChanged).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('writes once when a switch is clicked twice during the write', async () => {
    vi.mocked(api.patch).mockReset();
    let release: (value: { data: object }) => void = () => undefined;
    vi.mocked(api.patch).mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const { onVersionsChanged } = renderTab(ALERT_VERSIONS);
    const row = screen.getByRole('switch', { name: 'Vulnerability alerts for 16' });
    fireEvent.click(row);
    fireEvent.click(row);
    fireEvent.click(screen.getByRole('switch', { name: 'Include in vulnerability alerts' }));
    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(api.put).not.toHaveBeenCalled();
    await act(async () => { release({ data: {} }); });
    await waitFor(() => expect(onVersionsChanged).toHaveBeenCalledTimes(1));
    expect(api.patch).toHaveBeenCalledTimes(1);
  });

  it('keeps every alert switch at the same place, with or without the own-setting dot', () => {
    renderTab({
      ...ALERT_VERSIONS,
      versions: [
        ...ALERT_VERSIONS.versions,
        { ...VERSION, id: 'v-own', label: '15', standard_support_end: null, catalog_key: null, vulnerability_alerts: false, vulnerability_alerts_effective: false },
      ],
    });
    const slots = ['Vulnerability alerts for 16', 'Vulnerability alerts for 15'].map((name) => {
      const row = screen.getByRole('switch', { name }).closest('td')!.firstElementChild as HTMLElement;
      // Trailing edge: every version switch lines up, the own-setting slot kept on each row.
      expect(getComputedStyle(row).justifyContent).toBe('flex-end');
      return row.lastElementChild!.children.length;
    });
    expect(slots).toEqual([2, 2]);
    const title = screen.getByRole('heading', { name: 'Versions' }).parentElement!;
    expect(within(title).getByRole('switch', { name: 'Include in vulnerability alerts' })).toBeInTheDocument();
    expect(within(screen.getByRole('table', { name: 'Versions' })).queryByRole('switch', { name: 'Include in vulnerability alerts' })).toBeNull();
    expect(screen.getAllByRole('img', { name: 'Own setting for this version' })).toHaveLength(1);
  });

  it('names the alerts column like the other headers and keeps the table inside 1000px', () => {
    const pixelWidth = (cell: Element) => {
      const width = getComputedStyle(cell).width;
      const value = width.endsWith('px') ? parseFloat(width) : 0;
      return Number.isFinite(value) ? value : 0;
    };
    for (const mode of ['light', 'dark'] as const) {
      const view = renderTab({
        ...ALERT_VERSIONS,
        versions: [
          ...ALERT_VERSIONS.versions,
          { ...VERSION, id: 'v-own', label: '15', standard_support_end: null, catalog_key: null, vulnerability_alerts: false, vulnerability_alerts_effective: false },
        ],
      }, true, mode);
      const table = screen.getByRole('table', { name: 'Versions' });
      const headers = within(table).getAllByRole('columnheader');
      const header = headers.find((cell) => within(cell).queryByText('Alerts'));
      expect(header).toBeTruthy();
      const title = within(header!).getByText('Alerts');
      const status = within(table).getByRole('columnheader', { name: 'Status' });
      expect(getComputedStyle(title).fontSize).toBe(getComputedStyle(status).fontSize);
      expect(getComputedStyle(title).fontWeight).toBe(getComputedStyle(status).fontWeight);
      expect(getComputedStyle(title).color).toBe(getComputedStyle(status).color);
      expect(getComputedStyle(header!).whiteSpace).toBe('nowrap');
      expect(within(header!).queryByRole('switch')).toBeNull();
      expect(within(header!).getByRole('img', { name: /Includes this version in vulnerability alerts/ })).toBeTruthy();
      // The title and its icon, still narrow: the fixed columns leave the version column room at 1000px.
      expect(pixelWidth(header!)).toBeGreaterThan(40);
      expect(pixelWidth(header!)).toBeLessThan(200);
      expect(headers.reduce((sum, cell) => sum + pixelWidth(cell), 0)).toBeLessThan(1000);
      view.unmount();
    }
  });
});
