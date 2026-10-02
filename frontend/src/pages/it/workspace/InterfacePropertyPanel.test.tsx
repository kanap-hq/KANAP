import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});
vi.mock('../../../api', () => ({ default: { get: vi.fn() } }));
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'me' }, hasLevel: () => true }) }));
vi.mock('../../../hooks/useApplicationClassificationCatalog', () => ({
  default: () => ({ data: { dataClasses: [], businessCriticalityLevels: [] } }),
}));
vi.mock('../../../hooks/useItOpsEnumOptions', () => ({ default: () => ({ byField: {} }), useItOpsEnumOptions: () => ({ byField: {} }) }));
vi.mock('../../../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../../../components/fields/BusinessProcessSelect', () => ({ default: () => null }));
// The owners picker stands for itself: it shows the names it is given.
vi.mock('../../../components/fields/TeamMemberMultiSelect', () => ({
  default: ({ label, value }: { label: string; value: Array<{ user_display_name?: string }> }) => (
    <div data-testid={label}>{value.map((member) => member.user_display_name).join(' | ')}</div>
  ),
}));

import api from '../../../api';
import InterfacePropertyPanel from './InterfacePropertyPanel';

const apiGet = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;
const PEOPLE: Record<string, { id: string; first_name: string; last_name: string }> = {
  'u-1': { id: 'u-1', first_name: 'Hélène', last_name: 'Dupré' },
  'u-2': { id: 'u-2', first_name: 'Marc', last_name: 'Zola' },
};

function panel(owners: Array<{ user_id: string; owner_type: 'business' | 'it' }>) {
  return (
    <InterfacePropertyPanel
      canManage
      isCreate={false}
      data={{ id: 'int-1', owners, companies: [], data_residency: [] } as never}
      onPatch={async () => undefined}
      onReplaceCompanies={async () => undefined}
      onReplaceDataResidency={async () => undefined}
      onReplaceOwners={async () => undefined}
    />
  );
}

describe('InterfacePropertyPanel owners', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockImplementation(async (url: string, config?: { params?: Record<string, unknown> }) => {
      if (url !== '/users/lookup') return { data: { items: [], has_more: false } };
      const ids = String(config?.params?.ids ?? '').split(',').filter(Boolean);
      return { data: { items: ids.map((id) => PEOPLE[id]).filter(Boolean), has_more: false } };
    });
  });

  it('adding an owner reads only the new one; the names already shown never flash', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrap = (ui: React.ReactElement) => (
      <QueryClientProvider client={client}><ThemeProvider theme={createAppTheme('light')}>{ui}</ThemeProvider></QueryClientProvider>
    );
    const view = render(wrap(panel([{ user_id: 'u-1', owner_type: 'business' }])));
    await waitFor(() => expect(screen.getByTestId('Business owners')).toHaveTextContent('Hélène Dupré'));

    view.rerender(wrap(panel([{ user_id: 'u-1', owner_type: 'business' }, { user_id: 'u-2', owner_type: 'business' }])));
    // At once: the known name stays, the new one loads.
    expect(screen.getByTestId('Business owners')).toHaveTextContent('Hélène Dupré | …');
    await waitFor(() => expect(screen.getByTestId('Business owners')).toHaveTextContent('Hélène Dupré | Marc Zola'));
    const reads = apiGet.mock.calls.filter(([url]) => url === '/users/lookup').map(([, config]) => config.params.ids);
    expect(reads).toEqual(['u-1', 'u-2']);

    // Removing one: nothing to read, nothing flashes.
    view.rerender(wrap(panel([{ user_id: 'u-2', owner_type: 'business' }])));
    expect(screen.getByTestId('Business owners')).toHaveTextContent('Marc Zola');
    expect(apiGet.mock.calls.filter(([url]) => url === '/users/lookup')).toHaveLength(2);
  });

  it('an owner who can no longer be read says so instead of loading for ever', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ThemeProvider theme={createAppTheme('light')}>{panel([{ user_id: 'u-gone', owner_type: 'it' }])}</ThemeProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('IT owners')).toHaveTextContent('common:selects.valueUnavailable'));
  });
});
