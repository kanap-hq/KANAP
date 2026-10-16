import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import AssetsPage from './AssetsPage';

const deleteButton = vi.hoisted(() => ({ props: null as null | Record<string, any> }));
const post = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../../api', () => ({ default: { get: vi.fn(async () => ({ data: { items: [] } })), post } }));
vi.mock('../../hooks/useItOpsEnumOptions', () => ({ default: () => ({ settings: null, byField: {}, labelFor: (_field: string, code: string) => code }) }));
vi.mock('../../components/ServerDataGrid', () => ({ default: () => null }));
vi.mock('../../components/csv', () => ({ CsvExportDialogV2: () => null, CsvImportDialogV2: () => null }));
vi.mock('../../components/DeleteSelectedButton', () => ({
  default: (props: Record<string, any>) => {
    deleteButton.props = props;
    return null;
  },
}));

describe('AssetsPage delete', () => {
  it('asks the delete check before its confirmation, and names the assets in its words', async () => {
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter><AssetsPage /></MemoryRouter>
      </ThemeProvider>,
    );
    const props = deleteButton.props!;
    expect(props).not.toBeNull();
    expect(props.endpoint).toBe('/assets/bulk');
    const refused = [{ id: 'a', name: 'srv-01', code: 'ASSET_IN_USE', usages: [{ type: 'app_assignments', total: 2 }] }];
    post.mockResolvedValueOnce({ data: { refused } });
    expect(await props.checkDelete(['a', 'b'])).toEqual({ refused });
    expect(post).toHaveBeenCalledWith('/assets/delete-check', { ids: ['a', 'b'] });
    expect(String(props.itemLabels.toDelete(2))).toBe('pages.assets.delete.toDelete');
    expect(String(props.itemLabels.kept(1))).toBe('pages.assets.delete.kept');
    expect(String(props.itemLabels.deleted(2))).toBe('pages.assets.delete.deleted');
  });
});
