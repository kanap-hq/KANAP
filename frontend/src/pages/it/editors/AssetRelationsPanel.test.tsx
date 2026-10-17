import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import api from '../../../api';
import AssetRelationsPanel from './AssetRelationsPanel';

const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
vi.mock('react-i18next', () => ({ useTranslation: () => translation }));
vi.mock('../../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../../../components/design', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../components/design')>()),
  useKanapDialogs: () => ({ confirm: vi.fn() }),
}));
vi.mock('../../../components/finance/BudgetLinesRelationField', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../components/finance/BudgetLinesRelationField')>()),
  default: () => null,
}));
vi.mock('./AssetImpactSection', () => ({ default: () => null }));
vi.mock('./IncidentRelationsSection', () => ({ default: () => null }));

const mocked = vi.mocked(api);

function renderPanel(assetId: string) {
  const tree = (id: string) => (
    <React.StrictMode>
      <ThemeProvider theme={createAppTheme('light')}>
        <AssetRelationsPanel assetId={id} />
      </ThemeProvider>
    </React.StrictMode>
  );
  const view = render(tree(assetId));
  return { rerender: (id: string) => view.rerender(tree(id)) };
}

const urls = () => mocked.get.mock.calls.map(([url]) => String(url));

beforeEach(() => {
  mocked.get.mockReset();
  mocked.get.mockImplementation(async (url: string) => {
    if (url.endsWith('/links') || url.endsWith('/attachments')) return { data: [] } as never;
    return { data: { items: [], total: 0 } } as never;
  });
});

describe('AssetRelationsPanel', () => {
  it('reads nothing until the asset id is resolved, then reads each list once', async () => {
    // A reference route (`/it/assets/AST-4/relations`) mounts the panel before the id is known.
    const view = renderPanel('');
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(urls()).toEqual([]);

    view.rerender('a1');
    await waitFor(() => expect(urls()).toContain('/assets/a1/attachments'));
    await waitFor(() => expect(urls()).toContain('/assets'));
    expect(urls().filter((url) => url.includes('/assets//'))).toEqual([]);

    const perAsset = urls().filter((url) => url.startsWith('/assets/a1/')).sort();
    expect(perAsset).toEqual([
      '/assets/a1/attachments',
      '/assets/a1/capex-items',
      '/assets/a1/contracts',
      '/assets/a1/links',
      '/assets/a1/projects',
      '/assets/a1/related-tasks',
      '/assets/a1/relations',
      '/assets/a1/spend-items',
    ]);
    expect(urls().filter((url) => url === '/contracts')).toHaveLength(1);
    expect(urls().filter((url) => url === '/portfolio/projects')).toHaveLength(1);
  });
});
