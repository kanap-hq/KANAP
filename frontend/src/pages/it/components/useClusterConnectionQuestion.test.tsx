import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../i18n';
import { createAppTheme } from '../../../config/ThemeContext';
import useClusterConnectionQuestion from './useClusterConnectionQuestion';
import type { ServerOption } from '../../../components/fields/serverOptionRender';

const apiGet = vi.hoisted(() => vi.fn());
vi.mock('../../../api', () => ({ default: { get: apiGet } }));

const SERVER: ServerOption = {
  id: 'srv-1',
  name: 'PAR-SQL-01',
  environment: 'prod',
  kind: 'vm',
  provider: 'vmware',
};

const CL1 = { id: 'cl-1', name: 'PAR-SQL-CL01', status: 'active' };
const CL2 = { id: 'cl-2', name: 'PAR-SQL-CL02', status: 'active' };
const member = (id: string, name: string) => ({ id, name, status: 'active' });

function Harness({ picked, others = [] }: { picked: ServerOption; others?: string[] }) {
  const { choose, questionDialog } = useClusterConnectionQuestion();
  const [answer, setAnswer] = React.useState('pending');
  return (
    <>
      <button
        type="button"
        onClick={async () => {
          const result = await choose(picked, others);
          setAnswer(result === null ? 'null' : result.id);
        }}
      >
        choose
      </button>
      <div data-testid="answer">{answer}</div>
      {questionDialog}
    </>
  );
}

function renderHarness(picked: ServerOption = SERVER, others: string[] = []) {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <Harness picked={picked} others={others} />
    </ThemeProvider>,
  );
}

const chooseAndWait = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'choose' }));
  await waitFor(() => expect(screen.getByTestId('answer').textContent).not.toBe('pending'));
  return screen.getByTestId('answer').textContent;
};

