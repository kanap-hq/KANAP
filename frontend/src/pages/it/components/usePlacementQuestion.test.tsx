import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import api from '../../../api';
import usePlacementQuestion, { type PlacementInput, type PlacementOutcome } from './usePlacementQuestion';

const translation = {
  t: (key: string, opts?: Record<string, unknown>) => {
    const args = opts ? Object.entries(opts).filter(([name]) => name !== 'defaultValue').map(([name, value]) => `${name}=${value}`).join(',') : '';
    return args ? `${key}(${args})` : key;
  },
  i18n: { language: 'en', resolvedLanguage: 'en' },
};

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => translation,
}));
vi.mock('../../../api', () => ({ default: { get: vi.fn() } }));

const mocked = vi.mocked(api);

const member = (id: string, name: string, status = 'active') => ({ id, name, status });

function Harness({ input }: { input: PlacementInput }) {
  const { resolvePlacement, placementDialog } = usePlacementQuestion();
  const [outcome, setOutcome] = React.useState<PlacementOutcome | null>(null);
  return (
    <ThemeProvider theme={createAppTheme('light')}>
      <button type="button" onClick={() => { void resolvePlacement(input).then(setOutcome); }}>ask</button>
      <div data-testid="outcome">{outcome ? `${outcome.status}:${outcome.status === 'ok' ? outcome.clusterId ?? 'none' : ''}` : 'pending'}</div>
      {placementDialog}
    </ThemeProvider>
  );
}

function ask(input: PlacementInput = { hostId: 'host-1', excludeClusterIds: [] }) {
  render(<Harness input={input} />);
  fireEvent.click(screen.getByRole('button', { name: 'ask' }));
}

const outcome = () => screen.getByTestId('outcome').textContent;

