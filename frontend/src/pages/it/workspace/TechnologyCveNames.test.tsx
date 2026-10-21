import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../../api';
import { KanapDialogProvider } from '../../../components/design';
import { createAppTheme } from '../../../config/ThemeContext';
import { formatShortDate } from '../../../lib/dateFormat';
import TechnologyOverviewTab, { type TechnologyDetail } from './TechnologyOverviewTab';

const features = vi.hoisted(() => ({ vulnerabilityFeed: false, cveNames: true }));
vi.mock('../../../config/FeaturesContext', () => ({ useFeatures: () => ({ config: { features } }) }));

vi.mock('../../../api', () => ({
  default: { get: vi.fn(async () => ({ data: { items: [] } })), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const VERSION = { cpe_version: null, build_prefixes: [], extended_support_end: null, notes: null, standard_support_end: null, catalog_key: null };
const NAMES = [
  { vendor: 'SAP_SE', product: 'SAP S/4HANA (Private Cloud or On-Premise)', version: null },
  { vendor: 'Microsoft', product: 'Windows Server', version: '2019' },
];
const TECHNOLOGY = {
  id: 'tech-1', reference: 'TEC-1', name: 'Windows Server', editor: 'Microsoft', family: 'operating_system', hosting_type: 'on_prem',
  lifecycle: 'active', description: null, notes: null, cpe_products: ['o:microsoft:windows_server'], cve_names: NAMES,
  replaced_by_id: null, replaced_by: null, owners: [],
  versions: [{ ...VERSION, id: 'v-2019', label: '2019' }],
} as TechnologyDetail;

const DIRECTORY = {
  vendor: 'sap_se',
  product: 'SAP S/4HANA',
  cve_count: 12,
  last_published: '2024-03-12',
  sample_cves: ['CVE-2024-0001'],
};

function callsTo(url: string) {
  return vi.mocked(api.get).mock.calls.filter((call) => call[0] === url);
}

function renderTab(technology: TechnologyDetail = TECHNOLOGY, canManage = true, mode: 'light' | 'dark' = 'light') {
  const onPatch = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  const tree = (next: TechnologyDetail, manage: boolean) => (
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme(mode)}>
        <KanapDialogProvider>
          <TechnologyOverviewTab
            technology={next}
            canManage={manage}
            onPatch={onPatch}
            onVersionsChanged={vi.fn(async () => undefined)}
            onError={vi.fn()}
          />
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
  const view = render(tree(technology, canManage));
  // The names sit in the identifiers group, folded when the technology has an identifier.
  const toggle = screen.getByRole('button', { name: /Vulnerability identifiers/ });
  if (toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
  return {
    onPatch,
    unmount: view.unmount,
    rerender: (next: TechnologyDetail = technology, manage = canManage) => view.rerender(tree(next, manage)),
  };
}

function section() {
  return screen.getByRole('region', { name: 'CVE.org names' });
}

/** MUI clears an unfocused Autocomplete as soon as its input handler changes. */
function typeSearch(value: string) {
  const input = screen.getByRole('combobox', { name: 'CVE.org name' });
  act(() => { input.focus(); });
  fireEvent.change(input, { target: { value } });
  return input;
}

describe('TechnologyCveNames', () => {
  beforeEach(() => {
    features.cveNames = true;
    features.vulnerabilityFeed = false;
    vi.mocked(api.get).mockReset();
    vi.mocked(api.get).mockResolvedValue({ data: { items: [] } });
  });

  it('hides the section when CVE.org names are off and shows it when they are on', () => {
    features.cveNames = false;
    const hidden = renderTab();
    expect(screen.queryByRole('region', { name: 'CVE.org names' })).not.toBeInTheDocument();
    expect(screen.queryByText('SAP_SE · SAP S/4HANA (Private Cloud or On-Premise)')).not.toBeInTheDocument();
    hidden.unmount();

    features.cveNames = true;
    renderTab();
    expect(screen.getByRole('heading', { name: 'CVE.org names' })).toBeInTheDocument();
    expect(within(section()).getByText('SAP_SE · SAP S/4HANA (Private Cloud or On-Premise)')).toBeInTheDocument();
  });

  it('shows each name, with its version in a quiet suffix, and an empty line when there is none', () => {
    const filled = renderTab();
    const suffix = within(section()).getByText('· 2019');
    expect(suffix.closest('.MuiChip-root')).toHaveTextContent('Microsoft · Windows Server · 2019');
    filled.unmount();

    renderTab({ ...TECHNOLOGY, cve_names: [], cpe_products: [] });
    expect(screen.getByText('No name yet.')).toBeInTheDocument();
  });

  it('uses the same tertiary color as an empty CPE list, in light and dark mode', () => {
    for (const mode of ['light', 'dark'] as const) {
      const view = renderTab({ ...TECHNOLOGY, cve_names: [], cpe_products: [] }, true, mode);
      expect(getComputedStyle(screen.getByText('No name yet.')).color)
        .toBe(getComputedStyle(screen.getByText('No identifier yet.')).color);
      view.unmount();
    }
  });

  it('removes a name by sending the list without it', () => {
    const { onPatch } = renderTab();
    fireEvent.click(screen.getByLabelText('Remove Microsoft · Windows Server · 2019'));
    expect(onPatch).toHaveBeenCalledWith({
      cve_names: [{ vendor: 'SAP_SE', product: 'SAP S/4HANA (Private Cloud or On-Premise)', version: null }],
    });
  });

  it('does not search under 2 characters, then searches after a pause and shows the count and the date', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/vulnerabilities/cve-names') return { data: { items: [DIRECTORY] } };
      return { data: { items: [] } };
    });
    renderTab({ ...TECHNOLOGY, cve_names: [] });
    typeSearch('s');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)); });
    expect(callsTo('/vulnerabilities/cve-names')).toHaveLength(0);

    typeSearch('sap');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });
    expect(callsTo('/vulnerabilities/cve-names')).toHaveLength(0);
    const latest = formatShortDate('2024-03-12', 'en', { year: 'always' });
    const option = await screen.findByRole('option', { name: /SAP S\/4HANA/ });
    expect(callsTo('/vulnerabilities/cve-names')).toHaveLength(1);
    expect(callsTo('/vulnerabilities/cve-names')[0][1]).toEqual(expect.objectContaining({ params: { q: 'sap' } }));
    expect(option).toHaveTextContent('sap_se');
    expect(option).toHaveTextContent(`12 vulnerabilities, the latest on ${latest}`);
    expect(option).not.toHaveTextContent('CVE-2024-0001');
  });

  it('drops the directory search when typing resumes', async () => {
    const signals: AbortSignal[] = [];
    vi.mocked(api.get).mockImplementation((url, config) => {
      if (url !== '/vulnerabilities/cve-names') return Promise.resolve({ data: { items: [] } });
      const signal = (config as { signal?: AbortSignal } | undefined)?.signal;
      if (signal) signals.push(signal);
      return new Promise((_resolve, reject) => {
        const cancel = () => reject(Object.assign(new Error('canceled'), { name: 'CanceledError', code: 'ERR_CANCELED' }));
        if (!signal || signal.aborted) { cancel(); return; }
        signal.addEventListener('abort', cancel);
      });
    });
    renderTab();
    const input = typeSearch('sap');
    await waitFor(() => expect(signals).toHaveLength(1));
    expect(signals[0].aborted).toBe(false);
    fireEvent.change(input, { target: { value: 'sapp' } });
    expect(signals[0].aborted).toBe(true);
  });

  it('adds the chosen name with the version typed, and refuses a duplicate without saving', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/vulnerabilities/cve-names') return { data: { items: [DIRECTORY] } };
      return { data: { items: [] } };
    });
    const technology = {
      ...TECHNOLOGY,
      cve_names: [{ vendor: 'SAP SE', product: 'SAP S/4HANA', version: null }],
    } as TechnologyDetail;
    const { onPatch } = renderTab(technology);
    typeSearch('sap');
    fireEvent.click(await screen.findByRole('option', { name: /SAP S\/4HANA/ }));
    const version = screen.getByRole('textbox', { name: 'Version (optional)' });
    const add = within(section()).getByRole('button', { name: 'Add' });
    expect(add).toBeEnabled();
    fireEvent.click(add);
    expect(onPatch).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('This name is already listed.');

    fireEvent.change(version, { target: { value: '2019' } });
    fireEvent.click(within(section()).getByRole('button', { name: 'Add' }));
    expect(onPatch).toHaveBeenCalledWith({
      cve_names: [
        { vendor: 'SAP SE', product: 'SAP S/4HANA', version: null },
        { vendor: 'sap_se', product: 'SAP S/4HANA', version: '2019' },
      ],
    });
  });

  it('shows a server error under the field and keeps the typed version', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/vulnerabilities/cve-names') return { data: { items: [DIRECTORY] } };
      return { data: { items: [] } };
    });
    const { onPatch } = renderTab({ ...TECHNOLOGY, cve_names: [] });
    onPatch.mockRejectedValue({ response: { status: 400, data: { message: 'A technology carries at most 50 CVE names.', error: 'Bad Request' } } });
    typeSearch('sap');
    fireEvent.click(await screen.findByRole('option', { name: /SAP S\/4HANA/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Version (optional)' }), { target: { value: '2019' } });
    fireEvent.click(within(section()).getByRole('button', { name: 'Add' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A technology carries at most 50 CVE names.');
    expect(screen.getByRole('textbox', { name: 'Version (optional)' })).toHaveValue('2019');
  });

  it('shows three suggestions, unfolds the rest, and adds one immediately', async () => {
    const suggestions = [
      { vendor: 'Microsoft', product: 'Windows Server 2016', cve_count: 4, share: 0.4, total_cve_count: 20, last_published: '2024-01-01' },
      { vendor: 'Microsoft', product: 'Windows Server 2019', cve_count: 8, share: 0.5, total_cve_count: 30, last_published: '2024-02-01' },
      { vendor: 'Microsoft', product: 'Windows Server 2022', cve_count: 6, share: 0.25, total_cve_count: 40, last_published: '2024-03-01' },
      { vendor: 'Microsoft', product: 'Windows Server 2025', cve_count: 3, share: 0.2, total_cve_count: 10, last_published: '2025-01-01' },
      { vendor: 'Microsoft', product: 'Windows 10', cve_count: 9, share: 0.33, total_cve_count: 50, last_published: '2024-04-01' },
    ];
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (String(url).endsWith('/cve-names/suggestions')) return { data: { items: suggestions } };
      return { data: { items: [] } };
    });
    const { onPatch, rerender } = renderTab({ ...TECHNOLOGY, cve_names: [] });
    expect(await screen.findByText('Seen on the vulnerabilities of your CPE identifiers')).toBeInTheDocument();
    const body = section();
    expect(within(body).getByText('Microsoft · Windows Server 2016')).toBeInTheDocument();
    expect(within(body).getByText('Microsoft · Windows Server 2019')).toBeInTheDocument();
    expect(within(body).getByText('Microsoft · Windows Server 2022')).toBeInTheDocument();
    expect(within(body).getByText('8 vulnerabilities (50%)')).toBeInTheDocument();
    expect(within(body).queryByText('Microsoft · Windows Server 2025')).not.toBeInTheDocument();
    expect(within(body).queryByText('Microsoft · Windows 10')).not.toBeInTheDocument();
    fireEvent.click(within(body).getByRole('button', { name: 'See the 2 others' }));
    expect(within(body).getByText('Microsoft · Windows Server 2025')).toBeInTheDocument();
    expect(within(body).getByText('Microsoft · Windows 10')).toBeInTheDocument();
    expect(within(body).queryByRole('button', { name: /See the/ })).not.toBeInTheDocument();

    fireEvent.click(within(body).getByRole('button', { name: 'Add Microsoft · Windows Server 2025' }));
    expect(onPatch).toHaveBeenCalledWith({
      cve_names: [{ vendor: 'Microsoft', product: 'Windows Server 2025', version: null }],
    });

    rerender({ ...TECHNOLOGY, cve_names: [], cpe_products: ['o:microsoft:windows_server', 'o:microsoft:windows'] });
    await waitFor(() => expect(callsTo('/technologies/tech-1/cve-names/suggestions')).toHaveLength(2));
    rerender({
      ...TECHNOLOGY,
      cpe_products: ['o:microsoft:windows_server', 'o:microsoft:windows'],
      cve_names: [{ vendor: 'Microsoft', product: 'Windows Server 2025', version: null }],
    });
    await waitFor(() => expect(callsTo('/technologies/tech-1/cve-names/suggestions')).toHaveLength(3));
  });

  it('shows no suggestion block when there is nothing to suggest, and does not ask without a CPE identifier', async () => {
    const asked = renderTab();
    await waitFor(() => expect(callsTo('/technologies/tech-1/cve-names/suggestions')).toHaveLength(1));
    expect(screen.queryByText('Seen on the vulnerabilities of your CPE identifiers')).not.toBeInTheDocument();
    asked.unmount();

    vi.mocked(api.get).mockClear();
    renderTab({ ...TECHNOLOGY, cpe_products: [] });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(callsTo('/technologies/tech-1/cve-names/suggestions')).toHaveLength(0);
    expect(screen.queryByText('Seen on the vulnerabilities of your CPE identifiers')).not.toBeInTheDocument();
  });

  it('explains where the name is written and what a version does', () => {
    renderTab();
    const link = within(section()).getByRole('link', { name: 'cve.org' });
    expect(link).toHaveAttribute('href', 'https://www.cve.org');
    expect(within(section()).getByText(/Type part of the product name: the list offers the exact names publishers write on their records, with their number of vulnerabilities\. A name must match the one on the record, in its Product status section on/)).toBeInTheDocument();
    expect(within(section()).getByText(/A version limits the name to the technology versions whose label starts with it, e\.g\., 2019\./)).toBeInTheDocument();
  });

  it('offers no command to a reader', () => {
    renderTab(TECHNOLOGY, false);
    const body = section();
    expect(within(body).getByText('· 2019').closest('.MuiChip-root')).toHaveTextContent('Microsoft · Windows Server · 2019');
    expect(within(body).queryByRole('button')).not.toBeInTheDocument();
    expect(within(body).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(body).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(body).queryByLabelText(/Remove/)).not.toBeInTheDocument();
    expect(screen.queryByText('Seen on the vulnerabilities of your CPE identifiers')).not.toBeInTheDocument();
    expect(within(body).getByRole('link', { name: 'cve.org' })).toBeInTheDocument();
  });
});
