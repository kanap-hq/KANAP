import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import LegacyBudgetLineRedirect from './LegacyBudgetLineRedirect';

function Probe() {
  const location = useLocation();
  const navigate = useNavigate();
  return <button onClick={() => navigate(-1)}>{location.pathname}{location.search}{location.hash}</button>;
}

describe.each(['opex', 'capex'] as const)('legacy %s line addresses', (nature) => {
  it.each(['11111111-2222-3333-4444-555555555555', 'BL-127', 'OPX-7', 'CPX-4', '7'])('keeps the line %s, tab and query', async (id) => {
    const reference = id === '7' ? `${nature === 'opex' ? 'OPX' : 'CPX'}-7` : id;
    const query = '?year=2027&ctx=context%2Fid&from=report';
    render(<MemoryRouter initialEntries={[`/ops/${nature}/${id}/allocations${query}#part`]}>
      <Routes>
        <Route path={`/ops/${nature}/:id/:tab`} element={<LegacyBudgetLineRedirect nature={nature} />} />
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>);
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent(`/ops/budget/${reference}/allocations${query}#part`));
  });

  it('keeps an address without a tab', async () => {
    render(<MemoryRouter initialEntries={[`/ops/${nature}/BL-12?year=2027`]}><Routes>
      <Route path={`/ops/${nature}/:id`} element={<LegacyBudgetLineRedirect nature={nature} />} />
      <Route path="*" element={<Probe />} />
    </Routes></MemoryRouter>);
    expect(await screen.findByRole('button')).toHaveTextContent('/ops/budget/BL-12?year=2027');
  });

  it('sets the creation nature, preserves the query and replaces history', async () => {
    render(<MemoryRouter initialEntries={['/previous', `/ops/${nature}/new?year=2027&ctx=c&nature=other`]} initialIndex={1}>
      <Routes>
        <Route path={`/ops/${nature}/:id`} element={<LegacyBudgetLineRedirect nature={nature} />} />
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>);
    const button = await screen.findByRole('button');
    expect(button).toHaveTextContent(`/ops/budget/new?year=2027&ctx=c&nature=${nature}`);
    button.click();
    await waitFor(() => expect(button).toHaveTextContent('/previous'));
  });
});
