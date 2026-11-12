import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { resetCreationStore } from '../../components/workspace/creation/creationStore';

const stableT = vi.hoisted(() => (key: string) => key);

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true, profile: { id: 'user-1' } }) }));
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../hooks/useItOpsEnumOptions', () => {
  const value = {
    settings: { hostingTypes: [{ code: 'on_prem', category: 'on_prem' }, { code: 'public_cloud', category: 'cloud' }] },
    byField: { hostingType: [{ code: 'on_prem', label: 'On premises' }, { code: 'public_cloud', label: 'Public cloud' }] },
  };
  return { default: () => value, useItOpsEnumOptions: () => value };
});
vi.mock('../../hooks/useModuleItemNav', () => ({
  useLocationItemNav: () => ({ total: 0, index: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }),
}));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({ useRecentlyViewed: () => ({ addToRecent: () => undefined }) }));
vi.mock('../../components/workspace/SendLinkButton', () => ({ default: () => null }));
// The panel as two buttons: what the page does with the hosting type picked is what is tested here.
vi.mock('./workspace/LocationPropertiesDrawer', () => ({
  default: ({ onHostingTypeChange }: { onHostingTypeChange: (next: string) => void }) => (
    <div>
      <button type="button" onClick={() => onHostingTypeChange('public_cloud')}>pick-cloud</button>
      <button type="button" onClick={() => onHostingTypeChange('on_prem')}>pick-on-prem</button>
    </div>
  ),
}));
vi.mock('./workspace/LocationMetadataBar', () => ({ default: () => null }));
vi.mock('./workspace/LocationOverviewTab', () => ({ default: () => null }));
vi.mock('./workspace/LocationContactsTab', () => ({ default: () => null }));
vi.mock('./workspace/LocationRelationsTab', () => ({ default: () => null }));

import api from '../../api';
import { KanapDialogProvider } from '../../components/design';
import LocationWorkspacePage from './LocationWorkspacePage';

const mocked = api as unknown as Record<'get' | 'post' | 'patch' | 'delete', ReturnType<typeof vi.fn>>;

const SITE = {
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

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function renderAt(path: string) {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={new QueryClient()}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={[path]}>
            <Where />
            <Routes>
              <Route path="/it/locations/:id/:tab" element={<LocationWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

function serve(site: Record<string, unknown>) {
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/locations/LOC-1' || url === '/locations/loc-1') return { data: site };
    if (url === '/locations/LOC-9') return { data: { ...site, id: 'loc-9', location_reference: 'LOC-9', name: 'Lyon DC' } };
    return { data: [] };
  });
  mocked.patch.mockImplementation(async (_url: string, patch: object) => ({ data: { ...site, ...patch } }));
}

describe('LocationWorkspacePage hosting category change', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCreationStore();
  });

  it('switches a site with no operating company to a cloud type without asking', async () => {
    serve(SITE);
    renderAt('/it/locations/LOC-1/overview');
    fireEvent.click(await screen.findByText('pick-cloud'));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/locations/loc-1', { hosting_type: 'public_cloud' }));
    expect(screen.queryByText('workspace.location.changeHostingTitle')).toBeNull();
  });

  it('asks before switching a site that has an operating company, and saves on Continue', async () => {
    serve({ ...SITE, operating_company_id: 'co-1' });
    renderAt('/it/locations/LOC-1/overview');
    fireEvent.click(await screen.findByText('pick-cloud'));
    expect(await screen.findByText('workspace.location.changeHostingTitle')).toBeInTheDocument();
    expect(screen.getByText('workspace.location.switchToCloud')).toBeInTheDocument();
    expect(mocked.patch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.continue' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/locations/loc-1', { hosting_type: 'public_cloud' }));
  });

  it('switches a cloud site with no provider and no region to on-premises without asking, and asks when it has a provider', async () => {
    serve({ ...SITE, hosting_type: 'public_cloud' });
    const { unmount } = renderAt('/it/locations/LOC-1/overview');
    fireEvent.click(await screen.findByText('pick-on-prem'));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/locations/loc-1', { hosting_type: 'on_prem' }));
    expect(screen.queryByText('workspace.location.changeHostingTitle')).toBeNull();
    unmount();

    mocked.patch.mockClear();
    serve({ ...SITE, hosting_type: 'public_cloud', provider: 'aws' });
    renderAt('/it/locations/LOC-1/overview');
    fireEvent.click(await screen.findByText('pick-on-prem'));
    expect(await screen.findByText('workspace.location.switchToOnPrem')).toBeInTheDocument();
    expect(mocked.patch).not.toHaveBeenCalled();
  });

  it('does not ask on a site being created that has nothing to clear: the type is saved like the other fields', async () => {
    serve(SITE);
    mocked.post.mockResolvedValue({ data: { ...SITE, id: 'loc-9', location_reference: 'LOC-9', name: 'Lyon DC', creation_token: 'tok' } });
    renderAt('/it/locations/new/overview');
    const title = screen.getByRole('textbox', { name: 'common:buttons.editTitle' });
    fireEvent.change(title, { target: { value: 'Lyon DC' } });
    fireEvent.blur(title);
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/it/locations/LOC-9/overview'));
    fireEvent.click(await screen.findByText('pick-cloud'));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(screen.queryByText('workspace.location.changeHostingTitle')).toBeNull();
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/locations/loc-9', { hosting_type: 'public_cloud' }));
  });
});
