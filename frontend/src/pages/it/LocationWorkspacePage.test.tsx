import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

const navigateMock = vi.hoisted(() => vi.fn());
const stableT = vi.hoisted(() => (key: string) => key);

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true, profile: { id: 'user-1' } }) }));
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../hooks/useItOpsEnumOptions', () => {
  const value = { settings: null, byField: { hostingType: [{ code: 'on_prem', label: 'On premises' }] } };
  return { default: () => value, useItOpsEnumOptions: () => value };
});
vi.mock('../../hooks/useModuleItemNav', () => ({
  useLocationItemNav: () => ({ total: 0, index: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }),
}));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({ useRecentlyViewed: () => ({ addToRecent: () => undefined }) }));
vi.mock('../../components/workspace/SendLinkButton', () => ({ default: () => null }));
vi.mock('./workspace/LocationPropertiesDrawer', () => ({ default: () => null }));
vi.mock('./workspace/LocationMetadataBar', () => ({ default: () => null }));
vi.mock('./workspace/LocationOverviewTab', () => ({ default: () => null }));
vi.mock('./workspace/LocationContactsTab', () => ({ default: () => null }));
vi.mock('./workspace/LocationRelationsTab', () => ({ default: () => null }));

import api from '../../api';
import LocationWorkspacePage from './LocationWorkspacePage';

const mocked = api as unknown as Record<'get' | 'post' | 'patch', ReturnType<typeof vi.fn>>;

const LOCATION = {
  id: 'loc-1',
  location_reference: 'LOC-1',
  name: 'Paris DC',
  hosting_type: 'on_prem',
  operating_company_id: null,
  country_iso: null,
  city: null,
  provider: null,
  region: null,
  additional_info: null,
};

const duplicate = { response: { status: 409, data: { code: 'duplicate', message: 'Another location already has this name.' } } };

function renderAt(path: string) {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/it/locations/:id/:tab" element={<LocationWorkspacePage />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe('LocationWorkspacePage name refusals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/locations/loc-1') return { data: LOCATION };
      return { data: [] };
    });
  });

  it('says another location has the name, under the title, when a rename is a duplicate', async () => {
    mocked.patch.mockRejectedValueOnce(duplicate);
    renderAt('/it/locations/loc-1/overview');
    fireEvent.click(await screen.findByText('Paris DC'));
    const input = screen.getByDisplayValue('Paris DC');
    fireEvent.change(input, { target: { value: 'lyon dc' } });
    fireEvent.blur(input);
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/locations/loc-1', { name: 'lyon dc' }));
    expect(await screen.findByText('messages.locationNameTaken')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    // The stored name comes back.
    expect(await screen.findByText('Paris DC')).toBeInTheDocument();
  });

  it('says another location has the name, under the name field, when a create is a duplicate', async () => {
    mocked.post.mockRejectedValueOnce(duplicate);
    renderAt('/it/locations/new/overview');
    fireEvent.change(screen.getByPlaceholderText('workspace.location.namePlaceholder'), { target: { value: 'paris dc' } });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    expect(await screen.findByText('messages.locationNameTaken')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('workspace.location.namePlaceholder')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(navigateMock).not.toHaveBeenCalled();
  });
});

describe('LocationWorkspacePage relations badge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('counts what the Relations tab shows', async () => {
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/locations/loc-1') return { data: LOCATION };
      if (url === '/locations/loc-1/relation-counts') return { data: { relations: 7 } };
      return { data: [] };
    });
    renderAt('/it/locations/loc-1/overview');
    const tab = await screen.findByRole('tab', { name: /workspace\.location\.tabs\.relations/ });
    await waitFor(() => expect(tab).toHaveTextContent('7'));
    expect(mocked.get).toHaveBeenCalledWith('/locations/loc-1/relation-counts');
  });

  it('shows no badge when the tab is empty', async () => {
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/locations/loc-1') return { data: LOCATION };
      if (url === '/locations/loc-1/relation-counts') return { data: { relations: 0 } };
      return { data: [] };
    });
    renderAt('/it/locations/loc-1/overview');
    const tab = await screen.findByRole('tab', { name: /workspace\.location\.tabs\.relations/ });
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/locations/loc-1/relation-counts'));
    expect(tab.textContent).toBe('workspace.location.tabs.relations');
  });
});