describe('useClusterConnectionQuestion', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    apiGet.mockReset();
  });

  it('asks nothing for a server outside every cluster', async () => {
    apiGet.mockImplementation(async (url: string) => {
      if (url === '/assets/srv-1/clusters') return { data: { items: [] } };
      throw new Error(`unexpected ${url}`);
    });
    renderHarness();
    expect(await chooseAndWait()).toBe('srv-1');
    expect(screen.queryByText('Connect to the cluster?')).toBeNull();
  });

  it('connects the cluster of a member when asked', async () => {
    apiGet.mockImplementation(async (url: string) => {
      if (url === '/assets/srv-1/clusters') return { data: { items: [CL1] } };
      if (url === '/assets/cl-1/members') return { data: { items: [member('srv-1', 'PAR-SQL-01'), member('srv-2', 'PAR-SQL-02')] } };
      if (url === '/assets/cl-1') return { data: { ...CL1, is_cluster: true, environment: 'prod', kind: 'vm', provider: 'vmware' } };
      throw new Error(`unexpected ${url}`);
    });
    renderHarness();
    fireEvent.click(screen.getByRole('button', { name: 'choose' }));
    expect(await screen.findByText('PAR-SQL-01 is part of PAR-SQL-CL01. The connection will cover its 2 members.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Connect to the cluster' }));
    await waitFor(() => expect(screen.getByTestId('answer').textContent).toBe('cl-1'));
    expect(apiGet).toHaveBeenCalledWith('/assets/cl-1');
  });

  it('keeps the server only when asked', async () => {
    apiGet.mockImplementation(async (url: string) => {
      if (url === '/assets/srv-1/clusters') return { data: { items: [CL1] } };
      if (url === '/assets/cl-1/members') return { data: { items: [member('srv-1', 'PAR-SQL-01'), member('srv-2', 'PAR-SQL-02')] } };
      throw new Error(`unexpected ${url}`);
    });
    renderHarness();
    fireEvent.click(screen.getByRole('button', { name: 'choose' }));
    fireEvent.click(await screen.findByRole('button', { name: 'This server only' }));
    await waitFor(() => expect(screen.getByTestId('answer').textContent).toBe('srv-1'));
  });

  it('cancels without a target when the dialog is closed', async () => {
    apiGet.mockImplementation(async (url: string) => {
      if (url === '/assets/srv-1/clusters') return { data: { items: [CL1] } };
      if (url === '/assets/cl-1/members') return { data: { items: [member('srv-1', 'PAR-SQL-01')] } };
      throw new Error(`unexpected ${url}`);
    });
    renderHarness();
    fireEvent.click(screen.getByRole('button', { name: 'choose' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByTestId('answer').textContent).toBe('null'));
  });

  it('asks nothing when the other side is the cluster', async () => {
    apiGet.mockImplementation(async (url: string) => {
      if (url === '/assets/srv-1/clusters') return { data: { items: [CL1] } };
      throw new Error(`unexpected ${url}`);
    });
    renderHarness(SERVER, ['cl-1']);
    expect(await chooseAndWait()).toBe('srv-1');
    expect(apiGet.mock.calls.some(([url]) => url === '/assets/cl-1/members')).toBe(false);
  });

  it('asks nothing when the other side is another member of the cluster', async () => {
    apiGet.mockImplementation(async (url: string) => {
      if (url === '/assets/srv-1/clusters') return { data: { items: [CL1] } };
      if (url === '/assets/cl-1/members') return { data: { items: [member('srv-1', 'PAR-SQL-01'), member('srv-2', 'PAR-SQL-02')] } };
      throw new Error(`unexpected ${url}`);
    });
    renderHarness(SERVER, ['srv-2']);
    expect(await chooseAndWait()).toBe('srv-1');
    expect(screen.queryByText('Connect to the cluster?')).toBeNull();
  });

  it('asks nothing for a member retired from its cluster', async () => {
    apiGet.mockImplementation(async (url: string) => {
      if (url === '/assets/srv-1/clusters') return { data: { items: [CL1] } };
      if (url === '/assets/cl-1/members') return { data: { items: [member('srv-2', 'PAR-SQL-02')] } };
      throw new Error(`unexpected ${url}`);
    });
    renderHarness();
    expect(await chooseAndWait()).toBe('srv-1');
    expect(screen.queryByText('Connect to the cluster?')).toBeNull();
  });

  it('keeps the server when its clusters cannot be read', async () => {
    apiGet.mockRejectedValue({ response: { status: 500 } });
    renderHarness();
    expect(await chooseAndWait()).toBe('srv-1');
    expect(screen.queryByText('Connect to the cluster?')).toBeNull();
  });

  it('keeps the server when the members of a cluster cannot be read', async () => {
    apiGet.mockImplementation(async (url: string) => {
      if (url === '/assets/srv-1/clusters') return { data: { items: [CL1] } };
      if (url === '/assets/cl-1/members') throw { response: { status: 500 } };
      throw new Error(`unexpected ${url}`);
    });
    renderHarness();
    expect(await chooseAndWait()).toBe('srv-1');
    expect(screen.queryByText('Connect to the cluster?')).toBeNull();
  });

  it('lists the clusters and their member counts when the server belongs to several', async () => {
    apiGet.mockImplementation(async (url: string) => {
      if (url === '/assets/srv-1/clusters') return { data: { items: [CL1, CL2] } };
      if (url === '/assets/cl-1/members') return { data: { items: [member('srv-1', 'PAR-SQL-01'), member('srv-2', 'PAR-SQL-02')] } };
      if (url === '/assets/cl-2/members') return { data: { items: [member('srv-1', 'PAR-SQL-01'), member('srv-3', 'PAR-SQL-03')] } };
      if (url === '/assets/cl-2') return { data: { ...CL2, is_cluster: true, environment: 'prod', kind: 'vm', provider: 'vmware' } };
      throw new Error(`unexpected ${url}`);
    });
    renderHarness();
    fireEvent.click(screen.getByRole('button', { name: 'choose' }));
    expect(await screen.findByText('PAR-SQL-01 is part of several clusters.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'PAR-SQL-CL01 · 2 members' })).toBeInTheDocument();
    const second = screen.getByRole('radio', { name: 'PAR-SQL-CL02 · 2 members' });
    fireEvent.click(second);
    fireEvent.click(screen.getByRole('button', { name: 'Connect to the cluster' }));
    await waitFor(() => expect(screen.getByTestId('answer').textContent).toBe('cl-2'));
  });

  it('asks nothing and reads nothing when the cluster itself is chosen', async () => {
    renderHarness({ ...SERVER, id: 'cl-1', is_cluster: true });
    expect(await chooseAndWait()).toBe('cl-1');
    expect(apiGet).not.toHaveBeenCalled();
  });
});
