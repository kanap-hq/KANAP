import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import api from '../../api';
import { OperationsTab } from './ApplicationWorkspacePage';

const translation = {
  t: (key: string, opts?: Record<string, unknown>) => {
    const args = opts ? Object.entries(opts).filter(([k]) => k !== 'defaultValue').map(([k, v]) => `${k}=${v}`).join(',') : '';
    return args ? `${key}(${args})` : key;
  },
  i18n: { language: 'en', resolvedLanguage: 'en' },
};
vi.mock('react-i18next', () => ({
  useTranslation: () => translation,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({ byField: { accessMethod: [] }, labelFor: (_field: string, code: string) => code }),
}));

const mocked = vi.mocked(api);
const SECTION = 'workspace.application.relations.sections.technologies';

function renderTab() {
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/applications/app-1/relations') {
      return {
        data: {
          year: 2026,
          budget_column: { key: 'planned', label: 'Budget' },
          budget_lines: [],
          contracts: [],
          projects: [],
          requests: [],
          tasks: [],
          technologies: [
            { id: 'tec-4', reference: 'TEC-4', name: 'Java', family: 'runtime', declared: true, hosted: false, versions: [], version_unknown: true, standard_support_end: null, via: [] },
          ],
          processes: [],
          suggestions: [],
          also: { assets: 0, interfaces: 0, documents: 0 },
        },
      } as never;
    }
    throw new Error(`unexpected GET ${url}`);
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter>
          <OperationsTab
            app={{ id: 'app-1', access_methods: [], support_contacts: [], support_notes: null, external_facing: false, etl_enabled: false, is_suite: false } as never}
            canManage
            onPatch={async () => undefined}
            onRefresh={async () => undefined}
          />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocked.get.mockReset();
});

describe('Operations tab technologies', () => {
  it('shows technologies at the top of the tab', async () => {
    renderTab();
    const section = await screen.findByRole('region', { name: SECTION });
    await screen.findByText('Java');
    const technical = screen.getByRole('heading', { name: 'workspace.application.technical.sectionTitle' });
    expect(section.parentElement?.firstElementChild).toBe(section);
    expect(section.compareDocumentPosition(technical) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/applications/app-1/relations'));
  });
});
