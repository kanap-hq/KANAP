import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';
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
    settings: { hostingTypes: [{ code: 'public_cloud', category: 'cloud' }] },
    byField: { hostingType: [{ code: 'public_cloud', label: 'Public cloud' }], serverProvider: [] },
  };
  return { default: () => value, useItOpsEnumOptions: () => value };
});
vi.mock('../../hooks/useModuleItemNav', () => ({
  useLocationItemNav: () => ({ total: 0, index: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }),
}));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({ useRecentlyViewed: () => ({ addToRecent: () => undefined }) }));
vi.mock('../../components/workspace/SendLinkButton', () => ({ default: () => null }));
vi.mock('../../components/fields/CompanySelect', () => ({ default: () => null }));
vi.mock('./workspace/LocationMetadataBar', () => ({ default: () => null }));
vi.mock('./workspace/LocationOverviewTab', () => ({ default: () => null }));
vi.mock('./workspace/LocationContactsTab', () => ({ default: () => null }));
vi.mock('./workspace/LocationRelationsTab', () => ({ default: () => null }));

import api from '../../api';
import LocationWorkspacePage from './LocationWorkspacePage';

const mocked = api as unknown as Record<'get' | 'post' | 'patch' | 'delete', ReturnType<typeof vi.fn>>;

const SITE = {
  id: 'loc-1',
  location_reference: 'LOC-1',
  name: 'Lorient DC',
  hosting_type: 'public_cloud',
  operating_company_id: null,
  country_iso: null,
  city: null,
  provider: null,
  region: null,
  additional_info: null,
};

describe('LocationWorkspacePage saving a field while the next one is typed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCreationStore();
    mocked.get.mockImplementation(async (url: string) => (url === '/locations/LOC-1' ? { data: SITE } : { data: [] }));
  });

  it('keeps the field the person went on to editable and focused while the save of the previous one is under way', async () => {
    const user = userEvent.setup();
    // The saves answer when the test says so, in the order they were sent.
    const waiting: Array<() => void> = [];
    let server = { ...SITE };
    mocked.patch.mockImplementation((_url: string, body: object) => new Promise((resolve) => {
      waiting.push(() => { server = { ...server, ...body }; resolve({ data: server }); });
    }));
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <QueryClientProvider client={new QueryClient()}>
          <KanapDialogProvider>
            <MemoryRouter initialEntries={['/it/locations/LOC-1/overview']}>
              <Routes><Route path="/it/locations/:id/:tab" element={<LocationWorkspacePage />} /></Routes>
            </MemoryRouter>
          </KanapDialogProvider>
        </QueryClientProvider>
      </ThemeProvider>,
    );
    const drawer = await screen.findByRole('complementary');
    const region = within(drawer).getByPlaceholderText('workspace.location.fields.regionPlaceholder') as HTMLInputElement;
    const city = within(drawer).getByPlaceholderText('workspace.location.fields.cityPlaceholder') as HTMLInputElement;

    // The region is typed and left for the city: its save is under way.
    await user.click(region);
    await user.keyboard('Bretagne');
    await user.click(city);
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(1));
    expect(mocked.patch).toHaveBeenLastCalledWith('/locations/loc-1', { region: 'Bretagne' });

    // The city is typed, in one go, while that save is still waiting for its answer.
    expect(city).toBeEnabled();
    await user.keyboard('Lorient');
    expect(city).toHaveFocus();
    expect(city).toBeEnabled();
    expect(city).toHaveValue('Lorient');

    await act(async () => { waiting[0](); });
    expect(city).toHaveFocus();
    expect(city).toHaveValue('Lorient');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(2));
    expect(mocked.patch).toHaveBeenLastCalledWith('/locations/loc-1', { city: 'Lorient' });
    await act(async () => { waiting[1](); });
    await waitFor(() => expect(region).toHaveValue('Bretagne'));
    expect(city).toHaveValue('Lorient');
    expect(server).toMatchObject({ region: 'Bretagne', city: 'Lorient' });
  });
});