describe('usePlacementQuestion', () => {
  beforeEach(() => {
    mocked.get.mockReset();
  });

  it('asks nothing for a host of no cluster', async () => {
    mocked.get.mockResolvedValue({ data: { items: [] } } as never);
    ask();
    expect(await screen.findByText('ok:none')).toBeTruthy();
    expect(screen.queryByText('components.clusterPlacement.title')).toBeNull();
    expect(mocked.get).toHaveBeenCalledTimes(1);
    expect(mocked.get).toHaveBeenCalledWith('/assets/host-1/clusters');
  });

  it('asks for the only cluster, counts its hosts in service and places there', async () => {
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/assets/host-1/clusters') return { data: { items: [{ id: 'cl-1', name: 'PAR-VSPHERE-CL01', status: 'active' }] } } as never;
      if (url === '/assets/cl-1/members') return { data: { items: [member('host-1', 'esx-01'), member('host-2', 'esx-02'), member('host-3', 'esx-03', 'retired')] } } as never;
      return { data: { items: [] } } as never;
    });
    ask();
    expect(await screen.findByText('components.clusterPlacement.title')).toBeTruthy();
    expect(screen.getByText('components.clusterPlacement.inCluster(host=esx-01,cluster=PAR-VSPHERE-CL01,count=2)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'components.clusterPlacement.placeInCluster' }));
    expect(await screen.findByText('ok:cl-1')).toBeTruthy();
    expect(screen.queryByText('components.clusterPlacement.title')).toBeNull();
  });

  it('keeps the link on the host only', async () => {
    mocked.get.mockImplementation(async (url: string) => (
      url === '/assets/host-1/clusters'
        ? { data: { items: [{ id: 'cl-1', name: 'PAR-VSPHERE-CL01', status: 'active' }] } }
        : { data: { items: [member('host-1', 'esx-01')] } }
    ) as never);
    ask();
    fireEvent.click(await screen.findByRole('button', { name: 'components.clusterPlacement.hostOnly' }));
    expect(await screen.findByText('ok:none')).toBeTruthy();
  });

  it('cancels when the dialog closes', async () => {
    mocked.get.mockImplementation(async (url: string) => (
      url === '/assets/host-1/clusters'
        ? { data: { items: [{ id: 'cl-1', name: 'PAR-VSPHERE-CL01', status: 'active' }] } }
        : { data: { items: [member('host-1', 'esx-01')] } }
    ) as never);
    ask();
    fireEvent.click(await screen.findByRole('button', { name: 'buttons.cancel' }));
    expect(await screen.findByText('cancelled:')).toBeTruthy();
  });

  it('offers each cluster of a host of several, with the count of its hosts in service', async () => {
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/assets/host-1/clusters') return { data: { items: [
        { id: 'cl-1', name: 'FIRST-CL', status: 'active' },
        { id: 'cl-2', name: 'SECOND-CL', status: 'active' },
      ] } } as never;
      if (url === '/assets/cl-1/members') return { data: { items: [member('host-1', 'esx-01'), member('host-2', 'esx-02')] } } as never;
      if (url === '/assets/cl-2/members') return { data: { items: [member('host-1', 'esx-01'), member('host-3', 'esx-03', 'retired')] } } as never;
      return { data: { items: [] } } as never;
    });
    ask();
    expect(await screen.findByText('components.clusterPlacement.inClusters(host=esx-01)')).toBeTruthy();
    const second = screen.getByRole('radio', { name: /SECOND-CL/ });
    expect(screen.getByText(/memberCount\(count=1\)/)).toBeTruthy();
    fireEvent.click(second);
    fireEvent.click(screen.getByRole('button', { name: 'components.clusterPlacement.placeInCluster' }));
    expect(await screen.findByText('ok:cl-2')).toBeTruthy();
  });

  it('raises no question for a retired cluster, a retired host or an excluded cluster', async () => {
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/assets/host-1/clusters') return { data: { items: [
        { id: 'cl-1', name: 'RETIRED-CL', status: 'retired' },
        { id: 'cl-2', name: 'EXCLUDED-CL', status: 'active' },
        { id: 'cl-3', name: 'HOST-RETIRED-CL', status: 'active' },
      ] } } as never;
      if (url === '/assets/cl-3/members') return { data: { items: [member('host-1', 'esx-01', 'retired')] } } as never;
      return { data: { items: [] } } as never;
    });
    ask({ hostId: 'host-1', excludeClusterIds: ['cl-2'] });
    expect(await screen.findByText('ok:none')).toBeTruthy();
    expect(screen.queryByText('components.clusterPlacement.title')).toBeNull();
    expect(mocked.get).not.toHaveBeenCalledWith('/assets/cl-1/members');
    expect(mocked.get).not.toHaveBeenCalledWith('/assets/cl-2/members');
  });

  it('raises no question for a cluster that already contains the placed asset', async () => {
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/assets/host-1/clusters') return { data: { items: [{ id: 'cl-1', name: 'PAR-VSPHERE-CL01', status: 'active' }] } } as never;
      if (url === '/assets/vm-1/relations') return { data: { incoming: [{ asset_id: 'cl-1', relation_type: 'contains' }] } } as never;
      return { data: { items: [] } } as never;
    });
    ask({ hostId: 'host-1', excludeClusterIds: [], placedAssetId: 'vm-1' });
    expect(await screen.findByText('ok:none')).toBeTruthy();
    expect(screen.queryByText('components.clusterPlacement.title')).toBeNull();
    expect(mocked.get).not.toHaveBeenCalledWith('/assets/cl-1/members');
  });

  it('still asks when the containers of the placed asset cannot be read', async () => {
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/assets/host-1/clusters') return { data: { items: [{ id: 'cl-1', name: 'PAR-VSPHERE-CL01', status: 'active' }] } } as never;
      if (url === '/assets/vm-1/relations') throw { response: { status: 500 } };
      if (url === '/assets/cl-1/members') return { data: { items: [member('host-1', 'esx-01')] } } as never;
      return { data: { items: [] } } as never;
    });
    ask({ hostId: 'host-1', excludeClusterIds: [], placedAssetId: 'vm-1' });
    expect(await screen.findByText('components.clusterPlacement.title')).toBeTruthy();
  });

  it('places directly when the reads fail', async () => {
    mocked.get.mockRejectedValue({ response: { status: 500 } });
    ask();
    expect(await screen.findByText('ok:none')).toBeTruthy();
    expect(screen.queryByText('components.clusterPlacement.title')).toBeNull();
  });
});
