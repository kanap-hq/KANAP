import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import api from '../../../api';
import OperatingSystemField from './OperatingSystemField';
import type { AssetTechnologyRow } from './AssetTechnologiesSection';

const translation = {
  t: (key: string, opts?: Record<string, unknown>) => {
    const args = opts ? Object.entries(opts).filter(([k]) => k !== 'defaultValue').map(([k, v]) => `${k}=${v}`).join(',') : '';
    return args ? `${key}(${args})` : key;
  },
  i18n: { language: 'en', resolvedLanguage: 'en' },
};
vi.mock('react-i18next', () => ({
  useTranslation: () => translation,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));
vi.mock('../../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

const mocked = vi.mocked(api);
const picker = () => within(document.querySelector('.MuiPopover-paper') as HTMLElement);

const MARKED: AssetTechnologyRow = {
  kind: 'installed', removable: true, link_id: 'l-os', technology_id: 'ubuntu', technology_name: 'Ubuntu',
  technology_reference: 'TEC-2', family: 'operating_system', technology_version_id: 'v22', version_label: '22.04 LTS',
  via_asset_id: null, via_asset_name: null, is_operating_system: true,
};

function renderField(props: Partial<React.ComponentProps<typeof OperatingSystemField>> = {}) {
  mocked.get.mockImplementation(async (url: string, config?: any) => {
    if (url === '/assets/asset-1/technologies') return { data: { items: [MARKED] } } as never;
    if (url === '/technologies' && config?.params?.family === 'operating_system') {
      return { data: { items: [{ id: 'ubuntu', name: 'Ubuntu', reference: 'TEC-2', editor: 'Canonical', family: 'operating_system', lifecycle: 'active' }] } } as never;
    }
    if (url === '/technologies/lookup') {
      return { data: { items: [
        { id: 'tomcat', name: 'Tomcat', reference: 'TEC-5', editor: 'Apache', family: 'runtime' },
        { id: 'ubuntu', name: 'Ubuntu', reference: 'TEC-2', editor: 'Canonical', family: 'operating_system' },
      ] } } as never;
    }
    if (url === '/technologies/catalog') return { data: { items: [{ key: 'debian', name: 'Debian', editor: 'Debian' }] } } as never;
    if (url === '/technologies/ubuntu/versions') {
      return { data: { items: [{ id: 'v22', label: '22.04 LTS', standard_support_end: '2027-06-01', extended_support_end: '2032-04-21' }] } } as never;
    }
    if (url === '/technologies/deb-id/versions') return { data: { items: [{ id: 'v12', label: '12 (Bookworm)' }] } } as never;
    if (url.endsWith('/versions')) return { data: { items: [] } } as never;
    throw new Error(`unexpected GET ${url}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <OperatingSystemField assetId="asset-1" {...props} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocked.get.mockReset();
  mocked.post.mockReset();
  mocked.put.mockReset();
  mocked.delete.mockReset();
  mocked.post.mockImplementation(async (url: string) => {
    if (url === '/technologies/adopt') return { data: { technology: { id: 'deb-id', name: 'Debian', reference: 'TEC-9' } } } as never;
    throw new Error(`unexpected POST ${url}`);
  });
  mocked.put.mockResolvedValue({ data: { ok: true } } as never);
  mocked.delete.mockResolvedValue({ data: { ok: true } } as never);
});

describe('OperatingSystemField', () => {
  it('shows the marked technology and its version', async () => {
    renderField();
    expect(await screen.findByDisplayValue('Ubuntu')).toBeTruthy();
    expect(screen.getByDisplayValue('22.04 LTS')).toBeTruthy();
  });

  it('shows the support dates of the version chosen', async () => {
    renderField();
    const dates = await screen.findByTestId('os-support-dates');
    expect(dates.textContent).toContain('workspace.asset.technical.standardSupportEnds(date=');
    expect(dates.textContent).toContain('2027');
    expect(dates.textContent).toContain('workspace.asset.technical.extendedSupportEnds(date=');
    expect(dates.textContent).toContain('2032');
    expect(screen.queryByText('workspace.asset.technical.osChooseHint')).toBeNull();
  });

  it('keeps the cluster hint instead of the dates', async () => {
    renderField({ isCluster: true });
    expect(await screen.findByDisplayValue('22.04 LTS')).toBeTruthy();
    expect(screen.getByText('workspace.asset.technical.osClusterHint')).toBeTruthy();
    expect(screen.queryByTestId('os-support-dates')).toBeNull();
  });

  it('offers operating systems first, then other technologies, then the catalog', async () => {
    renderField();
    fireEvent.click(await screen.findByRole('textbox', { name: 'workspace.asset.technical.osTechnology' }));
    const options = await waitFor(() => picker().getAllByRole('option'));
    expect(options.map((option) => option.textContent)).toEqual([
      'TEC-2UbuntuCanonical',
      'TEC-5TomcatApache',
      'Debianworkspace.asset.technologies.catalog',
    ]);
  });

  it('saves the technology and the version on the marked link', async () => {
    renderField();
    fireEvent.click(await screen.findByRole('textbox', { name: 'workspace.asset.technical.osTechnology' }));
    fireEvent.click(await waitFor(() => picker().getByText('Tomcat')));
    fireEvent.click(await waitFor(() => picker().getByText('workspace.technology.versionPicker.unknown')));
    await waitFor(() => expect(mocked.put).toHaveBeenCalledWith('/assets/asset-1/operating-system', {
      technology_id: 'tomcat',
      technology_version_id: null,
    }));
  });

  it('adopts a catalog product, then saves the version chosen', async () => {
    renderField();
    fireEvent.click(await screen.findByRole('textbox', { name: 'workspace.asset.technical.osTechnology' }));
    fireEvent.click(await waitFor(() => picker().getByText('Debian')));
    expect(mocked.post).toHaveBeenCalledWith('/technologies/adopt', { catalog_key: 'debian', language: 'en' });
    fireEvent.click(await waitFor(() => picker().getByText('12 (Bookworm)')));
    await waitFor(() => expect(mocked.put).toHaveBeenCalledWith('/assets/asset-1/operating-system', {
      technology_id: 'deb-id',
      technology_version_id: 'v12',
    }));
  });

  it('clears the operating system', async () => {
    renderField();
    fireEvent.click(await screen.findByText('workspace.asset.technical.osClear'));
    await waitFor(() => expect(mocked.delete).toHaveBeenCalledWith('/assets/asset-1/operating-system'));
  });

  it('reports a readable label while the server is being created', async () => {
    const onLabelChange = vi.fn();
    renderField({ assetId: undefined, onLabelChange });
    fireEvent.click(screen.getByRole('textbox', { name: 'workspace.asset.technical.osTechnology' }));
    fireEvent.click(await waitFor(() => picker().getByText('Ubuntu')));
    fireEvent.click(await waitFor(() => picker().getByText('22.04 LTS')));
    await waitFor(() => expect(onLabelChange).toHaveBeenCalledWith('Ubuntu 22.04 LTS'));
    expect(mocked.put).not.toHaveBeenCalled();
  });
});
