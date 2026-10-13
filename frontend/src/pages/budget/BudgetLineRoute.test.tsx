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
    <Probe /><Routes>
      <Route path="/ops/budget/new" element={<BudgetLineRoute />} />
      <Route path="/ops/budget/:ref" element={<BudgetLineRoute />} />
      <Route path="/ops/budget/:ref/:tab" element={<BudgetLineRoute />} />
    </Routes>
  </MemoryRouter></QueryClientProvider>);
}
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
  it('shows the existing load error for an unavailable line without mounting child resources', async () => {
    vi.mocked(api.get).mockRejectedValue(Object.assign(new Error('Not found'), { response: { status: 404 } }));
    renderAt('/ops/budget/BL-999');
    expect(await screen.findByRole('alert')).toHaveTextContent('opex.workspace.failedToLoad');
    expect(screen.queryByTestId('workspace')).toBeNull();
  });
  it.each([['', 'opex'], ['?nature=capex', 'capex'], ['?nature=unknown', 'opex']])('creates with %s and no resolution request', async (search, nature) => {
    renderAt(`/ops/budget/new${search}`);
    expect(screen.getByTestId('workspace')).toHaveTextContent(nature);
    expect(api.get).not.toHaveBeenCalled();
  });
});
