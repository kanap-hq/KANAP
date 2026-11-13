import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BudgetLineRoute from './BudgetLineRoute';
import api from '../../api';

vi.mock('../../api', () => ({ default: { get: vi.fn() } }));
const t = (key: string) => key;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }));
vi.mock('./BudgetLinePage', () => ({ default: ({ nature }: { nature: string }) => <div data-testid="workspace">{nature}</div> }));

function Probe() {
  const location = useLocation();
  const navigate = useNavigate();
  return <button onClick={() => navigate(-1)}>{location.pathname}{location.search}</button>;
}
function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/previous', path]} initialIndex={1}>
    <Probe /><React.Suspense fallback={<div data-testid="waiting" />}><Routes>
      <Route path="/ops/budget/new" element={<BudgetLineRoute />} />
      <Route path="/ops/budget/:ref" element={<BudgetLineRoute />} />
      <Route path="/ops/budget/:ref/:tab" element={<BudgetLineRoute />} />
    </Routes></React.Suspense>
  </MemoryRouter></QueryClientProvider>);
}
const resolveCalls = () => vi.mocked(api.get).mock.calls.filter(([url]) => String(url).startsWith('/budget-lines/resolve/')).length;
beforeEach(() => { vi.mocked(api.get).mockReset(); });
describe('budget line route resolution', () => {
  it.each(['opex', 'capex'])('resolves UUID to BL with nature %s and replaces history, keeping tab and query', async (nature) => {
    vi.mocked(api.get).mockResolvedValue({ data: { id: 'uuid', nature, reference: 'BL-127' } });
    renderAt('/ops/budget/11111111-2222-3333-4444-555555555555/budget?year=2027&ctx=c');
    expect(await screen.findByTestId('workspace')).toHaveTextContent(nature);
    expect(screen.getByRole('button')).toHaveTextContent('/ops/budget/BL-127/budget?year=2027&ctx=c');
    expect(api.get).toHaveBeenCalledWith('/budget-lines/resolve/11111111-2222-3333-4444-555555555555', expect.anything());
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('/previous'));
  });
  it.each(['BL-127', 'OPX-7', 'CPX-2', '127'])('resolves %s without adding a tab', async (ref) => {
    vi.mocked(api.get).mockResolvedValue({ data: { id: 'uuid', nature: 'capex', reference: 'BL-127' } });
    renderAt(`/ops/budget/${ref}?year=2027`);
    expect(await screen.findByTestId('workspace')).toHaveTextContent('capex');
    expect(screen.getByRole('button')).toHaveTextContent('/ops/budget/BL-127?year=2027');
  });
  it('suspends while the line resolves, so the page it is opened from can stay on screen', async () => {
    let answer: (value: unknown) => void = () => undefined;
    vi.mocked(api.get).mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    renderAt('/ops/budget/BL-127');
    expect(screen.getByTestId('waiting')).toBeInTheDocument();
    answer({ data: { id: 'uuid', nature: 'opex', reference: 'BL-127' } });
    expect(await screen.findByTestId('workspace')).toHaveTextContent('opex');
    expect(screen.queryByTestId('waiting')).toBeNull();
    expect(resolveCalls()).toBe(1);
    // The workspace's line and dimensions are read during the same wait.
    expect(api.get).toHaveBeenCalledWith('/budget-lines/BL-127', expect.anything());
  });
  it('shows a not-found screen and a link back to the list when the reference does not exist', async () => {
    vi.mocked(api.get).mockRejectedValue(Object.assign(new Error('Not found'), { response: { status: 404, data: { message: 'Budget line not found' } } }));
    renderAt('/ops/budget/BL-99999/overview?year=2027&q=nyc&list=budget');
    expect(await screen.findByRole('alert')).toHaveTextContent('budget.notFound');
    expect(screen.queryByText('Budget line not found')).toBeNull();
    expect(screen.queryByRole('button', { name: 'common:buttons.retry' })).toBeNull();
    expect(screen.getByRole('link', { name: 'budget.backToList' })).toHaveAttribute('href', '/ops/budget?year=2027&q=nyc');
    expect(screen.queryByTestId('workspace')).toBeNull();
    // The second read is the query's refetch on mount, sent by an effect after the error shows.
    await waitFor(() => expect(resolveCalls()).toBe(2));
  });
  it('shows the failure and a retry when the line cannot be read', async () => {
    vi.mocked(api.get).mockRejectedValue(Object.assign(new Error('down'), { response: { status: 503, data: { message: 'Database unavailable' } } }));
    renderAt('/ops/budget/BL-99999/overview');
    expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable');
    expect(screen.queryByText('budget.notFound')).toBeNull();
    expect(screen.getByRole('link', { name: 'budget.backToList' })).toHaveAttribute('href', '/ops/budget');
    expect(screen.queryByTestId('workspace')).toBeNull();
    await waitFor(() => expect(resolveCalls()).toBe(2));
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.retry' }));
    await waitFor(() => expect(resolveCalls()).toBe(3));
  });
  it.each([['', 'opex'], ['?nature=capex', 'capex'], ['?nature=unknown', 'opex']])('creates with %s and no resolution request', async (search, nature) => {
    renderAt(`/ops/budget/new${search}`);
    expect(screen.getByTestId('workspace')).toHaveTextContent(nature);
    expect(api.get).not.toHaveBeenCalled();
  });
});
