import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import ItNetboxRedirect from './ItNetboxRedirect';

function Landed() {
  const { pathname, search } = useLocation();
  return <div data-testid="landed">{`${pathname}${search}`}</div>;
}

describe('ItNetboxRedirect', () => {
  it('sends /it/netbox to the Netbox tab and keeps the other parameters', () => {
    render(
      <MemoryRouter initialEntries={['/it/netbox?state=linked&foo=1']}>
        <Routes>
          <Route path="/it/netbox" element={<ItNetboxRedirect />} />
          <Route path="/it/settings" element={<Landed />} />
        </Routes>
      </MemoryRouter>,
    );
    const landed = new URLSearchParams(screen.getByTestId('landed').textContent?.split('?')[1]);
    expect(screen.getByTestId('landed').textContent?.startsWith('/it/settings?')).toBe(true);
    expect(landed.get('tab')).toBe('netbox');
    expect(landed.get('state')).toBe('linked');
    expect(landed.get('foo')).toBe('1');
  });
});
