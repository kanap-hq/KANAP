import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => {
  const translation = {
    t: (key: string) => key,
    i18n: { language: 'en', resolvedLanguage: 'en', getResourceBundle: () => ({}) },
  };
  return { useTranslation: () => translation };
});
vi.mock('ag-grid-react', () => ({ AgGridReact: () => null }));
vi.mock('../api', () => ({ default: { get: vi.fn(async () => ({ data: { items: [], total: 0 } })) } }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ profile: null }) }));
vi.mock('../tenant/TenantContext', () => ({ useTenant: () => ({ tenantSlug: 'test' }) }));
vi.mock('../config/ThemeContext', () => ({ useThemeMode: () => ({ resolvedMode: 'light' }) }));
vi.mock('../i18n/useLocale', () => ({ useLocale: () => 'en' }));

import ServerDataGrid from './ServerDataGrid';

describe('ServerDataGrid Show scope', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  // The OPEX/CAPEX footers key their totals on the reported scope: a scope change that only
  // reloaded the rows left the totals of the previous scope under them.
  it('reports a scope change to the parent like a sort, filter or search change', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    const onQueryStateChange = vi.fn();
    render(
      <MemoryRouter>
        <ServerDataGrid<{ id: string; name: string }>
          columns={[{ field: 'name', headerName: 'Name' }]}
          endpoint="/things"
          queryKey="things"
          statusScopeConfig={{ defaultScope: 'enabled' }}
          onQueryStateChange={onQueryStateChange}
        />
      </MemoryRouter>,
    );
    onQueryStateChange.mockClear();

    fireEvent.click(screen.getByRole('radio', { name: 'common:labels.disabled' }));

    expect(onQueryStateChange).toHaveBeenCalledWith(expect.objectContaining({ statusScope: 'disabled' }));
    expect(onQueryStateChange.mock.calls.every(([state]) => state.statusScope === 'disabled')).toBe(true);
  });
});
