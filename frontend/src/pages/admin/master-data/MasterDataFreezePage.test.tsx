import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../i18n';
import { formatShortDate } from '../../../lib/dateFormat';
import { createAppTheme } from '../../../config/ThemeContext';

const ACTOR = 'ad63ce51-d2a4-44d8-8f57-4129cb2eeb5a';
const state = vi.hoisted(() => ({
  companies: {
    frozen: true,
    frozenAt: '2026-10-19T10:00:00.000Z',
    frozenBy: 'ad63ce51-d2a4-44d8-8f57-4129cb2eeb5a',
    frozenByName: 'Claude Test' as string | null,
  },
}));

vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../../hooks/useFreezeState', () => ({
  useFreezeState: () => ({
    data: {
      summary: {
        scopes: {
          companies: state.companies,
          departments: { frozen: false, frozenAt: null, frozenBy: null, frozenByName: null },
        },
      },
    },
    isLoading: false,
    isFetching: false,
    error: null,
  }),
}));

import MasterDataFreezePage from './MasterDataFreezePage';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <ThemeProvider theme={createAppTheme('light')}>
          <MemoryRouter>
            <MasterDataFreezePage />
          </MemoryRouter>
        </ThemeProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

describe('MasterDataFreezePage', () => {
  afterEach(async () => {
    state.companies.frozenByName = 'Claude Test';
    await i18n.changeLanguage('en');
  });

  it('names the person who froze the metrics, with the date, and never the user id', async () => {
    await i18n.changeLanguage('fr');
    renderPage();
    const date = formatShortDate('2026-10-19T10:00:00.000Z', 'fr', { year: 'always' });
    expect(screen.getByText(`Gelé par Claude Test le ${date}`)).toBeInTheDocument();
    expect(screen.queryByText(ACTOR)).toBeNull();
    expect(i18n.t('master-data:admin.freeze.frozenBy', { name: 'Claude Test', date: '19 Oct 2026', lng: 'en' })).toBe('Frozen by Claude Test on 19 Oct 2026');
    expect(i18n.t('master-data:admin.freeze.frozenBy', { name: 'Claude Test', date: '19. Okt. 2026', lng: 'de' })).toBe('Eingefroren von Claude Test am 19. Okt. 2026');
    expect(i18n.t('master-data:admin.freeze.frozenBy', { name: 'Claude Test', date: '19 oct 2026', lng: 'es' })).toBe('Congelado por Claude Test el 19 oct 2026');
  });

  it('stays on Frozen when the person has no name', async () => {
    await i18n.changeLanguage('fr');
    state.companies.frozenByName = null;
    renderPage();
    expect(screen.getByText('Gelé')).toBeInTheDocument();
    expect(screen.queryByText(ACTOR)).toBeNull();
  });
});
